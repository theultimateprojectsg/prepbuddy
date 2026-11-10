// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { buildReport, encodeReport, headline } from './report.js';
import { initLang, setLang, watch, LANG } from './i18n.js';

/* ---------- settings ---------- */
const SESSION_SIZE = 10;
const BATCH = 3;            // questions requested per generate call
const BUFFER = 3;           // spare questions kept ready beyond the current session (costs credits)
// Mix of question kinds, cycled through as a chapter's bank grows.
const TYPE_CHOICES = [['mcq', 'MCQ'], ['written', 'Written'], ['mix', 'Both']];
const PLANS = {
  mcq: [[1, 'mcq'], [2, 'mcq'], [2, 'graph'], [3, 'mcq'], [1, 'mcq'], [2, 'mcq'], [3, 'mcq']],
  written: [[2, 'short'], [3, 'structured'], [2, 'short'], [4, 'structured'], [3, 'short'], [3, 'structured']],
};
const choiceType = (q) => q.type === 'mcq' || q.type === 'graph';
const matchType = (q, types) => !types || types === 'mix' || (types === 'mcq' ? choiceType(q) : !choiceType(q));
const PLAN = [[2, 'graph'], [1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
const LKEY = 'prepbuddy.v2';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '', usage: {}, log: [], name: '', types: 'mix' }, loadLocal());
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) {} }

/* ---------- helpers ---------- */
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { 1: 'Recall', 2: 'Understand', 3: 'Apply', 4: 'Analyse / evaluate' };
const TYPE = { mcq: 'MCQ', graph: 'Graph MCQ', short: 'Short answer', structured: 'Structured' };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const marksOf = (q) => (q.type === 'mcq' || q.type === 'graph' ? 1 : (q.parts || []).reduce((s, p) => s + p.marks, 0));
// 'zh-HK' when the text is mostly Chinese characters, else 'en'.
const langOf = (t) => { const x = String(t || '').slice(0, 20000); const cjk = (x.match(/[\u3400-\u9fff]/g) || []).length; const words = (x.match(/[A-Za-z]{2,}/g) || []).length; return cjk > words ? 'zh-HK' : 'en'; };
// Drop or repair malformed questions before they reach a student.
function usable(q) {
  if (!q || typeof q !== 'object') return false;
  if (q.type === 'graph' && !(Array.isArray(q.graphs) && q.graphs.length === 4)) { q.type = 'mcq'; delete q.graphs; }
  if (q.type === 'mcq' || q.type === 'graph') return Array.isArray(q.options) && q.options.length === 4 && 'ABCD'.includes(q.correct_option || '?');
  return Array.isArray(q.parts) && q.parts.length > 0 && q.parts.every((p) => p && p.prompt && Array.isArray(p.mark_scheme) && p.marks > 0);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ICON = {
  close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 8"/></svg>',
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F766E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  target: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C2410C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
};
function toast(msg) { document.querySelectorAll('.toast').forEach((x) => x.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

function renderStem(stem, cls = 'stem') {
  if (!stem) return '';
  const lines = stem.split('\n'); let html = ''; let buf = []; let tbl = [];
  const flushText = () => { if (buf.join('').trim()) html += `<p class="${cls}">${esc(buf.join('\n').trim())}</p>`; buf = []; };
  const flushTbl = () => { if (tbl.length) html += '<div style="overflow-x:auto"><table class="data">' + tbl.map((r, i) => '<tr>' + r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('') + '</tr>').join('') + '</table></div>'; tbl = []; };
  for (const l of lines) {
    if (l.includes('|') && l.split('|').length >= 3) {
      flushText();
      const cells = l.split('|').map((s) => s.trim()).filter((s, i, a) => !(s === '' && (i === 0 || i === a.length - 1)));
      if (!cells.every((c) => /^:?-+:?$/.test(c))) tbl.push(cells);
    } else { flushTbl(); buf.push(l); }
  }
  flushText(); flushTbl(); return html;
}

/* ---------- books ---------- */
async function getBooks() { return store.get('books', []); }
async function getQs(bookId, unitId) { return store.get(`qs:${bookId}:${unitId}`, []); }
async function setQs(bookId, unitId, list) { await store.set(`qs:${bookId}:${unitId}`, list); }
function scoreOf(questions) {
  let got = 0, total = 0;
  questions.forEach((q) => { const s = local.stats[q.id]; if (s) { got += s.got; total += s.total; } });
  return total ? Math.round(100 * got / total) : null;
}
async function allQuestions() {
  const out = [];
  for (const b of await getBooks()) for (const u of b.units) {
    (await getQs(b.id, u.id)).forEach((q) => out.push({ q, book: b, unit: u }));
  }
  return out;
}

/* ---------- server ---------- */
async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': local.code || '' },
      body: JSON.stringify(body),
    });
  } catch (e) { const err = new Error('No internet connection. Questions need a connection to be made.'); err.status = 0; throw err; }
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (data.usage) recordUsage(path, data.usage);
  if (!r.ok) { const e = new Error(data.error || `Server error ${r.status}`); e.status = r.status; throw e; }
  return data;
}

function recordUsage(path, u) {
  const t = local.usage[path] || (local.usage[path] = { requests: 0, calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0 });
  t.requests++;
  for (const k of ['calls', 'input', 'output', 'cache_write', 'cache_read', 'usd']) t[k] = (t[k] || 0) + (u[k] || 0);
  saveLocal();
}

/* ---------- spaced review ----------
   Full marks moves a question up a box (back in 1, 3, 7, 14, then 30 days).
   Anything less sends it back to box 1 (back tomorrow). */
const DAY = 864e5;
const INTERVALS = [1, 3, 7, 14, 30];
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function schedule(s, full) {
  s.box = full ? Math.min((s.box || 0) + 1, INTERVALS.length) : 1;
  s.at = Date.now();
  s.due = startOfToday() + INTERVALS[s.box - 1] * DAY; // due from the start of that day
}
(function scheduleOldProgress() { // progress saved before spaced review existed
  let changed = false;
  for (const s of Object.values(local.stats)) if (!s.due) { schedule(s, s.last >= 1); changed = true; }
  if (changed) saveLocal();
})();
async function dueItems() {
  const now = Date.now();
  return (await allQuestions()).filter((x) => { const s = local.stats[x.q.id]; return s && s.due <= now; })
    .sort((a, b) => local.stats[a.q.id].due - local.stats[b.q.id].due);
}
async function nextDue() {
  let next = Infinity;
  for (const x of await allQuestions()) { const s = local.stats[x.q.id]; if (s && s.due > Date.now()) next = Math.min(next, s.due); }
  return next;
}
function whenText(t) {
  const days = Math.round((t - startOfToday()) / DAY);
  return days <= 1 ? 'tomorrow' : days < 7 ? `in ${days} days` : days < 14 ? 'in about a week' : `in ${Math.round(days / 7)} weeks`;
}

/* ---------- routing ---------- */
let view = { name: 'home' };
let S = null; // current practice session

async function go(v) {
  view = v;
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  stopTimer();
  if (v.name === 'home') return renderHome();
  if (v.name === 'book') return renderBook(v.bookId);
  if (v.name === 'library') return renderLibrary(v.query || '');
  if (v.name === 'usage') return renderUsage();
  if (v.name === 'progress') return renderProgress();
  if (v.name === 'paper') return renderPaper(v.bookId);
}

