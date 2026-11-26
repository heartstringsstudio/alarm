// Checks every verse pack before it goes live.  Run:  node tools/check-packs.mjs
// Exits with an error if something would break the app; prints warnings for
// things that still work but should be fixed (like missing narration MP3s).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const errors = [], warnings = [];
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const exists = p => fs.existsSync(path.join(root, p));
const day = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

let index;
try { index = read('packs/index.json'); } catch (e) { console.error('✖ packs/index.json is missing or not valid JSON:', e.message); process.exit(1); }

const ranges = [];
for (const entry of index.packs || []) {
  const dir = `packs/${entry.id}`;
  let p;
  try { p = read(`${dir}/pack.json`); } catch (e) { errors.push(`${dir}/pack.json is missing or not valid JSON (${e.message})`); continue; }
  if (p.id !== entry.id) errors.push(`${dir}: "id" in pack.json (${p.id}) doesn't match the folder name`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.start || '')) errors.push(`${dir}: "start" must look like 2027-01-02`);
  if (entry.start !== p.start) errors.push(`${dir}: start date in index.json (${entry.start}) doesn't match pack.json (${p.start})`);
  if (!Array.isArray(p.verses) || !p.verses.length) { errors.push(`${dir}: no verses`); continue; }
  if (entry.days !== p.verses.length) errors.push(`${dir}: index.json says ${entry.days} days but the pack has ${p.verses.length} verses`);
  p.verses.forEach((v, i) => {
    if (!v.t || !v.r) errors.push(`${dir}: verse ${i + 1} needs both "t" (text) and "r" (reference)`);
    const nn = String(i + 1).padStart(2, '0');
    const audio = v.audio || (p.audio || 'audio/verse-{nn}.mp3').replace('{nn}', nn).replace('{n}', String(i + 1));
    if (!exists(`${dir}/${audio}`)) warnings.push(`${dir}: missing narration ${audio} (${v.r}) — the phone's built-in voice will read it instead`);
  });
  for (const [k, img] of Object.entries(p.images || {})) if (!exists(`${dir}/${img}`)) errors.push(`${dir}: image "${k}" not found at ${img}`);
  for (const x of p.seasons || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) errors.push(`${dir}: season "${x.theme}" has a bad date`);
    if (x.theme && !['advent', 'gaudete', 'christmas'].includes(x.theme)) errors.push(`${dir}: season theme "${x.theme}" must be advent, gaudete or christmas`);
  }
  if (p.wreath && (p.milestones || []).length < 5) errors.push(`${dir}: "wreath" needs 5 milestones (4 Advent Sundays + Christmas Day)`);
  p.verses.forEach((v, i) => { if (v.antiphon && !v.antiphon.t) errors.push(`${dir}: verse ${i + 1} antiphon needs a "t" (title)`); });
  for (const m of p.milestones || []) if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) errors.push(`${dir}: milestone "${m.label}" has a bad date`);
  if (p.start) ranges.push({ id: p.id, a: day(p.start), b: day(p.start) + (p.verses.length - 1) * 864e5 });
}
ranges.sort((x, y) => x.a - y.a);
for (let i = 1; i < ranges.length; i++) {
  const prev = ranges[i - 1], cur = ranges[i];
  if (cur.a <= prev.b) errors.push(`${cur.id} starts before ${prev.id} ends — the dates overlap`);
  else if (cur.a > prev.b + 864e5) warnings.push(`gap between ${prev.id} and ${cur.id} — ${prev.id} will repeat from the top to fill it`);
}
const last = ranges[ranges.length - 1];
if (last) {
  const daysLeft = Math.round((last.b - Date.now()) / 864e5);
  if (daysLeft < 10) warnings.push(`the newest pack (${last.id}) runs out in ${daysLeft} day(s) — time to make next month's pack`);
}

warnings.forEach(w => console.log('⚠', w));
errors.forEach(e => console.log('✖', e));
console.log(errors.length ? `\n${errors.length} problem(s) — fix before publishing.` : `\n✓ ${ranges.length} pack(s) OK${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
process.exit(errors.length ? 1 : 0);
