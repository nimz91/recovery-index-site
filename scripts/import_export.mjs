// Imports a Shree Ji WhatsApp chat export straight into public/data (scrap.json + market.json).
// Usage: node scripts/import_export.mjs <_chat.txt> [--dry]
// Rows already present (same date + code / same date + section + market + item) are kept as they are.
// A Delhi grade whose mid jumps more than JUMP vs its previous rate is treated as a likely typo and left out
// (it is reported, with the previous and new values, so it can be added by hand if it is real).
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../lib/shreeji.js';
const JUMP = 0.25;
const [file, flag] = process.argv.slice(2);
const out = parse(readFileSync(file, 'utf8'), { fallbackDate: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) });
const S = JSON.parse(readFileSync('public/data/scrap.json', 'utf8'));
const M = JSON.parse(readFileSync('public/data/market.json', 'utf8'));
const mid = (r) => (Number(r.buy) + Number(r.sell)) / 2;
const hasS = new Set(S.map((r) => r.date + '|' + r.code));
const hasM = new Set(M.map((r) => [r.date, r.section, r.market, r.item].join('|')));
const held = [], addS = [];
const all = [...S];
for (const r of out.scrap.sort((a, b) => (a.date < b.date ? -1 : 1))) {
  if (hasS.has(r.date + '|' + r.code)) continue;
  const prev = all.filter((x) => x.code === r.code && x.date < r.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (prev && Math.abs(mid(r) / mid(prev) - 1) > JUMP) { held.push({ code: r.code, date: r.date, from: `${prev.buy}/${prev.sell} (${prev.date})`, to: `${r.buy}/${r.sell}` }); continue; }
  addS.push(r); all.push(r);
}
const addM = out.market.filter((r) => !hasM.has([r.date, r.section, r.market, r.item].join('|')));
console.log(JSON.stringify({ messages: out.messages, scrap_added: addS.length, market_added: addM.length, held_as_typo: held, dropped: out.dropped.length, unknown: out.unknown }, null, 1));
if (flag !== '--dry') {
  writeFileSync('public/data/scrap.json', JSON.stringify([...S, ...addS].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), null, 1));
  const key = (r) => [r.section, r.market, r.item, r.date].join('|');
  writeFileSync('public/data/market.json', JSON.stringify([...M, ...addM].sort((a, b) => (key(a) < key(b) ? -1 : 1)), null, 1));
}
