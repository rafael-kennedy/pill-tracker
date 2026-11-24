import * as db from './db.js';
import { toCSV, fromCSV } from './csv.js';
import { ago, stamp } from './time.js';
import { haptic, startRatchet, dropPill } from './swallow.js';

const $ = (s) => document.querySelector(s);
const BACKUP_NAG_DAYS = 7;
let state = { pills: [], doses: [] };
let editingId = null;

async function load() {
  state = await db.getAll();
  render();
}

function lastDoses(pillId, n) {
  return state.doses.filter((d) => d.pillId === pillId).sort((a, b) => b.takenAt - a.takenAt).slice(0, n);
}

function render() {
  const list = $('#pillList');
  const now = Date.now();
  const pills = [...state.pills].sort((a, b) => a.createdAt - b.createdAt);
  $('#empty').hidden = pills.length > 0;
  $('#hint').hidden = pills.length === 0;
  list.replaceChildren(...pills.map((p) => pillCard(p, now)));
  renderBackupStatus();
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  e.append(...kids.filter((k) => k != null));
  return e;
}

const CAPSULE = `<svg class="capsule" viewBox="0 0 30 30" aria-hidden="true">
  <path class="cap-b" d="M15 4.6a5.4 5.4 0 0 1 5.4 5.4V15H9.6v-5A5.4 5.4 0 0 1 15 4.6z"/>
  <path class="cap-a" d="M9 15h12v5a6 6 0 0 1-12 0z"/></svg>`;
const HOLD_MS = 1000;
const TAP_MS = 250;
const JUST_MS = 60e3;
const expanded = new Set();
const falling = new Set();

function pillCard(p, now) {
  const history = lastDoses(p.id, 10);
  const last = history[0];
  const open = expanded.has(p.id);
  const icon = el('span', { class: 'pill-icon' + (falling.has(p.id) ? ' gone' : ''), 'aria-hidden': 'true' });
  icon.innerHTML = CAPSULE;
  const row = el('div', {
    class: 'pill-row', tabindex: '0', role: 'button', 'aria-expanded': String(open),
    'aria-label': `${p.name}. Hold to log a dose now. Tap for details.`,
  },
    el('div', { class: 'sweep' }),
    el('div', { class: 'pill-info' },
      el('span', { class: 'pill-name' }, p.name),
      el('span', { class: 'pill-ago' + (last && now - last.takenAt < JUST_MS ? ' just' : ''), 'data-taken': last ? last.takenAt : '' },
        last ? ago(last.takenAt, now) : 'Not taken yet')),
    icon);
  wireRow(row, p);
  return el('li', { class: 'pill', 'data-id': p.id },
    row,
    open ? el('div', { class: 'detail' },
      p.instructions ? el('p', { class: 'pill-instr' }, p.instructions) : null,
      history.length ? el('p', { class: 'label' }, 'Recent') : null,
      history.length ? el('ul', { class: 'history' }, ...history.map((d) =>
        el('li', {}, el('span', {}, stamp(d.takenAt, now)),
          el('button', { class: 'x-btn', onclick: () => removeDose(d), 'aria-label': `Remove ${stamp(d.takenAt, now)}` }, '×')))) : null,
      el('button', { class: 'text-btn', onclick: () => openPillDialog(p) }, 'Edit')) : null);
}

// The whole row is the target. A quick tap toggles details. A 1s hold logs a dose.
// Moving the finger more than 10px (scrolling) cancels.
function wireRow(row, p) {
  let timer = null, x0 = 0, y0 = 0, tDown = 0, stopRatchet = () => {};
  const start = (e) => {
    if (e.button > 0 || timer) return;
    tDown = performance.now();
    if (e.clientX != null) { x0 = e.clientX; y0 = e.clientY; }
    row.classList.remove('release'); row.classList.add('holding');
    stopRatchet = startRatchet();
    timer = setTimeout(() => {
      timer = null;
      row.classList.remove('holding'); row.classList.add('release');
      take(p, row.querySelector('.pill-icon'));
    }, HOLD_MS);
  };
  const cancel = () => {
    if (!timer) return false;
    clearTimeout(timer); timer = null; stopRatchet();
    row.classList.remove('holding');
    return true;
  };
  const end = () => {
    const quick = performance.now() - tDown < TAP_MS;
    if (cancel() && quick) toggle(p.id);
  };
  row.addEventListener('pointerdown', start);
  row.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', cancel);
  row.addEventListener('pointerleave', cancel);
  row.addEventListener('contextmenu', (e) => e.preventDefault());
  row.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(e); } });
  row.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(); });
}

