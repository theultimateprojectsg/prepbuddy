// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { buildReport, encodeReport, headline } from './report.js';

/* ---------- settings ---------- */
const SESSION_SIZE = 10;
const BATCH = 3;            // questions requested per generate call
const BUFFER = 3;           // spare questions kept ready beyond the current session (costs credits)
// Mix of question kinds, cycled through as a chapter's bank grows.
const PLAN = [[1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
const LKEY = 'prepbuddy.v2';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '', usage: {}, log: [], name: '' }, loadLocal());
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) {} }

/* ---------- helpers ---------- */
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { 1: 'Recall', 2: 'Understand', 3: 'Apply', 4: 'Analyse / evaluate' };
const TYPE = { mcq: 'MCQ', short: 'Short answer', structured: 'Structured' };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const marksOf = (q) => (q.type === 'mcq' ? 1 : (q.parts || []).reduce((s, p) => s + p.marks, 0));
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
      <div class="top"><span style="display:flex;gap:10px;align-items:flex-start">${ICON.book}<span><b style="font-weight:600">${esc(b.title)}</b><br><span class="muted" style="font-size:13px">${b.subject ? esc(b.subject) + ' · ' : ''}${b.units.length} chapters · ${n} questions${b.library ? '' : ' · uploaded'}</span></span></span>
      <span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div></button>`);
  }
  $app.innerHTML = `
  <main class="pad stack g22" style="flex:1">
    <div><p class="muted" style="margin:0 0 2px;font-size:13px">Exam practice from your textbooks</p><h1 class="brand">PrepBuddy</h1></div>
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
            <b style="font-size:15px;line-height:1.35">${esc(b.title)}</b>
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
let pick = { bookId: null, on: false, ids: new Set() }; // chapter selection on the book screen