/* ---------- home ---------- */
async function renderHome() {
  S = null;
  const books = await getBooks();
  const due = await dueItems();
  const nextAt = due.length ? 0 : await nextDue();
  const cards = [];
  for (const b of books) {
    let n = 0; const qs = [];
    for (const u of b.units) { const l = await getQs(b.id, u.id); n += l.length; qs.push(...l); }
    const sc = scoreOf(qs);
    cards.push(`<button class="row" data-book="${esc(b.id)}">
      <div class="top"><span style="display:flex;gap:10px;align-items:flex-start">${ICON.book}<span><b style="font-weight:600" data-raw>${esc(b.title)}</b><br><span class="muted" style="font-size:13px">${b.subject ? esc(b.subject) + ' · ' : ''}${b.units.length} chapters · ${n} questions${b.library ? '' : ' · uploaded'}</span></span></span>
      <span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div></button>`);
  }
  $app.innerHTML = `
  <main class="pad stack g22" style="flex:1">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><p class="muted" style="margin:0 0 2px;font-size:13px">Exam practice from your textbooks</p><h1 class="brand">PrepBuddy</h1></div>
      <button class="langbtn" id="lang" lang="${LANG === 'zh' ? 'en' : 'zh-HK'}" aria-label="${LANG === 'zh' ? 'Switch to English' : '切換至中文'}">${LANG === 'zh' ? 'EN' : '中文'}</button></div>
    <section class="hero" aria-label="Find a textbook">
      <small>Add a textbook</small>
      <span class="title">Find your textbook and practise any chapter</span>
      <form id="find" class="searchbox" role="search">
        <span aria-hidden="true" style="color:#4B5563;display:flex">${ICON.search}</span>
        <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off">
      </form>
    </section>
    <section class="stack g10" aria-label="My textbooks">
      <h2 style="margin:0;font-size:15px">My textbooks</h2>
      ${cards.length ? `<div class="card stack">${cards.join('')}</div>`
        : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:#374151">No textbooks yet. Search above to add one from the library.</p></div>`}
      <label class="link" style="align-self:flex-start;display:inline-flex;gap:6px;align-items:center;cursor:pointer">${ICON.upload}<span>Not in the library? Upload your own PDF</span>
        <input type="file" id="file" accept="application/pdf,.pdf" style="position:absolute;width:1px;height:1px;opacity:0"></label>
    </section>
    ${cards.length ? `<section class="stack g10" aria-label="Review">
      <h2 style="margin:0;font-size:15px">Review across all textbooks</h2>
      ${due.length
        ? `<button class="review-card" data-mode="spaced"><span class="stack g6" style="align-items:flex-start"><b>Spaced review</b><span>${due.length} question${due.length > 1 ? 's' : ''} due today · about ${Math.max(1, Math.round(Math.min(due.length, 15) * 0.6))} min</span></span><span class="pill">Start</span></button>`
        : `<div class="review-card done"><span class="stack g6"><b>Spaced review</b><span>${nextAt < Infinity ? `All caught up. Next review ${whenText(nextAt)}.` : 'Questions you answer come back here to help you remember them.'}</span></span></div>`}
      <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button class="tile" data-mode="weak">${ICON.target}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="tile" data-mode="mock">${ICON.clock}<b>Mini mock</b><span>12 questions, 20 min</span></button>
      </div>
      <button class="row card" id="progress" style="border:1px solid #E3E6EA;border-radius:14px"><div class="top"><span><b style="font-weight:600">My progress</b><br><span class="muted" style="font-size:13px">This week, and a report to send your parents</span></span><span aria-hidden="true" style="color:#0F766E;font-weight:700">›</span></div></button>
    </section>` : ''}
  </main>
  <footer>Prototype. Your textbooks, questions and progress are saved on this device only. Questions are written by AI and checked by AI; tap "Report a problem" if one looks wrong. <button class="link quiet" id="usage" style="font-size:11px;padding:0">AI usage</button></footer>`;
  document.getElementById('usage').onclick = () => go({ name: 'usage' });
  document.getElementById('lang').onclick = () => { setLang(LANG === 'zh' ? 'en' : 'zh'); go({ name: 'home' }); };
  const pr = document.getElementById('progress'); if (pr) pr.onclick = () => go({ name: 'progress' });
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => startReview(b.dataset.mode)));
  document.getElementById('file').onchange = (e) => e.target.files[0] && uploadBook(e.target.files[0]);
  const q = document.getElementById('q');
  q.onfocus = () => go({ name: 'library', query: q.value });
  document.getElementById('find').onsubmit = (e) => { e.preventDefault(); go({ name: 'library', query: q.value }); };
  window.scrollTo(0, 0);
}

/* ---------- library (books uploaded once by the admin) ---------- */
let catalog = null;
async function getCatalog() {
  if (catalog) return catalog;
  const r = await fetch('library/catalog.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('The library could not be loaded.');
  catalog = await r.json();
  return catalog;
}
const libBookId = (entry) => 'lib-' + entry.id;
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function renderLibrary(query) {
  let list;
  try { list = await getCatalog(); } catch (e) { toast(e.message); return go({ name: 'home' }); }
  const mine = new Set((await getBooks()).map((b) => b.id));
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">Textbook library</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <form id="find" class="searchbox light" role="search">
      <span aria-hidden="true" style="color:#4B5563;display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off" value="${esc(query)}">
    </form>
    <div id="results" class="stack g10" aria-live="polite"></div>
  </main>`;
  const q = document.getElementById('q');
  const draw = () => {
    const raw = q.value.trim(), words = raw.toLowerCase().split(/\s+/).filter(Boolean), code = normCode(raw);
    const hits = list.filter((b) => {
      if (code && normCode(b.code) === code) return true;
      const hay = `${b.title} ${b.subject} ${b.level} ${b.publisher} ${b.code}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const codeHit = code.length >= 4 && hits.find((b) => normCode(b.code) === code);
    document.getElementById('results').innerHTML = (codeHit ? '<p class="hint" style="margin:0;font-weight:600;color:#0F766E">Book code matched</p>' : '') + (hits.length
      ? hits.map((b) => {
        const added = mine.has(libBookId(b));
        return `<div class="card libcard">
          <div class="cover" aria-hidden="true">${esc((b.subject || '?').slice(0, 3))}</div>
          <div class="stack g6" style="flex:1;min-width:0">
            <b style="font-size:15px;line-height:1.35" data-raw>${esc(b.title)}</b>
            <span class="muted" style="font-size:13px">${esc([b.subject, b.level, b.publisher].filter(Boolean).join(' · '))}</span>
            <span class="muted" style="font-size:12px">${b.units.length} chapters · ${b.questionCount ? b.questionCount + ' questions ready · ' : ''}code <span style="white-space:nowrap">${esc(b.code)}</span></span>
            ${added
              ? `<button class="btn ghost small" data-open="${esc(b.id)}">${ICON.check} Added · open</button>`
              : `<button class="btn small" data-add="${esc(b.id)}">${ICON.plus} Add to my textbooks</button>`}
          </div></div>`;
      }).join('')
      : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5">No textbook matches “${esc(raw)}”.</p><p class="muted" style="margin:8px 0 0;font-size:14px;line-height:1.5">Check the book code, or upload your own PDF from the home screen.</p></div>`);
    document.querySelectorAll('[data-add]').forEach((btn) => (btn.onclick = () => addFromLibrary(list.find((b) => b.id === btn.dataset.add), btn)));
    document.querySelectorAll('[data-open]').forEach((btn) => (btn.onclick = () => go({ name: 'book', bookId: 'lib-' + btn.dataset.open })));
  };
  q.oninput = draw;
  document.getElementById('find').onsubmit = (e) => { e.preventDefault(); q.blur(); };
  document.getElementById('back').onclick = () => go({ name: 'home' });
  draw();
  q.focus();
}

async function addFromLibrary(entry, btn) {
  const id = libBookId(entry);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    const qr = await fetch(`library/${entry.id}/questions.json`);
    const bank = qr.ok ? await qr.json() : {};
    for (const u of entry.units) {
      const tr = await fetch(`library/${entry.id}/${u.id}.txt`);
      if (!tr.ok) throw new Error('Part of this textbook could not be downloaded. Please try again.');
      await store.set(`text:${id}:${u.id}`, await tr.text());
      const existing = await getQs(id, u.id);
      const have = new Set(existing.map((q) => q.id));
      const ready = (bank[u.id] || []).map((q) => ({ ...q, id: `${id}:${u.id}:${q.id}`, section: u.title, pages: q.pages || `${u.startPage}-${u.endPage}` }))
        .filter((q) => !have.has(q.id));
      await setQs(id, u.id, existing.concat(ready));
    }
    await store.persist();
    const books = (await store.get('books', [])).filter((b) => b.id !== id);
    books.unshift({ id, library: entry.id, code: entry.code, title: entry.title, subject: entry.subject, level: entry.level,
      credit: entry.credit, pageCount: entry.pageCount, addedAt: Date.now(), units: entry.units.map((u) => ({ ...u })) });
    await store.set('books', books);
    toast('Added to your textbooks');
    go({ name: 'book', bookId: id });
  } catch (e) {
    toast(e.message || 'Could not add this textbook.');
    if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
  }
}

/* ---------- upload ---------- */
async function uploadBook(file) {
  const show = (pct, msg) => {
    $app.innerHTML = `<main class="pad stack g18" style="flex:1;justify-content:center">
      <h1 class="display" style="margin:0;font-size:22px">Reading your book</h1>
      <p class="muted" style="margin:0">${esc(file.name)}</p>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="muted" style="margin:0;font-size:14px">${esc(msg)}</p></main>`;
  };
  show(0, 'Opening the file…');
  try {
    if (file.size > 300 * 1024 * 1024) throw new Error('This file is over 300 MB. Try a smaller PDF or one chapter at a time.');
    const [{ readBook }, data] = await Promise.all([import('./book.js'), file.arrayBuffer()]);
    let last = 0;
    const book = await readBook(new Uint8Array(data), (i, n) => {
      const now = Date.now(); if (now - last < 150 && i < n) return; last = now;
      show(Math.round(100 * i / n), `Page ${i} of ${n}`);
    });
    if (!book.units.length) throw new Error('No chapters with enough text were found in this PDF.');
    show(100, `Found ${book.units.length} chapters. Saving…`);
    await store.persist();
    const id = 'b' + uid();
    const units = book.units.map((u, i) => ({ id: 'u' + i, title: u.title, chapter: u.chapter || null, startPage: u.startPage, endPage: u.endPage, chars: u.text.length }));
    for (let i = 0; i < book.units.length; i++) await store.set(`text:${id}:u${i}`, book.units[i].text);
    const title = (book.title && book.title.length > 3 && !/^untitled|microsoft word/i.test(book.title)) ? book.title : file.name.replace(/\.pdf$/i, '').replace(/^[0-9a-f]{6,}[-_ ]+/i, '').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' – ').trim() || 'My book';
    const books = await store.get('books', []);
    books.unshift({ id, title, fileName: file.name, addedAt: Date.now(), pageCount: book.pageCount, method: book.method, units });
    await store.set('books', books);
    toast(`Added ${units.length} chapters`);
    go({ name: 'book', bookId: id });
  } catch (e) {
    $app.innerHTML = `<main class="pad stack g18" style="flex:1;justify-content:center">
      <h1 class="display" style="margin:0;font-size:22px">That book couldn't be read</h1>
      <p style="margin:0;line-height:1.5">${esc(e.message || 'Something went wrong reading this PDF.')}</p>
      <button class="btn" id="home">Back to home</button></main>`;
    document.getElementById('home').onclick = () => go({ name: 'home' });
  }
}

/* ---------- book: chapter list ---------- */
let pick = { bookId: null, ids: new Set() }; // chapters ticked on the book screen

