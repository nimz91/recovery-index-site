/* The Recovery Index — ITAD lot valuation engine (pure functions, no DOM).
   Shared by /sell/, /admin/ and the API (functions/_lib/engine.js) so the client and server price identically. */
(function (root) {
'use strict';

/* ---------- Price book ----------
   ref = Grade-A refurbished retail price in India (INR, Oct 2026) for the base config.
   cpu = base CPU tier the ref price assumes. ram/ssd = base config (GB).
   cat: lt = laptop, mws = mobile workstation, dws = desktop workstation, mac = Apple laptop
   kg  = shipping weight used for the scrap floor. */
const BOOK = [
  // Dell
  {id:'dell-prec-7560', brand:'Dell', name:'Precision 7560', cat:'mws', yr:2021, cpu:'i7', ram:32, ssd:512, ref:80000, kg:2.6, re:/PRECISION\s*7560|\bP\s*7560\b/},
  {id:'dell-prec-7550', brand:'Dell', name:'Precision 7550', cat:'mws', yr:2020, cpu:'i7', ram:32, ssd:512, ref:68000, kg:2.6, re:/PRECISION\s*7550|\bP\s*7550\b/},
  {id:'dell-xps-9310',  brand:'Dell', name:'XPS 13 9310', cat:'lt', yr:2020, cpu:'i7', ram:16, ssd:512, ref:52000, kg:1.3, re:/9310/},
  {id:'dell-xps-9380',  brand:'Dell', name:'XPS 13 9380', cat:'lt', yr:2019, cpu:'i7', ram:16, ssd:512, ref:34000, kg:1.3, re:/9380/},
  {id:'dell-lat-9420',  brand:'Dell', name:'Latitude 9420', cat:'lt', yr:2021, cpu:'i7', ram:16, ssd:512, ref:60000, kg:1.5, re:/9420/},
  {id:'dell-lat-7520',  brand:'Dell', name:'Latitude 7520', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:48000, kg:1.6, re:/\b7520\b/},
  {id:'dell-lat-7420',  brand:'Dell', name:'Latitude 7420', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:45000, kg:1.4, re:/\b7420\b/},
  {id:'dell-lat-5540',  brand:'Dell', name:'Latitude 5540', cat:'lt', yr:2023, cpu:'i5', ram:16, ssd:512, ref:60000, kg:1.7, re:/\b5540\b/},
  {id:'dell-lat-5530',  brand:'Dell', name:'Latitude 5530', cat:'lt', yr:2022, cpu:'i5', ram:16, ssd:512, ref:50000, kg:1.7, re:/\b5530\b/},
  {id:'dell-lat-5430',  brand:'Dell', name:'Latitude 5430', cat:'lt', yr:2022, cpu:'i5', ram:16, ssd:512, ref:46000, kg:1.5, re:/\b5430\b/},
  {id:'dell-lat-5520',  brand:'Dell', name:'Latitude 5520', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:44000, kg:1.8, re:/\b5520\b/},
  {id:'dell-lat-5420',  brand:'Dell', name:'Latitude 5420', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:37000, kg:1.5, re:/\b5420\b/},
  {id:'dell-lat-5510',  brand:'Dell', name:'Latitude 5510', cat:'lt', yr:2020, cpu:'i5', ram:16, ssd:512, ref:34000, kg:1.8, re:/\b5510\b/},
  {id:'dell-lat-5401',  brand:'Dell', name:'Latitude 5401', cat:'lt', yr:2019, cpu:'i7', ram:16, ssd:512, ref:32000, kg:1.6, re:/\b5401\b/},
  {id:'dell-lat-5591',  brand:'Dell', name:'Latitude 5591', cat:'lt', yr:2018, cpu:'i7', ram:16, ssd:512, ref:29000, kg:2.0, re:/\b5591\b/},
  {id:'dell-lat-3520',  brand:'Dell', name:'Latitude 3520', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:32000, kg:1.8, re:/\b3520\b/},
  {id:'dell-lat-3420',  brand:'Dell', name:'Latitude 3420', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:33000, kg:1.6, re:/\b3420\b/},
  {id:'dell-lat-3410',  brand:'Dell', name:'Latitude 3410', cat:'lt', yr:2020, cpu:'i5', ram:16, ssd:512, ref:26000, kg:1.7, re:/\b3410\b/},
  {id:'dell-lat-3400',  brand:'Dell', name:'Latitude 3400', cat:'lt', yr:2019, cpu:'i5', ram:16, ssd:512, ref:22000, kg:1.7, re:/\b3400\b/},
  // HP
  {id:'hp-zb15-g7',  brand:'HP', name:'ZBook 15 G7 / Fury 15 G7', cat:'mws', yr:2020, cpu:'i7', ram:32, ssd:512, ref:62000, kg:2.4, re:/ZBOOK.*15\s*G7|FURY\s*15\s*G7/},
  {id:'hp-zb15-g6',  brand:'HP', name:'ZBook 15 G6', cat:'mws', yr:2019, cpu:'i7', ram:32, ssd:512, ref:50000, kg:2.6, re:/ZBOOK.*15\s*G6(?!U)|ZBOOK\s*15\s*G6/},
  {id:'hp-zb15u-g6', brand:'HP', name:'ZBook 15u G6', cat:'lt', yr:2019, cpu:'i7', ram:16, ssd:512, ref:32000, kg:1.8, re:/15U\s*G6/},
  {id:'hp-eb-850g6', brand:'HP', name:'EliteBook 850 G6', cat:'lt', yr:2019, cpu:'i5', ram:16, ssd:512, ref:28000, kg:1.8, re:/850\s*G6/},
  {id:'hp-eb-850g5', brand:'HP', name:'EliteBook 850 G5', cat:'lt', yr:2018, cpu:'i5', ram:16, ssd:512, ref:24000, kg:1.8, re:/850\s*G5/},
  {id:'hp-eb-840g6', brand:'HP', name:'EliteBook 840 G6', cat:'lt', yr:2019, cpu:'i5', ram:16, ssd:512, ref:27000, kg:1.5, re:/840\s*G6/},
  {id:'hp-eb-830g6', brand:'HP', name:'EliteBook 830 G6', cat:'lt', yr:2019, cpu:'i5', ram:16, ssd:512, ref:26000, kg:1.3, re:/830\s*G6/},
  {id:'hp-pb-450g8', brand:'HP', name:'ProBook 450 G8', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:33000, kg:1.8, re:/450\s*G8/},
  {id:'hp-pb-440g8', brand:'HP', name:'ProBook 440 G8', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:32000, kg:1.4, re:/440\s*G8/},
  {id:'hp-z440',     brand:'HP', name:'Z440 Workstation', cat:'dws', yr:2016, cpu:'xeon', ram:32, ssd:512, ref:22000, kg:13, re:/Z440/},
  {id:'hp-450-old',  brand:'HP', name:'HP 450 (legacy)', cat:'lt', yr:2013, cpu:'i3', ram:8, ssd:256, ref:7000, kg:2.3, re:/450\s*NOTE\s*BOOK|HP\s*450\b(?!\s*G)/},
  // Lenovo
  {id:'len-tb13s-g2', brand:'Lenovo', name:'ThinkBook 13s G2', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:36000, kg:1.3, re:/THINKBOOK\s*13S\s*G2|13S\s*G2/},
  {id:'len-l14',      brand:'Lenovo', name:'ThinkPad L14', cat:'lt', yr:2020, cpu:'i5', ram:16, ssd:256, ref:30000, kg:1.6, re:/\bL14\b/},
  {id:'len-l490',     brand:'Lenovo', name:'ThinkPad L490', cat:'lt', yr:2019, cpu:'i5', ram:16, ssd:256, ref:22000, kg:1.7, re:/\bL490\b/},
  {id:'len-t580',     brand:'Lenovo', name:'ThinkPad T580', cat:'lt', yr:2018, cpu:'i5', ram:16, ssd:512, ref:24000, kg:2.0, re:/\bT580\b/},
  {id:'len-t14-g2',   brand:'Lenovo', name:'ThinkPad T14 Gen 2', cat:'lt', yr:2021, cpu:'i5', ram:16, ssd:512, ref:40000, kg:1.5, re:/T14\s*(GEN\s*)?G?2/},
  {id:'len-t430',     brand:'Lenovo', name:'ThinkPad T430', cat:'lt', yr:2012, cpu:'i5', ram:8, ssd:256, ref:8000, kg:2.3, re:/\bT430\b/},
  // Fujitsu
  {id:'fuj-m770',     brand:'Fujitsu', name:'Celsius M770', cat:'dws', yr:2018, cpu:'xeon', ram:32, ssd:512, ref:35000, kg:14, re:/CELSIUS\s*M770/},
  {id:'fuj-celsius-h',brand:'Fujitsu', name:'Celsius H-series', cat:'mws', yr:2016, cpu:'i7', ram:16, ssd:512, ref:14000, kg:3.0, re:/CELSIUS\s*H/},
  // Apple — RAM/SSD soldered; model number (A-number) identifies the machine
  {id:'mac-a2780', brand:'Apple', name:'MacBook Pro 16" M2 Pro (2023)', cat:'mac', yr:2023, cpu:'m2pro', ram:16, ssd:512, ref:140000, kg:2.2, re:/A2780/},
  {id:'mac-a2779', brand:'Apple', name:'MacBook Pro 14" M2 Pro (2023)', cat:'mac', yr:2023, cpu:'m2pro', ram:16, ssd:512, ref:120000, kg:1.6, re:/A2779/},
  {id:'mac-a2485', brand:'Apple', name:'MacBook Pro 16" M1 Pro (2021)', cat:'mac', yr:2021, cpu:'m1pro', ram:16, ssd:512, ref:110000, kg:2.1, re:/A2485/},
  {id:'mac-a2442', brand:'Apple', name:'MacBook Pro 14" M1 Pro (2021)', cat:'mac', yr:2021, cpu:'m1pro', ram:16, ssd:512, ref:92000, kg:1.6, re:/A2442/},
  {id:'mac-a2338', brand:'Apple', name:'MacBook Pro 13" M1/M2 (2020–22)', cat:'mac', yr:2020, cpu:'m1', ram:8, ssd:256, ref:55000, kg:1.4, re:/A2338/},
  {id:'mac-a2337', brand:'Apple', name:'MacBook Air 13" M1 (2020)', cat:'mac', yr:2020, cpu:'m1', ram:8, ssd:256, ref:45000, kg:1.3, re:/A2337/},
  {id:'mac-a2681', brand:'Apple', name:'MacBook Air 13" M2 (2022)', cat:'mac', yr:2022, cpu:'m2', ram:8, ssd:256, ref:62000, kg:1.2, re:/A2681/},
  {id:'mac-a2251', brand:'Apple', name:'MacBook Pro 13" Intel (2020)', cat:'mac', yr:2020, cpu:'i5', ram:16, ssd:512, ref:42000, kg:1.4, re:/A2251/},
  {id:'mac-a2289', brand:'Apple', name:'MacBook Pro 13" Intel 2-port (2020)', cat:'mac', yr:2020, cpu:'i5', ram:8, ssd:256, ref:34000, kg:1.4, re:/A2289/},
  {id:'mac-a2141', brand:'Apple', name:'MacBook Pro 16" Intel (2019)', cat:'mac', yr:2019, cpu:'i7', ram:16, ssd:512, ref:60000, kg:2.0, re:/A2141/},
  {id:'mac-a1990', brand:'Apple', name:'MacBook Pro 15" Intel (2018–19)', cat:'mac', yr:2018, cpu:'i7', ram:16, ssd:256, ref:42000, kg:1.8, re:/A1990/},
  {id:'mac-a1989', brand:'Apple', name:'MacBook Pro 13" Intel (2018–19)', cat:'mac', yr:2018, cpu:'i5', ram:8, ssd:256, ref:30000, kg:1.4, re:/A1989|A2159/},
  {id:'mac-a1707', brand:'Apple', name:'MacBook Pro 15" Intel (2016–17)', cat:'mac', yr:2016, cpu:'i7', ram:16, ssd:256, ref:30000, kg:1.8, re:/A1707/},
];

/* Fallback when a model isn't in the book: value by family × CPU generation */
const FAMILY = [
  {re:/PRECISION|ZBOOK|CELSIUS|THINKPAD\s*P\d/, cat:'mws', mult:1.6},
  {re:/OPTIPLEX|PRODESK|ELITEDESK|THINKCENTRE|VOSTRO\s*\d{4}\s*(DT|MT|SFF)/, cat:'desk', mult:0.55},
  {re:/LATITUDE|ELITEBOOK|PROBOOK|THINKPAD|THINKBOOK|SURFACE|XPS/, cat:'lt', mult:1.0},
  {re:/INSPIRON|VOSTRO|IDEAPAD|PAVILION|ASPIRE|VIVOBOOK|NOTEBOOK/, cat:'lt', mult:0.85},
  {re:/MACBOOK|IMAC/, cat:'mac', mult:1.4},
];
const GEN_VALUE = {4:7000,5:9000,6:12000,7:16000,8:22000,9:25000,10:28000,11:34000,12:44000,13:54000,14:62000};

const DEFAULTS = {
  channel: {lt:0.55, mws:0.52, dws:0.45, mac:0.58, desk:0.45}, // bulk B2B realisation as share of refurb retail
  cpuMult: {i3:0.85, i5:1.0, i7:1.10, i9:1.18},
  ramPer8: 1000, ssdPer256: 1200,
  grade: {A:1.0, B:0.90, C:0.75, D:0.60},
  partsFactor: {lt:0.28, mws:0.30, dws:0.35, mac:0.35, desk:0.30},
  lockFactor: 0.45, appleLockFactor: 0.25,
  pWorkUntested: 0.70,
  repair: { // INR deduction [windows/desktop, apple]
    screen_broken:[6500,26000], screen_blemish:[2500,9000], keyboard:[1500,6000], keycap_wear:[400,1500],
    ram_missing:[2200,0], battery_missing:[2000,7000], hinge:[1500,5000], storage_missing:[2200,0], body_damage:[1500,4000]
  },
  scrapPerKg: {lt:220, mws:220, mac:300, dws:70, desk:60},
  wipePerUnit: 150, logisticsPerUnit: 180,
  photoBoost: 0.05,
};

const DEFECT_LABEL = {
  screen_broken:'Screen damaged', screen_blemish:'Dot/patch on screen', keyboard:'Keyboard damage', keycap_wear:'Key wear',
  ram_missing:'RAM missing', battery_missing:'No battery', hinge:'Hinge damage', storage_missing:'Drive missing', body_damage:'Body damage'
};
const STATUS_LABEL = {WORKING:'Working', UNTESTED:'Not tested', NO_DISPLAY:'No display', LOCKED:'BIOS/iCloud lock', DEAD:'Dead', SCRAP:'Scrap'};

/* ---------- Column mapping ---------- */
const COLS = [
  ['serial', /serial/i], ['type', /asset\s*type|category|device\s*type/i], ['brand', /manufacturer|brand|make|oem/i],
  ['model', /^\s*model\s*$|model\s*(name|no)?/i], ['cpu', /processor|cpu/i], ['ramssd', /ram\s*\/\s*ssd/i],
  ['ram', /^\s*ram|memory/i], ['storage', /disk|ssd|hdd|storage/i], ['config', /config|spec/i], ['power', /on\s*\/\s*off|power/i],
  ['functional', /functional|working|test/i], ['physical', /physical|cosmetic|grade/i], ['remark', /remark|comment|note|observation|defect/i],
  ['age', /age\s*\(/i], ['date', /delivery|purchase|invoice\s*date|acquired/i], ['qty', /^\s*(qty|quantity|count of|units)\s*$/i],
];
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const txt = rows[i].filter(c => typeof c === 'string' && /[a-z]/i.test(c)).length;
    if (txt >= 3 && rows[i].some(c => /model|serial|brand|manufacturer/i.test(String(c)))) return i;
  }
  return 0;
}
function mapColumns(header) {
  const map = {}; const used = new Set();
  // ramssd must win before ram/storage
  for (const [key, re] of COLS) {
    header.forEach((h, idx) => {
      const s = String(h || '');
      if (!s || used.has(idx)) return;
      if (key === 'ram' && /ssd/i.test(s)) return;
      if (key === 'storage' && /ram/i.test(s)) return;
      if (key === 'type' && /sub/i.test(s)) return;
      if (re.test(s)) { (map[key] = map[key] || []).push(idx); used.add(idx); }
    });
  }
  map._unmapped = header.map((h, i) => i).filter(i => !used.has(i));
  return map;
}

/* ---------- Normalisation helpers ---------- */
const up = v => String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim();
function normBrand(s) {
  if (/APPLE|MAC\s*BOOK|MACBOOK|IMAC/.test(s) || /\bA\d{4}\b/.test(s)) return 'Apple';
  if (/HEWLETT|\bHP\b|ZBOOK|ELITEBOOK|PROBOOK|^HP|Z440/.test(s)) return 'HP';
  if (/DELL|LATITUDE|PRECISION|XPS|INSPIRON|VOSTRO|OPTIPLEX/.test(s)) return 'Dell';
  if (/LENOVO|THINKPAD|THINKBOOK|IDEAPAD|THINKCENTRE/.test(s)) return 'Lenovo';
  if (/FUJITSU|CELSIUS|LIFEBOOK/.test(s)) return 'Fujitsu';
  if (/ASUS/.test(s)) return 'Asus';
  if (/ACER/.test(s)) return 'Acer';
  if (/MICROSOFT|SURFACE/.test(s)) return 'Microsoft';
  return '';
}
function parseCpu(s) {
  let m;
  if ((m = s.match(/\bM([1-4])\s*(PRO|MAX)?\b/))) return {tier: 'm' + m[1] + (m[2] ? m[2].toLowerCase() : ''), gen: null};
  if (/XEON/.test(s)) return {tier: 'xeon', gen: null};
  if ((m = s.match(/\bI([3579])\s*[-\s]?\s*(\d{4,5})[A-Z]{0,2}\d?\b/))) {
    const d = m[2]; const gen = (d.length === 5 || (d.length === 4 && d[0] === '1' && +d.slice(0, 2) <= 14)) ? +d.slice(0, 2) : +d[0];
    return {tier: 'i' + m[1], gen};
  }
  if ((m = s.match(/\bI\s*([3579])\s*\/?\s*(\d{1,2})\s*(ST|ND|RD|TH)\b/))) return {tier: 'i' + m[1], gen: +m[2]};
  if ((m = s.match(/(\d{1,2})\s*(ST|ND|RD|TH)\s*GEN.*?\bI([3579])/))) return {tier: 'i' + m[3], gen: +m[1]};
  if ((m = s.match(/\bI([3579])\b/))) return {tier: 'i' + m[1], gen: null};
  if (/ULTRA\s*7/.test(s)) return {tier: 'i7', gen: 14};
  if (/ULTRA\s*5/.test(s)) return {tier: 'i5', gen: 14};
  return null;
}
function nominalStorage(gb) {
  if (!gb || gb <= 0) return 0;
  if (gb < 180) return 128; if (gb < 300) return 256; if (gb < 600) return 512; if (gb < 1100) return 1024; if (gb < 1600) return 1536; return 2048;
}
function parseMem(s) {
  // returns {ram, ssd} from text like "16GB+16GB/ 512GB", "i7/11th/32gb/512gb", "16GB/ 1TB & 240GB"
  const out = {};
  const parts = s.split('/').map(p => p.trim());
  const sizes = [];
  for (const p of parts) {
    const ms = [...p.matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)/g)];
    if (!ms.length) continue;
    let tot = 0; ms.forEach(x => tot += (+x[1]) * (x[2] === 'TB' ? 1024 : 1));
    sizes.push(tot);
  }
  if (sizes.length) { out.ram = sizes[0]; if (sizes.length > 1) out.ssd = nominalStorage(sizes[1]); }
  if (out.ram && out.ram > 128) { out.ssd = nominalStorage(out.ram); delete out.ram; }
  return out;
}