async function renderBook(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  if (pick.bookId !== bookId) pick = { bookId, on: false, ids: new Set() };
  const sel = pick.on;
  const rows = [];
  let lastChapter = null;
  for (const u of book.units) {
    if (u.chapter && u.chapter !== lastChapter) { rows.push(`<div class="chapter-head">${esc(u.chapter)}</div>`); lastChapter = u.chapter; }
    const qs = await getQs(book.id, u.id);
    const unseen = qs.filter((q) => !local.stats[q.id]).length;
    const sc = scoreOf(qs);
    const status = qs.length ? `${unseen} new · ${qs.length - unseen} done` : (sel ? 'Questions will be made' : 'Tap to make questions');
    const on = pick.ids.has(u.id);
    rows.push(`<button class="row ${sel ? 'selectable' : ''} ${on ? 'picked' : ''}" data-unit="${esc(u.id)}" ${sel ? `aria-pressed="${on}"` : ''}>
      <div class="top"><span style="display:flex;gap:12px;align-items:flex-start">${sel ? `<span class="box ${on ? 'on' : ''}" aria-hidden="true">${on ? ICON.check : ''}</span>` : ''}<span>${esc(u.title)}</span></span><span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div>
      <span class="muted" style="font-size:12px;${sel ? 'padding-left:36px' : ''}">${u.startPage ? `pp. ${u.startPage}–${u.endPage} · ` : ''}${status}</span>
      ${sc !== null && !sel ? `<div class="bar ${sc < 50 ? 'warn' : ''}"><i style="width:${sc}%"></i></div>` : ''}</button>`);
  }
  const n = pick.ids.size;
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(book.title)}</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <p class="muted" style="margin:0;font-size:14px;line-height:1.5">${sel ? 'Choose the chapters to mix together.' : 'Tap a chapter for 10 questions.'}</p>
      ${book.units.length > 1 ? `<button class="link" id="mode" style="white-space:nowrap">${sel ? 'Cancel' : 'Select chapters'}</button>` : ''}
    </div>
    ${sel ? `<button class="link" id="all" style="align-self:flex-start;padding:0">${n === book.units.length ? 'Clear all' : 'Select all'}</button>` : ''}
    <div class="card stack">${rows.join('')}</div>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.5">${book.library
      ? `From the PrepBuddy library · book code ${esc(book.code)}${book.credit ? `<br>Source: ${esc(book.credit)}` : ''}`
      : `Uploaded by you · ${book.pageCount} pages · chapters found from ${book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}`}</p>
    ${sel ? '' : '<button class="link quiet" id="delete" style="align-self:flex-start">Remove from my textbooks</button>'}
  </main>
  ${sel ? `<div class="sheet sticky"><button class="btn" id="go" ${n ? '' : 'disabled'}>${n ? `Practise ${n} chapter${n > 1 ? 's' : ''} · 10 questions` : 'Select at least one chapter'}</button></div>` : ''}`;
  const keepScroll = () => { const y = window.scrollY; return () => window.scrollTo(0, y); };
  document.getElementById('back').onclick = () => { pick = { bookId: null, on: false, ids: new Set() }; go({ name: 'home' }); };
  const m = document.getElementById('mode');
  if (m) m.onclick = () => { pick.on = !pick.on; pick.ids.clear(); renderBook(bookId); };
  const a = document.getElementById('all');
  if (a) a.onclick = async () => { const back = keepScroll(); if (pick.ids.size === book.units.length) pick.ids.clear(); else book.units.forEach((u) => pick.ids.add(u.id)); await renderBook(bookId); back(); };
  $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = async () => {
    const unit = book.units.find((u) => u.id === b.dataset.unit);
    if (!sel) return startUnits(book, [unit]);
    const back = keepScroll();
    pick.ids.has(unit.id) ? pick.ids.delete(unit.id) : pick.ids.add(unit.id);
    await renderBook(bookId); back();
  }));
  const g = document.getElementById('go');
  if (g) g.onclick = () => { const units = book.units.filter((u) => pick.ids.has(u.id)); pick.on = false; pick.ids.clear(); startUnits(book, units); };
  const d = document.getElementById('delete');
  if (d) d.onclick = async () => {
    if (!confirm(`Remove "${book.title}" from your textbooks? Its questions on this device are removed too.`)) return;
    const books = (await store.get('books', [])).filter((b) => b.id !== book.id);
    await store.set('books', books);
    for (const k of await store.keys(`text:${book.id}:`)) await store.del(k);
    for (const k of await store.keys(`qs:${book.id}:`)) await store.del(k);
    toast('Textbook removed'); go({ name: 'home' });
  };
  window.scrollTo(0, 0);
}

/* ---------- my progress + report for parents ---------- */
async function currentReport() {
  const books = await getBooks();
  const practised = new Set(local.log.filter((e) => e.t >= Date.now() - 7 * DAY).map((e) => e.q.split(':')[0]));
  const names = books.filter((b) => practised.has(b.id)).map((b) => b.subject || b.title);
  return buildReport({ log: local.log, stats: local.stats, name: local.name, books: [...new Set(names)] });
}

async function renderProgress() {
  const r = await currentReport();
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString('en-GB', { weekday: 'narrow' }));
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
    const text = `${headline(rep)}. Here is ${rep.n ? rep.n + '\u2019s' : 'my'} PrepBuddy report for this week:`;
    if (navigator.share) {
      try { await navigator.share({ title: 'PrepBuddy weekly report', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
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

/* ---------- sessions ---------- */
function newSession(props) {
  return Object.assign({ i: 0, answers: [], got: [], ticks: {}, marks: {}, phase: 'answer', review: false, deadline: null, waiting: false, generating: false, error: null }, props);
}

// A session over one or more chapters: questions are spread evenly across them.
async function startUnits(book, units) {
  const k = units.length, quota = Math.ceil(SESSION_SIZE / k);
  const pools = [];
  for (const u of units) pools.push(shuffle((await getQs(book.id, u.id)).filter((q) => !local.stats[q.id])));
  let qs = [];
  pools.forEach((p) => qs.push(...p.slice(0, quota)));
  if (qs.length < SESSION_SIZE) pools.forEach((p) => qs.push(...p.slice(quota)));   // top up from chapters that have more
  qs = shuffle(qs.slice(0, SESSION_SIZE));
  const title = k === 1 ? units[0].title : `${k} chapters`;
  S = newSession({ mode: 'unit', title, book, units, qs, target: SESSION_SIZE, pending: 0 });
  // Make only what this session still needs, plus a small buffer, while the student practises.
  const buffer = Math.max(1, Math.ceil(BUFFER / k));
  units.forEach((u, i) => {
    const used = qs.filter((q) => q.id.startsWith(`${book.id}:${u.id}:`)).length;
    const spare = pools[i].length - used;
    const want = Math.max(0, quota - used) + Math.max(0, buffer - spare);
    if (want > 0) followFill(S, ensureFill(book, u, want));
  });
  if (S.qs.length) renderQuestion(); else renderWaiting();
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

function ensureFill(book, unit, want) {
  const key = `${book.id}:${unit.id}`;
  if (jobs.has(key)) { const j = jobs.get(key); j.want = Math.max(j.want, want); return j; }
  const job = { want, made: 0, error: null, done: false, listeners: new Set() };
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
      const items = Array.from({ length: BATCH }, (_, k) => PLAN[(slot + k) % PLAN.length]).map(([level, type]) => ({ level, type }));
      const avoid = existing.map((q) => (q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200));
      const focus = { part: ((slot / BATCH) % PARALLEL) + 1, of: PARALLEL };
      let gen;
      try { gen = await api('generate', { title, text, items, avoid, focus }); }
      catch (e) { if (e.status === 401 || e.status === 0) { stop = true; throw e; } if (!job.error) job.error = e; continue; }
      if (!gen.questions || !gen.questions.length) { if (++empty >= 2) stop = true; continue; }
      const checked = await Promise.all(gen.questions.map((q) =>
        api('verify', { title, text, question: q }).then((v) => ({ q, v })).catch((e) => { if (e.status === 401) { stop = true; throw e; } return { q, v: { passed: false } }; })));
      const passed = checked.filter((x) => x.v.passed).map((x) => x.q);
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
    const fresh = passed.filter((q) => !have.has(q.id)).slice(0, Math.max(0, sess.target - sess.qs.length));
    fresh.forEach((q) => {
      const lo = Math.min(sess.i + 1, sess.qs.length);
      sess.qs.splice(lo + Math.floor(Math.random() * (sess.qs.length - lo + 1)), 0, q);
    });
    if (done) {
      sess.pending--;
      if (job.error && !sess.error) sess.error = job.error;
      sess.generating = sess.pending > 0;
      if (!sess.generating && sess.qs.length < sess.target && !sess.error) sess.target = Math.max(sess.qs.length, sess.i + 1);
    }
    sessionGrew(done && !sess.generating);
  };
  job.listeners.add(listener);
}

function refill(sess) {
  sess.error = null;
  sess.target = Math.max(sess.target, sess.qs.length + 1);
  const per = Math.ceil((sess.target - sess.qs.length) / sess.units.length);
  sess.units.forEach((u) => followFill(sess, ensureFill(sess.book, u, per)));
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
         <p class="muted" style="margin:0;line-height:1.5;max-width:320px">${esc(S.units ? S.units.map((u) => u.title).join(', ') : '')}<br>Each question is written from your textbook, then checked by a second AI. The first ones take 30–60 seconds; after that the next set is made while you practise.</p>`}
  </main>`;
  document.getElementById('quit').onclick = () => go({ name: 'home' });
  const r = document.getElementById('retry'); if (r) r.onclick = () => { S.target = Math.max(S.target, SESSION_SIZE); refill(S); renderWaiting(); };
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
  if (q.type === 'mcq') {
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

function canDrill(q) { return S.mode !== 'mock' && !S.review && q.id && q.id.split(':').length >= 3; }

async function drill(q) {
  const sess = S, idx = S.i;
  if (sess.drilling) return;
  sess.drilling = idx; sess.drilled = sess.drilled || {};
  const redraw = () => { if (sess === S && S.i === idx) { const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); } };
  redraw();
  try {
    const [bookId, unitId] = q.id.split(':');
    const text = await store.get(`text:${bookId}:${unitId}`, '');
    if (!text) throw new Error('This chapter\u2019s text is missing on this device.');
    const title = q.section;
    const wk = `${bookId}:${unitId}`;
    if (!warmed.has(wk) || Date.now() - warmed.get(wk) > 4 * 60 * 1000) { try { await api('warm', { title, text }); warmed.set(wk, Date.now()); } catch (e) {} }
    const items = [{ level: 1, type: 'mcq' }, { level: 2, type: 'mcq' }, { level: Math.min(3, Math.max(2, q.level)), type: 'short' }];
    const avoid = [(q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200)];
    const gen = await api('generate', { title, text, items, avoid, target: missedIdea(q, idx) });
    const checked = await Promise.all((gen.questions || []).map((x) =>
      api('verify', { title, text, question: x }).then((v) => ({ x, v })).catch(() => ({ x, v: { passed: false } }))));
    const passed = checked.filter((c) => c.v.passed).map((c) => c.x);
    passed.forEach((x) => { x.id = `${bookId}:${unitId}:${uid()}`; x.section = title; x.pages = q.pages; x.drillOf = q.id; });
    if (passed.length) {
      await addToBank(bookId, unitId, passed);
      local.usage.made = (local.usage.made || 0) + passed.length; saveLocal();
      if (sess === S) { sess.qs.splice(idx + 1, 0, ...passed); sess.target += passed.length; sess.drilled[idx] = passed.length; }
    } else {
      toast('Couldn\u2019t make drill questions this time. Try again.');
    }
  } catch (e) {
    toast(e.status === 0 ? 'You seem to be offline.' : (e.message || 'Something went wrong.'));
  } finally {
    sess.drilling = false;
    redraw();
  }
}

function drillButton(q, lost) {
  if (!lost || !canDrill(q)) return '';
  const done = S.drilled && S.drilled[S.i];
  if (done) return `<p class="hint" style="margin:0;color:#0F766E;font-weight:600">${ICON.check} ${done} drill question${done > 1 ? 's' : ''} on this idea come next</p>`;
  if (S.drilling === S.i) return '<button class="btn ghost" disabled><span class="spinner small" aria-hidden="true"></span> Making 3 questions on this idea…</button>';
  return `<button class="btn ghost" id="drill">${ICON.target.replace('width="22" height="22"', 'width="18" height="18"')} Drill this: 3 more like it</button>`;
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
  const body = q.type === 'mcq' ? mcqBody(q, S.phase === 'revealed') : writtenBody(q, S.phase === 'revealed');
  $app.innerHTML = header() + `
  <main class="stack g18" style="flex:1;padding:8px 20px 20px">
    <div class="chips"><span class="chip">Level ${q.level} · ${LEVEL[q.level]}</span><span class="chip grey">${TYPE[q.type]} · ${marksOf(q)} mark${marksOf(q) > 1 ? 's' : ''}</span>${S.review ? '<span class="chip grey">Review</span>' : ''}</div>
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
  return S.mode === 'mock' && !S.review ? 'Finish and review' : 'See results';
}

