// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { buildReport, encodeReport, headline, skillsHTML, REPORT_CSS } from './report.js';
import { initLang, setLang, watch, LANG } from './i18n.js';

/* ---------- settings ---------- */
const SESSION_SIZE = 10;
const BATCH = 3;            // questions requested per generate call
const BUFFER = 3;           // spare questions kept ready beyond the current session (costs credits)
// Mix of question kinds, cycled through as a chapter's bank grows.
const TYPE_CHOICES = [['mcq', 'MCQ'], ['written', 'Written'], ['mix', 'Both']];
const PLANS = {
  mcq: [[1, 'mcq'], [2, 'mcq'], [2, 'mcq'], [3, 'mcq'], [1, 'mcq'], [2, 'mcq'], [3, 'mcq']],
  written: [[2, 'short'], [3, 'structured'], [2, 'short'], [4, 'structured'], [3, 'short'], [3, 'structured']],
};
const choiceType = (q) => q.type === 'mcq' || q.type === 'graph';
const matchType = (q, types) => !types || types === 'mix' || (types === 'mcq' ? choiceType(q) : !choiceType(q));
const PLAN = [[2, 'mcq'], [1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
const LKEY = 'prepbuddy.v2';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '', usage: {}, log: [], name: '', types: 'mix', mistakes: {} }, loadLocal());
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) {} }

/* ---------- helpers ---------- */
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { 1: 'Recall', 2: 'Understand', 3: 'Apply', 4: 'Analyse / evaluate' };
const TYPE = { mcq: 'MCQ', graph: 'Graph MCQ', short: 'Short answer', structured: 'Structured', essay: 'Writing' };
// Subject types change the kinds of question made and how answers are marked.
const KINDS = [['science', 'Science'], ['maths', 'Maths'], ['language', 'Language'], ['humanities', 'Humanities']];
const KIND_PLANS = {
  maths: {
    mcq: [[1, 'mcq'], [2, 'mcq'], [3, 'mcq'], [2, 'mcq'], [2, 'mcq'], [3, 'mcq']],
    written: [[2, 'short'], [3, 'structured'], [2, 'short'], [3, 'short'], [4, 'structured']],
    mix: [[1, 'mcq'], [2, 'short'], [2, 'mcq'], [3, 'structured'], [3, 'mcq'], [2, 'short'], [4, 'structured'], [2, 'mcq']],
  },
  language: {
    mcq: [[1, 'mcq'], [2, 'mcq'], [3, 'mcq'], [2, 'mcq'], [3, 'mcq']],
    written: [[2, 'short'], [3, 'short'], [3, 'structured'], [2, 'short'], [4, 'essay'], [3, 'structured']],
    mix: [[2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [3, 'mcq'], [3, 'short'], [2, 'mcq'], [4, 'essay']],
  },
};
// Adaptive difficulty: from the last answers in a chapter, move new questions up or down a thinking level.
// Strong recent results (80%+) push harder; weak ones (under 50%) bring in more of the basics.
function levelShift(bookId, unitId) {
  const pre = `${bookId}:${unitId}:`;
  const recent = [];
  for (let i = local.log.length - 1; i >= 0 && recent.length < 15; i--) { const e = local.log[i]; if (e.q && e.q.startsWith(pre) && e.k !== 'mistakes') recent.push(e); }
  if (recent.length < 5) return 0;
  const m = recent.reduce((t, e) => t + e.m, 0), g = recent.reduce((t, e) => t + e.g, 0);
  const acc = m ? g / m : 0, avgL = recent.reduce((t, e) => t + (e.l || 2), 0) / recent.length;
  const target = avgL + (acc >= 0.8 ? 1 : acc < 0.5 ? -1 : 0);
  return Math.max(-1, Math.min(2, Math.round(target - 2)));
}
const shiftLevel = (l, d) => Math.max(1, Math.min(4, l + d));

function guessKind(title, text) {
  const t = String(title || '');
  if (/math|數學|algebra|calculus|statistic|geometry|trigonom/i.test(t)) return 'maths';
  if (/english|chinese|中文|中國語文|語文|literature|reading|writing|grammar|vocabulary|閱讀|寫作/i.test(t)) return 'language';
  if (/history|geograph|econom|citizenship|liberal|social|business|accounting|歷史|地理|經濟|公民|社會|企業/i.test(t)) return 'humanities';
  const x = String(text || '').slice(0, 30000);
  const eq = (x.match(/=/g) || []).length, words = Math.max(1, x.length / 6);
  if (eq / words > 0.02) return 'maths';
  return 'science';
}
const kindOfBook = (book) => (book && book.kind) || 'science';
const bookKinds = new Map(); // bookId -> kind, for calls that only know the question id
// When chapters are merged, questions keep their ids; `alias` points the old chapter at the one it joined.
const aliases = new Map(); // bookId -> { oldUnitId: unitId }
function realUnit(bookId, unitId) { const a = aliases.get(bookId) || {}; let u = unitId; for (let n = 0; a[u] && n < 30; n++) u = a[u]; return u; }
const qUnit = (qid) => { const [b, u] = String(qid || '').split(':'); return [b, realUnit(b, u)]; };
async function kindOfId(qid) {
  const id = String(qid || '').split(':')[0];
  if (!bookKinds.has(id)) { const b = (await getBooks()).find((x) => x.id === id); bookKinds.set(id, kindOfBook(b)); }
  return bookKinds.get(id);
}
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const marksOf = (q) => (q.type === 'mcq' || q.type === 'graph' ? 1 : (q.parts || []).reduce((s, p) => s + p.marks, 0));
// 'zh-HK' when the text is mostly Chinese characters, else 'en'.
const langOf = (t) => { const x = String(t || '').slice(0, 20000); const cjk = (x.match(/[\u3400-\u9fff]/g) || []).length; const words = (x.match(/[A-Za-z]{2,}/g) || []).length; return cjk > words ? 'zh-HK' : 'en'; };
// Drop or repair malformed questions before they reach a student.
function usable(q) {
  if (!q || typeof q !== 'object') return false;
  if (missingRef(q)) return false; // mentions a figure/table/page the student can't see
  if (!GRAPHS_ON && q.type === 'graph') return false;
  if (q.type === 'graph' && !(Array.isArray(q.graphs) && q.graphs.length === 4)) { q.type = 'mcq'; delete q.graphs; }
  if (q.type === 'mcq' || q.type === 'graph') return Array.isArray(q.options) && q.options.length === 4 && 'ABCD'.includes(q.correct_option || '?');
  return Array.isArray(q.parts) && q.parts.length > 0 && q.parts.every((p) => p && p.prompt && Array.isArray(p.mark_scheme) && p.marks > 0);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ICON = {
  today: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 15l2.5 2.5L16 13"/></svg>',
  books: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 5.2l3.8-1 3 15.5-3.8 1z" transform="translate(-2 0)"/></svg>',
  chart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  review: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  pen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>',
  keys: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 16.5h.01"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  notes: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>',
  cards: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 7V5h12a2 2 0 0 1 2 2v10h-4"/></svg>',
  close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 8"/></svg>',
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  target: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
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
// Questions that mention a figure/table/page the student can't see, or that the student reported, are never used.
const REF = /\b(?:fig(?:ure)?s?\.?|tables?|diagrams?|photos?|images?|charts?|graphs?|pages?|pp?\.|examples?|activit(?:y|ies)|exercises?)\s*\d+[a-z]?(?:[.\-–]\d+)*\b|(?:圖|表|頁|例題|練習)\s*[0-9０-９一二三四五六七八九十]+(?:\s*[.\-．]\s*[0-9]+)*|第\s*[0-9０-９]+\s*頁/i;
function missingRef(q) {
  for (const t of [q.stem, ...(q.options || []), ...(q.parts || []).map((p) => p && p.prompt)].filter(Boolean).map(String)) {
    const m = t.match(REF);
    if (m && !(/^tables?\b/i.test(m[0]) && /\|.*\|/.test(q.stem || ''))) return m[0];
  }
  return '';
}
// "Choose the graph" questions are switched off for now (set GRAPHS_ON = true to bring them back).
const GRAPHS_ON = false;
const blocked = (q) => !q || (local.reports || []).includes(q.id) || !!missingRef(q) || (!GRAPHS_ON && q.type === 'graph');
async function getQs(bookId, unitId) { return (await store.get(`qs:${bookId}:${unitId}`, [])).filter((q) => !blocked(q)); }
async function setQs(bookId, unitId, list) { await store.set(`qs:${bookId}:${unitId}`, list); }
function scoreOf(questions) {
  let got = 0, total = 0;
  questions.forEach((q) => { const s = local.stats[q.id]; if (s) { got += s.got; total += s.total; } });
  return total ? Math.round(100 * got / total) : null;
}
/* ---------- mastery: how ready you are, per chapter and per book ----------
   A chapter earns its % in six areas. 100% means it has been covered, answered well (including hard and written
   questions), remembered over days, every mistake fixed, and passed in timed tests on different days. */
const AREAS = [
  ['tested', 'Passed timed tests', 30],
  ['covered', 'Covered every part', 15],
  ['accurate', 'Accurate in practice', 15],
  ['deep', 'Deep understanding', 15],
  ['remembered', 'Remembered over time', 15],
  ['fixed', 'Mistakes fixed', 10],
];
const PASS = 0.8, TEST_MIN_Q = 3;
function chapterTarget(u) {
  const pages = u.startPage && u.endPage ? u.endPage - u.startPage + 1 : 0;
  const n = pages ? Math.round(pages * 1.2) : Math.round((u.chars || 30000) / 2500);
  return Math.max(8, Math.min(20, n));
}
const normQ = (t) => String(t || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
// Which part of the chapter a question is about, from where its source quote sits in the chapter text.
function partOf(q, ntext, parts) {
  if (!ntext || !q.source_quote) return -1;
  const k = ntext.indexOf(normQ(q.source_quote).slice(0, 60));
  return k < 0 ? -1 : Math.min(parts - 1, Math.floor(parts * k / ntext.length));
}
function testsFor(key) {
  return (local.tests || []).map((t) => ({ t: t.t, r: t.per && t.per[key] })).filter((x) => x.r && x.r[1] >= TEST_MIN_Q).sort((a, b) => a.t - b.t);
}
function chapterMastery(book, u, qs, text) {
  const T = chapterTarget(u), now = Date.now();
  const key = `${book.id}:${u.id}`;
  const st = (q) => local.stats[q.id];
  const done = qs.filter((q) => st(q));
  const good = (q) => (st(q).last || 0) >= 0.7;
  // covered: every part of the chapter has a question answered well
  const pages = u.startPage && u.endPage ? u.endPage - u.startPage + 1 : 8;
  const parts = Math.max(3, Math.min(6, Math.round(pages / 2)));
  const ntext = text ? normQ(text) : '';
  const hit = new Set(done.filter(good).map((q) => partOf(q, ntext, parts)).filter((x) => x >= 0));
  const covered = ntext ? hit.size / parts : Math.min(1, done.filter(good).length / T);
  // accurate: latest scores, over at least T questions
  const latest = done.map((q) => Math.max(0, Math.min(1, st(q).last || 0)));
  const accurate = latest.length ? (latest.reduce((a, b) => a + b, 0) / latest.length) * Math.min(1, latest.length / T) : 0;
  // deep: right at "apply" and "analyse" level, and full marks on written answers
  const l3 = done.some((q) => (q.level || 2) === 3 && good(q)), l4 = done.some((q) => (q.level || 2) >= 4 && good(q));
  const written = done.filter((q) => !choiceType(q) && (st(q).last || 0) >= 1).length;
  const deep = ((l3 ? 1 : 0) + (l4 ? 1 : 0) + Math.min(2, written)) / 4;
  // remembered: right again in spaced reviews (box 3+ = right first time and in two reviews days apart)
  const memTarget = Math.max(4, Math.min(8, Math.round(T / 2)));
  const remembered = Math.min(1, done.filter((q) => (st(q).box || 0) >= 3).length / memTarget);
  // mistakes fixed
  const open = Object.entries(local.mistakes || {}).filter(([id, m]) => !m.done && qUnit(id).join(':') === key).length;
  const fixed = done.length ? Math.max(0, 1 - open / 5) : 0;
  // tested: two passes (80%+) on different days, and the latest test also a pass
  const tests = testsFor(key);
  const passDays = new Set(tests.filter((x) => x.r[0] / x.r[1] >= PASS).map((x) => new Date(x.t).toDateString())).size;
  const lastPass = tests.length ? tests[tests.length - 1].r[0] / tests[tests.length - 1].r[1] >= PASS : false;
  let tested = Math.min(1, passDays / 2);
  if (tests.length && !lastPass) tested = Math.min(tested, 0.5);
  const score = { tested, covered, accurate, deep, remembered, fixed };
  let pct = Math.round(AREAS.reduce((t, [k, , w]) => t + w * score[k], 0));
  if (!passDays) pct = Math.min(pct, 70); // not proven in a test yet
  else if (passDays < 2 || !lastPass) pct = Math.min(pct, 95);
  return {
    pct, score, target: T, done: done.length, parts, uncovered: parts - hit.size,
    more: Math.max(0, T - done.length), needL3: !l3, needL4: !l4, needWritten: Math.max(0, 2 - written),
    due: done.filter((q) => st(q).due <= now).length, open, tests: tests.length, passDays, lastPass,
    weight: u.endPage && u.startPage ? u.endPage - u.startPage + 1 : (u.chars || 30000) / 2500,
  };
}
async function bookMastery(book) {
  const chapters = [];
  for (const u of book.units) {
    const text = await store.get(`text:${book.id}:${u.id}`, '');
    chapters.push({ unit: u, ...chapterMastery(book, u, await getQs(book.id, u.id), text) });
  }
  const w = chapters.reduce((t, c) => t + c.weight, 0) || 1;
  const pct = Math.round(chapters.reduce((t, c) => t + c.pct * c.weight, 0) / w);
  const areas = Object.fromEntries(AREAS.map(([k]) => [k, chapters.reduce((t, c) => t + c.score[k] * c.weight, 0) / w]));
  return { pct, chapters, areas };
}
function masteryLabel(p) {
  return p >= 100 ? 'Mastered' : p >= 85 ? 'Exam ready' : p >= 70 ? 'Well versed' : p >= 50 ? 'Getting there' : p >= 25 ? 'Building up' : p > 0 ? 'Just started' : 'Not started';
}
// The next things to do, from the weakest areas of the weakest chapters.
function masterySteps(m) {
  const steps = [];
  const weak = m.chapters.filter((c) => c.pct < 100).sort((a, b) => a.pct - b.pct);
  for (const c of weak) {
    if (steps.length >= 3) break;
    const t = c.unit.title;
    const opts = [];
    if (c.more) opts.push([1 - c.score.accurate, `Practise ${c.more} more question${c.more > 1 ? 's' : ''} in ${t}`, 'practise']);
    else if (c.score.accurate < 0.9) opts.push([1 - c.score.accurate, `Get more questions right in ${t}`, 'practise']);
    if (c.uncovered > 0 && c.done) opts.push([1 - c.score.covered, `Practise the parts of ${t} you haven’t covered yet`, 'practise']);
    if (c.needL4 || c.needL3) opts.push([1 - c.score.deep, `Get an ${c.needL4 ? 'analyse' : 'apply'} question right in ${t}`, 'practise']);
    else if (c.needWritten) opts.push([1 - c.score.deep, `Get full marks on ${c.needWritten} written question${c.needWritten > 1 ? 's' : ''} in ${t}`, 'practise']);
    if (c.open) opts.push([1 - c.score.fixed + 0.2, `Fix ${c.open} mistake${c.open > 1 ? 's' : ''} in ${t}`, 'mistakes']);
    if (c.due) opts.push([1 - c.score.remembered + 0.1, `Review ${c.due} question${c.due > 1 ? 's' : ''} in ${t}`, 'review']);
    else if (c.score.remembered < 1 && c.done >= 4) opts.push([0.3 * (1 - c.score.remembered), `Come back for reviews over the next few days to prove you remember ${t}`, 'wait']);
    if (c.done >= Math.min(6, c.target)) {
      if (!c.passDays) opts.push([1.2, `Pass a chapter test on ${t} (80% or more)`, 'test']);
      else if (c.passDays < 2 || !c.lastPass) opts.push([0.9, `Pass another chapter test on ${t} on a different day`, 'test']);
    }
    opts.sort((a, b) => b[0] - a[0]);
    if (opts[0]) steps.push({ unit: c.unit, text: opts[0][1], kind: opts[0][2] });
  }
  return steps;
}
function masteryCard(m) {
  const steps = masterySteps(m);
  const p = m.pct;
  return `<section class="mastery" aria-label="Mastery">
    <div class="m-top"><div class="ring ${p >= 85 ? 'good' : p >= 50 ? 'mid' : ''}" style="--p:${p}" role="img" aria-label="${p}% mastered"><span>${p}%</span></div>
      <div class="m-text"><b>${masteryLabel(p)}</b><span>${p >= 100 ? 'Proven in tests and remembered. Keep up your reviews.' : p ? `${100 - p}% to go. Here’s what will get you there:` : 'Practise a chapter to see how ready you are.'}</span></div></div>
    <details class="areas"><summary>How this is worked out</summary>${AREAS.map(([k, label, w]) => { const v = Math.round(100 * m.areas[k]); return `<div class="area"><span>${label}<small>${w}%</small></span><span class="abar"><i style="width:${v}%" class="${v >= 85 ? 'good' : v >= 50 ? 'mid' : ''}"></i></span><b>${v}%</b></div>`; }).join('')}
      <p class="hint" style="margin:6px 0 0">A chapter can’t go above 70% until you pass a timed test on it, or reach 100% until you’ve passed two on different days.</p></details>
    ${steps.length ? `<ul class="m-steps">${steps.map((x) => `<li><button class="link" data-step-unit="${esc(x.unit.id)}" data-step-kind="${x.kind}">${esc(x.text)}</button></li>`).join('')}</ul>` : ''}
    ${p < 100 ? `<button class="btn" id="boost">${ICON.target} Get me closer to 100%</button>` : ''}
  </section>`;
}
// "Get me closer to 100%": works on the weakest chapter's weakest area.
async function boostSession(book) {
  const m = await bookMastery(book);
  const c = m.chapters.filter((x) => x.pct < 100).sort((a, b) => a.pct - b.pct)[0];
  if (!c) return toast('Every chapter is at 100%. Keep up your reviews!');
  const step = masterySteps({ ...m, chapters: [c] })[0];
  if (step && step.kind === 'test') return startChapterTest(book, [c.unit]);
  const qs = await getQs(book.id, c.unit.id), now = Date.now();
  const again = shuffle(qs.filter((q) => { const st = local.stats[q.id]; return st && (st.due <= now || (st.last || 0) < 1); })).slice(0, 6).map(shuffleOptions);
  await startUnits(book, [c.unit], Math.max(6, 10 - again.length));
  if (S && again.length) {
    const have = new Set(S.qs.map((q) => q.id));
    const add = again.filter((q) => !have.has(q.id));
    S.qs.splice(S.i, 0, ...add); S.target += add.length; S.title = c.unit.title;
    if (S.i < S.qs.length) renderQuestion();
  }
}
// A chapter test: about 10 new questions, timed, no help until the end. Counts towards "Passed timed tests".
async function startChapterTest(book, units) {
  const nA = Math.min(16, 6 + 2 * units.length), nB = Math.min(4, 1 + units.length);
  const mins = paperMinutes(nA, nB);
  try {
    const paper = await preparePaper(book, units, nA, nB, 'sit');
    if (!paper) return;
    startDse(book, paper, mins);
    S.title = units.length === 1 ? `${LANG === 'zh' ? '章節測驗' : 'Chapter test'} · ${units[0].title}` : (LANG === 'zh' ? '章節測驗' : 'Chapter test');
    S.test = true;
    toast(`${mins} min · pass mark 80%`);
  } catch (e) {
    toast(e.status === 0 ? 'You seem to be offline.' : (e.message || 'Could not prepare the test.'));
    go({ name: 'book', bookId: book.id });
  }
}

async function allQuestions() {
  const out = [];
  for (const b of await getBooks()) for (const u of b.units) {
    (await getQs(b.id, u.id)).forEach((q) => out.push({ q, book: b, unit: u }));
  }
  return out;
}

/* ---------- server ---------- */
// At most this many AI requests at once from this device, so papers don't hit the API's rate limit.
const MAX_INFLIGHT = 12;
let inflight = 0; const waiting = [];
async function slot() { if (inflight < MAX_INFLIGHT) { inflight++; return; } await new Promise((r) => waiting.push(r)); inflight++; }
function release() { inflight--; const n = waiting.shift(); if (n) n(); }
async function api(path, body) {
  await slot();
  try { return await apiOnce(path, body); } finally { release(); }
}
async function apiOnce(path, body) {
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
  getBooks().then((bs) => bs.forEach((b) => { bookKinds.set(b.id, kindOfBook(b)); aliases.set(b.id, b.alias || {}); }));
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  stopTimer();
  if (v.name === 'home') return renderHome();
  if (v.name === 'books') return renderBooks();
  if (v.name === 'book') return renderBook(v.bookId);
  if (v.name === 'library') return renderLibrary(v.query || '');
  if (v.name === 'usage') return renderUsage();
  if (v.name === 'progress') return renderProgress();
  if (v.name === 'paper') return renderPaper(v.bookId, v.from);
  if (v.name === 'pick') return renderPick(v.mode);
  if (v.name === 'worksheets') return renderWorksheets();
  if (v.name === 'notes') return renderNotes(v.bookId);
  if (v.name === 'edit') return renderEdit(v.bookId);
  if (v.name === 'mistakes') return renderMistakes(v.tab || 'todo');
  if (v.name === 'cards') return renderCards(v.bookId, v.only);
}

/* ---------- home ---------- */
// Book covers: one colour per subject, so the shelf is easy to scan.
const COVER_COLOURS = ['#26357A', '#18966A', '#C2452D', '#6B4FB0', '#0E7C8C', '#A3661A', '#B0346A', '#3E6B2F'];
function coverColour(b) {
  const k = String(b.subject || b.title || '').toLowerCase();
  const fixed = { biology: 1, chemistry: 4, physics: 0, mathematics: 5, maths: 5, english: 6, chinese: 2, history: 3, geography: 7, economics: 5 };
  for (const [w, i] of Object.entries(fixed)) if (k.includes(w)) return COVER_COLOURS[i];
  let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COVER_COLOURS[h % COVER_COLOURS.length];
}
async function bookSummary(b) {
  const qs = []; for (const u of b.units) qs.push(...await getQs(b.id, u.id));
  return { n: qs.length, sc: scoreOf(qs) };
}
function lastChapter(books) {
  for (let i = local.log.length - 1; i >= 0; i--) {
    const [bid, uid2] = qUnit(local.log[i].q); const b = books.find((x) => x.id === bid);
    const u = b && b.units.find((x) => x.id === uid2);
    if (u) return { book: b, unit: u };
  }
  return null;
}

/* ---------- Today (home) ---------- */
async function renderHome() {
  S = null;
  const books = await getBooks();
  const hr = new Date().getHours();
  const hello = LANG === 'zh' ? (hr < 12 ? '早晨' : hr < 18 ? '午安' : '晚安') : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = (local.name || '').trim();
  const dateText = new Date().toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const head = `<div class="greet" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><h1 data-raw>${esc(hello)}${name ? `${LANG === 'zh' ? '，' : ', '}${esc(name)}` : ''}</h1><p data-raw>${esc(dateText)}</p></div>
      <button class="langbtn" id="lang" lang="${LANG === 'zh' ? 'en' : 'zh-HK'}" aria-label="${LANG === 'zh' ? 'Switch to English' : '切換至中文'}">${LANG === 'zh' ? 'EN' : '中文'}</button></div>`;
  if (!books.length) {
    $app.innerHTML = `<main class="pad stack today" data-view="home" style="flex:1">${head}
    <section class="empty-start" aria-label="Add a textbook">
      <h2>Start with your textbook</h2>
      <p style="margin:0;line-height:1.55;color:var(--text-2)">Search the library by title, subject or book code. PrepBuddy turns each chapter into exam practice, notes and flashcards, and marks your answers.</p>
      <form id="find" class="searchbox" role="search"><span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
        <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off"></form>
    </section></main>${footerHTML()}`;
    bindHomeCommon();
    const q = document.getElementById('q');
    q.onfocus = () => go({ name: 'library', query: q.value });
    document.getElementById('find').onsubmit = (e) => { e.preventDefault(); go({ name: 'library', query: q.value }); };
    return window.scrollTo(0, 0);
  }
  const due = await dueItems();
  const nextAt = due.length ? 0 : await nextDue();
  const mk = mistakeCount();
  const last = lastChapter(books);
  const items = [];
  if (due.length) items.push(`<button class="plan-item" data-mode="spaced"><span class="pi-icon pi-review">${ICON.review}</span><span class="pi-text"><b>Review ${due.length} question${due.length > 1 ? 's' : ''}</b><span class="sub">About ${Math.max(1, Math.round(Math.min(due.length, 15) * 0.6))} min · keeps what you learned fresh</span></span><span class="go">Start</span></button>`);
  if (mk) items.push(`<button class="plan-item" id="mistakes"><span class="pi-icon pi-mistake">${ICON.pen}</span><span class="pi-text"><b>Fix ${mk} mistake${mk > 1 ? 's' : ''}</b><span class="sub">Questions you didn’t get fully right</span></span><span class="go">Open</span></button>`);
  if (last) {
    const qs = await getQs(last.book.id, last.unit.id); const sc = scoreOf(qs);
    items.push(`<button class="plan-item" id="continue"><span class="pi-icon pi-continue">${ICON.play}</span><span class="pi-text"><b data-raw>${esc(last.unit.title)}</b><span class="sub">Keep going${sc !== null ? ` · ${sc}% so far` : ''}</span></span><span class="go">Practise</span></button>`);
  } else {
    items.push(`<button class="plan-item" data-book="${esc(books[0].id)}"><span class="pi-icon pi-continue">${ICON.play}</span><span class="pi-text"><b>Practise your first chapter</b><span class="sub" data-raw>${esc(books[0].title)}</span></span><span class="go">Choose</span></button>`);
  }
  if (!due.length && Object.keys(local.stats).length) items.push(`<div class="plan-item done"><span class="pi-icon pi-review">${ICON.review}</span><span class="pi-text"><b>Reviews done</b><span class="sub">${nextAt < Infinity ? `Next review ${whenText(nextAt)}` : ''}</span></span><span class="go">✓</span></div>`);
  const covers = [];
  for (const b of books) {
    const sc = (await bookMastery(b)).pct;
    covers.push(`<button class="bookcover" data-book="${esc(b.id)}" style="background:${coverColour(b)}" aria-label="${esc(b.title)}"><span class="c-sub" data-raw>${esc(b.subject || (b.library ? '' : 'My upload'))}</span><span class="c-title" data-raw>${esc(b.title)}</span><span class="c-foot"><b>${sc}%</b><span class="c-meter" aria-hidden="true"><i style="width:${sc}%"></i></span></span></button>`);
  }
  const r = await currentReport();
  $app.innerHTML = `
  <main class="pad stack today" data-view="home" style="flex:1">
    ${head}
    <section class="plan" aria-label="Today's plan"><h2><span class="hl">Today’s plan</span></h2>${items.join('')}</section>
    <section class="stack g10" aria-label="My textbooks">
      <div class="sect-head"><h2>My textbooks</h2><button class="link" id="allbooks" style="padding:0">See all</button></div>
      <div class="shelf">${covers.join('')}<button class="bookcover add" id="addbook">${ICON.plus}<span>Add a book</span></button></div>
    </section>
    <section class="stack g10" aria-label="Practice">
      <div class="sect-head"><h2>Practice</h2></div>
      <div class="quick">
        <button class="qtile" data-mode="weak">${ICON.target}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="qtile" data-mode="mock">${ICON.clock}<b>Mock paper</b><span>DSE-style, timed</span></button>
      </div>
      ${(local.worksheets || []).length ? `<button class="weekstrip" id="worksheets"><span class="wt"><b>Mark a printed worksheet</b><span>Enter the answers you wrote on paper</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></button>` : ''}
    </section>
    <button class="weekstrip" id="progress"><span class="dots" aria-hidden="true">${r.days.map((m) => `<i class="${m ? 'on' : ''}"></i>`).join('')}</span><span class="wt"><b>${r.dp} of 7 days practised</b><span>See your progress and send a report to your parents</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></button>
  </main>${footerHTML()}`;
  bindHomeCommon();
  const pr = document.getElementById('progress'); if (pr) pr.onclick = () => go({ name: 'progress' });
  const wsb = document.getElementById('worksheets'); if (wsb) wsb.onclick = () => go({ name: 'worksheets' });
  const mkb = document.getElementById('mistakes'); if (mkb) mkb.onclick = () => go({ name: 'mistakes' });
  const ct = document.getElementById('continue');
  if (ct) ct.onclick = () => { pick = { bookId: last.book.id, ids: new Set([last.unit.id]) }; go({ name: 'book', bookId: last.book.id }); };
  document.getElementById('allbooks').onclick = () => go({ name: 'books' });
  document.getElementById('addbook').onclick = () => go({ name: 'books' });
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => (b.dataset.mode === 'spaced' ? startReview('spaced') : go({ name: 'pick', mode: b.dataset.mode }))));
  window.scrollTo(0, 0);
}
const footerHTML = () => `<footer>Prototype. Your textbooks, questions and progress are saved on this device only. Questions are written by AI and checked by AI; tap "Report a problem" if one looks wrong. <button class="link quiet" id="usage" style="font-size:11px;padding:0">AI usage</button></footer>`;
function bindHomeCommon() {
  document.getElementById('usage').onclick = () => go({ name: 'usage' });
  document.getElementById('lang').onclick = () => { setLang(LANG === 'zh' ? 'en' : 'zh'); go({ name: 'home' }); renderTabs(); };
}

/* ---------- Books: my textbooks, the library and uploads ---------- */
async function renderBooks() {
  const books = await getBooks();
  const rows = [];
  for (const b of books) {
    const { n } = await bookSummary(b); const sc = (await bookMastery(b)).pct;
    rows.push(`<button class="row" data-book="${esc(b.id)}"><div class="top"><span style="display:flex;gap:12px;align-items:center"><span class="spine" style="background:${coverColour(b)}" aria-hidden="true"></span><span><b style="font-weight:600" data-raw>${esc(b.title)}</b><br><span class="muted" style="font-size:13px">${b.subject ? esc(b.subject) + ' · ' : ''}${b.units.length} chapters · ${n} questions${b.library ? '' : ' · uploaded'}</span></span></span>
      <span class="m-pill ${sc >= 80 ? 'good' : sc >= 60 ? 'mid' : ''}">${sc}%<small>mastered</small></span></div></button>`);
  }
  $app.innerHTML = `
  <main class="pad stack g18" data-view="books" style="flex:1">
    <h1 class="pagetitle">Books</h1>
    <form id="find" class="searchbox light" role="search"><span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off"></form>
    <section class="stack g10" aria-label="My textbooks">
      <h2 style="margin:0;font-size:16px">My textbooks</h2>
      ${rows.length ? `<div class="card stack">${rows.join('')}</div>` : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:var(--text-2)">No textbooks yet. Search above to add one from the library.</p></div>`}
    </section>
  </main>`;
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  const q = document.getElementById('q');
  q.onfocus = () => go({ name: 'library', query: q.value });
  document.getElementById('find').onsubmit = (e) => { e.preventDefault(); go({ name: 'library', query: q.value }); };
  window.scrollTo(0, 0);
}

/* ---------- tab bar ---------- */
const TABS = [['home', 'Today', 'today'], ['books', 'Books', 'books'], ['mistakes', 'Mistakes', 'pen'], ['progress', 'Progress', 'chart']];
let tabNow = null;
function renderTabs(active = tabNow) {
  tabNow = active;
  const nav = document.getElementById('tabs');
  if (!active) { delete document.body.dataset.tab; return; }
  document.body.dataset.tab = active;
  const mk = mistakeCount();
  nav.innerHTML = `<span class="brand-side">PrepBuddy</span><div class="tabs-in">${TABS.map(([k, label, ic]) => `<button class="${k === active ? 'on' : ''}" data-tabgo="${k}" ${k === active ? 'aria-current="page"' : ''}>${ICON[ic]}<span>${label}</span>${k === 'mistakes' && mk ? `<span class="badge">${mk > 99 ? '99+' : mk}</span>` : ''}</button>`).join('')}</div>`;
  nav.querySelectorAll('[data-tabgo]').forEach((b) => (b.onclick = () => go({ name: b.dataset.tabgo })));
}
// The tab bar shows on the four main screens and hides everywhere else (practice, settings, papers).
new MutationObserver(() => { const m = $app.querySelector('main[data-view]'); renderTabs(m ? m.dataset.view : null); }).observe($app, { childList: true });

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
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to Books">${ICON.back}</button><span style="font-weight:600;font-size:15px">Textbook library</span></div>
  <main class="stack g14" data-view="books" style="flex:1;padding:4px 20px 24px">
    <form id="find" class="searchbox light" role="search">
      <span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
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
    document.getElementById('results').innerHTML = (codeHit ? '<p class="hint" style="margin:0;font-weight:600;color:var(--good)">Book code matched</p>' : '') + (hits.length
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
      : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5">No textbook matches “${esc(raw)}”.</p><p class="muted" style="margin:8px 0 0;font-size:14px;line-height:1.5">Check the spelling or the book code and try again.</p></div>`);
    document.querySelectorAll('[data-add]').forEach((btn) => (btn.onclick = () => addFromLibrary(list.find((b) => b.id === btn.dataset.add), btn)));
    document.querySelectorAll('[data-open]').forEach((btn) => (btn.onclick = () => go({ name: 'book', bookId: 'lib-' + btn.dataset.open })));
  };
  q.oninput = draw;
  document.getElementById('find').onsubmit = (e) => { e.preventDefault(); q.blur(); };
  document.getElementById('back').onclick = () => go({ name: 'books' });
  draw();
  q.focus();
}

