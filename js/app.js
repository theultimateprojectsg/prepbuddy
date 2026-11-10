// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';

/* ---------- settings ---------- */
const SESSION_SIZE = 10;
const BATCH = 3;            // questions requested per generate call
// Mix of question kinds, cycled through as a chapter's bank grows.
const PLAN = [[1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
const LKEY = 'prepbuddy.v2';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '' }, loadLocal());
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
  if (!r.ok) { const e = new Error(data.error || `Server error ${r.status}`); e.status = r.status; throw e; }
  return data;
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
}

/* ---------- home ---------- */
async function renderHome() {
  S = null;
  const books = await getBooks();
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
      <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button class="tile" data-mode="weak">${ICON.target}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="tile" data-mode="mock">${ICON.clock}<b>Mini mock</b><span>12 questions, 20 min</span></button>
      </div>
    </section>` : ''}
  </main>
  <footer>Prototype. Your textbooks, questions and progress are saved on this device only. Questions are written by AI and checked by AI; tap "Report a problem" if one looks wrong.</footer>`;
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
async function renderBook(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const rows = [];
  let lastChapter = null;
  for (const u of book.units) {
    if (u.chapter && u.chapter !== lastChapter) { rows.push(`<div class="chapter-head">${esc(u.chapter)}</div>`); lastChapter = u.chapter; }
    const qs = await getQs(book.id, u.id);
    const unseen = qs.filter((q) => !local.stats[q.id]).length;
    const sc = scoreOf(qs);
    const status = qs.length ? `${unseen} new · ${qs.length - unseen} done` : 'Tap to make questions';
    rows.push(`<button class="row" data-unit="${esc(u.id)}">
      <div class="top"><span>${esc(u.title)}</span><span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div>
      <span class="muted" style="font-size:12px">${u.startPage ? `pp. ${u.startPage}–${u.endPage} · ` : ''}${status}</span>
      ${sc !== null ? `<div class="bar ${sc < 50 ? 'warn' : ''}"><i style="width:${sc}%"></i></div>` : ''}</button>`);
  }
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(book.title)}</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Tap a chapter for 10 questions. New questions are made whenever you run low.</p>
    <div class="card stack">${rows.join('')}</div>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.5">${book.library
      ? `From the PrepBuddy library · book code ${esc(book.code)}${book.credit ? `<br>Source: ${esc(book.credit)}` : ''}`
      : `Uploaded by you · ${book.pageCount} pages · chapters found from ${book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}`}</p>
    <button class="link quiet" id="delete" style="align-self:flex-start">Remove from my textbooks</button>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => startUnit(book, book.units.find((u) => u.id === b.dataset.unit))));
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

/* ---------- sessions ---------- */
function newSession(props) {
  return Object.assign({ i: 0, answers: [], got: [], ticks: {}, phase: 'answer', review: false, deadline: null, waiting: false, generating: false, error: null }, props);
}

async function startUnit(book, unit) {
  const all = await getQs(book.id, unit.id);
  const unseen = shuffle(all.filter((q) => !local.stats[q.id]));
  let qs = unseen.slice(0, SESSION_SIZE);
  S = newSession({ mode: 'unit', title: unit.title, book, unit, qs, target: SESSION_SIZE });
  {
    // Fill this session, and keep the next 10 ready so "10 more" starts instantly.
    const spare = unseen.length - qs.length;
    const want = (SESSION_SIZE - qs.length) + Math.max(0, SESSION_SIZE - spare);
    if (want > 0) followFill(S, ensureFill(book, unit, want));
  }
  if (S.qs.length) renderQuestion(); else renderWaiting();
}

