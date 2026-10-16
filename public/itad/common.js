/* Shared browser helpers for /sell/, /auction/ and /admin/. Requires /itad/engine.js (window.RIEngine). */
(function () {
'use strict';
const E = window.RIEngine;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const lakh = n => n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 1 : 2) + ' L' : inr(n);
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

async function api(path, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error(data.error || `The server returned ${res.status}.`); err.status = res.status; err.data = data; throw err; }
  return data;
}

// Downscale a photo in the browser: smaller uploads and grading calls. Returns {blob, base64, url}.
async function resize(file, max = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', quality));
  const base64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  return { blob, base64, url };
}

function readSheet(file) {
  return new Promise((ok, no) => {
    if (!window.XLSX) return no(new Error('The spreadsheet reader did not load. Check your connection and reload the page.'));
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(r.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).filter(x => x.some(c => String(c).trim()));
        if (rows.length < 2) throw new Error('empty');
        ok(rows);
      } catch (e) { no(new Error('Could not read that file. Upload an .xlsx, .xls or .csv with one device per row.')); }
    };
    r.onerror = () => no(new Error('Could not read that file.'));
    r.readAsArrayBuffer(file);
  });
}

/* ---------- Valuation views ---------- */
function sheetHTML(lot, { title, meta, auctionNote = true } = {}) {
  const nb = lot.items.filter(x => !x.v.inBook).length;
  const mix = (lot.depthBoost > 0 ? `Includes +${(lot.depthBoost * 100).toFixed(1)}% for bulk depth of repeated models. ` : '') +
    (nb ? `${nb} row${nb > 1 ? 's' : ''} priced from family and CPU, not an exact model match. ` : 'Every model matched the price book. ') +
    (lot.costs ? `Costs deducted: ${inr(lot.costs)}.` : '');
  return `<div class="sheet">
    <div class="sheet-head"><div><span class="eyebrow">Lot</span> <span class="mono">${esc(title)}</span></div><div class="mono num">${esc(meta)}</div></div>
    <div class="sheet-body">
      <div class="est">
        <div class="eyebrow">Indicative lot value</div>
        <div class="big">${lakh(lot.lo)} <span>–</span> ${lakh(lot.hi)}</div>
        <div class="kv">
          <div><small>Midpoint</small><b>${inr(lot.mid)}</b></div>
          <div><small>Est. net to you</small><b>${lakh(Math.max(0, lot.netLo))} – ${lakh(Math.max(0, lot.netHi))}</b></div>
          <div><small>Avg per unit</small><b>${lot.units ? inr(lot.mid / lot.units) : '–'}</b></div>
          <div><small>Confidence</small><b>${Math.round(lot.conf * 100)}%</b><span class="meter"><i style="width:${Math.round(lot.conf * 100)}%"></i></span></div>
        </div>
        <p class="note">${esc(mix)}</p>
      </div>
      <div class="side">
        <div class="eyebrow">Live auction setup</div>
        <div class="row"><span>Opening bid</span><b>${inr(lot.auction.opening)}</b></div>
        <div class="row res"><span>Reserve price</span><b>${inr(lot.auction.reserve)}</b></div>
        <div class="row"><span>Bid increment</span><b>${inr(lot.auction.increment)}</b></div>
        <div class="row"><span>Expected hammer</span><b>${lakh(lot.lo)} – ${lakh(lot.hi)}</b></div>
        ${auctionNote ? '<p class="note">Reserve starts at 92% of the low estimate and is reset after the third-party inspection.</p>' : ''}
      </div>
    </div>
    <div class="ladder" aria-hidden="true"><svg viewBox="0 0 1000 90">${ladderSVG(lot)}</svg></div>
  </div>`;
}
function ladderSVG(lot) {
  const max = Math.max(1, lot.hi * 1.06), X = v => 20 + (v / max) * 960;
  let s = `<line x1="20" y1="44" x2="980" y2="44" stroke="var(--line)" stroke-width="2"/>`;
  s += `<rect x="${X(lot.lo)}" y="36" width="${Math.max(2, X(lot.hi) - X(lot.lo))}" height="16" rx="3" fill="var(--pcb-soft)" stroke="var(--pcb)"/>`;
  s += `<line x1="${X(lot.mid)}" y1="32" x2="${X(lot.mid)}" y2="56" stroke="var(--pcb)" stroke-width="2"/>`;
  s += `<text x="${X(lot.mid)}" y="74" text-anchor="middle" class="lbl">mid ${lakh(lot.mid)}</text>`;
  s += `<line x1="${X(lot.auction.opening)}" y1="20" x2="${X(lot.auction.opening)}" y2="44" stroke="var(--muted)" stroke-dasharray="3 2"/>`;
  s += `<text x="${X(lot.auction.opening)}" y="14" text-anchor="middle">Opening ${lakh(lot.auction.opening)}</text>`;
  s += `<line x1="${X(lot.auction.reserve)}" y1="44" x2="${X(lot.auction.reserve)}" y2="68" stroke="var(--amber)" stroke-dasharray="3 2"/>`;
  s += `<text x="${X(lot.auction.reserve)}" y="84" text-anchor="middle" style="fill:var(--amber)">Reserve ${lakh(lot.auction.reserve)}</text>`;
  s += `<text x="${X(lot.hi)}" y="14" text-anchor="start" style="fill:var(--pcb)"> High ${lakh(lot.hi)}</text>`;
  s += `<text x="20" y="74">₹0</text>`;
  return s;
}
function bucketsHTML(lot) {
  const maxB = Math.max(...lot.buckets.map(b => b.hi), 1);
  return lot.buckets.map(b => `<tr><td><b>${esc(b.label)}</b></td><td class="r num mono">${b.units}</td>
    <td class="r num mono" style="white-space:nowrap">${lakh(b.lo)} – ${lakh(b.hi)}</td>
    <td><div class="bar"><i style="left:${b.lo / maxB * 100}%;width:${(b.hi - b.lo) / maxB * 100}%"></i></div></td>
    <td class="note">${esc(b.buyers)}</td></tr>`).join('');
}
function specOf(a) {
  const p = [];
  if (a.cpu) p.push(a.cpu.tier.replace('pro', ' Pro').replace('max', ' Max').replace(/^m/, 'M').replace('xeon', 'Xeon') + (a.cpu.gen ? ' ' + a.cpu.gen + 'G' : ''));
  if (a.ram) p.push(a.ram + 'GB');
  if (a.ssd) p.push(a.ssd >= 1024 ? (a.ssd / 1024).toFixed(a.ssd % 1024 ? 1 : 0) + 'TB' : a.ssd + 'GB');
  return p.length ? p.join(' · ') : '<span class="note">not checked</span>';
}
function passes(x, filter, q) {
  const s = x.a.status;
  if (filter === 'work' && s !== 'WORKING') return false;
  if (filter === 'non' && s === 'WORKING') return false;
  if (filter === 'flag' && !(x.v.conf < 0.8 || !x.v.inBook || s === 'UNTESTED' || s === 'LOCKED' || s === 'NO_DISPLAY')) return false;
  if (q) { const t = q.toLowerCase(); if (!(x.v.name + ' ' + x.a.serial + ' ' + x.a.modelRaw).toLowerCase().includes(t)) return false; }
  return true;
}
// view = {filter, q, open:Set}; override=true shows inspector controls (data-o / data-i attributes)
function registerHTML(lot, view, { override = false } = {}) {
  const html = [];
  lot.items.forEach((x, i) => {
    if (!passes(x, view.filter, view.q)) return;
    const { a, v } = x, open = view.open.has(i);
    const tags = a.defects.map(d => `<span class="tag">${E.DEFECT_LABEL[d]}</span>`).join('') +
      (!v.inBook ? '<span class="tag warn">Not in book</span>' : '') +
      (a.aiGraded ? '<span class="tag">AI graded</span>' : '') + (a.verified ? '<span class="tag ok">Verified</span>' : '');
    html.push(`<tr class="item" data-i="${i}" aria-expanded="${open}" tabindex="0">
      <td class="mono num note">${a.row}</td>
      <td class="asset"><b>${esc(v.name)}</b><small>${esc(a.serial || '—')}${a.qty > 1 ? ' · ×' + a.qty : ''}</small></td>
      <td class="mono" style="font-size:.78rem;white-space:nowrap">${specOf(a)}</td>
      <td><span class="pill s-${a.status}">${E.STATUS_LABEL[a.status]}</span></td>
      <td><span class="grade${a.gradeKnown || a.verified ? '' : ' q'}" title="${a.gradeKnown ? 'From remarks or photos' : 'Assumed'}">${a.grade}</span></td>
      <td><div class="tags">${tags}</div></td>
      <td class="r mono num" style="white-space:nowrap">${Math.round(v.lo).toLocaleString('en-IN')} – ${Math.round(v.hi).toLocaleString('en-IN')}</td>
      <td><span class="confdot" title="${Math.round(v.conf * 100)}%"><i style="width:${v.conf * 100}%"></i></span></td></tr>`);
    if (open) html.push(detailHTML(x, i, override));
  });
  return html.join('') || '<tr><td colspan="8" class="note">No rows match this filter.</td></tr>';
}
function detailHTML({ a, v }, i, override) {
  const steps = v.steps.map(([l, d], k) => `<div><span>${esc(l)}</span><b>${k === 0 ? inr(d) : (d >= 0 ? '+' : '−') + inr(Math.abs(d)).slice(1)}</b></div>`).join('');
  let right = '';
  if (override) {
    const sOpts = Object.entries(E.STATUS_LABEL).map(([k, l]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${l}</option>`).join('');
    const gOpts = ['A', 'B', 'C', 'D'].map(g => `<option${g === a.grade ? ' selected' : ''}>${g}</option>`).join('');
    right = `<div class="stack" style="align-content:start;font-size:.85rem"><div class="eyebrow">Inspector override</div>
      <label class="field" for="o-s-${i}">Status<select id="o-s-${i}" data-o="status" data-i="${i}">${sOpts}</select></label>
      <label class="field" for="o-g-${i}">Cosmetic grade<select id="o-g-${i}" data-o="grade" data-i="${i}">${gOpts}</select></label>
      <label class="check" for="o-v-${i}"><input type="checkbox" id="o-v-${i}" data-o="verified" data-i="${i}"${a.verified ? ' checked' : ''}> Verified by inspection</label></div>`;
  } else {
    right = `<div class="stack" style="align-content:start"><div class="eyebrow">What would change this price</div>
      <p class="note">${a.status === 'UNTESTED' ? 'A power-on test. ' : ''}${!a.gradeKnown ? 'A photo of the lid, keyboard and base. ' : ''}${a.specUnknown ? 'CPU, RAM and storage details. ' : ''}The inspector's grade replaces the declared one.</p></div>`;
  }
  return `<tr class="detail"><td colspan="8"><div class="detail-grid">
    <div style="min-width:0"><div class="eyebrow" style="margin-bottom:6px">Price build-up (per unit)</div><div class="steps">${steps}
      <div class="tot"><span>Point estimate</span><b>${inr(v.value / (a.qty || 1))}</b></div></div>
      <p class="note" style="margin-top:8px">Confidence ${Math.round(v.conf * 100)}%${v.why.length ? ': ' + esc(v.why.join(', ')) : ''}.</p>
      <p class="raw" style="margin-top:8px">Sheet says: ${esc(a.notes || '—')}</p></div>${right}</div></td></tr>`;
}
// Wires expand/collapse and filters for a register table. getLot() returns the current lot; rerender() redraws.
function wireRegister(tbody, view, rerender) {
  tbody.addEventListener('click', e => {
    if (e.target.closest('.detail')) return;
    const tr = e.target.closest('tr.item'); if (!tr) return;
    const i = +tr.dataset.i; view.open.has(i) ? view.open.delete(i) : view.open.add(i); rerender();
  });
  tbody.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.item')) { e.preventDefault(); e.target.click(); } });
}
function wireFilters(root, view, rerender) {
  root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    view.filter = b.dataset.f; root.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); rerender();
  }));
  const q = root.querySelector('input[type=search]');
  if (q) q.addEventListener('input', () => { view.q = q.value.trim(); rerender(); });
}