async function addFromLibrary(entry, btn) {
  const id = libBookId(entry);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    const qr = await fetch(`library/${entry.id}/questions.json`);
    const bank = qr.ok ? await qr.json() : {};
    // Chapter text is downloaded 8 chapters at a time; diagram pictures are fetched later, only when a chapter needs them.
    let next = 0, done = 0;
    const one = async (u) => {
      for (let tryNo = 1; ; tryNo++) {
        const tr = await fetch(`library/${entry.id}/${u.id}.txt`).catch(() => null);
        if (tr && tr.ok) { await store.set(`text:${id}:${u.id}`, await tr.text()); break; }
        if (tryNo >= 3) throw new Error('Part of this textbook could not be downloaded. Please try again.');
        await new Promise((r) => setTimeout(r, 800 * tryNo));
      }
      const existing = await getQs(id, u.id);
      const have = new Set(existing.map((q) => q.id));
      const ready = (bank[u.id] || []).map((q) => ({ ...q, id: `${id}:${u.id}:${q.id}`, section: u.title, pages: q.pages || `${u.startPage}-${u.endPage}` }))
        .filter((q) => !have.has(q.id));
      if (ready.length) await setQs(id, u.id, existing.concat(ready));
      done++;
      if (btn) btn.textContent = `Adding… ${Math.round(100 * done / entry.units.length)}%`;
    };
    await Promise.all(Array.from({ length: Math.min(8, entry.units.length) }, async () => { while (next < entry.units.length) await one(entry.units[next++]); }));
    await store.persist();
    const books = (await store.get('books', [])).filter((b) => b.id !== id);
    books.unshift({ id, library: entry.id, code: entry.code, title: entry.title, subject: entry.subject, level: entry.level,
      credit: entry.credit, pageCount: entry.pageCount, addedAt: Date.now(), units: entry.units.map((u) => ({ ...u })), kind: entry.kind || guessKind(`${entry.subject || ''} ${entry.title}`, '') });
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
    const book = await readBook(new Uint8Array(data), (i, n, msg) => {
      const now = Date.now(); if (now - last < 150 && i < n && !msg) return; last = now;
      show(Math.round(100 * i / n), msg || `Page ${i} of ${n}`);
    });
    if (!book.units.length) throw new Error('No chapters with enough text were found in this PDF.');
    // AI tidy-up: fix chapter names and boundaries using the contents page and page headings.
    show(100, 'Checking chapter names…');
    const tidy = await tidyChapters(file.name, book);
    if (tidy) { book.units = tidy; book.method = 'ai'; }
    show(100, `Found ${book.units.length} chapters. Saving…`);
    await store.persist();
    const id = 'b' + uid();
    const units = book.units.map((u, i) => ({ id: 'u' + i, title: u.title, chapter: u.chapter || null, startPage: u.startPage, endPage: u.endPage, chars: u.text.length }));
    if (book.pageTexts) await store.set(`pages:${id}`, book.pageTexts);
    for (let i = 0; i < book.units.length; i++) {
      await store.set(`text:${id}:u${i}`, book.units[i].text);
      if ((book.units[i].figures || []).length) await store.set(`figs:${id}:u${i}`, book.units[i].figures);
    }
    const title = (book.title && book.title.length > 3 && !/^untitled|microsoft word/i.test(book.title)) ? book.title : file.name.replace(/\.pdf$/i, '').replace(/^[0-9a-f]{6,}[-_ ]+/i, '').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' – ').trim() || 'My book';
    const books = await store.get('books', []);
    books.unshift({ id, title, fileName: file.name, addedAt: Date.now(), pageCount: book.pageCount, method: book.method, units, kind: guessKind(title, book.units.map((u) => u.text).join('\n')) });
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

async function tidyChapters(fileName, book) {
  if (!book.outline || !book.pageTexts) return null;
  try {
    const r = await api('chapters', { title: fileName, text: book.outline, pageCount: book.pageCount, lang: langOf(book.outline) });
    const { unitsFromStarts } = await import('./book.js');
    const units = unitsFromStarts(book.pageTexts, r.chapters || []);
    const chars = (us) => us.reduce((a, u) => a + u.text.length, 0);
    // Only use the AI's version if it is sensible: a few chapters and most of the teaching text kept.
    if (units.length < 2 || units.length > 150 || chars(units) < 0.6 * chars(book.units)) return null;
    const figs = book.units.flatMap((u) => u.figures || []);
    units.forEach((u) => { u.figures = figs.filter((f, i, a) => f.page >= u.startPage && f.page <= u.endPage && a.findIndex((g) => g.page === f.page) === i).slice(0, 6); });
    return units;
  } catch (e) { return null; } // offline or AI unavailable: keep the app's own split
}

