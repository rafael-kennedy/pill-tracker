// CSV backup format. One file holds pills and doses.
// Columns: record,id,pill_id,name,instructions,taken_at,created_at
//   record = "pill": id, name, instructions, created_at
//   record = "dose": id, pill_id, taken_at (ISO 8601, UTC)
export const HEADER = ['record', 'id', 'pill_id', 'name', 'instructions', 'taken_at', 'created_at'];

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV({ pills, doses }) {
  const iso = (t) => (t ? new Date(t).toISOString() : '');
  const lines = [HEADER.join(',')];
  for (const p of pills) {
    lines.push(['pill', p.id, '', p.name, p.instructions || '', '', iso(p.createdAt)].map(esc).join(','));
  }
  const sorted = [...doses].sort((a, b) => a.takenAt - b.takenAt);
  for (const d of sorted) {
    lines.push(['dose', d.id, d.pillId, '', '', iso(d.takenAt), ''].map(esc).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// RFC 4180 parser: quoted fields, escaped quotes, embedded newlines.
export function parseRows(text) {
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ''));
}

export function fromCSV(text) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error('The file is empty.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  for (const h of ['record', 'id']) if (col(h) < 0) throw new Error(`Missing "${h}" column.`);
  const get = (r, name) => (col(name) >= 0 ? (r[col(name)] ?? '') : '');
  const time = (s, line) => {
    if (!s) return null;
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`Bad timestamp "${s}" on line ${line}.`);
    return t;
  };
  const pills = [], doses = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const kind = get(r, 'record').trim().toLowerCase();
    const id = get(r, 'id').trim();
    if (!id) throw new Error(`Missing id on line ${line}.`);
    if (kind === 'pill') {
      const name = get(r, 'name').trim();
      if (!name) throw new Error(`Missing pill name on line ${line}.`);
      pills.push({ id, name, instructions: get(r, 'instructions'), createdAt: time(get(r, 'created_at'), line) ?? Date.now() });
    } else if (kind === 'dose') {
      const takenAt = time(get(r, 'taken_at'), line);
      const pillId = get(r, 'pill_id').trim();
      if (!takenAt || !pillId) throw new Error(`Dose on line ${line} needs pill_id and taken_at.`);
      doses.push({ id, pillId, takenAt });
    } else {
      throw new Error(`Unknown record type "${kind}" on line ${line}.`);
    }
  });
  const known = new Set(pills.map((p) => p.id));
  const orphans = doses.filter((d) => !known.has(d.pillId)).length;
  return { pills, doses, orphans };
}
