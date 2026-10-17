// Parser for Shree Ji Rate Service WhatsApp bulletins.
// Input: text copied or exported from WhatsApp (one message or many). Output: rows for scrap.json (Delhi
// non-ferrous, with our grade codes) and market.json (everything else), plus values dropped as implausible.
// Used by functions/api/ingest.js and by scripts/test_shreeji.mjs. Keep in step with the formats below:
//   iOS export/copy:     [16/10/26, 12:15:03 PM] ~ Name: text
//   Android export:      16/10/26, 12:15 pm - Name: text
//   A single message copied without a header is dated with `fallbackDate` (YYYY-MM-DD) and `fallbackTime`.

export const SRC = 'Shree Ji Rate Service (WhatsApp)';
export const SRC_URL = 'https://shreejirateservices.in';

const SP = '[\\s\\u202f]';
const HDR = new RegExp(
  `^(?:\\[(\\d{1,2})/(\\d{1,2})/(\\d{2,4}),${SP}(\\d{1,2}):(\\d\\d)(?::\\d\\d)?${SP}?([AaPp][Mm])?\\]${SP}(?:~${SP})?[^:\\n]+:${SP}` +
  `|(\\d{1,2})/(\\d{1,2})/(\\d{2,4}),${SP}(\\d{1,2}):(\\d\\d)${SP}?([AaPp][Mm])?${SP}-${SP}[^:\\n]+:${SP})`,
  'gm',
);