/* ---------- edit chapters: rename, merge, split, hide ---------- */
async function saveBook(book) {
  const books = await store.get('books', []);
  const i = books.findIndex((b) => b.id === book.id);
  if (i >= 0) books[i] = book; await store.set('books', books);
  aliases.set(book.id, book.alias || {});
}
async function renderEdit(bookId, openSplit) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const pages = await store.get(`pages:${bookId}`, null);
  const hidden = book.hiddenUnits || [];
  const row = (u, i) => {
    const last = i === book.units.length - 1;
    const canSplit = pages && u.endPage > u.startPage;
    return `<div class="erow" data-u="${esc(u.id)}">
      <input class="etitle" data-title="${esc(u.id)}" value="${esc(u.title)}" aria-label="Chapter name" data-raw>
      <span class="muted epages">${u.startPage ? `pp. ${u.startPage}–${u.endPage}` : ''}</span>
      ${openSplit === u.id ? `<div class="esplit"><label>Start a new chapter at page <select id="splitAt">${Array.from({ length: u.endPage - u.startPage }, (_, k) => u.startPage + 1 + k).map((p) => `<option value="${p}">${p}${pages[p - 1] ? ` – ${esc(pages[p - 1].split('\n')[0].slice(0, 40))}` : ''}</option>`).join('')}</select></label>
          <div class="eacts"><button class="btn small" id="doSplit" data-u="${esc(u.id)}">Split here</button><button class="link quiet" id="noSplit">Cancel</button></div></div>`
        : `<div class="eacts">${last ? '' : `<button class="link" data-merge="${esc(u.id)}">Merge with next</button>`}${canSplit ? `<button class="link" data-split="${esc(u.id)}">Split</button>` : ''}<button class="link quiet" data-hide="${esc(u.id)}">Hide</button></div>`}
    </div>`;
  };
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button><span style="font-weight:600;font-size:15px">Edit chapters</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Fix chapter names, merge or split chapters, or hide parts that aren’t for revising (like answers or the index). Your questions and progress are kept.</p>
    ${pages ? '' : `<p class="hint" style="margin:0">${book.library ? 'Library books can be renamed, merged or hidden.' : 'Splitting needs the book uploaded again (books uploaded before today can still be renamed, merged or hidden).'}</p>`}
    <div class="card stack">${book.units.map(row).join('')}</div>
    ${hidden.length ? `<p style="margin:6px 0 0;font-size:15px;font-weight:600">Hidden (${hidden.length})</p>
      <div class="card stack">${hidden.map((u) => `<div class="erow hiddenrow"><span data-raw>${esc(u.title)}</span><span class="muted epages">${u.startPage ? `pp. ${u.startPage}–${u.endPage}` : ''}</span><div class="eacts"><button class="link" data-show="${esc(u.id)}">Show</button></div></div>`).join('')}</div>` : ''}
  </main>
  <div class="sheet sticky"><button class="btn" id="done">Done</button></div>`;
  const again = async (split) => { const y = window.scrollY; await renderEdit(bookId, split); window.scrollTo(0, y); };
  document.getElementById('back').onclick = () => go({ name: 'book', bookId });
  document.getElementById('done').onclick = () => go({ name: 'book', bookId });
  $app.querySelectorAll('[data-title]').forEach((inp) => (inp.onchange = async () => {
    const u = book.units.find((x) => x.id === inp.dataset.title); const t = inp.value.trim();
    if (!u || !t || t === u.title) return;
    u.title = t.slice(0, 140); await saveBook(book);
    const qs = await getQs(bookId, u.id); qs.forEach((q) => { q.section = u.title; }); await setQs(bookId, u.id, qs);
    toast('Saved');
  }));
  $app.querySelectorAll('[data-merge]').forEach((b) => (b.onclick = async () => {
    const i = book.units.findIndex((x) => x.id === b.dataset.merge), A = book.units[i], B = book.units[i + 1]; if (!A || !B) return;
    const tA = await store.get(`text:${bookId}:${A.id}`, ''), tB = await store.get(`text:${bookId}:${B.id}`, '');
    const text = pages && A.startPage && B.endPage ? pages.slice(A.startPage - 1, B.endPage).join('\n\n') : `${tA}\n\n${tB}`;
    await store.set(`text:${bookId}:${A.id}`, text);
    const qa = await getQs(bookId, A.id), qb = await getQs(bookId, B.id);
    await setQs(bookId, A.id, qa.concat(qb.map((q) => ({ ...q, section: A.title }))));
    const fa = await store.get(`figs:${bookId}:${A.id}`, []), fb = await store.get(`figs:${bookId}:${B.id}`, []);
    await store.set(`figs:${bookId}:${A.id}`, fa.concat(fb).slice(0, 8));
    for (const k of [`text:${bookId}:${B.id}`, `qs:${bookId}:${B.id}`, `figs:${bookId}:${B.id}`, `notes:${bookId}:${B.id}`, `notes:${bookId}:${A.id}`]) await store.del(k);
    A.endPage = B.endPage || A.endPage; A.chars = text.length;
    book.alias = { ...(book.alias || {}), [B.id]: A.id };
    book.units.splice(i + 1, 1); pick.ids.delete(B.id);
    await saveBook(book); toast('Chapters merged'); again();
  }));
  $app.querySelectorAll('[data-split]').forEach((b) => (b.onclick = () => again(b.dataset.split)));
  const ns = document.getElementById('noSplit'); if (ns) ns.onclick = () => again();
  const ds = document.getElementById('doSplit');
  if (ds) ds.onclick = async () => {
    const i = book.units.findIndex((x) => x.id === ds.dataset.u), A = book.units[i];
    const at = +document.getElementById('splitAt').value;
    const ids = [...book.units, ...(book.hiddenUnits || [])].map((x) => +String(x.id).replace(/\D/g, '') || 0).concat(Object.keys(book.alias || {}).map((x) => +x.replace(/\D/g, '') || 0));
    const nid = 'u' + (Math.max(...ids) + 1);
    const first = pages.slice(A.startPage - 1, at - 1).join('\n\n'), second = pages.slice(at - 1, A.endPage).join('\n\n');
    const N = { id: nid, title: `${A.title} (part 2)`, chapter: A.chapter || null, startPage: at, endPage: A.endPage, chars: second.length };
    await store.set(`text:${bookId}:${A.id}`, first); await store.set(`text:${bookId}:${nid}`, second);
    const figs = await store.get(`figs:${bookId}:${A.id}`, []);
    await store.set(`figs:${bookId}:${A.id}`, figs.filter((f) => f.page < at)); await store.set(`figs:${bookId}:${nid}`, figs.filter((f) => f.page >= at));
    await store.del(`notes:${bookId}:${A.id}`);
    A.endPage = at - 1; A.chars = first.length;
    book.units.splice(i + 1, 0, N);
    await saveBook(book); toast('Chapter split. Check the new chapter’s name.'); await again();
    const inp = $app.querySelector(`[data-title="${nid}"]`); if (inp) { inp.focus(); inp.select(); }
  };
  $app.querySelectorAll('[data-hide]').forEach((b) => (b.onclick = async () => {
    if (book.units.length <= 1) return toast('A book needs at least one chapter.');
    const i = book.units.findIndex((x) => x.id === b.dataset.hide);
    book.hiddenUnits = [...(book.hiddenUnits || []), ...book.units.splice(i, 1)]; pick.ids.delete(b.dataset.hide);
    await saveBook(book); again();
  }));
  $app.querySelectorAll('[data-show]').forEach((b) => (b.onclick = async () => {
    const i = book.hiddenUnits.findIndex((x) => x.id === b.dataset.show);
    book.units.push(...book.hiddenUnits.splice(i, 1)); book.units.sort((x, y) => (x.startPage || 0) - (y.startPage || 0));
    await saveBook(book); again();
  }));
}

/* ---------- book: chapter list ---------- */
let pick = { bookId: null, ids: new Set() }; // chapters ticked on the book screen

async function renderBook(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  if (pick.bookId !== bookId) pick = { bookId, ids: new Set(), open: new Set() };
  if (!book.kind) {
    const books = await store.get('books', []); const b = books.find((x) => x.id === bookId);
    const sample = book.units[0] ? await store.get(`text:${bookId}:${book.units[0].id}`, '') : '';
    book.kind = guessKind(`${book.subject || ''} ${book.title}`, sample);
    if (b) { b.kind = book.kind; await store.set('books', books); }
  }
  bookKinds.set(book.id, kindOfBook(book));
  const t = local.types || 'mix';
  const count = local.count || SESSION_SIZE;
  const bm = await bookMastery(book);
  const bmByUnit = Object.fromEntries(bm.chapters.map((c) => [c.unit.id, c]));
  // Sections are grouped under their chapter ("1.1", "1.2" → Chapter 1) so long books stay short to scroll.
  const groupOf = (u) => { if (u.chapter) return u.chapter; const m = String(u.title).match(/^\s*(\d{1,2})\.\d/); return m ? `Chapter ${m[1]}` : null; };
  const groups = [];
  // sections without a number (e.g. "Glossary") belong to the chapter they follow
  for (const u of book.units) { const last = groups[groups.length - 1]; const g = groupOf(u) || (last ? last.name : ''); if (last && last.name === g) last.units.push(u); else groups.push({ name: g, units: [u] }); }
  const grouped = book.units.length > 12 && groups.length >= 2 && groups.every((g) => g.name);
  if (!pick.open) pick.open = new Set();
  if (grouped && !pick.openSet) {
    pick.openSet = true;
    groups.forEach((g) => { if (g.units.some((u) => pick.ids.has(u.id) || (bmByUnit[u.id] || {}).done)) pick.open.add(g.name); });
    if (!pick.open.size) pick.open.add(groups[0].name);
  }
  const cleanTitle = (t) => String(t).replace(/\s*\*+\s*$/, '');
  const pctColour = (sc) => (sc < 60 ? 'var(--miss)' : sc < 80 ? 'var(--accent)' : 'var(--good)');
  const row = (u) => {
    const c = bmByUnit[u.id] || { pct: 0, done: 0 };
    const on = pick.ids.has(u.id);
    const sh = levelShift(book.id, u.id);
    return `<button class="crow ${on ? 'picked' : ''}" data-unit="${esc(u.id)}" aria-pressed="${on}" data-name="${esc(String(u.title).toLowerCase())}" title="${u.startPage ? `pp. ${u.startPage}–${u.endPage}` : ''}${sh > 0 ? ' · harder questions now' : sh < 0 ? ' · more basics first' : ''}">
      <span class="box ${on ? 'on' : ''}" aria-hidden="true">${on ? ICON.check : ''}</span>
      <span class="ct" data-raw>${esc(cleanTitle(u.title))}</span>
      ${c.done ? `<span class="cp" style="color:${pctColour(c.pct)}">${c.pct}%</span>` : `<span class="cpp">${u.startPage ? `p. ${u.startPage}` : ''}</span>`}
    </button>`;
  };
  const listHTML = grouped
    ? groups.map((g) => {
      const open = pick.open.has(g.name);
      const ids = g.units.map((u) => u.id);
      const nOn = ids.filter((id) => pick.ids.has(id)).length;
      const done = g.units.some((u) => (bmByUnit[u.id] || {}).done);
      const w = g.units.reduce((t, u) => t + ((bmByUnit[u.id] || {}).weight || 1), 0) || 1;
      const gp = Math.round(g.units.reduce((t, u) => t + ((bmByUnit[u.id] || {}).pct || 0) * ((bmByUnit[u.id] || {}).weight || 1), 0) / w);
      return `<section class="cgroup ${open ? 'open' : ''}" data-g="${esc(g.name)}">
        <div class="ghead">
          <button class="gpick box ${nOn === ids.length ? 'on' : ''}" data-gpick="${esc(g.name)}" aria-label="Tick all of ${esc(g.name)}">${nOn === ids.length ? ICON.check : nOn ? '<i class="partial"></i>' : ''}</button>
          <button class="gtoggle" data-gtoggle="${esc(g.name)}" aria-expanded="${open}"><b data-raw>${esc(g.name)}</b><span class="gmeta">${g.units.length} sections${nOn ? ` · ${nOn} ticked` : ''}</span>${done ? `<span class="cp" style="color:${pctColour(gp)}">${gp}%</span>` : ''}<span class="chev" aria-hidden="true">${ICON.back}</span></button>
        </div>
        ${open ? `<div class="gbody">${g.units.map(row).join('')}</div>` : ''}
      </section>`;
    }).join('')
    : `<div class="gbody flat">${book.units.map(row).join('')}</div>`;
  const n = pick.ids.size;
  const mins = Math.max(1, Math.round(count * (t === 'mcq' ? 0.5 : t === 'written' ? 1.5 : 0.8)));
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-raw>${esc(book.title)}</span></div>
  <div class="bookpage">
  <main class="bk-main stack g14">
    <div class="chtools">
      <p style="margin:0;font-size:15px;font-weight:600">1. Choose chapters <span class="muted" style="font-weight:500">(${book.units.length})</span></p>
      ${book.units.length > 1 ? `<button class="link" id="all" style="padding:0">${n === book.units.length ? 'Clear all' : 'Select all'}</button>` : ''}
      ${book.units.length > 12 ? `<label class="chsearch"><span aria-hidden="true">${ICON.search}</span><input id="chsearch" type="search" placeholder="Find a chapter" aria-label="Find a chapter" autocomplete="off"></label>` : ''}
    </div>
    <div class="chlist" id="chlist">${listHTML}</div>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.5">${book.library
      ? `From the PrepBuddy library · book code ${esc(book.code)}${book.credit ? `<br>Source: ${esc(book.credit)}` : ''}`
      : `Uploaded by you · ${book.pageCount} pages · chapters found from ${book.method === 'ai' ? 'the contents page and headings, checked by AI' : book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}`}</p>
    <button class="link quiet" id="delete" style="align-self:flex-start">Remove from my textbooks</button>
  </main>
  <aside class="bk-side">
    ${masteryCard(bm)}
  <div class="sheet sticky setup ${n ? 'armed' : ''} ${pick.opts ? 'expanded' : ''}">
    <div class="setup-head"><p style="margin:0;font-size:15px;font-weight:600">2. Set up your practice${n ? ` <span class="muted" style="font-weight:500">· ${n} chapter${n > 1 ? 's' : ''} ticked</span>` : ''}</p>${n ? `<button class="link setup-more" id="opts" aria-expanded="${!!pick.opts}">${pick.opts ? 'Fewer options' : 'More options'}</button>` : ''}</div>
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
    <button class="btn" id="go" ${n ? '' : 'disabled'}>${n ? `Start ${count} questions · about ${mins} min` : 'Tick at least one chapter'}</button>
    <button class="btn ghost" id="ctest" ${n ? '' : 'disabled'}>${ICON.clock} Take a chapter test</button>
    <div class="revise-row"><button class="btn ghost" id="notes" ${n ? '' : 'disabled'}>${ICON.notes} Notes</button><button class="btn ghost" id="cards" ${n ? '' : 'disabled'}>${ICON.cards} Flashcards</button></div>
    <button class="link" id="paper" style="align-self:center;padding:2px 0">Or make a DSE-style mock paper / worksheet</button>
  </div>
  </aside>
  </div>`;
  $app.querySelectorAll('[data-gtoggle]').forEach((b) => (b.onclick = () => { const g = b.dataset.gtoggle; pick.open.has(g) ? pick.open.delete(g) : pick.open.add(g); keep(); }));
  $app.querySelectorAll('[data-gpick]').forEach((b) => (b.onclick = () => {
    const g = groups.find((x) => x.name === b.dataset.gpick); const ids = g.units.map((u) => u.id);
    const all = ids.every((id) => pick.ids.has(id));
    ids.forEach((id) => (all ? pick.ids.delete(id) : pick.ids.add(id))); if (!all) pick.open.add(g.name); keep();
  }));
  const op = document.getElementById('opts'); if (op) op.onclick = () => { pick.opts = !pick.opts; keep(); };
  const cs = document.getElementById('chsearch');
  if (cs) cs.oninput = () => {
    const w = cs.value.trim().toLowerCase();
    if (grouped && w) {   // searching: show matching sections from every group
      document.getElementById('chlist').innerHTML = `<div class="gbody flat">${book.units.filter((u) => String(u.title).toLowerCase().includes(w)).map(row).join('') || '<p class="muted" style="margin:12px 16px">No chapter matches.</p>'}</div>`;
    } else if (grouped) return keep(); // back to the grouped list
    else $app.querySelectorAll('.crow').forEach((r) => { r.hidden = !!w && !r.dataset.name.includes(w); });
    bindRows();
  };
  const keep = async () => { const y = window.scrollY; await renderBook(bookId); window.scrollTo(0, y); };
  document.getElementById('back').onclick = () => { pick = { bookId: null, ids: new Set() }; go({ name: 'home' }); };
  const a = document.getElementById('all');
  if (a) a.onclick = () => { if (pick.ids.size === book.units.length) pick.ids.clear(); else book.units.forEach((u) => pick.ids.add(u.id)); keep(); };
  function bindRows() { $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => { const id = b.dataset.unit; pick.ids.has(id) ? pick.ids.delete(id) : pick.ids.add(id); keep(); })); }
  bindRows();
  $app.querySelectorAll('[data-types]').forEach((b) => (b.onclick = () => { local.types = b.dataset.types; saveLocal(); keep(); }));
  const step = (d) => { local.count = Math.min(100, Math.max(5, (local.count || SESSION_SIZE) + d)); saveLocal(); keep(); };
  document.getElementById('minus').onclick = () => step((local.count || SESSION_SIZE) > 20 ? -10 : -5);
  document.getElementById('plus').onclick = () => step((local.count || SESSION_SIZE) >= 20 ? 10 : 5);
  document.getElementById('go').onclick = () => { const units = book.units.filter((u) => pick.ids.has(u.id)); startUnits(book, units, local.count || SESSION_SIZE); };
  document.getElementById('delete').onclick = () => confirmRemove(book);
  const bst = document.getElementById('boost'); if (bst) bst.onclick = () => boostSession(book);
  $app.querySelectorAll('[data-step-unit]').forEach((b) => (b.onclick = () => {
    const u = book.units.find((x) => x.id === b.dataset.stepUnit);
    if (b.dataset.stepKind === 'test' && u) return startChapterTest(book, [u]);
    if (b.dataset.stepKind === 'mistakes') return go({ name: 'mistakes' });
    if (b.dataset.stepKind === 'review') return startReview('spaced');
    pick.ids = new Set([b.dataset.stepUnit]); keep();
  }));
  document.getElementById('ctest').onclick = () => { const units = book.units.filter((u) => pick.ids.has(u.id)); if (units.length) startChapterTest(book, units); };
  document.getElementById('paper').onclick = () => go({ name: 'paper', bookId });
  document.getElementById('notes').onclick = () => go({ name: 'notes', bookId });
  document.getElementById('cards').onclick = () => go({ name: 'cards', bookId });
  window.scrollTo(0, 0);
}

/* ---------- revision notes and flashcards (made once per chapter, kept on this device) ---------- */
const notesJobs = new Map();
function getNotes(book, unit, fresh) {
  const key = `notes:${book.id}:${unit.id}`;
  if (!fresh && notesJobs.has(key)) return notesJobs.get(key);
  const p = (async () => {
    if (!fresh) { const have = await store.get(key, null); if (have) return have; }
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    if (!text) throw new Error('This chapter’s text is missing on this device.');
    const n = await api('notes', { title: unit.title, text, kind: kindOfBook(book), lang: langOf(text) });
    delete n.usage;
    n.at = Date.now();
    await store.set(key, n);
    return n;
  })();
  notesJobs.set(key, p);
  p.catch(() => notesJobs.delete(key));
  return p;
}
const notesError = (e) => (e.status === 0 ? 'You seem to be offline.' : e.status === 401 ? 'That access code didn’t work.' : 'Couldn’t make notes for this chapter. Try again in a moment.');