function toggle(id) {
  expanded.has(id) ? expanded.delete(id) : expanded.add(id);
  render();
}

// The dose is saved the instant the hold completes, and the haptic says so.
// The fall that follows is presentation only.
async function take(p, iconEl) {
  const dose = { id: db.uid(), pillId: p.id, takenAt: Date.now() };
  haptic.logged();
  state.doses.push(dose);
  falling.add(p.id);
  const ago = iconEl.closest('.pill-row').querySelector('.pill-ago');
  ago.textContent = 'just now'; ago.dataset.taken = dose.takenAt; ago.classList.add('just');
  toast(`Logged ${p.name}`, 'Undo', async () => {
    await db.deleteDose(dose.id);
    state.doses = state.doses.filter((d) => d.id !== dose.id);
    render();
  });
  try {
    await db.putDose(dose);
  } catch (err) {
    state.doses = state.doses.filter((d) => d.id !== dose.id);
    toast(`Could not save: ${err.message}`);
  }
  await dropPill(iconEl, CAPSULE);
  falling.delete(p.id);
  render();
  const icon = document.querySelector(`.pill[data-id="${p.id}"] .pill-icon`);
  if (icon) icon.classList.add('back');
}

async function removeDose(d) {
  await db.deleteDose(d.id);
  state.doses = state.doses.filter((x) => x.id !== d.id);
  render();
  toast('Entry removed', 'Undo', async () => { await db.putDose(d); state.doses.push(d); render(); });
}

// Refresh relative times every 30s without rebuilding the DOM.
function tick() {
  const now = Date.now();
  for (const n of document.querySelectorAll('.pill-ago[data-taken]')) {
    const t = Number(n.dataset.taken);
    if (!t) continue;
    n.textContent = ago(t, now);
    n.classList.toggle('just', now - t < JUST_MS);
  }
}

// ---- Pill add/edit dialog
function openPillDialog(p) {
  editingId = p ? p.id : null;
  const f = $('#pillForm');
  f.name.value = p ? p.name : '';
  f.instructions.value = p ? p.instructions || '' : '';
  $('#pillDialogTitle').textContent = p ? 'Edit pill' : 'Add pill';
  $('#deletePillBtn').hidden = !p;
  $('#pillDialog').showModal();
  if (!p) f.name.focus(); else document.activeElement.blur();
}

$('#addBtn').addEventListener('click', () => openPillDialog(null));
$('#emptyAddBtn').addEventListener('click', () => openPillDialog(null));
$('#cancelPillBtn').addEventListener('click', () => $('#pillDialog').close());
$('#pillForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) return;
  const existing = state.pills.find((x) => x.id === editingId);
  const pill = existing
    ? { ...existing, name, instructions: f.instructions.value.trim() }
    : { id: db.uid(), name, instructions: f.instructions.value.trim(), createdAt: Date.now() };
  await db.putPill(pill);
  state.pills = state.pills.filter((x) => x.id !== pill.id).concat(pill);
  $('#pillDialog').close();
  render();
});
$('#deletePillBtn').addEventListener('click', async () => {
  const p = state.pills.find((x) => x.id === editingId);
  if (!p || !confirm(`Delete ${p.name} and its history?`)) return;
  await db.deletePill(p.id);
  state.pills = state.pills.filter((x) => x.id !== p.id);
  state.doses = state.doses.filter((d) => d.pillId !== p.id);
  $('#pillDialog').close();
  render();
});