async function startReview(mode) {
  const items = await allQuestions();
  if (items.length < 4) return toast('Practise a chapter first, then come back here.');
  let pick;
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
const PARALLEL = 4;

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
  let saving = Promise.resolve();
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
      saving = saving.then(async () => { const list = await getQs(book.id, unit.id); list.push(...passed); await setQs(book.id, unit.id, list); });
      await saving;
      job.made += passed.length;
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

function followFill(sess, job) {
  sess.generating = true; sess.error = null;
  const listener = (passed, done) => {
    if (sess !== S) { job.listeners.delete(listener); return; }
    const have = new Set(sess.qs.map((q) => q.id));
    sess.qs.push(...passed.filter((q) => !have.has(q.id)).slice(0, Math.max(0, sess.target - sess.qs.length)));
    if (done) {
      sess.generating = false;
      sess.error = job.error;
      if (sess.qs.length < sess.target && !sess.error) sess.target = Math.max(sess.qs.length, sess.i + 1);
    }
    sessionGrew(done);
  };
  job.listeners.add(listener);
}

function refill(sess) {
  sess.error = null;
  sess.target = Math.max(sess.target, sess.qs.length + 1);
  followFill(sess, ensureFill(sess.book, sess.unit, sess.target - sess.qs.length + SESSION_SIZE));
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
         <p class="muted" style="margin:0;line-height:1.5;max-width:320px">${esc(S.unit ? S.unit.title : '')}<br>Each question is written from your textbook, then checked by a second AI. The first ones take 30–60 seconds; after that the next set is made while you practise.</p>`}
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
  if (revealed) footer = `<div class="sheet"><span class="verdict ${right ? 'ok' : 'no'}">${right ? 'Correct' : picked ? `Not quite. The answer is ${q.correct_option}.` : `No answer. The answer is ${q.correct_option}.`}</span>${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
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

function writtenBody(q, revealed) {
  const ans = S.answers[S.i] || q.parts.map(() => '');
  const stem = q.stem ? renderStem(q.stem) : '';
  if (!revealed) {
    const parts = q.parts.map((p, k) => `<div class="part">
      <label class="ph" for="a${k}"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></label>
      <textarea id="a${k}" placeholder="Type, or tap the microphone on your keyboard to speak">${esc(ans[k])}</textarea></div>`).join('');
    const main = `${stem}${parts}<p class="hint">Aim for one clear point per mark.</p>`;
    const footer = `<div class="pad stack g8" style="padding-top:0"><button class="btn" id="check">${S.mode === 'mock' ? nextLabel() : 'Check my answer'}</button>${S.mode === 'mock' ? '' : '<button class="link quiet" id="skip" style="align-self:center">Show the answer without trying</button>'}</div>`;
    return { main, footer, bind() {
      const grab = () => { S.answers[S.i] = [...$app.querySelectorAll('textarea')].map((t) => t.value); };
      $app.querySelectorAll('textarea').forEach((t) => (t.oninput = grab));
      document.getElementById('check').onclick = () => { grab(); if (S.mode === 'mock') return advance(); S.phase = 'revealed'; renderQuestion(); };
      const sk = document.getElementById('skip'); if (sk) sk.onclick = () => { grab(); S.phase = 'revealed'; renderQuestion(); };
    } };
  }
  const ticks = S.ticks[S.i] || (S.ticks[S.i] = q.parts.map((p) => p.mark_scheme.map(() => false)));
  const partHtml = q.parts.map((p, k) => `<div class="part">
      <div class="ph"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></div>
      <div class="yours ${ans[k] && ans[k].trim() ? '' : 'empty'}">${ans[k] && ans[k].trim() ? esc(ans[k]) : 'No answer written'}</div>
      <span class="hint" style="font-weight:600">Tick each point your answer makes${p.mark_scheme.length > p.marks ? ` (max ${p.marks})` : ''}:</span>
      ${p.mark_scheme.map((pt, j) => `<button class="point ${ticks[k][j] ? 'on' : ''}" data-k="${k}" data-j="${j}" aria-pressed="${ticks[k][j]}"><span class="box">${ticks[k][j] ? ICON.check : ''}</span><span>${esc(pt.replace(/\s*\(1\)\s*$/, ''))}</span></button>`).join('')}
    </div>`).join('');
  const got = partsGot(q);
  const footer = `<div class="sheet"><span class="verdict ${got === marksOf(q) ? 'ok' : 'no'}">${got} / ${marksOf(q)} marks</span>${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${partHtml}`, footer, bind() {
    $app.querySelectorAll('.point').forEach((b) => (b.onclick = () => { const k = +b.dataset.k, j = +b.dataset.j; ticks[k][j] = !ticks[k][j]; const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }));
  } };
}

function record(q, got) {
  const s = local.stats[q.id] || { seen: 0, got: 0, total: 0, last: 0 };
  s.seen++; s.got += got; s.total += marksOf(q); s.last = got / marksOf(q);
  local.stats[q.id] = s; saveLocal();
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
  const r = document.getElementById('report');
  if (r) r.onclick = () => { if (!local.reports.includes(q.id)) { local.reports.push(q.id); saveLocal(); } toast('Thanks. This question is flagged for checking.'); };
}

function advance() {
  if (S.i < S.target - 1) {
    S.i++; S.phase = S.review ? 'revealed' : 'answer';
    if (S.i < S.qs.length) return renderQuestion();
    if (!S.generating && !S.error && S.unit) refill(S);
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
  const unitRef = S.unit ? { book: S.book, unit: S.unit } : null;
  $app.innerHTML = `<main class="pad stack g22" style="flex:1">
    <div class="stack g6"><span class="muted" style="font-size:13px">${esc(S.title)} · done</span><span class="score">${got} / ${total}</span><span style="font-size:15px;font-weight:600;color:${pct >= 70 ? '#0F766E' : '#9A3412'}">${pct >= 85 ? 'Excellent work' : pct >= 70 ? 'Good, solid work' : pct >= 50 ? 'Getting there' : 'Worth another go'} · ${pct}%</span></div>
    <div class="card stack">${list}</div>
    <div class="stack g10">
      ${unitRef ? '<button class="btn" id="more">10 more on this chapter</button>' : ''}
      ${missed.length ? `<button class="btn ${unitRef ? 'ghost' : ''}" id="retry">Retry the ${missed.length} I missed</button>` : ''}
      <button class="btn ghost" id="home">${S.book ? 'Back to chapters' : 'Back to home'}</button>
    </div></main>`;
  document.getElementById('home').onclick = () => (S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' }));
  const m = document.getElementById('more'); if (m) m.onclick = () => startUnit(unitRef.book, unitRef.unit);
  const r = document.getElementById('retry');
  if (r) r.onclick = () => { S = newSession({ mode: 'retry', title: 'Retry', book: S.book, qs: missed, target: missed.length }); renderQuestion(); };
  window.scrollTo(0, 0);
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
