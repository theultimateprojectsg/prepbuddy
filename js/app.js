// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { SAMPLE_QUESTIONS } from './sample.js';

/* ---------- settings ---------- */
const SESSION_SIZE = 10;
const BATCH = 3;            // questions requested per generate call
const MAX_ROUNDS = 6;       // generate calls per session before giving up
// Mix of question kinds, cycled through as a chapter's bank grows.
const PLAN = [[1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
const LKEY = 'prepbuddy.v2';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '' }, loadLocal());
try { // carry over progress from the first prototype
  const old = JSON.parse(localStorage.getItem('prepbuddy.v1') || 'null');
  if (old && old.stats && !Object.keys(local.stats).length) {
    for (const [k, v] of Object.entries(old.stats)) local.stats['sample:' + k] = v;
  }
} catch (e) {}
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
const SAMPLE_BOOK = (() => {
  const sections = [...new Set(SAMPLE_QUESTIONS.map((q) => q.section))].sort();
  return {
    id: 'sample', sample: true, title: 'Sample: Biology (OpenStax Biology 2e)', pageCount: null,
    units: sections.map((s, i) => ({ id: 'u' + i, title: s, static: true })),
  };
})();
function sampleQuestions(unitId) {
  const unit = SAMPLE_BOOK.units.find((u) => u.id === unitId);
  return SAMPLE_QUESTIONS.filter((q) => q.section === unit.title).map((q) => ({ ...q, id: 'sample:' + q.id }));
}
async function getBooks() { return (await store.get('books', [])).concat([SAMPLE_BOOK]); }
async function getQs(bookId, unitId) { return bookId === 'sample' ? sampleQuestions(unitId) : store.get(`qs:${bookId}:${unitId}`, []); }
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
  stopTimer();
  if (v.name === 'home') return renderHome();
  if (v.name === 'book') return renderBook(v.bookId);
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
      <div class="top"><span style="display:flex;gap:10px;align-items:flex-start">${ICON.book}<span><b style="font-weight:600">${esc(b.title)}</b><br><span class="muted" style="font-size:13px">${b.units.length} chapters · ${n} questions${b.sample ? ' · built in' : ''}</span></span></span>
      <span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div></button>`);
  }
  $app.innerHTML = `
  <main class="pad stack g22" style="flex:1">
    <div><p class="muted" style="margin:0 0 2px;font-size:13px">Practice from your own textbook</p><h1 class="brand">PrepBuddy</h1></div>
    <section class="hero" aria-label="Upload">
      <small>Add a book</small>
      <span class="title">Upload your ebook and get fresh practice questions for any chapter</span>
      <span style="font-size:13px;color:#E6F7F5">PDF files with selectable text. Your book stays on this device.</span>
      <label class="btn light" style="align-self:flex-start;display:inline-flex;gap:8px;align-items:center;cursor:pointer">${ICON.upload}<span>Upload a PDF</span>
        <input type="file" id="file" accept="application/pdf,.pdf" style="position:absolute;width:1px;height:1px;opacity:0"></label>
    </section>
    <section class="stack g10" aria-label="My books">
      <h2 style="margin:0;font-size:15px">My books</h2>
      <div class="card stack">${cards.join('')}</div>
    </section>
    <section class="stack g10" aria-label="Review">
      <h2 style="margin:0;font-size:15px">Review across all books</h2>
      <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button class="tile" data-mode="weak">${ICON.target}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="tile" data-mode="mock">${ICON.clock}<b>Mini mock</b><span>12 questions, 20 min</span></button>
      </div>
    </section>
  </main>
  <footer>Prototype. Your books, questions and progress are saved on this device only. Questions are made by AI and checked by AI; tap "Report a problem" if one looks wrong.
  Built-in sample: <a href="https://openstax.org/details/books/biology-2e" target="_blank" rel="noopener">OpenStax Biology 2e</a>, CC BY-NC-SA 4.0. Access for free at openstax.org.</footer>`;
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => startReview(b.dataset.mode)));
  document.getElementById('file').onchange = (e) => e.target.files[0] && uploadBook(e.target.files[0]);
  window.scrollTo(0, 0);
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
    const status = qs.length ? `${unseen} new · ${qs.length - unseen} done` : (u.static ? '' : 'Tap to make questions');
    rows.push(`<button class="row" data-unit="${esc(u.id)}">
      <div class="top"><span>${esc(u.title)}</span><span style="font-weight:600;white-space:nowrap;color:${sc === null ? '#6B7280' : sc < 50 ? '#C2410C' : '#0F766E'}">${sc === null ? '' : sc + '%'}</span></div>
      <span class="muted" style="font-size:12px">${u.startPage ? `pp. ${u.startPage}–${u.endPage} · ` : ''}${status}</span>
      ${sc !== null ? `<div class="bar ${sc < 50 ? 'warn' : ''}"><i style="width:${sc}%"></i></div>` : ''}</button>`);
  }
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(book.title)}</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Tap a chapter for 10 questions. ${book.sample ? 'This sample has a fixed set of questions.' : 'New questions are made whenever you run low.'}</p>
    <div class="card stack">${rows.join('')}</div>
    ${book.sample ? '' : `<p class="muted" style="font-size:12px;margin:0">${book.pageCount} pages · chapters found from ${book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}</p>
      <button class="link quiet" id="delete" style="align-self:flex-start">Remove this book from this device</button>`}
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => startUnit(book, book.units.find((u) => u.id === b.dataset.unit))));
  const d = document.getElementById('delete');
  if (d) d.onclick = async () => {
    if (!confirm(`Remove "${book.title}" and its questions from this device?`)) return;
    const books = (await store.get('books', [])).filter((b) => b.id !== book.id);
    await store.set('books', books);
    for (const k of await store.keys(`text:${book.id}:`)) await store.del(k);
    for (const k of await store.keys(`qs:${book.id}:`)) await store.del(k);
    toast('Book removed'); go({ name: 'home' });
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
  if (unit.static) qs = shuffle(all).slice(0, SESSION_SIZE);
  S = newSession({ mode: 'unit', title: unit.title, book, unit, qs, target: unit.static ? qs.length : SESSION_SIZE });
  if (!unit.static && qs.length < SESSION_SIZE) {
    runGenerator(S);
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
async function runGenerator(sess) {
  if (sess.generating) return;
  sess.generating = true; sess.error = null;
  const { book, unit } = sess;
  const title = unit.title;
  try {
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    if (!text) throw new Error('This chapter’s text is missing on this device. Try uploading the book again.');
    for (let round = 0; round < MAX_ROUNDS && sess === S && sess.qs.length < sess.target; round++) {
      const existing = await getQs(book.id, unit.id);
      const items = Array.from({ length: BATCH }, (_, k) => PLAN[(existing.length + round + k) % PLAN.length]).map(([level, type]) => ({ level, type }));
      const avoid = existing.map((q) => (q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200));
      const gen = await api('generate', { title, text, items, avoid });
      if (!gen.questions || !gen.questions.length) { if (round > 0) break; throw new Error('No questions could be made from this chapter. It may not have enough teaching content.'); }
      const checked = await Promise.all(gen.questions.map((q) =>
        api('verify', { title, text, question: q }).then((v) => ({ q, v })).catch((e) => { if (e.status === 401) throw e; return { q, v: { passed: false } }; })));
      const passed = checked.filter((x) => x.v.passed).map((x) => x.q);
      if (passed.length) {
        const list = await getQs(book.id, unit.id);
        passed.forEach((q) => {
          q.id = `${book.id}:${unit.id}:${uid()}`;
          q.section = title;
          q.pages = unit.startPage ? `${unit.startPage}-${unit.endPage}` : '';
          list.push(q);
        });
        await setQs(book.id, unit.id, list);
        if (sess === S) { sess.qs.push(...passed.slice(0, sess.target - sess.qs.length)); sessionGrew(); }
      }
    }
  } catch (e) {
    sess.error = e;
    if (e.status === 401) { local.code = ''; saveLocal(); }
  } finally {
    sess.generating = false;
    if (sess === S) {
      if (sess.qs.length < sess.target && !sess.error) sess.target = Math.max(sess.qs.length, sess.i + 1);
      sessionGrew(true);
    }
  }
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
  if (e && e.status === 401) return renderAccess(() => { S.error = null; runGenerator(S); renderWaiting(); }, 'That access code didn’t work. Please check it and try again.');
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
         <p class="muted" style="margin:0;line-height:1.5;max-width:320px">${esc(S.unit ? S.unit.title : '')}<br>Each question is written from your textbook, then checked by a second AI. The first few take about a minute.</p>`}
  </main>`;
  document.getElementById('quit').onclick = () => go({ name: 'home' });
  const r = document.getElementById('retry'); if (r) r.onclick = () => { S.error = null; S.target = Math.max(S.target, SESSION_SIZE); runGenerator(S); renderWaiting(); };
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
    if (!S.generating && !S.error && S.unit && !S.unit.static) runGenerator(S);
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
  const unitRef = S.unit && !S.unit.static ? { book: S.book, unit: S.unit } : null;
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