async function renderBook(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  if (pick.bookId !== bookId) pick = { bookId, ids: new Set() };
  const t = local.types || 'mix';
  const count = local.count || SESSION_SIZE;
  const rows = [];
  let lastChapter = null;
  for (const u of book.units) {
    if (u.chapter && u.chapter !== lastChapter) { rows.push(`<div class="chapter-head">${esc(u.chapter)}</div>`); lastChapter = u.chapter; }
    const qs = await getQs(book.id, u.id);
    const unseen = qs.filter((q) => !local.stats[q.id] && matchType(q, t)).length;
    const done = qs.filter((q) => local.stats[q.id]).length;
    const sc = scoreOf(qs);
    const on = pick.ids.has(u.id);
    const status = qs.length || done ? `${unseen} ready · ${done} done` : 'New questions will be made';
    rows.push(`<button class="row selectable ${on ? 'picked' : ''}" data-unit="${esc(u.id)}" aria-pressed="${on}">
      <div class="top"><span style="display:flex;gap:12px;align-items:flex-start"><span class="box ${on ? 'on' : ''}" aria-hidden="true">${on ? ICON.check : ''}</span><span data-raw>${esc(u.title)}</span></span><span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div>
      <span class="muted" style="font-size:12px;padding-left:36px">${u.startPage ? `pp. ${u.startPage}–${u.endPage} · ` : ''}${status}</span>
      ${sc !== null ? `<div class="bar ${sc < 50 ? 'warn' : ''}" style="margin-left:36px"><i style="width:${sc}%"></i></div>` : ''}</button>`);
  }
  const n = pick.ids.size;
  const mins = Math.max(1, Math.round(count * (t === 'mcq' ? 0.5 : t === 'written' ? 1.5 : 0.8)));
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-raw>${esc(book.title)}</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <p style="margin:0;font-size:15px;font-weight:600">1. Choose chapters</p>
      ${book.units.length > 1 ? `<button class="link" id="all" style="padding:0">${n === book.units.length ? 'Clear all' : 'Select all'}</button>` : ''}
    </div>
    <div class="card stack">${rows.join('')}</div>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.5">${book.library
      ? `From the PrepBuddy library · book code ${esc(book.code)}${book.credit ? `<br>Source: ${esc(book.credit)}` : ''}`
      : `Uploaded by you · ${book.pageCount} pages · chapters found from ${book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}`}</p>
    <button class="link quiet" id="delete" style="align-self:flex-start">Remove from my textbooks</button>
  </main>
  <div class="sheet sticky setup">
    <p style="margin:0;font-size:15px;font-weight:600">2. Set up your practice</p>
    <div class="setup-row">
      <span id="types-label">Questions</span>
      <div class="seg" role="radiogroup" aria-labelledby="types-label">
        ${TYPE_CHOICES.map(([k, l]) => `<button role="radio" aria-checked="${t === k}" data-types="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="setup-row">
      <span id="count-label">How many</span>
      <div class="stepper" role="group" aria-labelledby="count-label">
        <button id="minus" aria-label="Fewer questions" ${count <= 5 ? 'disabled' : ''}>−</button>
        <output id="count" aria-live="polite">${count}</output>
        <button id="plus" aria-label="More questions" ${count >= 100 ? 'disabled' : ''}>+</button>
      </div>
    </div>
    <button class="btn" id="go" ${n ? '' : 'disabled'}>${n ? `Start ${count} questions · about ${mins} min` : 'Tick at least one chapter above'}</button>
    <button class="link" id="paper" style="align-self:center;padding:2px 0">Or make a DSE-style mock paper / worksheet</button>
  </div>`;
  const keep = async () => { const y = window.scrollY; await renderBook(bookId); window.scrollTo(0, y); };
  document.getElementById('back').onclick = () => { pick = { bookId: null, ids: new Set() }; go({ name: 'home' }); };
  const a = document.getElementById('all');
  if (a) a.onclick = () => { if (pick.ids.size === book.units.length) pick.ids.clear(); else book.units.forEach((u) => pick.ids.add(u.id)); keep(); };
  $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => { const id = b.dataset.unit; pick.ids.has(id) ? pick.ids.delete(id) : pick.ids.add(id); keep(); }));
  $app.querySelectorAll('[data-types]').forEach((b) => (b.onclick = () => { local.types = b.dataset.types; saveLocal(); keep(); }));
  const step = (d) => { local.count = Math.min(100, Math.max(5, (local.count || SESSION_SIZE) + d)); saveLocal(); keep(); };
  document.getElementById('minus').onclick = () => step((local.count || SESSION_SIZE) > 20 ? -10 : -5);
  document.getElementById('plus').onclick = () => step((local.count || SESSION_SIZE) >= 20 ? 10 : 5);
  document.getElementById('go').onclick = () => { const units = book.units.filter((u) => pick.ids.has(u.id)); startUnits(book, units, local.count || SESSION_SIZE); };
  document.getElementById('delete').onclick = () => confirmRemove(book);
  document.getElementById('paper').onclick = () => go({ name: 'paper', bookId });
  window.scrollTo(0, 0);
}

/* ---------- my progress + report for parents ---------- */
async function currentReport() {
  const books = await getBooks();
  const practised = new Set(local.log.filter((e) => e.t >= Date.now() - 7 * DAY).map((e) => e.q.split(':')[0]));
  const names = books.filter((b) => practised.has(b.id)).map((b) => b.subject || b.title);
  return buildReport({ log: local.log, stats: local.stats, name: local.name, books: [...new Set(names)], lang: LANG });
}