// Sub-lot drafts for an auction, from a valued lot: one per bucket with its own opening/reserve/increment and manifest.
function sublotDrafts(lot) {
  return lot.buckets.map(b => {
    const items = lot.items.filter(x => x.v.bucket === b.key).map(({ a, v }) => ({
      row: a.row, serial: a.serial, name: v.name, spec: specOf(a).replace(/<[^>]+>/g, ''), status: a.status, grade: a.grade,
      defects: a.defects.map(d => E.DEFECT_LABEL[d]), qty: a.qty || 1, verified: !!a.verified, lo: Math.round(v.lo), hi: Math.round(v.hi),
    }));
    const inc = b.lo < 100000 ? 1000 : b.lo < 500000 ? 2500 : b.lo < 2000000 ? 5000 : 10000;
    const step = (x, s) => Math.max(s, Math.round(x / s) * s);
    const opening = step(b.lo * 0.7, inc);
    return { label: b.label, bucket: b.key, units: b.units, est_lo: b.lo, est_hi: b.hi, opening,
      reserve: Math.max(opening, step(b.lo * 0.92, inc)), increment: inc, items };
  });
}

function countdown(ms) {
  if (ms <= 0) return 'Closed';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
const when = t => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1500); } }
  catch (e) { if (btn) btn.textContent = 'Select and copy the key'; }
}

window.RI = { E, $, esc, inr, lakh, LS, api, resize, readSheet, sheetHTML, bucketsHTML, registerHTML, wireRegister, wireFilters, specOf, sublotDrafts, countdown, when, copy };
})();