function notesHTML(u, n) {
  return `<h2 class="ntitle" data-raw>${esc(u.title)}</h2>
    <div data-raw class="nbody">
    ${n.sections.map((s) => `<h3>${esc(s.heading)}</h3><ul>${s.points.map((p) => `<li>${tutorMd(p).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>`).join('')}
    ${n.formulas.length ? `<h3 class="nlabel">${LANG === 'zh' ? '公式' : 'Formulas'}</h3>${n.formulas.map((f) => `<div class="fml"><div>${esc(f.formula)}</div><span>${esc(f.meaning)}</span></div>`).join('')}` : ''}
    ${n.key_terms.length ? `<h3 class="nlabel">${LANG === 'zh' ? '關鍵詞' : 'Key terms'}</h3><dl class="terms">${n.key_terms.map((k) => `<div><dt>${esc(k.term)}</dt><dd>${esc(k.meaning)}</dd></div>`).join('')}</dl>` : ''}
    </div>`;
}

async function renderNotes(bookId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = paperUnits(book), myView = view;
  $app.innerHTML = `
  <div class="topbar noprint"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button><span style="font-weight:600;font-size:15px;flex:1">Revision notes</span><button class="link quiet" id="printn" style="padding:0 8px">Print</button></div>
  <main class="stack g18 notes" style="flex:1;padding:4px 20px 24px">
    ${units.map((u) => `<section class="ncard" id="n-${esc(u.id)}"><h2 class="ntitle" data-raw>${esc(u.title)}</h2><div class="nwait"><div class="spinner small" aria-hidden="true"></div><span>Writing notes from your textbook…</span></div></section>`).join('')}
    <p class="hint" style="margin:0;line-height:1.5">Written by AI from your textbook. If something looks wrong, check it against the book.</p>
  </main>
  <div class="sheet sticky noprint">
    <button class="btn" id="tocards">${ICON.cards} Practise with flashcards</button>
    <span class="hint" style="text-align:center">Notes are saved on this device, so they open instantly next time.</span>
  </div>`;
  document.getElementById('back').onclick = () => go({ name: 'book', bookId });
  document.getElementById('printn').onclick = () => window.print();
  document.getElementById('tocards').onclick = () => go({ name: 'cards', bookId });
  const fill = (u, fresh) => {
    const el = document.getElementById(`n-${u.id}`); if (!el) return;
    if (fresh) el.innerHTML = `<h2 class="ntitle" data-raw>${esc(u.title)}</h2><div class="nwait"><div class="spinner small" aria-hidden="true"></div><span>Writing notes from your textbook…</span></div>`;
    getNotes(book, u, fresh).then((n) => {
      if (view !== myView) return;
      const e2 = document.getElementById(`n-${u.id}`); if (!e2) return;
      e2.innerHTML = notesHTML(u, n) + `<button class="link quiet noprint" data-remake="${esc(u.id)}" style="align-self:flex-start;font-size:12px;padding:4px 0 0">Make these notes again</button>`;
      e2.querySelector('[data-remake]').onclick = () => fill(u, true);
    }).catch((e) => {
      if (view !== myView) return;
      const e2 = document.getElementById(`n-${u.id}`); if (!e2) return;
      e2.innerHTML = `<h2 class="ntitle" data-raw>${esc(u.title)}</h2><p class="hint" style="margin:0;color:var(--miss-dark)">${esc(notesError(e))}</p><button class="link" data-retry>Try again</button>`;
      e2.querySelector('[data-retry]').onclick = () => fill(u, false);
    });
  };
  units.forEach((u) => fill(u, false));
}

let C = null; // the flashcard session
async function renderCards(bookId, only) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = paperUnits(book), myView = view;
  if (!only) {
    $app.innerHTML = `<div class="topbar"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button></div>
    <main class="pad stack g18" style="flex:1;justify-content:center;text-align:center;align-items:center">
      <div class="spinner" aria-hidden="true"></div><h1 class="display" style="margin:0;font-size:22px">Making your flashcards</h1>
      <p class="muted" id="cw" style="margin:0;line-height:1.5;max-width:320px">Written from your textbook. The first time takes about 20–40 seconds per chapter.</p></main>`;
    document.getElementById('back').onclick = () => go({ name: 'book', bookId });
    const res = await Promise.allSettled(units.map((u) => getNotes(book, u).then((n) => n.flashcards.map((c) => ({ ...c, unit: u.title })))));
    if (view !== myView) return;
    const deck = res.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    if (!deck.length) {
      const e = (res.find((r) => r.status === 'rejected') || {}).reason || {};
      $app.querySelector('main').innerHTML = `<h1 class="display" style="margin:0;font-size:22px">Couldn’t make flashcards</h1><p style="margin:0;line-height:1.5;max-width:320px">${esc(notesError(e))}</p><button class="btn" id="again" style="max-width:320px">Try again</button>`;
      document.getElementById('again').onclick = () => renderCards(bookId);
      return;
    }
    only = shuffle(deck);
  }
  C = { bookId, queue: [...only], total: only.length, seen: 0, missed: [], firstTry: new Set(), flipped: false };
  drawCard();
}
function drawCard() {
  const c = C.queue[0];
  if (!c) return cardsDone();
  const done = C.total - C.queue.length;
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="quit" aria-label="Stop flashcards">${ICON.close}</button><div class="progress"><i style="width:${Math.round(100 * done / C.total)}%"></i></div><span class="count">${done + 1} / ${C.total}</span></div>
  <main class="pad stack g18" style="flex:1;padding-top:12px">
    <span class="chip grey" style="align-self:flex-start" data-raw>${esc(c.unit)}</span>
    <button class="fcard ${C.flipped ? 'flipped' : ''}" id="flip" aria-live="polite" data-hotkey=" ">
      <span class="fside">${C.flipped ? (LANG === 'zh' ? '答案' : 'Answer') : (LANG === 'zh' ? '問題' : 'Question')}</span>
      <span class="ffront" data-raw>${esc(c.front)}</span>
      ${C.flipped ? `<span class="fback" data-raw>${esc(c.back)}</span>` : `<span class="hint">Tap to see the answer</span>`}
    </button>
  </main>
  <div class="sheet">
    ${C.flipped ? `<div class="revise-row"><button class="btn ghost" id="again" data-hotkey="ArrowLeft">Again</button><button class="btn" id="know" data-hotkey="ArrowRight">Got it</button></div>`
      : `<button class="btn" id="show">Show answer</button>`}
  </div>`;
  const flip = () => { C.flipped = !C.flipped; drawCard(); };
  document.getElementById('flip').onclick = flip;
  const sh = document.getElementById('show'); if (sh) sh.onclick = flip;
  const k = (knew) => {
    const card = C.queue.shift(); C.flipped = false;
    if (knew) { if (!C.missed.includes(card)) C.firstTry.add(card); }
    else { if (!C.missed.includes(card)) C.missed.push(card); C.queue.splice(Math.min(C.queue.length, 4), 0, card); }
    drawCard();
  };
  const a = document.getElementById('again'); if (a) a.onclick = () => k(false);
  const n = document.getElementById('know'); if (n) n.onclick = () => k(true);
  document.getElementById('quit').onclick = () => go({ name: 'book', bookId: C.bookId });
}
function cardsDone() {
  const missed = C.missed.length;
  $app.innerHTML = `<main class="pad stack g22" style="flex:1">
    <div class="stack g6"><span class="muted" style="font-size:13px">Flashcards · done</span><span class="score">${C.firstTry.size} / ${C.total}</span><span style="font-size:15px;font-weight:600;color:var(--good)">known first time</span></div>
    ${missed ? `<p style="margin:0;line-height:1.5;color:var(--text-2)">${missed} card${missed > 1 ? 's' : ''} needed another go. Going through them again helps them stick.</p>` : '<p style="margin:0;line-height:1.5;color:var(--text-2)">You knew every card first time.</p>'}
    <div class="stack g10">
      ${missed ? `<button class="btn" id="redo">Go through the ${missed} I missed</button>` : ''}
      <button class="btn ${missed ? 'ghost' : ''}" id="all">Shuffle all and go again</button>
      <button class="btn ghost" id="practise">Practise questions on these chapters</button>
      <button class="btn ghost" id="back">Back to chapters</button>
    </div></main>`;
  const deck = [...C.firstTry, ...C.missed];
  const r = document.getElementById('redo'); if (r) r.onclick = () => { const m = shuffle([...C.missed]); const id = C.bookId; C = null; renderCards(id, m); };
  document.getElementById('all').onclick = () => { const id = C.bookId; renderCards(id, shuffle(deck)); };
  document.getElementById('practise').onclick = async () => { const b = (await getBooks()).find((x) => x.id === C.bookId); startUnits(b, paperUnits(b), local.count || SESSION_SIZE); };
  document.getElementById('back').onclick = () => go({ name: 'book', bookId: C.bookId });
}

/* ---------- my progress + report for parents ---------- */
async function currentReport() {
  const books = await getBooks();
  const practised = new Set(local.log.filter((e) => e.t >= Date.now() - 7 * DAY).map((e) => e.q.split(':')[0]));
  const names = books.filter((b) => practised.has(b.id)).map((b) => b.subject || b.title);
  const ms = []; for (const b of books) { const m = await bookMastery(b); if (m.chapters.some((c) => c.done)) ms.push([b.subject || b.title, m.pct]); }
  return buildReport({ log: local.log, stats: local.stats, name: local.name, books: [...new Set(names)], lang: LANG, ms });
}