async function renderProgress() {
  const r = await currentReport();
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'narrow' }));
  const mins = r.days.reduce((a, m) => a + m, 0);
  const hm = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  const trend = r.a !== null && r.pa !== null ? (r.a >= r.pa ? `<span style="color:#0F766E;font-weight:600">↑ ${r.a - r.pa} from last week</span>` : `<span style="color:#9A3412;font-weight:600">↓ ${r.pa - r.a} from last week</span>`) : '<span>correct</span>';
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">My progress</span></div>
  <main class="stack g18" style="flex:1;padding:4px 20px 20px">
    <div class="stack g6"><span class="muted" style="font-size:13px">Last 7 days</span><span class="display" style="font-size:26px;font-weight:700;line-height:1.2">${r.dp} of 7 days practised</span></div>
    <div class="week">${r.days.map((m, i) => `<div><span class="${m ? 'on' : ''} ${i === 6 ? 'today' : ''}" title="${m} min"></span><small>${dayNames[i]}</small></div>`).join('')}</div>
    <div class="tiles">
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.q}</b><span>questions</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${hm}</b><span>practising</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.a === null ? '–' : r.a + '%'}</b>${trend}</div>
    </div>
    <div class="card stack g10" style="padding:14px 16px">
      <b style="font-size:15px">Your report for parents</b>
      <span style="font-size:14px;line-height:1.5;color:#374151">A one-page summary of this week: practice, scores by chapter, what is improving and what needs work.</span>
      <label for="name" style="font-size:13px;font-weight:600;color:#4B5563">Your name on the report</label>
      <input id="name" class="input" autocomplete="given-name" placeholder="e.g. Ka Yan" value="${esc(local.name)}">
      <a id="preview" href="#" style="font-size:14px;font-weight:600;color:#0F766E">Preview the report</a>
    </div>
    <div id="fallback"></div>
  </main>
  <div class="sheet sticky">
    <button class="btn" id="send" style="display:flex;gap:10px;align-items:center;justify-content:center">${ICON.upload} Send report to parent</button>
    <span class="hint" style="text-align:center">Opens WhatsApp or another app with a link. Your parent doesn't need to sign in.</span>
  </div>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  const nameEl = document.getElementById('name');
  nameEl.oninput = () => { local.name = nameEl.value.trim().slice(0, 30); saveLocal(); };
  const link = async () => { const rep = await currentReport(); return { rep, url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}report.html#d=${encodeReport(rep)}` }; };
  document.getElementById('preview').onclick = async (e) => { e.preventDefault(); const { url } = await link(); window.open(url, '_blank', 'noopener'); };
  document.getElementById('send').onclick = async () => {
    const { rep, url } = await link();
    const text = LANG === 'zh' ? `${headline(rep)}。這是${rep.n || '我'}本週的 PrepBuddy 報告：` : `${headline(rep)}. Here is ${rep.n ? rep.n + '\u2019s' : 'my'} PrepBuddy report for this week:`;
    if (navigator.share) {
      try { await navigator.share({ title: LANG === 'zh' ? 'PrepBuddy 每週報告' : 'PrepBuddy weekly report', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    document.getElementById('fallback').innerHTML = `<div class="card stack g10" style="padding:14px 16px">
      <b style="font-size:15px">Send the report</b>
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}" target="_blank" rel="noopener">Send on WhatsApp</a>
      <button class="btn ghost" id="copy">Copy the link</button></div>`;
    document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link:', url); } };
    document.getElementById('fallback').scrollIntoView({ behavior: 'smooth' });
  };
}

/* ---------- AI usage on this device ---------- */
function renderUsage() {
  const u = local.usage || {};
  const steps = [['warm', 'Storing the chapter (cache)'], ['generate', 'Writing questions'], ['verify', 'Checking questions'], ['mark', 'Marking answers']];
  const fmt = (n) => (n || 0).toLocaleString('en');
  const tot = { calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0 };
  const usd = (n) => '$' + (n || 0).toFixed((n || 0) >= 1 ? 2 : 3);
  steps.forEach(([k]) => { const r = u[k]; if (r) for (const f in tot) tot[f] += r[f] || 0; });
  const rows = steps.map(([k, name]) => { const r = u[k] || {}; return `<tr><th scope="row">${name}</th><td>${fmt(r.calls)}</td><td>${fmt(r.input)}</td><td>${fmt(r.cache_write)}</td><td>${fmt(r.cache_read)}</td><td>${fmt(r.output)}</td><td><b>${usd(r.usd)}</b></td></tr>`; }).join('');
  const made = u.made || 0;
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">AI usage on this device</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:#374151">Tokens used since you last reset. Reading PDFs happens on your device and uses no tokens.</p>
    <div style="overflow-x:auto"><table class="data usage">
      <tr><th>Step</th><th>AI calls</th><th>Input</th><th>Cache write</th><th>Cache read</th><th>Output</th><th>Cost (USD)</th></tr>
      ${rows}
      <tr><th scope="row">Total</th><td>${fmt(tot.calls)}</td><td>${fmt(tot.input)}</td><td>${fmt(tot.cache_write)}</td><td>${fmt(tot.cache_read)}</td><td>${fmt(tot.output)}</td><td><b>${usd(tot.usd)}</b></td></tr>
    </table></div>
    <p style="margin:0;font-size:15px;line-height:1.5">Estimated cost: <b>${usd(tot.usd)}</b>${made ? ` · about ${usd((tot.usd - ((u.mark || {}).usd || 0)) / made)} per question made` : ''}${(u.mark || {}).requests ? ` · ${usd(u.mark.usd / u.mark.requests)} per answer marked` : ''}</p>
    <p class="muted" style="margin:0;font-size:13px;line-height:1.5">Questions that passed checking: <b>${fmt(made)}</b>${made ? `<br>Per question: ${fmt(Math.round((tot.input + tot.cache_write) / made))} input · ${fmt(Math.round(tot.cache_read / made))} cache read · ${fmt(Math.round(tot.output / made))} output` : ''}.<br>
    Costs are estimates from Claude's published prices; your bill on console.anthropic.com is the exact figure. Older entries made before this update have no cost recorded.</p>
    <button class="btn ghost" id="reset">Reset the counter</button>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  document.getElementById('reset').onclick = () => { local.usage = {}; saveLocal(); renderUsage(); };
}

/* ---------- removing a textbook ---------- */
async function confirmRemove(book) {
  const prefix = `${book.id}:`;
  let made = 0;
  for (const u of book.units) made += (await getQs(book.id, u.id)).length;
  const answered = Object.keys(local.stats).filter((k) => k.startsWith(prefix)).length;
  const activity = local.log.filter((e) => e.q.startsWith(prefix)).length;
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button></div>
  <main class="pad stack g18" style="flex:1;padding-top:4px">
    <h1 class="display" style="margin:0;font-size:24px;line-height:1.25">Remove this textbook?</h1>
    <p style="margin:0;font-size:16px;line-height:1.5;font-weight:600" data-raw>${esc(book.title)}</p>
    <div class="card stack g8" style="padding:14px 16px;border-color:#F3C9B1;background:#FFF8F3">
      <b style="color:#9A3412">This deletes from this device:</b>
      <ul style="margin:0;padding-left:20px;line-height:1.7;color:#374151">
        <li>${made} practice question${made === 1 ? '' : 's'}</li>
        <li>your scores on ${answered} question${answered === 1 ? '' : 's'}, and their spaced-review schedule</li>
        <li>${activity} answer${activity === 1 ? '' : 's'} in your progress history (used for parent reports)</li>
      </ul>
      <span style="color:#374151;line-height:1.5">This can't be undone. ${book.library ? 'You can add the book again from the library, but your progress will start from zero.' : 'To use it again you will need to upload the PDF again.'}</span>
    </div>
  </main>
  <div class="sheet sticky">
    <button class="btn danger" id="yes">Remove and delete my progress</button>
    <button class="btn ghost" id="no">Keep this textbook</button>
  </div>`;
  const back = () => go({ name: 'book', bookId: book.id });
  document.getElementById('back').onclick = back;
  document.getElementById('no').onclick = back;
  document.getElementById('yes').onclick = async () => {
    const books = (await store.get('books', [])).filter((b) => b.id !== book.id);
    await store.set('books', books);
    for (const k of await store.keys(`text:${book.id}:`)) await store.del(k);
    for (const k of await store.keys(`qs:${book.id}:`)) await store.del(k);
    for (const k of Object.keys(local.stats)) if (k.startsWith(prefix)) delete local.stats[k];
    local.log = local.log.filter((e) => !e.q.startsWith(prefix));
    local.reports = local.reports.filter((id) => !id.startsWith(prefix));
    saveLocal();
    pick = { bookId: null, ids: new Set() };
    toast('Textbook and its progress removed');
    go({ name: 'home' });
  };
  window.scrollTo(0, 0);
}

/* ---------- papers: DSE-style mock and printable worksheets ----------
   A paper = Section A (multiple choice) + Section B (written). It is fully prepared before it starts or prints:
   unused questions first, new ones made for what's missing, and only then questions used before. */
const PAPER_PRESETS = [['short', 'Short', 10, 2], ['half', 'Half paper', 18, 4], ['full', 'Full paper', 36, 8]];
const paperMinutes = (a, b) => Math.max(5, Math.round((a * 1.5 + b * 7) / 5) * 5);
const isMcqLike = choiceType;
let paperSet = { a: 10, b: 2 };
let paperJob = null;

function paperUnits(book) {
  return pick.bookId === book.id && pick.ids.size ? book.units.filter((u) => pick.ids.has(u.id)) : book.units;
}

async function renderPaper(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = paperUnits(book);
  const { a, b } = paperSet;
  const mins = paperMinutes(a, b);
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button><span style="font-weight:600;font-size:15px">Mock paper or worksheet</span></div>
  <main class="stack g18" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:#374151">A DSE-style paper: <b>Section A</b> multiple choice, then <b>Section B</b> written questions. Sit it timed here and get it marked, or print it with an answer key.</p>
    <div class="card stack g6" style="padding:14px 16px">
      <span class="muted" style="font-size:13px">Chapters</span>
      <b style="font-weight:600;line-height:1.4">${units.length === book.units.length ? `All ${book.units.length} chapters` : esc(units.map((u) => u.title).join(' · '))}</b>
      <button class="link" id="change" style="align-self:flex-start;padding:4px 0 0">Change chapters</button>
    </div>
    <div class="stack g10">
      <span style="font-size:15px;font-weight:600">Length</span>
      <div class="chips-row">${PAPER_PRESETS.map(([k, l, pa, pb]) => `<button class="choice ${pa === a && pb === b ? 'on' : ''}" data-preset="${k}"><b>${l}</b><span>${pa} MCQ · ${pb} written · ${paperMinutes(pa, pb)} min</span></button>`).join('')}</div>
    </div>
    <div class="card stack g14" style="padding:14px 16px">
      <div class="setup-row"><span>Section A · MCQ</span><div class="stepper"><button data-step="a:-2" aria-label="Fewer MCQs" ${a <= 0 ? 'disabled' : ''}>−</button><output>${a}</output><button data-step="a:2" aria-label="More MCQs" ${a >= 40 ? 'disabled' : ''}>+</button></div></div>
      <div class="setup-row"><span>Section B · Written</span><div class="stepper"><button data-step="b:-1" aria-label="Fewer written questions" ${b <= 0 ? 'disabled' : ''}>−</button><output>${b}</output><button data-step="b:1" aria-label="More written questions" ${b >= 10 ? 'disabled' : ''}>+</button></div></div>
      <span class="muted" style="font-size:14px">Time allowed: <b style="color:#14181F">${mins} min</b></span>
    </div>
  </main>
  <div class="sheet sticky">
    <button class="btn" id="sit" ${a + b ? '' : 'disabled'}>Start mock paper · ${mins} min</button>
    <button class="btn ghost" id="print" ${a + b ? '' : 'disabled'}>Print worksheet with answer key</button>
  </div>`;
  document.getElementById('back').onclick = () => go({ name: 'book', bookId });
  document.getElementById('change').onclick = () => go({ name: 'book', bookId });
  $app.querySelectorAll('[data-preset]').forEach((el) => (el.onclick = () => { const p = PAPER_PRESETS.find((x) => x[0] === el.dataset.preset); paperSet = { a: p[2], b: p[3] }; renderPaper(bookId); }));
  $app.querySelectorAll('[data-step]').forEach((el) => (el.onclick = () => {
    const [k, d] = el.dataset.step.split(':'); const max = k === 'a' ? 40 : 10;
    paperSet = { ...paperSet, [k]: Math.min(max, Math.max(0, paperSet[k] + Number(d))) }; renderPaper(bookId);
  }));
  const go2 = async (purpose) => {
    try {
      const paper = await preparePaper(book, units, a, b, purpose);
      if (!paper) return;
      if (purpose === 'print') renderPrint(book, units, paper, mins); else startDse(book, paper, mins);
    } catch (e) {
      if (e.status === 401) return renderAccess(() => renderPaper(bookId), 'That access code didn’t work.');
      toast(e.status === 0 ? 'You seem to be offline.' : (e.message || 'Could not prepare the paper.'));
      renderPaper(bookId);
    }
  };
  document.getElementById('sit').onclick = () => go2('sit');
  document.getElementById('print').onclick = () => go2('print');
}

async function preparePaper(book, units, nA, nB, purpose) {
  const token = {}; paperJob = token;
  const total = nA + nB;
  $app.innerHTML = `<div class="topbar"><button class="icon-btn" id="cancel" aria-label="Cancel">${ICON.close}</button></div>
  <main class="pad stack g18" style="flex:1;justify-content:center;text-align:center;align-items:center">
    <div class="spinner" aria-hidden="true"></div>
    <h1 class="display" style="margin:0;font-size:22px">Preparing your paper</h1>
    <div class="progress" style="width:100%;max-width:300px"><i id="pp" style="width:0%"></i></div>
    <p class="muted" id="pt" style="margin:0;line-height:1.5;max-width:320px">Checking which questions are ready…</p>
  </main>`;
  document.getElementById('cancel').onclick = () => { paperJob = null; go({ name: 'paper', bookId: book.id }); };
  const show = (have) => {
    const el = document.getElementById('pp'), t = document.getElementById('pt');
    if (el) el.style.width = `${Math.round(100 * Math.min(have, total) / total)}%`;
    if (t) t.textContent = `${Math.min(have, total)} of ${total} questions ready. New ones are written from your textbook and checked first, so a long paper can take a few minutes the first time.`;
  };
  const printed = new Set(local.printed || []);
  const fresh = (q) => (purpose === 'print' ? !printed.has(q.id) : !local.stats[q.id]);
  const pool = async () => { const all = []; for (const u of units) all.push(...await getQs(book.id, u.id)); return all; };
  const take = (all, mcq, n) => shuffle(all.filter((q) => isMcqLike(q) === mcq && fresh(q))).slice(0, n);
  let all = await pool();
  let A = take(all, true, nA), B = take(all, false, nB);
  show(A.length + B.length);
  for (let round = 0; round < 4 && (A.length < nA || B.length < nB); round++) {
    if (paperJob !== token) return null;
    const jobs = [];
    const needA = nA - A.length, needB = nB - B.length;
    if (needA > 0) units.forEach((u) => jobs.push(ensureFill(book, u, Math.ceil(needA / units.length), 'mcq')));
    if (needB > 0) units.forEach((u) => jobs.push(ensureFill(book, u, Math.ceil(needB / units.length), 'written')));
    let made = 0; const base = A.length + B.length;
    jobs.forEach((j) => j.listeners.add((passed) => { made += passed.length; if (paperJob === token) show(base + made); }));
    await Promise.all(jobs.map((j) => j.promise));
    const hard = jobs.map((j) => j.error).find((e) => e && (e.status === 0 || e.status === 401));
    if (hard) throw hard;
    all = await pool(); A = take(all, true, nA); B = take(all, false, nB);
    show(A.length + B.length);
    if (!jobs.some((j) => j.made)) break;
  }
  if (paperJob !== token) return null;
  // Still short (chapter ran out of new material): reuse questions used before.
  if (A.length < nA) A.push(...shuffle(all.filter((q) => isMcqLike(q) && !A.includes(q))).slice(0, nA - A.length));
  if (B.length < nB) B.push(...shuffle(all.filter((q) => !isMcqLike(q) && !B.includes(q))).slice(0, nB - B.length));
  if (!A.length && !B.length) throw new Error('No questions could be made for these chapters.');
  if (A.length + B.length < total) toast(`Only ${A.length + B.length} questions could be prepared for these chapters.`);
  return { A: shuffle(A).map(shuffleOptions), B: shuffle(B) };
}

function startDse(book, paper, mins) {
  const qs = [...paper.A, ...paper.B];
  S = newSession({ mode: 'dse', title: 'DSE-style mock paper', book, qs, target: qs.length, sectionA: paper.A.length, deadline: Date.now() + mins * 60 * 1000 });
  renderQuestion();
  toast(paper.A.length ? `Section A: ${paper.A.length} multiple-choice questions` : 'Section B: written questions');
}

function renderPrint(book, units, paper, mins) {
  const qs = [...paper.A, ...paper.B];
  local.printed = [...new Set([...(local.printed || []), ...qs.map((q) => q.id)])].slice(-3000); saveLocal();
  const total = qs.reduce((s, q) => s + marksOf(q), 0);
  const chapterText = units.length === book.units.length ? 'All chapters' : units.map((u) => u.title).join(' · ');
  const lines = (n) => `<div class="lines">${'<div></div>'.repeat(n)}</div>`;
  const mcq = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">1 mark</span></div>${q.type === 'graph' ? graphStem(q) : renderStem(q.stem, 'pstem')}
    ${q.type === 'graph' ? graphOptions(q, true) : `<ol type="A" class="popts">${(q.options || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`}</div>`;
  const written = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">${marksOf(q)} marks</span></div>${q.stem ? renderStem(q.stem, 'pstem') : ''}
    ${q.parts.map((p) => `<div class="ppart"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="pm">(${p.marks})</span></div>${lines(Math.max(2, p.marks + 1))}`).join('')}</div>`;
  const key = qs.map((q, i) => `<div class="pk"><b>${i + 1}.</b> ${isMcqLike(q) ? `<b>${esc(q.correct_option)}</b>` : ''}
    ${isMcqLike(q) ? '' : q.parts.map((p) => `<div><b>${esc(p.label || '')}</b> (${p.marks} mark${p.marks > 1 ? 's' : ''})<ul>${p.mark_scheme.map((pt) => `<li>${esc(pt)}</li>`).join('')}</ul></div>`).join('')}
    <div class="pexp">${esc(q.explanation)}${q.pages ? ` <span class="psrc">(${esc(q.section)}, pp. ${esc(q.pages)})</span>` : ''}</div></div>`).join('');
  $app.innerHTML = `
  <div class="noprint topbar"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button><span style="font-weight:600;font-size:15px">Worksheet ready</span></div>
  <div class="noprint stack g8" style="padding:0 20px 16px">
    <button class="btn" id="doprint">Print or save as PDF</button>
    <span class="hint">On a phone: tap the button, then choose <b>Save as PDF</b> or share the PDF. The answer key starts on a new page.</span>
  </div>
  <article class="paper">
    <h1 data-raw>${esc(book.title)}</h1>
    <p class="pmeta">${esc(chapterText)}<br>${paper.A.length ? `Section A: ${paper.A.length} multiple choice · ` : ''}${paper.B.length ? `Section B: ${paper.B.length} written · ` : ''}Time: ${mins} min · Total: ${total} marks</p>
    <div class="pfields"><span>Name:</span><span>Class:</span><span>Score: &nbsp;&nbsp;&nbsp;&nbsp; / ${total}</span></div>
    ${paper.A.length ? `<h2>Section A · Multiple choice</h2><p class="pnote">Choose the best answer for each question.</p>${paper.A.map((q, i) => mcq(q, i + 1)).join('')}` : ''}
    ${paper.B.length ? `<h2>Section B · Written</h2><p class="pnote">Answer all questions in the spaces provided.</p>${paper.B.map((q, i) => written(q, paper.A.length + i + 1)).join('')}` : ''}
    <section class="pkey"><h1>Answer key</h1>${key}</section>
    <p class="pfoot">Made with PrepBuddy from ${esc(book.title)}.${book.credit ? ' ' + esc(book.credit) : ''} Questions are written and checked by AI.</p>
  </article>`;
  document.getElementById('back').onclick = () => go({ name: 'book', bookId: book.id });
  document.getElementById('doprint').onclick = () => window.print();
  window.scrollTo(0, 0);
}

/* ---------- sessions ---------- */
const isExam = () => !!S && (S.mode === 'mock' || S.mode === 'dse');

function newSession(props) {
  return Object.assign({ i: 0, answers: [], got: [], ticks: {}, marks: {}, phase: 'answer', review: false, deadline: null, waiting: false, generating: false, error: null }, props);
}

// A session over one or more chapters: questions are spread evenly across them.
// A session over one or more chapters. Ready questions are used first; new ones are made a few at a time,
// staying about AHEAD questions in front of the student, so stopping early wastes little.
const AHEAD = 6;
async function startUnits(book, units, count = SESSION_SIZE) {
  const k = units.length, quota = Math.ceil(count / k);
  const types = local.types || 'mix';
  const pools = [];
  for (const u of units) pools.push(shuffle((await getQs(book.id, u.id)).filter((q) => !local.stats[q.id] && matchType(q, types))));
  let qs = [];
  pools.forEach((p) => qs.push(...p.slice(0, quota)));
  if (qs.length < count) pools.forEach((p) => qs.push(...p.slice(quota)));   // top up from chapters that have more
  qs = shuffle(qs.slice(0, count));
  const title = k === 1 ? units[0].title : `${k} chapters`;
  S = newSession({ mode: 'unit', title, book, units, qs, target: count, pending: 0, types, count });
  topUp(S);
  if (S.qs.length) renderQuestion(); else renderWaiting();
}

// Ask for just enough new questions to stay AHEAD in front of the student.
function topUp(sess) {
  if (sess.mode === 'drill') return pumpDrills(sess);
  if (!sess.units || sess.generating || sess.error) return;
  const ahead = sess.qs.length - (sess.i + 1);
  const need = Math.min(sess.target - sess.qs.length, AHEAD - ahead);
  if (need <= 0) return;
  // spread across the chosen chapters, starting with the ones that have given fewest questions so far
  const used = (u) => sess.qs.filter((q) => q.id.startsWith(`${sess.book.id}:${u.id}:`)).length;
  const order = [...sess.units].sort((a, b) => used(a) - used(b));
  const per = Math.ceil(need / order.length);
  let left = need;
  for (const u of order) {
    if (left <= 0) break;
    const want = Math.min(per, left); left -= want;
    followFill(sess, ensureFill(sess.book, u, want, sess.types));
  }
}

async function startReview(mode) {
  const items = await allQuestions();
  if (items.length < 4) return toast('Practise a chapter first, then come back here.');
  let pick;
  if (mode === 'spaced') {
    pick = (await dueItems()).slice(0, 15).map((x) => shuffleOptions(x.q));
    if (!pick.length) return toast('Nothing to review today.');
    S = newSession({ mode: 'spaced', title: 'Spaced review', qs: shuffle(pick), target: pick.length });
    return renderQuestion();
  }
  if (mode === 'weak') {
    const tried = items.filter((x) => local.stats[x.q.id]);
    if (tried.length < 3) return toast('Answer a few questions first, so PrepBuddy knows your weak spots.');
    pick = shuffle(tried).sort((a, b) => local.stats[a.q.id].last - local.stats[b.q.id].last).slice(0, SESSION_SIZE).map((x) => x.q);
    S = newSession({ mode: 'weak', title: 'Weak topics', qs: pick, target: pick.length });
  } else {
    pick = shuffle(items).slice(0, 12).map((x) => x.q).sort((a, b) => a.level - b.level);
    S = newSession({ mode: 'mock', title: 'Mini mock', qs: pick, target: pick.length, deadline: Date.now() + 20 * 60 * 1000 });
  }
  renderQuestion();
}

/* ---------- making questions on demand ---------- */
// One background job per chapter. Several batches run side by side, each on a different
// part of the chapter, so 10 questions take about as long as 3 used to.
const jobs = new Map();
const warmed = new Map(); // chapter -> when its text was last put in the AI's cache
const PARALLEL = 3;

function ensureFill(book, unit, want, types = 'mix') {
  const key = `${book.id}:${unit.id}:${types}`;
  if (jobs.has(key)) { const j = jobs.get(key); j.want = Math.max(j.want, want); return j; }
  const job = { want, made: 0, error: null, done: false, listeners: new Set(), plan: PLANS[types] || PLAN };
  jobs.set(key, job);
  job.promise = doFill(book, unit, job)
    .catch((e) => { job.error = e; if (e.status === 401) { local.code = ''; saveLocal(); } })
    .finally(() => { job.done = true; jobs.delete(key); job.listeners.forEach((f) => f([], true)); });
  return job;
}

async function doFill(book, unit, job) {
  const title = unit.title;
  const text = await store.get(`text:${book.id}:${unit.id}`, '');
  if (!text) throw new Error('This chapter\u2019s text is missing on this device. Try uploading the book again.');
  const wk = `${book.id}:${unit.id}`;
  if (!warmed.has(wk) || Date.now() - warmed.get(wk) > 4 * 60 * 1000) {
    try { await api('warm', { title, text }); } catch (e) { if (e.status === 401 || e.status === 0) throw e; }
  }
  warmed.set(wk, Date.now());
  let started = (await getQs(book.id, unit.id)).length;
  let empty = 0, stop = false;
  const worker = async (w) => {
    for (let round = 0; round < 3 && !stop && job.made < job.want; round++) {
      const existing = await getQs(book.id, unit.id);
      const slot = started; started += BATCH;
      const items = Array.from({ length: BATCH }, (_, k) => job.plan[(slot + k) % job.plan.length]).map(([level, type]) => ({ level, type }));
      const avoid = existing.map((q) => (q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200));
      const focus = { part: ((slot / BATCH) % PARALLEL) + 1, of: PARALLEL };
      let gen;
      try { gen = await api('generate', { title, text, items, avoid, focus, lang: langOf(text) }); }
      catch (e) { if (e.status === 401 || e.status === 0) { stop = true; throw e; } if (!job.error) job.error = e; continue; }
      if (!gen.questions || !gen.questions.length) { if (++empty >= 2) stop = true; continue; }
      const checked = await Promise.all(gen.questions.map((q) =>
        api('verify', { title, text, question: q }).then((v) => ({ q, v })).catch((e) => { if (e.status === 401) { stop = true; throw e; } return { q, v: { passed: false } }; })));
      const passed = checked.filter((x) => x.v.passed && usable(x.q)).map((x) => x.q);
      if (!passed.length) continue;
      passed.forEach((q) => {
        q.id = `${book.id}:${unit.id}:${uid()}`;
        q.section = title;
        q.pages = unit.startPage ? `${unit.startPage}-${unit.endPage}` : '';
      });
      await addToBank(book.id, unit.id, passed);
      job.made += passed.length;
      const t = local.usage.made || 0; local.usage.made = t + passed.length; saveLocal();
      job.listeners.forEach((f) => f(passed, false));
    }
  };
  const n = Math.min(PARALLEL, Math.ceil(job.want / BATCH));
  const results = await Promise.allSettled(Array.from({ length: n }, (_, w) => worker(w)));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  if (!job.made && empty) throw new Error('No questions could be made from this chapter. It may not have enough teaching content.');
  if (job.made) job.error = null;
}

let bankChain = Promise.resolve();
function addToBank(bookId, unitId, qs) {
  bankChain = bankChain.then(async () => { const list = await getQs(bookId, unitId); list.push(...qs); await setQs(bookId, unitId, list); });
  return bankChain;
}

function followFill(sess, job) {
  sess.pending = (sess.pending || 0) + 1;
  sess.generating = true; sess.error = null;
  const listener = (passed, done) => {
    if (sess !== S) { job.listeners.delete(listener); return; }
    const have = new Set(sess.qs.map((q) => q.id));
    // new questions join the part of the session not yet answered, in random order
    const fresh = passed.filter((q) => !have.has(q.id) && matchType(q, sess.types)).slice(0, Math.max(0, sess.target - sess.qs.length));
    fresh.forEach((q) => {
      const lo = Math.min(sess.i + 1, sess.qs.length);
      sess.qs.splice(lo + Math.floor(Math.random() * (sess.qs.length - lo + 1)), 0, q);
    });
    if (done) {
      sess.pending--;
      if (job.error && !sess.error) sess.error = job.error;
      sess.generating = sess.pending > 0;
      if (!job.made) sess.dry = (sess.dry || 0) + 1; else sess.dry = 0;
      if (!sess.generating && sess.qs.length < sess.target && !sess.error) {
        // the chapter has run out of new material: end the session at what we have
        if (sess.dry >= 2) sess.target = Math.max(sess.qs.length, sess.i + 1);
        else topUp(sess);
      }
    }
    sessionGrew(done && !sess.generating);
  };
  job.listeners.add(listener);
}

function refill(sess) {
  sess.error = null; sess.dry = 0;
  sess.target = Math.max(sess.target, sess.qs.length + 1);
  topUp(sess);
}

function sessionGrew(done) {
  if (!S) return;
  if (S.waiting) {
    if (S.i < S.qs.length) { S.waiting = false; renderQuestion(); }
    else if (done) renderWaiting();
  } else {
    const c = document.getElementById('count'); if (c) c.textContent = `${S.i + 1} / ${S.target}`;
  }
}

function renderWaiting() {
  S.waiting = true;
  const e = S.error;
  if (e && e.status === 401) return renderAccess(() => { refill(S); renderWaiting(); }, 'That access code didn’t work. Please check it and try again.');
  const failed = !S.generating && S.i >= S.qs.length;
  $app.innerHTML = `<div class="topbar"><button class="icon-btn" id="quit" aria-label="End session">${ICON.close}</button><div class="progress"><i style="width:${Math.round(100 * S.i / Math.max(1, S.target))}%"></i></div><span class="count">${Math.min(S.i + 1, S.target)} / ${S.target}</span></div>
  <main class="pad stack g18" style="flex:1;justify-content:center;text-align:center;align-items:center">
    ${failed
      ? `<h1 class="display" style="margin:0;font-size:22px">${e ? 'Couldn’t make questions' : 'No more questions right now'}</h1>
         <p style="margin:0;line-height:1.5;max-width:320px">${esc(e ? e.message : 'Try this chapter again in a moment.')}</p>
         <button class="btn" id="retry" style="max-width:320px">Try again</button>
         ${S.qs.length ? '<button class="link" id="finish">See my results</button>' : '<button class="link" id="home">Back</button>'}`
      : `<div class="spinner" aria-hidden="true"></div>
         <h1 class="display" style="margin:0;font-size:22px">${S.qs.length ? 'Preparing the next question' : 'Writing your questions'}</h1>
         <p class="muted" style="margin:0;line-height:1.5;max-width:320px">${esc(S.mode === 'drill' ? 'New questions on the ideas you missed' : S.units ? S.units.map((u) => u.title).join(', ') : '')}<br>Each question is written from your textbook, then checked by a second AI. The first ones take 30–60 seconds; after that the next set is made while you practise.</p>`}
  </main>`;
  document.getElementById('quit').onclick = () => go({ name: 'home' });
  const r = document.getElementById('retry'); if (r) r.onclick = () => {
    if (S.mode === 'drill') { S.error = null; S.target = Math.max(S.target, S.qs.length + 1); pumpDrills(S); return renderWaiting(); }
    S.target = Math.max(S.target, SESSION_SIZE); refill(S); renderWaiting(); };
  const f = document.getElementById('finish'); if (f) f.onclick = () => { S.qs = S.qs.slice(0, S.i); renderSummary(); };
  const h = document.getElementById('home'); if (h) h.onclick = () => go({ name: 'book', bookId: S.book.id });
}

function renderAccess(onOk, msg) {
  $app.innerHTML = `<div class="topbar"><button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button></div>
  <main class="pad stack g14" style="flex:1">
    <h1 class="display" style="margin:0;font-size:24px">Enter your access code</h1>
    <p style="margin:0;line-height:1.5;color:#374151">PrepBuddy is in testing. You need a code to make new questions. Ask the person who invited you.</p>
    ${msg ? `<p style="margin:0;color:#9A3412;font-weight:600">${esc(msg)}</p>` : ''}
    <label for="code" style="font-size:13px;font-weight:600;color:#4B5563">Access code</label>
    <input id="code" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" value="">
    <button class="btn" id="ok">Continue</button>
  </main>`;
  const input = document.getElementById('code'); input.focus();
  const ok = () => { const v = input.value.trim(); if (!v) return; local.code = v; saveLocal(); onOk(); };
  document.getElementById('ok').onclick = ok;
  input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  document.getElementById('back').onclick = () => (S && S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' }));
}

/* ---------- weak-spot drills ---------- */
function missedIdea(q, idx) {
  if (choiceType(q)) {
    const opt = (L) => (q.options || [])['ABCD'.indexOf(L)] || '';
    return `Question: ${q.stem}\nCorrect answer: ${opt(q.correct_option)}\nThe student chose: ${opt(S.answers[idx]) || '(no answer)'}\nWhy: ${q.explanation}`;
  }
  const ticks = S.ticks[idx] || [];
  const m = (S.marks || {})[idx] || {};
  return q.parts.map((p, k) => {
    const missed = p.mark_scheme.filter((_, j) => !(ticks[k] || [])[j]);
    if (!missed.length) return '';
    const fb = m.parts && m.parts[k] ? `\nMarker's feedback: ${m.parts[k].feedback}` : '';
    return `Question part: ${p.prompt}\nPoints the student missed: ${missed.join('; ')}${fb}`;
  }).filter(Boolean).join('\n\n') || `Question: ${q.stem}`;
}

function canDrill(q) { return !!(q.id && q.id.split(':').length >= 3); }

// Make `n` checked questions on one missed idea. Saved to the chapter's bank.
async function makeDrill(q, idea, types, n = 2) {
  const [bookId, unitId] = q.id.split(':');
  const text = await store.get(`text:${bookId}:${unitId}`, '');
  if (!text) throw new Error('This chapter’s text is missing on this device.');
  const title = q.section;
  const wk = `${bookId}:${unitId}`;
  if (!warmed.has(wk) || Date.now() - warmed.get(wk) > 4 * 60 * 1000) { try { await api('warm', { title, text }); warmed.set(wk, Date.now()); } catch (e) { if (e.status === 0) throw e; } }
  const lv = Math.min(3, Math.max(2, q.level));
  const pool = types === 'mcq' ? [{ level: 2, type: 'mcq' }, { level: 3, type: 'mcq' }]
    : types === 'written' ? [{ level: 2, type: 'short' }, { level: lv, type: 'structured' }]
    : q.type === 'mcq' ? [{ level: 2, type: 'mcq' }, { level: 2, type: 'short' }] : [{ level: 2, type: 'short' }, { level: 2, type: 'mcq' }];
  const items = pool.slice(0, n);
  const avoid = [(q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200)];
  const gen = await api('generate', { title, text, items, avoid, target: idea, lang: langOf(text) });
  const checked = await Promise.all((gen.questions || []).map((x) =>
    api('verify', { title, text, question: x }).then((v) => ({ x, v })).catch((e) => { if (e.status === 401) throw e; return { x, v: { passed: false } }; })));
  const passed = checked.filter((c) => c.v.passed && usable(c.x)).map((c) => c.x);
  passed.forEach((x) => { x.id = `${bookId}:${unitId}:${uid()}`; x.section = title; x.pages = q.pages; x.drillOf = q.id; });
  if (passed.length) {
    await addToBank(bookId, unitId, passed);
    local.usage.made = (local.usage.made || 0) + passed.length; saveLocal();
  }
  return passed;
}

// A drill session after a test: 2 new questions per missed idea, made a few ideas ahead of the student.
const PER_IDEA = 2;
function startDrills(items, book, types) {
  S = newSession({ mode: 'drill', title: 'Weak-spot drill', book, qs: [], target: items.length * PER_IDEA, drillItems: items, drillNext: 0, types });
  pumpDrills(S);
  renderWaiting();
}
function pumpDrills(sess) {
  if (sess.generating || sess.error) return;
  const ahead = sess.qs.length - (sess.i + 1);
  if (ahead >= 4 || sess.drillNext >= sess.drillItems.length) return;
  const it = sess.drillItems[sess.drillNext++];
  sess.generating = true;
  makeDrill(it.q, it.idea, sess.types, PER_IDEA)
    .then((passed) => {
      if (sess !== S) return;
      sess.qs.push(...passed);
      sess.target -= PER_IDEA - passed.length;   // fewer came back: shorten the session
    })
    .catch((e) => { if (sess === S) sess.error = e; })
    .finally(() => {
      sess.generating = false;
      if (sess !== S) return;
      sess.target = Math.max(sess.target, sess.qs.length, 1);
      if (sess.drillNext >= sess.drillItems.length && !sess.error) sess.target = Math.max(sess.qs.length, sess.i + 1);
      pumpDrills(sess);
      sessionGrew(!sess.generating);
    });
}

/* ---------- graph questions ----------
   The AI gives each of the 4 options as points; the app draws them on the same scale. */
function graphScale(graphs) {
  const pts = graphs.flatMap((g) => g.points || []);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  return { x0, x1: x1 === x0 ? x0 + 1 : x1, y0, y1: y1 === y0 ? y0 + 1 : y1 };
}
function graphSVG(g, sc, label, print) {
  const W = 160, H = 118, L = 22, B = 22, T = 8, R = 8;
  const X = (x) => L + (x - sc.x0) / (sc.x1 - sc.x0) * (W - L - R);
  const Y = (y) => H - B - (y - sc.y0) / (sc.y1 - sc.y0) * (H - B - T);
  const pts = (g.points || []).slice().sort((a, b) => a[0] - b[0]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const ink = print ? '#111' : 'currentColor';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
    <path d="M${L} ${T - 2}V${H - B}H${W - R + 2}" fill="none" stroke="${ink}" stroke-width="1.2" opacity=".7"/>
    <path d="${line}" fill="none" stroke="${print ? '#111' : '#0F766E'}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="${ink}">${esc(g.x_label || '')}</text>
    <text transform="translate(10 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="9.5" fill="${ink}">${esc(g.y_label || '')}</text>
  </svg>`;
}
function graphStem(q) { return renderStem(q.stem, 'pstem'); }
function graphOptions(q, print) {
  const sc = graphScale(q.graphs || []);
  return `<div class="pgraphs">${(q.graphs || []).map((g, k) => `<div><b>${'ABCD'[k]}</b>${graphSVG(g, sc, `Graph ${'ABCD'[k]}: ${q.options[k] || ''}`, print)}</div>`).join('')}</div>`;
}

/* ---------- question screens ---------- */
function header() {
  const n = S.target, pct = Math.round(100 * S.i / Math.max(1, n));
  return `<div class="topbar">
    <button class="icon-btn" id="quit" aria-label="End session">${ICON.close}</button>
    <div class="progress" role="progressbar" aria-valuenow="${S.i}" aria-valuemin="0" aria-valuemax="${n}"><i style="width:${pct}%"></i></div>
    <span class="count">${S.deadline && !S.review ? '<span class="timer" id="timer"></span>' : `<span id="count">${S.i + 1} / ${n}</span>`}</span>
  </div>`;
}

function renderQuestion() {
  S.waiting = false;
  const q = S.qs[S.i];
  const body = choiceType(q) ? mcqBody(q, S.phase === 'revealed') : writtenBody(q, S.phase === 'revealed');
  $app.innerHTML = header() + `
  <main class="stack g18" style="flex:1;padding:8px 20px 20px">
    <div class="chips">${S.mode === 'dse' ? `<span class="chip sec">${S.i < S.sectionA ? 'Section A' : 'Section B'}</span>` : ''}<span class="chip">Level ${q.level} · ${LEVEL[q.level]}</span><span class="chip grey">${TYPE[q.type]} · ${marksOf(q)} mark${marksOf(q) > 1 ? 's' : ''}</span>${S.review ? '<span class="chip grey">Review</span>' : ''}</div>
    ${body.main}
  </main>
  ${body.footer}`;
  bindCommon(q);
  body.bind && body.bind();
  startTimer();
  window.scrollTo(0, 0);
}

function feedbackBits(q) {
  return `<p class="expl">${esc(q.explanation)}</p>
    ${q.source_quote ? `<p class="src">${esc(q.section || 'Textbook')}${q.pages ? `, pp. ${esc(q.pages)}` : ''}: “${esc(q.source_quote)}”</p>` : ''}
    <div style="display:flex;justify-content:flex-end"><button class="link quiet" id="report">Report a problem</button></div>`;
}
function nextLabel() {
  if (S.i < S.target - 1) return 'Next question';
  return isExam() && !S.review ? 'Finish and review' : 'See results';
}

function mcqBody(q, revealed) {
  const picked = S.answers[S.i];
  const sc = q.type === 'graph' ? graphScale(q.graphs || []) : null;
  const opts = (q.options || []).map((o, k) => {
    const L = 'ABCD'[k]; let cls = '';
    if (revealed) { if (L === q.correct_option) cls = 'right'; else if (L === picked) cls = 'wrong'; } else if (L === picked) cls = 'picked';
    const dot = revealed && L === q.correct_option ? ICON.check : L;
    if (q.type === 'graph') {
      return `<button class="opt gopt ${cls}" data-opt="${L}" ${revealed ? 'disabled' : ''} aria-pressed="${L === picked}" aria-label="Graph ${L}: ${esc(o)}"><span class="dot">${dot}</span>${graphSVG((q.graphs || [])[k] || {}, sc, `Graph ${L}: ${o}`)}${revealed ? `<span class="gcap">${esc(o)}</span>` : ''}</button>`;
    }
    return `<button class="opt ${cls}" data-opt="${L}" ${revealed ? 'disabled' : ''} aria-pressed="${L === picked}"><span class="dot">${dot}</span><span>${esc(o)}</span></button>`;
  }).join('');
  const right = picked === q.correct_option;
  const main = `${renderStem(q.stem, 'q')}<div class="${q.type === 'graph' ? 'ggrid' : 'stack g10'}">${opts}</div>`;
  let footer = '';
  if (revealed) footer = `<div class="sheet"><span class="verdict ${right ? 'ok' : 'no'}">${right ? 'Correct' : picked ? `Not quite. The answer is ${q.correct_option}.` : `No answer. The answer is ${q.correct_option}.`}</span>${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  else if (isExam()) footer = `<div class="pad" style="padding-top:0"><button class="btn" id="next" ${picked ? '' : 'disabled'}>${nextLabel()}</button></div>`;
  return { main, footer, bind() {
    $app.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => {
      S.answers[S.i] = b.dataset.opt;
      if (!isExam()) { S.phase = 'revealed'; S.got[S.i] = b.dataset.opt === q.correct_option ? 1 : 0; record(q, S.got[S.i]); }
      renderQuestion();
    }));
  } };
}

function partsGot(q) {
  const ticks = S.ticks[S.i];
  return (q.parts || []).reduce((s, p, k) => s + Math.min(p.marks, ticks ? ticks[k].filter(Boolean).length : 0), 0);
}

// Ask the AI to mark a written answer. The result pre-ticks the mark-scheme points;
// the student can still change a tick if they disagree.
async function markAnswer(sess, idx) {
  await null; // never re-render in the middle of drawing a screen
  const q = sess.qs[idx];
  const answers = sess.answers[idx] || q.parts.map(() => '');
  sess.marks = sess.marks || {};
  if (!answers.some((a) => (a || '').trim())) {
    sess.marks[idx] = { parts: q.parts.map(() => ({ awarded: [], feedback: 'No answer written.' })), tip: '' };
  } else {
    sess.marks[idx] = { pending: true };
    try {
      const [bookId, unitId] = q.id.split(':');
      const text = await store.get(`text:${bookId}:${unitId}`, '');
      if (!text) throw new Error('missing text');
      sess.marks[idx] = await api('mark', { title: q.section, text, question: q, answers, lang: langOf(q.stem + ' ' + q.parts.map((p) => p.prompt).join(' ')) });
    } catch (e) {
      sess.marks[idx] = { error: e.status === 0 ? 'You seem to be offline, so the AI could not mark this.' : 'The AI marker is not available right now.' };
    }
  }
  const m = sess.marks[idx];
  if (m.parts) sess.ticks[idx] = q.parts.map((p, k) => p.mark_scheme.map((_, j) => ((m.parts[k] || {}).awarded || []).includes(j)));
  if (sess === S && S.i === idx) { const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }
}

function writtenBody(q, revealed) {
  const ans = S.answers[S.i] || q.parts.map(() => '');
  const stem = q.stem ? renderStem(q.stem) : '';
  if (!revealed) {
    const parts = q.parts.map((p, k) => `<div class="part">
      <label class="ph" for="a${k}"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></label>
      <textarea id="a${k}" placeholder="Type, or tap the microphone on your keyboard to speak">${esc(ans[k])}</textarea></div>`).join('');
    const main = `${stem}${parts}<p class="hint">Aim for one clear point per mark.</p>`;
    const footer = `<div class="pad stack g8" style="padding-top:0"><button class="btn" id="check">${isExam() ? nextLabel() : 'Mark my answer'}</button>${isExam() ? '' : '<button class="link quiet" id="skip" style="align-self:center">Show the answer without trying</button>'}</div>`;
    return { main, footer, bind() {
      const grab = () => { S.answers[S.i] = [...$app.querySelectorAll('textarea')].map((t) => t.value); };
      $app.querySelectorAll('textarea').forEach((t) => (t.oninput = grab));
      document.getElementById('check').onclick = () => {
        grab();
        if (isExam()) return advance();
        S.phase = 'revealed'; markAnswer(S, S.i); renderQuestion();
      };
      const sk = document.getElementById('skip');
      if (sk) sk.onclick = () => { grab(); S.marks = S.marks || {}; S.marks[S.i] = { skipped: true }; S.phase = 'revealed'; renderQuestion(); };
    } };
  }
  S.marks = S.marks || {};
  // In a mock's review, written answers are marked as each one is shown.
  if (!S.marks[S.i]) markAnswer(S, S.i);
  const m = S.marks[S.i] || { pending: true };
  if (m.pending) {
    return {
      main: `${stem}${q.parts.map((p, k) => `<div class="part"><div class="ph"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></div>
        <div class="yours ${ans[k] && ans[k].trim() ? '' : 'empty'}">${ans[k] && ans[k].trim() ? esc(ans[k]) : 'No answer written'}</div></div>`).join('')}`,
      footer: `<div class="sheet" style="align-items:center;text-align:center"><div class="spinner" aria-hidden="true"></div><span class="verdict" style="color:#14181F">Marking your answer…</span><span class="hint">Checking it against the mark scheme, point by point.</span></div>`,
    };
  }
  const ai = !!m.parts;
  const ticks = S.ticks[S.i] || (S.ticks[S.i] = q.parts.map((p) => p.mark_scheme.map(() => false)));
  const partHtml = q.parts.map((p, k) => {
    const pm = ai ? m.parts[k] || {} : null;
    const got = Math.min(p.marks, ticks[k].filter(Boolean).length);
    return `<div class="part">
      <div class="ph"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></div>
      <div class="yours ${ans[k] && ans[k].trim() ? '' : 'empty'}">${ans[k] && ans[k].trim() ? esc(ans[k]) : 'No answer written'}</div>
      ${pm ? `<div class="marker ${got === p.marks ? 'full' : ''}"><b>${got} / ${p.marks}</b> ${esc(pm.feedback)}</div>` : ''}
      <span class="hint" style="font-weight:600">${ai ? 'Mark scheme (ticked = points you earned):' : m.skipped ? 'Mark scheme:' : `Tick each point your answer makes${p.mark_scheme.length > p.marks ? ` (max ${p.marks})` : ''}:`}</span>
      ${p.mark_scheme.map((pt, j) => `<button class="point ${ticks[k][j] ? 'on' : ''}" data-k="${k}" data-j="${j}" aria-pressed="${ticks[k][j]}"><span class="box">${ticks[k][j] ? ICON.check : ''}</span><span>${esc(pt.replace(/\s*\(1\)\s*$/, ''))}</span></button>`).join('')}
    </div>`;
  }).join('');
  const got = partsGot(q);
  const note = m.error ? `<p class="hint" style="margin:0;color:#9A3412">${esc(m.error)} Tick the points you made instead.</p>`
    : ai ? '<p class="hint" style="margin:0">Marked by AI. Think it got one wrong? Tap a point to change it.</p>' : '';
  const footer = `<div class="sheet"><span class="verdict ${got === marksOf(q) ? 'ok' : 'no'}">${got} / ${marksOf(q)} marks</span>
    ${m.tip ? `<p class="tipline"><b>Tip:</b> <span data-raw>${esc(m.tip)}</span></p>` : ''}${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${note}${partHtml}`, footer, bind() {
    $app.querySelectorAll('.point').forEach((b) => (b.onclick = () => { const k = +b.dataset.k, j = +b.dataset.j; ticks[k][j] = !ticks[k][j]; const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }));
  } };
}

function record(q, got) {
  const s = local.stats[q.id] || { seen: 0, got: 0, total: 0, last: 0 };
  s.seen++; s.got += got; s.total += marksOf(q); s.last = got / marksOf(q);
  schedule(s, got >= marksOf(q));
  local.stats[q.id] = s;
  // Activity log for progress reports: when, which question/chapter, marks, and how it was practised.
  local.log.push({ t: Date.now(), q: q.id, c: q.section || '', g: got, m: marksOf(q), l: q.level, k: (S && S.mode) || '' });
  if (local.log.length > 5000) local.log = local.log.slice(-5000);
  saveLocal();
}

let quitArmed = 0;
function endEarly() {
  if (isExam() && !S.review) return S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' });
  const q = S.qs[S.i];
  if (q && S.phase === 'revealed' && !choiceType(q) && (S.got[S.i] === undefined || S.got[S.i] === null) && !(S.marks[S.i] || {}).pending) {
    S.got[S.i] = partsGot(q); record(q, S.got[S.i]);
  }
  const answered = S.qs.map((_, k) => k).filter((k) => S.got[k] !== undefined && S.got[k] !== null);
  if (!answered.length) return S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' });
  const pickK = (arr) => answered.map((k) => (arr || [])[k]);
  const pickMap = (obj) => Object.fromEntries(answered.map((k, j) => [j, (obj || {})[k]]).filter(([, v]) => v !== undefined));
  S.answers = pickK(S.answers); S.ticks = pickMap(S.ticks); S.marks = pickMap(S.marks);
  S.qs = answered.map((k) => S.qs[k]); S.got = answered.map((k) => S.got[k]);
  S.i = S.qs.length - 1; S.target = S.qs.length; S.endedEarly = true;
  renderSummary();
}
function bindCommon(q) {
  document.getElementById('quit').onclick = () => {
    if (Date.now() - quitArmed < 2500) return endEarly();
    quitArmed = Date.now(); toast('Tap × again to stop and see your results');
  };
  const n = document.getElementById('next');
  if (n) n.onclick = () => {
    if (!choiceType(q) && S.phase === 'revealed') {
      const first = S.got[S.i] === undefined || S.got[S.i] === null;
      S.got[S.i] = partsGot(q);
      if (first) record(q, S.got[S.i]);
    }
    advance();
  };
  const r = document.getElementById('report');
  if (r) r.onclick = () => { if (!local.reports.includes(q.id)) { local.reports.push(q.id); saveLocal(); } toast('Thanks. This question is flagged for checking.'); };
}

function advance() {
  if (S.i < S.target - 1) {
    S.i++; S.phase = S.review ? 'revealed' : 'answer';
    if (S.mode === 'dse' && !S.review && S.i === S.sectionA && S.sectionA) toast('Section B: written questions');
    topUp(S);
    if (S.i < S.qs.length) return renderQuestion();
    if (!S.generating && !S.error && S.units) refill(S);
    return renderWaiting();
  }
  if (isExam() && !S.review) {
    S.qs.forEach((q, k) => { if (isMcqLike(q)) { S.got[k] = S.answers[k] === q.correct_option ? 1 : 0; record(q, S.got[k]); } });
    S.review = true; S.i = 0; S.phase = 'revealed'; stopTimer();
    toast('Time to review. Tick the points you made in written answers.');
    return renderQuestion();
  }
  renderSummary();
}

function renderSummary() {
  stopTimer();
  const qs = S.qs.slice(0, Math.max(S.i + 1, 0));
  const total = qs.reduce((s, q) => s + marksOf(q), 0), got = qs.reduce((s, q, k) => s + (S.got[k] || 0), 0);
  const pct = total ? Math.round(100 * got / total) : 0;
  const list = qs.map((q, k) => {
    const g = S.got[k] || 0, m = marksOf(q), full = g === m;
    const label = choiceType(q) ? q.stem : ((q.parts[0] && q.parts[0].prompt) || q.stem);
    return `<div class="res"><span class="tick ${full ? 'full' : 'part'}">${full ? ICON.check : g}</span><span style="flex:1">${esc(String(label).slice(0, 90))}${String(label).length > 90 ? '…' : ''}</span><span class="muted" style="white-space:nowrap">${g}/${m}</span></div>`;
  }).join('');
  const missed = qs.filter((q, k) => (S.got[k] || 0) < marksOf(q));
  const missedIdx = qs.map((q, k) => k).filter((k) => (S.got[k] || 0) < marksOf(qs[k]));
  const drillable = missedIdx.filter((k) => canDrill(qs[k])).slice(0, 10); // drill up to 10 missed ideas
  const unitRef = S.units ? { book: S.book, units: S.units } : null;
  $app.innerHTML = `<main class="pad stack g22" style="flex:1">
    <div class="stack g6"><span class="muted" style="font-size:13px">${esc(S.title)} · ${S.endedEarly ? `stopped after ${qs.length}` : 'done'}</span><span class="score">${got} / ${total}</span><span style="font-size:15px;font-weight:600;color:${pct >= 70 ? '#0F766E' : '#9A3412'}">${pct >= 85 ? 'Excellent work' : pct >= 70 ? 'Good, solid work' : pct >= 50 ? 'Getting there' : 'Worth another go'} · ${pct}%</span></div>
    ${S.mode === 'dse' ? (() => {
      const sec = (from, to) => { const xs = qs.slice(from, to); return [xs.reduce((a, q, k) => a + (S.got[from + k] || 0), 0), xs.reduce((a, q) => a + marksOf(q), 0)]; };
      const [ga, ta] = sec(0, S.sectionA), [gb, tb] = sec(S.sectionA, qs.length);
      return `<div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">${ta ? `<div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${ga} / ${ta}</b><span>Section A · MCQ</span></div>` : ''}${tb ? `<div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${gb} / ${tb}</b><span>Section B · written</span></div>` : ''}</div>`;
    })() : ''}
    <div class="card stack">${list}</div>
    ${S.mode === 'spaced' ? `<p class="hint" style="margin:0;line-height:1.5">Questions you got right come back later and later. The ones you missed come back tomorrow.</p>` : ''}
    <div class="stack g10">
      ${drillable.length ? `<button class="btn" id="drillall">${ICON.target.replace('width="22" height="22"', 'width="18" height="18"').replace('#C2410C', 'currentColor')} Drill my weak spots · ${drillable.length * PER_IDEA} new questions</button>` : ''}
      ${unitRef ? `<button class="btn ${drillable.length ? 'ghost' : ''}" id="more">${S.count || SESSION_SIZE} more on ${unitRef.units.length > 1 ? 'these chapters' : 'this chapter'}</button>` : ''}
      ${missed.length ? `<button class="btn ${unitRef ? 'ghost' : ''}" id="retry">Retry the ${missed.length} I missed</button>` : ''}
      ${qs.length ? '<button class="btn ghost" id="redo">Redo this set (shuffled)</button>' : ''}
      <button class="btn ghost" id="home">${S.book ? 'Back to chapters' : 'Back to home'}</button>
    </div></main>`;
  document.getElementById('home').onclick = () => (S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' }));
  const m = document.getElementById('more'); if (m) m.onclick = () => startUnits(unitRef.book, unitRef.units, S.count || SESSION_SIZE);
  const r = document.getElementById('retry');
  const again = (list, title) => { const l = shuffle(list).map(shuffleOptions); S = newSession({ mode: 'retry', title, book: S.book, qs: l, target: l.length }); renderQuestion(); };
  if (r) r.onclick = () => again(missed, 'Retry');
  const rd = document.getElementById('redo'); if (rd) rd.onclick = () => again(qs, 'Redo');
  const da = document.getElementById('drillall');
  if (da) da.onclick = () => {
    const items = drillable.map((k) => ({ q: qs[k], idea: missedIdea(qs[k], k) }));
    startDrills(items, S.book, S.types || 'mix');
  };
  window.scrollTo(0, 0);
}

// Same question, MCQ options in a new order (so a redo tests the idea, not the letter).
function shuffleOptions(q) {
  if (!choiceType(q) || !Array.isArray(q.options)) return q;
  const order = shuffle(q.options.map((_, i) => i));
  return { ...q, options: order.map((i) => q.options[i]), graphs: q.graphs ? order.map((i) => q.graphs[i]) : undefined, correct_option: 'ABCD'[order.indexOf('ABCD'.indexOf(q.correct_option))] };
}

/* ---------- mock timer ---------- */
let timerId = null;
function startTimer() {
  stopTimer();
  if (!S || !S.deadline || S.review) return;
  const tick = () => {
    const el = document.getElementById('timer');
    const left = Math.max(0, S.deadline - Date.now());
    if (el) { const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60; el.textContent = `${m}:${String(s).padStart(2, '0')}`; el.classList.toggle('low', left < 120000); }
    if (left <= 0) { stopTimer(); toast("Time's up"); S.i = S.target - 1; advance(); }
  };
  tick(); timerId = setInterval(tick, 1000);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

initLang();
watch(document.body);
go({ name: 'home' });