/* ---------- Condition parsing ---------- */
function parseCondition(t, ctx) {
  const defects = new Set();
  let status = null;
  const T = ' ' + t.replace(/APART/g, 'A PART').replace(/MAINOR/g, 'MINOR').replace(/SCRACH|SCRTCH|SCTATCH/g, 'SCRATCH')
    .replace(/RUBEER/g, 'RUBBER').replace(/MISSSING/g, 'MISSING').replace(/KEY\s*BO(A)?RD|KEY\s*BORD/g, 'KEYBOARD') + ' ';

  if (/\bSCRAP\b/.test(T)) status = 'SCRAP';
  else if (/\bDEAD\b|NOT\s*WORKING|NO\s*POWER|NOT\s*POWER|NON[-\s]?WORKING/.test(T)) status = 'DEAD';
  else if (/BIOS\s*LOCK|PASSWORD\s*LOCK|ICLOUD|MDM|ACTIVATION\s*LOCK|\bLOCKED\b/.test(T)) status = 'LOCKED';
  else if (/NO\s*DISPLAY|DISPLAY\s*NOT/.test(T)) status = 'NO_DISPLAY';
  else if (/\bWORKING\b|\bOK\b|\bTESTED\b/.test(T) || ctx.powerOn || ctx.specPresent) status = 'WORKING';
  else if (ctx.powerOff) status = 'DEAD';
  else status = 'UNTESTED';

  if (/SCREEN\s*(DAMAGE|BROKEN|CRACK)|BROKEN\s*SCREEN|DISPLAY\s*(DAMAGE|BROKEN)|LCD\s*(DAMAGE|BROKEN)/.test(T)) defects.add('screen_broken');
  else if (/(DOT|PATCH|PACH|LINE|SPOT|SHADE|MARK)S?\s*(ON)?\s*(THE)?\s*(SCREEN|DISPLAY|LCD)/.test(T)) defects.add('screen_blemish');
  if (/KEYBOARD\s*(DAMAGE|NOT|ISSUE|FAULT)/.test(T)) defects.add('keyboard');
  else if (/KEY\s*(PAINT|COLOUR|COLOR)|KET\s*COLOUR|KEY\s*PRESS(IOR|URE)?\s*MARK|KEY\s*MISSING/.test(T)) defects.add('keycap_wear');
  if (/RAM\s*MISSING|NO\s*RAM|WITHOUT\s*RAM/.test(T) || ctx.ramMissing) defects.add('ram_missing');
  if (/NO\s*BATTERY|BATTERY\s*(MISSING|DEAD|SWOLLEN|BULG)|WITHOUT\s*BATTERY/.test(T)) defects.add('battery_missing');
  if (/HINGE|ENG+E?SS|ENGGES/.test(T)) defects.add('hinge');
  if (/(SSD|HDD|HARD\s*DISK|DRIVE)\s*MISSING|NO\s*(SSD|HDD)|WITHOUT\s*(SSD|HDD)/.test(T) || ctx.ssdMissing) defects.add('storage_missing');

  // Cosmetic: laptop part letters A (lid) B (bezel) C (palmrest) D (base)
  let pts = 0; let described = false;
  const re = /((?:\b[ABCD]\b[\s\/,&]*)+)(?:PART\s*)?(MINOR|MAJOR|MAGER|DEEP|HEAVY)?\s*(SCRATCH(?:ES)?|RUBBER\s*DAMAGE|COLOU?R\s*REMOVE|DENT|DAMAGE|CRACK|BROKEN)/g;
  let m;
  while ((m = re.exec(T))) {
    const n = (m[1].match(/[ABCD]/g) || []).length;
    const sev = m[2] || ''; const kind = m[3];
    let p = 1.5;
    if (/SCRATCH/.test(kind)) p = /MINOR/.test(sev) ? 0.8 : /MAJOR|MAGER|DEEP|HEAVY/.test(sev) ? 2.5 : 1.3;
    else if (/RUBBER/.test(kind)) p = 0.6;
    else if (/COLOU?R/.test(kind)) p = 1.8;
    else if (/DENT/.test(kind)) p = 2.2;
    else p = 3.0; // damage / crack / broken
    pts += n * p; described = true;
  }
  if (/\bMINOR\s*SCRATCH/.test(T) && !described) { pts += 1; described = true; }
  if (/BAD\s*CONDITION|PHYSICAL(LY)?\s*DAMAGE|\bBROKEN\s*BODY/.test(T)) { pts += 4; described = true; defects.add('body_damage'); }
  if (ctx.physical) {
    described = true;
    if (/EXCELLENT|LIKE\s*NEW|GRADE\s*A/.test(ctx.physical)) pts += 0;
    else if (/GOOD|GRADE\s*B/.test(ctx.physical)) pts += 1;
    else if (/FAIR|AVERAGE|GRADE\s*C/.test(ctx.physical)) pts += 4;
    else if (/DAMAGE|POOR|BAD|GRADE\s*D/.test(ctx.physical)) { pts += 7; }
    else pts += 1;
  }
  let grade = pts === 0 && described ? 'A' : pts <= 3 ? 'B' : pts <= 7 ? 'C' : 'D';
  return {status, defects: [...defects], grade, gradeKnown: described, cosmeticPts: +pts.toFixed(1)};
}

