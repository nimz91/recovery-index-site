// The Recovery Index — price board.
// Daily data: /data/*.json (committed by the daily update).
// Live data:  /api/live (5-minute metal prices from the Cloudflare Worker).
(() => {
  'use strict';

  const BASE_DATE = '2026-10-14';
  const LIVE_MAX_AGE_H = 36; // ignore a live snapshot older than this
  const POLL_MS = 60 * 1000;
  const SMI_EXPOSURE = { Copper: { CU: 1 }, Aluminium: { AL: 1 }, Zinc: { ZN: 1 }, Lead: { PB: 1 }, Brass: { CU: 0.65, ZN: 0.35 } };
  const SMI_ORDER = ['Copper', 'Aluminium', 'Brass', 'Lead', 'Zinc'];
  const EW_METALS = ['CU', 'AL', 'XAU', 'XAG', 'XPD', 'NI', 'CO', 'LI2CO3'];
  const METAL_NAMES = { CU: 'Copper', AL: 'Aluminium', ZN: 'Zinc', PB: 'Lead', NI: 'Nickel', SN: 'Tin', XAU: 'Gold', XAG: 'Silver', XPT: 'Platinum', XPD: 'Palladium', CO: 'Cobalt', LI2CO3: 'Lithium', USDINR: 'USD/INR' };
  const GROUPS = [
    { g: 'Base metals', note: 'LME 3-month, USD per tonne', inr: true },
    { g: 'Precious metals', note: 'Spot, USD per troy ounce', inr: true },
    { g: 'Battery metals', note: 'Exchange references, USD per tonne', inr: true },
    { g: 'Black mass payables', note: 'Quarterly, end of Q3 2026 vs end of Q2', inr: false },
    { g: 'India scrap & e-waste', note: 'Indicative dealer buying rates, ₹ per kg, excl. GST', inr: false },
    { g: 'FX', note: 'Indian rupees per US dollar', inr: false },
  ];

  const D = {};
  let LIVE = { latest: null, intraday: [] };
  let intradayCode = 'CU';

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (v, dp = 0) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const inr = (v, dp = 0) => (v == null || !isFinite(v) ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const pctText = (p, dp = 2) => (p == null || !isFinite(p) ? '—' : (p >= 0 ? '+' : '−') + Math.abs(p * 100).toFixed(dp) + '%');
  const ptsText = (d, dp = 2) => (d == null || !isFinite(d) ? '—' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(dp));
  const cls = (v) => (v == null || !isFinite(v) || Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'dn');
  const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const timeIST = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const dateLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }

  // ---------- price model ----------
  let series = {}; // code -> [{d, p}] official daily
  function buildSeries() {
    series = {};
    D.history.forEach((h) => { (series[h.code] = series[h.code] || []).push({ d: h.date, p: Number(h.price) }); });
    Object.values(series).forEach((s) => s.sort((a, b) => (a.d < b.d ? -1 : 1)));
  }
  function officialAt(code, date) {
    const s = series[code] || [];
    let v = null;
    for (const x of s) if (x.d <= date) v = x.p;
    if (v == null && s.length) v = s[0].p;
    if (v == null) { const row = D.board.find((r) => r.code === code); if (row) v = Number(row.price); }
    return v;
  }
  function liveOK() {
    const l = LIVE.latest;
    return !!(l && l.prices && (Date.now() - new Date(l.ts || l.fetched)) / 3600e3 < LIVE_MAX_AGE_H);
  }
  function livePrice(code) { return liveOK() && LIVE.latest.prices[code] != null ? Number(LIVE.latest.prices[code]) : null; }
  function priceNow(code) {
    const lv = livePrice(code);
    if (lv != null) return lv;
    const row = D.board.find((r) => r.code === code);
    return row ? Number(row.price) : officialAt(code, todayIST());
  }
  // Ratio by which an INR price observed on obsDate has moved, given its metal exposure.
  // when = 'now' (live/latest) or a date string (official).
  function factor(exposure, fixedShare, obsDate, when = 'now') {
    const px = (c) => (when === 'now' ? priceNow(c) : officialAt(c, when));
    const fx = px('USDINR') / officialAt('USDINR', obsDate);
    let f = fixedShare;
    for (const [m, w] of Object.entries(exposure)) {
      if (!w) continue;
      const p0 = officialAt(m, obsDate), p1 = px(m);
      f += p0 && p1 ? w * (p1 / p0) * (isFinite(fx) ? fx : 1) : w;
    }
    return f;
  }

  // ---------- secondary metals index ----------
  function smiCompute() {
    const mid = {};
    D.scrap.forEach((r) => { (mid[r.date] = mid[r.date] || {})[r.code] = (Number(r.buy) + Number(r.sell)) / 2; });
    const dates = Object.keys(mid).sort();
    const base = mid[BASE_DATE] || mid[dates[0]];
    const baskets = {};
    D.smi_basket.forEach((b) => { (baskets[b.basket] = baskets[b.basket] || { w: Number(b.basket_weight), codes: [] }).codes.push(b.code); });
    const metalOf = {};
    D.scrap.forEach((r) => { metalOf[r.code] = r.metal; });
    const compose = (valueOf) => {
      const subs = {};
      let sw = 0, sv = 0;
      for (const [name, b] of Object.entries(baskets)) {
        const rel = b.codes.map((c) => { const v = valueOf(c); return v != null && base[c] ? v / base[c] : null; }).filter((x) => x != null);
        if (!rel.length) continue;
        subs[name] = 100 * mean(rel);
        sw += b.w; sv += b.w * subs[name];
      }
      return { composite: sw ? sv / sw : null, subs };
    };
    const daily = dates.map((d) => ({ date: d, ...compose((c) => mid[d][c]) }));
    const lastDate = dates[dates.length - 1];
    // live estimate: each grade's latest observed mid moved by its metal's live price (in INR)
    const liveVal = {};
    D.scrap.filter((r) => r.date === lastDate).forEach((r) => {
      liveVal[r.code] = mid[lastDate][r.code] * factor(SMI_EXPOSURE[r.metal] || {}, SMI_EXPOSURE[r.metal] ? 0 : 1, lastDate);
    });
    const live = compose((c) => liveVal[c] ?? mid[lastDate][c]);
    return { daily, live, lastDate, mid, liveVal, weights: Object.fromEntries(Object.entries(baskets).map(([k, v]) => [k, v.w])) };
  }

  // ---------- e-waste index ----------
  function ewiCompute() {
    const valueOn = (it, when) => {
      const exp = {};
      EW_METALS.forEach((m) => { exp[m] = Number(it['exp_' + m]) || 0; });
      return Number(it.anchor_price) * factor(exp, Number(it.exp_fixed), it.anchor_date, when);
    };
    const rows = D.ewaste.map((it) => {
      const now = valueOn(it, 'now'), base = valueOn(it, BASE_DATE);
      const prevDay = [...new Set(D.history.map((h) => h.date))].sort().filter((d) => d < todayIST()).pop() || BASE_DATE;
      const prev = valueOn(it, prevDay);
      let best = null, bw = 0;
      EW_METALS.forEach((m) => { const w = Number(it['exp_' + m]) || 0; if (w > bw) { bw = w; best = m; } });
      return { ...it, now, base, prev, driver: best ? `${METAL_NAMES[best]} ${Math.round(bw * 100)}%` : 'Fixed' };
    });
    const idx = (k) => 100 * mean(rows.map((r) => r[k] / r.base));
    const dates = [...new Set(D.history.map((h) => h.date))].filter((d) => d >= BASE_DATE).sort();
    const daily = dates.map((d) => ({ date: d, value: 100 * mean(D.ewaste.map((it) => valueOn(it, d) / valueOn(it, BASE_DATE))) }));
    return { rows, now: idx('now'), prev: idx('prev'), daily };
  }

  // ---------- rendering ----------
  function boardView(r) {
    const live = livePrice(r.code);
    const today = todayIST();
    const isLive = live != null;
    const price = isLive ? live : Number(r.price);
    const ref = isLive ? (r.date === today ? (r.prev != null ? Number(r.prev) : null) : Number(r.price)) : (r.prev != null ? Number(r.prev) : null);
    const pts = r.unit === '% payable';
    const change = ref == null ? null : pts ? price - ref : (price - ref) / ref;
    const changeText = ref == null ? '—' : pts ? ptsText(change, 1) + ' pts' : pctText(change);
    const fx = priceNow('USDINR');
    let inrText = '';
    if (r.unit === 'USD/t') inrText = inr(price * fx / 1000) + '/kg';
    if (r.unit === 'USD/oz') inrText = inr(price * fx / 31.1035 * 10) + '/10 g';
    return { price, isLive, change, changeText, inrText, asOf: isLive ? timeIST(LIVE.latest.ts || LIVE.latest.fetched) : dateLabel(r.date) };
  }
  function priceText(r, p) {
    if (r.unit === 'INR/kg') return inr(p);
    if (r.unit === '% payable') return Number(p).toFixed(1) + '%';
    if (r.unit === 'USD/oz' || r.unit === 'INR per USD') return fmt(p, 2);
    return p >= 1000 ? fmt(p, 0) : fmt(p, 2);
  }

  function renderStatus() {
    const dot = $('#live-dot'), label = $('#live-label');
    if (liveOK()) { dot.className = 'dot live'; label.textContent = 'Live · updated ' + timeIST(LIVE.latest.ts || LIVE.latest.fetched) + ' IST'; }
    else { dot.className = 'dot'; const last = D.board.reduce((a, r) => (r.date > a ? r.date : a), ''); label.textContent = 'Daily prices · as of ' + dateLabel(last); }
  }

  function renderTape() {
    const make = () => D.board.filter((r) => !['India scrap & e-waste', 'Black mass payables'].includes(r.group)).map((r) => {
      const v = boardView(r);
      const s = el('span', 'tick');
      s.append(el('b', null, r.code), el('span', null, priceText(r, v.price) + ' '), el('span', cls(v.change), v.changeText === '—' ? '' : v.changeText));
      return s;
    });
    $('#tape1').replaceChildren(...make());
    $('#tape2').replaceChildren(...make());
    $('#tape').classList.add('run');
  }

  function renderTiles(smi, ewi) {
    const tile = (lbl, num, chgText, chgVal) => {
      const t = el('div', 'tile');
      t.append(el('div', 'lbl', lbl), el('div', 'num', num), el('div', 'chg ' + cls(chgVal), chgText));
      return t;
    };
    const b = (code) => D.board.find((r) => r.code === code);
    const tiles = [];
    const smiPrev = smi.daily.length > 1 ? smi.daily[smi.daily.length - 2].composite : 100;
    tiles.push(tile('RI Secondary Metals Index', fmt(smi.live.composite, 2), ptsText(smi.live.composite - smiPrev), smi.live.composite - smiPrev));
    tiles.push(tile('RI E-waste Index', fmt(ewi.now, 2), ptsText(ewi.now - ewi.prev), ewi.now - ewi.prev));
    for (const [code, lbl] of [['CU', 'Copper · USD/t'], ['XAU', 'Gold · USD/oz'], ['LI2CO3', 'Lithium carbonate · USD/t'], ['USDINR', 'USD / INR']]) {
      const r = b(code); if (!r) continue;
      const v = boardView(r);
      tiles.push(tile(lbl, priceText(r, v.price), v.changeText, v.change));
    }
    $('#tiles').replaceChildren(...tiles);
  }

  function renderTakeaway() {
    const daily = D.board.filter((r) => ['Base metals', 'Precious metals', 'Battery metals'].includes(r.group)).map((r) => ({ r, v: boardView(r) })).filter((x) => x.v.change != null);
    if (!daily.length) return;
    const up = daily.reduce((a, b) => (b.v.change > a.v.change ? b : a));
    const dn = daily.reduce((a, b) => (b.v.change < a.v.change ? b : a));
    const p = $('#takeaway');
    p.replaceChildren('Biggest move up: ', el('b', null, up.r.name), ' ', el('span', cls(up.v.change), up.v.changeText), '. Biggest move down: ', el('b', null, dn.r.name), ' ', el('span', cls(dn.v.change), dn.v.changeText), '.');
  }

  function renderSMI(smi) {
    const lastClose = smi.daily[smi.daily.length - 1];
    const prevClose = smi.daily.length > 1 ? smi.daily[smi.daily.length - 2] : null;
    $('#smi-live').textContent = fmt(smi.live.composite, 2);
    const ch = smi.live.composite - (lastClose ? lastClose.composite : 100);
    const live = liveOK();
    const c = $('#smi-live-chg');
    c.className = 'sub ' + cls(ch);
    c.textContent = (live ? 'Live est. ' : '') + ptsText(ch) + ' vs ' + dateLabel(smi.lastDate) + ' close';
    $('#smi-close').textContent = 'Close ' + dateLabel(smi.lastDate) + ': ' + fmt(lastClose.composite, 2) + (prevClose ? ' (' + ptsText(lastClose.composite - prevClose.composite) + ')' : ' · base day');
    $('#smi-subs').replaceChildren(...SMI_ORDER.filter((n) => smi.live.subs[n] != null).map((n) => {
      const d = smi.live.subs[n] - (lastClose.subs[n] ?? 100);
      const box = el('div', 'subcard');
      box.append(el('div', 'lbl', `${n} · ${smi.weights[n]}%`), el('div', 'v', fmt(smi.live.subs[n], 2)), el('div', 'c ' + cls(d), ptsText(d)));
      return box;
    }));
    const tb = $('#smi-table tbody');
    tb.replaceChildren();
    D.scrap.filter((r) => r.date === smi.lastDate).sort((a, b) => SMI_ORDER.indexOf(a.metal) - SMI_ORDER.indexOf(b.metal)).forEach((r) => {
      const m = smi.mid[smi.lastDate][r.code], lv = smi.liveVal[r.code];
      const tr = tb.insertRow();
      tr.title = `${r.source}, ${dateLabel(r.date)}`;
      const add = (t, k) => { const td = tr.insertCell(); td.textContent = t; if (k) td.className = k; return td; };
      add(r.metal, 'nm'); add(r.grade);
      add(inr(r.buy), 'r hide-sm'); add(inr(r.sell), 'r hide-sm');
      add(inr(m, m % 1 ? 2 : 0), 'r'); add(inr(lv), 'r');
      add(pctText(lv / m - 1), 'r ' + cls(lv / m - 1));
    });
  }

  function renderEWI(ewi) {
    $('#ewi-live').textContent = fmt(ewi.now, 2);
    const d = ewi.now - ewi.prev;
    const c = $('#ewi-live-chg');
    c.className = 'sub ' + cls(d);
    c.textContent = (liveOK() ? 'Live ' : '') + ptsText(d) + ' (' + pctText(d / ewi.prev) + ') on the day';
    const tb = $('#ewi-table tbody');
    tb.replaceChildren();
    ewi.rows.forEach((r) => {
      const tr = tb.insertRow();
      tr.title = `Observed ${inr(r.anchor_price)}/kg on ${dateLabel(r.anchor_date)} · ${r.source}`;
      const add = (t, k) => { const td = tr.insertCell(); td.textContent = t; if (k) td.className = k; return td; };
      add(r.item, 'nm'); add(r.category, 'hide-sm'); add(inr(r.anchor_price), 'r hide-sm'); add(inr(r.now), 'r');
      const ch = r.now / r.prev - 1;
      add(pctText(ch), 'r ' + cls(ch)); add(r.driver, 'hide-sm');
    });
  }

  function renderMarkets() {
    const host = $('#markets');
    host.replaceChildren();
    GROUPS.forEach((G) => {
      const rows = D.board.filter((r) => r.group === G.g);
      if (!rows.length) return;
      const card = el('section', 'card');
      card.id = G.g.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      card.append(el('h2', null, G.g), el('p', 'note', G.note));
      const tw = el('div', 'tw'), t = el('table');
      const head = t.createTHead().insertRow();
      ['Instrument', 'Price', 'Change'].concat(G.inr ? ['₹ equivalent'] : [], ['As of', 'Source']).forEach((h, i) => {
        const th = el('th', null, h);
        if (h === 'Price' || h === 'Change') th.className = 'r';
        if (h === '₹ equivalent') th.className = 'r hide-sm';
        if (h === 'As of' || h === 'Source') th.className = 'hide-sm';
        head.appendChild(th);
      });
      const tb = t.createTBody();
      rows.forEach((r) => {
        const v = boardView(r);
        const tr = tb.insertRow();
        const nm = tr.insertCell(); nm.className = 'nm'; nm.textContent = r.name; nm.title = r.basis || '';
        if (v.isLive) nm.appendChild(el('span', 'live-tag', 'LIVE'));
        const add = (txt, k) => { const td = tr.insertCell(); td.textContent = txt; if (k) td.className = k; return td; };
        add(priceText(r, v.price), 'r');
        add(v.changeText, 'r ' + cls(v.change));
        if (G.inr) add(v.inrText || '—', 'r hide-sm');
        add(v.asOf, 'hide-sm');
        const src = tr.insertCell(); src.className = 'src hide-sm';
        const name = v.isLive ? 'Live feed (metals.dev)' : r.source;
        if (!v.isLive && /^https:\/\//.test(r.source_url || '')) { const a = el('a', null, name); a.href = r.source_url; a.target = '_blank'; a.rel = 'noopener'; src.appendChild(a); }
        else src.textContent = name;
      });
      tw.appendChild(t); card.appendChild(tw); host.appendChild(card);
    });
  }

  // ---------- charts (plain SVG) ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const tip = $('#tip');

  function lineChart(host, seriesList, { yFmt = (v) => fmt(v, 0), xFmt, refY = null } = {}) {
    host.replaceChildren();
    const all = seriesList.flatMap((s) => s.pts);
    if (all.length < 1) { host.appendChild(el('div', 'empty', 'No data yet')); return; }
    const W = Math.max(300, host.clientWidth || 600), H = 240, ml = 52, mr = 92, mt = 12, mb = 26;
    let lo = Math.min(...all.map((p) => p.v)), hi = Math.max(...all.map((p) => p.v));
    if (refY != null) { lo = Math.min(lo, refY); hi = Math.max(hi, refY); }
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.01 || 1; lo -= pad; hi += pad;
    let x0 = Math.min(...all.map((p) => p.t)), x1 = Math.max(...all.map((p) => p.t));
    if (x0 === x1) { x0 -= 86400e3; x1 += 86400e3; }
    const X = (t) => ml + (t - x0) / (x1 - x0) * (W - ml - mr);
    const Y = (v) => mt + (hi - v) / (hi - lo) * (H - mt - mb);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, y = Y(v);
      svg.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: y, y2: y, stroke: css('--grid') }));
      const t = svgEl('text', { x: ml - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: css('--muted') }); t.textContent = yFmt(v); svg.appendChild(t);
    }
    const ticks = Math.min(5, Math.max(2, Math.floor((W - ml - mr) / 110)));
    let lastLbl = null;
    for (let i = 0; i <= ticks; i++) {
      const t = x0 + (x1 - x0) * i / ticks;
      const lbl = xFmt(t);
      if (lbl === lastLbl) continue;
      lastLbl = lbl;
      const tx = svgEl('text', { x: X(t), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: css('--muted') }); tx.textContent = lbl; svg.appendChild(tx);
    }
    if (refY != null) svg.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: Y(refY), y2: Y(refY), stroke: css('--muted'), 'stroke-dasharray': '4 4', opacity: 0.6 }));
    const labels = [];
    seriesList.forEach((s) => {
      if (!s.pts.length) return;
      const d = s.pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join('');
      svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const lp = s.pts[s.pts.length - 1];
      svg.appendChild(svgEl('circle', { cx: X(lp.t), cy: Y(lp.v), r: 3.5, fill: s.color }));
      let ly = Y(lp.v) + 4; while (labels.some((v) => Math.abs(v - ly) < 13)) ly += 13; labels.push(ly);
      const lt = svgEl('text', { x: X(lp.t) + 8, y: ly, 'font-size': 11, fill: s.color, 'font-weight': 600 }); lt.textContent = (s.name ? s.name + ' ' : '') + yFmt(lp.v); svg.appendChild(lt);
    });
    // hover
    const overlay = svgEl('rect', { x: ml, y: mt, width: W - ml - mr, height: H - mt - mb, fill: 'transparent' });
    overlay.addEventListener('mousemove', (ev) => {
      const box = svg.getBoundingClientRect();
      const t = x0 + ((ev.clientX - box.left) / box.width * W - ml) / (W - ml - mr) * (x1 - x0);
      const near = seriesList.map((s) => ({ s, p: s.pts.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), s.pts[0]) })).filter((x) => x.p);
      if (!near.length) return;
      tip.replaceChildren(el('div', 'd', xFmt(near[0].p.t, true)), ...near.map((n) => el('div', null, (n.s.name ? n.s.name + ': ' : '') + yFmt(n.p.v))));
      tip.hidden = false;
      tip.style.left = Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = ev.clientY - tip.offsetHeight - 10 + 'px';
    });
    overlay.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.appendChild(overlay);
    host.appendChild(svg);
  }

  function renderIntraday() {
    const pick = $('#intraday-pick');
    const codes = ['CU', 'AL', 'ZN', 'PB', 'NI', 'XAU', 'XAG', 'XPT', 'XPD', 'USDINR'];
    if (!pick.options.length) {
      codes.forEach((c) => pick.add(new Option(METAL_NAMES[c], c)));
      pick.addEventListener('change', () => { intradayCode = pick.value; renderIntraday(); });
    }
    pick.value = intradayCode;
    const pts = (LIVE.intraday || []).filter((s) => s.prices && s.prices[intradayCode] != null).map((s) => ({ t: new Date(s.ts || s.fetched).getTime(), v: Number(s.prices[intradayCode]) }));
    const host = $('#intraday-chart');
    if (!pts.length) { host.replaceChildren(el('div', 'empty', 'The live feed starts once the updater is running.')); return; }
    const dp = intradayCode === 'USDINR' ? 2 : ['XAU', 'XAG', 'XPT', 'XPD'].includes(intradayCode) ? 2 : 0;
    lineChart(host, [{ name: '', color: css('--accent'), pts }], { yFmt: (v) => fmt(v, dp), xFmt: (t, long) => { const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0; const o = long || span > 20 * 3600e3 ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' } : { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }; return new Date(t).toLocaleString('en-IN', o); } });
  }

  function renderHistory(smi, ewi) {
    const toPts = (arr, k) => arr.map((r) => ({ t: new Date(r.date + 'T00:00:00Z').getTime(), v: r[k] })).filter((p) => p.v != null);
    lineChart($('#history-chart'), [
      { name: 'Secondary metals', color: css('--accent'), pts: toPts(smi.daily, 'composite') },
      { name: 'E-waste', color: css('--accent-2'), pts: toPts(ewi.daily, 'value') },
    ], { yFmt: (v) => fmt(v, 2), xFmt: (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), refY: 100 });
  }

  function renderAll() {
    const smi = smiCompute(), ewi = ewiCompute();
    renderStatus(); renderTape(); renderTiles(smi, ewi); renderTakeaway();
    renderSMI(smi); renderEWI(ewi); renderMarkets(); renderIntraday(); renderHistory(smi, ewi);
  }

  async function pollLive() {
    try { LIVE = await getJSON('/api/live'); } catch (e) { /* stay on daily data */ }
    renderAll();
  }

  async function init() {
    $('#year').textContent = new Date().getFullYear();
    const names = ['board', 'history', 'scrap', 'smi_basket', 'ewaste'];
    const loaded = await Promise.all(names.map((n) => getJSON(`/data/${n}.json`)));
    names.forEach((n, i) => { D[n] = loaded[i]; });
    buildSeries();
    await pollLive();
    setInterval(pollLive, POLL_MS);
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 150); });
  }

  // Exposed for tests.
  window.RI = { D, get LIVE() { return LIVE; }, set LIVE(v) { LIVE = v; }, smiCompute, ewiCompute, factor, buildSeries, renderAll };
  init().catch((e) => { $('#live-label').textContent = 'Could not load prices'; console.error(e); });
})();