async function renderProgress() {
  const r = await currentReport();
  const mbooks = await getBooks();
  const mrows = [];
  for (const b of mbooks) { const m = await bookMastery(b); mrows.push(`<button class="mrowb" data-book="${esc(b.id)}"><span class="spine" style="background:${coverColour(b)}" aria-hidden="true"></span><span class="mt"><b data-raw>${esc(b.subject || b.title)}</b><span class="bar ${m.pct < 60 ? 'warn' : m.pct < 80 ? 'mid' : ''}"><i style="width:${m.pct}%"></i></span></span><span class="m-pill ${m.pct >= 80 ? 'good' : m.pct >= 60 ? 'mid' : ''}">${m.pct}%</span></button>`); }
  const mastHTML = mrows.length ? `<section class="card stack g10" style="padding:14px 16px"><b style="font-size:15px">How ready you are</b>${mrows.join('')}<span class="hint">Mastery counts how much of each book you’ve practised, how well, and whether you’ve kept it fresh with reviews.</span></section>` : '';
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'narrow' }));
  const mins = r.days.reduce((a, m) => a + m, 0);
  const hm = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  const trend = r.a !== null && r.pa !== null ? (r.a >= r.pa ? `<span style="color:var(--good);font-weight:600">↑ ${r.a - r.pa} from last week</span>` : `<span style="color:var(--miss-dark);font-weight:600">↓ ${r.pa - r.a} from last week</span>`) : '<span>correct</span>';
  $app.innerHTML = `
  <main class="pad stack g18" data-view="progress" style="flex:1">
    <h1 class="pagetitle">Progress</h1>
    <div class="pg-cols"><div class="pg-col stack g18">
    <section class="pg-week stack g18"><div class="stack g6"><span class="muted" style="font-size:13px">Last 7 days</span><span class="display" style="font-size:26px;font-weight:700;line-height:1.2">${r.dp} of 7 days practised</span></div>
    <div class="week">${r.days.map((m, i) => `<div><span class="${m ? 'on' : ''} ${i === 6 ? 'today' : ''}" title="${m} min"></span><small>${dayNames[i]}</small></div>`).join('')}</div>
    <div class="tiles">
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.q}</b><span>questions</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${hm}</b><span>practising</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.a === null ? '–' : r.a + '%'}</b>${trend}</div>
    </div></section>
    ${mastHTML}
    </div><div class="pg-col stack g18">
    <div class="skills-wrap" data-raw>${skillsHTML(r, LANG === 'zh')}</div>
    <div class="card stack g10 pg-report" style="padding:14px 16px">
      <b style="font-size:15px">Your report for parents</b>
      <span style="font-size:14px;line-height:1.5;color:var(--text-2)">A one-page summary of this week: practice, scores by chapter, what is improving and what needs work.</span>
      <label for="name" style="font-size:13px;font-weight:600;color:var(--muted)">Your name on the report</label>
      <input id="name" class="input" autocomplete="given-name" placeholder="e.g. Ka Yan" value="${esc(local.name)}">
      <a id="preview" href="#" style="font-size:14px;font-weight:600;color:var(--good)">Preview the report</a>
      <div class="pg-send stack g8"><button class="btn" data-send style="display:flex;gap:10px;align-items:center;justify-content:center">${ICON.upload} Send report to parent</button>
      <span class="hint" style="text-align:center">Opens WhatsApp or another app with a link. Your parent doesn't need to sign in.</span></div>
    </div>
    <div id="fallback"></div>
    </div></div>
  </main>
  <div class="sheet sticky pg-sheet">
    <button class="btn" id="send" data-send style="display:flex;gap:10px;align-items:center;justify-content:center">${ICON.upload} Send report to parent</button>
    <span class="hint" style="text-align:center">Opens WhatsApp or another app with a link. Your parent doesn't need to sign in.</span>
  </div>`;
  $app.querySelectorAll('.mrowb[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  const nameEl = document.getElementById('name');
  nameEl.oninput = () => { local.name = nameEl.value.trim().slice(0, 30); saveLocal(); };
  const link = async () => { const rep = await currentReport(); return { rep, url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}report.html#d=${encodeReport(rep)}` }; };
  document.getElementById('preview').onclick = async (e) => { e.preventDefault(); const { url } = await link(); window.open(url, '_blank', 'noopener'); };
  const send = async () => {
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
  $app.querySelectorAll('[data-send]').forEach((b) => (b.onclick = send));
}

/* ---------- AI usage on this device ---------- */
function renderUsage() {
  const u = local.usage || {};
  const steps = [['warm', 'Storing the chapter (cache)'], ['generate', 'Writing questions'], ['verify', 'Checking questions'], ['mark', 'Marking answers'], ['explain', 'Tutor (I don’t get it)'], ['notes', 'Notes and flashcards']];
  const fmt = (n) => (n || 0).toLocaleString('en');
  const tot = { calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0 };
  const usd = (n) => '$' + (n || 0).toFixed((n || 0) >= 1 ? 2 : 3);
  steps.forEach(([k]) => { const r = u[k]; if (r) for (const f in tot) tot[f] += r[f] || 0; });
  const rows = steps.map(([k, name]) => { const r = u[k] || {}; return `<tr><th scope="row">${name}</th><td>${fmt(r.calls)}</td><td>${fmt(r.input)}</td><td>${fmt(r.cache_write)}</td><td>${fmt(r.cache_read)}</td><td>${fmt(r.output)}</td><td><b>${usd(r.usd)}</b></td></tr>`; }).join('');
  const made = u.made || 0;
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">AI usage on this device</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:var(--text-2)">Tokens used since you last reset. Reading PDFs happens on your device and uses no tokens.</p>
    <div style="overflow-x:auto"><table class="data usage">
      <tr><th>Step</th><th>AI calls</th><th>Input</th><th>Cache write</th><th>Cache read</th><th>Output</th><th>Cost (USD)</th></tr>
      ${rows}
      <tr><th scope="row">Total</th><td>${fmt(tot.calls)}</td><td>${fmt(tot.input)}</td><td>${fmt(tot.cache_write)}</td><td>${fmt(tot.cache_read)}</td><td>${fmt(tot.output)}</td><td><b>${usd(tot.usd)}</b></td></tr>
    </table></div>
    <p style="margin:0;font-size:15px;line-height:1.5">Estimated cost: <b>${usd(tot.usd)}</b>${made ? ` · about ${usd((tot.usd - ['mark', 'explain', 'notes'].reduce((x, k) => x + ((u[k] || {}).usd || 0), 0)) / made)} per question made` : ''}${(u.mark || {}).requests ? ` · ${usd(u.mark.usd / u.mark.requests)} per answer marked` : ''}</p>
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
      <b style="color:var(--miss-dark)">This deletes from this device:</b>
      <ul style="margin:0;padding-left:20px;line-height:1.7;color:var(--text-2)">
        <li>${made} practice question${made === 1 ? '' : 's'}</li>
        <li>your scores on ${answered} question${answered === 1 ? '' : 's'}, and their spaced-review schedule</li>
        <li>${activity} answer${activity === 1 ? '' : 's'} in your progress history (used for parent reports)</li>
      </ul>
      <span style="color:var(--text-2);line-height:1.5">This can't be undone. ${book.library ? 'You can add the book again from the library, but your progress will start from zero.' : 'To use it again you will need to upload the PDF again.'}</span>
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
    for (const pre of ['figs', 'notes']) for (const k of await store.keys(`${pre}:${book.id}:`)) await store.del(k);
    await store.del(`pages:${book.id}`);
    for (const k of Object.keys(local.stats)) if (k.startsWith(prefix)) delete local.stats[k];
    local.log = local.log.filter((e) => !e.q.startsWith(prefix));
    local.reports = local.reports.filter((id) => !id.startsWith(prefix));
    for (const k of Object.keys(local.mistakes || {})) if (k.startsWith(prefix)) delete local.mistakes[k];
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

async function renderPaper(bookId, from) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = paperUnits(book);
  const { a, b } = paperSet;
  const mins = paperMinutes(a, b);
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to chapters">${ICON.back}</button><span style="font-weight:600;font-size:15px">Mock paper or worksheet</span></div>
  <main class="stack g18" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:var(--text-2)">A DSE-style paper: <b>Section A</b> multiple choice, then <b>Section B</b> written questions. Sit it timed here and get it marked, or print it and enter your answers in the app afterwards to get them marked.</p>
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
      <span class="muted" style="font-size:14px">Time allowed: <b style="color:var(--ink)">${mins} min</b></span>
    </div>
  </main>
  <div class="sheet sticky">
    <button class="btn" id="sit" ${a + b ? '' : 'disabled'}>Start mock paper · ${mins} min</button>
    <button class="btn ghost" id="print" ${a + b ? '' : 'disabled'}>Print as a worksheet</button>
  </div>`;
  document.getElementById('back').onclick = () => go(from === 'pick' ? { name: 'pick', mode: 'mock' } : from === 'home' ? { name: 'home' } : { name: 'book', bookId });
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
  // Sitting the paper: start once the first few questions are ready; the rest are made while the student answers.
  const enough = () => (nA ? A.length >= Math.min(nA, 4) : B.length >= 1);
  if (purpose === 'sit') {
    if (!enough()) {
      const kick = () => {
        const js = [];
        if (A.length < nA) units.forEach((u) => js.push(ensureFill(book, u, Math.ceil((nA - A.length) / units.length), 'mcq', PAPER_PAR)));
        if (B.length < nB) units.forEach((u) => js.push(ensureFill(book, u, Math.ceil((nB - B.length) / units.length), 'written', PAPER_PAR)));
        return js;
      };
      const js = kick();
      await new Promise((resolve, reject) => {
        let left = js.length;
        js.forEach((j) => j.listeners.add(async (passed, done) => {
          if (paperJob !== token) return resolve();
          all = await pool(); A = take(all, true, nA); B = take(all, false, nB); show(A.length + B.length);
          if (enough()) return resolve();
          if (done && --left === 0) {
            const hard = js.map((x) => x.error).find((e) => e && (e.status === 0 || e.status === 401));
            return hard ? reject(hard) : resolve();
          }
        }));
      });
      if (paperJob !== token) return null;
    }
    if (!A.length && !B.length) throw new Error('No questions could be made for these chapters.');
    return { A: shuffle(A).map(shuffleOptions), B: shuffle(B), nA, nB, units, live: true };
  }
  for (let round = 0; round < 4 && (A.length < nA || B.length < nB); round++) {
    if (paperJob !== token) return null;
    const jobs = [];
    const needA = nA - A.length, needB = nB - B.length;
    if (needA > 0) units.forEach((u) => jobs.push(ensureFill(book, u, Math.ceil(needA / units.length), 'mcq', PAPER_PAR)));
    if (needB > 0) units.forEach((u) => jobs.push(ensureFill(book, u, Math.ceil(needB / units.length), 'written', PAPER_PAR)));
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

const PAPER_PAR = 5;   // batches written side by side per chapter when making a paper

function startDse(book, paper, mins) {
  if (!paper.live) {
    const qs = [...paper.A, ...paper.B];
    S = newSession({ mode: 'dse', title: 'DSE-style mock paper', book, qs, target: qs.length, sectionA: paper.A.length, deadline: Date.now() + mins * 60 * 1000 });
  } else {
    // Section A fills up first; written questions wait in bQueue until Section A is complete.
    const full = paper.A.length >= paper.nA;
    S = newSession({ mode: 'dse', title: 'DSE-style mock paper', book, qs: full ? [...paper.A, ...paper.B] : [...paper.A], bQueue: full ? [] : [...paper.B],
      target: paper.nA + paper.nB, sectionA: paper.nA, deadline: Date.now() + mins * 60 * 1000,
      fill: { units: paper.units, nA: paper.nA, nB: paper.nB, rounds: 0 } });
    pumpPaper(S);
  }
  renderQuestion();
  toast(paper.A.length ? `Section A: ${paper.A.length} multiple-choice questions` : 'Section B: written questions');
}

/* ---------- printed worksheets ----------
   No answer key is printed. Each worksheet has a code; the student enters their answers
   in the app to get them marked. Every page carries the student's name and a QR code. */
const QR_SVG = '<svg class="pqr" role="img" aria-label="QR code for PrepBuddy" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="M4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM15 4h1v1h-1zM19 4h1v1h-1zM20 4h1v1h-1zM21 4h1v1h-1zM22 4h1v1h-1zM26 4h1v1h-1zM27 4h1v1h-1zM30 4h1v1h-1zM31 4h1v1h-1zM32 4h1v1h-1zM33 4h1v1h-1zM34 4h1v1h-1zM35 4h1v1h-1zM36 4h1v1h-1zM4 5h1v1h-1zM10 5h1v1h-1zM15 5h1v1h-1zM21 5h1v1h-1zM23 5h1v1h-1zM24 5h1v1h-1zM26 5h1v1h-1zM28 5h1v1h-1zM30 5h1v1h-1zM36 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM13 6h1v1h-1zM17 6h1v1h-1zM23 6h1v1h-1zM24 6h1v1h-1zM25 6h1v1h-1zM30 6h1v1h-1zM32 6h1v1h-1zM33 6h1v1h-1zM34 6h1v1h-1zM36 6h1v1h-1zM4 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM10 7h1v1h-1zM12 7h1v1h-1zM14 7h1v1h-1zM15 7h1v1h-1zM16 7h1v1h-1zM18 7h1v1h-1zM21 7h1v1h-1zM22 7h1v1h-1zM24 7h1v1h-1zM27 7h1v1h-1zM30 7h1v1h-1zM32 7h1v1h-1zM33 7h1v1h-1zM34 7h1v1h-1zM36 7h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM13 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM17 8h1v1h-1zM18 8h1v1h-1zM21 8h1v1h-1zM22 8h1v1h-1zM23 8h1v1h-1zM24 8h1v1h-1zM26 8h1v1h-1zM27 8h1v1h-1zM30 8h1v1h-1zM32 8h1v1h-1zM33 8h1v1h-1zM34 8h1v1h-1zM36 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM12 9h1v1h-1zM14 9h1v1h-1zM18 9h1v1h-1zM20 9h1v1h-1zM22 9h1v1h-1zM23 9h1v1h-1zM26 9h1v1h-1zM30 9h1v1h-1zM36 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM28 10h1v1h-1zM30 10h1v1h-1zM31 10h1v1h-1zM32 10h1v1h-1zM33 10h1v1h-1zM34 10h1v1h-1zM35 10h1v1h-1zM36 10h1v1h-1zM12 11h1v1h-1zM14 11h1v1h-1zM18 11h1v1h-1zM19 11h1v1h-1zM20 11h1v1h-1zM21 11h1v1h-1zM22 11h1v1h-1zM25 11h1v1h-1zM27 11h1v1h-1zM28 11h1v1h-1zM4 12h1v1h-1zM8 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM21 12h1v1h-1zM23 12h1v1h-1zM25 12h1v1h-1zM26 12h1v1h-1zM28 12h1v1h-1zM29 12h1v1h-1zM30 12h1v1h-1zM31 12h1v1h-1zM32 12h1v1h-1zM33 12h1v1h-1zM36 12h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM11 13h1v1h-1zM13 13h1v1h-1zM14 13h1v1h-1zM15 13h1v1h-1zM16 13h1v1h-1zM17 13h1v1h-1zM18 13h1v1h-1zM19 13h1v1h-1zM22 13h1v1h-1zM27 13h1v1h-1zM29 13h1v1h-1zM33 13h1v1h-1zM34 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1zM12 14h1v1h-1zM14 14h1v1h-1zM15 14h1v1h-1zM16 14h1v1h-1zM19 14h1v1h-1zM21 14h1v1h-1zM24 14h1v1h-1zM25 14h1v1h-1zM27 14h1v1h-1zM29 14h1v1h-1zM30 14h1v1h-1zM33 14h1v1h-1zM35 14h1v1h-1zM4 15h1v1h-1zM5 15h1v1h-1zM8 15h1v1h-1zM12 15h1v1h-1zM18 15h1v1h-1zM19 15h1v1h-1zM21 15h1v1h-1zM22 15h1v1h-1zM25 15h1v1h-1zM26 15h1v1h-1zM27 15h1v1h-1zM29 15h1v1h-1zM30 15h1v1h-1zM35 15h1v1h-1zM36 15h1v1h-1zM4 16h1v1h-1zM5 16h1v1h-1zM6 16h1v1h-1zM9 16h1v1h-1zM10 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM16 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM22 16h1v1h-1zM24 16h1v1h-1zM28 16h1v1h-1zM30 16h1v1h-1zM32 16h1v1h-1zM33 16h1v1h-1zM4 17h1v1h-1zM6 17h1v1h-1zM8 17h1v1h-1zM9 17h1v1h-1zM11 17h1v1h-1zM12 17h1v1h-1zM14 17h1v1h-1zM16 17h1v1h-1zM20 17h1v1h-1zM21 17h1v1h-1zM23 17h1v1h-1zM27 17h1v1h-1zM31 17h1v1h-1zM34 17h1v1h-1zM4 18h1v1h-1zM6 18h1v1h-1zM7 18h1v1h-1zM8 18h1v1h-1zM10 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM22 18h1v1h-1zM23 18h1v1h-1zM25 18h1v1h-1zM27 18h1v1h-1zM29 18h1v1h-1zM30 18h1v1h-1zM33 18h1v1h-1zM34 18h1v1h-1zM35 18h1v1h-1zM4 19h1v1h-1zM7 19h1v1h-1zM9 19h1v1h-1zM11 19h1v1h-1zM13 19h1v1h-1zM15 19h1v1h-1zM17 19h1v1h-1zM18 19h1v1h-1zM21 19h1v1h-1zM23 19h1v1h-1zM24 19h1v1h-1zM25 19h1v1h-1zM26 19h1v1h-1zM27 19h1v1h-1zM29 19h1v1h-1zM30 19h1v1h-1zM32 19h1v1h-1zM7 20h1v1h-1zM8 20h1v1h-1zM9 20h1v1h-1zM10 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM19 20h1v1h-1zM21 20h1v1h-1zM24 20h1v1h-1zM25 20h1v1h-1zM26 20h1v1h-1zM27 20h1v1h-1zM30 20h1v1h-1zM32 20h1v1h-1zM35 20h1v1h-1zM5 21h1v1h-1zM7 21h1v1h-1zM9 21h1v1h-1zM12 21h1v1h-1zM13 21h1v1h-1zM14 21h1v1h-1zM17 21h1v1h-1zM18 21h1v1h-1zM19 21h1v1h-1zM20 21h1v1h-1zM21 21h1v1h-1zM22 21h1v1h-1zM25 21h1v1h-1zM27 21h1v1h-1zM33 21h1v1h-1zM34 21h1v1h-1zM5 22h1v1h-1zM7 22h1v1h-1zM9 22h1v1h-1zM10 22h1v1h-1zM11 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM19 22h1v1h-1zM22 22h1v1h-1zM24 22h1v1h-1zM27 22h1v1h-1zM28 22h1v1h-1zM31 22h1v1h-1zM33 22h1v1h-1zM5 23h1v1h-1zM6 23h1v1h-1zM12 23h1v1h-1zM17 23h1v1h-1zM18 23h1v1h-1zM19 23h1v1h-1zM23 23h1v1h-1zM24 23h1v1h-1zM26 23h1v1h-1zM27 23h1v1h-1zM28 23h1v1h-1zM30 23h1v1h-1zM31 23h1v1h-1zM35 23h1v1h-1zM36 23h1v1h-1zM4 24h1v1h-1zM7 24h1v1h-1zM8 24h1v1h-1zM10 24h1v1h-1zM13 24h1v1h-1zM14 24h1v1h-1zM17 24h1v1h-1zM18 24h1v1h-1zM20 24h1v1h-1zM23 24h1v1h-1zM26 24h1v1h-1zM28 24h1v1h-1zM30 24h1v1h-1zM31 24h1v1h-1zM32 24h1v1h-1zM33 24h1v1h-1zM4 25h1v1h-1zM7 25h1v1h-1zM8 25h1v1h-1zM13 25h1v1h-1zM14 25h1v1h-1zM15 25h1v1h-1zM16 25h1v1h-1zM17 25h1v1h-1zM22 25h1v1h-1zM23 25h1v1h-1zM24 25h1v1h-1zM27 25h1v1h-1zM29 25h1v1h-1zM31 25h1v1h-1zM33 25h1v1h-1zM34 25h1v1h-1zM35 25h1v1h-1zM6 26h1v1h-1zM7 26h1v1h-1zM9 26h1v1h-1zM10 26h1v1h-1zM11 26h1v1h-1zM13 26h1v1h-1zM15 26h1v1h-1zM18 26h1v1h-1zM19 26h1v1h-1zM22 26h1v1h-1zM24 26h1v1h-1zM25 26h1v1h-1zM27 26h1v1h-1zM28 26h1v1h-1zM32 26h1v1h-1zM35 26h1v1h-1zM6 27h1v1h-1zM7 27h1v1h-1zM8 27h1v1h-1zM12 27h1v1h-1zM13 27h1v1h-1zM14 27h1v1h-1zM15 27h1v1h-1zM16 27h1v1h-1zM17 27h1v1h-1zM19 27h1v1h-1zM20 27h1v1h-1zM21 27h1v1h-1zM22 27h1v1h-1zM25 27h1v1h-1zM26 27h1v1h-1zM36 27h1v1h-1zM4 28h1v1h-1zM5 28h1v1h-1zM7 28h1v1h-1zM10 28h1v1h-1zM11 28h1v1h-1zM13 28h1v1h-1zM16 28h1v1h-1zM17 28h1v1h-1zM18 28h1v1h-1zM21 28h1v1h-1zM23 28h1v1h-1zM24 28h1v1h-1zM25 28h1v1h-1zM26 28h1v1h-1zM28 28h1v1h-1zM29 28h1v1h-1zM30 28h1v1h-1zM31 28h1v1h-1zM32 28h1v1h-1zM12 29h1v1h-1zM17 29h1v1h-1zM18 29h1v1h-1zM19 29h1v1h-1zM20 29h1v1h-1zM26 29h1v1h-1zM28 29h1v1h-1zM32 29h1v1h-1zM34 29h1v1h-1zM35 29h1v1h-1zM4 30h1v1h-1zM5 30h1v1h-1zM6 30h1v1h-1zM7 30h1v1h-1zM8 30h1v1h-1zM9 30h1v1h-1zM10 30h1v1h-1zM12 30h1v1h-1zM13 30h1v1h-1zM14 30h1v1h-1zM19 30h1v1h-1zM20 30h1v1h-1zM21 30h1v1h-1zM25 30h1v1h-1zM26 30h1v1h-1zM28 30h1v1h-1zM30 30h1v1h-1zM32 30h1v1h-1zM33 30h1v1h-1zM4 31h1v1h-1zM10 31h1v1h-1zM14 31h1v1h-1zM20 31h1v1h-1zM21 31h1v1h-1zM22 31h1v1h-1zM23 31h1v1h-1zM24 31h1v1h-1zM25 31h1v1h-1zM28 31h1v1h-1zM32 31h1v1h-1zM35 31h1v1h-1zM36 31h1v1h-1zM4 32h1v1h-1zM6 32h1v1h-1zM7 32h1v1h-1zM8 32h1v1h-1zM10 32h1v1h-1zM12 32h1v1h-1zM13 32h1v1h-1zM14 32h1v1h-1zM15 32h1v1h-1zM22 32h1v1h-1zM24 32h1v1h-1zM28 32h1v1h-1zM29 32h1v1h-1zM30 32h1v1h-1zM31 32h1v1h-1zM32 32h1v1h-1zM33 32h1v1h-1zM36 32h1v1h-1zM4 33h1v1h-1zM6 33h1v1h-1zM7 33h1v1h-1zM8 33h1v1h-1zM10 33h1v1h-1zM18 33h1v1h-1zM20 33h1v1h-1zM23 33h1v1h-1zM25 33h1v1h-1zM26 33h1v1h-1zM30 33h1v1h-1zM31 33h1v1h-1zM32 33h1v1h-1zM33 33h1v1h-1zM34 33h1v1h-1zM35 33h1v1h-1zM4 34h1v1h-1zM6 34h1v1h-1zM7 34h1v1h-1zM8 34h1v1h-1zM10 34h1v1h-1zM14 34h1v1h-1zM16 34h1v1h-1zM20 34h1v1h-1zM21 34h1v1h-1zM22 34h1v1h-1zM23 34h1v1h-1zM25 34h1v1h-1zM26 34h1v1h-1zM27 34h1v1h-1zM29 34h1v1h-1zM30 34h1v1h-1zM31 34h1v1h-1zM32 34h1v1h-1zM33 34h1v1h-1zM34 34h1v1h-1zM4 35h1v1h-1zM10 35h1v1h-1zM14 35h1v1h-1zM15 35h1v1h-1zM16 35h1v1h-1zM17 35h1v1h-1zM18 35h1v1h-1zM21 35h1v1h-1zM23 35h1v1h-1zM24 35h1v1h-1zM25 35h1v1h-1zM28 35h1v1h-1zM30 35h1v1h-1zM33 35h1v1h-1zM4 36h1v1h-1zM5 36h1v1h-1zM6 36h1v1h-1zM7 36h1v1h-1zM8 36h1v1h-1zM9 36h1v1h-1zM10 36h1v1h-1zM12 36h1v1h-1zM13 36h1v1h-1zM16 36h1v1h-1zM18 36h1v1h-1zM19 36h1v1h-1zM20 36h1v1h-1zM21 36h1v1h-1zM24 36h1v1h-1zM25 36h1v1h-1zM27 36h1v1h-1zM28 36h1v1h-1zM33 36h1v1h-1zM36 36h1v1h-1z"/></svg>';
const wsCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; return 'PB-' + c; };
async function saveWorksheetScore(code, score) {
  const ws = await store.get('ws:' + code, null); if (!ws) return;
  ws.score = score; ws.markedAt = Date.now(); await store.set('ws:' + code, ws);
}

async function renderPrint(book, units, paper, mins, existing) {
  const qs = [...paper.A, ...paper.B];
  let ws = existing;
  if (!ws) {
    local.printed = [...new Set([...(local.printed || []), ...qs.map((q) => q.id)])].slice(-3000);
    ws = { code: wsCode(), bookId: book.id, at: Date.now(), mins, chapters: units.length === book.units.length ? 'All chapters' : units.map((u) => u.title).join(' · '), A: paper.A, B: paper.B, score: null };
    await store.set('ws:' + ws.code, ws);
    local.worksheets = [ws.code, ...(local.worksheets || [])].slice(0, 30); saveLocal();
  }
  const total = qs.reduce((s, q) => s + marksOf(q), 0);
  const lines = (n) => `<div class="lines">${'<div></div>'.repeat(n)}</div>`;
  const mcq = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">1 mark</span></div>${figHTML(q, 'pfig')}${q.type === 'graph' ? graphStem(q) : renderStem(q.stem, 'pstem')}
    ${q.type === 'graph' ? graphOptions(q, true) : `<ol type="A" class="popts">${(q.options || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`}</div>`;
  const written = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">${marksOf(q)} marks</span></div>${figHTML(q, 'pfig')}${q.stem ? renderStem(q.stem, 'pstem') : ''}
    ${q.parts.map((p) => `<div class="ppart"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="pm">(${p.marks})</span></div>${lines(Math.max(2, p.marks + 1))}`).join('')}</div>`;
  const draw = () => {
    const who = (local.name || '').trim();
    $app.innerHTML = `
  <div class="noprint topbar"><button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button><span style="font-weight:600;font-size:15px">Worksheet ${ws.code}</span></div>
  <div class="noprint stack g10" style="padding:0 20px 16px">
    <label for="wsname" style="font-size:13px;font-weight:600;color:var(--muted)">Name on every page</label>
    <input id="wsname" class="input" autocomplete="given-name" placeholder="e.g. Ka Yan" value="${esc(who)}">
    <button class="btn" id="doprint" ${who ? '' : 'disabled'}>Print or save as PDF</button>
    <span class="hint">${who ? 'There is no answer key on the paper. When you finish, open PrepBuddy, tap <b>Mark a printed worksheet</b> and enter your answers to get them marked.' : 'Add your name first. It is printed on every page.'}</span>
  </div>
  <article class="paper">
    <table class="ptable"><tbody><tr><td>
    <h1 data-raw>${esc(book.title)}</h1>
    <p class="pmeta"><span data-raw>${esc(ws.chapters)}</span><br>${paper.A.length ? `Section A: ${paper.A.length} multiple choice · ` : ''}${paper.B.length ? `Section B: ${paper.B.length} written · ` : ''}Time: ${mins} min · Total: ${total} marks</p>
    <div class="pfields"><span>Name: <b data-raw>${esc(who)}</b></span><span>Worksheet: <b>${ws.code}</b></span></div>
    ${paper.A.length ? `<h2>Section A · Multiple choice</h2><p class="pnote">Choose the best answer for each question.</p>${paper.A.map((q, i) => mcq(q, i + 1)).join('')}` : ''}
    ${paper.B.length ? `<h2>Section B · Written</h2><p class="pnote">Answer all questions in the spaces provided.</p>${paper.B.map((q, i) => written(q, paper.A.length + i + 1)).join('')}` : ''}
    <p class="pfoot">Made with PrepBuddy from <span data-raw>${esc(book.title)}</span>.${book.credit ? ' <span data-raw>' + esc(book.credit) + '</span>' : ''} Questions are written and checked by AI.</p>
    </td></tr></tbody>
    <tfoot><tr><td><div class="pbrand">${QR_SVG}<div data-raw>${LANG === 'zh'
      ? `<b>${esc(who || '________')} 專用 · ${ws.code}</b><span>批改：打開 PrepBuddy › 批改已列印的工作紙 › ${ws.code}</span><span>用你自己的課本練習：prepbuddy.givingtree.sg</span>`
      : `<b>Made for ${esc(who || '________')} · ${ws.code}</b><span>Get marked: open PrepBuddy › Mark a printed worksheet › ${ws.code}</span><span>Practise from your own textbook: prepbuddy.givingtree.sg</span>`}</div></div></td></tr></tfoot>
    </table>
  </article>`;
    document.getElementById('back').onclick = () => (existing ? go({ name: 'worksheets' }) : go({ name: 'book', bookId: book.id }));
    const nm = document.getElementById('wsname');
    nm.onchange = () => { local.name = nm.value.trim().slice(0, 30); saveLocal(); draw(); };
    nm.oninput = () => { document.getElementById('doprint').disabled = !nm.value.trim(); };
    document.getElementById('doprint').onclick = () => { if (nm.value.trim() !== (local.name || '')) { local.name = nm.value.trim().slice(0, 30); saveLocal(); draw(); } window.print(); };
  };
  draw();
  window.scrollTo(0, 0);
}

async function renderWorksheets() {
  const books = await getBooks();
  const list = [];
  for (const c of local.worksheets || []) { const ws = await store.get('ws:' + c, null); if (ws && books.some((b) => b.id === ws.bookId)) list.push(ws); }
  const when = (t) => new Date(t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' });
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">Printed worksheets</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Pick the worksheet you did. Check the code at the bottom of the page. Enter what you wrote on paper, and PrepBuddy marks it.</p>
    ${list.length ? `<div class="card stack">${list.map((ws) => { const b = books.find((x) => x.id === ws.bookId); return `<div class="row wsrow"><div class="top"><span><b style="font-weight:600">${ws.code}</b> <span class="muted" style="font-size:13px">· ${when(ws.at)}</span><br><span class="muted" style="font-size:13px"><span data-raw>${esc(b.subject || b.title)}</span> · ${ws.A.length + ws.B.length} questions${ws.score ? ` · Marked: ${ws.score}` : ''}</span></span></div>
      <div style="display:flex;gap:14px;margin-top:8px"><button class="link" data-ws="${ws.code}">${ws.score ? 'Mark again' : 'Enter answers'}</button><button class="link quiet" data-reprint="${ws.code}">Print again</button></div></div>`; }).join('')}</div>`
      : '<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:var(--text-2)">No printed worksheets yet. Open a textbook, choose Mock paper, then Print as a worksheet.</p></div>'}
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  const open = async (code) => { const ws = await store.get('ws:' + code, null); return [ws, ws && books.find((b) => b.id === ws.bookId)]; };
  $app.querySelectorAll('[data-ws]').forEach((el) => (el.onclick = async () => {
    const [ws, book] = await open(el.dataset.ws); if (!ws || !book) return;
    const qs = [...ws.A, ...ws.B];
    S = newSession({ mode: 'dse', ws: ws.code, title: `Worksheet ${ws.code}`, book, qs, target: qs.length, sectionA: ws.A.length });
    renderQuestion();
    toast('Enter the answers you wrote on paper');
  }));
  $app.querySelectorAll('[data-reprint]').forEach((el) => (el.onclick = async () => {
    const [ws, book] = await open(el.dataset.reprint); if (!ws || !book) return;
    renderPrint(book, book.units, { A: ws.A, B: ws.B }, ws.mins, ws);
  }));
}

// Keep making questions for a paper that has already started.
function paperPlace(sess, qs) {
  const have = new Set([...sess.qs, ...sess.bQueue].map((q) => q.id));
  const nA = sess.sectionA;
  for (const q of qs) {
    if (have.has(q.id)) continue; have.add(q.id);
    if (isMcqLike(q)) {
      const aCount = sess.qs.filter((x) => isMcqLike(x)).length;
      if (aCount >= nA) continue;
      const lo = Math.min(sess.i + 1, sess.qs.length);   // join the unanswered part of Section A
      const hi = Math.min(sess.qs.length, nA);
      sess.qs.splice(lo + Math.floor(Math.random() * (Math.max(lo, hi) - lo + 1)), 0, shuffleOptions(q));
    } else if (sess.bQueue.length + sess.qs.filter((x) => !isMcqLike(x)).length < sess.fill.nB) sess.bQueue.push(q);
  }
  if (sess.qs.length >= nA && sess.bQueue.length) { sess.qs.push(...sess.bQueue.splice(0)); }
}
function paperShortfall(sess) {
  const a = sess.qs.filter((x) => isMcqLike(x)).length, b = sess.qs.length - a + sess.bQueue.length;
  return { a: Math.max(0, sess.sectionA - a), b: Math.max(0, sess.fill.nB - b) };
}
async function pumpPaper(sess) {
  if (sess.generating || sess.error || sess.review || sess.pumping) return;
  // first take any new questions already in the bank (e.g. made while the paper was starting)
  sess.pumping = true;
  try { let all = []; for (const u of sess.fill.units) all.push(...await getQs(sess.book.id, u.id)); paperPlace(sess, shuffle(all.filter((q) => !local.stats[q.id]))); }
  finally { sess.pumping = false; }
  if (sess !== S || sess.generating) return;
  sessionGrew(false);
  const { a, b } = paperShortfall(sess);
  if (!a && !b) return;
  const f = sess.fill, js = [];
  if (a) f.units.forEach((u) => js.push(ensureFill(sess.book, u, Math.ceil(a / f.units.length), 'mcq', PAPER_PAR)));
  if (b) f.units.forEach((u) => js.push(ensureFill(sess.book, u, Math.ceil(b / f.units.length), 'written', PAPER_PAR)));
  f.rounds++;
  sess.generating = true; sess.pending = js.length;
  js.forEach((job) => {
    const listener = async (passed, done) => {
      if (sess !== S) { job.listeners.delete(listener); return; }
      paperPlace(sess, passed);
      if (done) {
        sess.pending--;
        if (job.error && (job.error.status === 0 || job.error.status === 401)) sess.error = job.error;
        if (sess.pending <= 0) {
          sess.generating = false;
          const left = paperShortfall(sess);
          if ((left.a || left.b) && !sess.error) {
            if (f.rounds < 4) return pumpPaper(sess), sessionGrew(false);
            // Out of new material: reuse questions done before, then shrink the paper to what exists.
            let all = []; for (const u of f.units) all.push(...await getQs(sess.book.id, u.id));
            paperPlace(sess, shuffle(all));
            const now = paperShortfall(sess);
            if (now.a) { sess.sectionA -= now.a; paperPlace(sess, []); }
            sess.target = sess.qs.length + sess.bQueue.length;
            if (sess.bQueue.length) sess.qs.push(...sess.bQueue.splice(0));
          }
        }
      }
      sessionGrew(done && !sess.generating);
    };
    job.listeners.add(listener);
  });
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
// Fast students get more questions made ahead, and more batches at once, so they don't catch up with the AI.
function paceOf(sess) {
  const t = sess.times || [];
  if (t.length < 3) return { ahead: AHEAD, par: PARALLEL };
  const recent = t.slice(-6), secs = (recent[recent.length - 1] - recent[0]) / 1000 / (recent.length - 1);
  if (secs < 8) return { ahead: 15, par: 5 };
  if (secs < 20) return { ahead: 10, par: 4 };
  return { ahead: AHEAD, par: PARALLEL };
}
async function startUnits(book, units, count = SESSION_SIZE) {
  const k = units.length, quota = Math.ceil(count / k);
  const types = local.types || 'mix';
  const pools = [];
  for (const u of units) {
    const want = 2 + levelShift(book.id, u.id);
    const pool = shuffle((await getQs(book.id, u.id)).filter((q) => !local.stats[q.id] && matchType(q, types)));
    // closest to the student's level first, with some variety
    pools.push(pool.map((q) => [q, Math.abs((q.level || 2) - want) + Math.random() * 1.5]).sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  }
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
  if (sess.fill) return pumpPaper(sess);
  if (!sess.units || sess.generating || sess.error) return;
  const ahead = sess.qs.length - (sess.i + 1);
  const pace = paceOf(sess);
  const need = Math.min(sess.target - sess.qs.length, pace.ahead - ahead);
  if (need <= 0) return;
  // spread across the chosen chapters, starting with the ones that have given fewest questions so far
  const used = (u) => sess.qs.filter((q) => q.id.startsWith(`${sess.book.id}:${u.id}:`)).length;
  const order = [...sess.units].sort((a, b) => used(a) - used(b));
  const per = Math.ceil(need / order.length);
  let left = need;
  for (const u of order) {
    if (left <= 0) break;
    const want = Math.min(per, left); left -= want;
    followFill(sess, ensureFill(sess.book, u, want, sess.types, pace.par, true));
  }
}

/* ---------- mistake book (錯題簿) ---------- */
// Mistakes from textbooks that were removed are dropped (older versions kept them, so the count stayed).
function pruneMistakes(books) {
  const ids = new Set(books.map((b) => b.id)); let n = 0;
  for (const k of Object.keys(local.mistakes || {})) if (!ids.has(k.split(':')[0])) { delete local.mistakes[k]; n++; }
  if (n) saveLocal();
}
const mistakeCount = () => Object.values(local.mistakes || {}).filter((m) => !m.done).length;
async function mistakeItems(done) {
  const books = await getBooks();
  const byUnit = new Map();
  for (const [id, m] of Object.entries(local.mistakes || {})) {
    if (!!m.done !== done) continue;
    const [b, u] = qUnit(id); const k = `${b}:${u}`;
    if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k).push([id, m]);
  }
  const groups = [];
  for (const [k, list] of byUnit) {
    const [b, u] = k.split(':');
    const book = books.find((x) => x.id === b); if (!book) continue;
    const unit = book.units.find((x) => x.id === u);
    const qs = await getQs(b, u);
    const items = list.map(([id, m]) => ({ q: qs.find((x) => x.id === id), m })).filter((x) => x.q).sort((x, y) => y.m.t - x.m.t);
    if (items.length) groups.push({ book, unit, items });
  }
  return groups.sort((a, b) => Math.max(...b.items.map((x) => x.m.t)) - Math.max(...a.items.map((x) => x.m.t)));
}
function mistakeCard(q, m) {
  const yours = choiceType(q) ? (m.ansText || (LANG === 'zh' ? '未有作答' : 'No answer'))
    : (Array.isArray(m.ans) ? m.ans.filter((a) => a && a.trim()).join('\n') : '') || 'No answer written';
  const right = choiceType(q) ? `${(q.options || [])['ABCD'.indexOf(q.correct_option)] || ''}`
    : q.type === 'essay' ? '' : q.parts.map((p) => `${p.label ? p.label + ' ' : ''}${p.mark_scheme.map((x) => '• ' + x).join('\n')}`).join('\n');
  return `<div class="mcard" data-raw>
    ${figHTML(q)}${renderStem(q.type === 'graph' || choiceType(q) ? q.stem : (q.stem || ''), 'stem')}
    ${!choiceType(q) ? q.parts.map((p) => `<p class="mprompt">${esc(p.label)} ${esc(p.prompt)}</p>`).join('') : ''}
    <div class="mrow bad"><span>${LANG === 'zh' ? '你的答案' : 'Your answer'}</span><p class="nomath">${esc(yours)}</p></div>
    ${right ? `<div class="mrow good"><span>${LANG === 'zh' ? '答案' : 'Answer'}</span><p>${esc(right)}</p></div>` : ''}
    <p class="expl">${esc(q.explanation || '')}</p>
    ${m.chat && m.chat.length ? `<details class="mchat"><summary>${LANG === 'zh' ? '你和 AI 導師的對話' : 'Your chat with the tutor'} (${m.chat.length})</summary>${m.chat.map((x) => x.role === 'user' ? `<div class="tmsg me nomath">${esc(x.text)}</div>` : `<div class="tmsg ai">${tutorMd(x.text)}</div>`).join('')}</details>` : ''}
    <div class="mfoot"><span class="hint">${m.n > 1 ? `${LANG === 'zh' ? `錯了 ${m.n} 次` : `Missed ${m.n} times`}` : ''}</span>${m.done ? '' : `<button class="link quiet" data-dismiss="${esc(q.id)}" style="padding:0;font-size:13px">${LANG === 'zh' ? '我已明白，移除' : 'I understand it now'}</button>`}</div>
  </div>`;
}
async function renderMistakes(tab) {
  // Filter by textbook (remembered). Only shown when mistakes come from more than one book.
  const books = await getBooks();
  pruneMistakes(books);
  const entries = Object.entries(local.mistakes || {});
  const bookIds = [...new Set(entries.map(([id]) => id.split(':')[0]))].filter((id) => books.some((b) => b.id === id));
  let only = local.mkBook && bookIds.includes(local.mkBook) ? local.mkBook : 'all';
  if (bookIds.length < 2) only = 'all';
  const inBook = ([id]) => only === 'all' || id.startsWith(only + ':');
  const groups = (await mistakeItems(tab === 'done')).filter((g) => only === 'all' || g.book.id === only);
  const todo = entries.filter((e) => inBook(e) && !e[1].done).length, done = entries.filter((e) => inBook(e) && e[1].done).length;
  const chips = bookIds.length >= 2 ? `<div class="bookchips" role="tablist" aria-label="Textbook">${[['all', LANG === 'zh' ? '全部' : 'All'], ...bookIds.map((id) => { const b = books.find((x) => x.id === id); return [id, b.subject || b.title]; })]
    .map(([id, name]) => { const n = entries.filter(([q, m]) => !m.done && (id === 'all' || q.startsWith(id + ':'))).length; return `<button role="tab" class="${only === id ? 'on' : ''}" data-mkbook="${esc(id)}"><span ${id === 'all' ? '' : 'data-raw'}>${esc(name)}</span>${n ? ` <b>${n}</b>` : ''}</button>`; }).join('')}</div>` : '';
  const all = groups.flatMap((g) => g.items.map((x) => x.q));
  $app.innerHTML = `
  <main class="pad stack g14" data-view="mistakes" style="flex:1">
    <h1 class="pagetitle">Mistake book</h1>
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Every question you didn’t get fully right is kept here. Get it right again and it moves to Mastered.</p>
    ${chips}
    <div class="seg" style="grid-template-columns:1fr 1fr" role="tablist"><button role="tab" class="${tab === 'todo' ? 'on' : ''}" data-tab="todo">To get right (${todo})</button><button role="tab" class="${tab === 'done' ? 'on' : ''}" data-tab="done">Mastered (${done})</button></div>
    ${groups.length ? groups.map((g, gi) => `<section class="stack g10"><div class="mhead"><span><b data-raw>${esc(g.unit ? g.unit.title : '')}</b><br><span class="muted" style="font-size:12.5px" data-raw>${esc(g.book.subject || g.book.title)}</span></span>${tab === 'todo' ? `<button class="link" data-redo="${gi}" style="padding:0;white-space:nowrap">Redo these ${g.items.length}</button>` : ''}</div>
      ${g.items.map((x) => mistakeCard(x.q, x.m)).join('')}</section>`).join('')
      : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:var(--text-2)">${tab === 'todo' ? 'Nothing here. Questions you get wrong will appear here automatically.' : 'Questions you get right after missing them will appear here.'}</p></div>`}
  </main>
  ${tab === 'todo' && all.length ? `<div class="sheet sticky"><button class="btn" id="redoall">Redo all ${all.length}</button><span class="hint" style="text-align:center">The answer options are shuffled, so you can’t just remember the letter.</span></div>` : ''}`;
  
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go({ name: 'mistakes', tab: b.dataset.tab })));
  $app.querySelectorAll('[data-mkbook]').forEach((b) => (b.onclick = () => { local.mkBook = b.dataset.mkbook; saveLocal(); renderMistakes(tab); }));
  const start = (qs, title) => { S = newSession({ mode: 'mistakes', title, qs: shuffle(qs).slice(0, 30).map(shuffleOptions), target: Math.min(qs.length, 30) }); renderQuestion(); };
  const bookName = only === 'all' ? '' : ` · ${(books.find((b) => b.id === only) || {}).subject || ''}`;
  const ra = document.getElementById('redoall'); if (ra) ra.onclick = () => start(all, (LANG === 'zh' ? '錯題簿' : 'Mistake book') + bookName);
  $app.querySelectorAll('[data-redo]').forEach((b) => (b.onclick = () => { const g = groups[+b.dataset.redo]; start(g.items.map((x) => x.q), g.unit ? g.unit.title : 'Mistake book'); }));
  $app.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => { const m = local.mistakes[b.dataset.dismiss]; if (m) { m.done = true; m.doneAt = Date.now(); m.manual = true; saveLocal(); } const y = window.scrollY; renderMistakes(tab).then(() => window.scrollTo(0, y)); }));
}

/* ---------- choose a textbook for weak topics / mock paper ---------- */
const isWeak = (q) => { const st = local.stats[q.id]; return !!st && st.last < 1; };
async function renderPick(mode) {
  const books = await getBooks();
  if (!books.length) return go({ name: 'home' });
  const items = await allQuestions();
  const weakIn = (id) => items.filter((x) => (!id || x.book.id === id) && isWeak(x.q)).length;
  if (books.length === 1) {   // only one textbook: nothing to choose
    if (mode === 'mock') return go({ name: 'paper', bookId: books[0].id, from: 'home' });
    return startReview('weak', books[0].id);
  }
  const row = (id, title, sub) => `<button class="row" data-pick="${esc(id)}"><div class="top"><span><b style="font-weight:600" ${id ? 'data-raw' : ''}>${esc(title)}</b><br><span class="muted" style="font-size:13px">${sub}</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></div></button>`;
  const rows = books.map((b) => row(b.id, b.title, mode === 'weak'
    ? (weakIn(b.id) ? `${weakIn(b.id)} questions to work on` : 'No weak spots yet')
    : `${b.units.length} chapters`));
  if (mode === 'weak') rows.unshift(row('', 'All my textbooks', `${weakIn('')} questions to work on`));
  $app.innerHTML = `
  <div class="topbar"><button class="icon-btn" id="back" aria-label="Back to home">${ICON.back}</button><span style="font-weight:600;font-size:15px">${mode === 'weak' ? 'Weak topics' : 'Mock paper'}</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <h2 style="margin:0;font-size:17px">Which textbook?</h2>
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">${mode === 'weak' ? 'Practise the questions you found hard.' : 'You choose the chapters and length next.'}</p>
    <div class="card stack">${rows.join('')}</div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'home' });
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => (mode === 'mock'
    ? go({ name: 'paper', bookId: b.dataset.pick, from: 'pick' })
    : startReview('weak', b.dataset.pick || null))));
}

async function startReview(mode, bookId = null) {
  const items = (await allQuestions()).filter((x) => !bookId || x.book.id === bookId);
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
    pick = shuffle(tried).sort((a, b) => local.stats[a.q.id].last - local.stats[b.q.id].last).slice(0, SESSION_SIZE).map((x) => shuffleOptions(x.q));
    const book = bookId && items[0] && items[0].book;
    S = newSession({ mode: 'weak', title: book ? `Weak topics · ${book.subject || book.title}` : 'Weak topics', qs: pick, target: pick.length });
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

function ensureFill(book, unit, want, types = 'mix', par = PARALLEL, adapt = false) {
  const key = `${book.id}:${unit.id}:${types}`;
  if (jobs.has(key)) { const j = jobs.get(key); j.want = Math.max(j.want, j.made + want); j.par = Math.max(j.par, par); if (j.spawn) j.spawn(); return j; }
  const kp = KIND_PLANS[kindOfBook(book)];
  const job = { want, made: 0, error: null, done: false, listeners: new Set(), plan: (kp && kp[types]) || PLANS[types] || PLAN, par, adapt };
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
      const d = job.adapt ? levelShift(book.id, unit.id) : 0;
      const items = Array.from({ length: BATCH }, (_, k) => job.plan[(slot + k) % job.plan.length]).map(([level, type]) => ({ level: type === 'essay' ? level : shiftLevel(level, d), type }));
      const avoid = existing.map((q) => (q.stem + ' ' + (q.parts || []).map((p) => p.prompt).join(' ')).slice(0, 200));
      const batchNo = Math.floor(slot / BATCH);
      const focus = { part: (batchNo % job.par) + 1, of: job.par };
      // Every other batch includes one question about a diagram from the chapter's pages, if it has any.
      const figs = job.figs || (job.figs = await figsFor(book, unit));
      let pages = null;
      if (figs.length && batchNo % 2 === 0) {
        const k = items.findIndex((it) => it.type !== 'graph');
        if (k >= 0) { items[k] = { ...items[k], figure: true }; pages = shuffle([...figs]).slice(0, 2); }
      }
      let gen;
      try { gen = await api('generate', { title, text, items, avoid, focus, kind: kindOfBook(book), lang: langOf(text), figures: pages ? pages.map((f) => f.img.split(',')[1]) : undefined, figureRegions: pages ? pages.map((f) => f.rects || []) : undefined }); }
      catch (e) { if (e.status === 401 || e.status === 0) { stop = true; throw e; } if (!job.error) job.error = e; continue; }
      if (!gen.questions || !gen.questions.length) { if (++empty >= 2) stop = true; continue; }
      for (const q of gen.questions) {
        if (!q.figure) continue;
        const src = pages && pages[q.figure.image - 1];
        const img = src ? await cropFigure(src.img, figureBox(q.figure, src.rects)).catch(() => null) : null;
        q.figure = img ? { page: src.page, box: q.figure.box, img } : null;
        if (!img) q.drop = true;
      }
      gen.questions = gen.questions.filter((q) => !q.drop).map((q) => (q.figure ? q : (delete q.figure, q)));
      const checked = await Promise.all(gen.questions.map((q) =>
        api('verify', { title, text, question: qForServer(q), figure: figB64(q) }).then((v) => ({ q, v })).catch((e) => { if (e.status === 401) { stop = true; throw e; } return { q, v: { passed: false } }; })));
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
  // Workers run side by side; more join if the student needs questions faster (job.spawn).
  let running = 0, failed = null, finish;
  const allDone = new Promise((r) => { finish = r; });
  job.spawn = () => {
    while (!stop && !failed && running < Math.min(job.par, Math.ceil((job.want - job.made) / BATCH))) {
      running++;
      worker(running).catch((e) => { failed = failed || e; }).finally(() => { running--; if (!running) finish(); });
    }
  };
  job.spawn();
  if (running) await allDone;
  job.spawn = null;
  if (failed) throw failed;
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
    if (S.fill) { S.error = null; S.fill.rounds = 0; pumpPaper(S); return renderWaiting(); }
    S.target = Math.max(S.target, SESSION_SIZE); refill(S); renderWaiting(); };
  const f = document.getElementById('finish'); if (f) f.onclick = () => { S.qs = S.qs.slice(0, S.i); renderSummary(); };
  const h = document.getElementById('home'); if (h) h.onclick = () => go({ name: 'book', bookId: S.book.id });
}

function renderAccess(onOk, msg) {
  $app.innerHTML = `<div class="topbar"><button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button></div>
  <main class="pad stack g14" style="flex:1">
    <h1 class="display" style="margin:0;font-size:24px">Enter your access code</h1>
    <p style="margin:0;line-height:1.5;color:var(--text-2)">PrepBuddy is in testing. You need a code to make new questions. Ask the person who invited you.</p>
    ${msg ? `<p style="margin:0;color:var(--miss-dark);font-weight:600">${esc(msg)}</p>` : ''}
    <label for="code" style="font-size:13px;font-weight:600;color:var(--muted)">Access code</label>
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

function canDrill(q) { return !!(q.id && q.id.split(':').length >= 3) && q.type !== 'essay'; }

// Make `n` checked questions on one missed idea. Saved to the chapter's bank.
async function makeDrill(q, idea, types, n = 2) {
  const [bookId, unitId] = qUnit(q.id);
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
  const gen = await api('generate', { title, text, items, avoid, target: idea, kind: await kindOfId(q.id), lang: langOf(text) });
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
    <path d="${line}" fill="none" stroke="${print ? '#111' : 'var(--good)'}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
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

// Laptops: the right-hand panel where marks and feedback appear, before there are any.
function qSide(q) {
  const mcq = choiceType(q);
  const [t, d] = isExam() ? ['Exam conditions', 'Answers and marks come at the end, like the real paper.']
    : mcq ? ['Pick an answer', 'You’ll see straight away if it’s right, with the explanation here.']
    : ['Write your answer', 'When you press Mark my answer, your marks and feedback show here.'];
  return `<aside class="qside" aria-hidden="true"><b>${t}</b><span>${d}</span>${mcq ? '<span class="qkeys"><kbd>A</kbd><kbd>B</kbd><kbd>C</kbd><kbd>D</kbd> to choose · <kbd>Enter</kbd> for next</span>' : ''}</aside>`;
}

function renderQuestion() {
  S.waiting = false;
  const q = S.qs[S.i];
  const body = choiceType(q) ? mcqBody(q, S.phase === 'revealed') : writtenBody(q, S.phase === 'revealed');
  $app.innerHTML = header() + `
  <main class="stack g18 qpaper" style="flex:1;padding:14px 20px 20px">
    <div class="chips">${S.mode === 'dse' ? `<span class="chip sec">${S.i < S.sectionA ? 'Section A' : 'Section B'}</span>` : ''}<span class="chip">Level ${q.level} · ${LEVEL[q.level]}</span><span class="chip grey">${TYPE[q.type]} · ${marksOf(q)} mark${marksOf(q) > 1 ? 's' : ''}</span>${S.review ? '<span class="chip grey">Review</span>' : ''}</div>
    ${body.main}
  </main>
  ${body.footer}${/class="sheet/.test(body.footer) ? '' : qSide(q)}`;
  bindCommon(q);
  body.bind && body.bind();
  startTimer();
  window.scrollTo(0, 0);
}

// Pictures of the chapter's diagram pages. Library books added before diagrams existed fetch them now.
async function figsFor(book, unit) {
  const key = `figs:${book.id}:${unit.id}`;
  const have = await store.get(key, null);
  if (have && !(book.library && have.length && !have.some((f) => f.rects))) return have;
  let figs = [];
  if (book.library) { try { const r = await fetch(`library/${book.library}/figs/${unit.id}.json`); if (r.ok) figs = await r.json(); } catch (e) { return []; } }
  await store.set(key, figs);
  return figs;
}

// The crop: the AI's box, grown to include the whole of any picture it overlaps (picture positions come from
// the PDF itself, so they are exact), or the picture region the AI named.
function figureBox(fig, rects) {
  let b = Array.isArray(fig.box) && fig.box.length === 4 ? fig.box.slice() : null;
  const rs = Array.isArray(rects) ? rects : [];
  const named = rs[(Number(fig.region) || 0) - 1];
  let snapped = false;
  if (named) { snapped = true; b = b ? [Math.min(b[0], named[0]), Math.min(b[1], named[1]), Math.max(b[2], named[2]), Math.max(b[3], named[3])] : named.slice(); }
  if (!b) return null;
  for (const r of rs) {
    const ix = Math.max(0, Math.min(b[2], r[2]) - Math.max(b[0], r[0])), iy = Math.max(0, Math.min(b[3], r[3]) - Math.max(b[1], r[1]));
    const area = (r[2] - r[0]) * (r[3] - r[1]);
    const cx = (fig.box ? (fig.box[0] + fig.box[2]) / 2 : -1), cy = (fig.box ? (fig.box[1] + fig.box[3]) / 2 : -1);
    const centred = cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3];
    if (area > 0 && (centred || (ix * iy) / area > 0.1)) snapped = true, b = [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])];
  }
  b.pad = snapped ? 0.012 : 0.035; // exact picture: small margin, so the caption and nearby text stay out
  return b;
}