/* ---------- Row → asset ---------- */
function cell(row, map, key) {
  return (map[key] || []).map(i => row[i]).filter(v => v !== '' && v != null && !/^N\/?A$/i.test(String(v).trim()));
}
function parseRow(row, map, rowNo) {
  const get = k => cell(row, map, k);
  const brandRaw = get('brand').join(' '), modelRaw = get('model').join(' ');
  const typeRaw = get('type').join(' ');
  const extra = (map._unmapped || []).map(i => row[i]).filter(v => v !== '' && v != null && isNaN(+v) && /[A-Z]{4,}/i.test(String(v)) && /DAMAGE|SCRATCH|DEAD|LOCK|SCREEN|BATTERY|MISSING|BROKEN|WORK/i.test(String(v))).join(' / ');
  const all = up([brandRaw, modelRaw, typeRaw].join(' '));
  if (!all.trim()) return null;
  const brand = normBrand(all) || (brandRaw ? brandRaw.trim() : '');
  const cpuTxt = up([get('cpu').join(' '), get('config').join(' ')].join(' '));
  const cpu = parseCpu(cpuTxt) || parseCpu(up(get('ramssd').join(' ')));

  let ram = null, ssd = null; let ramMissing = false, ssdMissing = false;
  const ramCell = get('ram').map(up).join(' ');
  if (/MISSING/.test(ramCell)) ramMissing = true;
  else if (ramCell) { const n = parseFloat(ramCell); if (n > 0) ram = n; }
  const stCell = get('storage').map(String).join(' ');
  if (stCell) { const n = parseFloat(stCell); if (n > 0) ssd = nominalStorage(n); else if (n === 0) ssdMissing = true; }
  const memTxt = up([get('ramssd').join(' '), get('config').join(' ')].join(' / '));
  const mem = parseMem(memTxt.replace(/^.*?(?=\d+\s*(GB|TB))/, ''));
  if (ram == null && mem.ram) ram = mem.ram;
  if (ssd == null && mem.ssd) ssd = mem.ssd;

  const powerTxt = up(get('power').join(' '));
  const funcTxt = up(get('functional').join(' '));
  const physTxt = up(get('physical').join(' '));
  const condTxt = up([get('config').join(' '), get('remark').join(' '), funcTxt, extra, /NOT\s*CHECKED/.test(memTxt) ? '' : ''].join(' / '));
  const specPresent = /\bI[3579]\s*\/\s*\d/.test(up(get('config').join(' ')));
  const cond = parseCondition(condTxt, {
    powerOn: /^ON\b/.test(powerTxt), powerOff: /^OFF\b/.test(powerTxt), specPresent,
    physical: physTxt, ramMissing, ssdMissing: ssdMissing && /DEAD|MISSING/.test(condTxt)
  });
  // physical column "Damage" alone means body damage
  if (/DAMAGE/.test(physTxt) && !cond.defects.includes('body_damage')) cond.defects.push('body_damage');
  if (/NO\s*BATTERY/.test(physTxt) && !cond.defects.includes('battery_missing')) cond.defects.push('battery_missing');

  const qtyN = parseInt(get('qty')[0], 10);
  const okBrand = b => !brand || b.brand === brand;
  const primary = up([brandRaw, get('model')[0] || ''].join(' '));
  const book = BOOK.find(b => b.re.test(primary) && okBrand(b)) || BOOK.find(b => b.re.test(all) && okBrand(b));
  const specUnknown = !cpu && !ram;
  return {
    row: rowNo, serial: String(get('serial')[0] || ''), brand, modelRaw: (modelRaw || brandRaw).toString().trim(),
    typeRaw, book: book ? book.id : null, cpu, ram, ssd, specUnknown,
    status: cond.status, grade: cond.grade, gradeKnown: cond.gradeKnown, defects: cond.defects, cosmeticPts: cond.cosmeticPts,
    qty: qtyN > 0 ? qtyN : 1, notes: [get('config').join(' '), get('remark').join(' '), funcTxt, physTxt, extra].filter(Boolean).join(' · '),
    verified: false, photos: 0,
  };
}
function parseSheet(rows) {
  const h = findHeader(rows);
  const map = mapColumns(rows[h]);
  const assets = [];
  for (let i = h + 1; i < rows.length; i++) {
    const a = parseRow(rows[i], map, i + 1);
    if (a) assets.push(a);
  }
  return {header: rows[h], map, assets};
}