function toDate(d, m, y, hh, mm, ap) {
  let Y = Number(y); if (Y < 100) Y += 2000;
  let H = Number(hh);
  if (ap) { const p = ap.toLowerCase(); if (p === 'pm' && H < 12) H += 12; if (p === 'am' && H === 12) H = 0; }
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${Y}-${pad(m)}-${pad(d)}`, time: `${pad(H)}:${pad(mm)}` };
}

export function splitMessages(text, fallbackDate, fallbackTime = '12:00') {
  text = text.replace(/\r\n?/g, '\n');
  const heads = [...text.matchAll(HDR)];
  if (!heads.length) {
    // No WhatsApp headers (messages copied one by one): each bulletin carries its own date line, e.g. "*15-10-26*  THURSDAY*".
    const DATE = /^[*\s]*(\d{1,2})-(\d{1,2})-(\d{2,4})\b/gm;
    const marks = [...text.matchAll(DATE)];
    if (!marks.length) return [{ date: fallbackDate, time: fallbackTime, body: text }];
    const out = [];
    if (marks[0].index > 0 && /\S/.test(text.slice(0, marks[0].index))) out.push({ date: fallbackDate, time: fallbackTime, body: text.slice(0, marks[0].index) });
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      out.push({ ...toDate(mk[1], mk[2], mk[3], fallbackTime.split(':')[0], fallbackTime.split(':')[1]), time: fallbackTime, body: text.slice(mk.index, end) });
    });
    return out;
  }
  const msgs = [];
  heads.forEach((h, i) => {
    const g = h.slice(1);
    const dt = g[0] ? toDate(g[0], g[1], g[2], g[3], g[4], g[5]) : toDate(g[6], g[7], g[8], g[9], g[10], g[11]);
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    msgs.push({ ...dt, body: text.slice(h.index + h[0].length, end) });
  });
  return msgs.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

const clean = (s) => String(s || '').replace(/[*_⬆️🔻\u2060]/g, '').replace(/^[\s:\-•*]+|[\s:\-•*]+$/g, '').replace(/\s+/g, ' ').trim();
const tidy = (s) => String(s || '').replace(/[═+]+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();
// Same as Python str.title(): a letter after any non-letter starts a word.
const title = (s) => String(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const num = (s) => { const m = String(s).trim().replace(/,/g, '').match(/^₹?\s*(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

// Delhi grade names (normalised) -> our scrap codes.
const DELHI = {
  'armature(plant)': ['CU-ARM-PLANT', 'Copper', 'Armature (plant)'],
  'armature(bhatti)': ['CU-ARM-BHATTI', 'Copper', 'Armature (bhatti)'],
  'coppersuperd': ['CU-SUPERD', 'Copper', 'Super D'],
  'ccr': ['CU-CCR', 'Copper', 'CCR'],
  'castingrod': ['CU-CASTROD', 'Copper', 'Casting rod'],
  'ccrod': ['CU-CCROD', 'Copper', 'CC rod'],
  'brasspurja': ['BR-PURJA', 'Brass', 'Purja'],
  'brasshoney': ['BR-HONEY', 'Brass', 'Honey'],
  'brasschadari': ['BR-CHADARI', 'Brass', 'Chadari'],
  'aluminiumpurja': ['AL-PURJA', 'Aluminium', 'Purja (1% iron)'],
  'aluminiumwirescrap(r)': ['AL-WIRE', 'Aluminium', 'Wire scrap'],
  'aluminiumbartan(r)': ['AL-BARTAN', 'Aluminium', 'Bartan (utensils)'],
  'aluminiumsheet(r)': ['AL-SHEET', 'Aluminium', 'Sheet'],
  'aluminiumingot(v)': ['AL-INGOT-V', 'Aluminium', 'Ingot (virgin)'],
  'aluminiumrod(v)': ['AL-ROD-V', 'Aluminium', 'Rod (virgin)'],
  'aluminiumrod(local)': ['AL-ROD-LOCAL', 'Aluminium', 'Rod (local)'],
  'zinc-dross': ['ZN-DROSS', 'Zinc', 'Dross'],
  'zinc-tukadi': ['ZN-TUKADI', 'Zinc', 'Tukadi'],
  'zinc-pmi': ['ZN-PMI', 'Zinc', 'PMI ingot'],
  'zinc-hindustan': ['ZN-HZL', 'Zinc', 'Hindustan Zinc ingot'],
  '(soft)': ['PB-SOFT', 'Lead', 'Soft'],
  '(hard)': ['PB-HARD', 'Lead', 'Hard'],
  'lead-battery(black/white)': ['PB-BATT', 'Lead', 'Battery scrap (black/white)'],
  'gunmetallocal': ['GM-LOCAL', 'Gun metal', 'Local'],
  'gunmetalmix': ['GM-MIX', 'Gun metal', 'Mix'],
  'gunmetaljallandhar': ['GM-JALANDHAR', 'Gun metal', 'Jalandhar'],
  'nickel-russia': ['NI-RUSSIA', 'Nickel', 'Russian cathode'],
  'tin-indonesia': ['SN-INDONESIA', 'Tin', 'Indonesian ingot'],
};

export function parse(text, { fallbackDate, fallbackTime } = {}) {
  const msgs = splitMessages(text, fallbackDate, fallbackTime);
  const market = new Map(), scrap = new Map(), dropped = [], unknown = [];
  const FERR = [15000, 90000];

  const put = (m, section, mkt, item, unit, { price, buy, sell, range } = {}) => {
    const v = price != null ? price : buy;
    if (v == null || !isFinite(v)) return;
    if (range && (v < range[0] || v > range[1] || (sell != null && (sell < range[0] || sell > range[1])))) {
      dropped.push({ date: m.date, time: m.time, section, market: mkt, item, value: sell != null ? `${buy}/${sell}` : v, reason: `outside ${range[0]}–${range[1]}` });
      return;
    }
    if (section === 'Delhi non-ferrous') {
      const [group, name] = item.split('|');
      if (group === 'Copper' && /bras/i.test(name)) return; // brass lines misfiled under copper in some messages
      const key = name.toLowerCase().replace(/\s+/g, '').replace('armature-(', 'armature(');
      const g = DELHI[key];
      if (!g) { unknown.push(item); return; }
      const k = m.date + '|' + g[0];
      const prev = scrap.get(k);
      if (!prev || prev._t <= m.time) scrap.set(k, { date: m.date, city: 'Delhi', code: g[0], metal: g[1], grade: g[2], buy, sell, source: SRC, source_url: SRC_URL, _t: m.time });
      return;
    }
    let mk = tidy(mkt), it = tidy(item);
    if (section === 'TMT 12 mm') {
      const mm = mk.match(/^([A-Za-z ]+?)\s*\((.+)\)$/);
      if (mm) { mk = mm[1].trim(); it = title(mm[2].trim()).replace(/(\d)\s*Mm\b/g, '$1 mm'); }
    }
    if (section === 'Other city non-ferrous' && it.includes(' | ')) { const [c, rest] = it.split(' | '); it = `${c}: ${rest}`; }
    const k = [m.date, section, mk, it].join('|');
    const prev = market.get(k);
    if (!prev || prev.time <= m.time) market.set(k, { date: m.date, time: m.time, section, market: mk, item: it, unit, price: v, source: SRC, source_url: SRC_URL });
  };

  for (const m of msgs) {
    const body = m.body;
    const lines = body.split('\n').map((l) => l.replace(/\s+$/, ''));
    if (body.includes('DELHI SCRAP METAL RATES')) {
      let metal = null;
      for (const l of lines) {
        let r = l.match(/^🔸 \*(.+?)\*/);
        if (r) { metal = title(clean(r[1])); continue; }
        r = l.match(/^▪️\s*(.+?):\s*₹([\d.]+)(?:\([^)]*\))?\s*\/\s*₹([\d.]+)/);
        if (r) put(m, 'Delhi non-ferrous', 'Delhi', `${metal}|${clean(r[1])}`, '₹/kg', { buy: Number(r[2]), sell: Number(r[3]), range: [50, 8000] });
      }
      continue;
    }
    if (body.includes('STAINLESS STEEL') && body.includes('▪️ SS')) {
      let city = null;
      for (const l of lines) {
        let r = l.match(/^🔸 \*(.+?)\*/);
        if (r) { city = title(clean(r[1])); continue; }
        r = l.match(/^▪️\s*SS \{(.+?)\}\s*:\s*₹([\d.]+)/);
        if (r && city) put(m, 'Stainless steel scrap', city, 'SS ' + title(r[1]), '₹/kg + GST', { price: Number(r[2]), range: [20, 1000] });
      }
      continue;
    }
    if (body.includes('LME($/Ton)/MCX')) {
      for (const l of lines) {
        const r = l.match(/^([A-Z]+):([\d.]+)(?:\/([\d.]+))?/);
        if (!r) continue;
        const n = title(r[1]), a = Number(r[2]), b = r[3] != null ? Number(r[3]) : null;
        if (n === 'Gold' || n === 'Silver') {
          put(m, 'International', 'Spot', n, 'USD/oz', { price: a });
          if (b != null) put(m, 'MCX', 'MCX', n, n === 'Gold' ? '₹/10 g' : '₹/kg', { price: b });
        } else if (n === 'Crude') {
          put(m, 'International', 'Spot', 'Crude oil', 'USD/bbl', { price: a });
          if (b != null) put(m, 'MCX', 'MCX', 'Crude oil', '₹/bbl', { price: b });
        } else {
          put(m, 'International', 'LME', n, 'USD/t', { price: a, range: [1000, 100000] });
          if (b != null) put(m, 'MCX', 'MCX', n, '₹/kg', { price: b, range: [50, 10000] });
        }
      }
      continue;
    }
    if (body.includes('KOLKATTA METAL MARKET') || body.includes('AHEMDABAD COPPER SCRAP')) {
      const section = 'Other city non-ferrous';
      let city = null, sub = null;
      for (const l of lines) {
        const s = l.trim();
        let r = s.match(/^\*(.+?)\*$/);
        if (r) {
          const h = clean(r[1]);
          if (h.includes('KOLKATTA')) { city = 'Kolkata'; continue; }
          const c = ['AHEMDABAD', 'BHAVNAGAR', 'JAMNAGAR', 'HYDERABAD'].find((x) => h.startsWith(x));
          if (c) { city = title(c.replace('AHEMDABAD', 'AHMEDABAD')); sub = title(h.slice(c.length).trim()); continue; }
          if (city === 'Kolkata') sub = title(h);
          const z = h.match(/^(ZINC MAZAK MATI SCRAP)\s+(\d+)/);
          if (z) put(m, section, 'Kolkata', 'Zinc mazak mati scrap', '₹/kg', { price: Number(z[2]), range: [50, 3000] });
          continue;
        }
        r = s.match(/^([A-Za-z][A-Za-z .()]+?)\s+(\d+(?:\.\d+)?)\+?\s*(\(.*\)|\*.*)?$/);
        if (r && city && !s.includes('SS')) {
          const item = title(clean(r[1]));
          const note = title((r[3] || '').replace(/[*(){}]/g, '').trim());
          const label = (sub ? sub + ' | ' : '') + item + (note ? ` (${note})` : '');
          put(m, section, city, label, '₹/kg', { price: Number(r[2]), range: [50, 3000] });
        }
      }
      continue;
    }
    if (!body.includes('=')) continue;
    let section = null, pending = '', wcity = null;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      const u = l.toUpperCase();
      const S = [['INGOT PRICE', 'Ingot'], ['BILLET PRICE', 'Billet'], ['SCRAP PRICE', 'Melting scrap'], ['HMS PRICE', 'HMS'],
        ['FOUNDRY GRADE PRICE', 'Pig iron (foundry grade)'], ['STEEL GRADE PRICE', 'Pig iron (steel grade)'], ['CAST IRON PRICE', 'Cast iron'],
        ['SPONGE PRICE', 'Sponge iron'], ['FINISH GOODS', 'Finished steel (Mandi Gobindgarh)'], ['TMT 12MM PRICES', 'TMT 12 mm'],
        ['HR COIL PRICE', 'HR coil'], ['CR COIL PRICE', 'CR coil'], ['METAL PRICES', 'MCX'], ['CURRENCIES', 'FX']].find(([k]) => u.includes(k));
      if (S) { section = S[1]; continue; }
      if (u.replace(/\*/g, '') === 'PELLET') { section = 'Pellet'; continue; }
      const w = u.replace(/[* ]/g, '');
      if (['KOLKATTA', 'DURGAPUR', 'RAIPUR', 'GUJRATI'].includes(w)) { section = 'Wire rod'; wcity = title(w.replace('KOLKATTA', 'KOLKATA')); continue; }
      if (!section || u.startsWith('*[SHREE') || u.includes('WILL NOT')) continue;
      if (!l.includes('=')) { pending = (pending + ' ' + l).trim(); continue; }
      const eq = l.indexOf('=');
      const name = clean((pending + ' ' + l.slice(0, eq)).trim()); pending = '';
      const v = num(l.slice(eq + 1));
      if (v == null) continue;
      const U = name.toUpperCase();
      if (section === 'Wire rod') { if (U.startsWith('5.5')) put(m, 'Wire rod (5.5 mm)', wcity, 'Wire rod 5.5 mm', '₹/t', { price: v, range: FERR }); continue; }
      if (section === 'Melting scrap') {
        if (['OLD SCRAP', 'MELTING SCRAP', 'CRC SCRAP', 'END CUTTING'].includes(U)) put(m, 'Mandi Gobindgarh', 'Mandi Gobindgarh', title(name), '₹/t', { price: v, range: FERR });
        else put(m, 'Melting scrap', title(name), 'Melting scrap', '₹/t', { price: v, range: FERR });
        continue;
      }
      if (section === 'Ingot' && U === 'MANDI GOBINDGARH') put(m, 'Mandi Gobindgarh', 'Mandi Gobindgarh', 'MS ingot', '₹/t', { price: v, range: FERR });
      if (section === 'Billet' && U === 'MANDI GOBINDGARH') put(m, 'Mandi Gobindgarh', 'Mandi Gobindgarh', 'MS billet', '₹/t', { price: v, range: FERR });
      if (section === 'MCX') {
        const n = title(name);
        const units = { Gold: '₹/10 g', Silver: '₹/kg', Crudeoil: '₹/bbl', Copper: '₹/kg', Aluminium: '₹/kg', Naturalgas: '₹/mmBtu', Zinc: '₹/kg', Lead: '₹/kg', Nickel: '₹/kg' };
        put(m, 'MCX', 'MCX', { Crudeoil: 'Crude oil', Naturalgas: 'Natural gas' }[n] || n, units[n] || '', { price: v });
        continue;
      }
      if (section === 'FX') { put(m, 'FX', 'RBI-style reference', title(name), '₹ per unit', { price: v, range: [10, 500] }); continue; }
      if (section === 'TMT 12 mm') { put(m, section, name.replace(/[\u2060*]/g, '').trim(), 'TMT 12 mm', '₹/t', { price: v, range: FERR }); continue; }
      if (section === 'Finished steel (Mandi Gobindgarh)') { put(m, section, 'Mandi Gobindgarh', name, '₹/t', { price: v, range: FERR }); continue; }
      if (section.startsWith('Pig iron')) {
        const mk = title(name.replace(/\s*\(?(FOUNDRY|STEEL)\s*GRADE\)?/gi, '').replace(/^[\s()]+|[\s()]+$/g, ''));
        const it = section.includes('foundry') ? 'Foundry grade' : 'Steel grade';
        put(m, section, mk, it, '₹/t', { price: v, range: FERR });
        continue;
      }
      if (section === 'Cast iron') { put(m, section, title(name), 'Cast iron', '₹/t', { price: v, range: FERR }); continue; }
      if (section === 'Sponge iron' || section === 'Pellet') { put(m, section, title(name), section, '₹/t', { price: v, range: [10000, 60000] }); continue; }
      put(m, section, title(name), section, '₹/t', { price: v, range: FERR });
    }
  }
  const scrapRows = [...scrap.values()].map(({ _t, ...r }) => r);
  // Item fixes for display consistency.
  const marketRows = [...market.values()].map((r) => (r.section === 'MCX' && r.item === 'Gold' ? { ...r, unit: '₹/10 g' } : r));
  return { scrap: scrapRows, market: marketRows, dropped, unknown: [...new Set(unknown)], messages: msgs.length };
}