// Cut the diagram out of the page picture (with a little margin) for the student and the checker.
function cropFigure(pageUrl, box) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (!box) return reject(new Error('no box'));
    im.onload = () => {
      const pad = box.pad ?? 0.035;
      const x0 = Math.max(0, box[0] - pad), y0 = Math.max(0, box[1] - pad), x1 = Math.min(1, box[2] + pad), y1 = Math.min(1, box[3] + (box.pad ? Math.min(pad, 0.004) : pad)); // captions sit just below figures
      const sw = (x1 - x0) * im.width, sh = (y1 - y0) * im.height;
      if (sw < 40 || sh < 30) return reject(new Error('figure too small'));
      const k = Math.min(1, 900 / sw);
      const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, x0 * im.width, y0 * im.height, sw, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => reject(new Error('bad image'));
    im.src = pageUrl;
  });
}
const figHTML = (q, cls = 'qfig') => (q.figure && q.figure.img ? `<figure class="${cls}"><img src="${q.figure.img}" alt="Diagram for this question"></figure>` : '');

function feedbackBits(q) {
  return `<p class="expl">${esc(q.explanation)}</p>
    ${q.source_quote ? `<p class="src">${esc(q.section || 'Textbook')}${q.pages ? `, pp. ${esc(q.pages)}` : ''}: “${esc(q.source_quote)}”</p>` : ''}
    <div class="tutor" id="tutor">${tutorHTML(q)}</div>
    <div style="display:flex;justify-content:flex-end"><button class="link quiet" id="report">Report a problem</button></div>`;
}