/* ---------- Valuation ---------- */
function fallbackRef(a) {
  const s = up(a.modelRaw + ' ' + a.typeRaw + ' ' + a.brand);
  const fam = FAMILY.find(f => f.re.test(s)) || {cat: /WORKSTATION/.test(s) ? 'mws' : 'lt', mult: /WORKSTATION/.test(s) ? 1.5 : 0.9};
  const gen = a.cpu && a.cpu.gen ? Math.min(14, Math.max(4, a.cpu.gen)) : null;
  const base = gen ? GEN_VALUE[gen] : 18000;
  return {cat: fam.cat, ref: Math.round(base * fam.mult), cpu: 'i5', ram: 16, ssd: 512, kg: fam.cat === 'desk' ? 8 : fam.cat === 'mws' ? 2.6 : 1.8, name: null};
}
function valueAsset(a, P, bookOverrides) {
  P = P || DEFAULTS;
  let b = a.book ? BOOK.find(x => x.id === a.book) : null;
  const ref0 = b ? (bookOverrides && bookOverrides[b.id] != null ? bookOverrides[b.id] : b.ref) : null;
  const m = b ? {cat: b.cat, ref: ref0, cpu: b.cpu, ram: b.ram, ssd: b.ssd, kg: b.kg, name: b.name} : fallbackRef(a);
  const isMac = m.cat === 'mac';
  const k = isMac ? 1 : 0;
  const steps = [];
  let retail = m.ref;
  steps.push(['Reference refurb retail (Grade A)', retail]);
  // CPU tier adjustment (Windows only; Mac model number fixes the chip family)
  if (!isMac && a.cpu && P.cpuMult[a.cpu.tier] && P.cpuMult[m.cpu]) {
    const f = P.cpuMult[a.cpu.tier] / P.cpuMult[m.cpu];
    if (Math.abs(f - 1) > 0.001) { const d = Math.round(retail * (f - 1)); retail += d; steps.push([`CPU ${a.cpu.tier.toUpperCase()} vs base ${m.cpu.toUpperCase()}`, d]); }
  }
  if (!isMac && a.ram && m.ram) {
    const d = Math.round(Math.max(-2, Math.min(4, (a.ram - m.ram) / 8)) * P.ramPer8);
    if (d) { retail += d; steps.push([`RAM ${a.ram} GB vs ${m.ram} GB`, d]); }
  }
  if (a.ssd && m.ssd) {
    const d = Math.round(Math.max(-2, Math.min(isMac ? 4 : 2, (a.ssd - m.ssd) / 256)) * P.ssdPer256 * (isMac ? 3 : 1));
    if (d) { retail += d; steps.push([`Storage ${a.ssd >= 1024 ? (a.ssd / 1024).toFixed(a.ssd % 1024 ? 1 : 0) + ' TB' : a.ssd + ' GB'} vs ${m.ssd} GB`, d]); }
  }
  const ch = P.channel[m.cat] ?? 0.55;
  const working = Math.round(retail * ch);
  steps.push([`Bulk B2B realisation × ${ch}`, working - retail]);

  const gradeF = P.grade[a.grade] ?? 0.9;
  let repair = 0;
  a.defects.forEach(d => { const r = P.repair[d]; if (r) repair += r[k] * (m.cat === 'mws' && d === 'screen_broken' ? 1.4 : 1); });
  const workingGraded = Math.max(0, Math.round(working * gradeF - repair));
  const parts = Math.round(working * (P.partsFactor[m.cat] ?? 0.3) - (a.defects.includes('ram_missing') ? P.repair.ram_missing[0] * 0.6 : 0));
  const scrap = Math.round(m.kg * (P.scrapPerKg[m.cat] ?? 200));

  let v;
  switch (a.status) {
    case 'WORKING': v = workingGraded; steps.push([`Grade ${a.grade} × ${gradeF}`, Math.round(working * gradeF) - working]); if (repair) steps.push(['Repairs: ' + a.defects.map(d => DEFECT_LABEL[d]).join(', '), -repair]); break;
    case 'UNTESTED': v = Math.round(P.pWorkUntested * workingGraded + (1 - P.pWorkUntested) * parts); steps.push([`Untested: ${Math.round(P.pWorkUntested * 100)}% working / ${Math.round((1 - P.pWorkUntested) * 100)}% parts`, v - working]); break;
    case 'NO_DISPLAY': v = Math.round(0.5 * Math.max(parts, workingGraded - P.repair.screen_broken[k]) + 0.5 * parts); steps.push(['Powers on, no display: 50% screen fix / 50% parts', v - working]); break;
    case 'LOCKED': { const f = isMac ? P.appleLockFactor : P.lockFactor; v = Math.round(workingGraded * f); steps.push([isMac ? `iCloud/MDM lock × ${f}` : `BIOS lock × ${f} (board swap)`, v - working]); break; }
    case 'DEAD': v = parts; steps.push([`Dead: parts/board-repair value × ${P.partsFactor[m.cat] ?? 0.3}`, v - working]); break;
    case 'SCRAP': v = scrap; steps.push([`Scrap: ${m.kg} kg × ₹${P.scrapPerKg[m.cat] ?? 200}/kg`, v - working]); break;
  }
  if (v < scrap) { steps.push(['Raised to material-recovery floor', scrap - v]); v = scrap; }

  // Confidence → range width
  let conf = 1;
  const why = [];
  if (!a.verified) { conf -= 0.12; why.push('condition self-declared'); }
  if (!b) { conf -= 0.25; why.push('model not in price book'); }
  if (a.specUnknown && !isMac) { conf -= 0.10; why.push('spec not checked'); }
  if (a.specUnknown && isMac) { conf -= 0.08; why.push('RAM/SSD config not checked'); }
  if (a.status === 'UNTESTED') { conf -= 0.20; why.push('not power-tested'); }
  if (!a.gradeKnown && !a.photoGraded) { conf -= 0.10; why.push('cosmetics not described'); }
  if (a.photoGraded) { conf += 0.08; why.push('cosmetics graded from photos'); }
  if (a.status === 'DEAD' || a.status === 'NO_DISPLAY') { conf -= 0.10; why.push('fault not diagnosed'); }
  if (a.verified) conf += 0.05;
  conf = Math.max(0.2, Math.min(1, conf));
  const spread = 0.07 + (1 - conf) * 0.38;
  const q = a.qty || 1;
  const lo = Math.max(scrap, Math.round(v * (1 - spread))) * q, hi = Math.round(v * (1 + spread * 0.85)) * q;
  const bucket = a.status === 'SCRAP' ? 'scrap' : (a.status === 'DEAD' || a.status === 'LOCKED' || a.status === 'NO_DISPLAY') ? 'parts'
    : isMac ? 'mac' : m.cat === 'mws' ? 'mws' : m.cat === 'dws' || m.cat === 'desk' ? 'dws' : 'lt';
  return {name: m.name || [a.brand, a.modelRaw].filter(Boolean).join(' '), cat: m.cat, inBook: !!b, retail, working, value: v * q, lo, hi, conf, why, steps, scrap: scrap * q, bucket};
}