// ---- Backup
async function renderBackupStatus() {
  const last = await db.getMeta('lastExport');
  const status = $('#backupStatus');
  const banner = $('#banner');
  const hasData = state.pills.length > 0;
  status.textContent = last ? `Backed up ${ago(last)}` : '';
  const stale = hasData && (!last || Date.now() - last > BACKUP_NAG_DAYS * 864e5);
  banner.hidden = !stale;
  if (stale) {
    banner.replaceChildren(
      last ? `Last backup ${ago(last)}. ` : 'Not backed up yet. ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); exportCSV(); } }, 'Back up'));
  }
}

async function exportCSV() {
  const csv = toCSV(state);
  const d = new Date();
  const name = `pills-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const url = URL.createObjectURL(file);
      el('a', { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10e3);
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // user closed share sheet
    toast(`Export failed: ${err.message}`);
    return;
  }
  await db.setMeta('lastExport', Date.now());
  renderBackupStatus();
  toast('Backup exported');
}

$('#exportBtn').addEventListener('click', exportCSV);
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = fromCSV(await file.text());
    if (!confirm(`Import ${data.pills.length} pills and ${data.doses.length} doses? Matching entries are updated. Nothing is deleted.`)) return;
    await db.merge(data);
    await load();
  renderInstall();
    $('#menuDialog').close();
    toast('Import complete');
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

// ---- Menu
$('#menuBtn').addEventListener('click', async () => {
  $('#storageStatus').textContent = await storageText();
  const hint = installHint();
  $('#installHint').hidden = !hint;
  $('#installHint').textContent = hint || '';
  $('#menuDialog').showModal();
});
$('#closeMenuBtn').addEventListener('click', () => $('#menuDialog').close());
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function storageText() {
  if (!navigator.storage || !navigator.storage.persisted) return '';
  const p = await navigator.storage.persisted();
  return p ? 'Storage: persistent. The browser will not clear it on its own.'
    : 'Storage: best effort. The browser may clear it under pressure. Keep CSV backups.';
}

function installHint() {
  if (standalone()) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios
    ? 'Install it: tap Share, then Add to Home Screen. Safari may erase data for sites not on the Home Screen.'
    : 'Install it: open the browser menu, then Install app or Add to Home screen.';
}

// ---- Install prompt
// Installed = running standalone. In a browser tab, show a card. Android gets the real
// install dialog via beforeinstallprompt; iPhone has no API, so we show the steps.
// Dismissing hides it for a week, because uninstalled is when iOS may erase data.
const INSTALL_SNOOZE_MS = 7 * 864e5;
let deferredInstall = null;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SHARE_ICON = '<svg class="share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; renderInstall(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('#install').hidden = true; });

async function renderInstall() {
  const box = $('#install');
  if (standalone()) { box.hidden = true; return; }
  const snoozed = await db.getMeta('installSnoozedAt').catch(() => 0);
  if (snoozed && Date.now() - snoozed < INSTALL_SNOOZE_MS) { box.hidden = true; return; }
  const dismiss = el('button', { class: 'text-btn', onclick: async () => {
    box.hidden = true; await db.setMeta('installSnoozedAt', Date.now());
  } }, 'Not now');
  const why = el('p', { class: 'why' }, 'Installed, it works offline and your data is safer. Browsers can clear data for sites that are not installed.');
  if (deferredInstall) {
    box.replaceChildren(el('p', {}, el('strong', {}, 'Install Pills')), why,
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: async () => {
        const e = deferredInstall; deferredInstall = null;
        e.prompt();
        const { outcome } = await e.userChoice;
        if (outcome === 'accepted') box.hidden = true;
      } }, 'Install'), dismiss));
  } else if (isIOS()) {
    const how = el('p', {});
    how.innerHTML = `Tap Share ${SHARE_ICON} then <strong>Add to Home Screen</strong>. In Safari, Share may be under the ⋯ button.`;
    box.replaceChildren(el('p', {}, el('strong', {}, 'Add Pills to your Home Screen')), how, why,
      el('div', { class: 'row' }, dismiss));
  } else {
    box.replaceChildren(el('p', {}, el('strong', {}, 'Install Pills')),
      el('p', {}, 'Open your browser menu and choose Install app or Add to Home screen.'), why,
      el('div', { class: 'row' }, dismiss));
  }
  box.hidden = false;
}

// ---- Toast
let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  t.replaceChildren(el('span', {}, msg));
  if (actionLabel) t.append(el('button', { onclick: () => { t.hidden = true; action(); } }, actionLabel));
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---- Boot
async function boot() {
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch {}
  }
  await load();
  renderInstall();
  setInterval(tick, 15e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); renderBackupStatus(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