/* ---------- "I don't get it": ask the AI tutor about this question ---------- */
const qForServer = (q) => (q.figure ? { ...q, figure: { image: q.figure.image, box: q.figure.box } } : q);
const figB64 = (q) => (q.figure && q.figure.img ? q.figure.img.split(',')[1] : undefined);
function chatOf() { S.chat = S.chat || {}; return S.chat[S.i] || (S.chat[S.i] = { open: false, msgs: [], busy: false }); }
// Tutor replies: **bold**, "- " bullets and line breaks; formulas are drawn by KaTeX afterwards.
function tutorMd(t) {
  const lines = esc(t).split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const li = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${li[1]}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
function wrongAnswer(q) {
  const k = S.i;
  if (choiceType(q)) return S.answers[k] && S.answers[k] !== q.correct_option;
  return S.got[k] !== undefined && S.got[k] !== null ? S.got[k] < marksOf(q) : true;
}
function tutorHTML(q) {
  const c = chatOf();
  if (!c.open) return `<button class="btn ghost tutor-open" id="tutorOpen">${ICON.chat} I don’t get it</button>`;
  const chips = [
    ...(wrongAnswer(q) ? [['why', 'Why is my answer wrong?']] : []),
    ['simple', 'Explain it more simply'],
    ['steps', 'Go through it step by step'],
    ['example', 'Give me another example'],
  ];
  return `<div class="tchat">
    <div class="thead"><b>${ICON.chat} Ask about this question</b><button class="link quiet" id="tutorClose" style="padding:0">Close</button></div>
    ${c.msgs.map((m) => m.role === 'user' ? `<div class="tmsg me nomath" data-raw>${esc(m.text)}</div>` : `<div class="tmsg ai" data-raw>${tutorMd(m.text)}</div>`).join('')}
    ${c.busy ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}
    ${c.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(c.error)}</p>` : ''}
    ${c.busy ? '' : `<div class="tchips">${chips.filter(([k]) => !c.msgs.some((m) => m.chip === k)).map(([k, l]) => `<button class="tchip" data-chip="${k}">${l}</button>`).join('')}</div>`}
    <form class="tform" id="tform"><input id="tq" class="tinput" placeholder="Type your question…" autocomplete="off" ${c.busy ? 'disabled' : ''}><button class="tsend" aria-label="Send" ${c.busy ? 'disabled' : ''}>${ICON.send}</button></form>
  </div>`;
}
function studentAnswerText(q) {
  const a = S.answers[S.i];
  if (choiceType(q)) return a ? `Chose ${a}: ${(q.options || [])['ABCD'.indexOf(a)] || ''}` : '(did not answer)';
  return (q.parts || []).map((p, k) => `${p.label || 'Answer'} ${(a && a[k]) || '(blank)'}`).join('\n');
}
function bindTutor(q) {
  const box = document.getElementById('tutor'); if (!box) return;
  const c = chatOf(), idx = S.i, sess = S;
  const redraw = () => { if (S !== sess || S.i !== idx) return; const b = document.getElementById('tutor'); if (!b) return; b.innerHTML = tutorHTML(q); bindTutor(q); };
  const ask = async (text, chip) => {
    text = String(text || '').trim(); if (!text || c.busy) return;
    const history = c.msgs.map((m) => ({ role: m.role, text: m.text }));
    c.msgs.push({ role: 'user', text, chip }); c.busy = true; c.error = null; redraw();
    document.getElementById('tutor').scrollIntoView({ block: 'end', behavior: 'smooth' });
    try {
      const [bookId, unitId] = qUnit(q.id);
      const chapter = await store.get(`text:${bookId}:${unitId}`, '');
      if (!chapter) throw new Error('This chapter’s text is missing on this device.');
      const r = await api('explain', { title: q.section, text: chapter, question: qForServer(q), figure: figB64(q), answer: studentAnswerText(q), ask: text, history, lang: langOf(chapter) });
      c.msgs.push({ role: 'assistant', text: r.reply });
      const mk = local.mistakes[q.id];
      if (mk) { mk.chat = c.msgs.slice(-12).map((x) => ({ role: x.role, text: x.text.slice(0, 2500) })); saveLocal(); }
    } catch (e) {
      c.msgs.pop();
      c.error = e.status === 0 ? 'You seem to be offline.' : (e.message && e.status !== 500 ? e.message : 'The tutor is not available right now. Try again in a moment.');
    }
    c.busy = false; redraw();
    const t = document.getElementById('tutor'); if (t) t.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };
  const open = document.getElementById('tutorOpen');
  if (open) open.onclick = () => { c.open = true; redraw(); const i = document.getElementById('tq'); if (i && matchMedia('(hover: hover)').matches) i.focus(); };
  const close = document.getElementById('tutorClose'); if (close) close.onclick = () => { c.open = false; redraw(); };
  box.querySelectorAll('[data-chip]').forEach((b) => (b.onclick = () => ask(b.textContent, b.dataset.chip)));
  const f = document.getElementById('tform');
  if (f) f.onsubmit = (e) => { e.preventDefault(); const i = document.getElementById('tq'); ask(i.value); };
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
  const main = `${figHTML(q)}${renderStem(q.stem, 'q')}<div class="${q.type === 'graph' ? 'ggrid' : 'stack g10'}">${opts}</div>`;
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
  if (q.type === 'essay') { const m = (S.marks || {})[S.i]; return m && m.essay ? m.total : 0; }
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
  const inks = q.parts.map((_, k) => inkJPEG(sess, idx, k));
  (sess.inkImg || (sess.inkImg = {}))[idx] = inks;
  if (!answers.some((a) => (a || '').trim()) && !inks.some(Boolean)) {
    sess.marks[idx] = { parts: q.parts.map(() => ({ awarded: [], feedback: 'No answer written.' })), tip: '' };
  } else {
    sess.marks[idx] = { pending: true };
    try {
      const [bookId, unitId] = qUnit(q.id);
      const text = await store.get(`text:${bookId}:${unitId}`, '');
      if (!text) throw new Error('missing text');
      sess.marks[idx] = await api('mark', { title: q.section, text, question: qForServer(q), figure: figB64(q), answers, inks: inks.some(Boolean) ? inks.map((x) => (x ? x.split(',')[1] : null)) : undefined, kind: await kindOfId(q.id), lang: langOf(q.stem + ' ' + q.parts.map((p) => p.prompt).join(' ')) });
    } catch (e) {
      sess.marks[idx] = { error: e.status === 0 ? 'You seem to be offline, so the AI could not mark this.' : 'The AI marker is not available right now.' };
    }
  }
  const m = sess.marks[idx];
  // What the AI read from handwriting becomes the answer text (for the mistake book and the tutor).
  if (m.parts || m.essay) {
    const a = sess.answers[idx] = (sess.answers[idx] || q.parts.map(() => '')).slice();
    if (m.essay && m.essay.read && inks[0]) a[0] = m.essay.read;
    (m.parts || []).forEach((p, k) => { if (p && p.read && inks[k]) a[k] = p.read; });
  }
  if (m.parts) sess.ticks[idx] = q.parts.map((p, k) => p.mark_scheme.map((_, j) => ((m.parts[k] || {}).awarded || []).includes(j)));
  if (sess === S && S.i === idx) { const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }
}

function writtenBody(q, revealed) {
  const ans = S.answers[S.i] || q.parts.map(() => '');
  const stem = figHTML(q) + (q.stem ? renderStem(q.stem) : '');
  if (!revealed) {
    const maths = kindSync(q.id) === 'maths', essay = q.type === 'essay';
    const parts = q.parts.map((p, k) => {
      const ink = inkOf(S.i, k, true);
      return `<div class="part">
      <label class="ph" for="a${k}"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></label>
      <div class="ansmode" role="radiogroup" aria-label="How to answer"><button role="radio" aria-checked="${!ink.on}" class="${ink.on ? '' : 'on'}" data-hand="${k}:0">${ICON.keys} Type</button><button role="radio" aria-checked="${ink.on}" class="${ink.on ? 'on' : ''}" data-hand="${k}:1">${ICON.pen} Write by hand</button></div>
      ${ink.on ? `<div class="inkpad"><canvas id="ink${k}" data-k="${k}" aria-label="Writing area: write your answer with your finger or a stylus"></canvas>
          <div class="inktools"><button data-undo="${k}">Undo</button><button data-clear="${k}">Clear</button><button data-more="${k}">More space</button></div></div>`
        : `${maths ? mathKeys(`a${k}`) : ''}
      <textarea id="a${k}" data-k="${k}" class="${essay ? 'essay' : ''}" placeholder="${essay ? 'Write your answer here' : maths ? 'Show your working, one step per line' : 'Type, or tap the microphone on your keyboard to speak'}">${esc(ans[k])}</textarea>
      ${essay ? `<span class="hint" id="wc">${wordCount(ans[k])} words</span>` : ''}`}</div>`;
    }).join('');
    const main = `${stem}${parts}${essay ? `<p class="hint">Marked on ${(q.rubric || []).map((r) => esc(r.criterion)).join(', ')}.</p>` : `<p class="hint">${maths ? 'Method marks are given for correct working, even if the final answer is wrong.' : 'Aim for one clear point per mark.'}</p>`}`;
    const footer = `<div class="pad stack g8" style="padding-top:0"><button class="btn" id="check">${isExam() ? nextLabel() : 'Mark my answer'}</button>${isExam() ? '' : '<button class="link quiet" id="skip" style="align-self:center">Show the answer without trying</button>'}</div>`;
    return { main, footer, bind() {
      const grab = () => {
        const prev = S.answers[S.i] || [];
        S.answers[S.i] = q.parts.map((_, k) => { const t = document.getElementById(`a${k}`); return t ? t.value : (prev[k] || ''); });
        const wc = document.getElementById('wc'); if (wc) wc.textContent = `${wordCount(S.answers[S.i][0])} words`;
      };
      bindMathKeys();
      bindInk(q);
      $app.querySelectorAll('[data-hand]').forEach((b) => (b.onclick = () => {
        grab();
        const [k, on] = b.dataset.hand.split(':'); inkOf(S.i, +k, true).on = on === '1';
        local.hand = on === '1'; saveLocal();
        const y = window.scrollY; renderQuestion(); window.scrollTo(0, y);
      }));
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
        ${yoursHTML(k, ans[k], null)}</div>`).join('')}`,
      footer: `<div class="sheet" style="align-items:center;text-align:center"><div class="spinner" aria-hidden="true"></div><span class="verdict" style="color:var(--ink)">Marking your answer…</span><span class="hint">Checking it against the mark scheme, point by point.</span></div>`,
    };
  }
  if (q.type === 'essay') return essayRevealed(q, m, ans, stem);
  const ai = !!m.parts;
  const ticks = S.ticks[S.i] || (S.ticks[S.i] = q.parts.map((p) => p.mark_scheme.map(() => false)));
  const partHtml = q.parts.map((p, k) => {
    const pm = ai ? m.parts[k] || {} : null;
    const got = Math.min(p.marks, ticks[k].filter(Boolean).length);
    return `<div class="part">
      <div class="ph"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></div>
      ${yoursHTML(k, ans[k], pm)}
      ${pm ? `<div class="marker ${got === p.marks ? 'full' : ''}"><b>${got} / ${p.marks}</b> ${esc(pm.feedback)}</div>` : ''}
      <span class="hint" style="font-weight:600">${ai ? 'Mark scheme (ticked = points you earned):' : m.skipped ? 'Mark scheme:' : `Tick each point your answer makes${p.mark_scheme.length > p.marks ? ` (max ${p.marks})` : ''}:`}</span>
      ${p.mark_scheme.map((pt, j) => `<button class="point ${ticks[k][j] ? 'on' : ''}" data-k="${k}" data-j="${j}" aria-pressed="${ticks[k][j]}"><span class="box">${ticks[k][j] ? ICON.check : ''}</span><span>${esc(pt.replace(/\s*\(1\)\s*$/, ''))}</span></button>`).join('')}
    </div>`;
  }).join('');
  const got = partsGot(q);
  const note = m.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(m.error)} Tick the points you made instead.</p>`
    : ai ? '<p class="hint" style="margin:0">Marked by AI. Think it got one wrong? Tap a point to change it.</p>' : '';
  const footer = `<div class="sheet"><span class="verdict ${got === marksOf(q) ? 'ok' : 'no'}">${got} / ${marksOf(q)} marks</span>
    ${m.tip ? `<p class="tipline"><b>Tip:</b> <span data-raw>${esc(m.tip)}</span></p>` : ''}${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${note}${partHtml}`, footer, bind() {
    $app.querySelectorAll('.point').forEach((b) => (b.onclick = () => { const k = +b.dataset.k, j = +b.dataset.j; ticks[k][j] = !ticks[k][j]; const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }));
  } };
}