const BUCKETS = {
  mac:   {label:'Apple MacBooks — working', buyers:'Apple refurbishers, B2B resellers'},
  mws:   {label:'Mobile workstations — working', buyers:'Workstation refurbishers, CAD/rental firms'},
  lt:    {label:'Business laptops — working', buyers:'ITAD refurbishers, corporate resellers'},
  dws:   {label:'Desktop workstations', buyers:'Workstation refurbishers, rental firms'},
  parts: {label:'Non-working / locked', buyers:'Repair houses, parts harvesters, ITADs'},
  scrap: {label:'Scrap for material recovery', buyers:'Authorised e-waste recyclers'},
};

function valueLot(assets, P, overrides, opts) {
  P = P || DEFAULTS; opts = opts || {};
  const items = assets.map(a => ({a, v: valueAsset(a, P, overrides)}));
  const units = assets.reduce((s, a) => s + (a.qty || 1), 0);
  let lo = 0, hi = 0, mid = 0, confW = 0;
  const buckets = {};
  items.forEach(({a, v}) => {
    lo += v.lo; hi += v.hi; mid += v.value; confW += v.conf * (a.qty || 1);
    const B = buckets[v.bucket] = buckets[v.bucket] || {key: v.bucket, units: 0, lo: 0, hi: 0, mid: 0};
    B.units += a.qty || 1; B.lo += v.lo; B.hi += v.hi; B.mid += v.value;
  });
  // Bulk effect: same-model depth attracts bulk bidders (+0–4%)
  const byModel = {};
  items.forEach(({a, v}) => { if (v.bucket !== 'scrap' && v.bucket !== 'parts') byModel[v.name] = (byModel[v.name] || 0) + (a.qty || 1); });
  const deep = Object.values(byModel).filter(n => n >= 10).reduce((s, n) => s + n, 0);
  const depthBoost = units ? Math.min(0.04, 0.04 * deep / units) : 0;
  const costs = units * ((opts.wipe !== false ? P.wipePerUnit : 0) + (opts.logistics !== false ? P.logisticsPerUnit : 0));
  const LO = Math.round(lo * (1 + depthBoost)), HI = Math.round(hi * (1 + depthBoost)), MID = Math.round(mid * (1 + depthBoost));
  const reserve = round(LO * 0.92, LO > 500000 ? 10000 : 1000);
  const inc = LO < 100000 ? 1000 : LO < 500000 ? 2500 : LO < 2000000 ? 5000 : 10000;
  const opening = round(LO * 0.70, inc);
  return {
    items, units, lo: LO, hi: HI, mid: MID, conf: units ? confW / units : 0, depthBoost, costs,
    netLo: LO - costs, netHi: HI - costs,
    buckets: Object.values(buckets).map(b => ({...b, ...BUCKETS[b.key], lo: Math.round(b.lo * (1 + depthBoost)), hi: Math.round(b.hi * (1 + depthBoost))})).sort((x, y) => y.hi - x.hi),
    auction: {reserve, opening, increment: inc},
  };
}
function round(x, step) { return Math.round(x / step) * step; }

const API = {BOOK, DEFAULTS, DEFECT_LABEL, STATUS_LABEL, BUCKETS, parseSheet, parseRow, mapColumns, parseCondition, parseCpu, valueAsset, valueLot};
root.RIEngine = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
