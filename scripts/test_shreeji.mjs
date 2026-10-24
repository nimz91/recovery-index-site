// Checks lib/shreeji.js against a WhatsApp export and the committed data files.
// Usage: node scripts/test_shreeji.mjs <chat.txt>
import { readFileSync } from 'node:fs';
import { parse } from '../lib/shreeji.js';
const text = readFileSync(process.argv[2], 'utf8');
const out = parse(text, { fallbackDate: '2026-10-16' });
const scrapAll = JSON.parse(readFileSync('public/data/scrap.json', 'utf8')).filter((r) => r.source.startsWith('Shree Ji'));
const marketAll = JSON.parse(readFileSync('public/data/market.json', 'utf8'));
let bad = 0;
const inExport = new Set([...out.scrap, ...out.market].map((r) => r.date));
const ks = (r) => r.date + '|' + r.code, km = (r) => [r.date, r.section, r.market, r.item].join('|');
const scrap = scrapAll.filter((r) => inExport.has(r.date)), market = marketAll.filter((r) => inExport.has(r.date) && r.section !== 'Delhi more grades');
const S = new Map(out.scrap.map((r) => [ks(r), r])), M = new Map(out.market.map((r) => [km(r), r]));
for (const r of scrap) { const o = S.get(ks(r)); if (!o || o.buy !== r.buy || o.sell !== r.sell) { bad++; console.log('scrap mismatch', ks(r), r.buy, r.sell, o && o.buy, o && o.sell); } }
for (const r of market) { const o = M.get(km(r)); if (!o || o.price !== r.price) { bad++; console.log('market mismatch', km(r), r.price, o && o.price); } }
console.log(`messages ${out.messages}, scrap ${out.scrap.length}/${scrap.length}, market ${out.market.length}/${market.length}, dropped ${out.dropped.length}, unknown ${out.unknown.join('; ') || 'none'}, mismatches ${bad}`);
// Headerless single message
const one = text.split('\n').slice(10, 60).join('\n').replace(/^\[.*?\] ~[\s\u202f][^:]+: /gm, '');
const o1 = parse(one, { fallbackDate: '2026-10-17', fallbackTime: '11:00' });
console.log('headerless:', o1.messages, 'msgs,', o1.scrap.length, 'Delhi rows, date', o1.scrap[0] && o1.scrap[0].date);
if (!o1.scrap.length || o1.scrap[0].date !== '2026-10-15') bad++;
process.exit(bad ? 1 : 0);