const wordCount = (t) => { const x = String(t || '').trim(); if (!x) return 0; const cjk = (x.match(/[㐀-鿿]/g) || []).length; return cjk > 20 ? cjk : x.split(/\s+/).length; };
const kindSync = (qid) => bookKinds.get(String(qid || '').split(':')[0]) || 'science';
const MATH_KEYS = ['²', '³', '√', 'π', '×', '÷', '±', '≤', '≥', '≠', '≈', '°', 'θ', '½', '⁻¹', '(', ')', 'sin', 'cos', 'tan', 'log'];
const mathKeys = (id) => `<div class="mathkb" role="toolbar" aria-label="Maths symbols">${MATH_KEYS.map((k) => `<button type="button" data-mk="${k}" data-for="${id}">${k}</button>`).join('')}</div>`;
function bindMathKeys() {
  $app.querySelectorAll('[data-mk]').forEach((b) => {
    b.onmousedown = (e) => e.preventDefault(); // keep the cursor in the answer box
    b.onclick = () => {
      const t = document.getElementById(b.dataset.for); if (!t) return;
      const ins = /^[a-z]+$/.test(b.dataset.mk) ? b.dataset.mk + '(' : b.dataset.mk;
      const a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
      t.value = t.value.slice(0, a) + ins + t.value.slice(z);
      t.focus(); t.selectionStart = t.selectionEnd = a + ins.length;
      t.dispatchEvent(new Event('input'));
    };
  });
}

/* ---------- handwriting pad ----------
   Strokes are kept as points (CSS pixels) so the pad can be redrawn after any re-render.
   When marking, the writing is turned into a JPEG and the AI reads it, then marks it. */
function inkOf(i, k, create) {
  S.ink = S.ink || {};
  const a = S.ink[i] || (S.ink[i] = {});
  if (!a[k] && create) a[k] = { on: !!local.hand, strokes: [], h: 260, w: 0 };
  return a[k];
}
function drawStroke(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.1, pts[0][1] + 0.1); }
  for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
}
function inkStyle(ctx) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#111'; }
function bindInk(q) {
  $app.querySelectorAll('canvas[data-k]').forEach((cv) => {
    const k = +cv.dataset.k, ink = inkOf(S.i, k, true);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = cv.parentElement.clientWidth;
    ink.w = Math.max(ink.w, w);
    cv.style.height = `${ink.h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(ink.h * dpr);
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); inkStyle(ctx);
    const redraw = () => { ctx.clearRect(0, 0, w, ink.h); ink.strokes.forEach((st) => drawStroke(ctx, st)); };
    redraw();
    let cur = null, pid = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10]; };
    cv.onpointerdown = (e) => {
      if (cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); cv.setPointerCapture(e.pointerId); pid = e.pointerId;
      cur = [pt(e)]; ink.strokes.push(cur); drawStroke(ctx, cur);
    };
    cv.onpointermove = (e) => {
      if (!cur || e.pointerId !== pid) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) { const p = pt(ev); const l = cur[cur.length - 1]; if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) >= 1) cur.push(p); }
      const n = cur.length; drawStroke(ctx, cur.slice(Math.max(0, n - 4)));
    };
    const end = (e) => { if (e.pointerId !== pid) return; cur = null; pid = null; redraw(); };
    cv.onpointerup = end; cv.onpointercancel = end;
  });
  const keep = () => { const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); };
  $app.querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => { inkOf(S.i, +b.dataset.undo).strokes.pop(); keep(); }));
  $app.querySelectorAll('[data-clear]').forEach((b) => (b.onclick = () => { inkOf(S.i, +b.dataset.clear).strokes = []; keep(); }));
  $app.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => { const ink = inkOf(S.i, +b.dataset.more); ink.h = Math.min(1600, ink.h + 200); keep(); }));
}
// The written area as a JPEG (white background, cropped to what was used). Null if the part was typed.
function inkJPEG(sess, i, k) {
  const ink = sess.ink && sess.ink[i] && sess.ink[i][k];
  if (!ink || !ink.on || !ink.strokes.length) return null;
  let maxY = 0, maxX = 0; ink.strokes.forEach((st) => st.forEach(([x, y]) => { maxY = Math.max(maxY, y); maxX = Math.max(maxX, x); }));
  const w = Math.max(200, Math.min(ink.w || 360, maxX + 24)), h = Math.min(ink.h, maxY + 24), sc = Math.min(2, 1100 / w);
  const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.scale(sc, sc); inkStyle(ctx); ctx.lineWidth = 3;
  ink.strokes.forEach((st) => drawStroke(ctx, st));
  return c.toDataURL('image/jpeg', 0.85);
}
// The student's answer as shown after marking: their handwriting (if any) and what the AI read.
function yoursHTML(k, text, pm) {
  S.inkImg = S.inkImg || {};
  if (!S.inkImg[S.i]) S.inkImg[S.i] = [];
  if (S.inkImg[S.i][k] === undefined) S.inkImg[S.i][k] = inkJPEG(S, S.i, k);
  const img = S.inkImg[S.i][k];
  if (img) {
    return `<div class="yours handwritten"><img src="${img}" alt="Your handwritten answer">${pm && pm.read ? `<p class="readas"><span>${LANG === 'zh' ? '我們讀到的答案：' : 'We read your answer as:'}</span> <span data-raw class="readtxt">${esc(pm.read)}</span></p><span class="hint">${LANG === 'zh' ? '如果讀錯了，可以寫清楚一點再試。' : 'If we misread it, write it more clearly and try again.'}</span>` : ''}</div>`;
  }
  return `<div class="yours nomath ${text && text.trim() ? '' : 'empty'}">${text && text.trim() ? esc(text) : 'No answer written'}</div>`;
}

function essayRevealed(q, m, ans, stem) {
  const text = (ans[0] || '').trim();
  const max = marksOf(q);
  const mine = `${yoursHTML(0, text, m.essay ? { read: m.essay.read } : null)}<span class="hint">${wordCount(text)} words</span>`;
  const task = `<div class="part"><div class="ph"><span>${esc(q.parts[0].prompt)}</span><span class="mk">${max} marks</span></div>${mine}</div>`;
  if (!m.essay) {
    return { main: `${stem}${task}`, footer: `<div class="sheet"><span class="verdict no">Not marked</span><p class="hint" style="margin:0;color:var(--miss-dark)">${esc(m.error || 'The AI marker is not available right now.')}</p><button class="btn ghost" id="remark">Try marking again</button>${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`,
      bind() { document.getElementById('remark').onclick = () => { S.marks[S.i] = null; markAnswer(S, S.i); renderQuestion(); }; } };
  }
  const e = m.essay;
  const crit = e.criteria.map((c) => `<div class="crit"><div class="crit-top"><b data-raw>${esc(c.criterion)}</b><span>${c.score} / ${c.max}</span></div>
    <div class="bar ${c.score / c.max < 0.5 ? 'warn' : ''}"><i style="width:${Math.round(100 * c.score / c.max)}%"></i></div><p data-raw>${esc(c.feedback)}</p></div>`).join('');
  const imp = e.improvements.length ? `<div class="stack g6"><span class="hint" style="font-weight:600">How to improve it</span><ul class="improve" data-raw>${e.improvements.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const footer = `<div class="sheet"><span class="verdict ${m.total >= max * 0.7 ? 'ok' : 'no'}">${m.total} / ${max} marks</span>
    ${e.tip ? `<p class="tipline"><b>Tip:</b> <span data-raw>${esc(e.tip)}</span></p>` : ''}${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${task}<p class="hint" style="margin:0">Marked by AI against the rubric.</p><div class="card stack g14" style="padding:14px 16px">${crit}</div>${imp}`, footer };
}

function record(q, got) {
  const s = local.stats[q.id] || { seen: 0, got: 0, total: 0, last: 0 };
  s.seen++; s.got += got; s.total += marksOf(q); s.last = got / marksOf(q);
  schedule(s, got >= marksOf(q));
  local.stats[q.id] = s;
  // Activity log for progress reports: when, which question/chapter, marks, and how it was practised.
  local.log.push({ t: Date.now(), q: q.id, c: q.section || '', g: got, m: marksOf(q), l: q.level, k: (S && S.mode) || '' });
  // Mistake book: every question not fully right goes in; getting it fully right later marks it mastered.
  const mk = local.mistakes[q.id];
  if (got < marksOf(q)) {
    const k = S ? S.qs.indexOf(q) : -1;
    const ans = k >= 0 ? S.answers[k] : null;
    // MCQ options are shuffled per session, so keep the text of the chosen option, not just its letter.
    const ansText = choiceType(q) && ans ? (q.options || [])['ABCD'.indexOf(ans)] || '' : null;
    local.mistakes[q.id] = { t: Date.now(), n: ((mk && mk.n) || 0) + 1, got, ans: Array.isArray(ans) ? ans.map((a) => String(a || '').slice(0, 1500)) : null, ansText, chat: (mk && mk.chat) || null, done: false };
  } else if (mk && !mk.done) { mk.done = true; mk.doneAt = Date.now(); }
  const ids = Object.keys(local.mistakes);
  if (ids.length > 600) ids.sort((a, b) => local.mistakes[a].t - local.mistakes[b].t).slice(0, ids.length - 600).forEach((id) => delete local.mistakes[id]);
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
  bindTutor(q);
  const r = document.getElementById('report');
  if (r) r.onclick = () => { if (!local.reports.includes(q.id)) { local.reports.push(q.id); saveLocal(); } toast('Thanks. You won’t see this question again.'); };
}

function advance() {
  (S.times || (S.times = [])).push(Date.now());
  if (S.i < S.target - 1) {
    S.i++; S.phase = S.review ? 'revealed' : 'answer';
    if (S.mode === 'dse' && !S.review && S.i === S.sectionA && S.sectionA) toast('Section B: written questions');
    topUp(S);
    if (S.i < S.qs.length) return renderQuestion();
    if (!S.generating && !S.error && (S.units || S.fill)) refill(S);
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
    const st = full ? 'right' : g ? 'part' : 'miss';
    return `<div class="rrow ${st}"><span class="rnum">Q${k + 1}</span><span class="rtext" data-raw>${esc(String(label).slice(0, 110))}${String(label).length > 110 ? '…' : ''}</span><span class="rmark">${g}/${m}</span></div>`;
  }).join('');
  const missed = qs.filter((q, k) => (S.got[k] || 0) < marksOf(q));
  const missedIdx = qs.map((q, k) => k).filter((k) => (S.got[k] || 0) < marksOf(qs[k]));
  const drillable = missedIdx.filter((k) => canDrill(qs[k])).slice(0, 10); // drill up to 10 missed ideas
  const unitRef = S.units ? { book: S.book, units: S.units } : null;
  // Timed tests and mock papers count towards mastery (per chapter, only when finished).
  if (S.mode === 'dse' && !S.ws && !S.endedEarly && !S.recorded) {
    S.recorded = true;
    const per = {};
    qs.forEach((q, k) => { const key = qUnit(q.id).join(':'); const r = per[key] || (per[key] = [0, 0]); r[0] += S.got[k] || 0; r[1] += marksOf(q); });
    local.tests = [...(local.tests || []), { t: Date.now(), per }].slice(-300); saveLocal();
  }
  if (S.ws && !S.endedEarly) saveWorksheetScore(S.ws, `${got} / ${total}`);
  const nRight = qs.filter((q, k) => (S.got[k] || 0) === marksOf(q)).length;
  const nMiss = qs.filter((q, k) => !(S.got[k] || 0) && marksOf(q)).length;
  const nPart = qs.length - nRight - nMiss;
  const band = pct >= 85 ? 'good' : pct >= 50 ? 'mid' : '';
  const head = pct >= 85 ? 'Excellent work' : pct >= 70 ? 'Good, solid work' : pct >= 50 ? 'Getting there' : 'Worth another go';
  const sub = pct >= 85 ? 'You know this well. Reviews over the next few days will lock it in.'
    : pct >= 70 ? 'A few slips to tidy up, then you’re there.'
    : pct >= 50 ? 'Fix the ones you missed and you’ll be well on your way.'
    : 'This set was tough. Drilling the ones you missed is the fastest way up.';
  const sections = S.mode === 'dse' ? (() => {
    const sec = (from, to) => { const xs = qs.slice(from, to); return [xs.reduce((a, q, k) => a + (S.got[from + k] || 0), 0), xs.reduce((a, q) => a + marksOf(q), 0)]; };
    const [ga, ta] = sec(0, S.sectionA), [gb, tb] = sec(S.sectionA, qs.length);
    return `<div class="rsecs">${ta ? `<div><span>Section A · MCQ</span><b>${ga} / ${ta}</b></div>` : ''}${tb ? `<div><span>Section B · written</span><b>${gb} / ${tb}</b></div>` : ''}</div>`;
  })() : '';
  const X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const V = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const H = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
  $app.innerHTML = `<main class="pad results">
    <div class="r-left">
    <section class="rhero ${band}">
      <span class="rmeta">${esc(S.title)} · ${S.endedEarly ? `stopped after ${qs.length}` : 'done'}</span>
      <div class="rtop"><div class="ring ${band}" style="--p:${pct}" role="img" aria-label="${pct}%"><span>${pct}%</span></div>
        <div class="rhead"><b>${head}</b><span>${got} of ${total} marks</span></div></div>
      <p class="rsub">${sub}</p>
      <div class="rcounts"><span class="right">${V} ${nRight} right</span>${nPart ? `<span class="part">${H} ${nPart} partly</span>` : ''}<span class="miss">${X} ${nMiss} missed</span></div>
      ${sections}
    </section>
    <div class="ractions">
      ${drillable.length ? `<button class="btn" id="drillall">${ICON.target.replace('width="22" height="22"', 'width="18" height="18"').replace('var(--miss)', 'currentColor')} Drill my weak spots · ${drillable.length * PER_IDEA} new questions</button>` : ''}
      ${unitRef ? `<button class="btn ${drillable.length ? 'ghost' : ''}" id="more">${S.count || SESSION_SIZE} more on ${unitRef.units.length > 1 ? 'these chapters' : 'this chapter'}</button>` : ''}
      <div class="rgrid">
      ${missed.length ? `<button class="btn ghost" id="retry">Retry the ${missed.length} I missed</button>` : ''}
      ${qs.length ? '<button class="btn ghost" id="redo">Redo this set (shuffled)</button>' : ''}
      </div>
      <button class="link rback" id="home">${S.book ? 'Back to chapters' : 'Back to home'}</button>
    </div>
    </div>
    <section class="rlist"><h2>Your answers</h2>
      ${S.mode === 'spaced' ? `<p class="hint" style="margin:0 0 8px;line-height:1.5">Questions you got right come back later and later. The ones you missed come back tomorrow.</p>` : ''}
      <div class="card">${list}</div></section>
    </main>`;
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

// Keyboard on laptops: A–D or 1–4 picks an answer, Enter goes on.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // the button handles these itself
  const hk = document.querySelector(`[data-hotkey="${e.key === ' ' ? ' ' : e.key}"]`);
  if (hk && !hk.disabled) { e.preventDefault(); hk.click(); return; }
  const k = e.key.toUpperCase();
  const L = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }[k] || (/^[A-D]$/.test(k) ? k : null);
  if (L) { const b = document.querySelector(`[data-opt="${L}"]:not(:disabled)`); if (b) { e.preventDefault(); b.click(); } return; }
  if (e.key === 'Enter' && (!t || t.tagName !== 'BUTTON')) {
    const b = document.querySelector('#next:not(:disabled), #check:not(:disabled)'); if (b) { e.preventDefault(); b.click(); }
  }
});

// Formulas: anything between $…$ (written by the AI in LaTeX) is drawn as proper maths/chemistry.
const MATH_OPTS = {
  delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'svg', 'input'],
  ignoredClasses: ['nomath'],
  throwOnError: false,
};
function renderMath(root) {
  if (!window.renderMathInElement || !root || root.nodeType !== 1) return;
  if (!/\$|\\\(/.test(root.textContent || '')) return;
  try { window.renderMathInElement(root, MATH_OPTS); } catch (e) {}
}
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.closest('.katex')) renderMath(n); });
}).observe(document.body, { childList: true, subtree: true });

{ const st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.appendChild(st); }
initLang();
watch(document.body);
getBooks().then(pruneMistakes).catch(() => {});
go({ name: 'home' });
