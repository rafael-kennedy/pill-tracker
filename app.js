import * as db from './db.js';
import { toCSV, fromCSV } from './csv.js';
import { ago, stamp } from './time.js';

const $ = (s) => document.querySelector(s);
const FRESH_MS = 60 * 60e3;
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

function pillCard(p, now) {
  const history = lastDoses(p.id, 10);
  const last = history[0];
  const agoText = last ? `${ago(last.takenAt, now)} · ${stamp(last.takenAt, now)}` : 'Not taken yet';
  const fresh = last && now - last.takenAt < FRESH_MS;
  return el('li', { class: 'pill', 'data-id': p.id },
    el('div', { class: 'pill-head' },
      el('div', { class: 'pill-info' },
        el('button', { class: 'pill-name', onclick: () => openPillDialog(p), 'aria-label': `Edit ${p.name}` }, p.name),
        el('div', { class: 'pill-ago' + (fresh ? ' fresh' : ''), 'data-taken': last ? last.takenAt : '' }, agoText)),
      el('button', { class: 'primary take-btn', onclick: () => take(p) }, 'Took it')),
    p.instructions ? el('p', { class: 'pill-instr' }, p.instructions) : null,
    history.length ? el('details', {},
      el('summary', {}, 'History'),
      el('ul', { class: 'history' }, ...history.map((d) =>
        el('li', {}, el('span', {}, stamp(d.takenAt, now)),
          el('button', { onclick: () => removeDose(d), 'aria-label': 'Remove this entry' }, 'Remove'))))) : null);
}

async function take(p) {
  const dose = { id: db.uid(), pillId: p.id, takenAt: Date.now() };
  await db.putDose(dose);
  state.doses.push(dose);
  render();
  toast(`Logged ${p.name}`, 'Undo', async () => {
    await db.deleteDose(dose.id);
    state.doses = state.doses.filter((d) => d.id !== dose.id);
    render();
  });
}

async function removeDose(d) {
  await db.deleteDose(d.id);
  state.doses = state.doses.filter((x) => x.id !== d.id);
  render();
  toast('Entry removed', 'Undo', async () => { await db.putDose(d); state.doses.push(d); render(); });
}

// Refresh relative times every 30s without rebuilding the DOM (keeps <details> open).
function tick() {
  const now = Date.now();
  for (const n of document.querySelectorAll('.pill-ago[data-taken]')) {
    const t = Number(n.dataset.taken);
    if (!t) continue;
    n.textContent = `${ago(t, now)} · ${stamp(t, now)}`;
    n.classList.toggle('fresh', now - t < FRESH_MS);
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
  if (!p) f.name.focus();
}

$('#addBtn').addEventListener('click', () => openPillDialog(null));
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
  status.textContent = last ? `Last backup ${ago(last)}` : hasData ? 'Not backed up yet' : '';
  const stale = hasData && (!last || Date.now() - last > BACKUP_NAG_DAYS * 864e5);
  banner.hidden = !stale;
  if (stale) {
    banner.replaceChildren(
      last ? `Last CSV backup was ${ago(last)}. ` : 'No CSV backup yet. ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); exportCSV(); } }, 'Back up now'));
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
  setInterval(tick, 30e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); renderBackupStatus(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