function mcqBody(q, revealed) {
  const picked = S.answers[S.i];
  const opts = (q.options || []).map((o, k) => {
    const L = 'ABCD'[k]; let cls = '';
    if (revealed) { if (L === q.correct_option) cls = 'right'; else if (L === picked) cls = 'wrong'; } else if (L === picked) cls = 'picked';
    const dot = revealed && L === q.correct_option ? ICON.check : L;
    return `<button class="opt ${cls}" data-opt="${L}" ${revealed ? 'disabled' : ''} aria-pressed="${L === picked}"><span class="dot">${dot}</span><span>${esc(o)}</span></button>`;
  }).join('');
  const right = picked === q.correct_option;
  const main = `${renderStem(q.stem, 'q')}<div class="stack g10">${opts}</div>`;
  let footer = '';
  if (revealed) footer = `<div class="sheet"><span class="verdict ${right ? 'ok' : 'no'}">${right ? 'Correct' : picked ? `Not quite. The answer is ${q.correct_option}.` : `No answer. The answer is ${q.correct_option}.`}</span>${feedbackBits(q)}${drillButton(q, !right)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  else if (S.mode === 'mock') footer = `<div class="pad" style="padding-top:0"><button class="btn" id="next" ${picked ? '' : 'disabled'}>${nextLabel()}</button></div>`;
  return { main, footer, bind() {
    $app.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => {
      S.answers[S.i] = b.dataset.opt;
      if (S.mode !== 'mock') { S.phase = 'revealed'; S.got[S.i] = b.dataset.opt === q.correct_option ? 1 : 0; record(q, S.got[S.i]); }
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
      sess.marks[idx] = await api('mark', { title: q.section, text, question: q, answers });
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
    const footer = `<div class="pad stack g8" style="padding-top:0"><button class="btn" id="check">${S.mode === 'mock' ? nextLabel() : 'Mark my answer'}</button>${S.mode === 'mock' ? '' : '<button class="link quiet" id="skip" style="align-self:center">Show the answer without trying</button>'}</div>`;
    return { main, footer, bind() {
      const grab = () => { S.answers[S.i] = [...$app.querySelectorAll('textarea')].map((t) => t.value); };
      $app.querySelectorAll('textarea').forEach((t) => (t.oninput = grab));
      document.getElementById('check').onclick = () => {
        grab();
        if (S.mode === 'mock') return advance();
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
    ${m.tip ? `<p class="expl"><b>Tip:</b> ${esc(m.tip)}</p>` : ''}${feedbackBits(q)}${drillButton(q, got < marksOf(q))}<button class="btn" id="next">${nextLabel()}</button></div>`;
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
function bindCommon(q) {
  document.getElementById('quit').onclick = () => {
    if (Date.now() - quitArmed < 2500) return S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' });
    quitArmed = Date.now(); toast('Tap × again to end this session');
  };
  const n = document.getElementById('next');
  if (n) n.onclick = () => {
    if (q.type !== 'mcq' && S.phase === 'revealed') {
      const first = S.got[S.i] === undefined || S.got[S.i] === null;
      S.got[S.i] = partsGot(q);
      if (first) record(q, S.got[S.i]);
    }
    advance();
  };
  const dr = document.getElementById('drill');
  if (dr) dr.onclick = () => drill(q);
  const r = document.getElementById('report');
  if (r) r.onclick = () => { if (!local.reports.includes(q.id)) { local.reports.push(q.id); saveLocal(); } toast('Thanks. This question is flagged for checking.'); };
}

function advance() {
  if (S.i < S.target - 1) {
    S.i++; S.phase = S.review ? 'revealed' : 'answer';
    if (S.i < S.qs.length) return renderQuestion();
    if (!S.generating && !S.error && S.units) refill(S);
    return renderWaiting();
  }
  if (S.mode === 'mock' && !S.review) {
    S.qs.forEach((q, k) => { if (q.type === 'mcq') { S.got[k] = S.answers[k] === q.correct_option ? 1 : 0; record(q, S.got[k]); } });
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
    const label = q.type === 'mcq' ? q.stem : ((q.parts[0] && q.parts[0].prompt) || q.stem);
    return `<div class="res"><span class="tick ${full ? 'full' : 'part'}">${full ? ICON.check : g}</span><span style="flex:1">${esc(String(label).slice(0, 90))}${String(label).length > 90 ? '…' : ''}</span><span class="muted" style="white-space:nowrap">${g}/${m}</span></div>`;
  }).join('');
  const missed = qs.filter((q, k) => (S.got[k] || 0) < marksOf(q));
  const unitRef = S.units ? { book: S.book, units: S.units } : null;
  $app.innerHTML = `<main class="pad stack g22" style="flex:1">
    <div class="stack g6"><span class="muted" style="font-size:13px">${esc(S.title)} · done</span><span class="score">${got} / ${total}</span><span style="font-size:15px;font-weight:600;color:${pct >= 70 ? '#0F766E' : '#9A3412'}">${pct >= 85 ? 'Excellent work' : pct >= 70 ? 'Good, solid work' : pct >= 50 ? 'Getting there' : 'Worth another go'} · ${pct}%</span></div>
    <div class="card stack">${list}</div>
    ${S.mode === 'spaced' ? `<p class="hint" style="margin:0;line-height:1.5">Questions you got right come back later and later. The ones you missed come back tomorrow.</p>` : ''}
    <div class="stack g10">
      ${unitRef ? `<button class="btn" id="more">10 more on ${unitRef.units.length > 1 ? 'these chapters' : 'this chapter'}</button>` : ''}
      ${missed.length ? `<button class="btn ${unitRef ? 'ghost' : ''}" id="retry">Retry the ${missed.length} I missed</button>` : ''}
      ${qs.length ? '<button class="btn ghost" id="redo">Redo this set (shuffled)</button>' : ''}
      <button class="btn ghost" id="home">${S.book ? 'Back to chapters' : 'Back to home'}</button>
    </div></main>`;
  document.getElementById('home').onclick = () => (S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' }));
  const m = document.getElementById('more'); if (m) m.onclick = () => startUnits(unitRef.book, unitRef.units);
  const r = document.getElementById('retry');
  const again = (list, title) => { const l = shuffle(list).map(shuffleOptions); S = newSession({ mode: 'retry', title, book: S.book, qs: l, target: l.length }); renderQuestion(); };
  if (r) r.onclick = () => again(missed, 'Retry');
  const rd = document.getElementById('redo'); if (rd) rd.onclick = () => again(qs, 'Redo');
  window.scrollTo(0, 0);
}

// Same question, MCQ options in a new order (so a redo tests the idea, not the letter).
function shuffleOptions(q) {
  if (q.type !== 'mcq' || !Array.isArray(q.options)) return q;
  const order = shuffle(q.options.map((_, i) => i));
  return { ...q, options: order.map((i) => q.options[i]), correct_option: 'ABCD'[order.indexOf('ABCD'.indexOf(q.correct_option))] };
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

go({ name: 'home' });
