// Copies rates pasted through /ingest (kept in KV, served at /api/market) into the committed data files,
// so they stay on the site permanently. Run by .github/workflows/sync-pasted-rates.yml.
// Usage: node scripts/sync_pasted_rates.mjs [base_url]
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.argv[2] || 'https://prices.therecoveryindex.in';
const res = await fetch(base + '/api/market', { headers: { 'Cache-Control': 'no-cache' } });
if (!res.ok) throw new Error('/api/market ' + res.status);
const { scrap = [], market = [] } = await res.json();
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const S = read('public/data/scrap.json'), M = read('public/data/market.json');
const hasS = new Set(S.map((r) => r.date + '|' + r.code));
const hasM = new Set(M.map((r) => [r.date, r.section, r.market, r.item].join('|')));
const addS = scrap.filter((r) => !hasS.has(r.date + '|' + r.code));
const addM = market.filter((r) => !hasM.has([r.date, r.section, r.market, r.item].join('|')));
if (addS.length) writeFileSync('public/data/scrap.json', JSON.stringify([...S, ...addS].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), null, 1));
if (addM.length) writeFileSync('public/data/market.json', JSON.stringify([...M, ...addM].sort((a, b) => [a.section, a.market, a.item, a.date].join('|') < [b.section, b.market, b.item, b.date].join('|') ? -1 : 1), null, 1));
console.log(`added ${addS.length} scrap rows, ${addM.length} market rows`);
