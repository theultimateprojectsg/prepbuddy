// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { DEMO_ID, installDemo, removeDemo } from './demo.js';
import { buildReport, encodeReport, headline, weekTone, minutesOf, skillsHTML, REPORT_CSS, reportHTML, strongerHTML } from './report.js';
import * as PG from './progress.js';
import { initLang, setLang, watch, LANG, LOCALE, setTranslator } from './i18n.js';
import { startVoice, voiceSupported } from './voice.js';
import { logoSVG, buddySVG, buddyFace, buddyFire } from './buddy.js';
import { PRIVACY, PRIVACY_UPDATED } from './privacy.js';
import { menuIcon, subjectIcon, subjectTile, subjectColour, actionIcon, actionTile, subjectName } from './icons.js';
const subj = (s) => subjectName(s, LANG);

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
// Young children: mostly multiple choice (typing is hard at P1-P3), small written questions, and no DSE-style essays
// before secondary. Uses the grade a parent set; otherwise the plan is unchanged.
const GRADE_MIX = {
  p12: [[1, 'mcq'], [2, 'mcq'], [1, 'mcq'], [2, 'short'], [2, 'mcq'], [3, 'mcq'], [1, 'mcq'], [2, 'mcq']],
  p34: [[1, 'mcq'], [2, 'mcq'], [2, 'short'], [2, 'mcq'], [3, 'mcq'], [3, 'structured'], [2, 'mcq'], [3, 'short']],
};
function gradePlan(plan, types) {
  const b = typeof gradeBand === 'function' ? gradeBand() : '';
  if (!b) return plan;
  if (types === 'mix' && GRADE_MIX[b]) return GRADE_MIX[b];
  if (b === 'p12' && types === 'written') return [[1, 'short'], [2, 'short'], [2, 'structured'], [1, 'short']];
  if (/^p/.test(b)) return plan.map(([l, t]) => [l, t === 'essay' ? 'structured' : t]);
  return plan;
}
// Question types: what the student picked, or for P1-P2 multiple choice until they choose otherwise.
const curTypes = () => (local.typesSet || typeof gradeBand !== 'function' || gradeBand() !== 'p12' ? local.types || 'mix' : 'mcq');
const matchType = (q, types) => !types || types === 'mix' || (types === 'mcq' ? choiceType(q) : !choiceType(q));
// Difficulty the student picks. Auto adapts to how they're doing; the others keep questions to these levels
// (1 Recall, 2 Understand, 3 Apply, 4 Analyse / evaluate).
const DIFFS = [['auto', 'Auto'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['master', 'Master']];
const DIFF_RANGE = { easy: [1, 2], medium: [2, 3], hard: [3, 4], master: [4, 4], l1: [1, 1], l2: [2, 2], l3: [3, 3], l4: [4, 4] };
const curDiff = () => { const d = local.diff || 'auto'; return limitOf('hardDiff') || d === 'easy' || d === 'medium' ? d : 'medium'; };
const diffOK = (q, diff) => { const r = DIFF_RANGE[diff]; if (!r) return true; const l = q.level || 2; return l >= r[0] && l <= r[1]; };
const PLAN = [[2, 'mcq'], [1, 'mcq'], [2, 'mcq'], [2, 'short'], [1, 'mcq'], [3, 'structured'], [2, 'mcq'],
              [4, 'structured'], [1, 'mcq'], [2, 'short'], [3, 'mcq'], [3, 'structured'], [2, 'mcq']];

/* ---------- small local settings + progress (localStorage) ---------- */
// Children on this device. Each has their own saved progress (localStorage key) and books (IndexedDB database).
// The first child uses the original key and database, so a family with one child sees no change.
const KIDS_KEY = 'prepbuddy.kids';
const KIDS = (() => { try { const r = JSON.parse(localStorage.getItem(KIDS_KEY)); if (r && Array.isArray(r.list) && r.list.length) return r; } catch (e) {} return { cur: 'k0', list: [{ id: 'k0', key: 'prepbuddy.v2', db: 'prepbuddy', av: 0 }] }; })();
const KID = KIDS.list.find((k) => k.id === KIDS.cur) || KIDS.list[0];
const LKEY = KID.key;
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; }
}
const local = Object.assign({ stats: {}, reports: [], code: '', usage: {}, log: [], name: '', types: 'mix', mistakes: {} }, loadLocal());
// Test-only things (plan preview, AI usage, library books that aren't starter books) show only with ?dev=1
// (remembered on this device; ?dev=0 turns it off). Families never see them.
const DEV = (() => { try { const m = location.search.match(/[?&]dev=([01])\b/); if (m) localStorage.setItem('pb.dev', m[1]); return localStorage.getItem('pb.dev') === '1'; } catch (e) { return false; } })();
let WIPING = false; // set while 'Delete everything on this device' runs, so nothing is written back
function saveLocal() { if (WIPING) return; try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) {} }

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
  if (recent.length < 5) {   // not enough practice yet: start from the level check, if there was one
    const pl = ((local.placement || {})[bookId] || {}).u || {}, r = pl[unitId];
    if (!r || !r[1]) return 0;
    const a = r[0] / r[1];
    return a >= 0.99 ? 1 : a < 0.4 ? -1 : 0;
  }
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
async function levelOfId(qid) { const id = String(qid || '').split(':')[0]; const b = (await getBooks()).find((x) => x.id === id); return (b && b.level) || ''; }
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const marksOf = (q) => (q.type === 'mcq' || q.type === 'graph' ? 1 : (q.parts || []).reduce((s, p) => s + p.marks, 0));
// The language a chapter is written in, so the AI writes questions, marking and explanations in it:
// 'ja' (any real amount of kana), 'zh-HK' (mostly Chinese characters), 'fr' (French words and accents), else 'en'.
const FR_WORDS = /\b(le|la|les|des|une|est|et|du|dans|pour|que|qui|sur|avec|au|aux|ce|cette|sont|pas|il|elle|nous|vous|ils|leur|mais|ou|où|être|avoir|fait|très|aussi)\b/gi;
const EN_WORDS = /\b(the|and|is|of|to|in|that|it|for|with|are|this|was|be|on|as|by|which|from|have)\b/gi;
const langOf = (t) => {
  const x = String(t || '').slice(0, 20000);
  const kana = (x.match(/[\u3040-\u30ff]/g) || []).length, cjk = (x.match(/[\u3400-\u9fff]/g) || []).length;
  if (kana >= 2 && kana > (kana + cjk) * 0.1) return 'ja';
  const words = (x.match(/[A-Za-zÀ-ÿ]{2,}/g) || []).length;
  if (cjk > words) return 'zh-HK';
  const fr = (x.match(FR_WORDS) || []).length + (x.match(/[éèêëàâçùûôîïœ]/gi) || []).length / 2, en = (x.match(EN_WORDS) || []).length;
  return fr >= 3 && fr > en * 1.5 ? 'fr' : 'en';
};
// The reading / listening voice that matches a chapter's language.
const voiceOf = (lang) => ({ 'zh-HK': zhVoice(), fr: 'fr', ja: 'ja' }[lang] || 'en');
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
  mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
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
// A small pop-up asking the student to confirm before leaving a practice. Resolves true to leave.
function confirmLeave({ title, body, stay, leave }) {
  return new Promise((resolve) => {
    document.querySelectorAll('.cdlg-wrap').forEach((x) => x.remove());
    const back = document.activeElement;
    const w = document.createElement('div');
    w.className = 'cdlg-wrap';
    w.innerHTML = `<div class="cdlg" role="alertdialog" aria-modal="true" aria-labelledby="cdlgT" aria-describedby="cdlgB">
      <h2 id="cdlgT">${esc(title)}</h2><p id="cdlgB">${esc(body)}</p>
      <div class="cdlg-btns"><button class="btn ghost" data-v="0">${esc(stay)}</button><button class="btn leave" data-v="1">${esc(leave)}</button></div></div>`;
    const btns = [...w.querySelectorAll('button')];
    const done = (v) => { document.removeEventListener('keydown', onKey, true); w.remove(); if (!v && back && back.focus) back.focus(); resolve(v); };
    // While it's open, keys only work the pop-up (A–D and Enter mustn't answer the question underneath).
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return done(false); }
      if (e.key === 'Tab') { e.preventDefault(); const i = btns.indexOf(document.activeElement); btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus(); }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    w.onclick = (e) => { if (e.target === w) done(false); };
    btns.forEach((b) => (b.onclick = () => done(b.dataset.v === '1')));
    document.body.appendChild(w);
    btns[0].focus();
  });
}
// What the pop-up says depends on what the student is leaving.
function leaveText(kind, viaMenu) {
  const zh = LANG === 'zh';
  if (kind === 'exam') return zh ? { title: '離開呢份試卷？', body: '試卷會停止計時，亦唔會評分。', stay: '繼續作答', leave: '離開' }
    : { title: 'Leave this paper?', body: 'The timer stops and this paper won’t be marked.', stay: 'Keep going', leave: 'Leave' };
  if (kind === 'cards') return zh ? { title: '停止溫習字卡？', body: '你可以隨時再溫。', stay: '繼續', leave: '離開' }
    : { title: 'Stop these flashcards?', body: 'You can come back to them any time.', stay: 'Keep going', leave: 'Leave' };
  if (kind === 'lesson') return zh ? { title: '離開這一課？', body: '你的進度已保存，可以在「今日」繼續。', stay: '繼續上課', leave: '離開' }
    : { title: 'Leave this lesson?', body: 'Your place is saved. You can carry on from Today.', stay: 'Keep learning', leave: 'Leave' };
  if (kind === 'dict') return zh ? { title: '停止這次默書？', body: '已核對的詞語會保存。', stay: '繼續', leave: '停止' }
    : { title: 'Stop this dictation?', body: 'Words you’ve marked so far are saved.', stay: 'Keep going', leave: 'Stop' };
  if (kind === 'wait') return zh ? { title: '停止呢次練習？', body: '題目仲做緊，離開就會停止。', stay: '繼續等', leave: '離開' }
    : { title: 'Stop this practice?', body: 'Your questions are still being made. Leaving stops them.', stay: 'Keep waiting', leave: 'Leave' };
  return zh ? { title: '離開呢次練習？', body: viaMenu ? '你答過嘅題目已經儲存。' : '你答過嘅題目已經儲存，跟住會見到你嘅成績。', stay: '繼續練習', leave: '離開' }
    : { title: 'Leave this practice?', body: viaMenu ? 'The answers you’ve given are saved.' : 'The answers you’ve given are saved. You’ll see your results next.', stay: 'Keep practising', leave: 'Leave' };
}
// A written answer that's been marked but not yet counted (the student hadn't pressed Next) is counted now.
function saveOpenAnswer() {
  if (!S || !S.qs) return;
  const q = S.qs[S.i];
  if (q && S.phase === 'revealed' && !choiceType(q) && (S.got[S.i] === undefined || S.got[S.i] === null) && !((S.marks || {})[S.i] || {}).pending) {
    S.got[S.i] = partsGot(q); record(q, S.got[S.i]);
  }
}
const inSession = () => document.getElementById('quit') || document.querySelector('#back[data-kind="lesson"]');
function toast(msg) { document.querySelectorAll('.toast').forEach((x) => x.remove()); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

// Long questions are laid out so they're easy to read: the scenario in short paragraphs, lists of given
// figures as bullet points, the numbers picked out, and the actual question set apart at the end.
const ASKS = /[?？]\s*$|^(what|which|how|why|when|who|calculate|find|explain|state|describe|determine|show|work out|estimate|suggest|compare|evaluate|name|identify|give|outline|discuss|deduce|predict)\b|^(計算|求|解釋|說明|試|列出|指出|比較|描述|分析|評估|為甚麼|為什麼|哪)/i;
const CONDITION = /^(assume|assuming|ignore|given that|suppose|you may assume|假設|忽略)/i;
const NUM = /((?:HKD|HK\$|US\$|USD|RMB|\$|£|€)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|kg|g|mg|km|cm|mm|m|s|ms|min|h|N|J|kJ|W|kW|V|A|Ω|K|°C|mol|dm³|cm³|L|ml|mL|years?|months?|days?|shares?)(?![A-Za-z]))/g;
const nums = (h) => h.replace(NUM, '<b class="num">$1</b>');
function splitSentences(t) {
  let s = t.split(/(?<=[.!?])\s+(?=[A-Z"“(\d])/);
  if (s.length < 3 && /[。！？]/.test(t)) s = t.split(/(?<=[。！？])/);
  return s.map((x) => x.trim()).filter(Boolean);
}
// "the closing prices are: Stock B HKD 35, Stock C HKD 45 and Stock D HKD 42." -> an intro and a list
function asList(sent) {
  const m = sent.match(/^(.{6,}?):\s*(.+?)[.。]?$/);
  if (!m) return null;
  const items = m[2].split(/;\s*|,\s*(?:and\s+)?|\s+and\s+|、|；/).map((x) => x.trim()).filter(Boolean);
  // Only real data lists (values or short phrases), not "stocks: B, C and D".
  const avg = items.reduce((t, x) => t + x.length, 0) / (items.length || 1);
  return items.length >= 3 && items.every((x) => x.length <= 60) && (items.some((x) => /\d/.test(x)) || avg >= 8) ? { intro: m[1] + ':', items } : null;
}
function stemBlocks(text) {
  // Written with line breaks already: blank lines split paragraphs, "- " lines make a list.
  if (text.includes('\n')) {
    const blocks = [];
    for (const para of text.split(/\n\s*\n/)) {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (lines.every((l) => /^[-•*]\s+/.test(l))) blocks.push({ list: lines.map((l) => l.replace(/^[-•*]\s+/, '')) });
      else if (lines.length > 1 && lines.slice(1).every((l) => /^[-•*]\s+/.test(l))) blocks.push({ intro: lines[0], list: lines.slice(1).map((l) => l.replace(/^[-•*]\s+/, '')) });
      else blocks.push({ p: lines.join('\n') });
    }
    const last = blocks[blocks.length - 1];
    if (blocks.length > 1 && last && last.p && ASKS.test(last.p.split('\n').pop())) last.ask = true;
    return blocks.length > 1 ? blocks : null;
  }
  if (text.length + (text.match(/[\u3400-\u9fff]/g) || []).length < 200) return null; // Chinese packs more into each character
  const sents = splitSentences(text);
  if (sents.length < 3) return null;
  let qi = sents.length - 1;
  while (qi > 0 && !ASKS.test(sents[qi])) qi--;
  if (!ASKS.test(sents[qi])) qi = sents.length - 1;
  let qs = qi; while (qs > 1 && CONDITION.test(sents[qs - 1])) qs--;
  const blocks = []; let para = [];
  const flush = () => { if (para.length) blocks.push({ p: para.join(' ') }); para = []; };
  for (const sent of sents.slice(0, qs)) {
    const l = asList(sent);
    if (l) { flush(); blocks.push({ intro: l.intro, list: l.items }); continue; }
    para.push(sent); if (para.length === 2) flush();
  }
  flush();
  blocks.push({ p: sents.slice(qs).join(' '), ask: true });
  return blocks;
}
// Written questions put each question in its part, but the AI sometimes also ends the stem with the same question.
// Drop any closing sentence of the stem that repeats a part's prompt, so it isn't asked twice.
const normAsk = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function writtenStem(q) {
  let stem = String(q.stem || '').trim();
  const prompts = (q.parts || []).map((p) => normAsk(p.prompt)).filter((x) => x.length > 8);
  if (!stem || !prompts.length) return stem;
  const repeats = (t) => { const n = normAsk(t); return n.length >= 20 && prompts.some((p) => p === n || (Math.min(n.length, p.length) >= 0.75 * Math.max(n.length, p.length) && (p.includes(n) || n.includes(p)))); };
  for (let k = 0; k < 4 && stem; k++) {
    const paras = stem.split(/\n\s*\n/);
    const lastPara = paras[paras.length - 1];
    if (repeats(lastPara)) { paras.pop(); stem = paras.join('\n\n').trim(); continue; }
    const sents = splitSentences(lastPara);
    if (sents.length > 1 && repeats(sents[sents.length - 1])) { paras[paras.length - 1] = sents.slice(0, -1).join(' '); stem = paras.join('\n\n').trim(); continue; }
    break;
  }
  return stem;
}
function renderStem(stem, cls = 'stem') {
  if (!stem) return '';
  // Tables (pipe rows) keep the old handling.
  if (!/\|.*\|/.test(stem)) {
    const blocks = stemBlocks(String(stem).trim());
    if (blocks) {
      const ctx = cls === 'q' ? 'q-ctx' : cls;
      return `<div class="stemblock ${cls === 'q' ? 'big' : ''}">${blocks.map((b) => b.list
        ? `${b.intro ? `<p class="${ctx}">${nums(esc(b.intro))}</p>` : ''}<ul class="givens">${b.list.map((x) => `<li>${nums(esc(x))}</li>`).join('')}</ul>`
        : `<p class="${b.ask ? `${cls} ask` : ctx}">${nums(esc(b.p))}</p>`).join('')}</div>`;
    }
  }
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
// Each book's subject (grouped: two maths books are one subject), kept in memory for the progress tracker.
const BOOK_SUBJ = {};
async function getBooks() { const bs = await store.get('books', []); bs.forEach((b) => { BOOK_SUBJ[b.id] = PG.subjectKey(b.subject, b.id); const k = bookSubjKey(b); if (k === 'fre' || k === 'jpn') EXTRA_SUBJ.add(k); }); if (!libSynced && bs.some((b) => b.library)) { libSynced = true; setTimeout(() => refreshLibBooks().catch(() => {}), 2500); } return bs; }
// Library books we update (e.g. PrepBuddy starter books) carry "rev" in the catalog: a newer rev re-downloads the chapter
// texts and chapter list on this device, keeping the student's questions and progress.
let libSynced = false;
async function refreshLibBooks() {
  const cat = await getCatalog();
  const books = await store.get('books', []);
  let changed = false;
  for (const b of books) {
    const e = b.library && cat.find((x) => x.id === b.library);
    if (!e || !e.rev || (b.rev || 1) >= e.rev) continue;
    const texts = await Promise.all(e.units.map(async (u) => { const r = await fetch(`library/${e.id}/${u.id}.txt`, { cache: 'no-cache' }).catch(() => null); return r && r.ok ? r.text() : null; }));
    if (texts.some((t) => t == null)) continue;
    for (let i = 0; i < e.units.length; i++) { await store.set(`text:${b.id}:${e.units[i].id}`, texts[i]); }
    // add any new starter questions from the book's bank (keeps the student's own questions and stats)
    const qr = await fetch(`library/${e.id}/questions.json`, { cache: 'no-cache' }).catch(() => null);
    const bank = qr && qr.ok ? await qr.json().catch(() => ({})) : {};
    for (const u of e.units) {
      const add = (bank[u.id] || []).map((q) => ({ ...q, id: `${b.id}:${u.id}:${q.id}`, section: u.title, pages: q.pages || `${u.startPage}-${u.endPage}` }));
      if (!add.length) continue;
      const existing = await getQs(b.id, u.id); const have = new Set(existing.map((q) => q.id));
      const fresh = add.filter((q) => !have.has(q.id));
      // starter questions we've corrected since (wording, mark scheme, explanation) replace the old copy; stats and mistakes are kept by id
      const fix = new Map(add.map((q) => [q.id, q])); let fixed = false;
      const merged = existing.map((q) => { const n = fix.get(q.id); if (!n || JSON.stringify([n.stem, n.parts, n.options, n.answer, n.explanation]) === JSON.stringify([q.stem, q.parts, q.options, q.answer, q.explanation])) return q; fixed = true; return { ...q, ...n }; });
      if (fresh.length || fixed) await setQs(b.id, u.id, merged.concat(fresh));
      // a corrected question re-marks the child's last answer: if it's now fully right, that mistake is cleared
      if (fixed) for (const q of merged) { const mk = (local.mistakes || {})[q.id]; if (!mk || mk.done || !fix.has(q.id) || !Array.isArray(mk.ans)) continue;
        const r = localMark(q, mk.ans); if (r && r.parts.every((x) => x.awarded.length)) { mk.done = true; mk.doneAt = Date.now(); mk.cleared = 'corrected'; saveLocal(); } }
    }
    b.units = e.units.map((u) => ({ ...u })); b.pageCount = e.pageCount; b.rev = e.rev; changed = true;
  }
  if (changed) await store.set('books', books);
}
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
// First attempt at each question (from the activity log), kept until the log grows.
let _ft = null, _ftN = -1;
function firstTries() {
  if (_ft && _ftN === local.log.length) return _ft;
  _ft = new Map(); _ftN = local.log.length;
  for (const e of local.log) if (e.q && e.m && e.k !== 'mistakes' && !_ft.has(e.q)) _ft.set(e.q, e.g / e.m);
  return _ft;
}
function testsFor(key) {
  return (local.tests || []).map((t) => ({ t: t.t, r: t.per && t.per[key] })).filter((x) => x.r && x.r[1] >= TEST_MIN_Q).sort((a, b) => a.t - b.t);
}
const LESSON_CREDIT = 10; // readiness for a chapter whose lesson is done, before any practice
function chapterMastery(book, u, qs, text, ntextPre) {
  const T = chapterTarget(u), now = Date.now();
  const key = `${book.id}:${u.id}`;
  const st = (q) => local.stats[q.id];
  const done = qs.filter((q) => st(q));
  // First tries only: a question got right on the third go has been memorised, not learnt.
  const F = firstTries(), ft = (q) => (F.has(q.id) ? F.get(q.id) : st(q).seen === 1 ? st(q).last || 0 : 0);
  const good = (q) => ft(q) >= 0.7;
  // covered: every part of the chapter has a question answered well first time
  const pages = u.startPage && u.endPage ? u.endPage - u.startPage + 1 : 8;
  const parts = Math.max(3, Math.min(6, Math.round(pages / 2)));
  const ntext = ntextPre !== undefined ? ntextPre : (text ? normQ(text) : '');
  const hit = new Set(done.filter(good).map((q) => partOf(q, ntext, parts)).filter((x) => x >= 0));
  const covered = ntext ? hit.size / parts : Math.min(1, done.filter(good).length / T);
  // accurate: first-try scores, over at least T questions
  const firsts = done.map((q) => Math.max(0, Math.min(1, ft(q))));
  const accurate = firsts.length ? (firsts.reduce((a, b) => a + b, 0) / firsts.length) * Math.min(1, firsts.length / T) : 0;
  // deep: right first time at the harder levels (3 "apply", 2 "analyse") and 2 written answers with full marks
  const l3n = done.filter((q) => (q.level || 2) === 3 && good(q)).length, l4n = done.filter((q) => (q.level || 2) >= 4 && good(q)).length;
  const written = done.filter((q) => !choiceType(q) && ft(q) >= 1).length;
  const deep = (Math.min(3, l3n) / 3 + Math.min(2, l4n) / 2 + Math.min(2, written) / 2) / 3;
  // remembered: still right after long gaps. Box 4 = survived the 7-day gap (half credit), box 5 = the 14-day gap (full).
  const memTarget = Math.max(4, Math.min(8, Math.round(T / 2)));
  const b4 = done.filter((q) => (st(q).box || 0) >= 4).length, b5 = done.filter((q) => (st(q).box || 0) >= 5).length;
  const remembered = Math.min(1, (0.5 * b4 + 0.5 * b5) / memTarget);
  // mistakes fixed
  const open = Object.entries(local.mistakes || {}).filter(([id, m]) => !m.done && qUnit(id).join(':') === key).length;
  const fixed = done.length ? Math.max(0, 1 - open / 5) : 0;
  // tested: passes (80%+) at least a week apart; the latest test must be a pass
  const tests = testsFor(key);
  const passes = tests.filter((x) => x.r[0] / x.r[1] >= PASS);
  const passDays = new Set(passes.map((x) => new Date(x.t).toDateString())).size;
  const spread = passes.length >= 2 && passes[passes.length - 1].t - passes[0].t >= 7 * DAY;
  const lastPass = tests.length ? tests[tests.length - 1].r[0] / tests[tests.length - 1].r[1] >= PASS : false;
  let tested = spread ? 1 : passes.length ? 0.5 : 0;
  if (tests.length && !lastPass) tested = Math.min(tested, 0.5);
  const score = { tested, covered, accurate, deep, remembered, fixed };
  let pct = Math.round(AREAS.reduce((t, [k, , w]) => t + w * score[k], 0));
  // ceilings: each one needs real proof, over time
  if (!passes.length) pct = Math.min(pct, 70);            // not proven in a timed test yet
  else if (!spread || !lastPass) pct = Math.min(pct, 85);  // one test, or tests too close together
  if (!b5) pct = Math.min(pct, 95);                         // not yet shown it's remembered after a 2-week gap
  const learnedIt = !!(local.learned || {})[key];
  if (learnedIt) pct = Math.max(pct, LESSON_CREDIT); // a finished lesson is a real first step
  const lvNow = Math.max(1, Math.min(4, 2 + levelShift(book.id, u.id)));
  const lvTop = [4, 3, 2, 1].find((l) => done.some((q) => (q.level || 2) === l && good(q))) || 0;
  return {
    pct, score, target: T, done: done.length, learned: learnedIt, lvNow, lvTop, l3n, l4n, written, b4, b5, spread, passes: passes.length, memTarget, hit: hit.size, firstPass: passes.length ? passes[0].t : 0, lastTest: tests.length ? tests[tests.length - 1].t : 0, nextDue: done.reduce((m, q) => Math.min(m, st(q).due || Infinity), Infinity), parts, uncovered: parts - hit.size,
    more: Math.max(0, T - done.length), needL3: l3n < 3, needL4: l4n < 2, needWritten: Math.max(0, 2 - written),
    due: done.filter((q) => st(q).due <= now).length, open, tests: tests.length, passDays, lastPass,
    weight: u.endPage && u.startPage ? u.endPage - u.startPage + 1 : (u.chars || 30000) / 2500,
  };
}
// Chapter texts, normalised once and kept: matching questions to parts of a chapter needs them.
const ntextMemo = new Map();
function ntextOf(key, text) {
  const m = ntextMemo.get(key);
  if (m && m.len === text.length && m.head === text.slice(0, 200)) return m.n;
  const n = text ? normQ(text) : '';
  ntextMemo.set(key, { len: text.length, head: text.slice(0, 200), n });
  return n;
}
async function bookMastery(book) {
  // Everything for every chapter in one read (big textbooks have hundreds of chapters).
  const [texts, lists] = await Promise.all([
    store.getMany(book.units.map((u) => `text:${book.id}:${u.id}`), ''),
    store.getMany(book.units.map((u) => `qs:${book.id}:${u.id}`), []),
  ]);
  const chapters = book.units.map((u, i) => ({ unit: u, ...chapterMastery(book, u, (lists[i] || []).filter((q) => !blocked(q)), texts[i] || '', ntextOf(`${book.id}:${u.id}`, texts[i] || '')) }));
  const w = chapters.reduce((t, c) => t + c.weight, 0) || 1;
  const raw = chapters.reduce((t, c) => t + c.pct * c.weight, 0) / w, pct = raw > 0 ? Math.max(1, Math.round(raw)) : 0; // started = at least 1%
  const areas = Object.fromEntries(AREAS.map(([k]) => [k, chapters.reduce((t, c) => t + c.score[k] * c.weight, 0) / w]));
  return { pct, chapters, areas };
}
const cleanUnitTitle = (t) => String(t).replace(/\s*\*+\s*$/, '');
// Where space is tight: "Unit 1: Multiplication (2-digit and 3-digit numbers × 2-digit numbers)" → "Unit 1 · Multiplication".
// The full title stays on the chapter's own pages.
function shortTitle(t) {
  let x = cleanUnitTitle(t).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const m = x.match(/^((?:unit|chapter|ch\.?|topic|lesson|module)\s*[\dA-Za-z.]+)\s*[:.\-–]\s*(.+)$/i);
  if (m) x = `${m[1]} · ${m[2]}`;
  if (x.length > 40) { x = x.slice(0, 40); x = x.slice(0, Math.max(x.lastIndexOf(' '), 24)).replace(/[\s,;:·–-]+$/, '') + '…'; }
  return x;
}
// The next-step text mixes our words with a chapter title; translate just our words.
function trStep(t) {
  if (LANG !== 'zh') return t;
  const R = [
    [/^Practise (\d+) more questions? in (.+)$/, (m, n, c) => `在「${c}」再練習 ${n} 條題目`],
    [/^Get more questions right in (.+)$/, (m, c) => `在「${c}」答對更多題目`],
    [/^Practise the parts of (.+) you haven’t covered yet$/, (m, c) => `練習「${c}」中未做過的部分`],
    [/^Get an (analyse|apply) question right in (.+)$/, (m, k, c) => `在「${c}」答對一條${k === 'analyse' ? '分析' : '應用'}題`],
    [/^Get full marks on (\d+) written questions? in (.+)$/, (m, n, c) => `在「${c}」的 ${n} 條文字題取得滿分`],
    [/^Fix (\d+) mistakes? in (.+)$/, (m, n, c) => `改正「${c}」的 ${n} 條錯題`],
    [/^Review (\d+) questions? in (.+)$/, (m, n, c) => `溫習「${c}」的 ${n} 條題目`],
    [/^Come back for reviews over the next few days to prove you remember (.+)$/, (m, c) => `未來幾日回來溫習，證明你記得「${c}」`],
    [/^Pass a chapter test on (.+) \(80% or more\)$/, (m, c) => `通過「${c}」的章節測驗（80% 或以上）`],
    [/^Pass another chapter test on (.+) on a different day$/, (m, c) => `在另一日再通過「${c}」的章節測驗`],
  ];
  for (const [re, f] of R) if (re.test(t)) return t.replace(re, f);
  return t;
}
function masteryLabel(p) {
  return p >= 100 ? 'Mastered' : p >= 85 ? 'Exam ready' : p >= 70 ? 'Well versed' : p >= 50 ? 'Getting there' : p >= 25 ? 'Building up' : p > 0 ? 'Just started' : 'Not started';
}
// Summaries, key terms, glossaries and end-of-chapter question lists aren't worth suggesting as practice.
const NOT_TEACHING = /^\s*(chapter\s+\d*\s*)?(chapter summary|summary|key terms|key concepts and summary|glossary|review questions|critical thinking questions|visual connection questions|test prep( for ap® courses)?|science practice challenge questions|index|references|answer key|answers|further reading|bibliography)\s*[*:.]*\s*$|^\s*(總結|詞彙|詞彙表|練習|答案|重點)\s*$/i;
// The chapter "Get me closer to 100%" works on: the weakest one that's worth practising.
function weakestChapter(m) {
  const left = m.chapters.filter((c) => c.pct < 100);
  const real = left.filter((c) => !NOT_TEACHING.test(String(c.unit.title)));
  return (real.length ? real : left).sort((a, b) => a.pct - b.pct)[0] || null;
}
// The next things to do, from the weakest areas of the weakest chapters.
function masterySteps(m) {
  const steps = [];
  const left = m.chapters.filter((c) => c.pct < 100), real = left.filter((c) => !NOT_TEACHING.test(String(c.unit.title)));
  const weak = (real.length ? real : left).sort((a, b) => a.pct - b.pct);
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
      else if (!c.spread || !c.lastPass) opts.push([0.9, `Pass another chapter test on ${t} on a different day`, 'test']);
    }
    opts.sort((a, b) => b[0] - a[0]);
    if (opts[0]) steps.push({ unit: c.unit, text: opts[0][1], kind: opts[0][2] });
  }
  return steps;
}
function masteryCard(m) {
  // Only the next step: it's what the button does, so it's written on the button.
  const w = weakestChapter(m);
  const steps = w ? masterySteps({ ...m, chapters: [w] }) : [];
  const p = m.pct;
  return `<section class="mastery" aria-label="Mastery">
    <div class="m-top"><div class="ring ${p >= 85 ? 'good' : p >= 50 ? 'mid' : ''}" style="--p:${p}" role="img" aria-label="${p}% mastered"><span>${p}%</span></div>
      <div class="m-text"><b>${masteryLabel(p)}</b><span>${p >= 100 ? 'Proven in tests and remembered. Keep up your reviews.' : p ? `${100 - p}% to go. The button below works on your weakest spot.` : 'Practise a chapter to see how ready you are.'}</span></div></div>
    <details class="areas"><summary>${LANG === 'zh' ? '由甚麼組成' : 'What it’s made of'}</summary>${AREAS.map(([k, label]) => { const v = Math.round(100 * m.areas[k]); return `<div class="area"><span>${label}</span><span class="abar"><i style="width:${v}%" class="${v >= 85 ? 'good' : v >= 50 ? 'mid' : ''}"></i></span><b>${v}%</b></div>`; }).join('')}
      <p class="hint" style="margin:6px 0 0">${LANG === 'zh' ? '最高分要經過一段時間證明：通過測驗、之後再證明一次，並且仍然記得。' : 'The top scores take proof over time: passing tests, proving it again later, and still remembering it.'}</p></details>
    ${p > 0 && p < 100 ? `<button class="btn boost" id="boost"><b>${ICON.target} ${p ? 'Get me closer to 100%' : 'Get started'}</b>${steps[0] ? `<small data-raw>${esc(p ? `${LANG === 'zh' ? '下一步：' : 'Next: '}${trStep(steps[0].text)}` : `${LANG === 'zh' ? '由這章開始：' : 'Begins with '}${cleanUnitTitle(steps[0].unit.title)}`)}</small>` : ''}</button>` : ''}
  </section>`;
}
// "Get me closer to 100%": works on the weakest chapter's weakest area.
async function boostSession(book) {
  const m = await bookMastery(book);
  const c = weakestChapter(m);
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
// Lets the student (or a parent) change the suggested time, or take the test with no time limit.
// Resolves to minutes (0 = no limit), or null if cancelled.
function askTime(title, detail, suggested) {
  return new Promise((resolve) => {
    let mins = suggested, none = false;
    const box = document.createElement('div');
    box.className = 'cdlg-wrap';
    const draw = () => {
      box.innerHTML = `<div class="cdlg rdlg" role="dialog" aria-modal="true" aria-labelledby="tm-t">
        <b id="tm-t">${esc(title)}</b><span>${esc(detail)}</span>
        <div class="setup-row" style="margin-top:6px"><span id="tm-l">Time allowed</span>
          <div class="stepper" role="group" aria-labelledby="tm-l"><button id="tm-m" aria-label="Less time" ${none || mins <= 5 ? 'disabled' : ''}>−</button><output>${none ? '—' : mins + ' min'}</output><button id="tm-p" aria-label="More time" ${none || mins >= 180 ? 'disabled' : ''}>+</button></div></div>
        <span class="hint">${none ? 'No timer. Good for learning, but it won’t feel like the real exam.' : mins === suggested ? 'Suggested time, at about exam pace.' : `Suggested: ${suggested} min.`}</span>
        <label class="tm-none"><input type="checkbox" id="tm-n" ${none ? 'checked' : ''}> No time limit</label>
        <div class="rd-row"><button class="btn ghost" id="tm-c">Cancel</button><button class="btn" id="tm-s">Start</button></div></div>`;
      box.querySelector('#tm-m').onclick = () => { mins = Math.max(5, mins - 5); draw(); };
      box.querySelector('#tm-p').onclick = () => { mins = Math.min(180, mins + 5); draw(); };
      box.querySelector('#tm-n').onchange = (e) => { none = e.target.checked; draw(); };
      box.querySelector('#tm-c').onclick = () => { box.remove(); resolve(null); };
      box.querySelector('#tm-s').onclick = () => { box.remove(); resolve(none ? 0 : mins); };
      box.querySelector('#tm-s').focus();
    };
    box.onclick = (e) => { if (e.target === box) { box.remove(); resolve(null); } };
    draw(); document.body.appendChild(box);
  });
}

async function startChapterTest(book, units) {
  if (!allow('test')) return;
  track('chapter_test');
  const nA = Math.min(16, 6 + 2 * units.length), nB = Math.min(4, 1 + units.length);
  const mins = await askTime(LANG === 'zh' ? '章節測驗' : 'Chapter test', `${nA} multiple-choice and ${nB} written questions. Pass mark 80%.`, paperMinutes(nA, nB));
  if (mins === null) return;
  try {
    const paper = await preparePaper(book, units, nA, nB, 'sit');
    if (!paper) return;
    startDse(book, paper, mins); meter('test');
    S.title = units.length === 1 ? `${LANG === 'zh' ? '章節測驗' : 'Chapter test'} · ${units[0].title}` : (LANG === 'zh' ? '章節測驗' : 'Chapter test');
    S.test = true;
    toast(mins ? `${mins} min · pass mark 80%` : 'No time limit · pass mark 80%');
  } catch (e) {
    toast(e.status === 0 ? 'You seem to be offline.' : (e.message || 'Could not prepare the test.'));
    go({ name: 'book', bookId: book.id });
  }
}

const QCTX = new Map(); // question id -> its book and chapter, for showing where a question came from
async function allQuestions() {
  const out = [];
  for (const b of await getBooks()) for (const u of b.units) {
    (await getQs(b.id, u.id)).forEach((q) => { out.push({ q, book: b, unit: u }); QCTX.set(q.id, { book: b, unit: u }); });
  }
  return out;
}

/* ---------- server ---------- */
// At most this many AI requests at once from this device, so papers don't hit the API's rate limit.
const MAX_INFLIGHT = 12;
let inflight = 0; const waiting = [];
async function slot() { if (inflight < MAX_INFLIGHT) { inflight++; return; } await new Promise((r) => waiting.push(r)); inflight++; }
function release() { inflight--; const n = waiting.shift(); if (n) n(); }
const AI_TRACK = (path, body) => (['generate', 'verify', 'warm', 'snippets', 'chapters'].includes(path) ? null : `ai:${path}${body && body.step ? ':' + body.step : ''}${path === 'learn' && body && body.ask === undefined ? ':lesson' : ''}`);
async function api(path, body) {
  if (TOURING) { const e = new Error('Paused during the tour.'); e.status = 503; e.tour = true; throw e; } // the tour never calls the AI
  const f = gateApi(path, body);
  track(AI_TRACK(path, body));
  await slot();
  try { const r = await apiOnce(path, body); if (f) meter(f); return r; } finally { release(); }
}
// Like api(), but the reply streams in: onChunk(words) is called as they are written. Returns the final result.
async function apiStream(path, body, onChunk) {
  if (TOURING) { const e = new Error('Paused during the tour.'); e.status = 503; e.tour = true; throw e; }
  const f = gateApi(path, body);
  track(AI_TRACK(path, body));
  const out = await apiStreamOnce(path, body, onChunk);
  if (f) meter(f);
  return out;
}
async function apiStreamOnce(path, body, onChunk) {
  let r;
  try {
    r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': local.code || '' }, body: JSON.stringify({ ...withProfile(body), stream: true }) });
  } catch (e) { const err = new Error('No internet connection.'); err.status = 0; throw err; }
  if (!r.ok || !/ndjson/.test(r.headers.get('content-type') || '') || !r.body) {
    let data = {}; try { data = await r.json(); } catch (e) {}
    if (data.usage) recordUsage(path, data.usage);
    if (!r.ok) { const e = new Error(data.error || `Server error ${r.status}`); e.status = r.status; if (r.status !== 401 && r.status !== 402) noteError(`${path}: ${e.message}`); throw e; }
    return data;
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      if (m.d) onChunk(m.d);
      else if (m.error) { const e = new Error(m.error); e.status = 502; throw e; }
      else if (m.done) done = m;
    }
    if (end) break;
  }
  if (!done) { const e = new Error('The reply was cut off.'); e.status = 502; throw e; }
  if (done.usage) recordUsage(path, done.usage);
  return done;
}
// Every AI request carries the student profile (grade etc.), when a parent has set one.
const withProfile = (body) => { if (!body || typeof body !== 'object') return body; const l = learnerPayload(); return { ...body, ...(l && !body.learner ? { learner: l } : {}), ...(LANG === 'fr' || LANG === 'ja' ? { ui: LANG } : {}) }; };
async function apiOnce(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': local.code || '' },
      body: JSON.stringify(withProfile(body)),
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
/* ---------- test-day forecast ----------
   Works from the first day: how often this child usually practises, and what Buddy's plan for the
   test chapters adds per practice day (lesson first, then practice sets, then the chapter test). */
function practiceHabit() {
  const t0 = startOfToday(), days = new Set();
  let first = Infinity;
  for (const e of local.log || []) if (e.t) { first = Math.min(first, e.t); if (e.t > t0 - 13 * DAY) days.add(new Date(e.t).setHours(0, 0, 0, 0)); }
  if (first === Infinity) return 0.6; // nothing yet: assume most days
  const span = Math.min(14, Math.max(1, Math.round((t0 - new Date(first).setHours(0, 0, 0, 0)) / DAY) + 1));
  return Math.max(0.3, Math.min(1, days.size / span));
}
const SET_GAIN = 15, SET_MIN = 10, MAX_SETS_DAY = 4; // one practice set: about 10 minutes
const planCap = (left) => (left >= 14 ? 95 : left >= 7 ? 90 : left >= 3 ? 85 : 70); // the top scores need a passed chapter test and proof it's remembered over time
// add practice sets, weakest chapter first; returns the new average
function planAvg(pcts, sets, cap) {
  const pc = pcts.slice();
  for (let k = 0; k < sets; k++) { let i = -1; pc.forEach((v, j) => { if (v < cap && (i < 0 || v < pc[i])) i = j; }); if (i < 0) break; pc[i] = Math.min(cap, pc[i] + SET_GAIN); }
  return pc.reduce((a, b) => a + b, 0) / pc.length;
}
function planForecast(ready, chs, left, habit = practiceHabit()) {
  if (ready == null || !chs || !chs.length || left < 1) return ready;
  const pcts = chs.map((c) => c.pct || 0), before = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const after = planAvg(pcts, Math.round(Math.max(1, left) * habit * 2), planCap(left));
  return Math.min(100, Math.max(ready, Math.round(ready + after - before)));
}
// what it takes to reach a goal: practice sets in total, the most that's reachable, and where to start
function planNeeds(ready, pcts, left, aim) {
  const before = pcts.reduce((a, b) => a + b, 0) / Math.max(1, pcts.length), at = (n) => Math.round(ready + planAvg(pcts, n, 100) - before);
  let sets = 0; while (at(sets) < aim && sets < 400) sets++;
  return { sets };
}
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

/* ---------- navigation: the phone's Back gesture and the browser's Back button work everywhere ----------
   Every screen change is a history entry. Back closes an open dialog or the Buddy panel first; during practice
   it asks before leaving, like the Back button on screen. A screen's own back button goes to the screen you
   came from (a real step back), so the two never disagree. */
let navStack = [], navPopping = false, navCur = null;
const navKey = (v) => JSON.stringify(v || {});
// Each screen has its own address (#/book?bookId=…), so a refresh, a bookmark or a shared link opens the same screen.
const URL_OK = ['about', 'chapters', 'practice', 'privacy', 'listening', 'home', 'books', 'book', 'library', 'usage', 'settings', 'progress', 'stars', 'homework', 'dictation', 'writing', 'speaking', 'plans', 'learn', 'paper', 'pick', 'worksheets', 'notes', 'edit', 'mistakes', 'cards'];
function viewUrl(v) {
  if (!v || !URL_OK.includes(v.name)) return '#/' + (v && v.name === 'parent' ? 'progress' : 'home');
  const q = new URLSearchParams();
  Object.entries(v).forEach(([k, x]) => { if (k !== 'name' && x !== undefined && x !== null && x !== '' && typeof x !== 'object') q.set(k, String(x)); });
  const qs = q.toString();
  return `#/${v.name}${qs ? '?' + qs : ''}`;
}
function urlView() {
  const m = location.hash.match(/^#\/([a-z]+)(?:\?(.*))?$/);
  if (!m || !URL_OK.includes(m[1])) return null;
  const v = { name: m[1] };
  new URLSearchParams(m[2] || '').forEach((x, k) => { v[k] = /^(qi|only)$/.test(k) && /^\d+$/.test(x) ? +x : x; });
  return v;
}
function navSet(state, push) { navCur = state; try { history[push ? 'pushState' : 'replaceState'](state, '', state.session ? location.hash || '#/' : viewUrl(state.v)); } catch (e) {} }
function navPush(v) {
  if (navPopping) return;
  const st = history.state;
  if (!navStack.length) { navStack = [v]; return navSet({ v, d: 0 }, false); }
  if (st && st.session) { navStack[navStack.length - 1] = v; return navSet({ v, d: navStack.length - 1 }, false); } // leaving practice: replace it
  if (navKey(navStack[navStack.length - 1]) === navKey(v)) return navSet({ v, d: navStack.length - 1 }, false);
  navStack.push(v); navSet({ v, d: navStack.length - 1 }, true);
}
// Practice screens (questions, the waiting page) get their own entry, so Back asks before leaving them.
function navSession() { if (!(history.state && history.state.session)) navSet({ session: 1, v: view, d: navStack.length - 1 }, true); }
function goBack(fallback) {
  if (navStack.length > 1) { try { history.back(); return; } catch (e) {} }
  go(fallback || { name: 'home' });
}
// The Back button names the screen it returns to: the one they came from, or the fallback when opened from a link.
const VIEW_NAME = { home: ['Today', '今日'], practice: ['Practice', '練習'], books: ['Books', '課本'], book: ['Book', '課本'], mistakes: ['Mistakes', '錯題'], progress: ['Progress', '進度'], settings: ['Settings', '設定'], library: ['Library', '課本庫'], stars: ['Star shop', '星星商店'], parent: ['Parent', '家長'] };
const backName = (fb, label) => { const prev = navStack.length > 1 ? navStack[navStack.length - 2] : fb; const nm = prev && VIEW_NAME[prev.name]; return nm ? nm[LANG === 'zh' ? 1 : 0] : label === 'Back' ? (LANG === 'zh' ? '返回' : 'Back') : label; };
const backTop = (fb, label) => `<div class="topbar pagetop"><button class="backbtn" data-goback='${esc(JSON.stringify(fb))}'>${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button></div>`;
// On a page with a title, the Back button sits on the title's line, on the right, so the title stays at the top like on the main tabs.
function dockBack() {
  const bar = $app.querySelector(':scope .pagetop'), btn = bar && bar.querySelector('.backbtn'), h = $app.querySelector('.pagetitle');
  if (!btn || !h || h.closest('.pt-row') || h.parentElement !== bar.parentElement && h.parentElement !== bar.nextElementSibling) return;
  const row = document.createElement('div'); row.className = 'pt-row'; h.replaceWith(row); row.append(h, btn); bar.remove();
}
new MutationObserver(() => { if ($app.querySelector('.pagetop .backbtn') && $app.querySelector('.pagetitle')) dockBack(); }).observe($app, { childList: true });
document.addEventListener('input', (e) => { const w = e.target.closest && e.target.closest('.cdlg-wrap'); if (w) w.dataset.dirty = '1'; }, true);
document.addEventListener('click', (e) => {
  const w = e.target;
  if (w && w.classList && w.classList.contains('cdlg-wrap') && w.dataset.dirty) {
    e.stopPropagation(); e.preventDefault();
    const d = w.firstElementChild; if (d) { d.classList.remove('nudge'); void d.offsetWidth; d.classList.add('nudge'); }
    toast(LANG === 'zh' ? '你已輸入資料：請按「取消」或「儲存」。' : 'You’ve typed something here: tap Cancel or Save to close.');
  }
}, true);
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-goback]'); if (b) { e.preventDefault(); goBack(JSON.parse(b.dataset.goback)); } });
let navLeaving = false; // go() stepping back in history after the student already confirmed leaving: don't ask again
window.addEventListener('popstate', (e) => {
  const leaving = navLeaving; navLeaving = false;
  if (document.querySelector('main.pilotgate')) { try { history.pushState(history.state, '', location.href); } catch (er) {} return; } // the code and consent screens can't be skipped with Back
  const was = navCur;
  const dlg = [...document.querySelectorAll('.cdlg-wrap')].pop();
  if (dlg) { if (was) navSet(was, true); dlg.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
  if (helper.open) { if (was) navSet(was, true); helperClose(); return; }
  const q = inSession();
  if (q && !leaving && !(e.state && e.state.session)) { if (was) navSet(was, true); q.click(); return; }
  const st = e.state && e.state.v ? e.state : { v: urlView() || { name: 'home' }, d: navStack.length }; // typed or pasted address: open it
  navCur = st;
  navStack = navStack.slice(0, st.d || 0); navStack[st.d || 0] = st.v;
  navPopping = true;
  try { go(st.v); } finally { navPopping = false; }
});

// backTo: the screen a lesson / notes / flashcards was opened from (Practice → Lessons), so Back returns there.
let backTo = null;
async function go(v) {
  if (!['learn', 'notes', 'cards'].includes(v.name)) backTo = null;
  try { if (window.speechSynthesis && VC.state === 'off') speechSynthesis.cancel(); } catch (e) {}
  try { if (ttsEl) { ttsSeq++; ttsEl.onended = null; ttsEl.pause(); } sayPill(null); } catch (e) {}
  if ((v.name === 'paper' || (v.name === 'pick' && v.mode === 'mock')) && !allow('mock')) return; // plan checks before leaving the screen
  { const f = { homework: 'homework', writing: 'writing', speaking: 'speaking', stars: 'stars' }[v.name]; if (f && locked(f) && !TOURING) return upsell(f, 'locked'); }
  // a screen's back button pointing at the screen we came from = a real step back
  if (!navPopping && navStack.length >= 2 && navKey(navStack[navStack.length - 2]) === navKey(v) && !(history.state && history.state.session)) { try { navLeaving = true; history.back(); return; } catch (e) { navLeaving = false; } }
  navPush(v);
  view = v;
  track('screen:' + v.name);
  getBooks().then((bs) => { bs.forEach((b) => { bookKinds.set(b.id, kindOfBook(b)); aliases.set(b.id, b.alias || {}); }); const pr = bs.some(looksPrimary); if (pr !== primaryCache) { primaryCache = pr; renderTabs(); } });
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  stopTimer();
  if (v.name === 'home') return renderHome();
  if (v.name === 'practice') return renderPractice();
  if (v.name === 'books') return renderBooks();
  if (v.name === 'book') { bookFocus = v.focus || null; bookTool = ['notes', 'cards'].includes(v.focus) ? { bookId: v.bookId, tool: v.focus } : null; return renderBook(v.bookId); }
  if (v.name === 'library') return renderLibrary(v.query || '');
  if (v.name === 'usage') return renderUsage();
  if (v.name === 'about') return renderAbout();
  if (v.name === 'privacy') return renderPrivacy();
  if (v.name === 'settings') return renderSettings(v.sec);
  if (v.name === 'progress') return renderProgress();
  if (v.name === 'stars') return renderStars();
  if (v.name === 'homework') return renderHomework(v.id);
  if (v.name === 'dictation') return renderDictation(v.id, v.sub);
  if (v.name === 'writing') return renderWriting(v.id, v.sub);
  if (v.name === 'speaking') return renderSpeaking(v.id, v.sub, v.qi);
  if (v.name === 'listening') return renderListening();
  if (v.name === 'plans') return renderPlans(v.hi);
  if (v.name === 'parent') return renderParent();
  if (v.name === 'learn') return renderLearn(v.bookId, v.unitId);
  if (v.name === 'paper') return renderPaper(v.bookId, v.from);
  if (v.name === 'pick') return renderPick(v.mode);
  if (v.name === 'worksheets') return renderWorksheets();
  if (v.name === 'notes') return renderNotes(v.bookId);
  if (v.name === 'edit') return renderEdit(v.bookId);
  if (v.name === 'mistakes') return renderMistakes(v.tab || 'todo', v.book);
  if (v.name === 'chapters') return renderChapters(['learn', 'notes', 'cards'].includes(v.mode) ? v.mode : 'practise');
  if (v.name === 'cards') return renderCards(v.bookId, v.only);
}

/* ---------- home ---------- */
// Book colours: one per subject (used on the book page and in lists).
function coverColour(b) { return subjectColour(b.subject, b.title); }
async function bookSummary(b) {
  const qs = (await store.getMany(b.units.map((u) => `qs:${b.id}:${u.id}`), [])).flat().filter((q) => q && !blocked(q));
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
/* ---------- voice chat: one tap, then just talk (browser speech, free) ---------- */
// Only one voice chat runs at a time: on the Today coach, or the tutor on a question.
const VC = { where: null, key: null, ctrl: null, state: 'off', heard: '', saying: '', lang: 'en', notice: null };
const VL = (en, zh) => (LANG === 'zh' ? zh : en);
const voiceOn = (where, key) => VC.where === where && (key === undefined || VC.key === key);
function voiceNoticeHTML(where) { return VC.notice && VC.notice.where === where ? `<p class="hint" style="margin:0;color:var(--text-2)" data-raw>${esc(VC.notice.text)}</p>` : ''; }
// Full-screen voice mode: a living orb in the middle, like talking to someone. Captions are off unless asked for.
const VSTATE_BIG = () => ({ listening: VL('Listening', '聆聽中'), thinking: VL('Thinking', '諗緊'), speaking: VL('Speaking', '講緊') }[VC.state] || '');
const VHINT = () => ({ listening: VL('Just talk. Pause when you’re done.', '直接講，講完停一停就得。'), thinking: '', speaking: VL('Talk any time to interrupt', '你隨時開口都可以打斷') }[VC.state] || '');
// Voice mode lives inside the chat box: a living orb instead of the messages. Captions only if CC is on.
// The voice-chat language button: switches between the chapter's own language and English.
const VC_NAME = { yue: '廣東話', en: 'English', fr: 'Français', ja: '日本語' };
function voicePanelHTML() {
  return `<div class="vpanel" id="vov" data-state="${VC.state}" data-raw tabindex="-1">
    <div class="vorbbox"><canvas id="vovOrb" aria-hidden="true"></canvas><svg class="vbuddy" id="vovBuddy" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${buddyFace('listen')}</svg></div>
    <div class="vov-state" id="vovState" aria-live="polite">${VSTATE_BIG()}</div>
    <div class="vov-hint" id="vovHint">${VHINT()}</div>
    <div class="vov-cap" id="vovCap"></div>
    <div class="vov-ctrls">
      <button class="vov-cc ${local.voiceCC ? 'on' : ''}" id="vovCC" aria-pressed="${local.voiceCC ? 'true' : 'false'}" title="${VL('Show what’s being said', '顯示字幕')}">CC</button>
      <button class="vov-lang" id="vovLang">${VC_NAME[VC.lang] || 'English'}</button>
      <button class="vov-end" id="vovEnd" aria-label="${VL('End voice chat', '結束語音對話')}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div></div>`;
}
function animateOrb(cv) {
  if (!cv || cv.dataset.on) return; cv.dataset.on = '1';
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scale = 1, amp = 0.03, hue = 0, t0 = performance.now();
  const COL = { listening: ['#A9B8FF', '#4A5FD0', '#26357A'], speaking: ['#C4CFFF', '#5B72F0', '#2B3C96'], thinking: ['#D7DCF0', '#8A93B8', '#4A5373'] };
  const frame = (now) => {
    if (!cv.isConnected) return;
    const t = (now - t0) / 1000, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const lv = VC.ctrl ? VC.ctrl.level() : { mic: 0, speak: 0 };
    const st = VC.state === 'thinking' || VC.state === 'speaking' ? VC.state : 'listening';
    const breathe = 0.025 * Math.sin(t * 1.6);
    const tScale = st === 'listening' ? 1 + breathe + lv.mic * 0.32 : st === 'speaking' ? 1.04 + lv.speak * 0.14 : 0.86 + 0.02 * Math.sin(t * 4);
    const tAmp = st === 'listening' ? 0.025 + lv.mic * 0.12 : st === 'speaking' ? 0.035 + lv.speak * 0.07 : 0.015;
    scale += (tScale - scale) * 0.18; amp += (tAmp - amp) * 0.12;
    hue += st === 'thinking' ? 0.05 : 0.008;
    const R = Math.min(W, H) * 0.3 * scale, cx = W / 2, cy = H / 2;
    // Buddy sits in the middle of the glow: listening, thinking, or talking (mouth opens on the words).
    const bd = cv.parentNode && cv.parentNode.querySelector('.vbuddy');
    if (bd) {
      const face = st === 'thinking' ? 'think' : st === 'speaking' ? (lv.speak > 0.62 ? 'listen' : 'happy') : 'listen';
      if (bd.dataset.face !== face) { bd.dataset.face = face; bd.innerHTML = buddyFace(face); }
      const size = R * 1.25;
      bd.style.width = bd.style.height = size + 'px';
      bd.style.transform = `translate(-50%, -50%) rotate(${st === 'speaking' && !reduce ? Math.sin(t * 6) * 3 : 0}deg)`;
    }
    const [c1, c2, c3] = COL[st];
    // soft halo
    const HR = Math.min(R * 1.9, Math.min(W, H) / 2 - 2);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, HR);
    halo.addColorStop(0, st === 'thinking' ? 'rgba(160,170,210,.28)' : 'rgba(110,135,255,.38)'); halo.addColorStop(1, 'rgba(110,135,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, HR, 0, Math.PI * 2); ctx.fill();
    // the blob
    const tt = reduce ? 0 : t;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const w = Math.sin(3 * a + tt * 1.3) * 0.5 + Math.sin(5 * a - tt * 1.9) * 0.3 + Math.sin(2 * a + tt * 0.8) * 0.2;
      const r = R * (1 + amp * w);
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const hx = cx + Math.cos(hue * Math.PI * 2 - 2.3) * R * 0.38, hy = cy + Math.sin(hue * Math.PI * 2 - 2.3) * R * 0.38;
    const g = ctx.createRadialGradient(hx, hy, R * 0.05, cx, cy, R * 1.05);
    g.addColorStop(0, c1); g.addColorStop(0.55, c2); g.addColorStop(1, c3);
    ctx.fillStyle = g; ctx.fill();
    // a light inner ripple while the tutor talks
    if (st === 'speaking') {
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + lv.speak * 0.25})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.55 + lv.speak * 0.2), 0, Math.PI * 2); ctx.stroke();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function paintVoice() {
  const ov = document.getElementById('vov');
  if (ov) {
    ov.dataset.state = VC.state;
    document.getElementById('vovState').textContent = VSTATE_BIG();
    document.getElementById('vovHint').textContent = VHINT();
    document.getElementById('vovLang').textContent = VC_NAME[VC.lang] || 'English';
    const cap = document.getElementById('vovCap');
    cap.textContent = local.voiceCC ? (VC.state === 'speaking' ? VC.saying : VC.state === 'listening' ? VC.heard : '') : '';
    cap.className = `vov-cap ${VC.state === 'speaking' ? 'ai' : ''}`;
  }
}
function bindVoiceBar() {
  const el = document.getElementById('vov'); if (!el) return;
  el.querySelector('#vovEnd').onclick = () => VC.ctrl && VC.ctrl.stop();
  el.querySelector('#vovLang').onclick = () => VC.ctrl && VC.ctrl.setLang(VC.lang === 'en' ? VC.home || 'yue' : 'en');
  el.querySelector('#vovCC').onclick = (e) => { local.voiceCC = !local.voiceCC; saveLocal(); e.currentTarget.classList.toggle('on', local.voiceCC); e.currentTarget.setAttribute('aria-pressed', String(!!local.voiceCC)); paintVoice(); };
  el.onkeydown = (e) => { if (e.key === 'Escape' && VC.ctrl) VC.ctrl.stop(); };
  animateOrb(el.querySelector('#vovOrb'));
  paintVoice();
}
// where: 'coach' | 'tutor'; send(text, voiceLang) -> reply text; redraw() redraws that chat.
function startVoiceChat({ where, key, lang, send, alive, redraw, title }) {
  if (!allow('voice')) return;
  if (VC.ctrl) VC.ctrl.stop();
  VC.notice = null;
  if (!voiceSupported()) { VC.notice = { where, text: VL('Voice chat works in Chrome, Edge or Safari. This browser can’t listen yet, so please type instead.', '語音對話要用 Chrome、Edge 或 Safari。呢個瀏覽器聽唔到聲，請打字。') }; return redraw(); }
  Object.assign(VC, { where, key, state: 'listening', heard: '', saying: '', lang, home: lang === 'en' ? 'yue' : lang });
  VC.ctrl = startVoice({
    lang, alive,
    send: (text, onChunk) => send(text, VC.lang, onChunk),
    onUpdate: (u) => {
      const ended = u.state === 'off' && VC.where === where;
      Object.assign(VC, { state: u.state, heard: u.heard, saying: u.saying || '', lang: u.lang });
      if (!ended) return paintVoice();
      VC.where = null; VC.key = null; VC.ctrl = null;
      if (u.error) VC.notice = { where, text: u.error === 'idle' ? VL('Voice chat stopped after 2 minutes of quiet. Tap Talk to start again.', '靜咗兩分鐘，語音對話停咗。撳「傾偈」再開始。') : u.error };
      redraw();
    },
  });
  redraw();
}

/* ---------- study coach (Today screen) ---------- */
// A text snapshot of the student's progress, made on the device and sent with each question.
// Codes like B1 / B1.C3 let the coach say which book or chapter to open; coachIndex turns them back into ids.
let coachIndex = {};
async function coachSnapshot() {
  const books = await getBooks(); const r = await currentReport();
  coachIndex = {};
  const pc = (x) => Math.round(100 * x);
  const lines = [`Today: ${new Date().toDateString()}.`, // the child's name is never sent to the AI
    `Last 7 days: practised on ${r.dp} of 7 days, ${r.q} questions answered, ${r.a === null ? 'no score yet' : r.a + '% of marks'}${r.pa !== null && r.a !== null ? ` (previous week ${r.pa}%)` : ''}.`,
    `Thinking skills, last 30 days (% of marks, answers): ${['Recall', 'Understand', 'Apply', 'Analyse/evaluate'].map((n, i) => `${n} ${r.sk[i][1] ? r.sk[i][0] + '%' : '-'} (${r.sk[i][1]})`).join(', ')}.`,
    `Mistake book: ${mistakeCount()} questions still to get right. Reviews due now: ${(await dueItems()).length}.`];
  for (const [bi, b] of books.entries()) {
    const m = await bookMastery(b);
    const bc = `B${bi + 1}`; coachIndex[bc] = { bookId: b.id };
    const code = (u) => { const cc = `${bc}.C${b.units.indexOf(u) + 1}`; coachIndex[cc] = { bookId: b.id, unitId: u.id }; return cc; };
    lines.push('', `BOOK [${bc}]: ${b.title}${b.subject ? ` (${b.subject})` : ''} — mastery ${m.pct}% (${masteryLabel(m.pct)}). Areas: ${AREAS.map(([k, label]) => `${label} ${pc(m.areas[k])}%`).join(', ')}.`);
    const started = m.chapters.filter((c) => c.done || c.tests);
    for (const c of started.slice(0, 40)) {
      const acc = c.done ? pc(c.score.accurate / Math.max(0.01, Math.min(1, c.done / c.target))) : 0;
      lines.push(`- [${code(c.unit)}] ${c.unit.title}: mastery ${c.pct}%, ${c.done} questions answered (target ${c.target}), latest accuracy ${acc}%, mistakes open ${c.open}, reviews due ${c.due}, chapter tests taken ${c.tests}, passed on ${c.passDays} day(s)${c.uncovered ? `, ${c.uncovered} part(s) of the chapter not covered yet` : ''}.`);
    }
    const fresh = m.chapters.filter((c) => !c.done && !c.tests).map((c) => `[${code(c.unit)}] ${c.unit.title}`);
    if (fresh.length) lines.push(`- Not started yet (${fresh.length}): ${fresh.slice(0, 40).join('; ')}${fresh.length > 40 ? '; …' : ''}`);
  }
  if (!books.length) lines.push('', 'No textbooks added yet.');
  const up = upcomingTests();
  if (up.length) {
    lines.push('', 'SCHOOL TESTS coming up (plan around these first):');
    for (const x of up) { const b = books.find((y) => y.id === x.b); const bi = books.indexOf(b);
      if (x.kind === 'dict') { const L = (local.dict || []).find((d) => d.id === x.L); lines.push(`- ${x.name} (dictation) on ${x.date} (${testLeft(x)} day(s) away)${L ? `, word list "${L.title}"${(L.runs || []).length ? `, last score ${L.runs[L.runs.length - 1].g}/${L.runs[L.runs.length - 1].n}` : ', not practised yet'}` : ', words not added yet'}.`); continue; }
      if (!b) { lines.push(`- ${x.name} on ${x.date} (${testLeft(x)} day(s) away): ${tSubjName(x.subj) || 'a subject'} with no textbook in the app yet.`); continue; }
      if (!(x.u || []).length) { lines.push(`- ${x.name} on ${x.date} (${testLeft(x)} day(s) away): ${b.title}, everything practised so far.`); continue; }
      lines.push(`- ${x.name} on ${x.date} (${testLeft(x)} day(s) away): ${b.title}, chapters ${x.u.map((id) => { const u = b.units.find((v) => v.id === id); return u ? `[B${bi + 1}.C${b.units.indexOf(u) + 1}] ${u.title}` : ''; }).filter(Boolean).join('; ')}.`); }
  }
  const done = schoolTests().filter((x) => typeof x.score === 'number').slice(-5);
  if (done.length) lines.push('', `Recent school test results: ${done.map((x) => `${x.name} (${x.date}) ${x.score}%`).join('; ')}.`);
  return lines.join('\n');
}
// Carry out what the coach decided to open (it only does this after the student agrees, or asks).
async function runCoachAction(a) {
  if (!a || !a.action) return;
  helperClose();
  const books = await getBooks();
  const chs = (Array.isArray(a.chapters) ? a.chapters : []).map((c) => coachIndex[String(c).trim()]).filter((x) => x && x.unitId);
  const bookId = (chs[0] && chs[0].bookId) || (coachIndex[String(a.book || '').trim()] || {}).bookId || (books.length === 1 ? books[0].id : null);
  const book = books.find((b) => b.id === bookId);
  const units = book ? book.units.filter((u) => chs.some((c) => c.bookId === book.id && c.unitId === u.id)) : [];
  if (book && units.length) pick = { bookId: book.id, ids: new Set(units.map((u) => u.id)) };
  switch (a.action) {
    case 'practise': if (book && units.length) return startUnits(book, units, Math.min(30, Math.max(5, Number(a.count) || sessionSize()))); break;
    case 'chapter_test': if (book && units.length) return startChapterTest(book, units); break;
    case 'review': return startReview('spaced');
    case 'mistakes': return go({ name: 'mistakes' });
    case 'weak_topics': return book ? startReview('weak', book.id) : go({ name: 'pick', mode: 'weak' });
    case 'mock_paper': return book ? go({ name: 'paper', bookId: book.id, from: 'home' }) : go({ name: 'pick', mode: 'mock' });
    case 'notes': if (book) return go({ name: 'notes', bookId: book.id }); break;
    case 'flashcards': if (book) return go({ name: 'cards', bookId: book.id }); break;
    case 'book': if (book) return go({ name: 'book', bookId: book.id }); break;
    case 'progress': return go({ name: 'progress' });
    case 'library': return go({ name: 'library' });
    case 'books': return go({ name: 'books' });
    case 'settings': return go({ name: 'settings' });
    case 'star_shop': return go({ name: 'stars' });
    case 'today': return go({ name: 'home' });
    case 'homework': return go({ name: 'homework' });
    case 'dictation': return go({ name: 'dictation' });
    case 'writing': return go({ name: 'writing' });
    case 'speaking': return go({ name: 'speaking' });
    case 'learn': if (book && units.length) return go({ name: 'learn', bookId: book.id, unitId: units[0].id }); break;
  }
  if (book) return go({ name: 'book', bookId: book.id }); // couldn't tell exactly what: open the book's chapter page
}
const COACH_CHIPS = ['How am I doing?', 'What should I work on this week?', 'Which chapter is my weakest?', 'Make me a plan for today'];
const coach = { busy: false, error: null };
function coachHTML() {
  if (locked('coach')) return `<div class="coach-head"><span class="coach-ic buddy-ic" aria-hidden="true">${buddySVG('happy', 46)}</span><div><b>${PL('Study coach', '溫習教練')} <span class="lock-tag inl">🔒 Standard</span></b><span>${PL('Plans your day from your scores and mistakes', '按你的分數和錯題計劃每天溫習')}</span></div></div>
    <div class="coach-msgs coach-demo"><div class="tmsg me nomath tmsg-ui">${PL('What should I work on today?', '我今天應該溫習甚麼？')}</div><div class="tmsg ai tmsg-ui">${PL('Your weakest chapter is <b>Forces</b> (52%). Let’s do 10 questions on it, then fix the 3 mistakes from Monday. About 15 minutes.', '你最弱的章節是<b>力</b>（52%）。先做 10 題，再改正星期一的 3 題錯題，大約 15 分鐘。')}</div><div class="coach-acts"><span class="btn-sm primary">▶ ${PL('Start 10 questions', '開始 10 題')}</span></div></div>
    <div class="coach-lock"><span>${PL('Upgrade to Standard for a coach that sees your progress and plans every day.', '升級至標準計劃，教練會按你的進度每天幫你計劃。')}</span><button class="btn" id="coachUp">${PL('See Plus', '查看 Plus')}</button></div>`;
  const msgs = local.coach || [];
  return `<div class="coach-head"><span class="coach-ic buddy-ic" aria-hidden="true">${buddySVG('happy', 46)}</span><div>${helper.open ? '<b>Ask Buddy</b><span>About the app or your studies</span>' : '<b>Ask Buddy</b><span>Your study coach: sees your scores, mistakes and reviews</span>'}</div>
      <span style="margin-left:auto;display:flex;gap:6px">${msgs.length && !coach.busy && !voiceOn('coach') ? '<button class="btn-sm quiet" id="coachClear">Clear</button>' : ''}
      ${voiceOn('coach') ? '' : `<button class="vtalk" id="coachTalk">${ICON.mic} Talk${locked('voice') ? ' 🔒' : ''}</button>`}</span></div>
    ${voiceOn('coach') ? voicePanelHTML() + (coach.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(coach.error)}</p>` : '') : `<div class="coach-msgs" id="coachMsgs">
      <div class="tmsg ai tmsg-ui">${helper.open ? `Need help? Ask me anything about PrepBuddy or your studies.` : `Hi${local.name ? ` ${esc(local.name)}` : ''}! ${coach.brief ? esc(coach.brief) + ' ' : ''}Ask me how you’re doing, what to focus on, or for a study plan.`}</div>
      ${msgs.map((m, k) => m.role === 'user' ? `<div class="tmsg me nomath" data-raw>${esc(m.text)}</div>` : `<div class="tmsg ai" data-raw>${tutorMd(m.text)}</div>${m.picked ? `<div class="coach-picked" data-raw>✓ ${esc(m.picked)}</div>` : ''}${m.btns && k === msgs.length - 1 && !coach.busy ? `<div class="coach-acts">${m.btns.map((b, j) => `<button class="${j ? 'btn-sm' : 'btn-sm primary'}" data-cact="${j}" data-raw>${j ? '' : '▶ '}${esc(b.label)}</button>`).join('')}</div>` : ''}`).join('')}
      ${coach.busy ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}
      ${coach.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(coach.error)}</p>` : ''}
      ${voiceNoticeHTML('coach')}
    </div>
    ${coach.busy ? '' : `<div class="tchips">${(helper.open ? helperChips() : COACH_CHIPS).filter((t) => !msgs.some((m) => m.chip === t)).map((t) => `<button class="tchip" data-coach="${esc(t)}">${t}</button>`).join('')}</div>`}
    <form class="tform" id="coachForm"><input id="coachQ" class="tinput" placeholder="${helper.open ? 'Ask me anything…' : 'Ask about your progress…'}" autocomplete="off" ${coach.busy ? 'disabled' : ''}><button class="tsend" aria-label="Send" ${coach.busy ? 'disabled' : ''}>${ICON.send}</button></form>`}`;
}
function bindCoach() {
  const box = document.getElementById('coach'); if (!box) return;
  { const cu = document.getElementById('coachUp'); if (cu) { cu.onclick = () => go({ name: 'plans', hi: 'plus' }); return; } }
  const redraw = () => { const b = document.getElementById('coach'); if (!b) return; b.innerHTML = coachHTML(); bindCoach(); const m = document.getElementById('coachMsgs'); if (m) m.scrollTop = m.scrollHeight; };
  const ask = async (text, chip, voice, onChunk) => {
    text = String(text || '').trim(); if (!text || coach.busy) return;
    let reply = '';
    const msgs = local.coach || (local.coach = []);
    const history = msgs.slice(-10).map((m) => ({ role: m.role, text: m.text }));
    msgs.push({ role: 'user', text, chip }); coach.busy = true; coach.error = null; redraw();
    try {
      const req = { snapshot: await coachSnapshot(), ask: text, history, lang: voice ? ({ yue: 'zh', fr: 'fr', ja: 'ja' }[voice] || 'en') : LANG, voice, screen: SCREEN_NAME[view && view.name] || (view && view.name) || 'Today' };
      const r = onChunk ? await apiStream('coach', req, onChunk) : await api('coach', req);
      // Buttons under the reply: the coach's suggested next steps, one tap to start.
      const btns = r.action && r.action.go_now === false && Array.isArray(r.action.buttons)
        ? r.action.buttons.filter((b) => b && b.action && b.label).slice(0, 3).map((b) => ({ label: String(b.label).slice(0, 60), action: b.action, chapters: b.chapters, book: b.book, count: b.count })) : null;
      msgs.push({ role: 'assistant', text: r.reply, voice: !!voice, btns: btns && btns.length ? btns : undefined }); reply = r.reply;
      if (r.action && r.action.go_now !== false && r.action.action) {
        // Spoken: open it once the coach has finished saying so. Typed: open it after a moment to read the line.
        if (voice) reply = { text: r.reply, after: () => runCoachAction(r.action) };
        else setTimeout(() => { if (document.getElementById('coach')) runCoachAction(r.action); }, 900);
      }
    } catch (e) {
      msgs.pop();
      coach.error = e.status === 0 ? 'You seem to be offline.' : (e.message && e.status !== 500 ? e.message : 'The coach is not available right now. Try again in a moment.');
    }
    local.coach = msgs.slice(-20); saveLocal(); coach.busy = false; redraw();
    return reply;
  };
  box.querySelectorAll('[data-coach]').forEach((b) => (b.onclick = () => ask(b.textContent, b.dataset.coach)));
  box.querySelectorAll('[data-cact]').forEach((b) => (b.onclick = () => {
    const msgs = local.coach || [], last = msgs[msgs.length - 1];
    const step = last && last.btns && last.btns[+b.dataset.cact]; if (!step) return;
    last.btns = undefined; last.picked = step.label; local.coach = msgs.slice(-20); saveLocal(); // (no extra message: the chat must keep alternating)
    runCoachAction(step);
  }));
  const f = document.getElementById('coachForm'); if (f) f.onsubmit = (e) => { e.preventDefault(); ask(document.getElementById('coachQ').value); };
  const c = document.getElementById('coachClear'); if (c) c.onclick = () => { local.coach = []; coach.error = null; saveLocal(); redraw(); };
  const tk = document.getElementById('coachTalk');
  if (tk) tk.onclick = () => startVoiceChat({ where: 'coach', lang: LANG === 'zh' ? 'yue' : 'en', send: (t, l, onChunk) => ask(t, undefined, l, onChunk), alive: () => !!document.getElementById('coach'), redraw, title: VL('Study coach', '溫習教練') });
  bindVoiceBar();
  const m = document.getElementById('coachMsgs'); if (m) m.scrollTop = m.scrollHeight;
}

/* ---------- homework help from photos ----------
   The student photographs tonight's homework; Buddy reads the questions and then helps them do it themselves
   (hints, a similar example, checking their answers), never just handing over answers to copy.
   Recent homework is kept on this device: the questions and chat in local, the photos in IndexedDB. */
const HW = (en, zh) => (LANG === 'zh' ? zh : en);
const hwState = { photos: [], busy: false, error: null };
function shrinkPhoto(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(HW('That file isn’t a photo I can read.', '這個檔案不是可讀取的相片。'))); };
    img.src = url;
  });
}
async function renderHomework(id) {
  const list = local.hw || [];
  const hw = id && list.find((x) => x.id === id);
  if (hw) return renderHomeworkChat(hw);
  const ph = hwState.photos;
  $app.innerHTML = `
  ${backTop({name:'home'}, 'Today')}
  <main class="pad stack g18 hwpage" data-view="homework" data-raw style="flex:1">
    <h1 class="pagetitle">${HW('Homework help', '功課輔導')}</h1>
    <section class="hw-hero">${buddySVG('happy', 56)}<div><b>${HW('Snap your homework, then work through it with Buddy.', '拍下你的功課，再和 Buddy 一起完成。')}</b>
      <span>${HW('Buddy explains, gives hints and checks your answers, so you learn how to do it yourself.', 'Buddy 會解釋、給提示和檢查你的答案，讓你學會自己做。')}</span></div></section>
    <section class="card hw-cap">
      ${ph.length ? `<div class="hw-thumbs">${ph.map((p, i) => `<div class="hw-th"><img src="${p}" alt="${HW(`Photo ${i + 1}`, `相片 ${i + 1}`)}"><button class="hw-del" data-del="${i}" aria-label="${HW('Remove photo', '刪除相片')}">✕</button></div>`).join('')}</div>` : `<p class="muted" style="margin:0">${HW('Take a clear photo of each page, flat and in good light. Up to 6 pages.', '每頁拍一張清晰的相片，平放並光線充足。最多 6 頁。')}</p>`}
      <div class="hw-btns">
        <label class="btn ${ph.length ? 'ghost' : ''}">${HW(ph.length ? 'Add another page' : 'Take a photo', ph.length ? '再加一頁' : '拍照')}<input type="file" accept="image/*" capture="environment" id="hwCam" hidden></label>
        <label class="btn ghost">${HW('Choose photos', '選擇相片')}<input type="file" accept="image/*" multiple id="hwPick" hidden></label>
      </div>
      ${ph.length ? `<button class="btn" id="hwRead" ${hwState.busy ? 'disabled' : ''}>${hwState.busy ? HW('Reading your homework…', '正在讀取你的功課…') : HW(`Read my homework (${ph.length} page${ph.length > 1 ? 's' : ''})`, `讀取我的功課（${ph.length} 頁）`)}</button>` : ''}
      ${hwState.busy ? `<div class="spinner" aria-hidden="true" style="align-self:center"></div>` : ''}
      ${hwState.error ? `<p class="hw-err" role="alert">${esc(hwState.error)}</p>` : ''}
    </section>
    ${list.length ? `<section class="stack g10"><h2 class="st-h">${HW('Recent homework', '最近的功課')}</h2>
      <div class="hw-list">${list.slice().reverse().map((x) => `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">${actionIcon('homework', 22)}</span><span class="hw-it"><b>${esc(x.title || HW('Homework', '功課'))}</b><small>${esc([x.subject, x.level].filter(Boolean).join(' · '))}${x.subject || x.level ? ' · ' : ''}${new Date(x.t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} · ${x.questions.length} ${HW('questions', '題')}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div></section>` : ''}
  </main>`;
  const add = async (files) => {
    hwState.error = null;
    for (const f of [...files].slice(0, 6 - hwState.photos.length)) {
      try { hwState.photos.push(await shrinkPhoto(f)); } catch (e) { hwState.error = e.message; }
    }
    renderHomework();
  };
  document.getElementById('hwCam').onchange = (e) => add(e.target.files);
  document.getElementById('hwPick').onchange = (e) => add(e.target.files);
  $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { hwState.photos.splice(+b.dataset.del, 1); renderHomework(); }));
  $app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => go({ name: 'homework', id: b.dataset.open })));
  const rd = document.getElementById('hwRead');
  if (rd) rd.onclick = async () => {
    hwState.busy = true; hwState.error = null; renderHomework();
    try {
      const r = await api('homework', { step: 'read', images: hwState.photos, lang: LANG });
      const item = { id: uid(), t: Date.now(), title: r.title, subject: r.subject, level: r.level, questions: r.questions, note: r.note, msgs: [] };
      await store.set(`hwimg:${item.id}`, hwState.photos.slice());
      local.hw = [...(local.hw || []), item].slice(-10); saveLocal();
      // keep photos only for the last 10
      hwState.photos = []; hwState.busy = false;
      go({ name: 'homework', id: item.id });
    } catch (e) {
      hwState.busy = false;
      hwState.error = e.status === 0 ? HW('You seem to be offline.', '你好像離線了。') : e.status === 401 ? HW('Access code needed.', '需要存取碼。') : (e.message || HW('Couldn’t read the photos. Try again.', '讀取相片失敗，請再試。'));
      renderHomework();
    }
  };
}

const hwChat = { busy: false, error: null };
async function renderHomeworkChat(hw) {
  const photos = await store.get(`hwimg:${hw.id}`, []);
  const draw = () => {
    const msgs = hw.msgs;
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${HW('Homework', '功課')}</span></button><span style="font-weight:600;font-size:16px" data-raw>${esc(hw.title || '')}</span></div>
    <main class="hwchat" data-view="homework" data-raw style="flex:1">
      <section class="hw-qs">
        ${photos.length ? `<div class="hw-thumbs small">${photos.map((p, i) => `<button class="hw-th" data-zoom="${i}" aria-label="${HW(`Open photo ${i + 1}`, `打開相片 ${i + 1}`)}"><img src="${p}" alt=""></button>`).join('')}</div>` : ''}
        ${hw.note ? `<p class="hint" style="margin:0">${esc(hw.note)}</p>` : ''}
        <div class="hw-qlist">${hw.questions.map((q, i) => `<div class="hw-q ${hw.cur === i ? 'on' : ''}"><div class="hw-qt"><b>${esc(q.label || String(i + 1))}</b><div class="hw-qx">${tutorMd(q.text)}</div>${q.student_answer ? `<small>${HW('Your answer', '你的答案')}: ${esc(q.student_answer)}</small>` : ''}</div>
          <button class="btn-sm ${hw.cur === i ? 'primary' : ''}" data-help="${i}">${HW('Help me', '幫我')}</button></div>`).join('')}</div>
      </section>
      <section class="tchat hw-tchat" id="hwchat">
        <div class="thead"><b class="thead-t">${buddySVG('happy', 28)}<span>${HW('Ask Buddy', '問 Buddy')}<small>${HW('Hints and checking, not answers to copy', '提示和檢查，不是直接給答案')}</small></span></b></div>
        <div class="tlog" id="hwlog">
          ${!msgs.length ? `<div class="tmsg ai tmsg-ui">${HW(`I’ve read your homework: ${hw.questions.length} question${hw.questions.length === 1 ? '' : 's'}. Tap <b>Help me</b> on one, or tell me which one you’re stuck on. Try it first, then show me your answer and I’ll check it!`, `我已經讀了你的功課，共 ${hw.questions.length} 題。按題目旁的<b>幫我</b>，或告訴我你哪一題不會。先自己試試，再把答案告訴我，我幫你檢查！`)}</div>` : ''}
          ${msgs.map((m) => m.role === 'user' ? `<div class="tmsg me nomath">${esc(m.text)}</div>` : `<div class="tmsg ai">${tutorMd(m.text)}</div>`).join('')}
          ${hwChat.busy ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}
          ${hwChat.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(hwChat.error)}</p>` : ''}
        </div>
        ${hwChat.busy ? '' : `<div class="tchips">${(hw.cur !== undefined ? [HW('Give me a hint', '給我提示'), HW('Explain it with an example', '用例子解釋'), HW('Check my answer', '檢查我的答案')] : [HW('Which one should I start with?', '我應該先做哪一題？')]).map((t) => `<button class="tchip" data-say="${esc(t)}">${t}</button>`).join('')}</div>`}
        <form class="tform" id="hwform"><input id="hwq" class="tinput" placeholder="${HW('Type your answer or question…', '輸入你的答案或問題…')}" autocomplete="off" ${hwChat.busy ? 'disabled' : ''}><button class="tsend" aria-label="${HW('Send', '傳送')}" ${hwChat.busy ? 'disabled' : ''}>${ICON.send}</button></form>
      </section>
    </main>`;
    renderMath($app);
    const log = document.getElementById('hwlog'); if (log) log.scrollTop = log.scrollHeight;
    document.getElementById('back').onclick = () => go({ name: 'homework' });
    $app.querySelectorAll('[data-help]').forEach((b) => (b.onclick = () => { const i = +b.dataset.help; hw.cur = i; const q = hw.questions[i]; ask(HW(`Help me with ${q.label || 'question ' + (i + 1)}.`, `請幫我做 ${q.label || '第 ' + (i + 1) + ' 題'}。`)); }));
    $app.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => ask(b.textContent.trim() || b.dataset.say)));
    $app.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => zoomPhoto(photos[+b.dataset.zoom])));
    document.getElementById('hwform').onsubmit = (e) => { e.preventDefault(); ask(document.getElementById('hwq').value); };
  };
  const text = () => hw.questions.map((q) => `${q.label} ${q.text}${q.student_answer ? `\n(Student's written answer: ${q.student_answer})` : ''}`).join('\n\n');
  const ask = async (t) => {
    t = String(t || '').trim(); if (!t || hwChat.busy) return;
    const history = hw.msgs.slice(-12).map((m) => ({ role: m.role, text: m.text }));
    const focus = hw.cur !== undefined ? `\n\n(The student is working on ${hw.questions[hw.cur].label || 'question ' + (hw.cur + 1)}.)` : '';
    hw.msgs.push({ role: 'user', text: t }); hwChat.busy = true; hwChat.error = null; draw();
    if (!desk()) { const c = document.getElementById('hwchat'); if (c) c.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
    try {
      const r = await api('homework', { step: 'chat', homework: text() + focus, ask: t, history, lang: LANG });
      hw.msgs.push({ role: 'assistant', text: r.reply });
    } catch (e) {
      hw.msgs.pop();
      hwChat.error = e.status === 0 ? HW('You seem to be offline.', '你好像離線了。') : (e.message || HW('Buddy is not available right now.', 'Buddy 暫時未能回答。'));
    }
    hw.msgs = hw.msgs.slice(-40); hwChat.busy = false; saveLocal(); draw();
    if (!desk()) { const c = document.getElementById('hwchat'); if (c) c.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
  };
  draw();
}
function zoomPhoto(src) {
  if (!src) return;
  const box = document.createElement('div');
  box.className = 'cdlg-wrap hw-zoom';
  box.innerHTML = `<img src="${src}" alt=""><button class="helper-x" aria-label="Close">✕</button>`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
}

/* ---------- writing practice (DSE English Paper 2 / 中文卷二) ----------
   The student picks the paper, uses their school task (typed or a photo), or asks for a DSE-style one, then types
   or photographs their essay. Buddy marks it by the DSE criteria (estimated bands, never an official mark), lists
   strengths, the 3 fixes that matter most and language corrections, and the student redrafts. Each draft is kept so
   they can see what improved. Everything stays on this device. */
const WT = (en, zh) => (LANG === 'zh' ? zh : en);
const WR_KINDS = {
  en_a: { lang: 'en', en: 'English · Part A', zh: '英文 · Part A', sub: ['Short guided task, ~200 words', '短篇引導寫作，約 200 字'], words: 200, crit: ['Content', 'Language', 'Organisation'], w: [1, 1, 1] },
  en_b: { lang: 'en', en: 'English · Part B', zh: '英文 · Part B', sub: ['Longer task, ~400 words', '長篇寫作，約 400 字'], words: 400, crit: ['Content', 'Language', 'Organisation'], w: [1, 1, 1] },
  zh_essay: { lang: 'zh', en: '中文 · 命題寫作', zh: '中文 · 命題寫作', sub: ['卷二乙部，約 650 字以上', '卷二乙部，約 650 字以上'], words: 650, crit: ['內容', '表達', '結構', '標點字體'], w: [4, 3, 2, 1] },
  zh_practical: { lang: 'zh', en: '中文 · 實用寫作', zh: '中文 · 實用寫作', sub: ['卷二甲部，按字數上限', '卷二甲部，按字數上限'], words: 550, crit: ['內容', '行文組織'], w: [3, 2] },
  // Primary: length follows the child's grade (same table as the server, lib/fns/writing.js).
  en_p: { lang: 'en', primary: true, en: 'English writing', zh: '英文寫作', get sub() { const [a, b] = pLen('en'); return [`Guided writing, about ${a}-${b} words`, `引導寫作，約 ${a}-${b} 字`]; }, get words() { return pLen('en')[1]; }, get min() { return Math.max(12, Math.round(pLen('en')[0] * 0.6)); }, crit: ['Content', 'Language', 'Organisation'], w: [1, 1, 1] },
  zh_p: { lang: 'zh', primary: true, en: 'Chinese writing', zh: '中文寫作', get sub() { const [a, b] = pLen('zh'); return [`Write to a topic in Chinese, about ${a}-${b} characters`, `看題目寫作，約 ${a}-${b} 字`]; }, get words() { return pLen('zh')[1]; }, get min() { return Math.max(30, Math.round(pLen('zh')[0] * 0.6)); }, crit: ['內容', '表達', '結構', '標點字體'], w: [4, 3, 2, 1] },
};
const P_LEN = { en: { p12: [20, 60], p34: [60, 120], p56: [120, 200] }, zh: { p12: [60, 150], p34: [200, 350], p56: [350, 600] } };
function pLen(lang) { const b = gradeBand(); return P_LEN[lang][b && b[0] === 'p' ? b : 'p34']; }
// Which writing kinds to offer: primary pupils get the two primary kinds, everyone else the DSE papers.
const wrKindsFor = () => Object.entries(WR_KINDS).filter(([, x]) => !!x.primary === isPrimaryKid());
// Level shown on cards: DSE kinds get "≈5*", primary kinds get stars for their grade.
const lvShow = (lv) => (!lv ? '' : /^\d/.test(lv) ? `≈${lv}` : lv);
const wrState = { kind: null, prompt: '', topic: '', busy: '', error: null, open: {} };
const wrCount = (text, lang) => (lang === 'zh' ? String(text || '').replace(/[\s\p{P}]/gu, '').length : (String(text || '').match(/[A-Za-z’'-]+/g) || []).length);
// A rough overall DSE level from the criterion bands (weighted mean of 1-7 bands). An estimate only.
function wrLevel(fb, kind) {
  const k = WR_KINDS[kind]; if (!k || !fb || !fb.criteria) return null;
  let s = 0, w = 0;
  fb.criteria.forEach((c, i) => { const wt = k.w[i] || 1; s += c.band * wt; w += wt; });
  const m = s / (w || 1);
  if (k.primary) return '★'.repeat(m >= 6.2 ? 5 : m >= 5.2 ? 4 : m >= 4.2 ? 3 : m >= 3 ? 2 : 1);
  return m >= 6.6 ? '5**' : m >= 6 ? '5*' : m >= 5.2 ? '5' : m >= 4.3 ? '4' : m >= 3.4 ? '3' : m >= 2.5 ? '2' : '1';
}
function wrSave() { local.wr = (local.wr || []).slice(-15); saveLocal(); }
const wrErr = (e) => (e.status === 0 ? WT('You seem to be offline.', '你好像離線了。') : e.status === 401 ? WT('Access code needed.', '需要存取碼。') : (e.message || WT('Something went wrong. Try again.', '出了點問題，請再試。')));
async function wrPhotos(multi) {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; if (multi) inp.multiple = true;
    inp.onchange = async () => { const out = []; for (const f of [...inp.files].slice(0, 5)) { try { out.push(await shrinkPhoto(f, 2000)); } catch (e) {} } resolve(out); };
    inp.click();
  });
}

// Writing stars need a real piece (80+ words, or 150+ Chinese characters), a redraft that really changed
// (at least 10% new wording), and only one star award per piece per day.
function changedShare(a, b) {
  const tok = (t) => { const x = String(t || ''); const cjk = x.match(/[㐀-鿿]/g); return cjk && cjk.length > 20 ? cjk : x.toLowerCase().split(/\s+/).filter(Boolean); };
  const old = {}; tok(a).forEach((w) => (old[w] = (old[w] || 0) + 1));
  const nw = tok(b); let fresh = 0;
  nw.forEach((w) => { if (old[w]) old[w]--; else fresh++; });
  const left = Object.values(old).reduce((x, y) => x + y, 0);
  return nw.length ? (fresh + left) / Math.max(nw.length, 1) : 0;
}
function writingStarOK(it) {
  const d = it.drafts, last = d[d.length - 1], text = (last && last.text) || '';
  const zh = (text.match(/[㐀-鿿]/g) || []).length > 20;
  const pk = WR_KINDS[it.kind] && WR_KINDS[it.kind].primary;
  if (zh ? wordCount(text) < (pk ? WR_KINDS[it.kind].min : 150) : wordCount(text) < (pk ? WR_KINDS[it.kind].min : 80)) return false;
  if (d.length > 1 && changedShare(d[d.length - 2].text, text) < 0.1) return false;
  if (it.starDay === dayStart()) return false;
  it.starDay = dayStart(); wrSave();
  return true;
}
async function renderWriting(id, sub) {
  const list = local.wr || [];
  const it = id && list.find((x) => x.id === id);
  if (it) return sub === 'fb' && it.drafts.length ? renderWritingFeedback(it) : renderWritingEditor(it);
  const s = wrState, k = s.kind && WR_KINDS[s.kind];
  $app.innerHTML = `
  ${backTop({name:'home'}, 'Today')}
  <main class="pad stack g18 wrpage" data-view="writing" data-raw style="flex:1">
    <h1 class="pagetitle">${WT('Writing practice', '寫作練習')}</h1>
    <section class="hw-hero">${buddySVG('happy', 56)}<div>${isPrimaryKid() ? `<b>${WT('Write, get kind feedback from Buddy, then make it even better.', '寫作、聽聽 Buddy 的意見，再改得更好。')}</b>
      <span>${WT(`Buddy marks it like a primary teacher, for a ${gradeLabel()} pupil: what you did well, up to 3 things to fix, and your spelling.`, `Buddy 會像小學老師一樣，按${gradeLabel()}程度批改：做得好的地方、最多三個要改的地方，還有錯別字。`)}</span>` : `<b>${WT('Write, get DSE-style feedback, then make it better.', '寫作、取得 DSE 式評語，再改得更好。')}</b>
      <span>${WT('Buddy marks by the DSE criteria, shows what to fix first, and checks your redraft. Bands are estimates, not official marks.', 'Buddy 按 DSE 評分準則批改，指出最先要改的地方，再檢查你的修改稿。等級只是估計，並非正式分數。')}</span>`}</div></section>
    <section class="card wr-step"><h2 class="st-h">1 · ${isPrimaryKid() ? WT('English or Chinese?', '英文還是中文？') : WT('Which paper?', '哪一份卷？')}</h2>
      <div class="wr-kinds">${wrKindsFor().map(([key, x]) => `<button class="wr-kind ${s.kind === key ? 'on' : ''}" data-kind="${key}" aria-pressed="${s.kind === key}"><b>${LANG === 'zh' ? x.zh : x.en}</b><span>${WT(...x.sub)}</span></button>`).join('')}</div>
    </section>
    ${k ? `<section class="card wr-step"><h2 class="st-h">2 · ${WT('The task (question)', '題目')}</h2>
      <textarea id="wrPrompt" class="wr-ta small" rows="6" placeholder="${k.primary ? WT('Type your school’s writing task here, take a photo of it, or let Buddy write one for you.', '在這裏輸入學校的寫作題目，或拍下題目，或讓 Buddy 幫你出題。') : WT('Paste or type your school’s writing task here, take a photo of it, or let Buddy write a DSE-style one.', '在這裏貼上或輸入學校的寫作題目，或拍下題目，或讓 Buddy 出一條 DSE 式題目。')}">${esc(s.prompt)}</textarea>
      <div class="wr-row">
        <button class="btn ghost" id="wrTaskPhoto" ${s.busy ? 'disabled' : ''}>${WT('Photo of the task', '拍下題目')}</button>
        <div class="wr-gen"><input id="wrTopic" class="tinput" placeholder="${k.primary ? WT('Topic (optional), e.g. my pet', '題材（可留空），例如：我的寵物') : WT('Topic (optional), e.g. social media', '題材（可留空），例如：社交媒體')}" value="${esc(s.topic)}"><button class="btn ghost" id="wrGen" ${s.busy ? 'disabled' : ''}>${WT('Write me a task', '幫我出題')}</button></div>
      </div>
      ${s.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(s.busy)}</p>` : ''}
      ${s.error ? `<p class="hw-err" role="alert">${esc(s.error)}</p>` : ''}
      <button class="btn" id="wrStart" ${s.busy ? 'disabled' : ''}>${WT('Start writing', '開始寫作')} →</button>
      <p class="hint" style="margin:0">${WT('No task? You can still start: Buddy will judge it as a general piece of this type.', '沒有題目？也可以開始，Buddy 會按這類文章的一般要求批改。')}</p>
    </section>` : ''}
    ${list.length ? `<section class="stack g10"><h2 class="st-h">${WT('Your writing', '你的文章')}</h2>
      <div class="hw-list">${list.slice().reverse().map((x) => { const d = x.drafts[x.drafts.length - 1], lv = d && wrLevel(d.fb, x.kind); return `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">${actionIcon('writing', 22)}</span><span class="hw-it"><b>${esc(x.title)}</b><small>${LANG === 'zh' ? WR_KINDS[x.kind].zh : WR_KINDS[x.kind].en} · ${new Date(x.t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} · ${x.drafts.length ? WT(`${x.drafts.length} draft${x.drafts.length > 1 ? 's' : ''} marked`, `已批改 ${x.drafts.length} 稿`) : WT('Not marked yet', '未批改')}</small></span>${lv ? `<span class="wr-lv sm" title="${WT('Estimated level', '估計等級')}">${lvShow(lv)}</span>` : ''}<span aria-hidden="true">›</span></button>`; }).join('')}</div></section>` : ''}
  </main>`;
  $app.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { s.kind = b.dataset.kind; s.error = null; renderWriting(); }));
  $app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { const x = list.find((y) => y.id === b.dataset.open); go({ name: 'writing', id: b.dataset.open, sub: x && x.drafts.length && !x.work ? 'fb' : undefined }); }));
  if (!k) return;
  const pr = document.getElementById('wrPrompt'), tp = document.getElementById('wrTopic');
  pr.oninput = () => (s.prompt = pr.value); tp.oninput = () => (s.topic = tp.value);
  const run = async (label, fn) => {
    s.busy = label; s.error = null; renderWriting();
    try { await fn(); } catch (e) { s.error = wrErr(e); }
    s.busy = ''; if (view.name === 'writing' && !view.id) renderWriting();
  };
  document.getElementById('wrTaskPhoto').onclick = async () => {
    const ph = await wrPhotos(true); if (!ph.length) return;
    run(WT('Reading the task…', '正在讀取題目…'), async () => { const r = await api('writing', { step: 'read', what: 'task', images: ph }); s.prompt = r.text; });
  };
  document.getElementById('wrGen').onclick = () => run(WR_KINDS[s.kind].primary ? WT('Writing a task…', '正在出題…') : WT('Writing a DSE-style task…', '正在出題…'), async () => { const r = await api('writing', { step: 'prompt', kind: s.kind, topic: s.topic }); s.prompt = r.prompt; });
  document.getElementById('wrStart').onclick = () => {
    const prompt = s.prompt.trim();
    const first = prompt.split('\n').map((l) => l.trim()).find((l) => l.length > 3) || '';
    const title = first ? first.replace(/^[#*\s]+/, '').slice(0, 60) + (first.length > 60 ? '…' : '') : WT('Free writing', '自由寫作');
    const item = { id: uid(), t: Date.now(), kind: s.kind, title, prompt, work: '', drafts: [] };
    local.wr = [...(local.wr || []), item]; wrSave();
    s.prompt = ''; s.topic = '';
    go({ name: 'writing', id: item.id });
  };
}

function renderWritingEditor(it) {
  const k = WR_KINDS[it.kind], st = wrState;
  const n = it.drafts.length;
  const draw = () => {
    const c = wrCount(it.work, k.lang);
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${WT('Writing', '寫作')}</span></button><span style="font-weight:600;font-size:16px" data-raw>${n ? WT(`Draft ${n + 1}`, `第 ${n + 1} 稿`) : WT('Draft 1', '第 1 稿')}</span></div>
    <main class="pad stack g14 wrpage" data-view="writing" data-raw style="flex:1">
      <details class="card wr-task" ${it.prompt && !n ? 'open' : ''}><summary><b>${WT('Task', '題目')}</b> · ${LANG === 'zh' ? k.zh : k.en}</summary><div class="wr-ptext">${it.prompt ? esc(it.prompt).replace(/\n/g, '<br>') : `<span class="muted">${WT('No task given.', '沒有題目。')}</span>`}</div></details>
      ${n ? `<div class="wr-tip">${WT('Redraft: work on the 3 fixes first.', '修改稿：先處理三個要改的地方。')} <button class="btn-sm quiet" id="seeFb">${WT('See feedback', '看評語')}</button>
        <ol>${it.drafts[n - 1].fb.fixes.map((f) => `<li>${esc(f.issue)}</li>`).join('')}</ol></div>` : ''}
      <section class="card wr-ed">
        <textarea id="wrText" class="wr-ta" lang="${k.lang === 'zh' ? 'zh-HK' : 'en'}" spellcheck="false" placeholder="${k.lang === 'zh' ? '在這裏寫你的文章…' : k.primary ? 'Write here…' : 'Write your essay here…'}">${esc(it.work)}</textarea>
        <div class="wr-bar"><span class="wr-count ${c >= k.words * 0.9 ? 'ok' : ''}" id="wrCount">${c} / ~${k.words} ${k.lang === 'zh' ? '字' : WT('words', '字')}</span>
          <button class="btn-sm" id="wrPhoto" ${st.busy ? 'disabled' : ''}>${WT('Photo of handwritten pages', '拍下手寫稿')}</button></div>
        ${st.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(st.busy)}</p>` : ''}
        ${st.error ? `<p class="hw-err" role="alert">${esc(st.error)}</p>` : ''}
        <p class="hint" style="margin:0">${WT('Writing on paper? Photograph the pages: Buddy types it out exactly as you wrote it (mistakes too). Check the reading before you ask for feedback.', '在紙上寫？拍下每一頁，Buddy 會照你寫的打出來（錯字也會保留）。取得評語前請先核對。')}</p>
        <button class="btn" id="wrMark" ${st.busy || c < (k.min || 30) ? 'disabled' : ''}>${n ? WT('Mark my redraft', '批改修改稿') : WT('Get feedback', '取得評語')}</button>
      </section>
    </main>`;
    document.getElementById('back').onclick = () => go({ name: 'writing' });
    const sf = document.getElementById('seeFb'); if (sf) sf.onclick = () => go({ name: 'writing', id: it.id, sub: 'fb' });
    const ta = document.getElementById('wrText');
    let tmr;
    ta.oninput = () => {
      it.work = ta.value; const cc = wrCount(ta.value, k.lang);
      const ce = document.getElementById('wrCount'); ce.textContent = `${cc} / ~${k.words} ${k.lang === 'zh' ? '字' : WT('words', '字')}`; ce.classList.toggle('ok', cc >= k.words * 0.9);
      document.getElementById('wrMark').disabled = !!st.busy || cc < 30;
      clearTimeout(tmr); tmr = setTimeout(saveLocal, 600);
    };
    document.getElementById('wrPhoto').onclick = async () => {
      const ph = await wrPhotos(true); if (!ph.length) return;
      st.busy = WT('Reading your handwriting…', '正在讀取你的手寫稿…'); st.error = null; draw();
      try { const r = await api('writing', { step: 'read', what: 'essay', images: ph }); it.work = (it.work.trim() ? it.work.trim() + '\n\n' : '') + r.text; wrSave(); }
      catch (e) { st.error = wrErr(e); }
      st.busy = ''; if (view.id === it.id) draw();
    };
    document.getElementById('wrMark').onclick = async () => {
      st.busy = WT('Buddy is marking your writing… (about 20–40 seconds)', 'Buddy 正在批改…（約 20 至 40 秒）'); st.error = null; draw();
      const prev = it.drafts[it.drafts.length - 1];
      try {
        const fb = await api('writing', { step: 'mark', kind: it.kind, prompt: it.prompt, text: it.work, prev: prev ? { text: prev.text, fb: { criteria: prev.fb.criteria, fixes: prev.fb.fixes } } : null });
        delete fb.usage;
        it.drafts.push({ t: Date.now(), text: it.work, fb }); it.work = ''; it.t = Date.now();
        wrSave(); if (writingStarOK(it)) addStars(it.drafts.length > 1 ? 3 : 2, 'writing');
        st.busy = '';
        if (view.id === it.id) go({ name: 'writing', id: it.id, sub: 'fb' });
      } catch (e) { st.busy = ''; st.error = wrErr(e); if (view.id === it.id) draw(); }
    };
  };
  st.error = null; draw();
}

// The essay with each correction's quote highlighted (first match, no overlaps).
function wrMarked(text, corr) {
  const spans = [];
  (corr || []).forEach((c, i) => {
    const q = String(c.quote || ''); if (!q) return;
    let at = text.indexOf(q);
    while (at >= 0 && spans.some((s) => at < s.b && at + q.length > s.a)) at = text.indexOf(q, at + 1);
    if (at >= 0) spans.push({ a: at, b: at + q.length, i });
  });
  spans.sort((x, y) => x.a - y.a);
  let out = '', p = 0;
  spans.forEach((s) => { out += esc(text.slice(p, s.a)) + `<mark class="wr-mk" data-c="${s.i}">${esc(text.slice(s.a, s.b))}<sup>${s.i + 1}</sup></mark>`; p = s.b; });
  return (out + esc(text.slice(p))).replace(/\n/g, '<br>');
}

function renderWritingFeedback(it, at) {
  const k = WR_KINDS[it.kind], o = wrState.open;
  const i = at === undefined ? (o[it.id + ':d'] ?? it.drafts.length - 1) : at;
  const d = it.drafts[i], prev = it.drafts[i - 1];
  const fb = Object.assign({ criteria: [], strengths: [], fixes: [], corrections: [], improved: [], still_to_do: [], summary: '' }, d.fb); // older drafts may lack newer fields
  const lv = wrLevel(fb, it.kind), plv = prev && wrLevel(prev.fb, it.kind);
  const showEssay = !!o[it.id + ':essay'];
  const zh = k.lang === 'zh';
  const L = (en, zht) => (zh ? zht : en); // feedback language follows the essay, not the app
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${WT('Writing', '寫作')}</span></button><span style="font-weight:600;font-size:16px" data-raw>${esc(it.title)}</span></div>
  <main class="pad stack g14 wrpage" data-view="writing" data-raw style="flex:1">
    ${it.drafts.length > 1 ? `<div class="wr-drafts" role="tablist">${it.drafts.map((x, j) => `<button role="tab" class="${j === i ? 'on' : ''}" aria-selected="${j === i}" data-d="${j}">${WT(`Draft ${j + 1}`, `第 ${j + 1} 稿`)}${wrLevel(x.fb, it.kind) ? ` · ${lvShow(wrLevel(x.fb, it.kind))}` : ''}</button>`).join('')}</div>` : ''}
    <section class="card wr-score">
      <div class="wr-lvbox"><span class="wr-lv${k.primary ? ' stars' : ''}">${lvShow(lv)}</span><small>${k.primary ? WT(`For a ${gradeLabel()} pupil`, `以${gradeLabel()}程度計`) : WT('Estimated level', '估計等級')}${plv && plv !== lv ? `<br><b class="${lv > plv ? 'wr-up' : 'wr-down'}">${WT('was', '之前')} ${plv}</b>` : ''}</small></div>
      <div class="wr-crits">${fb.criteria.map((c, j) => { const pc = prev && prev.fb.criteria[j], dlt = pc ? c.band - pc.band : 0; return `<div class="wr-crit"><div class="wr-ch"><b>${esc(c.name)}</b><span>${c.band}<small>/7</small>${dlt ? `<em class="${dlt > 0 ? 'wr-up' : 'wr-down'}">${dlt > 0 ? '▲' : '▼'}${Math.abs(dlt)}</em>` : ''}</span></div><div class="wr-bandbar"><i style="width:${(c.band / 7) * 100}%"></i></div><p>${esc(c.why)}</p></div>`; }).join('')}</div>
      <p class="wr-sum">${esc(fb.summary)}</p>
      <p class="wr-note">${k.primary ? WT('Buddy’s marking for your grade, not an official school mark: use it to see what to improve.', 'Buddy 按你的年級批改，並非學校正式分數，用來找出要改進的地方。') : WT('Estimate from AI marking against the HKDSE criteria. Not an official HKEAA mark: use it to see what to improve.', '按 HKDSE 評分準則的 AI 估計，並非考評局正式分數，用來找出要改進的地方。')} · ${fb.count} ${zh ? '字' : WT('words', '字')}</p>
    </section>
    ${prev && (fb.improved.length || fb.still_to_do.length) ? `<section class="card wr-box better"><h2>${L('What got better', '進步了的地方')}</h2>${fb.improved.length ? `<ul>${fb.improved.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${fb.still_to_do.length ? `<h3>${L('Still to work on', '仍要改進')}</h3><ul>${fb.still_to_do.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    <section class="card wr-box good"><h2>${L('What you did well', '做得好的地方')}</h2><ul>${fb.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card wr-box fix"><h2>${L('Fix these first', '最先要改的三點')}</h2><ol class="wr-fixes">${fb.fixes.map((f) => `<li><b>${esc(f.issue)}</b>${f.quote ? `<q>${esc(f.quote)}</q>` : ''}<span>${esc(f.how)}</span></li>`).join('')}</ol></section>
    ${fb.corrections.length ? `<section class="card wr-box"><button class="wr-tog" id="togCorr" aria-expanded="${!!o[it.id + ':corr']}"><h2>${L(`Language corrections (${fb.corrections.length})`, `語文修正（${fb.corrections.length} 處）`)}</h2><span>${o[it.id + ':corr'] ? WT('Hide', '隱藏') : WT('Show', '顯示')}</span></button>
      ${o[it.id + ':corr'] ? `<ol class="wr-corr">${fb.corrections.map((c) => `<li><s>${esc(c.quote)}</s> → <b>${esc(c.fix)}</b>${c.why ? `<small>${esc(c.why)}</small>` : ''}</li>`).join('')}</ol>` : ''}</section>` : ''}
    ${fb.next_step ? `<div class="wr-tip" data-keep>${esc(fb.next_step)}</div>` : ''}
    <section class="card wr-box"><button class="wr-tog" id="togEssay" aria-expanded="${showEssay}"><h2>${WT(`Your draft ${i + 1}`, `你的第 ${i + 1} 稿`)}</h2><span>${showEssay ? WT('Hide', '隱藏') : WT('Show', '顯示')}</span></button>
      ${showEssay ? `<div class="wr-essay">${wrMarked(d.text, fb.corrections)}</div>` : ''}</section>
    <div class="wr-acts">
      <button class="btn" id="redraft">${it.work ? WT('Continue my redraft', '繼續修改稿') : WT(`Redraft it (draft ${it.drafts.length + 1})`, `修改（第 ${it.drafts.length + 1} 稿）`)}</button>
      <button class="btn ghost" id="newWr">${WT('New piece of writing', '寫新的文章')}</button>
    </div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'writing' });
  $app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { o[it.id + ':d'] = +b.dataset.d; renderWritingFeedback(it); }));
  const tg = (key) => () => { o[it.id + key] = !o[it.id + key]; renderWritingFeedback(it); };
  const tc = document.getElementById('togCorr'); if (tc) tc.onclick = tg(':corr');
  document.getElementById('togEssay').onclick = tg(':essay');
  $app.querySelectorAll('.wr-mk').forEach((m) => (m.onclick = () => { const c = fb.corrections[+m.dataset.c]; toast(`${c.quote} → ${c.fix}${c.why ? ' · ' + c.why : ''}`); }));
  document.getElementById('redraft').onclick = () => { if (!it.work) it.work = it.drafts[it.drafts.length - 1].text; delete o[it.id + ':d']; wrSave(); go({ name: 'writing', id: it.id }); };
  document.getElementById('newWr').onclick = () => { wrState.kind = it.kind; go({ name: 'writing' }); };
}

/* ---------- speaking practice (HKDSE English Paper 4, individual response) ----------
   A DSE-style topic to read and prepare (10-minute timer, notes, as in the exam), then the examiner's
   question is read aloud and the student answers out loud for one minute. The browser turns speech into
   text (and records it for playback); Buddy marks the transcript by the four speaking domains. Pronunciation
   itself can't be judged from text, which the feedback says. Kept on this device. */
const SPK = (en, zh) => (LANG === 'zh' ? zh : en);
const SREC = window.SpeechRecognition || window.webkitSpeechRecognition;
const spx = { busy: '', error: null, topic: '', rec: null };
const SP_CRIT = ['Pronunciation & Delivery', 'Communication Strategies', 'Vocabulary & Language Patterns', 'Ideas & Organisation'];
const spLevel = (fb, it) => (fb && fb.criteria ? wrLevel({ criteria: fb.criteria }, it && it.task && it.task.primary ? 'en_p' : 'en_a') : null);
const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function spSave() { local.sp = (local.sp || []).slice(-15); saveLocal(); }
function sayQuestion(text) { sayAloud(text, 'en'); }

async function renderSpeaking(id, sub, qi) {
  const list = local.sp || [];
  const it = id && list.find((x) => x.id === id);
  if (it && sub === 'rec') return renderSpeakingRec(it, +qi);
  if (it && sub === 'fb') return renderSpeakingFb(it, +qi);
  if (it) return renderSpeakingTask(it);
  $app.innerHTML = `
  ${backTop({name:'home'}, 'Today')}
  <main class="pad stack g18 wrpage" data-view="speaking" data-raw style="flex:1">
    <h1 class="pagetitle">${SPK('Speaking practice', '說話練習')}</h1>
    <section class="hw-hero">${buddySVG('listen', 56)}<div>${isPrimaryKid() ? `<b>${SPK('Read aloud, then answer a question about you.', '朗讀短文，再回答關於你的問題。')}</b>
      <span>${SPK('Like the school speaking test: read a short passage, then answer simple questions out loud. Buddy listens and tells you what you did well and what to try next.', '就像學校的說話測驗：先朗讀一篇短文，再大聲回答簡單的問題。Buddy 會告訴你做得好的地方和下次可以試的。')}</span>` : `<b>${SPK('DSE English Paper 4: the one-minute individual response.', 'DSE 英文卷四：一分鐘個人回應。')}</b>
      <span>${SPK('Read a topic, prepare like the exam, then answer the examiner’s question out loud. Buddy marks it by the four speaking domains and shows you how to do better.', '閱讀題目、像考試一樣準備，然後大聲回答考官的問題。Buddy 會按四個說話範疇評分，並教你怎樣做得更好。')}</span>`}</div></section>
    ${SREC ? '' : `<p class="hw-err" role="alert">${SPK('This browser can’t turn speech into text. Please use Chrome, Edge or Safari.', '這個瀏覽器不能把說話轉成文字，請使用 Chrome、Edge 或 Safari。')}</p>`}
    <section class="card wr-step"><h2 class="st-h">${SPK('New topic', '新題目')}</h2>
      <div class="wr-gen"><input id="spTopic" class="tinput" placeholder="${isPrimaryKid() ? SPK('Topic (optional), e.g. my school', '題材（可留空），例如：我的學校') : SPK('Topic (optional), e.g. online learning', '題材（可留空），例如：網上學習')}" value="${esc(spx.topic)}"><button class="btn" id="spNew" ${spx.busy ? 'disabled' : ''}> ${isPrimaryKid() ? SPK('Give me a topic', '給我一條題目') : SPK('Give me a DSE-style topic', '給我一條 DSE 式題目')}</button></div>
      ${spx.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(spx.busy)}</p>` : ''}
      ${spx.error ? `<p class="hw-err" role="alert">${esc(spx.error)}</p>` : ''}
    </section>
    ${list.length ? `<section class="stack g10"><h2 class="st-h">${SPK('Your topics', '你的題目')}</h2>
      <div class="hw-list">${list.slice().reverse().map((x) => { const best = x.tries.reduce((b, t) => { const l = spLevel(t.fb, x); return l && (!b || l > b) ? l : b; }, null); return `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">${actionIcon('speaking', 22)}</span><span class="hw-it"><b>${esc(x.task.title)}</b><small>${new Date(x.t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} · ${x.tries.length ? SPK(`${x.tries.length} answer${x.tries.length > 1 ? 's' : ''}`, `已回答 ${x.tries.length} 次`) : SPK('Not answered yet', '未回答')}</small></span>${best ? `<span class="wr-lv sm">${lvShow(best)}</span>` : ''}<span aria-hidden="true">›</span></button>`; }).join('')}</div></section>` : ''}
  </main>`;
  const tp = document.getElementById('spTopic'); tp.oninput = () => (spx.topic = tp.value);
  $app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => go({ name: 'speaking', id: b.dataset.open })));
  document.getElementById('spNew').onclick = async () => {
    spx.busy = isPrimaryKid() ? SPK('Writing a topic…', '正在出題…') : SPK('Writing a DSE-style topic…', '正在出題…'); spx.error = null; renderSpeaking();
    try {
      const r = await api('speaking', { step: 'task', topic: spx.topic }); delete r.usage; if (isPrimaryKid()) r.primary = true;
      const item = { id: uid(), t: Date.now(), task: r, notes: '', tries: [] };
      local.sp = [...(local.sp || []), item]; spSave(); spx.busy = ''; spx.topic = '';
      go({ name: 'speaking', id: item.id });
    } catch (e) { spx.busy = ''; spx.error = wrErr(e); if (view.name === 'speaking' && !view.id) renderSpeaking(); }
  };
}

function renderSpeakingTask(it) {
  const T = it.task;
  const prepLeft = () => Math.max(0, Math.round(((it.prepEnd || 0) - Date.now()) / 1000));
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Speaking', '說話')}</span></button><span style="font-weight:600;font-size:16px" data-raw>${esc(T.title)}</span></div>
  <main class="pad sppage" data-view="speaking" data-raw style="flex:1">
    <div class="sp-col stack g14">
      <section class="card sp-text"><small class="ln-step">${T.primary ? SPK('Read this aloud', '大聲朗讀') : SPK('Read this', '閱讀')}</small><h2>${esc(T.title)}</h2><div>${esc(T.text).replace(/\n/g, '<br>')}</div></section>
      ${T.primary ? `${readAloudOn() ? `<button class="chip say" id="spHear">🔊 ${SPK('Hear it first', '先聽一次')}</button>` : ''}${T.discussion ? `<p class="hint" style="margin:0">${esc(T.discussion)}</p>` : ''}` : T.discussion ? `<details class="card wr-task"><summary><b>${SPK('Group discussion task', '小組討論題目')}</b></summary><div class="wr-ptext">${esc(T.discussion).replace(/\n/g, '<br>')}</div></details>` : ''}
    </div>
    <div class="sp-col stack g14">
      <section class="card sp-prep">
        <div class="sp-prep-h"><b>${SPK('Prepare', '準備')}</b><span class="sp-clock" id="spClock">${it.prepEnd && prepLeft() ? fmtSecs(prepLeft()) : T.primary ? '2:00' : '10:00'}</span>
          ${it.prepEnd && prepLeft() ? `<button class="btn-sm" id="spPrepStop">${SPK('I’m ready', '我準備好了')}</button>` : `<button class="btn-sm primary" id="spPrep">${T.primary ? SPK('Start 2-minute timer', '開始 2 分鐘計時') : SPK('Start 10-minute timer', '開始 10 分鐘計時')}</button>`}</div>
        <textarea id="spNotes" class="wr-ta small" rows="5" placeholder="${T.primary ? SPK('Notes (optional): a few key words to help you.', '筆記（可留空）：寫幾個關鍵字幫助你。') : SPK('Notes: key words and ideas only, like your exam note card.', '筆記：只寫關鍵字和要點，像考試的筆記卡。')}">${esc(it.notes || '')}</textarea>
      </section>
      <section class="card sp-qs"><h2>${T.primary ? SPK('Questions about you', '關於你的問題') : SPK('Individual response', '個人回應')}</h2><p class="hint" style="margin:0">${T.primary ? SPK('Pick a question and answer it out loud. Try to say why.', '揀一條問題大聲回答，試試說出原因。') : SPK('The examiner asks you one question. You answer for one minute.', '考官會問你一條問題，你要回答一分鐘。')}</p>
        ${T.questions.map((q, i) => { const ts = it.tries.filter((t) => t.qi === i), last = ts[ts.length - 1], lv = last && spLevel(last.fb, it); return `<div class="sp-q"><span class="sp-qn">${i + 1}</span><span class="sp-qt">${esc(q)}${last ? `<small>${SPK(`Answered ${ts.length}×`, `已答 ${ts.length} 次`)}${lv ? ` · ${lvShow(lv)}` : ''} · <button class="linkbtn" data-fb="${i}">${SPK('See feedback', '看評語')}</button></small>` : ''}</span><button class="btn-sm ${last ? '' : 'primary'}" data-ans="${i}">🎤 ${last ? SPK('Again', '再答') : SPK('Answer', '回答')}</button></div>`; }).join('')}
      </section>
    </div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'speaking' });
  const nt = document.getElementById('spNotes'); let tm; nt.oninput = () => { it.notes = nt.value; clearTimeout(tm); tm = setTimeout(saveLocal, 500); };
  const hr = document.getElementById('spHear'); if (hr) hr.onclick = () => sayAloud(T.text);
  const ps = document.getElementById('spPrep'); if (ps) ps.onclick = () => { it.prepEnd = Date.now() + (T.primary ? 120000 : 600000); saveLocal(); renderSpeakingTask(it); };
  const pe = document.getElementById('spPrepStop'); if (pe) pe.onclick = () => { it.prepEnd = 0; saveLocal(); renderSpeakingTask(it); };
  $app.querySelectorAll('[data-ans]').forEach((b) => (b.onclick = () => go({ name: 'speaking', id: it.id, sub: 'rec', qi: b.dataset.ans })));
  $app.querySelectorAll('[data-fb]').forEach((b) => (b.onclick = () => go({ name: 'speaking', id: it.id, sub: 'fb', qi: b.dataset.fb })));
  if (it.prepEnd && prepLeft()) {
    const myView = view;
    const t = setInterval(() => {
      const c = document.getElementById('spClock');
      if (view !== myView || !c) return clearInterval(t);
      const l = prepLeft(); c.textContent = fmtSecs(l);
      if (!l) { clearInterval(t); it.prepEnd = 0; saveLocal(); toast(SPK('Time’s up! Answer a question.', '時間到！開始回答問題。')); renderSpeakingTask(it); }
    }, 1000);
  }
}

// One minute, out loud: speech-to-text for the transcript, a recording to listen back to.
function renderSpeakingRec(it, qi) {
  const q = it.task.questions[qi]; if (!q) return go({ name: 'speaking', id: it.id });
  const R = { state: 'ready', final: '', interim: '', start: 0, lastHeard: 0, pause: 0, chunks: [], err: null };
  const myView = view;
  const draw = () => {
    const left = R.state === 'rec' ? Math.max(0, 60 - (Date.now() - R.start) / 1000) : 60;
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Topic', '題目')}</span></button><span style="font-weight:600;font-size:16px">${SPK('Individual response', '個人回應')}</span></div>
    <main class="pad stack g18 sprec" data-view="speaking" data-raw style="flex:1">
      <section class="sp-exq"><span class="sp-ex">${buddySVG(R.state === 'rec' ? 'listen' : 'happy', 52)}<small>${SPK('Examiner', '考官')}</small></span><div><p>${esc(q)}</p><button class="btn-sm quiet" id="spSay">🔊 ${SPK('Hear it again', '再聽一次')}</button></div></section>
      <section class="sp-ring ${R.state}"><svg viewBox="0 0 120 120" width="170" height="170" aria-hidden="true"><circle cx="60" cy="60" r="52" class="rbg"/><circle cx="60" cy="60" r="52" class="rfg" id="spArc" style="stroke-dashoffset:${326.7 * (1 - left / 60)}"/></svg>
        <div class="sp-time"><b id="spLeft">${fmtSecs(Math.ceil(left))}</b><small>${R.state === 'rec' ? SPK('speaking…', '說話中…') : SPK('one minute', '一分鐘')}</small></div>${R.state === 'rec' ? '<span class="sp-dot" aria-hidden="true"></span>' : ''}</section>
      ${R.state === 'ready' ? `<button class="btn sp-go" id="spGo">🎤 ${SPK('Start my minute', '開始我的一分鐘')}</button><p class="hint" style="margin:0;text-align:center">${it.task.primary ? SPK('Tip: answer first, then say why. “I like … because …”', '提示：先回答，再說原因。“I like … because …”') : SPK('Tip: answer the question first, give two reasons with an example, then round off.', '提示：先直接回答，再給兩個理由和例子，最後作總結。')}</p>`
        : R.state === 'rec' ? `<button class="btn ghost sp-go" id="spStop">■ ${SPK('I’ve finished', '我說完了')}</button>`
        : `<p class="muted wr-busy" style="justify-content:center"><span class="spinner sm" aria-hidden="true"></span>${SPK('Buddy is listening back and marking…', 'Buddy 正在重聽和評分…')}</p>`}
      <section class="card sp-live"><small class="ln-step">${SPK('What I heard', '我聽到的')}</small><p id="spTr">${esc(R.final)}<i>${esc(R.interim)}</i>${!R.final && !R.interim ? `<span class="muted">${SPK('Your words will appear here as you speak.', '你說話時，文字會在這裏出現。')}</span>` : ''}</p></section>
      ${R.err ? `<p class="hw-err" role="alert">${esc(R.err)}</p>` : ''}
    </main>`;
    document.getElementById('back').onclick = () => { stopAll(); go({ name: 'speaking', id: it.id }); };
    document.getElementById('spSay').onclick = () => sayQuestion(q);
    const g = document.getElementById('spGo'); if (g) g.onclick = start;
    const s = document.getElementById('spStop'); if (s) s.onclick = finish;
  };
  const paintTr = () => { const el = document.getElementById('spTr'); if (el) el.innerHTML = `${esc(R.final)}<i>${esc(R.interim)}</i>`; };
  let rec = null, media = null, stream = null, tick = null;
  const stopAll = () => {
    clearInterval(tick);
    if (rec) { rec.onend = null; try { rec.stop(); } catch (e) {} }
    if (media && media.state !== 'inactive') try { media.stop(); } catch (e) {}
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try { speechSynthesis.cancel(); } catch (e) {}
  };
  const start = async () => {
    if (!SREC) { R.err = SPK('This browser can’t turn speech into text. Please use Chrome, Edge or Safari.', '這個瀏覽器不能把說話轉成文字，請使用 Chrome、Edge 或 Safari。'); return draw(); }
    try { speechSynthesis.cancel(); } catch (e) {}
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { R.err = SPK('I need the microphone. Allow it in the browser and try again.', '需要使用咪高峰，請在瀏覽器允許後再試。'); return draw(); }
    try { media = new MediaRecorder(stream); media.ondataavailable = (e) => e.data.size && R.chunks.push(e.data); media.start(); } catch (e) { media = null; }
    const listen = () => {
      rec = new SREC(); rec.lang = 'en-GB'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        const now = Date.now(); if (R.lastHeard) R.pause = Math.max(R.pause, (now - R.lastHeard) / 1000); R.lastHeard = now;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) R.final += (R.final ? ' ' : '') + r[0].transcript.trim(); else interim += r[0].transcript; }
        R.interim = interim; paintTr();
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed') { R.err = SPK('Speech recognition was blocked. Allow the microphone and try again.', '語音辨識被封鎖，請允許咪高峰後再試。'); } };
      rec.onend = () => { if (R.state === 'rec') { try { listen(); } catch (e) {} } };
      try { rec.start(); } catch (e) {}
    };
    R.state = 'rec'; R.start = Date.now(); R.lastHeard = Date.now(); listen(); draw();
    tick = setInterval(() => {
      if (view !== myView) { stopAll(); return; }
      const left = Math.max(0, 60 - (Date.now() - R.start) / 1000);
      const a = document.getElementById('spArc'); if (a) a.style.strokeDashoffset = 326.7 * (1 - left / 60);
      const l = document.getElementById('spLeft'); if (l) l.textContent = fmtSecs(Math.ceil(left));
      if (left <= 0) finish();
    }, 250);
  };
  const finish = async () => {
    if (R.state !== 'rec') return;
    R.state = 'mark'; const secs = Math.min(60, (Date.now() - R.start) / 1000);
    clearInterval(tick);
    await new Promise((r) => setTimeout(r, 700)); // let the last words come in
    if (rec) { rec.onend = null; try { rec.stop(); } catch (e) {} }
    const blob = await new Promise((res) => { if (!media || media.state === 'inactive') return res(null); media.onstop = () => res(new Blob(R.chunks, { type: media.mimeType || 'audio/webm' })); try { media.stop(); } catch (e) { res(null); } });
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const tr = (R.final + ' ' + R.interim).trim();
    const words = (tr.match(/[A-Za-z’'-]+/g) || []).length;
    const fillers = (tr.match(/\b(um+|uh+|erm*|ah+|hmm+|you know|i mean)\b/gi) || []).length;
    R.final = tr; R.interim = '';
    if (view !== myView) return;
    draw();
    try {
      const fb = await api('speaking', { step: 'mark', task: { title: it.task.title, text: it.task.text }, question: q, transcript: tr, secs, words, fillers, pause: R.pause });
      delete fb.usage;
      const n = it.tries.length;
      it.tries.push({ t: Date.now(), qi, tr, secs: Math.round(secs), words, fillers, pause: Math.round(R.pause), fb, aud: blob ? 1 : 0 });
      if (it.tries.length > 30) it.tries = it.tries.slice(-30);
      if (blob) await store.set(`spaud:${it.id}:${n}`, blob);
      spSave(); if (secs >= 30 && words >= 30 && it.starDay !== dayStart()) { it.starDay = dayStart(); spSave(); addStars(2, 'speaking'); }
      if (view === myView) go({ name: 'speaking', id: it.id, sub: 'fb', qi });
    } catch (e) {
      R.state = 'ready'; R.err = wrErr(e); R.chunks = []; R.final = tr; R.pause = 0;
      if (view === myView) draw();
    }
  };
  draw();
  setTimeout(() => { if (view === myView && R.state === 'ready') sayQuestion(q); }, 400);
}

async function renderSpeakingFb(it, qi) {
  const idx = it.tries.map((t, k) => (t.qi === qi ? k : -1)).filter((k) => k >= 0);
  if (!idx.length) return go({ name: 'speaking', id: it.id });
  const k = idx[idx.length - 1], t = it.tries[k], fb = t.fb, prev = idx.length > 1 ? it.tries[idx[idx.length - 2]] : null;
  const blob = t.aud ? await store.get(`spaud:${it.id}:${k}`, null) : null;
  const url = blob ? URL.createObjectURL(blob) : '';
  const lv = spLevel(fb, it), plv = prev && spLevel(prev.fb, it), pk = !!it.task.primary;
  const wpm = Math.round(t.words / Math.max(1, t.secs) * 60);
  const pace = pk ? (wpm < 50 ? ['slow', 'A bit slow: try to keep going without long stops'] : wpm > 160 ? ['fast', 'Quite fast: slow down so every word is clear'] : ['ok', 'Good pace']) : wpm < 90 ? ['slow', 'A bit slow: aim for 110–150 words a minute'] : wpm > 170 ? ['fast', 'Quite fast: slow down a little so every word is clear'] : ['ok', 'Good pace'];
  const markFill = (s) => esc(s).replace(/\b(um+|uh+|erm*|ah+|hmm+|you know|i mean)\b/gi, '<mark class="sp-fill">$1</mark>');
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Topic', '題目')}</span></button><span style="font-weight:600;font-size:16px">${SPK('Feedback', '評語')}</span></div>
  <main class="pad stack g14 wrpage" data-view="speaking" data-raw style="flex:1">
    <section class="card sp-exq small"><span class="sp-ex">${buddySVG('happy', 40)}</span><div><p>${esc(it.task.questions[qi])}</p></div></section>
    <section class="card wr-score">
      <div class="wr-lvbox"><span class="wr-lv${pk ? ' stars' : ''}">${lvShow(lv)}</span><small>${pk ? `For a ${gradeLabel()} pupil` : 'Estimated level'}${plv && plv !== lv ? `<br><b class="${lv > plv ? 'wr-up' : 'wr-down'}">was ${plv}</b>` : ''}</small></div>
      <div class="wr-crits">${fb.criteria.map((c, j) => { const pc = prev && prev.fb.criteria[j], d = pc ? c.band - pc.band : 0; return `<div class="wr-crit"><div class="wr-ch"><b>${esc(c.name)}</b><span>${c.band}<small>/7</small>${d ? `<em class="${d > 0 ? 'wr-up' : 'wr-down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : ''}</span></div><div class="wr-bandbar"><i style="width:${(c.band / 7) * 100}%"></i></div><p>${esc(c.why)}</p></div>`; }).join('')}</div>
      <p class="wr-sum">${esc(fb.summary)}</p>
      <p class="wr-note">${pk ? 'Buddy’s marking for your grade, from a speech-to-text transcript.' : 'Estimate from AI marking of a speech-to-text transcript against the HKDSE speaking domains.'} Pronunciation can’t be judged from text: listen back to check it yourself.</p>
    </section>
    <section class="card sp-stats">
      <div><b>${t.secs}s</b><small>of 60 spoken</small></div><div class="${pace[0]}"><b>${wpm}</b><small>words / min</small></div><div><b>${t.fillers}</b><small>fillers (um, er…)</small></div><div><b>${t.pause}s</b><small>longest pause</small></div>
      <p>${pace[1]}${t.secs < (pk ? 25 : 45) ? (pk ? ' · Try to say a little more: one more reason or example.' : ' · Try to use most of the minute.') : ''}${t.pause >= 4 ? ' · Long pauses: a short phrase like “Let me think…” keeps you going.' : ''}</p>
      ${url ? `<audio controls src="${url}" class="sp-audio"></audio>` : ''}
    </section>
    <section class="card wr-box"><h2>📝 What I heard</h2><p class="sp-trx">${markFill(t.tr)}</p></section>
    <section class="card wr-box good"><h2>What you did well</h2><ul>${fb.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card wr-box fix"><h2>Fix these first</h2><ol class="wr-fixes">${fb.fixes.map((f) => `<li><b>${esc(f.issue)}</b>${f.quote ? `<q>${esc(f.quote)}</q>` : ''}<span>${esc(f.how)}</span></li>`).join('')}</ol></section>
    ${fb.phrases.length ? `<section class="card wr-box"><h2>Useful phrases for next time</h2><div class="sp-phr">${fb.phrases.map((p) => `<button class="sp-ph" data-say="${esc(p)}">🔊 ${esc(p)}</button>`).join('')}</div></section>` : ''}
    ${fb.sample ? `<section class="card wr-box"><button class="wr-tog" id="togSample" aria-expanded="false"><h2>One way to answer</h2><span>Show</span></button><div class="sp-sample" hidden><p>${esc(fb.sample)}</p><button class="btn-sm" id="saySample">🔊 Listen</button></div></section>` : ''}
    ${fb.next_step ? `<div class="wr-tip" data-keep>${esc(fb.next_step)}</div>` : ''}
    <div class="wr-acts"><button class="btn" id="again">🎤 Try this question again</button><button class="btn ghost" id="nextq">${qi + 1 < it.task.questions.length ? 'Next question' : 'Back to the topic'}</button></div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'speaking', id: it.id });
  $app.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => sayQuestion(b.dataset.say)));
  const ts = document.getElementById('togSample');
  if (ts) ts.onclick = () => { const d = $app.querySelector('.sp-sample'); d.hidden = !d.hidden; ts.setAttribute('aria-expanded', String(!d.hidden)); ts.querySelector('span').textContent = d.hidden ? 'Show' : 'Hide'; };
  const ss = document.getElementById('saySample'); if (ss) ss.onclick = () => sayQuestion(fb.sample);
  document.getElementById('again').onclick = () => go({ name: 'speaking', id: it.id, sub: 'rec', qi });
  document.getElementById('nextq').onclick = () => (qi + 1 < it.task.questions.length ? go({ name: 'speaking', id: it.id, sub: 'rec', qi: qi + 1 }) : go({ name: 'speaking', id: it.id }));
}

/* ---------- 默書 / spelling dictation (P1–P6) ----------
   A list is typed in or read from a photo. PrepBuddy reads each item aloud (Cantonese, Putonghua or English);
   the child writes it on paper and checks it against the answer, or types it and the app checks. Items they
   miss come back first next time. Lists and results are kept on this device. */
const DL = { yue: ['粵語', 'Cantonese', 'zh-HK'], cmn: ['普通話', 'Putonghua', 'zh-CN'], en: ['English', 'English', 'en-GB'], fr: ['法文', 'French', 'fr-FR'], ja: ['日文', 'Japanese', 'ja-JP'] };
const DT = (en, zh) => (LANG === 'zh' ? zh : en);
function dictVoice(lang) {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const want = lang === 'yue' ? (v) => /^(zh-HK|yue)/i.test(v.lang) || /Cantonese|粵|粤/i.test(v.name)
    : lang === 'cmn' ? (v) => /^zh[-_](CN|TW|Hans)/i.test(v.lang) || /Mandarin|普通話|普通话/i.test(v.name)
    : lang === 'fr' ? (v) => /^fr[-_]/i.test(v.lang) : lang === 'ja' ? (v) => /^ja[-_]/i.test(v.lang)
    : (v) => /^en[-_]/i.test(v.lang);
  const ok = vs.filter(want);
  const score = (v) => (/Natural|Online|Neural|Premium|Enhanced/i.test(v.name) ? 4 : 0) + (/Google/i.test(v.name) ? 2 : 0) + (lang === 'en' && /en[-_]GB/i.test(v.lang) ? 1 : 0) + (lang === 'fr' && /fr[-_]FR/i.test(v.lang) ? 1 : 0);
  return ok.sort((a, b) => score(b) - score(a))[0] || null;
}
// Reading aloud: a natural voice from the server (Azure neural voices: HK Cantonese, Putonghua, British English),
// kept on this device so each item is only fetched once. If the server has no voice set up, or there is no
// connection, the phone's own voice is used. "teacher" = read it, pause, read it again (how HK teachers read 默書).
let TTS_OFF = false, ttsEl = null, ttsSeq = 0;
// The voices a family can choose from (Settings → About your child → Reading voice). Short names; the server only accepts these.
const VOICE_OPTS = {
  yue: [['HiuGaai', '曉佳', 'Female · clear, like a teacher', '女聲 · 清晰，似老師'], ['HiuMaan', '曉曼', 'Female · bright and lively', '女聲 · 明亮活潑'], ['WanLung', '雲龍', 'Male · calm', '男聲 · 沉穩']],
  cmn: [['Xiaochen', '曉辰', 'Female · most natural (HD)', '女聲 · 最自然 (HD)'], ['Yunfan', '雲帆', 'Male · most natural (HD)', '男聲 · 最自然 (HD)'], ['Xiaoxiao', '曉曉', 'Female · classic', '女聲 · 經典']],
  en: [['Sonia', 'Sonia', 'Female · British', '女聲 · 英式'], ['Ryan', 'Ryan', 'Male · British', '男聲 · 英式'], ['Ava', 'Ava', 'Female · most natural (HD) · American accent', '女聲 · 最自然 (HD) · 美式口音']],
  fr: [['Denise', 'Denise', 'Female · clear', '女聲 · 清晰'], ['Henri', 'Henri', 'Male · calm', '男聲 · 沉穩'], ['Eloise', 'Eloise', 'Girl’s voice · friendly', '女孩聲 · 親切']],
  ja: [['Nanami', 'Nanami', 'Female · clear', '女聲 · 清晰'], ['Keita', 'Keita', 'Male · calm', '男聲 · 沉穩'], ['Aoi', 'Aoi', 'Girl’s voice · friendly', '女孩聲 · 親切']],
};
const voicePref = (lang) => { const l = local.learner || {}, v = l.voices && l.voices[lang]; return VOICE_OPTS[lang] && VOICE_OPTS[lang].some((o) => o[0] === v) ? v : ''; };
const ratePref = () => ((local.learner || {}).vrate === 'slower' ? 'slower' : '');
const TTS_URL = new Map();
async function ttsClip(text, lang, mode) {
  if (TTS_OFF) return null;
  const voice = voicePref(lang), rate = ratePref();
  const k = `${lang}|${mode}|${voice}|${rate}|${text}`;
  if (TTS_URL.has(k)) return TTS_URL.get(k);
  const key = `/tts-cache/v2/${encodeURIComponent(k)}`;
  let cache = null, blob = null;
  try { cache = await caches.open('pb-tts'); const hit = await cache.match(key); if (hit) blob = await hit.blob(); } catch (e) {}
  if (!blob) {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': local.code || '' }, body: JSON.stringify({ text, lang, mode, voice, rate }) }).catch(() => null);
    if (!r) return null;
    if (r.status === 501) { TTS_OFF = true; return null; }
    if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) return null;
    blob = await r.blob();
    try { if (cache) await cache.put(key, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } })); } catch (e) {}
  }
  const url = URL.createObjectURL(blob); TTS_URL.set(k, url); return url;
}
function ttsPlayer() { if (!ttsEl) { ttsEl = new Audio(); ttsEl.preload = 'auto'; } return ttsEl; }
// iPhones only let a page play sound after a tap, so the player is "unlocked" with a silent clip on the first tap.
document.addEventListener('pointerdown', function unlockTts() {
  document.removeEventListener('pointerdown', unlockTts, true);
  try { const a = ttsPlayer(); a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}, true);
function stopSaying() { ttsSeq++; try { speechSynthesis.cancel(); } catch (e) {} if (ttsEl) { try { ttsEl.onended = null; ttsEl.pause(); } catch (e) {} } sayPill(null); }
// While Buddy reads aloud, a pill at the bottom shows it's getting ready or reading, with a Stop button.
let sayingText = '';
function sayPill(state) {
  let p = document.getElementById('sayPill');
  if (!state) { sayingText = ''; if (p) p.remove(); return; }
  if (!p) { p = document.createElement('button'); p.id = 'sayPill'; p.type = 'button'; p.className = 'say-pill'; p.onclick = () => stopSaying(); document.body.appendChild(p); }
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  p.classList.toggle('load', state === 'load');
  p.innerHTML = `${state === 'load' ? '<span class="sp-spin" aria-hidden="true"></span>' : '<span class="sp-wave" aria-hidden="true"><i></i><i></i><i></i></span>'}<span>${state === 'load' ? C('Getting ready…', '準備中…') : C('Reading…', '朗讀中…')}</span><b>■ ${C('Stop', '停止')}</b>`;
  p.setAttribute('aria-label', C('Stop reading', '停止朗讀'));
}
// Long text is read in short pieces: the first sentence starts within a second or two while the rest loads behind it.
function speechChunks(t) {
  const bits = String(t).match(/[^.!?。！？；;\n]+[.!?。！？；;\n]*["”’」』)）]*\s*/g) || [t];
  const out = []; let cur = '';
  const cap = () => (out.length ? 280 : 120);
  const push = (x) => { x = x.trim(); if (x) out.push(x); };
  for (let b of bits) {
    while (b.length > 300) { // a very long sentence: break at a comma or space
      let cut = Math.max(b.lastIndexOf(',', 280), b.lastIndexOf('，', 280), b.lastIndexOf('、', 280));
      if (cut < 80) cut = b.lastIndexOf(' ', 280); if (cut < 80) cut = 280;
      push(cur); cur = ''; push(b.slice(0, cut + 1)); b = b.slice(cut + 1);
    }
    if (cur && (cur + b).length > cap()) { push(cur); cur = ''; }
    cur += b;
    if (!out.length && cur.length >= 40) { push(cur); cur = ''; } // keep the first piece short so it starts fast
  }
  push(cur);
  return out.length ? out : [t];
}
function phoneSay(text, lang, slow, teacher, my) {
  if (!window.speechSynthesis) { toast(DT('This browser can’t read aloud. Try Chrome, Edge or Safari.', '這個瀏覽器不能朗讀，請用 Chrome、Edge 或 Safari。')); return; }
  const one = () => { const u = new SpeechSynthesisUtterance(text); const v = dictVoice(lang); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = DL[lang][2]; u.rate = slow ? 0.55 : 0.8; return u; };
  speechSynthesis.cancel();
  const u = one();
  if (teacher) u.onend = () => setTimeout(() => { if (my === ttsSeq) speechSynthesis.speak(one()); }, 1300);
  speechSynthesis.speak(u);
}
function sayItem(text, lang, slow, teacher) {
  stopSaying(); const my = ttsSeq;
  const mode = slow ? 'slow' : teacher ? 'teacher' : 'normal';
  (async () => {
    const url = await ttsClip(text, lang, mode);
    if (my !== ttsSeq) return;
    if (url) { const a = ttsPlayer(); a.src = url; try { await a.play(); return; } catch (e) {} }
    if (my === ttsSeq) phoneSay(text, lang, slow, teacher, my);
  })();
  return TTS_OFF ? !!dictVoice(lang) : true;
}
// Fetch the next item's clip early so it plays straight away.
function ttsPrefetch(text, lang) { if (text && !TTS_OFF) ttsClip(text, lang, 'teacher').catch(() => {}); }
try { speechSynthesis.getVoices(); } catch (e) {}
const normDict = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s，,。.、！!？?；;：:「」『』“”"'‘’()（）]/g, '');

async function renderDictation(id, sub) {
  const lists = local.dict || (local.dict = []);
  const L = id && lists.find((x) => x.id === id);
  if (L && sub === 'run') return runDictation(L);
  if (L && sub === 'edit') return editDictation(L);
  if (id === 'new') return editDictation(null);
  const missed = (x) => x.items.filter((_, i) => (x.res || {})[i] && x.res[i].due).length;
  $app.innerHTML = `
  ${backTop({name:'home'}, 'Today')}
  <main class="pad stack g18 dictpage" data-view="dictation" data-raw style="flex:1">
    <h1 class="pagetitle">${DT('Dictation', '默書')}</h1>
    <section class="hw-hero">${buddySVG('happy', 56)}<div><b>${DT('I read the words, you write them.', '我讀，你寫。')}</b>
      <span>${DT('Add this week’s dictation or spelling list. I read each one aloud in Cantonese, Putonghua, English, French or Japanese. Write it down, then check. Words you miss come back next time.', '加入今個星期的默書或串字。我會用粵語、普通話、英文、法文或日文逐個讀出來，你寫低再對答案。寫錯的會在下次再出現。')}</span></div></section>
    <button class="btn" id="dnew">+ ${DT('Add a dictation list', '加入默書')}</button>
    ${lists.length ? `<div class="hw-list">${lists.slice().reverse().map((x) => { const m = missed(x), last = (x.runs || []).slice(-1)[0];
      return `<div class="dl-item"><button class="dl-main" data-run="${x.id}"><span class="hw-ic">${actionIcon('dictation', 22)}</span><span class="hw-it"><b data-keep>${esc(x.title)}</b><small>${DL[x.lang][LANG === 'zh' ? 0 : 1]} · ${x.items.length} ${DT('items', '項')}${last ? ` · ${DT('last', '上次')} ${last.g}/${last.n}` : ''}${m ? ` · <span class="dl-miss">${DT(`${m} to practise`, `${m} 個要再練`)}</span>` : ''}</small></span><span class="dl-go">▶</span></button>
        <button class="btn-sm quiet" data-edit="${x.id}">${DT('Edit', '修改')}</button></div>`; }).join('')}</div>`
      : `<div class="card mk-empty">${buddySVG('think', 64)}<div class="stack g6"><b>${DT('No dictation lists yet', '還沒有默書')}</b><span class="muted">${DT('Snap or type this week’s spelling list. I’ll read each word aloud, you write it, then we check together.', '拍下或輸入這星期的默書範圍。我會逐個讀出，你寫下來，然後一起核對。')}</span></div></div>`}
  </main>`;
  document.getElementById('dnew').onclick = () => go({ name: 'dictation', id: 'new' });
  $app.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => go({ name: 'dictation', id: b.dataset.run, sub: 'run' })));
  $app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => go({ name: 'dictation', id: b.dataset.edit, sub: 'edit' })));
}

function editDictation(L) {
  const st = { title: L ? L.title : '', lang: L ? L.lang : (LANG === 'zh' ? zhVoice() : 'en'), text: L ? L.items.join('\n') : '', busy: false, err: '' };
  const draw = () => {
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${DT('Dictation', '默書')}</span></button><span style="font-weight:600;font-size:16px">${L ? DT('Edit list', '修改默書') : DT('New list', '新默書')}</span></div>
    <main class="pad stack g14 dictpage" data-view="dictation" data-raw style="flex:1">
      <label class="dl-lab" for="dtitle">${DT('Name', '名稱')}</label>
      <input id="dtitle" class="input" maxlength="60" placeholder="${DT('e.g. Chinese Lesson 5 or Spelling Unit 3', '例如：中文默書 第五課')}" value="${esc(st.title)}">
      <span class="dl-lab">${DT('Read aloud in', '朗讀語言')}</span>
      <div class="seg" role="radiogroup">${Object.entries(DL).map(([k, v]) => `<button role="radio" aria-checked="${st.lang === k}" class="${st.lang === k ? 'on' : ''}" data-lang="${k}">${LANG === 'zh' ? v[0] : v[1]}</button>`).join('')}</div>
      <div class="dl-row"><label class="dl-lab" for="ditems">${DT('Words or sentences, one per line', '詞語或句子，每行一個')}</label>
        <label class="btn-sm" style="cursor:pointer">${DT('Read from a photo', '從相片讀取')}<input type="file" accept="image/*" id="dphoto" hidden></label></div>
      <textarea id="ditems" class="input dl-ta" rows="10" placeholder="${DT('膝蓋\n醫治\n康復\n…', '膝蓋\n醫治\n康復\n…')}">${esc(st.text)}</textarea>
      ${st.busy ? `<p class="muted" style="margin:0">${DT('Reading the list…', '正在讀取…')}</p>` : ''}${st.err ? `<p class="hw-err">${esc(st.err)}</p>` : ''}
      <div class="rd-row">${L ? `<button class="btn ghost" id="ddel">${DT('Delete', '刪除')}</button>` : `<span></span>`}<button class="btn" id="dsave">${DT('Save', '儲存')}</button></div>
    </main>`;
    const keep = () => { st.title = document.getElementById('dtitle').value; st.text = document.getElementById('ditems').value; };
    document.getElementById('back').onclick = () => go({ name: 'dictation' });
    $app.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { keep(); st.lang = b.dataset.lang; st.picked = true; draw(); }));
    document.getElementById('dphoto').onchange = async (e) => {
      keep(); const f = e.target.files[0]; if (!f) return;
      st.busy = true; st.err = ''; draw();
      try {
        const img = await shrinkPhoto(f, 1800);
        const r = await api('homework', { step: 'list', images: [img], lang: LANG });
        st.text = (st.text.trim() ? st.text.trim() + '\n' : '') + r.items.join('\n');
        if (!st.title) st.title = r.title; st.lang = r.lang;
      } catch (err) { st.err = err.status === 0 ? DT('You seem to be offline.', '你好像離線了。') : (err.message || DT('Couldn’t read the photo.', '讀取相片失敗。')); }
      st.busy = false; draw();
    };
    document.getElementById('dsave').onclick = () => {
      { const ta = document.getElementById('ditems'); const tx = ta ? ta.value : st.text; if (!st.picked && !L && st.lang === 'en') { const g = langOf(tx); if (g !== 'en') st.lang = voiceOf(g); } } // Chinese words left on English: read them in Cantonese
      keep();
      const items = st.text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 60);
      if (!items.length) { st.err = DT('Add at least one word.', '請最少加入一個詞語。'); return draw(); }
      const title = st.title.trim() || DT('Dictation', '默書');
      if (L) {
        // results stay with items that didn't change
        const old = new Map(L.items.map((t, i) => [t, (L.res || {})[i]]));
        L.res = Object.fromEntries(items.map((t, i) => [i, old.get(t)]).filter((x) => x[1]));
        Object.assign(L, { title, lang: st.lang, items });
      } else (local.dict = local.dict || []).push({ id: uid(), t: Date.now(), title, lang: st.lang, items, res: {}, runs: [] });
      saveLocal(); go({ name: 'dictation' });
    };
    const d = document.getElementById('ddel');
    if (d) d.onclick = async () => { if (await confirmLeave({ title: DT('Delete this list?', '刪除這個默書？'), body: L.title, leave: DT('Delete', '刪除'), stay: DT('Keep it', '保留') })) { local.dict = local.dict.filter((x) => x !== L); saveLocal(); go({ name: 'dictation' }); } };
  };
  draw();
}

function runDictation(L) {
  L.res = L.res || {};
  // missed items first (they're "due"), then the rest in the list's order, like a real 默書
  const order = L.items.map((_, i) => i);
  const due = order.filter((i) => L.res[i] && L.res[i].due);
  const R = { mode: local.dictMode || 'paper', order: [...due, ...order.filter((i) => !due.includes(i))], k: 0, shown: false, typed: '', marks: {}, onlyMissed: false };
  const finish = () => {
    const n = Object.keys(R.marks).length, g = Object.values(R.marks).filter(Boolean).length;
    L.runs = [...(L.runs || []), { t: Date.now(), n, g }].slice(-20); saveLocal();
    const won = n && g / n >= STAR_PASS / 100 ? (() => { const a = addStars(1, 'dictation'); const b = g === n && n >= 3 && R.mode !== 'paper' ? addStars(1, 'dictation-perfect') : 0; return a + b ? { n: a + b, lines: [[DT('Finished a dictation', '完成默書'), a], ...(b ? [[DT('Every word right!', '全部正確！'), b]] : [])].filter((x) => x[1]), badges: checkBadges({}), capped: false } : null; })() : null;
    const miss = Object.entries(R.marks).filter(([, ok]) => !ok).map(([i]) => L.items[i]);
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${DT('Dictation', '默書')}</span></button></div>
    <main class="pad stack g18 dictpage" data-view="dictation" data-raw style="flex:1;align-items:stretch">
      <section class="dl-done">${buddySVG(g === n ? 'happy' : 'think', 72)}<b class="dl-score">${g} / ${n}</b><span>${g === n ? DT('Every word right. Brilliant!', '全部正確，好叻！') : DT('Good effort! Practise the ones you missed.', '做得好！再練習寫錯的詞語。')}</span></section>
      ${miss.length ? `<section class="card stack g10" style="padding:16px"><b>${DT('To practise again', '要再練習')}</b><div class="dl-miss-list">${miss.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <button class="btn" id="again">${DT(`Practise these ${miss.length} again`, `再練習這 ${miss.length} 個`)}</button></section>` : ''}
      <button class="btn ghost" id="fin">${DT('Done', '完成')}</button>
    </main>`;
    document.getElementById('back').onclick = document.getElementById('fin').onclick = () => go({ name: 'dictation' });
    const a = document.getElementById('again'); if (a) a.onclick = () => { R.order = Object.entries(R.marks).filter(([, ok]) => !ok).map(([i]) => +i); R.k = 0; R.marks = {}; R.shown = false; R.typed = ''; draw(); };
    if (won && starsOn()) setTimeout(() => celebrate(won), 400);
  };
  const mark = (ok) => {
    const i = R.order[R.k], r = L.res[i] || (L.res[i] = { n: 0, wrong: 0 });
    r.n++; if (!ok) r.wrong++; r.due = !ok; r.last = Date.now();
    R.marks[i] = ok; saveLocal();
    R.k++; R.shown = false; R.typed = '';
    if (R.k >= R.order.length) return finish();
    draw(); setTimeout(() => sayItem(L.items[R.order[R.k]], L.lang, false, true), 350);
  };
  const draw = () => {
    const i = R.order[R.k], text = L.items[i], n = R.order.length;
    const okTyped = R.mode === 'type' && R.shown ? normDict(R.typed) === normDict(text) : null;
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="quit" data-kind="dict">${ICON.back}<span>${DT('Stop', '停止')}</span></button><div class="progress"><i style="width:${Math.round(100 * R.k / n)}%"></i></div><span class="count">${R.k + 1} / ${n}</span></div>
    <main class="pad stack g18 dictrun" data-view="dictation" data-raw style="flex:1">
      <div class="seg dl-mode" role="radiogroup" aria-label="${DT('How to answer', '作答方式')}"><button role="radio" class="${R.mode === 'paper' ? 'on' : ''}" data-mode="paper">${DT('Write on paper', '寫在紙上')}</button><button role="radio" class="${R.mode === 'type' ? 'on' : ''}" data-mode="type">${DT('Type it', '打字')}</button></div>
      <section class="dl-play">
        <button class="dl-big" id="play" aria-label="${DT('Read it aloud', '朗讀')}">🔊</button>
        <div class="dl-ctrls"><button class="btn-sm" id="again1">${DT('Again', '再聽一次')}</button><button class="btn-sm" id="slow">${DT('Slowly', '慢一點')}</button></div>
        ${L.res[i] && L.res[i].due ? `<span class="dl-tag">${DT('You missed this last time', '上次寫錯了')}</span>` : ''}
        <p class="hint" id="novoice" hidden>${DT('No voice for this language on this device. A parent can read it out instead:', '這部機沒有這種語言的聲音，請家長讀出來：')} <b>${esc(text)}</b></p>
      </section>
      ${R.mode === 'type' ? `<input id="dtyped" class="input dl-type" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${DT('Type what you hear', '輸入你聽到的')}" value="${esc(R.typed)}" ${R.shown ? 'disabled' : ''}>` : ''}
      ${R.shown ? `<section class="dl-ans ${okTyped === null ? '' : okTyped ? 'ok' : 'no'}"><small>${DT('Answer', '答案')}</small><b>${esc(text)}</b>${okTyped === false ? `<small>${DT('You wrote', '你寫了')}: ${esc(R.typed || '—')}</small>` : ''}</section>
        ${R.mode === 'paper' ? `<p class="dl-q">${DT('Did you write it exactly right?', '你寫對了嗎？')}</p><div class="rd-row"><button class="btn ghost" id="no">✗ ${DT('Not quite', '寫錯了')}</button><button class="btn" id="yes">✓ ${DT('Right', '寫對了')}</button></div>`
          : `<button class="btn" id="next">${DT('Next', '下一個')}</button>`}`
        : `<button class="btn" id="show">${R.mode === 'type' ? DT('Check', '檢查') : DT('I’ve written it: show the answer', '寫好了，看答案')}</button>`}
    </main>`;
    const say = (slow) => { if (sayItem(text, L.lang, slow) === false) document.getElementById('novoice').hidden = false; };
    ttsPrefetch(L.items[R.order[R.k + 1]], L.lang);
    document.getElementById('play').onclick = () => say(false);
    document.getElementById('again1').onclick = () => say(false);
    document.getElementById('slow').onclick = () => say(true);
    if (TTS_OFF && !dictVoice(L.lang) && speechSynthesis.getVoices().length) document.getElementById('novoice').hidden = false;
    $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { R.mode = local.dictMode = b.dataset.mode; saveLocal(); R.shown = false; draw(); }));
    document.getElementById('quit').onclick = async () => { stopSaying(); if (!R.k || await confirmLeave({ title: DT('Stop this dictation?', '停止這次默書？'), body: DT('Words you’ve marked so far are saved.', '已核對的詞語會保存。'), leave: DT('Stop', '停止'), stay: DT('Keep going', '繼續') })) go({ name: 'dictation' }); };
    const sh = document.getElementById('show'); if (sh) sh.onclick = () => { const t = document.getElementById('dtyped'); if (t) R.typed = t.value; R.shown = true; draw(); };
    const ty = document.getElementById('dtyped'); if (ty && !R.shown) { ty.focus(); ty.onkeydown = (e) => { if (e.key === 'Enter') sh.click(); }; }
    const y = document.getElementById('yes'); if (y) y.onclick = () => mark(true);
    const no = document.getElementById('no'); if (no) no.onclick = () => mark(false);
    const nx = document.getElementById('next'); if (nx) { nx.onclick = () => mark(okTyped); nx.focus(); }
  };
  draw();
  setTimeout(() => sayItem(L.items[R.order[0]], L.lang, false, true), 500);
}

/* ---------- Learn mode: a guided lesson before practising ----------
   Explain → example → quick check, one idea at a time, then a summary and straight into practice.
   Each lesson is written once per chapter and kept on this device. */
const lessonJobs = new Map();
function getLesson(book, unit, fresh) {
  const key = `lesson:${book.id}:${unit.id}`;
  if (!fresh && lessonJobs.has(key)) return lessonJobs.get(key);
  const p = (async () => {
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    const lg = langOf(text);
    // A lesson saved in another language than the chapter's (e.g. English for a Japanese book) is written again.
    if (!fresh) { const have = await store.get(key, null); if (have && Array.isArray(have.steps) && have.steps.length && have.v >= 5 && (have.lang === lg || (!have.lang && lg !== 'fr' && lg !== 'ja'))) return have; }
    if (!text) throw new Error('This chapter’s text is missing on this device.');
    const l = await api('learn', { title: unit.title, text, kind: kindOfBook(book), lang: lg });
    if (!l || !Array.isArray(l.steps) || !l.steps.length) throw new Error('Buddy couldn’t put this lesson together. Please try again.');
    delete l.usage; l.at = Date.now(); l.v = 5; l.lang = lg; // v5 (16 Nov): teach content not the page; native-teacher review for French/Japanese
    await store.set(key, l);
    return l;
  })();
  lessonJobs.set(key, p);
  p.catch(() => lessonJobs.delete(key));
  return p;
}
// Starter-book extras in a chapter's text: a "Key words" list ("- word: meaning") and a "Your task" writing task.
function unitExtras(text) {
  const t = String(text || '').replace(/\r/g, '');
  const kw = /(^|\n)Key words\n((?:- .+\n?)+)/.exec(t);
  const words = kw ? kw[2].split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 ? { w: l.slice(0, i).trim(), m: l.slice(i + 1).trim() } : { w: l, m: '' }; }) : [];
  const tk = /(^|\n)Your task\n([\s\S]+)$/.exec(t);
  return { words: words.slice(0, 12), task: tk ? tk[2].trim().slice(0, 600) : '' };
}
function keyWordsDictation(book, unit, words) {
  const src = `${book.id}:${unit.id}`;
  const lists = local.dict || (local.dict = []);
  let L = lists.find((x) => x.src === src);
  if (!L) { L = { id: uid(), t: Date.now(), src, title: `${cleanUnitTitle(unit.title)} · key words`.slice(0, 60), lang: 'en', items: words.map((x) => x.w), res: {}, runs: [] }; lists.push(L); saveLocal(); }
  go({ name: 'dictation', id: L.id, sub: 'run' });
}
function unitWritingTask(book, unit, task) {
  const src = `${book.id}:${unit.id}`;
  const list = local.wr || [];
  let it = list.find((x) => x.src === src && !(x.drafts || []).length);
  if (!it) { it = { id: uid(), t: Date.now(), src, kind: WR_KINDS.en_p && (isPrimaryKid() || /^P/i.test(book.level || '')) ? 'en_p' : (Object.keys(WR_KINDS).find((k) => WR_KINDS[k].lang === 'en' && !WR_KINDS[k].primary) || 'en_p'), title: `${cleanUnitTitle(unit.title)} · task`.slice(0, 60), prompt: task, work: '', drafts: [] }; local.wr = [...list, it]; wrSave(); }
  go({ name: 'writing', id: it.id });
}
// Where the Back button of a lesson / notes / flashcards goes (backTo is declared above go()).
const leaveTo = (bookId) => (backTo ? go(backTo) : go({ name: 'book', bookId }));
const backLabel = (book) => (backTo && backTo.name !== 'book' ? (backTo.name === 'chapters' ? ({ learn: LANG === 'zh' ? '課堂' : 'Lessons', notes: LANG === 'zh' ? '筆記' : 'Notes', cards: LANG === 'zh' ? '閃卡' : 'Flashcards' }[backTo.mode] || (LANG === 'zh' ? '練習題' : 'Questions')) : (LANG === 'zh' ? '練習' : 'Practice')) : book);
async function renderLearn(bookId, unitId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  const unit = book && book.units.find((u) => u.id === unitId);
  if (!unit) return go({ name: 'home' });
  if (!allow('lesson')) return go({ name: 'book', bookId });
  meter('lesson');
  const myView = view, zh = LANG === 'zh';
  const T = (en, z) => (zh ? z : en);
  $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${backLabel(T('Chapter', '章節'))}</span></button><span style="font-weight:600;font-size:16px" data-raw>${esc(shortTitle(unit.title))}</span></div>
    <main class="pad stack g18 learnpage" data-view="learn" style="flex:1;align-items:center;justify-content:center;text-align:center">
      ${buddySVG('think', 64)}<b style="font-size:18px">${T('Getting your lesson ready…', '正在準備你的課堂…')}</b><span class="muted">${T('Buddy is reading the chapter and planning how to teach it. This takes up to a minute the first time.', 'Buddy 正在閱讀這一章並準備教學，第一次大約需要半分鐘。')}</span><div class="spinner" aria-hidden="true"></div><div class="wslot" id="lwait" hidden></div></main>`;
  document.getElementById('back').onclick = () => leaveTo(bookId);
  const stopWait = mountWaitCards(document.getElementById('lwait'), book, [unit]);
  let L;
  try { L = await getLesson(book, unit); } catch (e) {
    stopWait();
    if (view !== myView) return;
    $app.querySelector('main').innerHTML = `<b>${T('Couldn’t make the lesson', '未能準備課堂')}</b><span class="muted">${esc(e.status === 0 ? T('You seem to be offline.', '你好像離線了。') : (e.message || ''))}</span><button class="btn" id="retry">${T('Try again', '再試')}</button>`;
    document.getElementById('retry').onclick = () => renderLearn(bookId, unitId);
    return;
  }
  if (view !== myView) return;
  const UX = book.kind === 'language' || kindOfBook(book) === 'language' ? unitExtras(await store.get(`text:${bookId}:${unitId}`, '')) : { words: [], task: '' };
  const lsKey = `${bookId}:${unitId}`;
  const saved = (local.lessonAt || {})[lsKey];
  const R = { k: -1, picked: {}, right: 0, msgs: [], busy: false, err: null };
  if (saved && Date.now() - saved.t < 7 * DAY && saved.k < L.steps.length) { Object.assign(R, { k: saved.k, picked: saved.picked || {}, right: saved.right || 0, msgs: saved.msgs || [] }); setTimeout(() => toast(T(`Picking up where you left off: step ${saved.k + 1}`, `由上次的第 ${saved.k + 1} 步繼續`)), 300); }
  const keepPlace = () => { local.lessonAt = local.lessonAt || {}; if (R.k >= 0 && R.k < L.steps.length) local.lessonAt[lsKey] = { t: Date.now(), n: L.steps.length, title: unit.title, k: R.k, picked: R.picked, right: R.right, msgs: R.msgs.filter((m) => !m.live).slice(-20) }; else delete local.lessonAt[lsKey]; saveLocal(); };
  const n = L.steps.length;
  const chText = await store.get(`text:${book.id}:${unit.id}`, '');
  if (view !== myView) return;
  $app.querySelector('main').outerHTML = `<main class="pad learnpage withchat" data-view="learn" data-raw style="flex:1"><div class="ln-main stack g18" id="lnMain"></div>
    <section class="tchat ln-chat" id="lnchat" aria-label="${T('Ask Buddy', '問 Buddy')}"></section></main>`;
  const chips = () => {
    if (R.k < 0) return [T('What will I learn?', '我會學到甚麼？'), T('Why does this matter?', '學這個有甚麼用？')];
    if (R.k >= n) return [T('What should I remember most?', '最重要要記住甚麼？'), T('Ask me a question to test me', '問我一條問題考考我')];
    const c = L.steps[R.k].check, done = R.picked[R.k] !== undefined;
    return [T('Explain this another way', '用另一個方法解釋'), T('Give me another example', '再給我一個例子'),
      ...(c ? [done ? T('Why is that the answer?', '為甚麼是這個答案？') : T('Help me with the quick check', '小測給我一點提示')] : [])];
  };
  const drawChat = () => {
    const box = document.getElementById('lnchat'); if (!box) return;
    const where = R.k < 0 ? '' : R.k >= n ? '' : T(`On step ${R.k + 1}: ${L.steps[R.k].heading}`, `第 ${R.k + 1} 步：${L.steps[R.k].heading}`);
    box.innerHTML = `<div class="thead"><b class="thead-t">${buddySVG('happy', 28)}<span>${T('Ask Buddy', '問 Buddy')}<small>${esc(where || T('Your tutor for this lesson', '這一課的導師'))}</small></span></b></div>
      <div class="tlog" id="lnlog">
        ${!R.msgs.length ? `<div class="tmsg ai tmsg-ui">${T('I’m right here while you learn. If something doesn’t make sense, ask me: I can explain it another way, give you a new example, or help with the quick check.', '你上課時我都在這裏。有不明白的地方就問我：我可以換個方法解釋、再給你例子，或者幫你想小測。')}</div>` : ''}
        ${R.msgs.map((m) => m.role === 'user' ? `<div class="tmsg me nomath">${esc(m.text)}</div>` : `<div class="tmsg ai">${tutorMd(m.text)}</div>`).join('')}
        ${R.busy && !(R.msgs[R.msgs.length - 1] || {}).live ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}
        ${R.err ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(R.err)}</p>` : ''}
      </div>
      ${R.busy ? '' : `<div class="tchips">${chips().map((t) => `<button class="tchip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="tform" id="lnform"><input id="lnq" class="tinput" placeholder="${T('Ask Buddy anything about this…', '有甚麼問題都可以問 Buddy…')}" autocomplete="off" ${R.busy ? 'disabled' : ''}><button class="tsend" aria-label="${T('Send', '傳送')}" ${R.busy ? 'disabled' : ''}>${ICON.send}</button></form>`;
    renderMath(box);
    const log = document.getElementById('lnlog'); if (log) log.scrollTop = log.scrollHeight;
    box.querySelectorAll('[data-say]').forEach((x) => (x.onclick = () => askBuddy(x.textContent.trim() || x.dataset.say)));
    document.getElementById('lnform').onsubmit = (e) => { e.preventDefault(); askBuddy(document.getElementById('lnq').value); };
  };
  const askBuddy = async (t) => {
    t = String(t || '').trim(); if (!t || R.busy) return;
    const history = R.msgs.slice(-10).map((m) => ({ role: m.role, text: m.text }));
    R.msgs.push({ role: 'user', text: t }); R.busy = true; R.err = null; drawChat();
    if (!desk()) { const c = document.getElementById('lnchat'); if (c) c.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
    const inStep = R.k >= 0 && R.k < n;
    const req = { title: unit.title, text: chText, lang: langOf(chText), ask: t, history, where: R.k < 0 ? 'start' : R.k >= n ? 'end' : 'step',
      step: inStep ? L.steps[R.k] : null, picked: inStep && R.picked[R.k] !== undefined ? R.picked[R.k] : null };
    if (inStep && R.picked[R.k] === undefined && req.step.check) req.step = { ...req.step, check: { question: req.step.check.question, options: req.step.check.options } };
    let live = null;
    try {
      const r = await apiStream('learn', req, (d) => {
        if (!live) { live = { role: 'assistant', text: '', live: true }; R.msgs.push(live); drawChat(); }
        live.text += d;
        const els = document.querySelectorAll('#lnlog .tmsg.ai'); const el = els[els.length - 1];
        if (el) { el.innerHTML = tutorMd(live.text); const log = document.getElementById('lnlog'); if (log) log.scrollTop = log.scrollHeight; }
      });
      if (live) { live.text = r.reply || live.text; delete live.live; } else R.msgs.push({ role: 'assistant', text: r.reply });
    } catch (e) {
      if (live) R.msgs.pop();
      R.msgs.pop();
      R.err = e.status === 0 ? T('You seem to be offline.', '你好像離線了。') : (e.message || T('Buddy is not available right now.', 'Buddy 暫時未能回答。'));
    }
    R.msgs = R.msgs.slice(-40); R.busy = false; keepPlace();
    if (view === myView) drawChat();
  };
  const draw = (answered) => {
    const dots = `<div class="ln-dots">${L.steps.map((_, i) => `<i class="${i < R.k ? 'done' : i === R.k ? 'on' : ''}"></i>`).join('')}</div>`;
    let body;
    if (R.k < 0) {
      body = `<section class="ln-card ln-start">${buddySVG('happy', 64)}<h1>${esc(cleanUnitTitle(unit.title))}</h1>${L.intro ? `<div class="ln-x">${tutorMd(L.intro)}</div>` : ''}
        <span class="muted">${T(`${n} short steps, each with an example and a quick check. About ${Math.max(5, n * 2)} minutes.`, `共 ${n} 個小步驟，每步都有例子和小測，大約 ${Math.max(5, n * 2)} 分鐘。`)}</span>
        <button class="btn" id="go1">${T('Start the lesson', '開始上課')} →</button></section>`;
    } else if (R.k >= n) {
      body = `<section class="ln-card ln-end">${buddySVG('done', 64)}<h1>${T('Lesson done!', '完成課堂！')}</h1>
        <span class="muted">${T(`Quick checks: ${R.right} of ${L.steps.filter((s) => s.check).length} right first time`, `小測：第一次答對 ${R.right}／${L.steps.filter((s) => s.check).length} 題`)}</span>
        ${L.summary.length ? `<div class="ln-sum"><b>${T('Remember', '記住')}</b><ul>${L.summary.map((s) => `<li>${tutorMd(s).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul></div>` : ''}
        ${UX.words.length ? `<div class="ln-sum ln-kw"><b>${T('Key words', '重點詞彙')}</b><ul>${UX.words.map((x) => `<li><b>${esc(x.w)}</b>${x.m ? ` · ${esc(x.m)}` : ''}</li>`).join('')}</ul></div>` : ''}
        <button class="btn" id="practise">${T('Practise this chapter now', '現在練習這一章')} →</button>
        ${UX.words.length || UX.task ? `<div class="rd-row">${UX.words.length ? `<button class="btn ghost" id="kwdict">${T('Key words dictation', '重點詞彙默書')}</button>` : ''}${UX.task ? `<button class="btn ghost" id="utask">✍️ ${T('Do the writing task', '完成寫作任務')}</button>` : ''}</div>` : ''}
        <div class="rd-row"><button class="btn ghost" id="again">${T('Go through it again', '再上一次')}</button><button class="btn ghost" id="done">${T('Back to the chapter', '返回章節')}</button></div></section>`;
    } else {
      const s = L.steps[R.k], c = s.check, p = R.picked[R.k];
      body = `<section class="ln-card">
        <small class="ln-step">${T(`Step ${R.k + 1} of ${n}`, `第 ${R.k + 1}／${n} 步`)}</small>
        <h2>${esc(s.heading)}</h2>
        <div class="ln-x">${tutorMd(s.explain)}</div>
        ${s.example ? `<div class="ln-ex"><b>${T('Example', '例子')}</b><div data-keep>${tutorMd(s.example)}</div></div>` : ''}
        ${c ? `<div class="ln-check"><b>${T('Quick check', '小測')}</b><div class="ln-q">${tutorMd(c.question)}</div>
          <div class="ln-opts">${c.options.map((o, i) => `<button class="ln-opt ${p !== undefined ? (i === c.answer ? 'ok' : i === p ? 'no' : '') : ''}" data-opt="${i}" ${p !== undefined ? 'disabled' : ''}><span>${'ABCD'[i]}</span>${tutorMd(o).replace(/^<p>|<\/p>$/g, '')}</button>`).join('')}</div>
          ${p !== undefined ? `<p class="ln-why ${p === c.answer ? 'ok' : 'no'}"><b>${p === c.answer ? T('Yes! ', '答對了！') : T('Not quite. ', '差一點。')}</b><span data-keep>${esc(c.why)}</span></p>` : ''}</div>` : ''}
        <div class="rd-row"><button class="btn ghost" id="prev">${T('Back', '上一步')}</button><button class="btn" id="next" ${c && p === undefined ? 'disabled' : ''}>${R.k === n - 1 ? T('Finish', '完成') : T('Next', '下一步')} →</button></div>
        ${c && p === undefined ? `<span class="hint" style="text-align:center">${T('Answer the quick check to go on.', '先回答小測再繼續。')} <button class="linkbtn" id="askb">${T('Stuck? Ask Buddy for a hint', '不明白？問 Buddy 拿提示')}</button></span>` : ''}
      </section>`;
    }
    const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
    keepPlace();
    const lm = document.getElementById('lnMain'); if (!lm) return;
    { const bk = document.getElementById('back'); if (bk) { if (R.k >= 0 && R.k < n) bk.dataset.kind = 'lesson'; else delete bk.dataset.kind; } }
    const y = window.scrollY;
    lm.innerHTML = `${R.k >= 0 && R.k < n ? dots : ''}${body}`;
    renderMath(lm);
    if (!answered) window.scrollTo(0, 0);
    else {
      // After a quick-check answer: stay put, then bring the feedback and the Next button into view (phones).
      window.scrollTo(0, y);
      const why = lm.querySelector('.ln-why'), row = document.getElementById('next') && document.getElementById('next').closest('.rd-row');
      const tabs = document.getElementById('tabs'), tb = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.getBoundingClientRect() : null;
      const bottom = (tb && tb.top > innerHeight / 2 ? tb.top : innerHeight) - 16;
      if (row) {
        let dy = row.getBoundingClientRect().bottom - bottom;
        if (why) dy = Math.min(dy, why.getBoundingClientRect().top - 80); // never push the feedback off the top
        if (dy > 0) window.scrollBy({ top: dy, behavior: 'smooth' });
      }
    }
    if (!R.busy) drawChat();
    on('askb', () => { const c = document.getElementById('lnchat'); if (c && !desk()) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); askBuddy(T('Help me with the quick check', '小測給我一點提示')); });
    on('go1', () => { R.k = 0; draw(); });
    on('prev', () => { R.k--; draw(); });
    on('next', () => { R.k++; if (R.k >= n) finish(); draw(); });
    on('again', () => { R.k = 0; R.picked = {}; R.right = 0; draw(); });
    on('done', () => leaveTo(bookId));
    on('kwdict', () => keyWordsDictation(book, unit, UX.words));
    on('utask', () => unitWritingTask(book, unit, UX.task));
    on('practise', () => { pick = { bookId, ids: new Set([unitId]) }; startUnits(book, [unit], local.count || sessionSize()); });
    $app.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => { const s = L.steps[R.k]; R.picked[R.k] = +b.dataset.opt; if (+b.dataset.opt === s.check.answer) R.right++; draw(true); }));
  };
  const finish = () => {
    local.learned = local.learned || {}; const first = !local.learned[`${bookId}:${unitId}`];
    local.learned[`${bookId}:${unitId}`] = Date.now(); saveLocal();
    if (first && starsOn()) { const g = addStars(1, 'lesson'); if (g) setTimeout(() => celebrate({ n: g, lines: [[LANG === 'zh' ? '完成一課' : 'Finished a lesson', g]], badges: checkBadges({}), capped: false }), 400); }
  };
  draw();
}

/* ---------- mini helper: the coach, one tap away on screens that have no chat of their own ---------- */
const helper = { open: false };
const SCREEN_NAME = { parent: 'Parent dashboard (for parents, PIN-protected)', plans: 'Plans and prices (Standard, Pro)', speaking: 'Speaking practice (DSE English Paper 4 one-minute individual response)', writing: 'Writing practice (DSE composition with feedback and redrafts)', learn: 'Learn mode (a guided lesson teaching a chapter step by step)', dictation: '默書 dictation (the app reads words aloud, the child writes them)', homework: 'Homework help (photos of school homework)', home: 'Today', books: 'Books tab (their textbooks)', book: 'a book’s chapter page', library: 'the textbook library (adding a book)', mistakes: 'Mistake book', progress: 'Progress', settings: 'Settings', stars: 'Star shop', notes: 'revision notes', cards: 'flashcards', pick: 'choosing a book', usage: 'AI usage', paper: 'mock exam setup', edit: 'editing a book’s chapters', worksheets: 'worksheets' };
function helperChips() {
  const v = view && view.name;
  const by = {
    books: ['I can’t find my book', 'How do I add a textbook?'], library: ['I can’t find my book', 'What is a book code?'],
    book: ['How do I start practising?', 'What is a chapter test?'], mistakes: ['How do I fix my mistakes?', 'Which mistakes first?'],
    progress: ['What do these numbers mean?', 'How do I send the report to my parents?'], settings: ['How do I change the language?', 'What are stars?'],
    stars: ['How do I earn more stars?', 'How do rewards work?'],
  }[v] || [];
  return [...by, 'What should I do next?'];
}
// Show the Buddy button only where there's no other chat (not Today, not beside a question) and not in timed papers.
function helperWanted() {
  if ($app.querySelector('#coach') && matchMedia('(min-width:1024px)').matches) return false; // computers: Today has the full coach beside it; phones get the floating Buddy
  if (document.getElementById('tutor') || $app.querySelector('#quit, #hwchat, #lnchat') || timedPaper()) return false;
  return !!$app.querySelector('main[data-view]');
}
// Phones: the floating Buddy sits just above any bar stuck to the bottom (the book page's Start bar), never on top of it.
let fabRO = null;
function fabLift(fab) {
  const bar = matchMedia('(max-width:1023.98px)').matches && $app.querySelector('.sheet.sticky');
  if (fabRO) { fabRO.disconnect(); fabRO = null; }
  if (!bar) { fab.style.bottom = ''; return; }
  const set = () => { fab.style.bottom = `${Math.round(bar.getBoundingClientRect().height) + 78 + 10}px`; };
  set();
  try { fabRO = new ResizeObserver(set); fabRO.observe(bar); } catch (e) {}
}
function helperSync() {
  let fab = document.getElementById('helperFab');
  const want = helperWanted();
  if (!want) { if (helper.open) helperClose(); if (fab) fab.remove(); return; }
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'helperFab'; fab.className = 'helper-fab';
    fab.setAttribute('aria-label', LANG === 'zh' ? '問 PrepBuddy' : 'Ask PrepBuddy');
    fab.innerHTML = `${buddySVG('happy', 40)}<span>${LANG === 'zh' ? '問我' : 'Ask me'}</span>`;
    fab.onclick = () => (helper.open ? helperClose() : helperOpen());
    document.body.appendChild(fab);
  }
  if (fab.parentElement !== document.body) { document.body.appendChild(fab); fab.classList.remove('inhead'); fab.style.marginLeft = ''; }
  fabLift(fab);
  fab.classList.toggle('on', helper.open);
}
function helperOpen() {
  if ($app.querySelector('#coach') || document.getElementById('helperPanel')) return;
  helper.open = true;
  const panel = document.createElement('div');
  panel.id = 'helperPanel'; panel.className = 'helper-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'PrepBuddy helper');
  panel.innerHTML = `<div class="helper-grip" id="helperGrip" title="Drag to resize" aria-hidden="true"></div>
    <button class="helper-big" id="helperBig" aria-label="Make bigger or smaller" title="Bigger / smaller">${helperBigIcon()}</button>
    <button class="helper-x" id="helperX" aria-label="Close">✕</button><section class="coach" id="coach">${coachHTML()}</section>`;
  document.body.appendChild(panel);
  document.getElementById('helperX').onclick = helperClose;
  applyHelperSize(panel);
  bindHelperResize(panel);
  bindCoach();
  helperSync();
  const q = document.getElementById('coachQ'); if (q && matchMedia('(min-width:700px)').matches) q.focus();
}
// The helper window can be resized: drag its top-left corner (top edge on phones), or tap the bigger/smaller button.
// The size is remembered on this device.
const desk = () => matchMedia('(min-width:1024px)').matches;
function helperBigIcon() { const big = local.helperSize && local.helperSize.big; return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${big ? '<path d="M9 4v5H4M15 20v-5h5M4 9l6-6M20 15l-6 6" transform="rotate(0)"/>' : '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'}</svg>`; }
function applyHelperSize(panel) {
  const z = local.helperSize || {};
  const vw = innerWidth, vh = innerHeight;
  if (desk()) {
    const w = z.big ? Math.min(760, vw - 300) : z.w, h = z.big ? vh - 120 : z.h;
    panel.style.width = w ? `${Math.max(320, Math.min(w, vw - 260))}px` : '';
    panel.style.height = h ? `${Math.max(360, Math.min(h, vh - 110))}px` : '';
  } else {
    const h = z.big ? vh - 150 : z.mh;
    panel.style.width = ''; panel.style.height = h ? `${Math.max(300, Math.min(h, vh - 150))}px` : '';
  }
  const b = panel.querySelector('#helperBig'); if (b) b.innerHTML = helperBigIcon();
}
function bindHelperResize(panel) {
  panel.querySelector('#helperBig').onclick = () => { local.helperSize = { ...(local.helperSize || {}), big: !(local.helperSize && local.helperSize.big) }; saveLocal(); applyHelperSize(panel); };
  const grip = panel.querySelector('#helperGrip');
  grip.onpointerdown = (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const r = panel.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, d = desk();
    document.body.classList.add(d ? 'resizing-nw' : 'resizing-ns');
    grip.onpointermove = (ev) => {
      const h = Math.max(d ? 360 : 300, Math.min(r.height + (y0 - ev.clientY), innerHeight - (d ? 110 : 150)));
      panel.style.height = `${h}px`;
      if (d) panel.style.width = `${Math.max(320, Math.min(r.width + (x0 - ev.clientX), innerWidth - 260))}px`;
    };
    grip.onpointerup = () => {
      grip.onpointermove = grip.onpointerup = null; document.body.classList.remove('resizing-nw', 'resizing-ns');
      const b = panel.getBoundingClientRect();
      local.helperSize = d ? { ...(local.helperSize || {}), w: Math.round(b.width), h: Math.round(b.height), big: false } : { ...(local.helperSize || {}), mh: Math.round(b.height), big: false };
      saveLocal(); applyHelperSize(panel);
    };
  };
}

// On laptops the chat beside a question can be made wider or narrower by dragging the line on its left edge.
function applySideWidth() {
  const w = local.sideW;
  if (w) document.documentElement.style.setProperty('--sidew', `${Math.max(340, Math.min(w, Math.round(innerWidth * 0.6)))}px`);
  else document.documentElement.style.removeProperty('--sidew');
}
function addSideGrip() {
  const side = $app.querySelector(':scope > .qside.chatside, :scope > .sheet');
  if (!side || !$app.querySelector(':scope > main.qpaper') || side.querySelector(':scope > .side-grip')) return;
  const g = document.createElement('div');
  g.className = 'side-grip'; g.title = 'Drag to make the chat wider or narrower (double-click to reset)';
  g.setAttribute('aria-hidden', 'true');
  side.prepend(g);
  g.ondblclick = () => { local.sideW = null; saveLocal(); applySideWidth(); };
  g.onpointerdown = (e) => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag'); document.body.classList.add('resizing');
    const right = side.getBoundingClientRect().right;
    g.onpointermove = (ev) => { local.sideW = Math.round(right - ev.clientX); applySideWidth(); };
    g.onpointerup = () => { g.onpointermove = g.onpointerup = null; g.classList.remove('drag'); document.body.classList.remove('resizing'); saveLocal(); };
  };
}
applySideWidth();
addEventListener('resize', () => { applySideWidth(); const p = document.getElementById('helperPanel'); if (p) applyHelperSize(p); });
new MutationObserver(() => addSideGrip()).observe($app, { childList: true, subtree: false });

function helperClose() {
  if (!helper.open) return;
  helper.open = false;
  if (voiceOn('coach') && VC.ctrl) VC.ctrl.stop();
  const p = document.getElementById('helperPanel'); if (p) p.remove();
  const fab = document.getElementById('helperFab'); if (fab) fab.classList.remove('on');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && helper.open) helperClose(); });
new MutationObserver(() => helperSync()).observe($app, { childList: true });

// iPhone/iPad Safari can wipe a website's saved data after about a week without a visit. Apps added to the
// Home Screen are kept, so we suggest it until it's done (or dismissed). Elsewhere we ask the browser to keep data.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
let persisted = null;
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => (p ? true : navigator.storage.persist())).then((p) => (persisted = !!p)).catch(() => {}); } catch (e) {}
function installTip() {
  if (!isIOS || isInstalled() || local.installTipOff) return '';
  setTimeout(() => { const x = document.getElementById('itip-x'); if (x) x.onclick = () => { local.installTipOff = Date.now(); saveLocal(); x.closest('.itip').remove(); }; }, 0);
  return `<section class="itip" role="note"><span class="itip-i">📲</span><div><b>${LANG === 'zh' ? '把 PrepBuddy 加到主畫面' : 'Add PrepBuddy to your Home Screen'}</b><span>${LANG === 'zh' ? 'iPhone 可能會在一星期沒有使用後刪除網站的進度。在 Safari 按「分享」→「加至主畫面」，之後從主畫面圖示打開 PrepBuddy。請盡早做：主畫面的 App 會重新開始，已有的進度可用「設定 → 儲存備份檔案」轉移。' : 'iPhones can delete a website’s saved progress after a week without a visit. In Safari tap Share → Add to Home Screen, then use PrepBuddy from that icon. Do it early: the Home Screen app starts fresh, so move anything you’ve done with Settings → Save a backup file.'}</span></div><button class="itip-x" id="itip-x" aria-label="${LANG === 'zh' ? '關閉' : 'Dismiss'}">×</button></section>`;
}
// Readiness in just the chapters started so far (so effort shows while the rest of the book is untouched).
function startedOf(m) {
  const cs = m.chapters.filter((c) => c.done || c.tests);
  if (!cs.length || cs.length === m.chapters.length) return null;
  const w = cs.reduce((t, c) => t + c.weight, 0) || 1;
  return { n: cs.length, of: m.chapters.length, pct: Math.round(cs.reduce((t, c) => t + c.pct * c.weight, 0) / w) };
}
// Today: how ready for each subject (rings, from the book's mastery) and the change since about a week ago.
// One reading per book per day is kept in local.mhist (also used by the exam forecast).
async function todayReadyHTML(books) {
  const Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const t0 = dayStart(); local.mhist = local.mhist || {};
  const rows = [];
  for (const b of books.filter((x) => !x.demo)) {
    const m = await bookMastery(b), pct = m.pct;
    const h = (local.mhist[b.id] || []).filter((p) => p[0] !== t0); h.push([t0, pct]); local.mhist[b.id] = h.slice(-120);
    // the reading closest to 7 days ago, at least 5 days old
    const old = h.filter((p) => p[0] <= t0 - 5 * DAY).sort((x, y) => Math.abs(x[0] - (t0 - 7 * DAY)) - Math.abs(y[0] - (t0 - 7 * DAY)))[0];
    rows.push({ b, pct, covered: Math.round(100 * (m.areas.covered || 0)), was: old ? old[1] : null, used: (local.log || []).some((e) => e.q && e.q.startsWith(b.id + ':')), started: startedOf(m) });
  }
  saveLocal();
  if (!rows.length) return '';
  rows.sort((x, y) => (y.used - x.used) || (y.pct - x.pct));
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  const r = await currentReport();
  const wk = [];
  if (r.q || r.pq) wk.push(`<span><b>${r.q}</b> ${Z(r.q === 1 ? 'question' : 'questions', '題')}${r.pq != null ? (r.q === r.pq ? ` <em>${Z('same as last week', '與上週相同')}</em>` : ` <em class="${r.q > r.pq ? 'up' : 'down'}">${r.q > r.pq ? '▲' : '▼'} ${Z(`from ${r.pq}`, `上週 ${r.pq}`)}</em>`) : ''}</span>`);
  if (r.a !== null) wk.push(`<span><b>${r.a}%</b> ${Z('right', '答對')}${r.pa !== null ? ` <em class="${r.a >= r.pa ? 'up' : 'down'}">${r.a === r.pa ? Z('same as last week', '與上週相同') : `${r.a > r.pa ? '▲' : '▼'} ${Math.abs(r.a - r.pa)} ${Z('from last week', '對比上週')}`}</em>` : ''}</span>`);
  wk.push(`<span><b>${r.dp}</b>/7 ${Z('days', '日')}</span>`);
  const ring = (x) => {
    const lab = x.pct > 0 ? masteryLabel(x.pct) : x.covered ? Z(`Started · ${x.covered}% covered`, `已開始 · 涵蓋 ${x.covered}%`) : Z('Not started', '未開始');
    const ch = x.was == null || !x.used ? '' : x.pct > x.was ? `<em class="up">▲ ${x.pct - x.was}% ${Z('this week', '本週')}</em>` : x.pct < x.was ? `<em class="down">▼ ${x.was - x.pct}% ${Z('this week', '本週')}</em>` : `<em>${Z('no change this week', '本週沒有變化')}</em>`;
    return `<button class="pg-rg tr-rg" data-book="${esc(x.b.id)}">${x.pct > 0 ? ringHTML(x.pct, tone(x.pct), x.pct + '%', 68) : ringHTML(x.covered, 'cov', x.covered ? x.covered + '%' : '–', 68)}<b data-raw>${esc(x.b.subject ? subj(x.b.subject) : shortTitle(x.b.title))}</b><small>${lab}</small>${x.started && x.pct > 0 ? `<span class="rg-st">${LANG === 'zh' ? `已開始的 ${x.started.n} 章：${x.started.pct}%` : `${x.started.pct}% in ${x.started.n} started chapter${x.started.n > 1 ? 's' : ''}`}</span>` : ''}${ch}</button>`;
  };
  return `<section class="stack g10 td-sec" aria-label="${Z('How ready you are', '準備程度')}"><div class="sect-head"><h2 class="h-info">${Z('How ready you are', '準備程度')}${infoBtn('howReady', Z('How is this worked out?', '這是怎樣計算的？'))}</h2><button class="btn-sm" id="moreready">${Z('See progress', '查看進度')}</button></div>
    <div class="card td-ready"><div class="tr-week"><span class="tr-wl">${Z('This week', '本週')}</span>${wk.join('')}</div>
    <div class="pg-rings">${rows.slice(0, 6).map(ring).join('')}</div>${rows.length > 6 ? `<p class="hint" style="margin:0">${Z(`+ ${rows.length - 6} more on Progress`, `另有 ${rows.length - 6} 本在「進度」`)}</p>` : ''}${readyHowHTML()}</div></section>`;
}
// A small round "i" button beside a heading; it opens the explainer with that id (see the click handler near the end).
const infoBtn = (id, label) => `<button type="button" class="info-btn" data-how="${id}" aria-controls="${id}" aria-expanded="false" aria-label="${esc(label)}" title="${esc(label)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor" stroke="none"/></svg></button>`;
// "How does Today's mission work?": a short fold-out on the mission card.
// Info pop-ups on Today, in the same style as Progress: a few rows, each an icon, one plain line and a short detail.
const easyRows = (rows) => `<ul class="how-easy">${rows.map(([i, en, zh, den, dzh]) => `<li><span>${i}</span><div><p>${LANG === 'zh' ? zh : en}</p>${den ? `<small>${LANG === 'zh' ? dzh : den}</small>` : ''}</div></li>`).join('')}</ul>`;
const howPanel = (id, en, zh, rows) => `<details class="ms-how how-panel" id="${id}"><summary>${LANG === 'zh' ? zh : en}</summary><div>${easyRows(rows)}</div></details>`;
function missionHowHTML(id = 'howMission') {
  return howPanel(id, 'How does this work?', '這是怎樣運作的？', [
    ['📋', 'Up to 5 jobs a day, most important first.', '每天最多 5 項，最重要的排先。', 'Try to finish them all. Each one ticks itself off when it’s done.', '盡量全部完成，做完會自動打勾。'],
    ['📅', 'Tests coming up come first.', '快到的測驗排最先。', 'A lesson for a chapter you haven’t started, or your weakest one. A practice test the day before.', '先上還未開始的章節，或練最弱的一章。考試前一天做模擬測驗。'],
    ['⏩', 'Behind on a test goal? Buddy adds catch-up jobs.', '未追上測驗目標？Buddy 會加追進度的任務。', 'Up to 2 more a test, on its weakest chapters, so each day does enough to reach the goal.', '每個測驗最多多加 2 項，集中最弱的章節，讓每天的份量足夠達到目標。'],
    ['🔁', 'Then reviews and mistakes.', '然後是溫習和錯題。', 'Reviews bring back questions just before you’d forget them. Mistakes, up to 5 a day.', '溫習在快忘記時再出題。錯題每天最多 5 題。'],
    ['🎯', 'Then your weak spot, or keep going.', '然後是弱項，或者繼續。', 'The chapter you’ve found hardest lately, or the one you were working on.', '最近最難的一章，或你正在學的那一章。'],
    ['🌱', 'Tomorrow’s list follows today’s results.', '明天的清單會跟著今天的表現。', 'Questions get harder as you get them right, and easier when you don’t.', '答對了題目會變難，答錯了會變易。']]);
}
function testsHowHTML(id = 'howTests') {
  return howPanel(id, 'How do school tests work?', '學校測驗是怎樣運作的？', [
    ['➕', 'Add each school test, exam or 默書 with its date.', '加入學校的每個測驗、考試或默書和日期。', 'Pick the chapters if you know them. If not, Buddy uses everything practised in that subject.', '知道範圍就選章節；不知道的話，Buddy 會用該科練習過的所有內容。'],
    ['📊', 'The bar shows how ready you are, and your goal.', '進度條顯示準備度和你的目標。', 'Set the goal by sliding Buddy on the test card.', '在測驗卡上拖動 Buddy 設定目標。'],
    ['▶️', 'Today shows one job for each test, with Start.', '每個測驗今天都有一項任務，按「開始」。', 'It’s the same job as in Today’s mission.', '和今日任務的那一項一樣。'],
    ['📝', 'A practice test the day before.', '考試前一天做模擬測驗。', 'Tap Full plan to see every day until the test.', '按「完整計劃」看每一天的安排。']]);
}
function quickHowHTML(id = 'howQuick') {
  return howPanel(id, 'What’s this?', '這是甚麼？', [
    ['📚', 'Work outside your textbooks that’s waiting for you.', '課本以外、正在等你的功課。', 'It only shows when there’s something real to do.', '只有真的有事要做時才會出現。'],
    ['✍️', 'Writing to finish, or to redraft with Buddy’s feedback.', '要完成的寫作，或按 Buddy 的評語修改。'],
    ['📷', 'Homework you snapped today or yesterday.', '今天或昨天拍下的功課。'],
    ['🔤', 'Words you got wrong last time in 默書 practice.', '上次默書練習寫錯的詞語。'],
    ['⏰', 'Something due very soon goes into Today’s mission instead.', '很快要到的，會放進今日任務。', 'A 默書 in the next 2 days, or a writing test in the next 3.', '兩日內的默書，或三日內的寫作測驗。']]);
}
// "How is 'how ready' worked out?\": a short fold-out under the readiness rings (Today and Progress).
function readyHowHTML(id = 'howReady') {
  // Plain words on what readiness means, without the exact recipe (that stays ours)
  const Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const rows = [['💯', Z('Readiness shows how well you really know each chapter.', '準備度顯示你有多掌握每一章。'), Z('Out of 100%. Each subject’s ring brings its chapters together.', '滿分 100%。每科的圓環綜合了各章。')],
    ['🧠', Z('It’s more than getting questions right.', '不只是答對題目。'), Z('It also checks harder questions, timed tests, fixing mistakes and remembering things later.', '還包括較深的題目、限時測驗、改正錯題，以及之後仍然記得。')],
    ['🔒', Z('It can’t be rushed.', '不能一蹴而就。'), Z('The top scores only come with proof over time, so a high score really means ready.', '最高分要經過一段時間證明，所以高分代表真正準備好。')],
    ['👆', Z('Tap a chapter to see what it needs next.', '按一章看看下一步需要做甚麼。'), '']];
  return `<details class="ms-how rd-how how-panel" id="${id}"><summary>${Z('How is this worked out?', '這是怎樣計算的？')}</summary><div>
    <ul class="how-easy">${rows.map(([i, t, d]) => `<li><span>${i}</span><div><p>${t}</p>${d ? `<small>${d}</small>` : ''}</div></li>`).join('')}</ul></div></details>`;
}
async function renderHome() {
  S = null;
  const books = await getBooks();
  const hr = new Date().getHours();
  const hello = LANG === 'zh' ? (hr < 12 ? '早晨' : hr < 18 ? '午安' : '晚安') : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = (local.name || '').trim();
  const dateText = new Date().toLocaleDateString(LOCALE(), { weekday: 'long', day: 'numeric', month: 'long' });
  const who = name || (KIDS.list.length > 1 && KID && KID.nick) || '';
  // Buddy's line under the date: the most useful thing about today (a test, the streak, a win), else a friendly line that changes daily
  const cheerHTML = (c) => (Array.isArray(c) ? `<ul class="gr-pts">${c.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(c));
  const cheerFor = (F) => {
    const Z = (en, zh) => (LANG === 'zh' ? zh : en), nt = F.test, ch = nt && nt.step ? String(nt.step.t || '').replace(/^(Learn|Practise|Practice)\s*:?\s*/i, '').replace(/^(學習|練習)[：:「]?/, '').replace(/」$/, '') : '';
    if (nt && nt.left === 0) return [Z(`${nt.x.name} today. You’ve got this!`, `今天「${nt.x.name}」，你一定得！`), Z('A quick warm-up first?', '先熱熱身？')];
    if (nt && nt.left === 1) return [Z(`${nt.x.name} tomorrow`, `明天「${nt.x.name}」`), Z('A practice run tonight, then a good sleep', '今晚做一次模擬，然後好好睡一覺')];
    if (F.allDone) return F.streak >= 2 ? Z(`Mission done, and ${F.streak} days in a row. Brilliant!`, `任務完成，已連續 ${F.streak} 日，太棒了！`) : Z('Mission done for today. Brilliant work!', '今天的任務完成了，做得好！');
    if (nt && nt.left <= 7 && ch) return [Z(`${nt.x.name} in ${nt.left} days`, `「${nt.x.name}」還有 ${nt.left} 日`), Z(`Today: ${ch}`, `今天：${ch}`)];
    if (F.streak >= 2 && !F.doneToday) return Z(`${F.streak} days in a row! Keep the flame going today.`, `已連續 ${F.streak} 日！今天也要保持。`);
    if (F.fixedY >= 3) return Z(`You fixed ${F.fixedY} mistakes yesterday. Nice!`, `昨天你改正了 ${F.fixedY} 題錯題，做得好！`);
    if (F.gw && !F.gw.reached && F.gw.met === F.gw.days - 1) return Z('One more day and you hit this week’s goal!', '再多一日就達到本週目標！');
    if (F.streak >= 2) return Z(`${F.streak} days in a row. Come back tomorrow for day ${F.streak + 1}!`, `已連續 ${F.streak} 日，明天回來挑戰第 ${F.streak + 1} 日！`);
    if (nt && nt.left <= 14) return Z(`${nt.x.name} in ${nt.left} days. A little each day beats a lot the night before.`, `「${nt.x.name}」還有 ${nt.left} 日。每天一點點，好過考前一晚臨急抱佛腳。`);
    const L = LANG === 'zh'
      ? (hr < 12 ? ['新的一天，先做一點點吧！', '早上的腦袋最清醒，來幾題吧！', '先做一點點，今天就輕鬆得多。'] : hr < 18 ? ['今天也來練習一下吧！', '放學後做一個小任務？', '十分鐘就夠，開始吧！'] : ['睡前做十分鐘，明天更有信心。', '今晚做一點，明天記得更牢。', '一個小任務，然後好好休息。'])
      : (hr < 12 ? ['A little practice now, a lot easier later.', 'Fresh brain, fresh start. Let’s go!', 'A few questions before the day gets busy?'] : hr < 18 ? ['Ready for a quick practice?', 'A short mission after school?', 'Ten minutes is all it takes. Let’s go!'] : ['Ten minutes before bed goes a long way.', 'A little tonight helps it stick tomorrow.', 'One small mission, then time to relax.']);
    return L[Math.floor(Date.now() / DAY) % L.length];
  };
  // Phones: an app bar (logo · child · stars · settings) above a friendly greeting card with Buddy. Computers: the plain greeting.
  const head = `<div class="greet" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div class="gr-hero"><div class="gr-row"><div class="gr-text"><h1 data-raw>${esc(hello)}${who ? `${LANG === 'zh' ? '，' : ', '}${esc(who)}` : ''}<span class="gr-bud-in" aria-hidden="true"><!--BUD46--></span></h1><p data-raw>${esc(dateText)}</p><span class="gr-sub"><!--CHEER--></span></div><span class="gr-buddy" aria-hidden="true"><!--BUD64--></span></div><!--STRIP--></div>
      <div class="greet-r"><span class="gr-brand">${logoSVG(36)}<b>PrepBuddy</b></span>${KIDS.list.length > 1 ? kidChip() : ''}${starChip()}${gearBtn()}</div></div>`;
  if (!books.length) {
    // Free starter books (written by PrepBuddy) for the child's grade: something to try before adding their own textbook.
    let starters = [];
    try { const cat = await getCatalog(); const g = gradeNow(); const all = cat.filter((b) => b.starter); starters = all.filter((b) => !g || String(b.level).toUpperCase() === g); if (!starters.length) starters = all; starters = starters.slice(0, 3); } catch (e) {}
    $app.innerHTML = `<main class="pad stack today" data-view="home" style="flex:1">${head.replace('<!--CHEER-->', cheerHTML(cheerFor({ streak: 0 })))}
    ${starters.length && inHK() ? `<section class="starter-card" aria-label="${LANG === 'zh' ? '免費入門書' : 'Free starter books'}"><span class="st-tag">${LANG === 'zh' ? '免費 · PrepBuddy 編寫' : 'Free · written by PrepBuddy'}</span>
      <h2>${LANG === 'zh' ? '先試一本入門書' : 'Try a free starter book'}</h2>
      <p>${LANG === 'zh' ? '跟足香港課程，即刻有練習、筆記和測驗，之後再加入學校課本。' : 'Follows the Hong Kong curriculum. Practice, notes and tests straight away, then add your school textbook later.'}</p>
      ${starters.map((b) => `<button class="starter-book" data-starter="${esc(b.id)}"><span class="cover" aria-hidden="true" style="background:${subjectColour(b.subject, b.title)}1F">${subjectIcon(b.subject, 26, null, b.title)}</span><span><b data-raw>${esc(b.title)}</b><small>${esc([subj(b.subject), b.level].filter(Boolean).join(' · '))} · ${b.units.length} ${LANG === 'zh' ? '單元' : 'units'}</small></span><span class="st-go">${LANG === 'zh' ? '加入' : 'Add'}</span></button>`).join('')}</section>` : ''}
    <section class="empty-start" aria-label="Add a textbook">
      <h2>Start with your textbook</h2>
      <p style="margin:0;line-height:1.55;color:var(--text-2)">Search the library by title, subject or book code. PrepBuddy turns each chapter into exam practice, notes and flashcards, and marks your answers.</p>
      <form id="find" class="searchbox" role="search"><span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
        <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off"></form>
    </section></main>${footerHTML()}`;
    bindHomeCommon();
    $app.querySelectorAll('[data-starter]').forEach((b) => (b.onclick = async () => { b.disabled = true; const cat = await getCatalog(); addFromLibrary(cat.find((x) => x.id === b.dataset.starter), b.querySelector('.st-go')); }));
    const q = document.getElementById('q');
    q.onfocus = () => go({ name: 'library', query: q.value });
    document.getElementById('find').onsubmit = (e) => { e.preventDefault(); go({ name: 'library', query: q.value }); };
    return window.scrollTo(0, 0);
  }
  const due = await dueItems();
  const mk = mistakeCount();
  const last = lastChapter(books);
  const Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const tests = await schoolTestsHTML();
  // ---- Today's mission: up to 3 steps in order, fixed for the day, ticked off as they get done ----
  const cands = []; // { key, icon, t, s, attr, chk }
  for (const p of tests.steps.filter((q) => q.left <= 14 && q.step).slice(0, 2)) {
    { const k = tests.steps.indexOf(p); cands.push({ key: `t:${p.x.id}`, icon: p.step.icon, t: p.step.t, s: Z(`For ${p.x.name} · ${leftText(p.left)}`, `為「${p.x.name}」準備 · ${leftText(p.left)}`), attr: `data-tstep="${k}"`, chk: p.dict ? { y: 'dict', L: p.dict.id } : !p.book ? { y: 'none' } : p.step.u ? { y: 'learn', b: p.book.id, u: p.step.u } : { y: 'log', b: p.book.id, us: p.all ? null : p.units.map((u) => u.id) } }); } }
  // behind pace for a test's goal: add catch-up jobs for it (its weakest chapters), so the daily amount matches what the goal needs
  let extraJobs = 0;
  for (const p of tests.steps.filter((q) => q.left >= 1 && q.left <= 14 && q.step && q.book && q.ready != null && (q.x.kind || 'test') !== 'dict').slice(0, 2)) {
    const aim = p.x.aim || 80; if (p.ready >= aim) continue;
    const m = await bookMastery(p.book), chs = m.chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)); if (!chs.length) continue;
    const habit = practiceHabit(), fc = planForecast(p.ready, chs, p.left, habit); if (fc >= aim) continue; // the usual pace gets there
    const N = planNeeds(p.ready, chs.map((c) => c.pct || 0), p.left, aim), perDay = Math.ceil(N.sets / Math.max(1, p.left));
    const want = Math.min(3, perDay) - 1; if (want <= 0) continue;
    const taken = new Set(cands.flatMap((c) => (c.chk && c.chk.u ? [c.chk.u] : c.chk && c.chk.us ? c.chk.us : [])));
    const pick = chs.filter((c) => !taken.has(c.unit.id)).sort((a, b) => a.pct - b.pct).slice(0, want);
    for (const c of pick) {
      const fresh = !c.done && !c.learned, nm = shortTitle(c.unit.title);
      cands.push({ key: `c:${p.x.id}:${c.unit.id}`, icon: fresh ? 'learn' : 'practise', t: fresh ? Z(`Learn: ${nm}`, `學習：${nm}`) : Z(`Practise ${nm}`, `練習「${nm}」`),
        s: Z(`Extra, to reach your ${aim}% goal`, `額外練習，達到 ${aim}% 目標`),
        why: Z(`To reach your ${aim}% goal for the ${p.x.name}, Buddy added this. At your usual pace you’d get about ${fc}%.`, `為了在「${p.x.name}」達到 ${aim}% 目標，Buddy 加了這一項。照平時的步伐約 ${fc}%。`),
        attr: fresh ? `data-mlearn="${esc(p.book.id)}:${esc(c.unit.id)}"` : `data-weak="${esc(p.book.id)}:${esc(c.unit.id)}"`,
        chk: fresh ? { y: 'learn', b: p.book.id, u: c.unit.id } : { y: 'log', b: p.book.id, us: [c.unit.id] }, tag: ['test', Z(`${p.x.name} · catch up`, `「${p.x.name}」· 追進度`)] });
      extraJobs++;
    }
  }
  // school 默書 in the next 2 days, and a writing test in the next 3, go straight into the mission
  for (const x of (local.sched || []).filter((x) => x.kind === 'dict' && testLeft(x) >= 0 && testLeft(x) <= 2)) {
    if (cands.some((c) => c.key === `t:${x.id}`)) continue;
    const L = (local.dict || []).find((d) => d.id === x.L);
    cands.push({ key: `d:${x.id}`, icon: 'dictation', t: L ? Z(`Practise 默書: ${shortTitle(L.title || '')}`, `練習默書：${shortTitle(L.title || '')}`) : Z('Add your 默書 words', '加入默書詞語'), s: Z('Buddy reads, you write', 'Buddy 讀，你寫'), why: Z(`School 默書 ${leftText(testLeft(x))}. Buddy reads the words, you write them, then you see what to fix.`, `學校默書${leftText(testLeft(x))}。Buddy 讀，你寫，然後看看要改正甚麼。`), attr: `data-dictgo="${esc(L ? L.id : 'new')}"`, chk: L ? { y: 'dict', L: L.id } : { y: 'none' }, tag: ['test', testLeft(x) === 0 ? Z('默書 today', '今天默書') : Z(`默書 ${leftText(testLeft(x))}`, `${leftText(testLeft(x))}默書`)] });
  }
  { const x = (local.sched || []).find((x) => x.kind !== 'dict' && /writ|compos|essay|作文|寫作/i.test(x.name || '') && testLeft(x) >= 0 && testLeft(x) <= 3);
    if (x && !cands.some((c) => c.key === `t:${x.id}`)) cands.push({ key: `wt:${x.id}`, icon: 'writing', t: Z('Practise writing', '練習寫作'), s: Z('Write a piece, Buddy gives feedback', '寫一篇，Buddy 給意見'), why: Z(`${x.name} is ${leftText(testLeft(x))}. Write a piece and Buddy marks it with feedback.`, `「${x.name}」${leftText(testLeft(x))}。寫一篇，Buddy 會批改並給意見。`), attr: 'data-wrgo="1"', chk: { y: 'wr' }, tag: ['test', Z(`Writing ${leftText(testLeft(x))}`, `${leftText(testLeft(x))}寫作`)] }); }
  // reviews come before mistakes: they're due today and slip if they wait
  if (due.length > 10) cands.push({ key: 'rv', icon: 'review', t: Z('Review 10 questions now', '先複習 10 題'), s: Z(`${due.length} due · the rest over the next few days · about 6 min`, `共 ${due.length} 題到期 · 其餘留待之後幾天 · 約 6 分鐘`), attr: 'data-mode="spaced" data-cap="10"', chk: { y: 'rv', n: due.length } });
  else if (due.length) cands.push({ key: 'rv', icon: 'review', t: Z(`Review ${due.length} question${due.length > 1 ? 's' : ''}`, `複習 ${due.length} 題`), s: Z(`So you don’t forget · about ${Math.max(2, Math.round(due.length * 0.6))} min`, `鞏固記憶 · 約 ${Math.max(2, Math.round(due.length * 0.6))} 分鐘`), attr: 'data-mode="spaced"', chk: { y: 'rv' } });
  if (mk) { const n = Math.min(5, mk); cands.push({ key: 'mk', icon: 'mistakes', t: mk > n ? Z(`Fix ${n} of your ${mk} mistakes`, `改正 ${n} 題錯題（共 ${mk} 題）`) : Z(`Fix ${mk} mistake${mk > 1 ? 's' : ''}`, `改正 ${mk} 題錯題`), s: Z('Questions you didn’t get fully right', '未完全答對的題目'), attr: 'id="mistakes"', chk: { y: 'mk', n: mk, k: n } }); }
  // the weakest chapter practised lately (first tries, last 2 weeks), if it isn't already in the list
  { const by = {}, wk2 = Date.now() - 14 * DAY, seen = new Set();
    for (const e of local.log) { if (!e.q || !e.m || seen.has(e.q)) continue; seen.add(e.q); if (e.t < wk2 || e.k === 'mistakes' || e.k === 'spaced') continue; const k = String(e.q).split(':').slice(0, 2).join(':'); (by[k] || (by[k] = [])).push(e); }
    const acc = (es) => Math.round(100 * es.reduce((x, e) => x + e.g, 0) / es.reduce((x, e) => x + e.m, 0));
    const inList = new Set(cands.map((c) => (c.chk && c.chk.u ? `${c.chk.b}:${c.chk.u}` : '')).concat(cands.flatMap((c) => (c.chk && c.chk.us ? c.chk.us.map((u) => `${c.chk.b}:${u}`) : []))));
    const w = Object.entries(by).filter(([k, es]) => es.length >= 5 && acc(es) < 70 && !inList.has(k)).sort((a, b) => acc(a[1]) - acc(b[1]))[0];
    if (w) { const [bid, uid] = w[0].split(':'), b = books.find((x) => x.id === bid), u = b && b.units.find((x) => x.id === uid);
      if (u) cands.push({ key: `w:${w[0]}`, icon: 'weak', t: Z(`Practise ${shortTitle(u.title)}`, `練習「${shortTitle(u.title)}」`), s: Z(`Your weakest lately · ${acc(w[1])}% right`, `最近最弱的一章 · 答對 ${acc(w[1])}%`), why: Z(`${acc(w[1])}% right on first tries lately, your weakest chapter. A short set makes it stronger.`, `最近第一次作答只答對 ${acc(w[1])}%，是最弱的一章。做一組就會進步。`), attr: `data-weak="${esc(w[0])}"`, chk: { y: 'log', b: bid, us: [uid] }, tag: ['weak', Z('Weak spot', '弱項')] }); } }
  { const nb = books.find((b) => !(local.placement || {})[b.id] && !(local.plHide || {})[b.id] && !bookAnswered(b.id));
    if (nb) cands.push({ key: `lv:${nb.id}`, icon: 'level', t: Z('Find your level', '找出你的程度'), s: Z(`${nb.subject ? subj(nb.subject) : shortTitle(nb.title)} · about 5 min`, `${nb.subject ? subj(nb.subject) : shortTitle(nb.title)} · 約 5 分鐘`), attr: `data-lv="${esc(nb.id)}"`, chk: { y: 'lv', b: nb.id } }); }
  if (last) {
    const sc = scoreOf(await getQs(last.book.id, last.unit.id));
    cands.push({ key: `u:${last.book.id}:${last.unit.id}`, icon: 'practise', t: shortTitle(last.unit.title), s: Z(`Keep going${sc !== null ? ` · scored ${sc}%` : ''}`, `繼續${sc !== null ? ` · 得分 ${sc}%` : ''}`), attr: 'id="continue"', chk: { y: 'log', b: last.book.id, us: [last.unit.id] } });
  } else cands.push({ key: `b:${books[0].id}`, icon: 'practise', t: Z('Practise your first chapter', '練習第一章'), s: books[0].subject ? subj(books[0].subject) : shortTitle(books[0].title), attr: `data-book="${esc(books[0].id)}"`, chk: { y: 'log', b: books[0].id, us: null } });
  // every mission step says why it's there: a coloured reason tag and one plain sentence
  for (const c of cands) {
    if (c.key.startsWith('c:')) continue;
    if (c.key.startsWith('t:')) { const p = tests.steps.find((q) => `t:${q.x.id}` === c.key);
      if (p) { c.tag = ['test', p.left === 0 ? Z(`${p.x.name} · today`, `「${p.x.name}」· 今天`) : Z(`${p.x.name} · ${leftText(p.left)}`, `「${p.x.name}」· ${leftText(p.left)}`)]; c.s = p.step.icon === 'learn' && p.step.u ? Z('New chapter in this test', '測驗範圍內的新一章') : String(p.step.s || Z('Practice for this test', '為這個測驗練習')).replace(/\.$/, '');
        c.why = p.step.icon === 'learn' && p.step.u ? Z(`Your ${p.x.name} is ${leftText(p.left)} and covers this chapter. You haven’t started it yet, so begin with the lesson.`, `「${p.x.name}」${leftText(p.left)}，範圍包括這一章。你還未開始，先上課。`) : Z(`Your ${p.x.name} is ${leftText(p.left)}. ${p.step.s}.`, `「${p.x.name}」${leftText(p.left)}。${p.step.s}。`).replace(/\.\.$/, '.'); } }
    else if (c.key === 'mk') { c.tag = ['mistakes', Z(`${mk} mistakes`, `${mk} 題錯題`)]; c.s = Z('Quickest way to win marks back', '最快拿回分數的方法'); c.why = Z('Questions you got wrong. Fixing them is the quickest way to win marks back.', '你答錯的題目。改正它們是最快拿回分數的方法。'); }
    else if (c.key === 'rv') { c.tag = ['review', Z('Due today', '今日到期')]; c.s = Z('Helps them stick', '幫你記得牢'); c.why = Z('These questions are due back today. Getting them right now is what makes them stick.', '這些題目今天到期。現在答對才會記得牢。'); }
    else if (c.key.startsWith('lv:')) { c.tag = ['level', Z('New book', '新課本')]; c.s = Z('Quick check to find your starting point', '快速評估，找出起點'); c.why = Z('A 5-minute check so Buddy starts you at the right level in this new book.', '5 分鐘的評估，讓 Buddy 在這本新課本從適合你的程度開始。'); }
    else if (c.key.startsWith('u:')) { c.tag = ['practise', Z('Keep going', '繼續')]; c.s = c.s.replace(/^Keep going( · )?/, Z('Pick up where you left off', '從上次的地方繼續') + '$1').replace(/^繼續( · )?/, '從上次的地方繼續$1'); }
    else if (!c.tag) c.tag = ['learn', Z('Get started', '開始')];
  }
  const t0 = dayStart();
  const nSteps = Math.min(8, 5 + extraJobs); // up to 5, plus catch-up jobs when behind pace for a test
  if (!local.mission || local.mission.d !== t0 || !local.mission.steps.length || local.mission.v !== 4) { local.mission = { v: 4, d: t0, at: (local.mission && local.mission.d === t0 && local.mission.at) || Date.now(), steps: cands.slice(0, nSteps).map(({ key, icon, t, s, chk, attr, tag, why }) => ({ key, icon, t, s, chk, attr, tag, why })) }; saveLocal(); }
  const M = local.mission;
  const isDone = (st) => {
    const c = st.chk || {};
    if (c.y === 'mk') return mistakeCount() <= c.n - (c.k || 1);
    if (c.y === 'rv') return c.n ? due.length <= Math.max(0, c.n - 10) : !due.length;
    if (c.y === 'learn') return !!(local.learned || {})[`${c.b}:${c.u}`];
    if (c.y === 'dict') { const L = (local.dict || []).find((d) => d.id === c.L); return !!(L && (L.runs || []).some((r) => r.t >= M.at)); }
    if (c.y === 'wr') return (local.wr || []).some((w) => w.t >= M.at || (w.drafts || []).some((d) => d.t >= M.at));
    if (c.y === 'lv') return !!(local.placement || {})[c.b] || bookAnswered(c.b);
    if (c.y === 'log') return local.log.filter((e) => e.t >= M.at && e.q && e.q.startsWith(c.b + ':') && (!c.us || c.us.includes(qUnit(e.q)[1]))).length >= 3;
    return false;
  };
  const steps = M.steps.map((st) => ({ ...st, done: isDone(st), now: cands.find((c) => c.key === st.key) || (st.attr && !/^t:/.test(st.key) ? { t: st.t, s: st.s, attr: st.attr, why: st.why, tag: st.tag } : null) }));
  const firstOpen = steps.findIndex((x) => !x.done && x.now);
  const allDone = steps.every((x) => x.done || !x.now);
  { const md = local.mdone || (local.mdone = {}); const nd = steps.filter((x) => x.done).length; const prev = md[t0]; if (!prev || prev[0] !== nd || prev[1] !== steps.length) { md[t0] = [nd, steps.length]; Object.keys(md).filter((k) => +k < t0 - 60 * DAY).forEach((k) => delete md[k]); saveLocal(); } }
  // a rough time for each job, so the header can say how long today's mission takes
  const jobMin = (x) => { const k = x.key, ic = x.icon;
    if (k === 'rv') return Math.max(2, Math.round(Math.min(10, due.length) * 0.6));
    if (k === 'mk') return Math.max(3, (x.chk && x.chk.k) || 5);
    if (k.startsWith('lv:')) return 5;
    if (k.startsWith('d:')) return 5;
    if (k.startsWith('wt:')) return 20;
    if (ic === 'learn') return 10;
    if (ic === 'test' || ic === 'mock') return 15;
    return 10; };
  const left = steps.filter((x) => !x.done && x.now), mins = Math.round(left.reduce((a, x) => a + jobMin(x), 0) / 5) * 5 || 5, started = left.length < steps.length;
  const stepRow = (x, k) => x.done || !x.now
    ? `<div class="ms-row done"><span class="ms-ic">${actionIcon(x.icon, 14)}</span><span class="ms-t"><b data-raw>${esc(x.t)}</b></span><span class="ms-tick" aria-label="${Z('Done', '完成')}">${ICON.check}</span></div>`
    : `<div class="ms-item ${k === firstOpen ? 'is-next' : ''}"><button class="ms-row" ${x.now.attr}><span class="ms-t"><span class="ms-top"><span class="ms-ic">${actionIcon(x.icon, 16)}</span>${(x.now.tag || x.tag) ? `<em class="pv-tag2 ${(x.now.tag || x.tag)[0]}">${esc((x.now.tag || x.tag)[1])}</em>` : ''}</span><b data-raw>${esc(x.now.t)}</b><small data-raw>${esc(x.now.s)} · ${Z(`${jobMin(x)} min`, `${jobMin(x)} 分鐘`)}</small></span>${k === firstOpen ? `<span class="ms-next">${Z('Next', '下一步')}</span>` : '<span class="ms-ring" aria-hidden="true"></span>'}</button>${(x.now.why || x.why) ? `<p class="ms-why"><span class="ms-bud" aria-hidden="true">${buddySVG('happy', 22)}</span><span data-raw>${esc(x.now.why || x.why)}</span></p>` : ''}</div>`;
  // after the mission: a bonus aimed at the nearest school test's weakest chapter, if there is one
  let extra = null;
  { const p = tests.steps.find((q) => q.left <= 14 && q.book && q.units.length);
    if (p) { const m = await bookMastery(p.book); const ch = m.chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)).sort((a, b) => a.pct - b.pct)[0];
      if (ch && ch.pct < 90) extra = { label: Z(`Extra for ${p.x.name}: ${shortTitle(ch.unit.title)} (${ch.pct}%)`, `為「${p.x.name}」加練：${shortTitle(ch.unit.title)}（${ch.pct}%）`), run: () => { pick = { bookId: p.book.id, ids: new Set([ch.unit.id]) }; startUnits(p.book, [ch.unit], 10); } }; } }
  // Wins: a cheerful card above the mission with the best recent win (and up to two smaller ones).
  // Only real wins, only recent ones; nothing to celebrate means no card.
  let winHTML = '';
  { const W = [], now = Date.now(), wk = now - 7 * DAY, d3 = now - 3 * DAY;
    const add = (pri, icon, t, d) => W.push({ pri, icon, t, d });
    const accP = (es) => { const m = es.reduce((x, e) => x + e.m, 0); return m ? Math.round(100 * es.reduce((x, e) => x + e.g, 0) / m) : null; };
    const unitName = (key) => { const [b, u] = String(key).split(':'); const bk = books.find((x) => x.id === b), un = bk && bk.units.find((x) => x.id === u); return un ? shortTitle(un.title) : ''; };
    // chapters mastered this week (from the daily snapshot)
    { const k7 = (local.kpi || []).filter((k) => k.d <= t0 - 6 * DAY).pop(), kn = (local.kpi || []).slice(-1)[0];
      if (k7 && kn && kn.c > k7.c) { const n = kn.c - k7.c; add(1, 'trophy', n === 1 ? Z('You mastered a chapter this week!', '本週掌握了一章！') : Z(`You mastered ${n} chapters this week!`, `本週掌握了 ${n} 章！`), Z('Passed the test, got the harder questions right, and still remembered it later. That’s the real deal.', '通過測驗、答對較深的題目，而且之後仍然記得。真正學會了！')); }
      if (k7 && kn && kn.m - k7.m >= 5) add(6, 'brain', Z(`${kn.m - k7.m} more questions are now in long-term memory`, `本週多了 ${kn.m - k7.m} 題進入長期記憶`), Z('Still right a week later, so they’ve really stuck.', '一星期後仍然答對，真的記住了。')); }
    // chapter tests passed in the last 3 days
    for (const x of (local.tests || []).filter((x) => x.t > d3 && x.m && x.g / x.m >= 0.8).slice(-2)) {
      const nm = (x.title && String(x.title).replace(/^chapter test[:·\s-]*/i, '')) || unitName(Object.keys(x.per || {})[0]);
      add(2, 'medal', Z(`You passed ${nm ? `the ${nm} test` : 'a chapter test'} with ${Math.round(100 * x.g / x.m)}%!`, `${nm ? `「${nm}」測驗` : '章節測驗'}考了 ${Math.round(100 * x.g / x.m)}%，合格了！`), Z('Under time, first try. That’s test-ready.', '限時、第一次就合格，準備好考試了。')); }
    // a chapter that jumped: this week vs the week before
    { const by = {}; for (const e of local.log) { if (!e.q || !e.m || e.t < wk - 7 * DAY) continue; const k = String(e.q).split(':').slice(0, 2).join(':'); const o = by[k] || (by[k] = { now: [], prev: [] }); (e.t >= wk ? o.now : o.prev).push(e); }
      const best = Object.entries(by).map(([k, o]) => ({ k, a: o.now.length >= 4 ? accP(o.now) : null, b: o.prev.length >= 4 ? accP(o.prev) : null })).filter((x) => x.a != null && x.b != null && x.a - x.b >= 15).sort((x, y) => (y.a - y.b) - (x.a - x.b))[0];
      if (best) add(3, 'up', Z(`${unitName(best.k)} jumped from ${best.b}% to ${best.a}%`, `「${unitName(best.k)}」由 ${best.b}% 升到 ${best.a}%`), Z('All that practice is paying off.', '練習有成果了！')); }
    // mistakes fixed this week
    { const fixed = Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > wk).length;
      if (fixed && !mistakeCount()) add(3, 'sparkle', Z('You cleared your whole Mistake book!', '錯題簿全部清完！'), Z(`${fixed} mistake${fixed === 1 ? '' : 's'} fixed this week. Nothing left to trip you up.`, `本週改正了 ${fixed} 題，再沒有錯題了。`));
      else if (fixed >= 3) add(5, 'check', Z(`You fixed ${fixed} mistakes this week`, `本週改正了 ${fixed} 題錯題`), Z('Each one is a mark you won’t lose again.', '每一題都是不會再失的分數。')); }
    // 默書 practice: full marks in the last 3 days
    { const full = (local.dict || []).find((L) => (L.runs || []).some((r) => r.t > d3 && r.n && r.g >= r.n));
      if (full) add(4, 'star', Z(`100% in 默書 practice: ${shortTitle(full.title || '')}!`, `默書練習「${shortTitle(full.title || '')}」全對！`), Z('Every word right.', '每個詞語都寫對了。')); }
    // weekly goal reached, streak, best week
    { const G = goalWeek(); if (G && G.reached) add(5, 'target', Z('You hit your weekly goal!', '本週目標達成！'), Z(`${G.days} days of ${G.mins} minutes. Great habit.`, `${G.days} 日，每次 ${G.mins} 分鐘，好習慣！`)); }
    { const days = new Set(local.log.map((e) => dayStart(e.t))); let st = 0; for (let d = days.has(t0) ? t0 : t0 - DAY; days.has(d); d -= DAY) st++;
      if (st >= 3) add(st >= 7 ? 4 : 7, 'flame', Z(`${st} days in a row!`, `連續 ${st} 日！`), Z('A little every day is how it sticks.', '每天一點點，最能記得牢。')); }
    { const cnt = (a, b) => local.log.filter((e) => e.q && e.t >= a && e.t < b).length, thisW = cnt(wk, now + 1), prev = Array.from({ length: 5 }, (_, k) => cnt(wk - (k + 1) * 7 * DAY, wk - k * 7 * DAY));
      if (thisW >= 40 && prev.some((x) => x > 0) && thisW > Math.max(...prev)) add(6, 'chart', Z(`Your best week yet: ${thisW} questions`, `最勤力的一星期：${thisW} 題`), Z('More practice than any week before.', '比之前任何一星期都多。')); }
    // a strong yesterday
    { const ys = local.log.filter((e) => e.q && e.m && e.t >= t0 - DAY && e.t < t0), right = ys.filter((e) => e.g >= e.m).length;
      if (ys.length >= 5 && right / ys.length >= 0.7) add(8, 'check', Z(`Yesterday you got ${right} of ${ys.length} right`, `昨天答對 ${right}／${ys.length} 題`), Z('Nice work. Keep it rolling today.', '做得好，今天繼續！')); }
    W.sort((a, b) => a.pri - b.pri);
    const SV = { trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3"/>', medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8"/>', up: '<path d="M4 16l5-5 4 4 7-7"/><path d="M15 8h5v5"/>', sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>', flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2.5 2.5 3 4 .5-3-1-5 0-7z"/>', chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>', brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>' };
    const ic = (k) => `<svg class="tw-i ${k}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SV[k] || SV.check}</svg>`;
    if (W.length) {
      const top = W[0], rest = W.slice(1).filter((x) => x.t !== top.t).slice(0, 2);
      winHTML = `<section class="td-wins" data-k="${esc(top.t)}" aria-label="${Z('Your wins', '你的進步')}"><button type="button" class="tw-x" id="twX" aria-label="${Z('Dismiss', '關閉')}">✕</button><span class="tw-conf" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <div class="tw-top"><span class="tw-bud">${buddySVG('happy', 56)}</span><div><small>${Z('Your wins', '你的進步')}</small><b data-raw>${esc(top.t)}</b></div></div>
        <p class="tw-d">${esc(top.d)}</p>${rest.length ? `<div class="tw-more">${rest.map((x) => `<div>${ic(x.icon)}<span data-raw>${esc(x.t)}</span></div>`).join('')}</div>` : ''}</section>`;
    } else {
      // nothing to celebrate yet: point at the nearest win, in the same cheerful card
      const days = new Set(local.log.map((e) => dayStart(e.t))), didToday = days.has(t0), didY = days.has(t0 - DAY), mkN = mistakeCount();
      const ideas = [];
      if (!didToday && didY) ideas.push([Z('Practise today to make it 2 days in a row', '今天練習，就連續 2 日了'), 'flame']);
      else if (!didToday) ideas.push([Z('Practise today to start a streak', '今天練習，開始連續紀錄'), 'flame']);
      if (mkN >= 3) ideas.push([Z('Fix 3 mistakes and that’s a win', '改正 3 題錯題就是一個進步'), 'check']);
      ideas.push([Z('Get 5 or more questions right in today’s mission', '在今日任務答對 5 題或以上'), 'star']);
      const head = didToday ? Z('Your next win is close!', '下一個進步就快到了！') : Z('Your first win of the week is one session away!', '再練習一次，就有本週第一個進步！');
      winHTML = `<section class="td-wins tw-next" data-k="${esc(head)}" aria-label="${Z('Your next win', '你的下一個進步')}"><button type="button" class="tw-x" id="twX" aria-label="${Z('Dismiss', '關閉')}">✕</button>
        <div class="tw-top"><span class="tw-bud">${buddySVG('happy', 56)}</span><div><small>${Z('Your next win', '你的下一個進步')}</small><b>${head}</b></div></div>
        <p class="tw-d">${Z('Here’s how to earn one today:', '今天這樣做就可以：')}</p><div class="tw-more">${ideas.slice(0, 2).map(([t, k]) => `<div>${ic(k)}<span>${esc(t)}</span></div>`).join('')}</div></section>`;
    } }
  { const k = (winHTML.match(/data-k="([^"]*)"/) || [])[1], h = local.winsHid; if (k && h && h.d === t0 && h.k === k) winHTML = ''; }
  // a subject left alone for 5+ days
  // A lesson left part-way (from the last 7 days): carry on, or close it.
  let lessonHTML = '', lessonLeft = null;
  { const la = local.lessonAt || {};
    const cands = Object.entries(la).filter(([, v]) => v && v.k >= 0 && t0 - v.t < 7 * DAY).sort((a, b) => b[1].t - a[1].t);
    for (const [key, v] of cands) {
      const [bid, uid] = key.split(':'), b = books.find((x) => x.id === bid), u = b && b.units.find((x) => x.id === uid);
      if (!u) continue;
      lessonLeft = { key, b, u };
      lessonHTML = `<div class="td-slip td-lesson"><span class="pg-ic">${pIcon('book', 18)}</span><span class="td-slt"><b>${Z('Lesson in progress', '未完成的課堂')}</b><small>${esc(shortTitle(u.title))}${v.n ? Z(` · step ${v.k + 1} of ${v.n}`, ` · 第 ${v.k + 1}／${v.n} 步`) : ''}${cands.length > 1 ? Z(` · ${cands.length - 1} more`, ` · 另有 ${cands.length - 1} 課`) : ''}</small></span>
        <span class="td-lbtns"><button class="btn-sm" id="lessonX">${Z('Close', '關閉')}</button><button class="btn-sm primary" id="lessonGo">${Z('Continue', '繼續')}</button></span></div>`;
      break;
    } }
  let slipHTML = '', slip = null;
  { const lastAt = {}; for (const e of local.log) { const bid = String(e.q).split(':')[0]; if (!lastAt[bid] || e.t > lastAt[bid]) lastAt[bid] = e.t; }
    const cand = books.filter((b) => !b.demo && lastAt[b.id]).map((b) => ({ b, days: Math.round((t0 - dayStart(lastAt[b.id])) / DAY) })).filter((x) => x.days >= 5).sort((a, b) => b.days - a.days)[0];
    if (cand) {
      const m = await bookMastery(cand.b), h = (local.mhist || {})[cand.b.id] || [], old = h.filter((p) => p[0] <= t0 - 5 * DAY).pop();
      const weak = m.chapters.filter((c) => c.done).sort((a, b) => a.pct - b.pct)[0];
      const name = cand.b.subject ? subj(cand.b.subject) : shortTitle(cand.b.title), slipping = old && m.pct < old[1];
      if (weak) { slip = { b: cand.b, u: weak.unit };
        slipHTML = `<div class="td-slip"><span class="pg-ic orange">${pIcon('alert', 18)}</span><span class="td-slt"><b>${Z(`${esc(name)} hasn’t been practised for ${cand.days} days${slipping ? ' and is slipping' : ''}`, `${esc(name)}已經 ${cand.days} 日沒有練習${slipping ? '，而且有退步' : ''}`)}</b><small>${Z(`A short set on ${esc(shortTitle(weak.unit.title))} brings it back.`, `做一組「${esc(shortTitle(weak.unit.title))}」就能追回。`)}</small></span><button class="btn-sm primary" id="slipGo">${Z('Practise', '練習')}</button></div>`; } } }
  // "Also for tonight": the three most useful extra jobs for this child today, in the Practice-page tile style.
  // Scored from what's coming up and what's unfinished; the plain Homework / Dictation / Writing tiles fill any gaps.
  const quick = (() => {
    const c = [], now = Date.now(), dayAgo = (t) => Math.floor((dayStart(now) - dayStart(t)) / DAY);
    const short = (x, n = 34) => { x = String(x || '').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
    // a dictation coming up
    for (const x of (local.sched || []).filter((x) => x.kind === 'dict')) {
      const left = testLeft(x); if (left < 0 || left > 7) continue;
      const L = (local.dict || []).find((d) => d.id === x.L);
      c.push({ k: 'dict', score: 100 - left * 6, icon: 'dictation', t: L ? Z(`Dictation: ${short(L.title, 24)}`, `默書：${short(L.title, 16)}`) : Z('Add your dictation words', '加入默書詞語'),
        s: Z(`School dictation ${leftText(left)}`, `學校默書${leftText(left)}`), run: () => go(L ? { name: 'dictation', id: L.id, sub: 'run' } : { name: 'dictation', id: 'new' }) });
    }
    // a word list with words still wrong last time
    for (const L of local.dict || []) {
      const r = (L.runs || [])[(L.runs || []).length - 1]; if (!r || r.g >= r.n || dayAgo(r.t) < 1 || c.some((q) => q.k === 'dict')) continue;
      c.push({ k: 'dict', score: 45, icon: 'dictation', t: Z(`Dictation: ${short(L.title, 24)}`, `默書：${short(L.title, 16)}`), s: Z(`${r.n - r.g} word${r.n - r.g === 1 ? '' : 's'} to get right`, `還有 ${r.n - r.g} 個詞語要寫對`), run: () => go({ name: 'dictation', id: L.id, sub: 'run' }) });
      break;
    }
    // writing: unfinished piece, or feedback waiting for a redraft
    { const w = (local.wr || []).filter((x) => dayAgo(x.drafts.length ? x.drafts[x.drafts.length - 1].t : x.t) <= 10).sort((a, b) => b.t - a.t)[0];
      if (w && !w.drafts.length) c.push({ k: 'wr', score: 60, icon: 'writing', t: Z('Finish your writing', '完成你的寫作'), s: short(w.title), run: () => go({ name: 'writing', id: w.id }) });
      else if (w && w.drafts.length === 1) c.push({ k: 'wr', score: 50, icon: 'writing', t: Z('Redraft your writing', '修改你的寫作'), s: Z(`Use Buddy’s feedback: ${short(w.title, 22)}`, `按 Buddy 的評語修改：${short(w.title, 14)}`), run: () => go({ name: 'writing', id: w.id }) }); }
    // a writing or composition test coming up
    { const x = (local.sched || []).find((x) => x.kind !== 'dict' && /writ|compos|essay|作文|寫作/i.test(x.name || '') && testLeft(x) >= 0 && testLeft(x) <= 10);
      if (x && !c.some((q) => q.k === 'wr')) c.push({ k: 'wr', score: 80 - testLeft(x) * 4, icon: 'writing', t: Z('Practise writing', '練習寫作'), s: Z(`${short(x.name, 22)} ${leftText(testLeft(x))}`, `${short(x.name, 14)}${leftText(testLeft(x))}`), run: () => go({ name: 'writing' }) }); }
    // homework snapped today or yesterday
    { const h = (local.hw || []).filter((h) => dayAgo(h.t) <= 1).sort((a, b) => b.t - a.t)[0];
      if (h) c.push({ k: 'hw', score: 55, icon: 'homework', t: Z('Back to your homework', '繼續你的功課'), s: short(h.title || Z('Homework', '功課')), run: () => go({ name: 'homework', id: h.id }) }); }
    // anything already in today's mission stays there
    const inM = new Set(M.steps.map((x) => (x.key.startsWith('d:') || (x.chk && x.chk.y === 'dict') ? 'dict' : x.key.startsWith('wt:') ? 'wr' : '')));
    const seen = new Set(); return c.filter((q) => !inM.has(q.k)).sort((a, b) => b.score - a.score).filter((q) => !seen.has(q.k) && seen.add(q.k)).slice(0, 3);
  })();
  const quickHTML = !quick.length ? '' : `<section class="stack g10 td-sec" aria-label="${Z('Other things to do', '其他功課')}"><div class="sect-head"><h2 class="h-info">${Z('Also for tonight', '今晚也可以')}${infoBtn('howQuick', Z('How are these chosen?', '這些是怎樣選出來的？'))}</h2></div>
    <div class="td-quick quick">${quick.map((q, i) => `<button class="qtile hwtile" data-tq="${i}">${actionTile(q.icon, 44)}<b>${esc(q.t)}</b><span>${esc(q.s)}</span></button>`).join('')}</div>${quickHowHTML()}</section>`;
  // Buddy's daily brief for the coach panel (built from the numbers, no AI call)
  { const p = tests.steps.find((q) => q.left <= 14);
    const first = steps.find((x) => !x.done && x.now);
    coach.brief = p ? Z(`${p.x.name} is ${leftText(p.left)}${p.ready != null ? ` and you’re ${p.ready}% ready` : ''}.${first ? ` Today: ${first.now.t}.` : ''}`, `「${p.x.name}」${leftText(p.left)}${p.ready != null ? `，你現時準備度 ${p.ready}%` : ''}。${first ? `今天：${first.now.t}。` : ''}`)
      : first ? Z(`Today: ${first.now.t}.`, `今天：${first.now.t}。`) : Z('Today’s mission is done. Nice work!', '今日任務完成，做得好！'); }
  const missionHTML = allDone
    ? `<section class="ms-card ms-done" aria-label="${Z('Today’s mission', '今日任務')}">${buddySVG('done', 60)}<div class="ms-dt"><b class="h-info">${Z('Mission done!', '任務完成！')}${infoBtn('howMission', Z('How does this work?', '這是怎樣運作的？'))}</b><span>${Z(`${steps.length} of ${steps.length} done today. See you tomorrow!`, `今天完成了 ${steps.length}／${steps.length} 項，明天見！`)}</span><button class="linkbtn" id="msmore">${extra ? esc(extra.label) : Z('Do a bit more', '再做多一點')} ›</button>${missionHowHTML()}</div></section>`
    : `<section class="ms-card" aria-label="${Z('Today’s mission', '今日任務')}"><div class="ms-head"><h2 class="h-info">${Z('Today’s mission', '今日任務')}${infoBtn('howMission', Z('How does this work?', '這是怎樣運作的？'))}</h2><span class="ms-est">${pIcon('clock', 16)}<span class="ms-el">${started ? Z('about', '尚餘約') : Z('about', '約')} </span>${Z(`${mins} min`, `${mins} 分鐘`)}${started ? `<span class="ms-el">${Z(' left', '')}</span>` : ''}</span></div>
      <div class="ms-list">${(() => { const idx = steps.map((x, k) => [x, k]), open = idx.filter(([x]) => !(x.done || !x.now)), done = idx.filter(([x]) => x.done || !x.now);
        return open.map(([x, k]) => stepRow(x, k)).join('') + (done.length ? `<div class="ms-donehd">${Z(`Done today · ${done.length}`, `今天已完成 · ${done.length}`)}</div>${done.map(([x, k]) => stepRow(x, k)).join('')}` : ''); })()}</div>
      ${missionHowHTML()}
      <button class="btn ms-start" id="msstart">${steps.some((x) => x.done) ? Z('Keep going', '繼續') : Z('Start', '開始')}</button></section>`;
  await todayReadyHTML(books); // keeps each book's daily readiness history (used by the 'slipping' banner); not shown on Today
  // ---- greeting card: streak and this week's days ----
  const daysSet = new Set(local.log.map((e) => dayStart(e.t)));
  let streak = 0; for (let d = daysSet.has(t0) ? t0 : t0 - DAY; daysSet.has(d); d -= DAY) streak++;
  const mon = t0 - ((new Date(t0).getDay() + 6) % 7) * DAY;
  const DN = { zh: ['一', '二', '三', '四', '五', '六', '日'], fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'], ja: ['月', '火', '水', '木', '金', '土', '日'] }[LANG] || ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const wk = Array.from({ length: 7 }, (_, k) => ({ on: daysSet.has(mon + k * DAY), today: mon + k * DAY === t0 }));
  const nOn = wk.filter((x) => x.on).length, gw = goalWeek();
  const doneToday = daysSet.has(t0);
  const fixedY = local.log.filter((e) => e.k === 'mistakes' && e.t >= t0 - DAY && e.t < t0 && e.m && e.g >= e.m).length;
  const cheer = cheerFor({ test: tests.steps.find((q) => q.left >= 0), allDone, streak, doneToday, fixedY, gw });
  // a line of encouragement for the streak (computers; phones show the "See today's mission" button instead)
  const encHTML = doneToday
    ? (streak >= 2 ? Z(`${streak} days in a row. Brilliant! Come back tomorrow for day ${streak + 1}.`, `已連續 ${streak} 日，太棒了！明天回來挑戰第 ${streak + 1} 日。`) : Z('Great start! Come back tomorrow and it becomes a streak.', '好開始！明天再來，就開始連續練習了。'))
    : streak ? Z(`Keep your ${streak}-day streak going: one short mission today is all it takes.`, `保持連續 ${streak} 日的紀錄：今天只需完成一個小任務。`)
    : nOn ? Z(`You practised ${nOn} day${nOn === 1 ? '' : 's'} this week. Do today’s mission and start a new streak 🔥`, `本週已練習 ${nOn} 日。完成今日任務，開始新的連續紀錄 🔥`)
    : Z('Every streak starts with day one. Finish today’s mission to light your first 🔥', '每個連續紀錄都由第一日開始。完成今日任務，點燃你的第一團火 🔥');
  // Streak, the way Duolingo and others show it: one bold flame and the number. The flame is lit once today's
  // practice is done, grey until then (and wobbles in the evening when the streak is at risk). Days in a row join up.
  const lit = doneToday;
  // how big the fire is: 1 (1-2 days) … 5 (30+ days). The flame grows and flickers harder, and its light warms the card.
  const tier = !streak ? 0 : streak < 3 ? 1 : streak < 7 ? 2 : streak < 14 ? 3 : streak < 30 ? 4 : 5;
  const embs = (k) => (k >= 3 ? `<span class="sk-emb" aria-hidden="true">${Array.from({ length: k * 2 - 2 }, (_, i) => `<i style="--x:${20 + ((i * 29) % 60)}%;--d:${(i * 0.31).toFixed(2)}s;--s:${(1.4 + (i % 3) * 0.4).toFixed(1)}s"></i>`).join('')}</span>` : '');
  const risk = !lit && streak > 0 && hr >= 18;
  const flameSVG = (on) => `<svg viewBox="0 0 40 50" style="overflow:visible" aria-hidden="true"><defs><linearGradient id="skg${on ? 1 : 0}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${on ? '#E8361A' : '#AEB5C4'}"/><stop offset=".6" stop-color="${on ? '#FF8A1F' : '#C9CFDB'}"/><stop offset="1" stop-color="${on ? '#FFC94D' : '#DCE1EA'}"/></linearGradient></defs><g class="f-all"><path class="f-o" d="M20 1c3 9 15 15 15 30a15 15 0 0 1-30 0c0-7 4-12 7-16 0 5 2 8 5 9-2-8 0-15 3-23z" fill="url(#skg${on ? 1 : 0})"/>${on ? '<path class="f-m" d="M21 12c2 7 10 11 10 20a11 11 0 0 1-22 0c0-5 3-8 5-11 0 4 2 6 4 7-1-6 1-11 3-16z" fill="#FFA62B" opacity=".9"/>' : ''}<path class="f-i" d="M20 24c2 5 8 8 8 14a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 3 5-1-4 0-8 1-11z" fill="${on ? '#FFF1B8' : '#F1F3F7'}"/></g></svg>`;
  const wkOn = wk.map((x) => x.on);
  const weekHTML = (cls = '') => `<span class="gr-week ${cls}" aria-label="${Z(`${wkOn.filter(Boolean).length} day(s) this week`, `本週 ${wkOn.filter(Boolean).length} 日`)}">${wk.map((x, k) => `<i class="${wkOn[k] ? 'on' : ''} ${x.today ? 'today' : ''} ${x.today && allDone ? 'ms' : ''}">${wkOn[k] ? flameSVG(true).replace(/skg1/g, 'skw' + k) : DN[k]}</i>`).join('')}</span>`;
  // the next badge to aim for
  const MIL = [3, 7, 14, 30, 50, 100, 200, 365];
  const nextM = MIL.find((m) => m > streak) || streak + 100, prevM = [...MIL].reverse().find((m) => m <= streak) || 0;
  const medal = `<svg class="medal" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h4l2 5-3 2zM17 2h-4l-2 5 3 2z" fill="#6E8BE0"/><circle cx="12" cy="15" r="7" fill="#FFC531" stroke="#E09B00" stroke-width="1.5"/><path d="M12 11.5l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" fill="#FFF6D6"/></svg>`;
  const nextHTML = `<span class="sk-next">${medal}<span>${Z(`${nextM - streak} more day${nextM - streak === 1 ? '' : 's'} to your ${nextM}-day badge`, `再 ${nextM - streak} 日得到 ${nextM} 日徽章`)}</span><span class="bar"><i style="width:${Math.round(((streak - prevM) / (nextM - prevM)) * 100)}%"></i></span></span>`;
  const label = streak ? Z(`day streak`, '日連續') : Z('Start a streak today', '今天開始連續練習');
  const strip = `<button class="gr-strip gr-btn" id="streakGo"><span class="gr-streak"><span class="gr-sk"><span class="sk-flame sk-t${lit ? tier : 0} ${lit ? 'lit' : ''} ${risk ? 'risk' : ''}">${flameSVG(lit)}${lit ? embs(tier) : ''}</span><span class="gr-sk-n">${streak ? `<b class="${lit ? '' : 'off'}">${streak}</b>` : ''}<span class="${streak ? '' : 'off'}">${label}</span></span></span>${doneToday ? '' : `<small class="gr-cta">${Z('See today’s mission ›', '查看今日任務 ›')}</small>`}${nextHTML}</span>
    ${weekHTML()}</button>`;
  // Celebration, once a day, the first time Today opens after practising (like Duolingo's streak screen)
  const celebrate = (n) => {
    const nt = !n ? 1 : n < 3 ? 1 : n < 7 ? 2 : n < 14 ? 3 : n < 30 ? 4 : 5;
    const box = document.createElement('div'); box.className = 'skc-wrap'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const msg = n === 1 ? Z('Your streak has started! Practise tomorrow to keep it going.', '你的連續紀錄開始了！明天再練習，繼續保持。')
      : MIL.includes(n) ? Z(`You reached ${n} days in a row. That earns a badge!`, `你已連續 ${n} 日，得到一個徽章！`) : Z(`${n} days in a row. Come back tomorrow for day ${n + 1}!`, `已連續 ${n} 日。明天回來挑戰第 ${n + 1} 日！`);
    const sparks = Array.from({ length: 14 }, (_, i) => `<i class="spark" style="--dx:${Math.round(Math.cos(i * 0.45) * 130)}px;--dy:${Math.round(Math.sin(i * 0.45) * 110 - 30)}px;left:50%;top:110px"></i>`).join('');
    box.innerHTML = `<div class="skc sk-t${nt}" style="position:relative">${sparks}<span class="big sk-flame lit sk-t${nt}">${flameSVG(true).replace(/skg1/g, 'skbig')}${embs(nt)}</span><span class="num" id="skcN">${Math.max(0, n - 1)}</span><span class="lab">${Z('day streak!', '日連續！')}</span><p>${msg}</p>${weekHTML()}${n < nextM ? nextHTML : ''}<button class="btn" id="skcOk">${Z('Keep it up!', '繼續加油！')}</button></div>`;
    document.body.appendChild(box);
    setTimeout(() => { const el = box.querySelector('#skcN'); if (el) el.textContent = n; el && el.animate && el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.3,1.6,.5,1)' }); }, 650);
    const close = () => box.remove(); box.querySelector('#skcOk').onclick = close; box.onclick = (e) => { if (e.target === box) close(); };
    box.querySelector('#skcOk').focus();
  };
  const missionParty = () => {
    const got = addStars(5, 'mission', false);
    const box = document.createElement('div'); box.className = 'skc-wrap'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const conf = Array.from({ length: 22 }, (_, i) => `<i class="conf" style="--dx:${Math.round(Math.cos(i * 0.29) * (90 + (i % 4) * 25))}px;--dy:${Math.round(Math.sin(i * 0.29) * 90 - 70)}px;--r:${(i * 47) % 360}deg;background:${['#FFC531', '#18966A', '#4A5AA8', '#F08A5D', '#E0533F'][i % 5]}"></i>`).join('');
    box.innerHTML = `<div class="skc ms-party" style="position:relative">${conf}<span class="ms-pbud">${buddySVG('done', 96)}</span><b class="ms-ph">${Z('Mission done!', '任務完成！')}</b>
      <span class="ms-ps">${Z(`All ${steps.length} steps done today.`, `今天 ${steps.length} 項全部完成。`)}</span>
      <div class="ms-pchips">${got ? `<span class="ms-pc star">⭐ ${Z(`+${got} bonus stars`, `+${got} 粒獎勵星星`)}</span>` : ''}<span class="ms-pc fire">🔥 ${streak > 1 ? Z(`${streak}-day streak safe`, `連續 ${streak} 日，保住了`) : Z('Streak safe for today', '今天的連續紀錄保住了')}</span></div>
      <button class="btn" id="msOk">${Z('Brilliant!', '太好了！')}</button>${extra ? `<button class="linkbtn" id="msMore2">${esc(extra.label)} ›</button>` : ''}</div>`;
    document.body.appendChild(box);
    const close = () => { box.remove(); renderHome(); };
    box.querySelector('#msOk').onclick = close; box.onclick = (e) => { if (e.target === box) close(); };
    { const m2 = box.querySelector('#msMore2'); if (m2) m2.onclick = () => { box.remove(); extra.run(); }; }
    box.querySelector('#msOk').focus();
  };
  if (allDone && steps.length && local.msSeen !== t0) { local.msSeen = t0; local.skSeen = t0; saveLocal(); setTimeout(missionParty, 400); }
  else if (doneToday && local.skSeen !== t0) { local.skSeen = t0; saveLocal(); setTimeout(() => celebrate(streak), 400); }
  // ---- the next school test, and how ready for it ----
  const nt = tests.steps[0];
  const testHead = `<div class="sect-head"><h2 class="h-info">${SCH('School tests', '學校測驗')}${infoBtn('howTests', SCH('How do school tests work?', '學校測驗是怎樣運作的？'))}</h2><button class="btn-sm" id="addTest">+ ${SCH('Add a test', '加入測驗')}${locked('sched') ? ' 🔒' : ''}</button></div>${testsHowHTML()}`;
  let testHTML = `<section class="stack g10 td-sec" aria-label="${SCH('School tests', '學校測驗')}">${testHead}<button class="weekstrip td-addtest" id="addTest2"><span class="wt"><b>${SCH('Got a test coming up?', '快要測驗？')}</b><span>${SCH('Add it and Today’s mission will get you ready, day by day.', '加入後，今日任務會每天幫你準備。')}</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">+</span></button></section>`;
  const tdPlans = [], tdMins = [], jobsT = [], tdActs = [];
  const tdBtn = (label, run, cls = 'pv-btn') => { tdActs.push(run); return `<button class="${cls}" data-tdact="${tdActs.length - 1}">${label}</button>`; };
  if (nt) {
    // each test: a countdown card with a strip of days to the test, today's job for it, and the full plan one tap away
    const KIC = { learn: 'learn', practise: 'practise', mixed: 'practise', test: 'test', mock: 'mock', 'test-day': 'test', review: 'review' };
    const card = async (p) => {
      const k = tests.steps.indexOf(p), aim = p.x.aim || 80, day = new Date(testDay(p.x)).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
      const m = p.book ? await bookMastery(p.book) : null, chs = m ? m.chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)) : [];
      const plan = p.book && chs.length && (p.x.kind || 'test') !== 'dict' ? testDayPlan(p, chs, aim) : null;
      let strip = '';
      if (plan && p.left >= 1) {
        const shown = plan.days.slice(0, Math.min(plan.days.length, 7)), more = plan.days.length > shown.length;
        const lab = (x) => (x.d === 0 ? Z('Today', '今日') : x.d === p.left ? Z('Test', '測驗') : new Date(x.t).toLocaleDateString(LOCALE(), { weekday: 'short' }));
        const tile = (x, cls) => `<span class="tdc-d ${cls}" title="${esc(x.task[0])}"><small>${lab(x)}</small>${actionIcon(x.d === 0 && p.step ? p.step.icon : KIC[x.task[2]] || 'practise', 18)}</span>`;
        strip = `<div class="tdc-strip" style="--n:${shown.length + (more ? 1 : 0)}">${shown.map((x) => tile(x, x.d === 0 ? 'now' : x.d === p.left ? 'end' : x.d === p.left - 1 ? 'mock' : '')).join('')}${more ? tile(plan.days[plan.days.length - 1], 'end') : ''}</div>`;
      }
      let mins = '';
      if (plan && p.ready != null && p.ready < aim) { const N = planNeeds(p.ready, chs.map((c) => c.pct || 0), Math.max(1, p.left), aim); tdMins.push(Math.max(10, Math.round((N.sets * SET_MIN) / Math.max(1, p.left) / 5) * 5)); mins = ` · ${Z(`${tdMins[tdMins.length - 1]} min`, `${tdMins[tdMins.length - 1]} 分鐘`)}`; }
      const job = p.step ? `<div class="tdc-job"><span class="tdc-ji">${actionIcon(p.step.icon || 'practise', 20)}</span><div><small>${Z('Today', '今天')}${mins}</small><b data-raw>${esc(p.step.t)}</b></div><button class="btn-sm primary" data-tstep="${k}">${Z('Start', '開始')}</button></div>` : '';
      jobsT[k] = job;
      const next = plan && p.left >= 2 ? plan.days[p.left - 1] : null;
      if (plan) tdPlans[k] = () => testPlanSheet(p, chs, aim, planForecast(p.ready, chs, p.left));
      const icon = p.book ? subjectTile(p.book.subject, 44, p.book.title) : actionTile(p.x.kind === 'dict' ? 'dictation' : 'test', 44);
      const r = p.ready == null ? null : Math.max(0, Math.min(100, p.ready)), tone = r == null ? '' : r >= aim ? 'ok' : r >= aim - 15 ? 'mid' : 'low';
      const bar = r == null ? '' : `<div class="tdc-bar"><div class="tdc-bl"><span><b>${r}%</b> ${Z('ready', '準備度')}</span><span>${Z(`goal ${aim}%`, `目標 ${aim}%`)}</span></div><div class="tdc-tr"><i class="${tone}" style="width:${Math.max(2, r)}%"></i><em style="left:${aim}%"></em></div></div>`;
      const pDay = next ? new Date(next.t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric' }) : '';
      // on track or not: the same verdict as Progress (where test day is heading with the usual pace, against the goal)
      const fcT = r == null || !chs.length ? null : planForecast(p.ready, chs, p.left, practiceHabit());
      const st = r == null ? '' : aimTone(fcT ?? r, aim);
      const stPill = st ? `<em class="pv-pill tdc-pill ${st}">${{ ok: Z('On track', '進度理想'), close: Z('Close', '接近'), risk: Z('At risk', '需要加把勁') }[st]}</em>` : '';
      // the test's chapters as slim rows, like Progress: in book order, the 3 weakest shown, the rest one tap away
      let chRows = '';
      if (chs.length && (p.x.kind || 'test') !== 'dict') {
        const order = p.book.units.map((u) => u.id), weak = new Set(chs.slice().sort((a, b) => (a.pct || 0) - (b.pct || 0)).slice(0, 3).map((c) => c.unit.id));
        const cs = chs.slice().sort((a, b) => order.indexOf(a.unit.id) - order.indexOf(b.unit.id)), more = cs.length - weak.size;
        const row = (c) => `<div class="pv-tr ${c.pct >= 70 ? 'good' : c.pct >= 40 ? 'mid' : c.pct > 0 ? 'low' : 'zero'}${weak.has(c.unit.id) ? '' : ' hid'}"><span data-raw>${esc(shortTitle(c.unit.title))}</span><em>${c.done ? `${c.pct}%` : c.learned ? Z(`Lesson · ${c.pct}%`, `已上課 · ${c.pct}%`) : Z('Not started', '未開始')}</em><i><b style="width:${c.pct}%"></b></i></div>`;
        chRows = `<div class="pv-tch tdc-ch">${cs.map(row).join('')}<div class="tdc-chf">${more > 0 ? `<button type="button" class="pv-tmore tdc-more" data-more="${Z(`+ ${more} more chapter${more === 1 ? '' : 's'}`, `+ 還有 ${more} 章`)}">${Z(`+ ${more} more chapter${more === 1 ? '' : 's'}`, `+ 還有 ${more} 章`)}</button>` : '<div></div>'}<button type="button" class="tdc-prog">${Z('Details in Progress', '在「進度」看詳情')} ›</button></div></div>`;
      }
      return `<div class="td-test tdc">
        <div class="tdc-h">${icon}<button class="tdc-t" data-tedit="${esc(p.x.id)}"><b data-raw>${esc(p.x.name)}</b><span class="tdc-st"><small>${day}</small>${stPill}</span></button><span class="tdc-left ${p.left <= 7 ? 'soon' : ''}"><b>${p.left}</b><small>${p.left === 0 ? Z('today', '今天') : p.left === 1 ? Z('day left', '日') : Z('days left', '日')}</small></span></div>
        ${!p.book ? `<small class="muted" data-raw>${esc(testScope(p))}${p.last ? ' · ' + SCH(`${p.last.g} of ${p.last.n} right last time`, `上次 ${p.last.n} 個中寫對 ${p.last.g} 個`) : ''}</small>` : ''}
        ${bar}${chRows}${job}
        ${plan ? `<div class="tdc-f"><span>${next ? `${pIcon('check', 15)} ${Z(`Practice test ${pDay}`, `${pDay} 模擬測驗`)}` : ''}</span><button class="linkbtn" data-tplan="${k}">${Z('Full plan', '完整計劃')} ›</button></div>` : ''}
      </div>`;
    };
    for (const p of tests.steps) await card(p); // works out today's job and minutes for each test
    // the full test card; today's job for it is already in Buddy's plan box and in Today's mission, so no extra Start row
    const cards = await fullTestCards(tests, tdBtn);
    const tot = tdMins.reduce((a, b) => a + b, 0);
    const totHTML = tdMins.length > 1 ? `<p class="tdc-tot ${tot > 60 ? 'hi' : ''}">${pIcon('clock', 17)}<span><b>${Z(`About ${tot} min today`, `今天約 ${tot} 分鐘`)}</b> ${Z(`for ${tdMins.length} tests.`, `（${tdMins.length} 個測驗）。`)}${tot > 60 ? Z(' That’s a lot. Slide Buddy to a lower goal on a test card to lighten it.', '時間較多，可在測驗卡上把 Buddy 拖到較低的目標。') : ''}</span></p>` : '';
    testHTML = `<section class="stack g10 td-sec" aria-label="${SCH('School tests', '學校測驗')}">${testHead}${totHTML}${cards.join('')}</section>`;
  }

  $app.innerHTML = `
  <main class="pad stack today" data-view="home" style="flex:1">
    ${head.replace('<!--CHEER-->', cheerHTML(cheer)).replace('<!--BUD46-->', buddySVG('happy', 46)).replace('<!--BUD64-->', buddySVG('happy', 64)).replace('<!--STRIP-->', strip).replace('class="gr-hero"', `class="gr-hero glow-${lit ? tier : 0}"`)}
    ${profileOn() && !local.learner && !local.profSkip ? `<section class="card prof-ask"><span class="pa-ic">${buddySVG('happy', 44)}</span><div><b>${LANG === 'zh' ? '告訴 Buddy 孩子讀哪一級' : 'Tell Buddy your child’s grade'}</b><span>${LANG === 'zh' ? '題目、字詞和解釋會配合孩子的年級。只需 30 秒，家長填寫。' : 'Questions, words and explanations then fit their year. 30 seconds, for parents.'}</span></div><div class="pa-btns"><button class="btn-sm primary" id="profAsk">${LANG === 'zh' ? '設定' : 'Set up'}</button><button class="btn-sm quiet" id="profLater">${LANG === 'zh' ? '稍後' : 'Later'}</button></div></section>` : ''}
    ${installTip()}
    ${winHTML}
    ${lessonHTML}
    ${slipHTML}
    ${missionHTML}
    ${tests.pastHTML}
    ${testHTML}
    ${quickHTML}
  </main>
  <aside class="coach" id="coach" aria-label="Study coach"><button class="tutor-cta coach-cta" id="coachOpen" type="button">${buddySVG('happy', 30)}<span>${LANG === 'zh' ? '問 Buddy：你的溫習教練' : 'Ask Buddy, your study coach'}</span><span aria-hidden="true" class="tc-go">›</span></button>${coachHTML()}</aside>${footerHTML()}`;
  { const co = document.getElementById('coachOpen'); if (co) co.onclick = () => { document.getElementById('coach').classList.remove('folded'); const q = document.getElementById('coachQ'); if (q) q.focus({ preventScroll: true }); document.getElementById('coach').scrollIntoView({ block: 'start', behavior: 'smooth' }); }; }
  bindHomeCommon();
  bindCoach();
  { const pa = document.getElementById('profAsk'); if (pa) pa.onclick = async () => { await profileScreen(); go({ name: 'home' }); }; }
  { const pl = document.getElementById('profLater'); if (pl) pl.onclick = () => { local.profSkip = Date.now(); saveLocal(); go({ name: 'home' }); }; }
  const pr = document.getElementById('progress'); if (pr) pr.onclick = () => go({ name: 'progress' });
  const mr = document.getElementById('moreready'); if (mr) mr.onclick = () => go({ name: 'progress' });
  $app.querySelectorAll('.today-week .mrowb[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  const mkb = document.getElementById('mistakes'); if (mkb) mkb.onclick = () => go({ name: 'mistakes' });
  const ct = document.getElementById('continue');
  if (ct) ct.onclick = () => { pick = { bookId: last.book.id, ids: new Set([last.unit.id]) }; go({ name: 'book', bookId: last.book.id }); };
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  { const sg = document.getElementById('streakGo'); if (sg) sg.onclick = () => {
    if (doneToday) return toast(Z(`You’ve practised today ✓ Come back tomorrow to make it ${streak + 1} days in a row.`, `今天已練習 ✓ 明天再來，就連續 ${streak + 1} 日了。`));
    // take them to Today's mission (and light it up) so they choose the step, rather than jumping into one
    const card = $app.querySelector('.ms-card'); if (!card) return go({ name: 'practice' });
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('ms-flash'); void card.offsetWidth; card.classList.add('ms-flash');
    const first = card.querySelector('button.ms-row'); if (first) setTimeout(() => first.focus({ preventScroll: true }), 450);
  }; }
  bindSchoolTests();
  $app.querySelectorAll('.tdc-more').forEach((b) => (b.onclick = () => { const el = b.closest('.tdc-ch'), open = el.classList.toggle('open'); b.textContent = open ? Z('Show fewer', '顯示較少') : b.dataset.more; }));
  $app.querySelectorAll('.tdc-prog').forEach((b) => (b.onclick = () => go({ name: 'progress' })));
  { const st = document.getElementById('msstart'); if (st) st.onclick = () => { const r = $app.querySelector('button.ms-row'); if (r) r.click(); }; }
  { const b = document.getElementById('twX'); if (b) b.onclick = () => { const c = b.closest('.td-wins'); local.winsHid = { d: dayStart(), k: c.dataset.k }; saveLocal(); c.remove(); }; }
  $app.querySelectorAll('[data-mtime]').forEach((b) => (b.onclick = () => { local.mtime = +b.dataset.mtime; local.mission = null; saveLocal(); renderHome(); }));
  { const lg = document.getElementById('lessonGo'); if (lg && lessonLeft) lg.onclick = () => go({ name: 'learn', bookId: lessonLeft.b.id, unitId: lessonLeft.u.id }); }
  { const lx = document.getElementById('lessonX'); if (lx && lessonLeft) lx.onclick = async () => {
    if (!(await confirmLeave({ title: Z('Close this lesson?', '關閉這一課？'), body: Z('Your place in it is cleared. You can start it again any time from the chapter.', '會清除這一課的進度，你可以隨時在章節重新開始。'), stay: Z('Keep it', '保留'), leave: Z('Close', '關閉') }))) return;
    delete local.lessonAt[lessonLeft.key]; saveLocal(); renderHome(); }; }
  { const sg2 = document.getElementById('slipGo'); if (sg2 && slip) sg2.onclick = () => { pick = { bookId: slip.b.id, ids: new Set([slip.u.id]) }; startUnits(slip.b, [slip.u], 10); }; }
  $app.querySelectorAll('[data-qgo]').forEach((b) => (b.onclick = () => go({ name: b.dataset.qgo })));
  $app.querySelectorAll('[data-tq]').forEach((b) => (b.onclick = () => quick[+b.dataset.tq].run()));
  { const mm = document.getElementById('msmore'); if (mm) mm.onclick = () => (extra ? extra.run() : go({ name: 'practice' })); }
  $app.querySelectorAll('[data-tdact]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const f = tdActs[+b.dataset.tdact]; if (f) f(); }));
  bindTestCards($app);
  $app.querySelectorAll('[data-tplan]').forEach((b) => (b.onclick = () => { const f = tdPlans[+b.dataset.tplan]; if (f) f(); }));
  $app.querySelectorAll('[data-dictgo]').forEach((b) => (b.onclick = () => go(b.dataset.dictgo === 'new' ? { name: 'dictation', id: 'new' } : { name: 'dictation', id: b.dataset.dictgo, sub: 'run' })));
  $app.querySelectorAll('[data-wrgo]').forEach((b) => (b.onclick = () => go({ name: 'writing' })));
  $app.querySelectorAll('[data-mlearn]').forEach((b) => (b.onclick = () => { const [bid, uid] = b.dataset.mlearn.split(':'); go({ name: 'learn', bookId: bid, unitId: uid }); }));
  $app.querySelectorAll('[data-weak]').forEach((b) => (b.onclick = () => { const [bid, uid] = b.dataset.weak.split(':'), bk = books.find((x) => x.id === bid), u = bk && bk.units.find((x) => x.id === uid); if (u) startUnits(bk, [u], local.count || sessionSize()); }));
  $app.querySelectorAll('[data-tstep]').forEach((b) => (b.onclick = () => { const p = tests.steps[+b.dataset.tstep]; if (p) p.step.run(); }));
  $app.querySelectorAll('[data-lv]').forEach((b) => (b.onclick = async () => { const bk = (await getBooks()).find((x) => x.id === b.dataset.lv); if (bk) startPlacement(bk); }));
  bindPracticeTiles(); bindGear();
  window.scrollTo(0, 0);
}
// Every practice tool, as tiles (used on the Practice page; Today shows a few with a link to the rest).
function practiceTiles() {
  const t = {};
  const html = `
        <button class="qtile" data-mode="weak">${actionTile('weak', 44)}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="qtile" data-mode="mock">${lockTag('mock')}${actionTile('mock', 44)}<b>${LANG === 'zh' ? '模擬考試' : 'Mock exam'}</b><span>${isPrimaryKid() ? (LANG === 'zh' ? '校內考試模式，限時' : 'School-exam style, timed') : inHK() ? 'DSE-style, timed' : (LANG === 'zh' ? '考試模式，限時' : 'Exam style, timed')}</span></button>
        <button class="qtile hwtile" id="hwgo">${lockTag('homework')}${actionTile('homework', 44)}<b>Homework help</b><span>Snap a photo, get hints</span></button>
        <button class="qtile hwtile" id="dictgo">${actionTile('dictation', 44)}<b>${LANG === 'zh' ? '默書' : 'Dictation'}</b><span>I read, you write</span></button>
        <button class="qtile hwtile" id="wrgo">${lockTag('writing')}${actionTile('writing', 44)}<b>${LANG === 'zh' ? '寫作' : 'Writing'}</b><span>${isPrimaryKid() ? (LANG === 'zh' ? '溫和的評語，再改寫' : 'Kind feedback, then redraft') : inHK() ? (LANG === 'zh' ? 'DSE 準則評語，再改寫' : 'DSE-style feedback, then redraft') : (LANG === 'zh' ? '考試準則評語，再改寫' : 'Exam-style feedback, then redraft')}</span></button>${readAloudOn() || !isPrimaryKid() ? `<button class="qtile hwtile" id="lngo">${actionTile('listening', 44)}<b>${LANG === 'zh' ? '聆聽' : 'Listening'}</b><span>${LANG === 'zh' ? '先聽，再作答' : 'Listen, then answer'}</span></button>` : ''}${ssaOn() ? `<button class="qtile hwtile" id="ssago">${actionTile('sprint', 44)}<b>${LANG === 'zh' ? '呈分試衝刺' : 'Exam sprint'}</b><span>${LANG === 'zh' ? '中英數弱項，限時' : 'Chinese, English, Maths weak spots'}</span></button>` : ''}<button class="qtile hwtile" id="spgo">${lockTag('speaking')}${actionTile('speaking', 44)}<b>${LANG === 'zh' ? '說話' : 'Speaking'}</b><span>${isPrimaryKid() ? (LANG === 'zh' ? '朗讀再回答' : 'Read aloud and answer') : inHK() ? (LANG === 'zh' ? 'DSE 卷四，一分鐘回答' : 'DSE Paper 4, one-minute answers') : (LANG === 'zh' ? '一分鐘回答' : 'One-minute answers')}</span></button>
`;
  html.split(/(?=<button class="qtile)/).map((x) => x.trim()).filter(Boolean).forEach((x) => { const m = /data-mode="(\w+)"|id="(\w+)"/.exec(x); if (m) t[m[1] || m[2]] = x; });
  return t;
}
function bindPracticeTiles() {
  { const hg = document.getElementById('hwgo'); if (hg) hg.onclick = () => go({ name: 'homework' }); }
  { const dg = document.getElementById('dictgo'); if (dg) dg.onclick = () => go({ name: 'dictation' }); }
  { const wg = document.getElementById('wrgo'); if (wg) wg.onclick = () => go({ name: 'writing' }); }
  { const sg = document.getElementById('spgo'); if (sg) sg.onclick = () => go({ name: 'speaking' }); }
  { const lg = document.getElementById('lngo'); if (lg) lg.onclick = () => go({ name: 'listening' }); }
  { const sp = document.getElementById('ssago'); if (sp) sp.onclick = () => startReview('ssa'); }
  { const ws = document.getElementById('worksheets'); if (ws) ws.onclick = () => go({ name: 'worksheets' }); }
  { const ap = document.getElementById('allpractice'); if (ap) ap.onclick = () => go({ name: 'practice' }); }
  $app.querySelectorAll('.qtile[data-mode], .plan-item[data-mode], .ms-row[data-mode]').forEach((b) => (b.onclick = () => (b.dataset.mode === 'spaced' ? startReview('spaced', null, +b.dataset.cap || 15) : go({ name: 'pick', mode: b.dataset.mode }))));
}
const gearBtn = () => ''; const gearBtnOld = () => `<button class="mob-gear" data-gear aria-label="${LANG === 'zh' ? '設定' : 'Settings'}">${menuIcon('settings', false, 22)}</button>`;
const titleRow = (h1) => `<div class="ttl-row">${h1}${gearBtn()}</div>`; // main tabs: page title + Settings gear on phones
function renderPractice() {
  const T = practiceTiles(), Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const pick = (ids) => ids.map((k) => T[k] || '').join('');
  $app.innerHTML = `
  <main class="pad stack g18" data-view="practice" style="flex:1">
    <div class="greet" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h1 class="pagetitle" style="margin:0">${Z('Practice', '練習')}</h1><p>${Z('Every way to practise, in one place.', '所有練習方式，都在這裡。')}</p></div>${gearBtn()}</div>
    <section class="stack g10"><div class="sect-head"><h2>${Z('Study tools', '學習工具')}</h2></div><div class="quick">
      ${pick(['hwgo'])}
      <button class="qtile" id="lessongo">${actionTile('learn', 44)}<b>${Z('Lessons', '課堂')}</b><span>${Z('Buddy teaches a chapter step by step', 'Buddy 逐步教你一章')}</span></button>
      <button class="qtile" id="notesgo">${actionTile('notes', 44)}<b>${Z('Revision notes', '溫習筆記')}</b><span>${Z('Key points for each chapter', '每一章的重點')}</span></button>
      <button class="qtile" id="cardsgo">${actionTile('flashcards', 44)}<b>${Z('Flashcards', '閃卡')}</b><span>${Z('Quick-fire recall', '快速記憶')}</span></button>
      <button class="qtile" id="questionsgo">${actionTile('practise', 44)}<b>${Z('Practice questions', '練習題')}</b><span>${Z('Pick a book, then chapters', '選課本，再選章節')}</span></button>
      ${pick(['mock', 'weak'])}
      <button class="qtile" id="mkgo">${actionTile('mistakes', 44)}<b>${Z('Mistake book', '錯題簿')}</b><span>${mistakeCount() ? Z(`${mistakeCount()} to get right`, `${mistakeCount()} 題要改正`) : Z('Nothing to fix right now', '暫時沒有錯題')}</span>${mistakeCount() ? `<span class="qt-badge">${mistakeCount() > 99 ? '99+' : mistakeCount()}</span>` : ''}</button>
      ${pick(['ssago'])}</div>
      ${(local.worksheets || []).length ? `<button class="weekstrip" id="worksheets"><span class="wt"><b>Mark a printed worksheet</b><span>Enter the answers you wrote on paper</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></button>` : ''}
</section>
    <section class="stack g10"><div class="sect-head"><h2>${Z('Language skills', '語文技能')}</h2></div><div class="quick">${pick(['dictgo', 'wrgo', 'lngo', 'spgo'])}</div></section>
  </main>${footerHTML()}`;
  bindPracticeTiles(); bindGear();
  // one book: straight to its page; several: ask which book first
  const toBook = async (mode) => { const bs = await getBooks(); if (bs.length === 1) go({ name: 'book', bookId: bs[0].id, focus: mode }); else go({ name: 'chapters', mode }); };
  document.getElementById('lessongo').onclick = () => toBook('learn');
  document.getElementById('questionsgo').onclick = () => toBook('practise');
  document.getElementById('mkgo').onclick = () => go({ name: 'mistakes' });
  document.getElementById('notesgo').onclick = () => toBook('notes');
  document.getElementById('cardsgo').onclick = () => toBook('cards');
  window.scrollTo(0, 0);
}
// Practice → Lessons / Practice questions: which book? Then that book's page opens at its lessons or its chapter list.
async function renderChapters(mode) {
  const Z = (en, zh) => (LANG === 'zh' ? zh : en), learnMode = mode === 'learn', focus = ['learn', 'notes', 'cards'].includes(mode) ? mode : 'practise';
  const head = { learn: [Z('Lessons', '課堂'), 'learn'], notes: [Z('Revision notes', '溫習筆記'), 'notes'], cards: [Z('Flashcards', '閃卡'), 'flashcards'] }[mode] || [Z('Practice questions', '練習題'), 'practise'];
  const books = await getBooks();
  if (books.length === 1) return go({ name: 'book', bookId: books[0].id, focus });
  if (!view || view.name !== 'chapters') return;
  $app.innerHTML = `${backTop({ name: 'practice' }, 'Practice')}<main class="pad stack g14" data-view="chapters" style="flex:1">
    <div class="pick-head">${actionTile(head[1], 52)}<div class="stack g6"><h1 class="pagetitle" style="margin:0">${head[0]}</h1><p class="muted" style="margin:0;line-height:1.5">${Z('Which book?', '選哪一本課本？')}</p></div></div>
    ${books.length ? `<div class="pc-list">${(await Promise.all(books.map(async (b) => { let pct = 0; try { pct = (await bookMastery(b)).pct; } catch (e) {} return `<button class="pc-row big" data-bk="${esc(b.id)}">
      ${subjectTile(b.subject, 44, b.title)}<span class="pc-t"><b data-raw>${esc(b.subject ? subj(b.subject) : shortTitle(b.title))}</b><small data-raw>${esc(b.title)}${pct ? ` · ${pct}% ${Z('mastered', '已掌握')}` : ''}</small></span>
      <span class="pc-chev" aria-hidden="true">›</span></button>`; }))).join('')}</div>`
    : `<button class="weekstrip" id="pcadd"><span class="wt"><b>${Z('Add a textbook', '加入課本')}</b><span>${Z('Then pick it here', '之後便可在這裏選擇')}</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></button>`}
  </main>`;
  $app.querySelectorAll('[data-bk]').forEach((b) => (b.onclick = () => { local.pracBook = b.dataset.bk; saveLocal(); go({ name: 'book', bookId: b.dataset.bk, focus }); }));
  { const a = document.getElementById('pcadd'); if (a) a.onclick = () => go({ name: 'library' }); }
  window.scrollTo(0, 0);
}
function bindGear() {} // the gear is handled for every screen by the click listener below
document.addEventListener('click', (e) => { const g = e.target.closest && e.target.closest('[data-gear]'); if (g) go({ name: 'settings' }); });
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('footer #usage')) go({ name: 'usage' }); });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-privacy]'); if (!b) return; e.preventDefault(); if (document.querySelector('main.pilotgate')) privacyOverlay(); else go({ name: 'privacy' }); }); // Settings, footer and the consent step // the footer's AI usage button, on every screen
// The privacy / AI note lives in Settings → Privacy (it used to sit under every tab page).
const footerHTML = () => '';
/* ---------- children on this device (siblings sharing a tablet) ----------
   Each child gets their own localStorage key and IndexedDB database (see KIDS near the top and store.js).
   Switching child reloads the app, so every screen starts clean with that child's books and progress.
   Family-wide things (family code, consent, plan, parent PIN, screen settings) are copied to a new child. */
const KID_AV = ['🦊', '🐼', '🐯', '🐨', '🐸', '🐧', '🦁', '🐰'];
const KID_SHARED = ['code', 'pilot', 'consent', 'toured', 'plan', 'planLock', 'planYearly', 'pin', 'pinAt', 'beta', 'installTipOff', 'helperSize', 'sideW', 'voiceCC', 'starsOn'];
const kidSave = () => { if (WIPING) return; try { localStorage.setItem(KIDS_KEY, JSON.stringify(KIDS)); } catch (e) {} };
function kidMeta() { KID.grade = gradeNow() || ''; KID.name = (local.name || '').trim().slice(0, 20); if (KIDS.list.length > 1 || localStorage.getItem(KIDS_KEY)) kidSave(); }
const kidLabel = (k) => k.nick || k.name || (k.grade ? (LANG === 'zh' ? gradeName(k.grade) : k.grade) : (LANG === 'zh' ? `孩子 ${KIDS.list.indexOf(k) + 1}` : `Child ${KIDS.list.indexOf(k) + 1}`));
const kidChip = () => `<button class="kidchip" data-kidgo aria-label="${LANG === 'zh' ? '轉換孩子' : 'Switch child'}"><span>${KID_AV[KID.av || 0]}</span><b>${esc(kidLabel(KID))}</b><span aria-hidden="true">▾</span></button>`;
// Which child is studying is remembered for a few hours of use, not just this browser tab: phones reload pages
// (pull-to-refresh, switching apps, home-screen apps), and asking "Who's studying?" after every reload got in the way.
const KID_PICK = 'pb.kidPick', KID_PICK_MS = 3 * 3600e3;
function kidPicked(id) { if (WIPING) return; try { localStorage.setItem(KID_PICK, JSON.stringify({ id: id || KID.id, at: Date.now() })); } catch (e) {} }
function kidPickFresh() { try { const p = JSON.parse(localStorage.getItem(KID_PICK) || 'null'); return !!(p && p.id === KID.id && Date.now() - p.at < KID_PICK_MS); } catch (e) { return true; } }
function switchKid(id) {
  KIDS.cur = id; kidSave(); kidPicked(id);
  location.replace(location.pathname + location.search); // back to Today for the other child
}
function addKid() {
  const id = 'k' + Date.now().toString(36);
  const used = new Set(KIDS.list.map((k) => k.av || 0)); let av = 0; while (used.has(av) && av < KID_AV.length - 1) av++;
  const fresh = { stats: {}, reports: [], usage: {}, log: [], name: '', types: 'mix', mistakes: {}, needProfile: true };
  KID_SHARED.forEach((k) => { if (local[k] !== undefined) fresh[k] = local[k]; });
  const kid = { id, key: `prepbuddy.v2:${id}`, db: `prepbuddy:${id}`, av };
  try { localStorage.setItem(kid.key, JSON.stringify(fresh)); } catch (e) { return toast(LANG === 'zh' ? '這部裝置的儲存空間不足。' : 'This device is out of storage space.'); }
  kidMeta(); KIDS.list.push(kid); switchKid(id);
}
async function removeKid(id) {
  const k = KIDS.list.find((x) => x.id === id); if (!k || k.id === KID.id) return false;
  const ok = await confirmLeave({ title: LANG === 'zh' ? `移除 ${kidLabel(k)}？` : `Remove ${kidLabel(k)}?`,
    body: LANG === 'zh' ? '這個孩子在這部裝置上的課本、進度和星星都會刪除，不能復原。' : 'Their books, progress and stars on this device will be deleted. This can’t be undone.',
    stay: LANG === 'zh' ? '取消' : 'Cancel', leave: LANG === 'zh' ? '移除' : 'Remove' });
  if (!ok || !(await askPin(LANG === 'zh' ? '輸入家長密碼以移除這個孩子。' : 'Enter the parent PIN to remove this child.'))) return false;
  try { localStorage.removeItem(k.key); } catch (e) {}
  try { indexedDB.deleteDatabase(k.db); } catch (e) {}
  KIDS.list = KIDS.list.filter((x) => x.id !== id); kidSave();
  return true;
}
// "Who's studying?" Shown when the app opens on a device with more than one child, and from the chip on Today.
function kidPicker({ boot } = {}) {
  return new Promise((resolve) => {
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
    let manage = false, drawn = false;
    const close = () => { if (nav) nav.style.display = ''; resolve(); };
    const draw = () => {
      $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1"><div class="pg-box cs-box kid-box${drawn ? ' noanim' : ''}">
        <h1 style="margin:0;text-align:center">${C('Who’s studying?', '邊個溫習？')}</h1>
        <div class="kid-grid">${KIDS.list.map((k) => `<div class="kid-cell"><button class="kid${k.id === KID.id ? ' on' : ''}" data-kid="${k.id}" ${manage ? 'disabled' : ''}><span class="kid-av">${KID_AV[k.av || 0]}</span><b>${esc(kidLabel(k))}</b>${(k.nick || k.name) && k.grade ? `<small>${esc(LANG === 'zh' ? gradeName(k.grade) : k.grade)}</small>` : ''}</button>${manage && k.id !== KID.id ? `<button class="btn-sm quiet kid-del" data-del="${k.id}">${C('Remove', '移除')}</button>` : ''}</div>`).join('')}
          ${!manage && KIDS.list.length < 6 ? `<div class="kid-cell"><button class="kid add" id="kidAdd"><span class="kid-av">＋</span><b>${C('Add a child', '新增孩子')}</b></button></div>` : ''}</div>
        <p class="hint" style="margin:0;text-align:center">${C('Each child has their own books, progress and stars on this device.', '每個孩子在這部裝置上都有自己的課本、進度和星星。')}</p>
        <div class="kid-foot">${boot ? '' : `<button class="btn-sm" id="kidBack">${C('Back', '返回')}</button>`}${KIDS.list.length > 1 ? `<button class="btn-sm quiet" id="kidManage">${manage ? C('Done', '完成') : C('Manage children', '管理')}</button>` : ''}</div>
      </div></main>`;
      drawn = true;
      $app.querySelectorAll('[data-kid]').forEach((b) => (b.onclick = () => { if (b.dataset.kid === KID.id) { kidPicked(); return close(); } switchKid(b.dataset.kid); }));
      $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (await removeKid(b.dataset.del)) { if (KIDS.list.length < 2) manage = false; } draw(); }));
      const ad = document.getElementById('kidAdd'); if (ad) ad.onclick = async () => {
        const ok = await confirmLeave({ title: C('Add another child?', '新增另一個孩子？'), body: C('They’ll start fresh with their own books and progress. You’ll set their grade next. Switch between children from the chip at the top of Today.', '新孩子會有自己的課本和進度，下一步會設定年級。可在「今日」頁頂轉換孩子。'), stay: C('Cancel', '取消'), leave: C('Add child', '新增') });
        if (ok) addKid();
      };
      const bk = document.getElementById('kidBack'); if (bk) bk.onclick = close;
      const mg = document.getElementById('kidManage'); if (mg) mg.onclick = () => { manage = !manage; draw(); };
    };
    draw(); window.scrollTo(0, 0);
  });
}
function bindHomeCommon() {
  $app.querySelectorAll('[data-kidgo]').forEach((b) => (b.onclick = async () => { await kidPicker(); go({ name: 'home' }); }));
}

/* ---------- Books: my textbooks, the library and uploads ---------- */
// Books are grouped by subject. With lots of books, subject buttons and a search box narrow the list.
const subjectOf = (b) => subj(String(b.subject || '').trim()) || (b.library ? 'Other' : 'My uploads');
const LAST_GROUPS = ['Other', 'My uploads'];
function groupBySubject(items, subj) {
  const map = new Map();
  for (const it of items) { const k = subj(it); if (!map.has(k)) map.set(k, []); map.get(k).push(it); }
  return [...map.entries()].sort((a, b) => (LAST_GROUPS.indexOf(a[0]) - LAST_GROUPS.indexOf(b[0])) || a[0].localeCompare(b[0]));
}
function subjectChips(groups, picked, total) {
  if (groups.length < 2) return '';
  const ic = (k, on) => (k === 'all' ? '' : subjectIcon(k === 'Other' || k === 'My uploads' ? '' : k, 18, on ? '#FFFFFF' : null, k));
  const chip = (k, label, n) => `<button class="fchip ${picked === k ? 'on' : ''}" data-subj="${esc(k)}" aria-pressed="${picked === k}">${ic(k, picked === k)}<span data-raw>${esc(label)}</span><small>${n}</small></button>`;
  return `<div class="fchips" role="group" aria-label="Subjects">${chip('all', subjLabel('all'), total)}${groups.map(([k, xs]) => chip(k, subjLabel(k), xs.length)).join('')}</div>`;
}
const textMatch = (words, hay) => words.every((w) => hay.includes(w));
// Subject names come from the books (not translated); the app's own group names are.
const subjLabel = (k) => (LANG === 'zh' ? { all: '全部', Other: '其他', 'My uploads': '我上載的' }[k] : { all: 'All' }[k]) || subj(k);
let booksPick = 'all';

async function renderBooks() {
  const books = await getBooks();
  // When each book was last practised (newest first), so the books in use are always at the top.
  const lastT = {};
  for (const e of local.log) { const [bid] = qUnit(e.q); if (bid && (!lastT[bid] || e.t > lastT[bid])) lastT[bid] = e.t; }
  const items = [];
  for (const b of books) {
    const { n } = await bookSummary(b); const sc = (await bookMastery(b)).pct;
    items.push({ b, n, sc, t: lastT[b.id] || 0 });
  }
  items.sort((x, y) => (y.t - x.t) || subjectOf(x.b).localeCompare(subjectOf(y.b)) || x.b.title.localeCompare(y.b.title));
  const recentId = items.length > 1 && items[0].t ? items[0].b.id : '';
  const groupsAll = groupBySubject(items, (it) => subjectOf(it.b));
  if (booksPick !== 'all' && !groupsAll.some(([k]) => k === booksPick)) booksPick = 'all';
  const many = books.length > 6;
  const view = local.bookView === 'list' ? 'list' : 'grid';
  const W = (en, zh) => (LANG === 'zh' ? zh : en);
  const chN = (n) => W(`${n} chapter${n === 1 ? '' : 's'}`, `${n} 章`);
  const viewBtn = (v, icon, label) => `<button class="bv-btn ${view === v ? 'on' : ''}" data-view-set="${v}" aria-pressed="${view === v}" aria-label="${label}" title="${label}">${icon}</button>`;
  const GRID = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>';
  const LIST = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>';
  $app.innerHTML = `
  <main class="pad stack g18" data-view="books" style="flex:1">
    <div class="bks-head">
      <div class="stack" style="gap:2px"><h1 class="pagetitle" style="margin:0">Books</h1><span class="muted bk-count bk-sub">${W('All your textbooks in one place.', '你所有的課本都在這裏。')}</span></div>
      <button class="btn small" id="addbook" style="width:auto;padding:10px 16px;display:inline-flex;gap:6px;align-items:center">${ICON.plus} <span>${LANG === 'zh' ? '加入<span class="hide-sm">課本</span>' : 'Add<span class="hide-sm"> a textbook</span>'}</span></button>${gearBtn()}
    </div>
    ${books.length ? `${many ? `<div class="bk-tools"><form id="find" class="searchbox light" role="search"><span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Find in my textbooks" aria-label="Find in my textbooks" autocomplete="off"></form></div>` : ''}
    <div class="bk-bar"><div id="chips">${subjectChips(groupsAll, booksPick, books.length)}</div>
      ${books.length > 1 ? `<div class="bk-view" role="group" aria-label="${W('Show as', '顯示方式')}">${viewBtn('grid', GRID, W('Covers', '封面'))}${viewBtn('list', LIST, W('List', '清單'))}</div>` : ''}</div>
    <div id="shelf" aria-live="polite"></div>`
    : `<div class="card bk-empty"><span class="bk-empty-ic">${subjectIcon('', 34, null, '')}</span><b>${W('No textbooks yet', '仍未加入課本')}</b><p>${W('Add the textbooks you use at school, then practise any chapter.', '加入你在學校用的課本，就可以練習任何一章。')}</p></div>`}
  </main>`;
  // A cover in the subject's colour. A book not started yet says "New" instead of a discouraging 0%.
  const prog = ({ sc, t }) => (sc || t ? `<b>${sc}%</b><span class="c-meter" aria-hidden="true"><i style="width:${sc}%"></i></span>` : `<span class="c-new">${W('New', '新')}</span>`);
  const recentTag = (b) => (b.id === recentId ? `<span class="c-recent">${W('Last used', '最近使用')}</span>` : '');
  // A spiral-bound textbook: cover in the subject's colour, a white title label, a wire coil down the left edge.
  const cover = (it) => { const { b } = it; return `<button class="bookcover tb" data-book="${esc(b.id)}" style="--cc:${coverColour(b)}" aria-label="${esc(b.title)}">
      ${recentTag(b)}<span class="tb-coil" aria-hidden="true"></span>
      <span class="tb-top"><span class="c-sub" data-raw>${esc(b.subject ? subj(b.subject) : (b.library ? '' : W('My upload', '我上載的')))}</span><span class="c-ic">${subjectIcon(b.subject, 22, null, b.title)}</span></span>
      <span class="tb-label"><span class="c-title" data-raw>${esc(b.title)}</span></span>
      <span class="c-foot"><span class="c-ch">${chN(b.units.length)}</span>${prog(it)}</span>
    </button>`; };
  // A row: spine in the subject colour, title, subject and level, and a progress ring.
  const row = (it) => { const { b, sc, t } = it; return `<button class="bkrow" data-book="${esc(b.id)}" aria-label="${esc(b.title)}, ${sc}%">
      <span class="bkr-spine" style="background:${coverColour(b)}">${subjectIcon(b.subject, 20, '#FFFFFF', b.title)}</span>
      <span class="bkr-main"><b data-raw>${esc(b.title)}</b><span class="bkr-meta"><span data-raw>${esc(b.subject ? subj(b.subject) : W('My upload', '我上載的'))}</span>${b.level ? ` · <span data-raw>${esc(b.level)}</span>` : ''} · ${chN(b.units.length)}${b.id === recentId ? ` · <span class="bkr-recent">${W('Last used', '最近使用')}</span>` : ''}</span></span>
      ${sc || t ? `<span class="bkr-ring" style="--p:${sc};--c:${coverColour(b)}"><span>${sc}%</span></span>` : `<span class="c-new on-light">${W('New', '新')}</span>`}
      <span class="bkr-go" aria-hidden="true">›</span>
    </button>`; };
  const q = document.getElementById('q');
  const draw = () => {
    const shelf = document.getElementById('shelf'); if (!shelf) return;
    const words = (q ? q.value : '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => (booksPick === 'all' || subjectOf(it.b) === booksPick) &&
      textMatch(words, `${it.b.title} ${it.b.subject || ''} ${subjectName(it.b.subject, 'zh')} ${it.b.code || ''} ${it.b.level || ''}`.toLowerCase()));
    shelf.innerHTML = hits.length
      ? (view === 'list' ? `<div class="bklist">${hits.map(row).join('')}</div>` : `<div class="covergrid">${hits.map(cover).join('')}</div>`)
      : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5">None of your textbooks match.</p><p class="muted" style="margin:8px 0 0;font-size:14px;line-height:1.5">Try another word, or tap Add a textbook to search the library.</p></div>`;
    shelf.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  };
  const bindChips = () => document.querySelectorAll('#chips [data-subj]').forEach((c) => (c.onclick = () => {
    booksPick = c.dataset.subj;
    document.getElementById('chips').innerHTML = subjectChips(groupsAll, booksPick, books.length); bindChips(); draw();
  }));
  bindChips();
  $app.querySelectorAll('[data-view-set]').forEach((v) => (v.onclick = () => { local.bookView = v.dataset.viewSet; saveLocal(); renderBooks(); }));
  if (q) { q.oninput = draw; document.getElementById('find').onsubmit = (e) => { e.preventDefault(); q.blur(); }; }
  document.getElementById('addbook').onclick = () => go({ name: 'library', query: '' });
  draw();
  window.scrollTo(0, 0);
}

/* ---------- settings ---------- */
// Settings: a menu of blocks; each block opens its own short page (view.sec).
/* ---------- Why PrepBuddy (from Settings): what it does that a tutor, a learning centre or a workbook can't ----------
   Every claim here is something the app does today. Things not built yet sit under "Coming next". */
function renderAbout() {
  const Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const Y = '<span class="ab-y" aria-label="yes">✓</span>', N = '<span class="ab-n" aria-label="no">✕</span>', P = (t) => `<span class="ab-p">${t}</span>`;
  const prog = [
    [Z('Practice from your child’s own school textbook', '用孩子自己的課本練習'), Y, N, P(Z('Syllabus', '課程大綱')), Y, P(Z('If you paste it', '要自己貼上'))],
    [Z('How ready for this test, and by test day', '這次測驗準備得如何，考試時會怎樣'), Y, N, N, P(Z('A feeling', '憑感覺')), N],
    [Z('Names the exact mix-up, from their answers', '從答案中指出具體的混淆'), Y, P(Z('Missed questions', '答錯的題目')), P(Z('Weak topics', '弱項課題')), Y, N],
    [Z('Plans every day backwards from the test date', '按考試日期倒數安排每一天'), Y, N, P(Z('Some', '部分')), P(Z('Weekly lesson', '每週一堂')), N],
    [Z('Before-and-after check, same chapters and level', '相同章節及程度的前後對比'), Y, P(Z('Some', '部分')), N, P(Z('Sometimes', '有時')), N],
    [Z('Checks what’s remembered weeks later', '檢查幾星期後是否仍記得'), Y, P(Z('Some', '部分')), N, P(Z('Rarely', '很少')), N],
    [Z('Written answers marked, not just multiple choice', '批改文字答案，不只選擇題'), Y, P(Z('Some', '部分')), P(Z('Some', '部分')), Y, P(Z('Not reliably', '不太可靠'))],
    [Z('School marks before and after, side by side', '使用前後的學校成績並列'), Y, N, N, P(Z('Sometimes', '有時')), N],
    [Z('A weekly report you can share, in plain words', '可分享、淺白的每週報告'), Y, P(Z('Usage stats', '使用數據')), Y, P(Z('Varies', '不一定')), N],
  ];
  const rows = [
    [Z('Uses your child’s own school textbook', '用孩子自己的課本'), Y, P(Z('Only pages you paste in each time', '每次要自己貼上內容')), P(Z('Sometimes', '有時')), P(Z('Own materials', '自家教材')), N],
    [Z('There every day, whenever your child is free', '每天隨時可用'), Y, Y, P(Z('1–2 hours a week', '每週 1–2 小時')), P(Z('Fixed class times', '固定上課時間')), Y],
    [Z('Sets the right practice without being asked', '主動安排合適的練習'), Y, P(Z('Only what you ask for', '只做你要求的')), Y, P(Z('Class plan', '按課程安排')), P(Z('Fixed pages', '固定頁數'))],
    [Z('Marks every answer straight away, and explains it', '每題即時批改並解釋'), Y, P(Z('If you ask', '要自己問')), P(Z('In the lesson', '上堂時')), P(Z('In class', '課堂上')), P(Z('Answer key', '答案頁'))],
    [Z('Questions checked against the textbook, with the page shown', '題目與課本核對，並顯示出處'), Y, P(Z('Can sound sure and still be wrong', '可能說錯但語氣肯定')), Y, Y, Y],
    [Z('Adjusts difficulty chapter by chapter', '按每章調整難度'), Y, N, P(Z('A good one does', '好的導師會')), P(Z('Class pace', '跟全班進度')), N],
    [Z('Keeps every mistake and brings it back until it’s right', '記住每題錯題，直到改正'), Y, N, P(Z('Partly', '部分')), N, N],
    [Z('Brings topics back just before they’re forgotten', '在快要忘記前安排溫習'), Y, N, N, N, N],
    [Z('Plans each day around school test dates', '按學校測驗日期安排每天'), Y, N, P(Z('Sometimes', '有時')), N, N],
    [Z('Shows parents progress every week', '每週向家長報告進度'), Y, N, P(Z('A quick chat', '口頭交代')), P(Z('Each term', '每學期')), N],
    [Z('Made for children, and keeps them on schoolwork', '為兒童而設，專注學業'), Y, P(Z('General-purpose; ChatGPT is for ages 13+', '通用工具；ChatGPT 只限 13 歲或以上')), Y, Y, Y],
    [Z('Rewards steady effort every day, not just test results', '每天獎勵持續努力，不只看考試成績'), Y, N, P(Z('Praise in the lesson', '上堂時稱讚')), P(Z('Stickers, sometimes', '有時派貼紙')), N],
    [Z('Knows your child: their level in every chapter, past mistakes, pace and test dates', '了解孩子：每章程度、過往錯誤、學習步伐和測驗日期'), Y, P(Z('Only what you tell it', '只知道你告訴它的')), P(Z('What they notice in lessons', '上堂時留意到的')), P(Z('As one of a class', '班上其中一人')), N],
    [Z('Typical cost each month', '每月大約費用'), `<b>HK$218–298</b><small>${Z('all subjects', '所有科目')}</small>`, `<b>${Z('Free–HK$160', '免費至 HK$160')}</b><small>${Z('ChatGPT Plus is US$20', 'ChatGPT Plus 為 US$20')}</small>`, `<b>HK$800–1,600+</b><small>${Z('per subject, 1 hr a week', '每科，每週 1 小時')}</small>`, `<b>HK$800–2,400+</b><small>${Z('per subject', '每科')}</small>`, `<b>${Z('Low', '低')}</b><small>${Z('per book', '每本')}</small>`],
  ];
  const qa = [
    [Z('What exactly is PrepBuddy?', 'PrepBuddy 究竟是甚麼？'),
      Z('A study coach on your phone or laptop, built from your child’s own textbooks. Add a book and Buddy turns every chapter into lessons, practice questions, chapter tests, mock exams, revision notes and flashcards, then marks every answer and decides what your child should do next.', '一個放在手機或電腦上的溫習教練，以孩子自己的課本為基礎。加入課本後，Buddy 會把每一章變成課堂、練習題、章節測驗、模擬試、筆記和溫習卡，批改每一題，並決定孩子下一步應該做甚麼。')],
    [Z('Why not just use ChatGPT?', '為甚麼不直接用 ChatGPT？'),
      Z('A general AI chat is a brilliant tool, but it only does what you ask, each time you ask. It doesn’t know which textbook your child uses, which chapters are on Friday’s test, or what they got wrong last week, and it can state wrong answers confidently. PrepBuddy uses the same kind of AI, but builds a whole tutor around it: questions made from and checked against your child’s own pages, every mistake kept and brought back, reviews timed before things are forgotten, a plan for each day up to the test, and a weekly report for you. Your child just opens it and starts; nobody has to know what to ask.', '一般 AI 聊天是很好的工具，但它只會做你每次要求的事。它不知道孩子用哪本課本、星期五測驗考哪幾章、上星期錯了甚麼，而且可能很肯定地說出錯誤答案。PrepBuddy 用同類的 AI，但圍繞它建立了一位完整的導師：題目由孩子自己的課本製作並與課本核對、每個錯誤都會記住並再出現、在快忘記前安排溫習、按測驗日期安排每天的練習，並每週向你報告。孩子打開就能開始，不用懂得怎樣發問。')],
    [Z('Does it really know my child, or is it just random questions?', '它真的了解我的孩子嗎？還是只是隨機出題？'),
      Z('It keeps a record of every answer and uses it. For each chapter it knows how far your child has got, how hard a question they can handle, which mistakes are still open, what they’re about to forget, and whether they passed a timed test. It also notices habits: how often hints were needed, whether a set was rushed, and when they usually study. Questions get harder as they improve and easier when they struggle, chapter by chapter.', '它會記錄每一個答案並加以運用。每一章它都知道孩子學到哪裡、能應付多難的題目、還有哪些錯題未改正、哪些快要忘記，以及有否通過限時測驗。它也會留意習慣：需要提示的次數、有否趕急完成、通常甚麼時候溫習。孩子進步，題目會變難；遇到困難，題目會變易，每章分開計算。')],
    [Z('How does it decide what my child does each day?', '它怎樣決定孩子每天做甚麼？'),
      Z('Each morning Buddy sets “Today’s mission”: up to three steps, most important first. A school test coming up comes first (learn what’s not started, then the weakest chapter, a practice test the day before). Then mistakes to fix, reviews that are due, a level check for a new book, and finally carrying on where they left off. Your child just taps Start.', '每天早上 Buddy 會定好「今日任務」：最多三個步驟，最重要的先做。即將來臨的學校測驗最優先（先學未開始的章節，再練最弱的一章，考試前一天做模擬測驗）。然後是改正錯題、到期的溫習、新課本的程度評估，最後是繼續上次的進度。孩子只需按「開始」。')],
    [Z('My child has a test next week. Can it help?', '孩子下星期有測驗，它可以幫忙嗎？'),
      Z('Yes. Add the test (a quiz, 默書 or a whole exam period) with its date and chapters. PrepBuddy shows how ready your child is for that test, chapter by chapter, tells them how much to do each day to be ready in time, and builds every day’s mission around it. Afterwards, snap the marked paper and the result is saved.', '可以。加入測驗（小測、默書或整個考試期）、日期及範圍。PrepBuddy 會逐章顯示孩子對該測驗的準備程度，告訴他們每天要做多少才能及時準備好，並以此安排每天的任務。考完後，拍下已批改的試卷，成績便會記錄下來。')],
    [Z('Are the questions really from my child’s school work?', '題目真的來自孩子的學校課本嗎？'),
      Z('Yes. Questions are written from the pages of the textbook your child uses, and each one shows where in the book it comes from. A second AI check rejects questions that don’t match the book, refer to something your child can’t see, or have a doubtful answer.', '是的。題目根據孩子所用課本的內容編寫，每一題都會註明出自課本哪一部分。另一輪 AI 檢查會剔除與課本不符、提及孩子看不到的內容，或答案有疑問的題目。')],
    [Z('Can I trust the AI’s marking?', 'AI 的批改可信嗎？'),
      Z('Multiple choice is marked exactly. Written answers are marked against a mark scheme, point by point, with the reason shown, so your child sees what earned each mark. Writing and speaking get estimated bands, never official grades. If anything looks wrong, your child taps “Report a problem” and we check it.', '選擇題按標準答案批改。文字題按評分準則逐點批改，並列出原因，讓孩子知道每一分從何而來。寫作和說話會給出估計等級，並非正式成績。如有問題，孩子可按「報告問題」，我們會跟進。')],
    [Z('What about writing, speaking, 默書 and homework?', '寫作、說話、默書和功課呢？'),
      Z('All included. Writing is marked by DSE or primary criteria, with the three fixes that matter most, then redrafted. Speaking answers are recorded and marked. 默書 lists are read aloud in natural Cantonese, Putonghua or English voices and checked. For homework, your child snaps a photo and Buddy guides them through it step by step, without just giving the answer.', '全部包括。寫作按 DSE 或小學準則批改，指出最重要的三項改善，然後再修改。說話回應會錄音及評分。默書詞語會以自然的粵語、普通話或英語朗讀並核對。功課方面，孩子拍照後，Buddy 會一步步引導，而不是直接給答案。')],
    [Z('How do I know it’s working?', '我怎樣知道它有效？'),
      Z('Three ways. “How ready” shows how much of each textbook your child has really mastered, with the change each week. “Getting stronger” shows their level in each subject, measured so it doesn’t drop when questions get harder. And “School results” puts their school marks from before PrepBuddy next to the latest ones. You also get a one-page weekly report.', '三方面。「準備程度」顯示孩子真正掌握了每本課本多少，以及每週的變化。「越來越強」顯示每科的程度，計算方法不會因題目變難而下降。「學校成績」把使用 PrepBuddy 前後的校內分數並列。你每週亦會收到一頁報告。')],
    [Z('How much time does it take?', '要花多少時間？'),
      Z('As little as 5 minutes. Your child chooses 5, 15 or 30 minutes and Today’s mission fits. Little and often works better than long, rare sessions, so the app nudges a daily habit with streaks, a weekly goal and stars.', '最少 5 分鐘。孩子可選 5、15 或 30 分鐘，今日任務會按此調整。少量而經常練習比偶爾長時間更有效，所以 App 會以連續日數、每週目標和星星鼓勵每天練習。')],
    [Z('How does it keep my child coming back?', '它怎樣令孩子願意每天回來？'),
      Z('By rewarding the habit, not just the result. A treat after a good test comes weeks after the work that earned it; PrepBuddy rewards the work itself, every day. Your child earns stars for finishing a set, fixing an old mistake, doing the day’s reviews, passing a chapter test and reaching the weekly goal, and spends them on rewards you choose in the star shop (screen time, a treat, a family movie night). Rushing through answers earns nothing, so stars only come from real effort. Streaks and badges add to it, and there’s a daily cap so it stays about learning.', '獎勵的是習慣，而不只是結果。考試考得好後的獎勵，往往是在努力過後幾個星期才出現；PrepBuddy 每天直接獎勵努力本身。孩子完成一組練習、改正舊錯題、完成當天溫習、通過章節測驗和達到每週目標都會獲得星星，並可在星星商店換取由你設定的獎勵（例如玩平板時間、小食、家庭電影夜）。趕急作答不會得到星星，所以星星只來自真正的努力。連續日數和徽章更添動力，每天亦設有上限，確保重點仍是學習。')],
    [Z('Should it replace our tutor?', '應該取代補習老師嗎？'),
      Z('Not necessarily. Many families use both. PrepBuddy covers the daily practice, marking and revision between lessons, and shows the tutor exactly which chapters are weak, so paid tutor time goes on what really needs a person. For some families, it’s enough on its own.', '不一定。很多家庭兩者並用。PrepBuddy 負責課堂之間的每日練習、批改和溫習，並清楚顯示哪些章節較弱，讓付費的補習時間用在真正需要老師的地方。對部分家庭來說，單用 PrepBuddy 已經足夠。')],
    [Z('Is my child’s data safe?', '孩子的資料安全嗎？'),
      Z('Your child’s work stays on your device. The AI only reads what it needs to write or mark a question. Pilot families share a short summary of progress with PrepBuddy, only after a parent agrees, and you can delete everything at any time from Settings.', '孩子的功課保存在你的裝置上。AI 只會讀取編寫或批改題目所需的內容。試用家庭在家長同意後，才會與 PrepBuddy 分享簡短的進度摘要，你亦可隨時在「設定」刪除所有資料。')],
  ];
  const surprise = [
    ['📖', Z('Your child’s own textbook', '孩子自己的課本'), Z('Not generic worksheets. Every question comes from the book their teacher uses.', '不是通用練習。每一題都來自老師所用的課本。')],
    ['🎯', Z('Knows the weak spots', '知道弱點在哪'), Z('Chapter by chapter, it finds what’s weak and goes back to it until it isn’t.', '逐章找出弱項，反覆練習直到掌握。')],
    ['🧠', Z('Stops forgetting', '防止遺忘'), Z('Brings topics back days later, just before they’d be forgotten.', '在快要忘記之前，安排幾天後再溫習。')],
    ['📅', Z('Plans to the test date', '按考試日期計劃'), Z('Add a school test and every day works towards it, with a forecast of how ready they’ll be.', '加入學校測驗，每天都為它準備，並預測考試當天的準備程度。')],
    ['✍️', Z('Marks like a teacher', '像老師一樣批改'), Z('Written answers, essays, speaking and 默書, marked with reasons, any time.', '文字題、作文、說話和默書，隨時批改並說明原因。')],
    ['⭐', Z('Makes them want to come back', '令孩子想再來'), Z('Stars for every honest effort (none for rushing), spent on rewards you choose. Streaks and badges keep the habit going.', '每次認真努力都有星星（趕急完成不計），可換取由你設定的獎勵。連續日數和徽章幫助建立習慣。')],
    ['👀', Z('Honest with parents', '對家長坦誠'), Z('Shows hints used and rushed sets, not just scores, and school marks before and after.', '不只顯示分數，也顯示用了多少提示、有否趕急，以及前後的學校成績。')],
  ];
  const next = [
    Z('Learns your child’s own pace: how many sets they need to master a chapter, so plans and forecasts fit them exactly.', '學習孩子自己的步伐：掌握一章需要多少組練習，讓計劃和預測更貼合。'),
    Z('“Buddy noticed”: patterns a tutor would spot, like “more accurate in the evening” or “often loses marks on units”.', '「Buddy 發現」：導師會留意到的規律，例如「晚上較準確」或「常因單位失分」。'),
    Z('A day-by-day plan to each exam that re-plans itself, with a mock exam aimed at weak spots.', '為每個考試制定每日計劃並自動調整，以及針對弱項的模擬試。'),
    Z('Weak spots at skill level, not just chapter level, with 3-minute mini-lessons on exactly that skill.', '找出技能層面的弱項（不只章節），並提供針對該技能的 3 分鐘小課堂。'),
  ];
  $app.innerHTML = `
  <main class="pad stack g18 about" data-view="settings" style="flex:1">
    <div class="topbar" style="padding:0"><button class="backbtn" id="back">${ICON.back}<span>${Z('Settings', '設定')}</span></button></div>
    <section class="ab-hero">${buddySVG('happy', 72)}<div><h1>${Z('Why PrepBuddy?', '為甚麼選擇 PrepBuddy？')}</h1>
      <p>${Z('A private tutor for your child’s own textbooks: there every day, marks every answer, remembers every mistake, and plans each day around their next school test.', '一位為孩子自己的課本而設的私人導師：每天都在、批改每一題、記住每一個錯誤，並按下一次學校測驗安排每一天。')}</p></div></section>
    <section class="ab-grid">${surprise.map(([ic, t, d]) => `<div class="ab-card"><span class="ab-ic" aria-hidden="true">${ic}</span><b>${t}</b><span>${d}</span></div>`).join('')}</section>
    <section class="card ab-sec"><h2>${Z('How it compares', '比較一下')}</h2>
      <div class="ab-scroll"><table class="ab-table"><thead><tr><th></th><th class="ab-us">PrepBuddy</th><th>${Z('General AI chat (e.g. ChatGPT)', '一般 AI 聊天（如 ChatGPT）')}</th><th>${Z('Private tutor', '私人補習')}</th><th>${Z('Learning centre', '補習社')}</th><th>${Z('Assessment books', '補充練習')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td class="ab-us">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint" style="margin:0">${Z('Tutor and centre costs are typical Hong Kong rates (about HK$200–600 an hour) for one lesson a week; they vary widely.', '補習費用為香港一般收費（約每小時 HK$200–600），以每週一堂計算，實際收費差異很大。')}</p></section>
    <section class="card ab-sec"><h2>${Z('Progress you can actually see', '看得見的進度')}</h2>
      <p class="hint" style="margin:0 0 10px">${Z('Most apps tell you how many questions were done. PrepBuddy tells you whether your child is ready for their test, what exactly they’re getting wrong, and whether it’s working.', '大部分應用程式只告訴你做了多少題。PrepBuddy 告訴你孩子是否準備好應付測驗、到底錯在哪裡，以及練習有沒有成效。')}</p>
      <div class="ab-scroll"><table class="ab-table"><thead><tr><th></th><th class="ab-us">PrepBuddy</th><th>${Z('Learning apps', '學習應用程式')}</th><th>${Z('Online tuition', '網上補習')}</th><th>${Z('Private tutor', '私人補習')}</th><th>${Z('General AI chat', '一般 AI 聊天')}</th></tr></thead>
      <tbody>${prog.map((r) => `<tr><th scope="row">${r[0]}</th><td class="ab-us">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('')}</tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px"><p class="hint" style="margin:0">${Z('Based on what these kinds of service typically show families.', '根據這類服務一般向家長提供的資料。')}</p><button class="btn" id="abSample">${Z('See a sample parent report', '看看家長報告樣本')}</button></div></section>
    <section class="ab-sec"><h2>${Z('Questions parents ask', '家長常見問題')}</h2>
      <div class="ab-qa">${qa.map(([q, a], i) => `<details class="ab-q" ${i === 0 ? 'open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></section>
    <section class="card ab-sec ab-honest"><h2>${Z('What it isn’t', '它不是甚麼')}</h2>
      <ul><li>${Z('Not a person. Buddy encourages and explains, but it can’t sit beside your child or replace your involvement.', '不是真人。Buddy 會鼓勵和解釋，但不能坐在孩子身旁，也不能取代家長的參與。')}</li>
      <li>${Z('Not an official mark. Writing and speaking bands are estimates to guide practice.', '不是正式成績。寫作和說話等級只是用來指導練習的估計。')}</li>
      <li>${Z('Not magic. Progress comes from practice: little and often, every day.', '不是魔法。進步來自練習：少量而經常，每天一點。')}</li></ul></section>
    <section class="card ab-sec"><h2>${Z('Coming next', '即將推出')}</h2><ul class="ab-next">${next.map((t) => `<li>${t}</li>`).join('')}</ul></section>
    <div class="ab-cta"><button class="btn" id="abTour">${Z('Take the tour', '看看導覽')}</button><button class="btn ghost" id="abPlans">${Z('See plans', '查看計劃')}</button></div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'settings' });
  document.getElementById('abTour').onclick = () => startTour('full');
  { const sb = document.getElementById('abSample'); if (sb) sb.onclick = () => window.open(sampleReportURL(), '_blank'); }
  document.getElementById('abPlans').onclick = () => go({ name: 'plans' });
}

function renderSettings(sec) {
  const zh = LANG === 'zh';
  const opt = (k, label, sub) => `<button class="langopt ${LANG === k ? 'on' : ''}" data-lang="${k}" aria-pressed="${LANG === k}" data-raw><b lang="${{ zh: 'zh-HK', fr: 'fr', ja: 'ja' }[k] || 'en'}">${label}</b><span>${sub}</span></button>`;
  const helpHTML = `${planCardHTML()}
    ${local.pilot ? `<section class="card stack g10" style="padding:16px">
      <b style="font-size:16px">${PLT('Take the tour again', '再看一次導覽')}</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${PLT('A quick look at what PrepBuddy can do.', '快速看看 PrepBuddy 可以做甚麼。')}</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm" id="stour">${PLT('Quick tour', '快速導覽')}</button><button class="btn-sm quiet" id="stourfull">${PLT('Full tour (about 3 min)', '完整導覽（約 3 分鐘）')}</button></div>
    </section>
    <section class="card stack g10 fbcard" style="padding:16px">
      <b style="font-size:16px">${PLT('Tell us what you think', '告訴我們你的意見')}</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${PLT('You’re in the PrepBuddy pilot. What do you like? What’s confusing or broken? Parents and students both welcome.', '你正參與 PrepBuddy 試用。你喜歡甚麼？有甚麼令你困惑或出錯？家長和學生都歡迎留言。')}</span>
      <textarea id="sfb" class="wr-ta small" rows="4" placeholder="${PLT('Type here…', '在這裏輸入…')}"></textarea>
      <button class="btn-sm primary" id="sfbgo" style="align-self:flex-start">${PLT('Send', '傳送')}</button>
      <span class="hint" style="margin:0">${PLT(`Family code ${esc(local.code || '')}`, `家庭代碼 ${esc(local.code || '')}`)}</span>
    </section>` : ''}
`;
  const SECS = {
    child: [PLT('Your child', '你的孩子'), 'child', `    <section class="card stack g10" style="padding:16px">
      <label for="sname" style="font-size:16px;font-weight:700">Your name</label>
      <span class="muted" style="font-size:14px;line-height:1.5">Used to greet you and on the weekly report you send your parents.</span>
      <input id="sname" class="input" autocomplete="given-name" placeholder="e.g. Ka Yan" value="${esc(local.name || '')}">
    </section>
    ${profileOn() ? `<section class="card stack g10" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b style="font-size:16px">${PLT('About your child', '關於你的孩子')}</b><span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn-sm quiet" id="skids">${KIDS.list.length > 1 ? PLT('Switch child', '轉換孩子') : PLT('Add a child', '新增孩子')}</button><button class="btn-sm" id="sprof">${gradeNow() ? PLT('Edit', '修改') : PLT('Set up', '設定')}</button></span></div>
      <span class="muted" style="font-size:14px;line-height:1.5">${gradeNow() ? `<b data-raw>${esc(gradeName(gradeNow()))}</b> · ` : ''}${PLT('Buddy uses the grade and these details to explain and set questions at the right level.', 'Buddy 會按年級及這些資料，用合適的程度講解和出題。')}</span>
    </section>` : ''}
    <section class="card stack g10" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b style="font-size:16px">Stars and rewards${locked('stars') ? ' <span class="lock-tag inl">🔒 Standard</span>' : ''}</b>
        <button class="switch ${starsOn() ? 'on' : ''}" id="sstars" role="switch" aria-checked="${starsOn()}" aria-label="Stars and rewards"><i></i></button></div>
      <span class="muted" style="font-size:14px;line-height:1.5">Earn stars for practising and spend them on rewards your parents choose. On automatically for primary school books.</span>
      ${starsOn() ? `<button class="btn-sm primary sstarshop" data-stargo style="align-self:flex-start">${starSVG(18)} ${PLT(`Open the Star shop · ${starState().bal} stars`, `打開星星商店 · ${starState().bal} 粒星`)}</button>` : ''}
    </section>
`],
    language: [PLT('Language', '語言'), 'language', `    <section class="card stack g10" style="padding:16px">
      <span class="muted" style="font-size:14px;line-height:1.5">For PrepBuddy’s buttons and messages. Your textbooks and their questions stay in the book’s own language.</span>
      <div class="langopts" role="group" aria-label="Language">${opt('en', 'English', 'English')}${opt('zh', '中文（繁體）', 'Traditional Chinese')}${opt('fr', 'Français', 'French')}${opt('ja', '日本語', 'Japanese')}</div>
      ${LANG === 'fr' || LANG === 'ja' ? `<span class="muted" style="font-size:13px;line-height:1.5">${LANG === 'fr' ? 'Les écrans sont traduits automatiquement la première fois que tu les ouvres, puis gardés sur cet appareil.' : '画面は初めて開いたときに自動で翻訳され、この端末に保存されます。'}</span>` : ''}
    </section>
`],
    backup: [BK('Backup', '備份'), 'backup', `    <section class="card stack g10" style="padding:16px">
      <b style="font-size:16px">${BK('Back up your progress', '備份你的進度')}</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${BK('Everything is saved on this device only. Save a backup file to keep it safe, or to move to a new phone or computer.', '所有資料只儲存在這部裝置。儲存備份檔案以策安全，或轉用新手機或電腦時使用。')} <b>${local.backupAt ? BK(`Last backup: ${agoWords(local.backupAt)}.`, `上次備份：${agoWords(local.backupAt)}。`) : BK('No backup yet.', '仍未備份。')}</b></span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm primary" id="sbackup">${BK('Save a backup file', '儲存備份檔案')}</button><label class="btn-sm" style="cursor:pointer">${BK('Restore from a file', '從檔案還原')}<input type="file" id="srestore" accept="application/json,.json" hidden></label></div>
    </section>
`],
    help: [PLT('Help and feedback', '說明及意見'), 'help', helpHTML],
    privacy: [PLT('Privacy and data', '私隱及資料'), 'privacy', `    <section class="card stack g10" style="padding:16px">
      <b style="font-size:16px">${PLT('Privacy', '私隱')}</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${PLT('What PrepBuddy collects, where it goes, and how to see, correct or delete it.', 'PrepBuddy 收集甚麼資料、資料去向，以及如何查閱、更正或刪除。')}</span>
      <span class="muted" style="font-size:14px;line-height:1.5">${PLT('Questions are written and checked by AI. If one looks wrong, tap Report a problem on that question.', '題目由 AI 撰寫及檢查。如發現題目有錯，請在該題按「報告問題」。')}</span>
      <button class="btn-sm" data-privacy style="align-self:flex-start">${PLT('Read the privacy notice', '閱讀私隱聲明')}</button>
    </section>
    <section class="card stack g10 wipe-card" style="padding:16px">
      <b style="font-size:16px">${PLT('Delete everything on this device', '刪除這部裝置上的所有資料')}</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${PLT('Removes every child, book, question, mark, setting and saved voice clip from this phone or computer, and the family code. PrepBuddy then starts again like new. This can’t be undone, so save a backup first if you want to keep anything.', '刪除這部手機或電腦上所有孩子、課本、題目、成績、設定、已儲存的朗讀聲音和家庭代碼，PrepBuddy 會像新的一樣重新開始。刪除後不能復原，如想保留資料，請先儲存備份。')}${local.pilot ? PLT(' Pilot activity already sent to PrepBuddy is not deleted by this: ask us and we’ll remove it.', ' 已傳送給 PrepBuddy 的試用紀錄不會因此刪除：請聯絡我們，我們會為你刪除。') : ''}</span>
      <button class="btn-sm danger" id="swipe" style="align-self:flex-start">${PLT('Delete everything', '刪除所有資料')}</button>
    </section>
`],
  };
  if (sec && SECS[sec]) {
    const [title, icon, body] = SECS[sec];
    $app.innerHTML = `${backTop({ name: 'settings' }, PLT('Settings', '設定'))}
    <main class="pad stack g14 settings" data-view="settings" style="flex:1">
      <div class="pick-head">${actionTile(icon, 52)}<h1 class="pagetitle" style="margin:0">${title}</h1></div>
      ${body}
    </main>`;
  } else {
    sec = null;
    const sub = {
      child: [local.name, gradeNow() ? gradeName(gradeNow()) : ''].filter(Boolean).join(' · ') || PLT('Name, grade, stars', '名字、年級、星星'),
      parents: PLT('Dashboard and reports · PIN', '家長主頁及報告 · 密碼'),
      language: { zh: '中文（繁體）', fr: 'Français', ja: '日本語' }[LANG] || 'English',
      backup: local.backupAt ? BK(`Last backup ${agoWords(local.backupAt)}`, `上次備份：${agoWords(local.backupAt)}`) : BK('No backup yet', '仍未備份'),
      help: local.pilot ? PLT('Tour and feedback', '導覽及意見') : PLT('Plans and help', '計劃及說明'),
      privacy: PLT('Privacy notice, delete data', '私隱聲明、刪除資料'),
    };
    const tile = (k, icon, title, s) => `<button class="qtile" data-sec="${k}">${actionTile(icon, 44)}<b>${title}</b><span>${s}</span></button>`;
    const hasHelp = !!(planCardHTML().trim() || local.pilot);
    $app.innerHTML = `
    <main class="pad stack g18 settings" data-view="settings" style="flex:1">
      <div class="greet"><h1 class="pagetitle" style="margin:0">${PLT('Settings', '設定')}</h1><p>${PLT('Set up PrepBuddy for your child and family.', '為孩子和家庭設定 PrepBuddy。')}</p></div>
      <div class="quick">
        ${tile('child', 'child', PLT('Your child', '你的孩子'), esc(sub.child))}
        ${tile('parents', 'parent', PLT('For parents', '家長專區'), sub.parents)}
        ${starsOn() ? `<button class="qtile" data-sec="stars"><span class="atile" style="width:44px;height:44px;background:#FFE48A" aria-hidden="true">${starSVG(26)}</span><b>${PLT('Star shop', '星星商店')}</b><span>${PLT(`${starState().bal} stars · rewards and badges`, `${starState().bal} 粒星 · 獎勵及徽章`)}</span></button>` : ''}
        ${tile('language', 'language', PLT('Language', '語言'), sub.language)}
        ${tile('backup', 'backup', BK('Backup', '備份'), sub.backup)}
        ${hasHelp ? tile('help', 'help', PLT('Help and feedback', '說明及意見'), sub.help) : ''}
        ${tile('privacy', 'privacy', PLT('Privacy and data', '私隱及資料'), sub.privacy)}
        ${tile('about', 'help', PLT('Why PrepBuddy?', '為甚麼選擇 PrepBuddy？'), PLT('How it compares with a tutor or centre', '與補習老師或補習社比較'))}
        ${DEV ? tile('usage', 'usage', 'AI usage', 'Cost on this device') : ''}
      </div>
    </main>`;
    $app.querySelectorAll('[data-sec]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.sec;
      if (k === 'parents') return openParent();
      if (k === 'usage') return go({ name: 'usage' });
      if (k === 'stars') return go({ name: 'stars' });
      if (k === 'about') return go({ name: 'about' });
      go({ name: 'settings', sec: k });
    }));
  }
  $app.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { if (b.dataset.lang === LANG) return; setLang(b.dataset.lang); go({ name: 'settings', sec }); }));
  { const nm = document.getElementById('sname'); if (nm) nm.oninput = () => { local.name = nm.value.trim().slice(0, 30); saveLocal(); }; }
  { const u = document.getElementById('susage'); if (u) u.onclick = () => go({ name: 'usage' }); }
  { const t = document.getElementById('stour'); if (t) t.onclick = () => startTour(true); const f = document.getElementById('stourfull'); if (f) f.onclick = () => startTour('full'); }
  { const sp = document.getElementById('sparent'); if (sp) sp.onclick = () => openParent(); }
  { const sk = document.getElementById('skids'); if (sk) sk.onclick = async () => { await kidPicker(); go({ name: 'settings', sec }); }; }
  { const pf = document.getElementById('sprof'); if (pf) pf.onclick = async () => { await profileScreen(); go({ name: 'settings', sec }); }; }
  { const fb = document.getElementById('sfbgo'); if (fb) fb.onclick = async () => { const t = document.getElementById('sfb'); if (!t.value.trim()) return t.focus(); fb.disabled = true; try { await pilotPost({ step: 'feedback', code: local.code, device: local.device, text: t.value, screen: 'settings', name: local.name || '' }); t.value = ''; toast(PLT('Thank you! We read every message.', '謝謝！每則訊息我們都會細看。')); } catch (e) { toast(PLT('Couldn’t send. Try again in a moment.', '未能傳送，請稍後再試。')); } fb.disabled = false; }; }
  if (document.getElementById('swipe')) document.getElementById('swipe').onclick = async () => {
    const ok = await confirmLeave({ title: PLT('Delete everything on this device?', '刪除這部裝置上的所有資料？'), body: PLT(`All ${KIDS.list.length > 1 ? `${KIDS.list.length} children’s` : 'your'} books, progress, stars and settings will be removed from this device, and you’ll need the family code again. This can’t be undone.`, `這部裝置上${KIDS.list.length > 1 ? `全部 ${KIDS.list.length} 個孩子的` : ''}課本、進度、星星和設定都會刪除，之後需要再輸入家庭代碼。刪除後不能復原。`), stay: PLT('Cancel', '取消'), leave: PLT('Delete everything', '刪除所有資料') });
    if (!ok) return;
    if (local.pin && !(await askPin(PLT('Enter the parent PIN to delete everything.', '輸入家長密碼以刪除所有資料。')))) return;
    await wipeDevice();
  };
  if (document.getElementById('sbackup')) document.getElementById('sbackup').onclick = async (e) => { e.target.disabled = true; try { const n = await backupFile(); toast(BK(`Backup saved (${Math.max(1, Math.round(n / 1024))} KB). Keep the file somewhere safe.`, `備份已儲存（${Math.max(1, Math.round(n / 1024))} KB），請妥善保存檔案。`)); } catch (err) { toast(BK('Couldn’t make the backup.', '未能建立備份。')); } renderSettings(sec); };
  if (document.getElementById('srestore')) document.getElementById('srestore').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await restoreFile(f); } catch (err) { toast(err.message); } e.target.value = ''; };
  { const sp = document.getElementById('splans'); if (sp) sp.onclick = () => go({ name: 'plans' }); }
  $app.querySelectorAll('[data-pv]').forEach((b) => (b.onclick = () => { local.planPreview = b.dataset.pv; saveLocal(); renderSettings(sec); renderTabs(); }));
  if (document.getElementById('sstars')) document.getElementById('sstars').onclick = () => { if (locked('stars')) return upsell('stars', 'locked'); local.starsOn = !starsOn(); saveLocal(); renderSettings(sec); renderTabs(); };
  window.scrollTo(0, 0);
}



// "Delete everything on this device": every child's database, all PrepBuddy keys in local storage, the saved
// voice clips and this tab's session, then a fresh start (the family-code screen in the pilot).
async function wipeDevice() {
  WIPING = true; stopSaying();
  const dbs = new Set(['prepbuddy', ...KIDS.list.map((k) => k.db)]);
  try { if (indexedDB.databases) (await indexedDB.databases()).forEach((d) => { if (d.name && /^prepbuddy/.test(d.name)) dbs.add(d.name); }); } catch (e) {}
  await store.close();
  await Promise.all([...dbs].map((n) => new Promise((r) => { try { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); } catch (e) { r(); } })));
  try { await caches.delete('pb-tts'); } catch (e) {}
  try { Object.keys(localStorage).filter((k) => /^(prepbuddy|pb\.)/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  location.replace(location.pathname);
}

// The privacy notice (js/privacy.js), in English or Traditional Chinese. A page from Settings and the footer,
// and a full-screen sheet over the consent step (which can't be left).
let privLang = null;
function privacyBody() {
  // French and Japanese: the English notice, translated on screen like the rest of the app, with a note that the English is official.
  const fj = LANG === 'fr' || LANG === 'ja', L = privLang === 'orig' ? 'en' : (privLang || (LANG === 'zh' ? 'zh' : 'en')), auto = fj && L === 'en', P = PRIVACY[L];
  const langs = [['en', fj ? (LANG === 'fr' ? 'Français' : '日本語') : 'English'], ['zh', '繁體中文'], ...(fj ? [['orig', 'English']] : [])];
  const cur = privLang === 'orig' ? 'orig' : L;
  const PP = privLang === 'orig' ? PRIVACY.en : P;
  return `<div class="priv" ${auto && privLang !== 'orig' ? '' : `lang="${L === 'zh' ? 'zh-HK' : 'en'}"`}>
    <div class="priv-head"><h1>${PP.title}</h1><div class="priv-lang" role="group" aria-label="Language" lang="en">${langs.map(([k, n]) => `<button class="chip${k === cur ? ' on' : ''}" data-privlang="${k}">${n}</button>`).join('')}</div></div>
    ${auto && privLang !== 'orig' ? `<p class="priv-upd" lang="${LANG}">${LANG === 'fr' ? 'Traduction automatique. La version anglaise fait foi.' : '自動翻訳です。正式な内容は英語版をご確認ください。'}</p>` : ''}
    <p class="priv-upd">${L === 'zh' ? '最後更新：' : 'Last updated: '}${PRIVACY_UPDATED[L]}</p>
    <p>${PP.intro}</p>
    ${PP.sections.map(([h, b]) => `<section><h2>${h}</h2>${b}</section>`).join('')}
  </div>`;
}
function bindPrivLang(root, redraw) { root.querySelectorAll('[data-privlang]').forEach((b) => (b.onclick = () => { privLang = b.dataset.privlang; redraw(); })); }
function renderPrivacy() {
  const draw = () => {
    $app.innerHTML = `<main class="pad stack g14" data-raw>${backTop({ name: 'settings' }, 'Back')}${privacyBody()}</main>`;
    bindPrivLang($app, draw);
  };
  draw(); window.scrollTo(0, 0);
}
function privacyOverlay() {
  const box = document.createElement('div'); box.className = 'priv-sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const draw = () => {
    box.innerHTML = `<div class="priv-sheet-in" data-raw><div class="priv-close"><button class="btn-sm" data-privclose>${LANG === 'zh' ? '關閉' : 'Close'}</button></div>${privacyBody()}<div class="priv-close"><button class="btn" data-privclose>${LANG === 'zh' ? '返回' : 'Back to the agreement'}</button></div></div>`;
    bindPrivLang(box, draw);
    box.querySelectorAll('[data-privclose]').forEach((b) => (b.onclick = () => box.remove()));
  };
  draw(); document.body.appendChild(box); box.scrollTop = 0;
}

/* ---------- pilot: family codes, activity and feedback ----------
   During the pilot each family gets its own code. The app asks for it once, then uses it for the AI. Each device
   sends a short summary of how PrepBuddy is being used (days, questions, scores, which features, errors) so the
   admin page can see what's working; nothing is sent when the pilot is off. */
// The welcome screen shows before the family code is entered, so screen translation (which needs the code) can't help
// there yet: its lines are written out for French and Japanese.
const GATE = {
  fr: { 'Yay, you made it!': 'Youpi, te voilà !', 'So excited you’re here!': 'Trop content que tu sois là !', 'Ready to learn together?': 'On apprend ensemble ?', 'Private pilot · you’re one of the first!': 'Pilote privé · tu fais partie des premiers !', 'Welcome to PrepBuddy!': 'Bienvenue sur PrepBuddy !', 'We’re so happy your family is joining us. Pop in the family code we sent you and let’s get started.': 'Nous sommes ravis que votre famille nous rejoigne. Saisissez le code famille que nous vous avons envoyé pour commencer.', 'e.g. CHAN27-K4QF9X': 'ex. CHAN27-K4QF9X', 'Let’s go!': 'C’est parti !', 'No code? Ask the person who invited you.': 'Pas de code ? Demandez à la personne qui vous a invités.', 'Ooh, typing…': 'Oh, tu écris…', 'Hmm, let’s try that again': 'Hmm, on réessaie', 'Buddy can’t wait to start learning with you.': 'Buddy a hâte d’apprendre avec toi.', 'Getting your desk ready…': 'On prépare ton bureau…', 'You’re in!': 'C’est bon, tu es inscrit !' },
  ja: { 'Yay, you made it!': 'ようこそ！', 'So excited you’re here!': '来てくれてうれしいな！', 'Ready to learn together?': 'いっしょに勉強しよう！', 'Private pilot · you’re one of the first!': '限定テスト版・最初のご家族です！', 'Welcome to PrepBuddy!': 'PrepBuddy へようこそ！', 'We’re so happy your family is joining us. Pop in the family code we sent you and let’s get started.': 'ご参加ありがとうございます。お送りしたファミリーコードを入力して、はじめましょう。', 'e.g. CHAN27-K4QF9X': '例：CHAN27-K4QF9X', 'Let’s go!': 'はじめる！', 'No code? Ask the person who invited you.': 'コードがない場合は、招待してくれた方にお問い合わせください。', 'Ooh, typing…': '入力中…', 'Hmm, let’s try that again': 'もう一度ためしてみよう', 'Buddy can’t wait to start learning with you.': 'Buddy はいっしょに勉強するのを楽しみにしています。', 'Getting your desk ready…': '準備しています…', 'You’re in!': '準備完了！' },
};
const PLT = (en, zh) => (LANG === 'zh' ? zh : (GATE[LANG] && GATE[LANG][en]) || en);
local.device = local.device || uid();
let TOURING = false;
function track(name) {
  if (!name || (TOURING && !/^tour|^booktour/.test(name))) return;
  local.fx = local.fx || {};
  const x = local.fx[name] || { n: 0 }; x.n++; x.last = Date.now(); local.fx[name] = x;
  saveLocal();
}
function noteError(msg) {
  local.errs = [...(local.errs || []), { t: Date.now(), m: String(msg || '').slice(0, 200), v: view && view.name }].slice(-15);
  saveLocal();
}
window.addEventListener('error', (e) => noteError(e.message));
window.addEventListener('unhandledrejection', (e) => noteError(e.reason && (e.reason.message || e.reason)));
async function pilotPost(body) {
  const r = await fetch('/api/pilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Server error ${r.status}`); e.status = r.status; throw e; }
  return d;
}
// Before anything else: is the pilot on, and does this device have a good family code?
async function pilotGate() {
  let res;
  try { res = await pilotPost({ step: 'check', code: local.code || '' }); } catch (e) { return; } // offline or no server: carry on
  local.pilot = !!res.pilot; saveLocal();
  if (!res.pilot || res.ok) return;
  await new Promise((resolve) => {
    const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
    const done = () => { if (nav) nav.style.display = ''; resolve(); };
    document.body.dataset.tab = '';
    let talk = 0;
    const paint = () => {
    clearInterval(talk);
    const SAY = [PLT('Yay, you made it!', '好開心見到你！'), PLT('So excited you’re here!', '你來了，太好了！'), PLT('Ready to learn together?', '一齊學習吧！')];
    const sparkles = Array.from({ length: 14 }, (_, i) => `<i style="left:${(i * 37 + 7) % 100}%;top:${(i * 53 + 11) % 100}%;animation-delay:${(i % 7) * 0.45}s;font-size:${10 + (i % 4) * 5}px">${['✦', '★', '•', '✧'][i % 4]}</i>`).join('');
    $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1">
      <div class="pg-sky" aria-hidden="true">${sparkles}</div>
      <div class="pg-lang" role="group" aria-label="Language / 語言"><button data-gl="en" class="${LANG === 'en' ? 'on' : ''}" aria-pressed="${LANG === 'en'}" lang="en">English</button><button data-gl="zh" class="${LANG === 'zh' ? 'on' : ''}" aria-pressed="${LANG === 'zh'}" lang="zh-HK">中文</button><button data-gl="fr" class="${LANG === 'fr' ? 'on' : ''}" aria-pressed="${LANG === 'fr'}" lang="fr">FR</button><button data-gl="ja" class="${LANG === 'ja' ? 'on' : ''}" aria-pressed="${LANG === 'ja'}" lang="ja">日本語</button></div>
      <div class="pg-box" id="pgbox">
        <div class="pg-buddy" aria-hidden="true"><div class="pg-say" id="pgsay">${SAY[0]}</div><div class="pg-bob" id="pgbob">${buddySVG('happy', 96)}</div><div class="pg-shadow"></div></div>
        <span class="pg-tag">${PLT('Private pilot · you’re one of the first!', '小規模試用 · 你是首批家庭之一！')}</span>
        <h1>${PLT('Welcome to PrepBuddy!', '歡迎來到 PrepBuddy！')}</h1>
        <p>${PLT('We’re so happy your family is joining us. Pop in the family code we sent you and let’s get started.', '很高興你的家庭加入我們！輸入我們給你的家庭代碼，就可以開始了。')}</p>
        <form id="pgf"><input id="pgc" class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${PLT('e.g. CHAN27-K4QF9X', '例如 CHAN27-K4QF9X')}" value="${esc(local.code || '')}" aria-label="${PLT('Family code', '家庭代碼')}">
        <p class="hw-err" id="pgerr" role="alert" hidden></p>
        <button class="btn" id="pgok">${PLT('Let’s go!', '開始吧！')}</button></form>
        <p class="hint">${PLT('No code? Ask the person who invited you.', '沒有代碼？請聯絡邀請你的人。')}</p>
      </div></main>`;
    const box = document.getElementById('pgbox'), say = document.getElementById('pgsay'), bob = document.getElementById('pgbob'), inp = document.getElementById('pgc'), err = document.getElementById('pgerr'), ok = document.getElementById('pgok');
    let si = 0, typing = 0;
    $app.querySelectorAll('[data-gl]').forEach((b) => (b.onclick = () => { if (b.dataset.gl === LANG) return; const v = inp.value; setLang(b.dataset.gl); paint(); const i2 = document.getElementById('pgc'); if (i2) i2.value = v; }));
    const face = (k) => { bob.innerHTML = buddySVG(k, 96); };
    const speak = (t) => { say.classList.remove('pop'); void say.offsetWidth; say.textContent = t; say.classList.add('pop'); };
    talk = setInterval(() => { if (!typing && !box.classList.contains('bad')) speak(SAY[(si = (si + 1) % SAY.length)]); }, 3200);
    inp.oninput = () => {
      clearTimeout(typing); face('listen'); err.hidden = true; box.classList.remove('bad');
      typing = setTimeout(() => { typing = 0; face('happy'); }, 900);
      if (inp.value.length === 1) speak(PLT('Ooh, typing…', '輸入中…'));
    };
    const fail = (m) => {
      ok.disabled = false; ok.textContent = PLT('Let’s go!', '開始吧！');
      err.textContent = m; err.hidden = false; face('think');
      speak(PLT('Hmm, let’s try that again', '嗯…再試一次吧'));
      box.classList.remove('bad'); void box.offsetWidth; box.classList.add('bad'); inp.focus(); inp.select();
    };
    const celebrate = (c, name) => {
      clearInterval(talk);
      const who = String(name || '').trim();
      const conf = Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 29) % 100}%;background:${['#FFC531', '#5A8DF5', '#FF8F8F', '#18966A', '#B38CF5'][i % 5]};animation-delay:${(i % 9) * 0.06}s;animation-duration:${1.4 + (i % 5) * 0.2}s;transform:rotate(${i * 23}deg)"></i>`).join('');
      const burst = Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36}deg">★</i>`).join('');
      box.classList.add('yay');
      box.innerHTML = `<div class="pg-buddy big" aria-hidden="true"><div class="pg-burst">${burst}</div><div class="pg-bob">${buddySVG('done', 120)}</div><div class="pg-shadow"></div></div>
        <h1 class="pg-in">${who ? PLT(`Welcome, ${esc(who)}!`, `歡迎，${esc(who)}！`) : PLT('You’re in!', '成功加入！')}</h1>
        <p class="pg-in d2">${PLT('Buddy can’t wait to start learning with you.', 'Buddy 已經急不及待和你一齊學習！')}</p>
        <div class="pg-load pg-in d3"><i></i></div><span class="hint pg-in d3">${PLT('Getting your desk ready…', '正在準備你的書桌…')}</span>`;
      const cf = document.createElement('div'); cf.className = 'confetti pg-conf'; cf.setAttribute('aria-hidden', 'true'); cf.innerHTML = conf; document.body.appendChild(cf);
      let left = false;
      const go2 = () => { if (left) return; left = true; cf.remove(); done(); };
      setTimeout(go2, 2800);
      box.onclick = go2;
    };
    document.getElementById('pgf').onsubmit = async (e) => {
      e.preventDefault();
      const c = inp.value.trim().toUpperCase();
      if (!c) return inp.focus();
      ok.disabled = true; ok.textContent = PLT('Checking…', '檢查中…'); face('think'); speak(PLT('Let me check…', '讓我看看…'));
      try {
        const r = await pilotPost({ step: 'check', code: c, welcome: 1 });
        if (r.ok || !r.pilot) { local.code = c; saveLocal(); return celebrate(c, r.name); }
        fail(PLT('That code isn’t right. Check it and try again.', '代碼不正確，請檢查後再試。'));
      } catch (er) { fail(PLT('Couldn’t check the code. Are you online?', '未能檢查代碼，你有連接網絡嗎？')); }
    };
    };
    paint();
  });
}

/* ---------- pilot welcome: parent consent, then a short tour ----------
   Right after a family code is accepted, a parent reads what PrepBuddy collects and agrees (nothing is sent to us
   before that). Then a six-card tour of what PrepBuddy does, which can be skipped and replayed from Settings. */
const CONSENT_V = 2; // 2 (15 Nov 2026): everyone agrees to the privacy notice, not just pilot families
async function pilotWelcome() {
  kidMeta();
  if (KIDS.list.length > 1 && !kidPickFresh()) await kidPicker({ boot: true });
  if (KIDS.list.length > 1) kidPicked();
  if (!(local.consent && local.consent.v >= CONSENT_V)) await consentScreen(); // every family, before anything is sent to the AI
  // New families set it up during onboarding; families already using the app get a card on Today instead.
  if (profileOn() && !local.learner && (!local.toured || local.needProfile)) {
    await profileScreen({ first: true });
    // while a parent is holding the device: school marks from before PrepBuddy (optional, can be skipped)
    if (marksAsk() && inHK()) await marksScreen(null, { setup: true });
  }
  await preloadStarters();
  if (!local.toured) await startTour('full'); // new families get the full guided tour; the quick one is in Settings
}
// A child with no books gets PrepBuddy's free starter books for their grade (e.g. P4 English, Maths and Science),
// or every starter book as samples when their grade has none yet, once, so they can start straight away.
// Books they remove later are not added back.
async function preloadStarters() {
  if (local.preloaded) return;
  const g = gradeNow(); if (!g) return;
  if ((await getBooks()).length) { local.preloaded = Date.now(); saveLocal(); return; }
  let list = [];
  // the starter books for the child's grade; if there are none yet for that grade, all the starter books as samples
  try { const all = (await getCatalog()).filter((b) => b.starter); list = all.filter((b) => String(b.level).toUpperCase() === g); if (!list.length) list = all; } catch (e) { return; }
  if (!list.length) return;
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
  let n = 0;
  for (const e of list) {
    n++;
    $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1"><div class="pg-box" style="text-align:center">
      <div class="pg-buddy" aria-hidden="true"><div class="pg-bob">${buddySVG('happy', 80)}</div></div>
      <h1 style="margin:0">${C('Getting your books ready', '正在準備你的課本')}</h1>
      <p style="margin:0">${C(`Adding ${esc(e.title)} (${n} of ${list.length})`, `正在加入《${esc(e.title)}》（${n}／${list.length}）`)}</p>
      <div class="progress" role="progressbar" aria-valuenow="${Math.round(100 * (n - 1) / list.length)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(100 * (n - 1) / list.length)}%"></i></div>
    </div></main>`;
    await addFromLibrary(e, null, { quiet: true });
  }
  if (nav) nav.style.display = '';
  $app.innerHTML = `<main class="pad" style="flex:1"></main>`;
  local.preloaded = Date.now(); saveLocal();
  if ((await getBooks()).length && local.toured) toast(C(`${list.length} free starter book${list.length > 1 ? 's' : ''} added`, `已加入 ${list.length} 本免費入門書`));
}
// Line icons for the consent summary (the same style as the rest of the app, not emoji).
const csv = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CS_ICON = { device: csv('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'), chart: csv('<path d="M5 20V11M12 20V5M19 20v-6"/>'), ai: csv('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>'), never: csv('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'), control: csv('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4 4.6-5"/>') };
function consentScreen() {
  return new Promise((resolve) => {
    const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
    document.body.dataset.tab = '';
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    const pilot = !!(local.pilot && local.code);
    const items = [
      ['device', C('Stays on this device', '保存在這部裝置'), C('Your child’s answers, textbooks, essays, recordings and progress are saved in this browser.', '孩子的答案、課本、文章、錄音和進度都保存在這個瀏覽器內。')],
      pilot ? ['chart', C('A short summary comes to us', '一份簡短摘要會傳送給我們'), C('For the pilot: first name (if entered), how much your child practised and how much was right, features used, book titles, school marks you choose to enter, and app errors. Only the PrepBuddy team can see it. If you give us your WhatsApp number, we use it to send you a short weekly update with a link to your child’s report.', '試用期間：名字（如有填寫）、練習了多少及答對多少、用過的功能、書名、你選擇填寫的學校成績及程式錯誤。只有 PrepBuddy 團隊可以查看。如你提供 WhatsApp 號碼，我們會用來每週傳送簡短進度更新及孩子報告的連結。')] : null,
      ['ai', C('The AI reads what it needs', 'AI 只會讀取需要的內容'), C('To write questions and mark answers, textbook text and your child’s answers, photos and essays are sent to our AI provider, Anthropic, outside Hong Kong. Never your child’s name. It isn’t used to train their AI and is deleted within 30 days.', '為了出題和批改，課文以及孩子的答案、相片和文章會傳送到香港以外的 AI 服務供應商 Anthropic，但不包括孩子的名字。這些內容不會用來訓練他們的 AI，並會在 30 天內刪除。')],
      ['never', C('What we never ask for', '我們不會收集'), C('Full name, school, address, ID or payment details. Please remind your child not to type personal details into answers or chats.', '全名、學校、地址、身份證或付款資料。請提醒孩子不要在答案或對話中輸入個人資料。')],
      ['control', C('You’re in control', '由你決定'), pilot ? C('Delete everything on this device any time in Settings. Ask us to see, correct or delete your family’s data, or leave the pilot. Pilot data is deleted within 3 months after the pilot ends.', '你可隨時在「設定」刪除這部裝置上的所有資料，亦可要求我們查閱、更正或刪除你家庭的資料，或退出試用。試用結束後 3 個月內會刪除試用資料。') : C('Delete everything on this device any time in Settings, or ask us to see or correct your data.', '你可隨時在「設定」刪除這部裝置上的所有資料，或要求我們查閱或更正你的資料。')],
    ].filter(Boolean);
    $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1">
      <div class="pg-box cs-box">
        <div class="cs-head">${buddySVG('listen', 64)}<div><span class="pg-tag">${profileOn() ? C('Step 1 of 3 · for parents', '第 1 步，共 3 步 · 家長專用') : C('Step 1 of 2 · for parents', '第 1 步，共 2 步 · 家長專用')}</span><h1>${C('Before we start', '開始之前')}</h1></div></div>
        <p>${C('Please ask a parent or guardian to read this and agree. It takes a minute.', '請家長或監護人閱讀並同意以下內容，只需一分鐘。')}</p>
        <div class="cs-list">${items.map(([i, h, t]) => `<details class="cs-item"><summary><span class="cs-ic" aria-hidden="true">${CS_ICON[i]}</span><b>${h}</b><span class="cs-more" aria-hidden="true">›</span></summary><p>${t}</p></details>`).join('')}</div>
        <p class="hint" style="margin:0;text-align:left">${C('Tap each line to read more.', '按每一行可看詳情。')}</p>
        <div class="cs-foot"><label class="cs-agree"><input type="checkbox" id="cs-ok"><span>${C('I’m this child’s parent or guardian and I agree to the ', '我是這名孩子的家長或監護人，並同意')}<button type="button" class="linkbtn" data-privacy>${C('privacy notice', '私隱聲明')}</button>${pilot ? C(', including my child taking part in the PrepBuddy pilot.', '，包括讓孩子參加 PrepBuddy 試用計劃。') : C('.', '。')}</span></label>
        <button class="btn" id="cs-go" disabled>${C('Agree and continue', '同意並繼續')}</button></div>
        <p class="hint"><button type="button" class="linkbtn" data-privacy>${C('Read the full privacy notice', '閱讀完整私隱聲明')}</button> · ${pilot ? C('Questions? Ask the person who invited you.', '有疑問？請聯絡邀請你的人。') : C('You can read it again any time in Settings.', '你可隨時在「設定」再次閱讀。')}</p>
      </div></main>`;
    const ok = document.getElementById('cs-ok'), go2 = document.getElementById('cs-go');
    ok.onchange = () => { go2.disabled = !ok.checked; };
    go2.onclick = () => {
      local.consent = { at: Date.now(), v: CONSENT_V, lang: LANG }; saveLocal(); track('consent');
      if (nav) nav.style.display = '';
      $app.innerHTML = `<main class="pad" style="flex:1"></main>`;
      resolve();
    };
  });
}
/* ---------- the student profile: grade, pace, school language, goals, likes ----------
   Set by a parent once (in the welcome steps, or Settings). Every AI request then carries it (learnerPayload), so
   questions, marking, Buddy, lessons and notes fit this child's age and level. Kept on this device; only these
   fields are sent with AI requests, never a name or school. The grade moves up by itself each September. */
const PROFILE_ALL = true; // on for everyone; ?beta=off turns it off on one device
(() => { try { const m = location.search.match(/[?&]beta=(profile|off)\b/); if (m) { local.beta = m[1] === 'off' ? '' : 'profile'; saveLocal(); } } catch (e) {} })();
const profileOn = () => PROFILE_ALL || local.beta === 'profile';
const GRADE_LIST = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const schoolYearOf = (t) => { const d = new Date(t); return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; };
function gradeNow() {
  const L = local.learner; if (!L || !GRADE_LIST.includes(L.grade)) return '';
  const i = GRADE_LIST.indexOf(L.grade) + Math.max(0, schoolYearOf(Date.now()) - schoolYearOf(L.at || Date.now()));
  return GRADE_LIST[Math.min(i, GRADE_LIST.length - 1)];
}
const learnerPayload = () => (profileOn() && gradeNow() ? { grade: gradeNow(), country: country(), pace: local.learner.pace || '', medium: local.learner.medium || '', zhLang: local.learner.zhLang || '', explain: local.learner.explain || '', goals: local.learner.goals || [], likes: local.learner.likes || '' } : null);
// Chinese read aloud in Putonghua when the parent says the school teaches Chinese in Putonghua (普教中).
const zhVoice = () => (local.learner && (local.learner.zhLang === 'cmn' || (local.learner.country && local.learner.country !== 'hk')) ? 'cmn' : 'yue');
const gradeBand = () => { const g = gradeNow(); return !g ? '' : /^P[12]$/.test(g) ? 'p12' : /^P[34]$/.test(g) ? 'p34' : /^P[56]$/.test(g) ? 'p56' : /^S[123]$/.test(g) ? 's13' : 's46'; };
// Primary or not: the child's grade when the parent has set it, otherwise a guess from their books.
const isPrimaryKid = () => (profileOn() && gradeNow() ? gradeNow()[0] === 'P' : !!primaryCache);
const sessionSize = () => ({ p12: 6, p34: 8 }[gradeBand()] || SESSION_SIZE);
const gradeLabel = () => (gradeNow() ? gradeName(gradeNow()) : LANG === 'zh' ? '小學' : 'primary');
// Where the child goes to school. Grades are stored as P1-P6 / S1-S6 (by age) and shown in the country's own names.
// rows: the grade picker rows [English label, 中文 label, grades]; chip: short name; name: full name; voices: reading voices offered.
const CN_NUM = '一二三四五六';
const COUNTRIES = {
  hk: { en: 'Hong Kong', zh: '香港', flag: '🇭🇰', rows: [['Primary', '小學', 'P1 P2 P3 P4 P5 P6'], ['Secondary', '中學', 'S1 S2 S3 S4 S5 S6']],
    chip: (g) => (LANG === 'zh' ? `${g[0] === 'P' ? '小' : '中'}${CN_NUM[+g[1] - 1]}` : g),
    name: (g) => (LANG === 'zh' ? `${g[0] === 'P' ? '小' : '中'}${CN_NUM[+g[1] - 1]}` : `${g[0] === 'P' ? 'Primary' : 'Secondary'} ${g[1]}`), voices: ['yue', 'cmn', 'en'] },
  sg: { en: 'Singapore', zh: '新加坡', flag: '🇸🇬', rows: [['Primary', '小學', 'P1 P2 P3 P4 P5 P6'], ['Secondary', '中學', 'S1 S2 S3 S4'], ['Junior college', '初級學院', 'S5 S6']],
    chip: (g) => (g[0] === 'P' ? g : +g[1] <= 4 ? `Sec ${g[1]}` : `JC${+g[1] - 4}`),
    name: (g) => (g[0] === 'P' ? `Primary ${g[1]}` : +g[1] <= 4 ? `Secondary ${g[1]}` : `JC ${+g[1] - 4}`), voices: ['en', 'cmn'] },
  fr: { en: 'France', zh: '法國', flag: '🇫🇷', rows: [['École', '小學', 'P1 P2 P3 P4 P5'], ['Collège', '初中', 'P6 S1 S2 S3'], ['Lycée', '高中', 'S4 S5 S6']],
    chip: (g) => ({ P1: 'CP', P2: 'CE1', P3: 'CE2', P4: 'CM1', P5: 'CM2', P6: '6e', S1: '5e', S2: '4e', S3: '3e', S4: '2nde', S5: '1re', S6: 'Terminale' }[g]),
    name: (g) => COUNTRIES.fr.chip(g), voices: ['fr', 'en'] },
  jp: { en: 'Japan', zh: '日本', flag: '🇯🇵', rows: [['Elementary 小学校', '小學', 'P1 P2 P3 P4 P5 P6'], ['Junior high 中学校', '初中', 'S1 S2 S3'], ['High school 高校', '高中', 'S4 S5 S6']],
    chip: (g) => (g[0] === 'P' ? `小${g[1]}` : +g[1] <= 3 ? `中${g[1]}` : `高${+g[1] - 3}`),
    name: (g) => `${COUNTRIES.jp.chip(g)}年`, voices: ['ja', 'en'] },
  intl: { en: 'Somewhere else', zh: '其他地方', flag: '🌏', rows: [['Grades 1-6', '一至六年級', 'P1 P2 P3 P4 P5 P6'], ['Grades 7-12', '七至十二年級', 'S1 S2 S3 S4 S5 S6']],
    chip: (g) => `G${GRADE_LIST.indexOf(g) + 1}`, name: (g) => (LANG === 'zh' ? `${GRADE_LIST.indexOf(g) + 1} 年級` : `Grade ${GRADE_LIST.indexOf(g) + 1}`), voices: ['en', 'cmn'] },
};
const countryOf = (L) => (L && COUNTRIES[L.country] ? L.country : 'hk');
const country = () => countryOf(local.learner);
const inHK = () => country() === 'hk';
const gradeName = (g, c) => COUNTRIES[c || country()].name(g);
function profileScreen({ first } = {}) {
  return new Promise((resolve) => {
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    const L = { grade: gradeNow(), pace: '', medium: '', goals: [], likes: '', vrate: '', ...(local.learner || {}) }; L.grade = gradeNow() || '';
    // First run sets everything up front: the child's name, the details below, and stars on or off.
    // First run: four short pages (basics, school, reading aloud, goals) instead of one long one.
    let step = 1; const STEPS = 4;
    let nameV = local.name || '', starsV = starsOn(), starsSet = local.starsOn != null; // stars default on for primary grades
    const keep = () => { const n = document.getElementById('pname'); if (n) nameV = n.value; const lk = document.getElementById('plikes'); if (lk) L.likes = lk.value; };
    const nav = document.getElementById('tabs'); if (first && nav) nav.style.display = 'none';
    if (first) document.body.dataset.tab = '';
    const GOALS = (g) => { const c = countryOf(L), T = [['tests', C('School tests and exams', '校內測驗及考試')]], H = [['habits', C('A regular study habit', '建立溫習習慣')]];
      if (c === 'hk') return [...T, ...(/^P[23]$|^S[23]$/.test(g) || g === 'P6' ? [['tsa', C('TSA', '全港性系統評估 (TSA)')]] : []), ...(/^P[456]$/.test(g) ? [['ssa', C('Exams that count for secondary places (P5–P6)', '呈分試')]] : []), ...(/^S[3-6]$/.test(g) ? [['dse', 'HKDSE']] : []), ...H];
      if (c === 'sg') return [...T, ...(/^P[56]$/.test(g) ? [['psle', 'PSLE']] : []), ...(/^S[34]$/.test(g) ? [['olevel', C('O-Level / N-Level', 'O-Level / N-Level')]] : []), ...(/^S[56]$/.test(g) ? [['alevel', 'A-Level']] : []), ...H];
      if (c === 'fr') return [...T, ...(/^S[23]$/.test(g) ? [['brevet', 'Brevet']] : []), ...(/^S[4-6]$/.test(g) ? [['bac', 'Bac']] : []), ...H];
      if (c === 'jp') return [...T, ...(/^P[4-6]$/.test(g) ? [['juken_j', C('Junior high entrance exams (中学受験)', '中學入學試 (中学受験)')]] : []), ...(/^S[1-3]$/.test(g) ? [['juken_h', C('High school entrance exams (高校受験)', '高中入學試 (高校受験)')]] : []), ...(/^S[4-6]$/.test(g) ? [['juken_u', C('University entrance exams (大学入試)', '大學入學試 (大学入試)')]] : []), ...H];
      return [...T, ...H]; };
    const opt = (k, v, t, sub) => `<button class="langopt ${L[k] === v ? 'on' : ''}" data-k="${k}" data-v="${v}" aria-pressed="${L[k] === v}"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
    let drawn = false;
    const draw = () => {
      L.goals = L.goals.filter((x) => GOALS(L.grade).some(([k]) => k === x));
      if (first && !starsSet) starsV = /^P/.test(L.grade || '');
      $app.innerHTML = `<main class="pad ${first ? 'pilotgate' : 'stack g18'}" data-raw style="flex:1">
      <div class="${first ? 'pg-box cs-box compact' : 'stack g18'} prof-box${drawn ? ' noanim' : ''}">
        <div class="cs-head">${buddySVG('happy', 64)}<div>${first ? `<span class="pg-tag">${local.pilot && !local.needProfile ? C('Step 2 of 3 · for parents', '第 2 步，共 3 步 · 家長專用') : C('For parents', '家長專用')}</span>` : ''}<h1 class="${first ? '' : 'pagetitle'}" style="margin:6px 0 0">${C('About your child', '關於你的孩子')}</h1></div></div>
        <p data-st="1" style="margin:0;line-height:1.5;color:var(--text-2)">${C('Buddy uses this to talk, explain and set questions at the right level for your child. It stays on this device.', 'Buddy 會按這些資料，用適合孩子程度的方式講解和出題。資料只保存在這部裝置。')}</p>
        ${first ? `<section class="stack g10" data-st="1"><label for="pname"><b>${C('What’s your child’s name?', '孩子叫甚麼名字？')}</b></label>
          <input id="pname" class="input" autocomplete="given-name" maxlength="30" placeholder="${C('e.g. Ka Yan', '例如：嘉欣')}" value="${esc(nameV)}">
          <span class="hint" style="margin:0;text-align:left">${C('Buddy uses it to greet them. A first name or nickname is enough.', 'Buddy 會用來打招呼。名字或小名都可以。')}</span></section>` : ''}
        <section class="stack g10" data-st="1"><b>${C('Where do they go to school?', '孩子在哪裏上學？')}</b>
          <div class="prof-country">${Object.entries(COUNTRIES).map(([k, x]) => `<button class="fchip ${countryOf(L) === k ? 'on' : ''}" data-country="${k}" aria-pressed="${countryOf(L) === k}"><span aria-hidden="true">${x.flag}</span> ${C(x.en, x.zh)}</button>`).join('')}</div>
          <span class="hint" style="margin:0;text-align:left">${C('Buddy then uses that country’s grade names, test style and marking.', 'Buddy 會用該地的年級名稱、考試模式和評分方法。')}</span></section>
        <section class="stack g10" data-st="1"><b>${C('Which grade are they in?', '孩子讀幾年級？')}</b>
          ${COUNTRIES[countryOf(L)].rows.map(([en, zh, gs]) => `<div class="prof-grades${countryOf(L) === 'hk' ? '' : ' wide'}"><span class="muted">${C(en, zh)}</span>${gs.split(' ').map((g) => `<button class="fchip ${L.grade === g ? 'on' : ''}" data-g="${g}" aria-pressed="${L.grade === g}">${COUNTRIES[countryOf(L)].chip(g)}</button>`).join('')}</div>`).join('')}</section>
        ${`
        <section class="stack g10" data-st="2"><b>${C('How are they doing at school?', '孩子在學校的情況？')}</b>
          <div class="prof-opts">${opt('pace', 'support', C('Needs extra help', '需要多些幫助'), C('Smaller steps, easier start', '由淺入深，循序漸進'))}${opt('pace', 'ontrack', C('About right', '跟得上'), C('Keeping up with the class', '跟上班中進度'))}${opt('pace', 'ahead', C('Ahead', '超前'), C('Ready for harder work', '可以挑戰較深的題目'))}</div></section>
        ${countryOf(L) === 'hk' ? `<section class="stack g10" data-st="2"><b>${C('Their school mostly teaches in…', '學校主要用甚麼語言教學？')}</b>
          <div class="prof-opts two">${opt('medium', 'cmi', C('Chinese', '中文'), C('Cantonese / Chinese', '廣東話／中文'))}${opt('medium', 'emi', C('English', '英文'), C('English-medium school', '英文中學／小學'))}</div></section>
        <section class="stack g10" data-st="2"><b>${C('Chinese lessons are taught in…', '中文科用甚麼語言教？')}</b>
          <div class="prof-opts two">${opt('zhLang', 'yue', C('Cantonese', '廣東話'), C('粵教中', '粵教中'))}${opt('zhLang', 'cmn', C('Putonghua', '普通話'), C('Chinese taught in Putonghua: Buddy reads Chinese in Putonghua', '普教中：Buddy 用普通話朗讀'))}</div></section>` : ''}
        ${['hk', 'sg'].includes(countryOf(L)) ? `<section class="stack g10" data-st="2"><b>${C('Buddy should explain in…', 'Buddy 用甚麼語言講解？')}</b>
          <div class="prof-opts">${opt('explain', 'en', C('English', '英文'), C('Even if they type in Chinese', '即使孩子用中文提問'))}${opt('explain', 'zh', C('Chinese', '中文'), C('English terms in brackets', '英文術語放在括號內'))}${opt('explain', 'mix', C('Chinese + English terms', '中文 + 英文術語'), C('Learn the English words', '同時學英文詞彙'))}</div>
          <span class="muted" style="font-size:14px;line-height:1.5">${C('English lessons are always explained in simple English, with Chinese only for hard words.', '英文科一律用淺白英文講解，只在難字旁加中文。')}</span>
          <span class="hint" style="margin:0;text-align:left">${C('Practice questions stay in the textbook’s language.', '練習題目會保持課本的語言。')}</span></section>` : `<section class="stack g10" data-st="2"><b>${C('Language', '語言')}</b><span class="muted" style="font-size:14px;line-height:1.5">${C('Buddy writes questions, marking and explanations in each textbook’s own language (for example French or Japanese).', 'Buddy 會用每本課本的語言出題、批改和講解（例如法文或日文）。')}</span></section>`}
        <section class="stack g10" data-st="3"><b>${C('Reading voice', '朗讀聲音')}</b>
          <span class="muted" style="font-size:14px;line-height:1.5;margin-top:-4px">${C('For dictation, listening and reading questions aloud (🔊). Tap ▶ to hear each one.', '用於默書、聆聽和朗讀題目（🔊）。按 ▶ 試聽。')}</span>
          ${[['yue', C('Cantonese', '廣東話')], ['cmn', C('Putonghua', '普通話')], ['en', C('English', '英文')], ['fr', C('French', '法文')], ['ja', C('Japanese', '日文')]].filter(([lg]) => COUNTRIES[countryOf(L)].voices.includes(lg)).sort((a, b) => COUNTRIES[countryOf(L)].voices.indexOf(a[0]) - COUNTRIES[countryOf(L)].voices.indexOf(b[0])).map(([lg, name]) => `<div class="vc-group"><small>${name}</small><div class="vc-row">${VOICE_OPTS[lg].map(([id, zhn, en, zh], i) => {
            const on = (L.voices && L.voices[lg] ? L.voices[lg] : VOICE_OPTS[lg][0][0]) === id;
            return `<div class="vc-opt ${on ? 'on' : ''}"><button class="vc-pick" data-vlang="${lg}" data-voice="${id}" aria-pressed="${on}"><b>${LANG === 'zh' || lg !== 'en' ? zhn : id}</b><span>${C(en, zh)}</span></button><button class="vc-play" data-vplay="${lg}:${id}" aria-label="${C('Listen', '試聽')}">▶</button></div>`; }).join('')}</div></div>`).join('')}
          <div class="prof-opts two">${opt('vrate', '', C('Normal speed', '正常速度'), '')}${opt('vrate', 'slower', C('A bit slower', '慢一點'), C('Good for younger children', '適合年紀較小的孩子'))}</div>
          <div class="prof-opts two">${opt('autoread', '', C('Read questions only when tapped', '按 🔊 才朗讀題目'), C('Tap 🔊 on a question', '在題目按 🔊'))}${opt('autoread', 'on', C('Read each question automatically', '自動朗讀每一題'), C(`Good for ${COUNTRIES[countryOf(L)].chip('P1')}–${COUNTRIES[countryOf(L)].chip('P2')}`, `適合${gradeName('P1', countryOf(L))}至${gradeName('P2', countryOf(L))}`))}</div>
        </section>
        ${L.grade ? `<section class="stack g10" data-st="4"><b>${C('What are they working towards?', '孩子現在的目標？')} <span class="muted" style="font-weight:500">${C('(pick any)', '（可選多項）')}</span></b>
          <div class="prof-grades">${GOALS(L.grade).map(([k, t]) => `<button class="fchip ${L.goals.includes(k) ? 'on' : ''}" data-goal="${k}" aria-pressed="${L.goals.includes(k)}">${t}</button>`).join('')}</div></section>` : ''}
        `}
        ${KIDS.list.length > 1 ? `<section class="stack g10" data-st="1"><label for="pnick"><b>${C('Nickname on this device', '在這部裝置上的稱呼')}</b> <span class="muted">${C('(optional)', '（可選填）')}</span></label>
          <input id="pnick" class="input" maxlength="12" placeholder="${C('e.g. Big brother, Kid 2', '例如：哥哥、妹妹')}" value="${esc(KID.nick || '')}">
          <span class="hint" style="margin:0;text-align:left">${C('Only shown on this device to tell your children apart. Not sent to Buddy.', '只在這部裝置上用來分辨孩子，不會傳送給 Buddy。')}</span></section>` : ''}
        ${`        <section class="stack g10" data-st="4"><label for="plikes"><b>${C('What do they love?', '孩子喜歡甚麼？')}</b> <span class="muted">${C('(optional)', '（可選填）')}</span></label>
          <input id="plikes" class="input" maxlength="80" placeholder="${C('e.g. football, dinosaurs, drawing', '例如：足球、恐龍、畫畫')}" value="${esc(L.likes || '')}">
          <span class="hint" style="margin:0;text-align:left">${C('Buddy may use these in examples. Please don’t enter their name or school.', 'Buddy 或會用這些例子講解。請勿輸入孩子的名字或學校。')}</span></section>`}
        ${first && cap('stars') ? `<section class="stack g10" data-st="1"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b>${C('Stars and rewards', '星星及獎勵')}</b>
          <button class="switch ${starsV ? 'on' : ''}" id="pstars" role="switch" aria-checked="${starsV}" aria-label="${C('Stars and rewards', '星星及獎勵')}"><i></i></button></div>
          <span class="muted" style="font-size:14px;line-height:1.5">${C('Your child earns stars for practising and spends them on rewards you choose. You can change this later in Settings.', '孩子練習可賺取星星，再換取你設定的獎勵。之後可在「設定」更改。')}</span></section>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap">${first ? '' : `<button class="btn-sm" id="pcancel">${C('Cancel', '取消')}</button>`}<button class="btn" id="psave" ${L.grade ? '' : 'disabled'} style="${first ? '' : 'width:auto;padding:12px 24px'}">${first ? C('Continue', '繼續') : C('Save', '儲存')}</button></div>
      </div></main>`;
      if (first) {
        $app.querySelectorAll('.prof-box [data-st]').forEach((el) => { if (+el.dataset.st !== step) el.hidden = true; });
        const h = $app.querySelector('.cs-head h1');
        if (h) h.textContent = [C('About your child', '關於你的孩子'), C('At school', '學校'), C('Reading aloud', '朗讀'), C('Goals and interests', '目標及興趣')][step - 1];
        const sv = document.getElementById('psave');
        sv.textContent = step < STEPS ? C('Next', '下一步') : C('Done', '完成');
        sv.insertAdjacentHTML('beforebegin', step > 1 ? `<button class="btn-sm" id="pback">${C('Back', '上一步')}</button>` : '');
        sv.parentElement.insertAdjacentHTML('beforebegin', `<div class="prof-dots" aria-label="${C(`Page ${step} of ${STEPS}`, `第 ${step} 頁，共 ${STEPS} 頁`)}">${Array.from({ length: STEPS }, (_, k) => `<i class="${k < step ? 'on' : ''}"></i>`).join('')}<span>${step > 1 ? C('Optional · you can skip', '可略過') : ''}</span></div>`);
        const pb = document.getElementById('pback'); if (pb) pb.onclick = () => { keep(); step--; draw(); window.scrollTo(0, 0); };
      }
      const likes = document.getElementById('plikes') || { value: L.likes || '' };
      const redraw = () => { keep(); const nk = document.getElementById('pnick'); if (nk) KID.nick = nk.value.trim().slice(0, 12); const y = window.scrollY; draw(); window.scrollTo(0, y); };
      $app.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { L.likes = likes.value; L.grade = b.dataset.g; redraw(); }));
      $app.querySelectorAll('[data-country]').forEach((b) => (b.onclick = () => { L.likes = likes.value; L.country = b.dataset.country; redraw(); }));
      $app.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { L.likes = likes.value; L[b.dataset.k] = b.dataset.v; redraw(); }));
      $app.querySelectorAll('[data-voice]').forEach((b) => (b.onclick = () => { L.likes = likes.value; L.voices = { ...(L.voices || {}), [b.dataset.vlang]: b.dataset.voice }; redraw(); }));
      $app.querySelectorAll('[data-vplay]').forEach((b) => (b.onclick = () => {
        const [lg, id] = b.dataset.vplay.split(':');
        const keep = local.learner; local.learner = { ...(keep || {}), voices: { ...((L.voices) || {}), [lg]: id }, vrate: L.vrate || '' };
        sayAloud({ yue: '你好，我係 Buddy。今日我哋一齊溫習啦！', cmn: '你好，我是 Buddy。今天我們一起溫習吧！', en: 'Hello, I’m Buddy. Let’s practise together today!', fr: 'Bonjour, je suis Buddy. On révise ensemble aujourd’hui !', ja: 'こんにちは、バディです。きょうもいっしょにべんきょうしよう！' }[lg], lg);
        local.learner = keep;
      }));
      $app.querySelectorAll('[data-goal]').forEach((b) => (b.onclick = () => { L.likes = likes.value; const k = b.dataset.goal; L.goals = L.goals.includes(k) ? L.goals.filter((x) => x !== k) : [...L.goals, k]; redraw(); }));
      { const ps = document.getElementById('pstars'); if (ps) ps.onclick = () => { starsV = !starsV; starsSet = true; redraw(); }; }
      document.getElementById('psave').onclick = () => {
        if (!L.grade) return;
        if (first && step < STEPS) { keep(); step++; draw(); window.scrollTo(0, 0); return; }
        if (first) { keep(); local.name = nameV.replace(/[<>]/g, '').trim().slice(0, 30); if (cap('stars')) local.starsOn = starsV; }
        { const nk = document.getElementById('pnick'); if (nk) KID.nick = nk.value.replace(/[<>]/g, '').trim().slice(0, 12); }
        local.learner = { grade: L.grade, country: countryOf(L), at: Date.now(), pace: L.pace || '', medium: L.medium || '', zhLang: L.zhLang || '', explain: L.explain || '', voices: L.voices || {}, vrate: L.vrate || '', autoread: L.autoread || '', goals: L.goals, likes: likes.value.replace(/[<>]/g, '').trim().slice(0, 80) };
        delete local.needProfile; saveLocal(); track('profile'); kidMeta();
        if (first && nav) nav.style.display = '';
        if (first) $app.innerHTML = `<main class="pad" style="flex:1"></main>`;
        resolve(true);
      };
      const pc = document.getElementById('pcancel'); if (pc) pc.onclick = () => resolve(false);
    };
    draw(); drawn = true;
    window.scrollTo(0, 0);
  });
}
/* ---------- getting stronger: progress that allows for harder questions ----------
   The model is in progress.js. Here: keeping its state (local.pg), feeding it each answer, and the summary that
   the Progress tab, the Parent dashboard, the weekly report and the pilot sync show. */
function prevAnswer(qid) { const L = local.log || []; for (let i = L.length - 1; i >= 0; i--) if (L[i].q === qid) return L[i]; return null; }
function pgState() {
  // (re)build from the answer log when new, or when a book's subject became known after it was first counted
  const stale = local.pg && local.pg.v === 2 && Object.keys(local.pg.b).some((bid) => !local.pg.bs[bid] && BOOK_SUBJ[bid] && !BOOK_SUBJ[bid].startsWith('b:'));
  if (!local.pg || local.pg.v !== 2 || stale) { local.pg = PG.build(local.log, (bid) => BOOK_SUBJ[bid]); delete local.prog; }
  return local.pg;
}
// The compact summary carried by the weekly report (r.gs) and shown in the app:
// s: [subject, level, status, change, since, weekly levels, books [[title, level, status, change]], uncertainty, answers]
// What to do next in a subject that's holding steady or slipping (or any subject, for the WhatsApp update):
// the weakest chapter started so far, its open mistakes, or the next chapter not yet started.
async function subjNext(key, status, books) {
  const bs = books.filter((b) => BOOK_SUBJ[b.id] === key);
  let weak = null, fresh = null;
  for (const b of bs) {
    const m = await bookMastery(b);
    for (const c of m.chapters) {
      if (c.done >= 3 && (!weak || c.pct < weak.c.pct)) weak = { b, c };
      if (!c.done && !fresh) fresh = { b, c };
    }
  }
  const mk = (x) => Object.entries(local.mistakes || {}).filter(([id, v]) => !v.done && id.startsWith(`${x.b.id}:${x.c.unit.id}:`)).length;
  const nm = (x) => cleanUnitTitle(x.c.unit.title).slice(0, 50);
  const at = (x) => `${x.b.id}:${x.c.unit.id}`;
  if (status === 'dipping' && weak) { const n = mk(weak);
    return { u: at(weak), en: n ? `Go back over “${nm(weak)}”: redo its ${n} mistake${n > 1 ? 's' : ''}, then a short set` : `Go back over “${nm(weak)}” with a short set`, zh: n ? `重溫「${nm(weak)}」：重做 ${n} 題錯題，再做一組短練習` : `重溫「${nm(weak)}」，做一組短練習` }; }
  if (weak && weak.c.pct < 70) return { u: at(weak), en: `Focus on “${nm(weak)}”, the weakest chapter so far`, zh: `集中練習「${nm(weak)}」，目前最弱的章節` };
  if (fresh) return { u: at(fresh), en: `Start a new chapter: “${nm(fresh)}”`, zh: `開始新章節：「${nm(fresh)}」` };
  if (weak) return { u: at(weak), en: `Try harder questions in “${nm(weak)}”`, zh: `在「${nm(weak)}」試做較難的題目` };
  return null;
}
async function gsData() {
  const books = await getBooks(), P = PG.summary(pgState());
  const label = (key) => { if (key.startsWith('b:')) { const b = books.find((x) => x.id === key.slice(2)); return b ? b.title : null; }
    const b = books.find((x) => BOOK_SUBJ[x.id] === key); return b ? (b.subject ? subj(b.subject) : b.title) : null; };
  const s = (await Promise.all(P.subjects.map(async (x) => {
    const lab = label(x.key); if (!lab || !x.n) return null;
    const bks = x.books.length > 1 ? x.books.map((k) => { const b = books.find((y) => y.id === k.id); return b && k.level != null ? [b.title.slice(0, 40), k.level, k.status, k.change] : null; }).filter(Boolean) : [];
    const nx = x.status === 'steady' || x.status === 'dipping' ? await subjNext(x.key, x.status, books).catch(() => null) : null;
    return [lab.slice(0, 30), x.level, x.status, x.change, x.since, x.line.map((p) => p[1]), bks, x.cse, x.n, x.wkLeft, nx ? [LANG === 'zh' ? nx.zh : nx.en, nx.u] : null];
  }))).filter(Boolean).slice(0, 8);
  return { s, fx: P.fixed, kt: P.kept };
}

/* ---------- school results: is PrepBuddy helping? ----------
   Parents enter the child's school marks (percent) for the main subjects: once for the last test or exam
   before PrepBuddy (the baseline), then after each later test or exam. The admin page compares the baseline
   with the latest results across pilot families. Kept on this device and in the pilot sync (marks only). */
const MARK_SUBJ = () => (isPrimaryKid()
  ? [['chi', '中文', 'Chinese'], ['eng', '英文', 'English'], ['math', '數學', 'Maths'], ['gs', '常識／科學／人文', 'General Studies / Science / Humanities']]
  : [['chi', '中文', 'Chinese'], ['eng', '英文', 'English'], ['math', '數學', 'Maths']]);
const marksList = () => (local.marks || []).slice().sort((a, b) => (a.when || '').localeCompare(b.when || '') || a.t - b.t);
const marksBase = () => marksList().find((m) => m.kind === 'before') || null;
const marksAsk = () => local.pilot && profileOn() && gradeNow() && !marksBase() && !(local.marksSkip && Date.now() - local.marksSkip < 14 * DAY);
function marksScreen(edit, opts = {}) {
  return new Promise((resolve) => {
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
    const base = marksBase(), first = !base && !edit;
    const ym = (t) => new Date(t).toISOString().slice(0, 7);
    const M = edit ? JSON.parse(JSON.stringify(edit)) : { id: uid(), kind: first ? 'before' : 'later', exam: 'exam', when: ym(first ? Date.now() - 45 * DAY : Date.now()), s: {}, other: '' };
    const subs = MARK_SUBJ();
    const snap = { busy: false, read: [], err: '' }; // marks read from photos of the papers
    let drawn = false;
    const draw = () => {
      $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1"><div class="pg-box cs-box prof-box marks-box${drawn ? ' noanim' : ''}">
        <div class="cs-head">${buddySVG('happy', 56)}<div><span class="cs-tag">${opts.setup ? C('Last step · for parents · optional', '最後一步 · 家長專用 · 可選填') : C('For parents', '家長專用')}</span>
          <h1 style="margin:6px 0 0">${M.kind === 'before' ? C('School marks before PrepBuddy', '使用 PrepBuddy 前的學校成績') : C('Latest school marks', '最新學校成績')}</h1></div></div>
        <p class="pg-lead" style="text-align:left">${M.kind === 'before'
          ? C('From the last school test or exam before your child started PrepBuddy. Later you’ll add the next results, so you (and we) can see if it’s helping. Leave out any subject you don’t have.', '請填寫孩子開始使用 PrepBuddy 前最近一次測驗或考試的分數。之後再填下一次的成績，便可看到是否有幫助。沒有的科目可留空。')
          + (opts.setup ? C(' No marks to hand? Skip for now and add them later from the Parent dashboard in Settings.', '手上沒有成績？可暫時略過，之後在「設定」的家長主頁再填寫。') : '')
          : C('From the most recent school test or exam. Leave out any subject you don’t have.', '請填寫最近一次學校測驗或考試的分數。沒有的科目可留空。')}</p>
        <section class="mk-snap">
          <label class="mk-snapbtn${snap.busy ? ' busy' : ''}"><span class="mk-cam" aria-hidden="true">${actionIcon('homework', 22)}</span><span><b>${snap.busy ? C('Reading the papers…', '正在讀取試卷…') : C('Snap the marked papers', '拍下已批改的試卷')}</b><small>${C('Photo of the front page of each paper, where the total is. We fill in the marks for you.', '拍下每份試卷有總分的首頁，我們會為你填上分數。')}</small></span><input id="mphoto" type="file" accept="image/*" multiple hidden ${snap.busy ? 'disabled' : ''}></label>
          ${snap.read.length ? `<div class="mk-read"><b>${C('Read from your photos. Please check:', '從相片讀到的分數，請核對：')}</b><ul>${snap.read.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${snap.err ? `<p class="hw-err" style="margin:0">${esc(snap.err)}</p>` : ''}
          <span class="hint" style="margin:0;text-align:left">${C('Photos are only used to read the marks, then thrown away. Or type the marks below.', '相片只用來讀取分數，之後不會保存。你也可以在下面自行輸入。')}</span>
        </section>
        <section class="stack g10"><b>${C('Which results?', '哪一次的成績？')}</b>
          <div class="prof-opts two"><button class="langopt${M.exam === 'exam' ? ' on' : ''}" data-ex="exam"><b>${C('Exam', '考試')}</b><span>${C('Term or final exam', '上／下學期考試')}</span></button><button class="langopt${M.exam === 'test' ? ' on' : ''}" data-ex="test"><b>${C('Test', '測驗')}</b><span>${C('Uniform or class test', '統測／小測')}</span></button></div>
          <label class="mk-when"><span>${C('Month', '月份')}</span><input id="mwhen" class="input" type="month" value="${esc(M.when)}" max="${ym(Date.now())}"></label></section>
        <section class="stack g8"><b>${C('Marks (out of 100)', '分數（滿分 100）')}</b>
          ${subs.map(([k, zh, en]) => `<label class="mk-row"><span>${C(en, zh)}</span><input class="input" type="number" inputmode="numeric" min="0" max="100" data-m="${k}" value="${M.s[k] ?? ''}" placeholder="–"></label>`).join('')}
          <label class="mk-row"><input id="moth" class="input" maxlength="20" placeholder="${C('Another subject (optional)', '其他科目（可選填）')}" value="${esc(M.other || '')}"><input class="input" type="number" inputmode="numeric" min="0" max="100" data-m="other" value="${M.s.other ?? ''}" placeholder="–"></label>
          <span class="hint" style="margin:0;text-align:left">${C('Not out of 100? Work it out as a percentage, e.g. 45 out of 60 = 75.', '滿分不是 100？請換算成百分比，例如 60 分中得 45 分 = 75。')}</span></section>
        <p class="hw-err" id="merr" hidden></p>
        <div class="prof-btns"><button class="btn" id="msave">${C('Save', '儲存')}</button><button class="${opts.setup ? 'btn ghost' : 'btn-sm quiet'}" id="mlater">${opts.setup ? C('Skip for now', '暫時略過') : first ? C('Later', '稍後') : C('Cancel', '取消')}</button>${edit ? `<button class="btn-sm quiet" id="mdel">${C('Delete', '刪除')}</button>` : ''}</div>
        <p class="hint" style="margin:0">${C('Only the marks and the month are shared with the PrepBuddy pilot team, to measure whether the app helps. Not the school or any comments.', '只會把分數和月份分享給 PrepBuddy 試用團隊，用來衡量成效，不包括學校名稱或評語。')}</p>
      </div></main>`;
      drawn = true;
      const read = () => { $app.querySelectorAll('[data-m]').forEach((i) => { const v = i.value.trim(); if (v === '') delete M.s[i.dataset.m]; else M.s[i.dataset.m] = Math.round(Number(v)); }); M.when = document.getElementById('mwhen').value || M.when; M.other = document.getElementById('moth').value.replace(/[<>]/g, '').trim().slice(0, 20); };
      $app.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => { read(); M.exam = b.dataset.ex; draw(); }));
      document.getElementById('mphoto').onchange = async (e) => {
        read(); const files = [...e.target.files].slice(0, 6); if (!files.length) return;
        snap.busy = true; snap.err = ''; snap.read = []; draw();
        try {
          const images = []; for (const f of files) images.push(await shrinkPhoto(f, 1800));
          const r = await api('homework', { step: 'marks', images, lang: LANG });
          const label = (k, p) => (k === 'other' ? p.other_name || C('Other', '其他') : ((subs.find((x) => x[0] === k) || [k, k, k])[LANG === 'zh' ? 1 : 2]));
          for (const p of r.papers || []) {
            if (p.score === null || !p.total) { snap.read.push(`${label(p.subject, p)}: ${C('couldn’t read the mark', '看不清分數')}`); continue; }
            const pct = Math.max(0, Math.min(100, Math.round((100 * p.score) / p.total)));
            let k = subs.some((x) => x[0] === p.subject) ? p.subject : 'other';
            if (k === 'other') { const nm = p.subject === 'other' ? p.other_name : label(p.subject, p); if (M.s.other !== undefined && M.other && M.other !== nm) continue; M.other = String(nm || '').slice(0, 20); }
            M.s[k] = pct;
            if (p.kind) M.exam = p.kind;
            if (p.month && p.month <= ym(Date.now())) M.when = p.month;
            snap.read.push(`${k === 'other' ? M.other : label(k, p)}: ${p.score} / ${p.total}${p.total !== 100 ? ` = ${pct}` : ''}`);
          }
          if (!snap.read.length) snap.err = r.note || C('I couldn’t find the marks in these photos. Try a clearer photo of the page with the total, or type them in.', '在相片中找不到分數。請拍清楚有總分的一頁，或自行輸入。');
          else if (r.note) snap.read.push(r.note);
        } catch (err) { snap.err = err.status === 0 ? C('You seem to be offline.', '你好像離線了。') : (err.message || C('Couldn’t read the photos.', '讀取相片失敗。')); }
        snap.busy = false; draw();
      };
      const done = (saved) => { if (nav) nav.style.display = ''; resolve(saved || null); };
      document.getElementById('msave').onclick = () => {
        read();
        const bad = Object.values(M.s).some((v) => !(v >= 0 && v <= 100));
        if (bad || !Object.keys(M.s).length) { const e = document.getElementById('merr'); e.hidden = false; e.textContent = bad ? C('Marks need to be between 0 and 100 (a percentage).', '分數需介乎 0 至 100（百分比）。') : C('Add at least one mark.', '請至少填寫一科分數。'); return; }
        M.t = M.t || Date.now();
        local.marks = [...(local.marks || []).filter((x) => x.id !== M.id), M]; delete local.marksSkip; saveLocal(); track('marks');
        toast(C('Saved. Thank you!', '已儲存，謝謝！')); done(M);
      };
      document.getElementById('mlater').onclick = () => { if (first) { local.marksSkip = Date.now(); saveLocal(); } done(); };
      const dl = document.getElementById('mdel'); if (dl) dl.onclick = () => { local.marks = (local.marks || []).filter((x) => x.id !== M.id); saveLocal(); done(); };
    };
    draw(); window.scrollTo(0, 0);
    if (opts.snap) { const ph = document.getElementById('mphoto'); if (ph) ph.click(); } // opened from a 'Snap the paper' button: go straight to the camera
  });
}
// Parent dashboard card: before vs latest, per subject.
function marksCard() {
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  const list = marksList(), base = marksBase(), later = list.filter((m) => m.kind === 'later'), last = later[later.length - 1];
  const name = (k, m) => (k === 'other' ? (m.other || C('Other', '其他')) : ((MARK_SUBJ().concat([['gs', '常識', 'General Studies']]).find((x) => x[0] === k) || [k, k, k])[LANG === 'zh' ? 1 : 2]));
  const mon = (w) => { try { return new Date(w + '-01').toLocaleDateString(LOCALE(), { month: 'short', year: 'numeric' }); } catch (e) { return w; } };
  const rows = base ? Object.keys({ ...base.s, ...(last ? last.s : {}) }).map((k) => {
    const a = base.s[k], b = last ? last.s[k] : undefined, d = typeof a === 'number' && typeof b === 'number' ? b - a : null;
    return `<div class="mk-cmp"><span>${esc(name(k, last && last.s[k] !== undefined ? last : base))}</span><b>${a ?? '–'}</b><b>${b ?? '–'}</b><em class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d === null ? '' : d > 0 ? `+${d}` : d}</em></div>`; }).join('') : '';
  return `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('target', 18)} ${C('School results', '學校成績')}</h2><button class="btn-sm" id="pdMarks">+ ${base ? C('Add results', '加入成績') : C('Add marks before PrepBuddy', '加入使用前成績')}</button></div>
    ${base ? `<div class="mk-cmp head"><span></span><b>${C('Before', '使用前')}<small>${esc(mon(base.when))}</small></b><b>${C('Latest', '最新')}<small>${last ? esc(mon(last.when)) : '–'}</small></b><em></em></div>${rows}
      ${!last ? `<p class="hint" style="margin:6px 0 0;text-align:left">${C('Add the next test or exam results to see the change.', '加入下一次測驗或考試成績，便可看到變化。')}</p>` : ''}
      ${list.length ? `<div class="mk-hist">${list.map((m) => `<button class="chip" data-mk="${esc(m.id)}">${esc(mon(m.when))} · ${m.exam === 'test' ? C('test', '測驗') : C('exam', '考試')}</button>`).join('')}</div>` : ''}`
    : `<p style="font-size:14px;margin:0">${C('Add your child’s school marks from before PrepBuddy, then the next results. You’ll see, subject by subject, whether practice is paying off.', '加入孩子使用 PrepBuddy 前的學校成績，再加入之後的成績，便可逐科看到練習的成效。')}</p>`}
  </section>`;
}

// Guided tours: go to each screen, spotlight the real button, and say what it does.
// A step: { go (view name or view), run (async: sets up the screen itself), sel (CSS, first visible match), t, d,
// skipIfMissing } — no sel, or sel missing, = a centred card.
const waitFor = (sel, ms = 2500) => new Promise((res) => {
  const t0 = Date.now();
  const look = () => { const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent || e.getClientRects().length); if (el || Date.now() - t0 > ms) return res(el || null); requestAnimationFrame(look); };
  look();
});
function coachTour(steps, done) {
  return new Promise((resolve) => {
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    let k = 0, el = null, alive = true, raf = 0, gen = 0;
    const ov = document.createElement('div'); ov.className = 'cmk'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="cmk-dim"></div><div class="cmk-hole" id="cmk-hole"></div><div class="cmk-tip" id="cmk-tip" aria-live="polite"></div>`;
    document.body.appendChild(ov);
    const hole = ov.querySelector('#cmk-hole'), tip = ov.querySelector('#cmk-tip'), dim = ov.querySelector('.cmk-dim');
    const finish = (how) => { if (!alive) return; alive = false; window.removeEventListener('resize', later); window.removeEventListener('scroll', later, true); document.removeEventListener('keydown', key); ov.remove(); TOURING = false; done && done(how, k); resolve(how); };
    const place = () => {
      raf = 0; if (!alive) return;
      if (!el || !el.isConnected) { hole.style.display = 'none'; dim.style.display = 'block'; tip.className = 'cmk-tip center'; tip.style.left = tip.style.top = tip.style.width = ''; return; }
      const r = el.getBoundingClientRect(), pad = 8;
      dim.style.display = 'none'; hole.style.display = 'block';
      hole.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`; hole.style.width = `${r.width + 2 * pad}px`; hole.style.height = `${r.height + 2 * pad}px`;
      tip.className = 'cmk-tip';
      const tw = Math.min(360, innerWidth - 24); tip.style.width = `${tw}px`;
      const th = tip.offsetHeight;
      let top = r.bottom + pad + 14, left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), innerWidth - tw - 12);
      if (top + th > innerHeight - 12) top = r.top - pad - 14 - th;
      if (top < 12) { if (innerWidth >= 640 && r.right + 16 + tw < innerWidth) { left = r.right + 16; top = Math.max(12, Math.min(innerHeight - th - 12, r.top)); } else if (innerWidth >= 640 && r.left - 16 - tw > 0) { left = r.left - 16 - tw; top = Math.max(12, Math.min(innerHeight - th - 12, r.top)); } else top = innerHeight - th - 12; }
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(place); };
    const show = async (dir = 1) => {
      const my = ++gen, x = steps[k];
      tip.classList.add('out');
      if (x.run || x.go) { hole.style.display = 'none'; dim.style.display = 'block'; }
      if (x.run) await x.run();
      else if (x.go) { const v = typeof x.go === 'string' ? { name: x.go } : x.go; if (view.name !== v.name || (v.bookId && view.bookId !== v.bookId) || (v.sec || '') !== (view.sec || '') || x.fresh) await go(v); }
      el = x.sel ? await waitFor(x.sel, x.skipIfMissing ? 700 : 2500) : null;
      if (!alive || my !== gen) return;
      if (!el && x.skipIfMissing) { k += dir; if (k < 0) k = 0; if (k >= steps.length) return finish('done'); return show(dir); }
      if (el) { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 90) el.scrollIntoView({ block: 'center' }); }
      const last = k === steps.length - 1;
      tip.innerHTML = `<div class="cmk-head"><span class="cmk-bud hop">${buddySVG(x.face || 'happy', 38)}</span><b>${x.t}</b></div><p>${x.d}</p>
        <div class="cmk-foot"><span class="cmk-n">${k + 1} / ${steps.length}</span>${last ? '' : `<button class="cmk-skip" id="cmk-skip">${C('Skip tour', '略過導覽')}</button>`}
        ${k ? `<button class="btn-sm" id="cmk-back">${C('Back', '上一步')}</button>` : ''}<button class="btn-sm primary" id="cmk-next">${x.cta || (last ? C('Done', '完成') : C('Next', '下一步'))}</button></div>`;
      tip.querySelector('#cmk-next').onclick = () => { if (last) return finish('done'); k++; show(1); };
      const bk = tip.querySelector('#cmk-back'); if (bk) bk.onclick = () => { k--; show(-1); };
      const sk = tip.querySelector('#cmk-skip'); if (sk) sk.onclick = () => finish('skip');
      place();
      tip.classList.remove('out');
      hole.classList.remove('pulse'); void hole.offsetWidth; hole.classList.add('pulse');
      tip.querySelector('#cmk-next').focus({ preventScroll: true });
    };
    const key = (e) => { if (e.key === 'Escape') finish('skip'); else if (e.key === 'ArrowRight') tip.querySelector('#cmk-next')?.click(); else if (e.key === 'ArrowLeft') tip.querySelector('#cmk-back')?.click(); };
    window.addEventListener('resize', later); window.addEventListener('scroll', later, { capture: true, passive: true }); document.addEventListener('keydown', key);
    // A tap outside the box: Buddy waves to point you back to Next (the box itself stays still).
    ov.addEventListener('click', (e) => { if (!tip.contains(e.target)) { const bd = tip.querySelector('.cmk-bud'); if (bd) { bd.classList.remove('wave', 'hop'); void bd.offsetWidth; bd.classList.add('wave'); } } });
    TOURING = true;
    show(1);
  });
}
// First run (and 'Quick tour' in Settings): six stops on the real screens, with the starter books, in under a minute.
async function quickTour(replay) {
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  const tab = (k) => `[data-tabgo="${k}"]`;
  const steps = [
    { go: 'home', sel: tab('home'), t: C('Hi, I’m Buddy! This is Today', '你好，我是 Buddy！這是「今日」'), d: C('Your home screen: your streak, your next school test and today’s mission. Tap Start and I’ll take you through it.', '你的主頁：連續練習日數、下一個學校測驗和今日任務。按「開始」，我會帶你逐項完成。') },
    { go: 'books', sel: tab('books'), t: C('Books', '課本'), d: C('Your textbooks. We’ve added free PrepBuddy books to try, and you can add your own school books here.', '你的課本。我們已加入 PrepBuddy 的免費課本給你試用，你也可以在這裏加入學校課本。') },
    { go: 'practice', sel: tab('practice'), t: C('Practice', '練習'), d: C('Learn or practise any chapter, plus dictation, writing, listening, speaking and homework help.', '學習或練習任何一章，還有默書、寫作、聆聽、說話和功課幫手。') },
    { go: 'practice', sel: '#mkgo', skipIfMissing: true, t: C('Mistake book', '錯題簿'), d: C('Every wrong answer lands here, under Practice. Get it right again a day later and it’s mastered.', '答錯的題目都會放在「練習」的錯題簿。隔一天再答對，就算掌握了。') },
    { go: 'settings', sel: tab('settings'), t: C('Settings', '設定'), d: C('Your name, language, backups, and the parent dashboard.', '名字、語言、備份，以及家長主頁。') },
    { go: 'progress', sel: tab('progress'), t: C('Progress', '進度'), d: C('How you’re doing each week. Parents can open the parent dashboard from here or from Settings.', '每週的學習情況。家長可以在這裏或「設定」打開家長主頁。') },
    { go: 'home', t: C('Ask me any time', '隨時問我'), d: C('Stuck on a question? Tap my round button in the corner. Ready? Let’s start with today’s mission.', '遇到不明白的題目？按角落的圓形按鈕問我。準備好了嗎？由今日任務開始吧！'), cta: C('Let’s go', '開始') },
  ];
  await coachTour(steps, (how, k) => { local.toured = Date.now(); saveLocal(); track(replay ? 'tour_replay' : how === 'done' ? 'tour_done' : `tour_skip:${k}`); });
  go({ name: 'home' });
}
// The full tour, on the real screens, using a small sample book (removed at the end) so every feature can be shown.
async function startTour(replay) {
  if (replay !== 'full') return quickTour(replay);
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  const lt = (f) => (locked(f) ? ` <span class="tr-lock">🔒 ${TIERS[nextPlanFor(f)].name}</span>` : '');
  const tab = (k) => `[data-tabgo="${k}"]`;
  await installDemo(LANG);
  const demo = async () => (await getBooks()).find((b) => b.id === DEMO_ID);
  const book = { name: 'book', bookId: DEMO_ID };
  const steps = [
    { go: 'home', t: C('Hi, I’m Buddy!', '你好，我是 Buddy！'), d: C('Let me show you everything PrepBuddy can do, on the real screens. It takes about 3 minutes, and you can skip any time.', '讓我在真實的頁面上，帶你看看 PrepBuddy 的所有功能，大約 3 分鐘，隨時可以略過。') },
    { go: 'home', sel: tab('home'), t: C('Today', '今日'), d: C('Your home screen. Buddy plans what to do each day: reviews, a chapter to practise, mistakes to fix.', '你的主頁。Buddy 每天為你安排要做的事：溫習、練習章節、改正錯題。') },
    { go: 'home', sel: '.ms-card', skipIfMissing: true, t: C('Today’s mission', '今日任務'), d: C('Start here every day: Buddy picks 2–3 things to do, in order. Tap Start, and each one gets a tick when it’s done. About 15 minutes.', '每天由這裏開始：Buddy 會按次序選 2 至 3 件事。按「開始」，完成一項就會打勾。約 15 分鐘。') },
    { go: 'books', sel: tab('books'), t: C('Books', '課本'), d: C('All your textbooks live here. For the tour I’ve added a sample book. Let’s open it.', '你所有的課本都在這裏。我為導覽加了一本示範課本，我們打開看看。') },
    { go: book, sel: '.bk-head', t: C('A book', '一本課本'), d: C('Every chapter of your textbook becomes questions, lessons, notes and flashcards, written from the book itself.', '課本的每一章都會變成題目、課堂、筆記和閃卡，全部根據課本內容。') },
    { go: book, sel: '.pl-card', skipIfMissing: true, t: C('Find your level', '找出你的程度'), d: C('A 5-minute quiz across the book, so every chapter starts at the right difficulty.', '一個 5 分鐘、涵蓋全書的小測驗，讓每一章都由合適的難度開始。') },
    { go: book, sel: 'section.learn-card', skipIfMissing: true, t: C('Learn mode', '學習模式') + lt('lesson'), d: C('New chapter? Buddy teaches it before you practise. Let’s look inside.', '新章節？Buddy 會先教你，再讓你練習。我們進去看看。') },
    { go: { name: 'learn', bookId: DEMO_ID, unitId: 'u0' }, sel: '.ln-start', t: C('A lesson', '一課'), d: C('Short steps with examples, each followed by a quick check question.', '簡短的步驟加例子，每一步之後有一條小測驗。') },
    { go: { name: 'learn', bookId: DEMO_ID, unitId: 'u0' }, sel: '#lnchat', skipIfMissing: true, t: C('Ask Buddy during the lesson', '上課時問 Buddy'), d: C('Confused? Ask anything here, in English or Chinese. Buddy answers from your textbook.', '不明白？可以用中文或英文在這裏發問，Buddy 會根據你的課本回答。') },
    { run: async () => { pick = { bookId: DEMO_ID, ids: new Set(['u0']), open: new Set() }; await go(book); }, sel: '.crow', t: C('Pick chapters to practise', '選擇要練習的章節'), d: C('Tick one or more chapters. You can choose multiple choice, written questions or both, and the difficulty.', '剔選一個或多個章節，可以選擇選擇題、文字題或兩者，以及難度。') },
    { go: book, sel: '#go', skipIfMissing: true, t: C('Start a practice set', '開始練習'), d: C('About 10 questions at a time, about 10 minutes. Let’s try one.', '每次約 10 題、約 10 分鐘。我們試試看。') },
    { run: async () => { const b = await demo(); if (b) await startUnits(b, b.units, 5, { types: 'mcq', diff: 'auto' }); }, sel: '#opts, .opt', t: C('Answer the question', '回答問題'), d: C('Tap an answer to see if it’s right, with an explanation from the textbook. Written answers are marked by AI.', '按一個答案，就會知道對不對，並附課本的解釋。文字題由 AI 批改。') },
    { sel: '#tutor', skipIfMissing: true, t: C('Stuck? Ask Buddy', '卡住了？問 Buddy'), d: C('Ask what the question means, get a hint, or have key words explained, without Buddy giving the answer away. You can type or talk.', '可以問題目的意思、要提示，或請 Buddy 解釋關鍵詞，Buddy 不會直接給你答案。可以打字或說話。') },
    { run: async () => { pick = { bookId: DEMO_ID, ids: new Set(['u0']), open: new Set(), opts: true }; await go(book); }, sel: '#notes', skipIfMissing: true, t: C('Notes and flashcards', '筆記與閃卡'), d: C('Revision notes and flashcards for the chapters you picked. Let’s see the notes.', '為你選的章節製作溫習筆記和閃卡。我們看看筆記。') },
    { go: { name: 'notes', bookId: DEMO_ID }, sel: '.ncard', t: C('Revision notes', '溫習筆記'), d: C('Key points, key terms and formulas for each chapter. You can print them too.', '每一章的重點、關鍵詞和公式，也可以列印。') },
    { go: { name: 'cards', bookId: DEMO_ID }, sel: '#flip, .fcard', t: C('Flashcards', '閃卡'), d: C('Quick-fire recall: read the question, think, then flip. Mark what you knew.', '快速記憶：看問題、想一想，再翻轉。記下你懂不懂。') },
    { run: async () => { pick = { bookId: DEMO_ID, ids: new Set(['u0']), open: new Set(), opts: true }; await go(book); }, sel: '#ctest', skipIfMissing: true, t: C('Chapter tests', '章節測驗') + lt('test'), d: C('Timed tests marked like a school test, with a pass mark of 80%.', '計時測驗，按學校測驗方式批改，合格分數為 80%。') },
    { run: async () => { pick = { bookId: DEMO_ID, ids: new Set(['u0']), open: new Set(), opts: true }; await go(book); }, sel: '#paper', skipIfMissing: true, t: C('Mock exams', '模擬考試') + lt('mock'), d: C('Full DSE-style papers, or printable worksheets to do on paper.', '完整 DSE 模式試卷，或可列印的工作紙。') },
    { go: 'home', sel: '.td-sec', skipIfMissing: true, t: C('School tests', '學校測驗') + lt('sched'), d: C('Add your test dates and chapters. The next test shows here with how ready you are for each chapter, and Today’s mission works on it first.', '加入測驗日期和範圍。下一個測驗會在這裏顯示每章的準備度，今日任務也會優先溫習。') },
    { go: 'practice', sel: tab('practice'), t: C('Practice', '練習'), d: C('Every way to study in one place. You choose a book, then the chapters.', '所有學習方式都在這裏。先選課本，再選章節。') },
    { go: 'practice', sel: 'main[data-view="practice"] .quick', skipIfMissing: true, t: C('Study tools', '學習工具'), d: C('Homework help, lessons, revision notes, flashcards, practice questions, mock exams, weak topics and the Mistake book.', '功課幫手、課堂、溫習筆記、閃卡、練習題、模擬考試、弱項和錯題簿。') },
    { go: 'homework', sel: '.hw-cap, .hw-hero', t: C('Homework help', '功課幫手') + lt('homework'), d: C('Snap a photo of your homework. Buddy reads it and guides you through each question.', '拍下功課，Buddy 會讀取題目，並引導你逐題完成。') },
    { go: 'dictation', sel: '#dnew', skipIfMissing: true, t: C('Dictation', '默書'), d: C('Snap your dictation list. Buddy reads the words aloud, you write them, then check.', '拍下默書範圍，Buddy 讀出詞語，你寫下來，然後核對。') },
    { go: 'writing', sel: '.wr-step', skipIfMissing: true, t: C('Writing', '寫作') + lt('writing'), d: C('Pick a DSE paper, write or snap your essay, and get marked against the real criteria. Then redraft.', '選擇 DSE 試卷，輸入或拍下文章，按真實準則批改，再修改。') },
    { go: 'speaking', sel: '.wr-step', skipIfMissing: true, t: C('Speaking', '說話') + lt('speaking'), d: C('DSE Paper 4 practice: get a topic, speak for a minute, and get feedback on your answer.', 'DSE 卷四練習：取得題目，說一分鐘，然後獲得回饋。') },
    { go: 'practice', sel: '#mkgo', skipIfMissing: true, t: C('Mistake book', '錯題簿'), d: C('Every wrong answer lands here, in Practice, by subject and chapter. The number shows how many are left. Get one right a day later and it’s mastered.', '答錯的題目會按科目和章節放在「練習」的錯題簿，數字顯示還有多少題。隔天再答對，就算掌握了。') },
    { go: 'progress', sel: tab('progress'), t: C('Progress', '進度'), d: C('Time practised, scores over time, and how ready you are for each book.', '練習時間、分數變化，以及每本課本的準備程度。') },
    { go: 'progress', sel: '#goal-set, #goal-edit', skipIfMissing: true, t: C('Weekly goal', '每週目標'), d: C('Pick days and minutes a week. Reaching it earns bonus stars.', '選擇每週練習的天數和分鐘。達成可以賺額外星星。') },
    { go: 'progress', sel: '#parentDash', skipIfMissing: true, t: C('Parent dashboard', '家長主頁') + lt('parent'), d: C('Behind a PIN that a parent sets: today, this week, and what needs attention.', '由家長設定密碼保護：今日、本週，以及需要留意的地方。') },
    { go: 'progress', sel: '#report', skipIfMissing: true, t: C('Weekly report', '每週報告'), d: C('A one-page summary to send to a parent as a link.', '一頁摘要，可以用連結傳送給家長。') },
    { go: 'stars', sel: 'section.stack', skipIfMissing: true, t: C('Stars and rewards', '星星與獎勵') + lt('stars'), d: C('Earn stars for real effort and swap them for rewards your parents choose. Rushing earns nothing!', '憑真正努力賺取星星，換取家長設定的獎勵。亂答一通不會有星星！') },
    { go: 'settings', sel: tab('settings'), t: C('Settings', '設定'), d: C('Your child’s details and stars, the parent area, language, backup, help and privacy, each behind its own button.', '孩子的資料和星星、家長專區、語言、備份、說明及私隱，各有自己的按鈕。') },
    { go: { name: 'settings', sec: 'help' }, sel: '#sfb', skipIfMissing: true, t: C('Tell us what you think', '告訴我們你的意見'), d: C('Something confusing, or a great idea? Type it here. We read every message.', '有地方令你困惑，或有好主意？在這裏輸入，我們會細閱每一個訊息。') },
    { go: 'progress', sel: '#helperFab', skipIfMissing: true, t: C('Ask Buddy any time', '隨時問 Buddy'), d: C('On any screen, tap here to ask a question, get study advice, or find your way around.', '在任何頁面按這裏，都可以發問、取得溫習建議，或問怎樣使用。') },
    { go: 'home', t: C('Now add your own textbook!', '現在加入你自己的課本！'), d: C('The sample book goes away now. Search for your textbook, then do “Find your level”. You can replay this tour in Settings.', '示範課本現在會移除。搜尋你的課本，然後做「找出你的程度」。你可以在設定中再看一次導覽。'), face: 'done', cta: C('Let’s go!', '開始吧！') },
  ];
  await coachTour(steps, (how, k) => { local.toured = Date.now(); saveLocal(); track(replay ? 'tour_replay' : how === 'done' ? 'tour_done' : `tour_skip:${k}`); });
  S = null; pick = { bookId: null, ids: new Set() };
  await removeDemo();
  go({ name: 'home' });
}

/* ---------- don't lose a set to an accidental refresh ----------
   On phones, pulling the page down reloads it. While a set or test is open we (1) switch off pull-to-refresh,
   (2) ask the browser to warn before leaving (laptops and Android), and (3) keep a copy of the set in this tab,
   so after a reload anyway (iPhone ignores the warning) the student can carry on where they were. */
const RESUME_KEY = 'prepbuddy.resume';
function saveResume() {
  try {
    if (S && S.qs && S.qs.length && !TOURING && !(S.book && S.book.demo) && inSession()) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ at: Date.now(), S: { ...S, waiting: false, generating: false, error: null, pending: 0 } }, (k, v) => (v instanceof Set ? { __set: [...v] } : v instanceof Map ? { __map: [...v] } : v)));
    else if (!inSession()) sessionStorage.removeItem(RESUME_KEY);
  } catch (e) {}
}
setInterval(() => { saveResume(); document.documentElement.classList.toggle('insession', !!inSession() && !TOURING); }, 1500);
window.addEventListener('pagehide', saveResume);
window.addEventListener('beforeunload', (e) => {
  saveResume();
  if (inSession() && !TOURING) { e.preventDefault(); e.returnValue = ''; return ''; }
});
async function offerResume() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null', (k, v) => (v && v.__set ? new Set(v.__set) : v && v.__map ? new Map(v.__map) : v)); } catch (e) {}
  sessionStorage.removeItem(RESUME_KEY);
  if (!r || !r.S || Date.now() - r.at > 2 * 3600e3 || inSession()) return;
  const left = r.S.qs.length - (r.S.i || 0);
  if (left <= 0) return;
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  // confirmLeave: true = the right-hand button
  const ok = await confirmLeave({ title: C('Carry on where you left off?', '繼續剛才的練習？'), body: C(`The page reloaded in the middle of “${r.S.title || 'your set'}”. You were on question ${(r.S.i || 0) + 1} of ${r.S.qs.length}.`, `頁面在「${r.S.title || '練習'}」途中重新載入。你做到第 ${(r.S.i || 0) + 1} 題（共 ${r.S.qs.length} 題）。`), stay: C('Start fresh', '重新開始'), leave: C('Carry on', '繼續') });
  if (!ok) return;
  S = r.S; S.times = S.times || [];
  if (S.target && S.qs.length < S.target) topUp(S);
  renderQuestion();
}
// A short summary of how PrepBuddy is used on this device (sent to the pilot admin page).
async function pilotSnap() {
  const books = await getBooks();
  // next steps per subject for the parent's weekly update (both languages: the parent may read the other one)
  const NEXT_CACHE = {};
  try { for (const x of PG.summary(pgState()).subjects) { const nx = await subjNext(x.key, x.status, books); if (nx) NEXT_CACHE[x.key] = { en: nx.en, zh: nx.zh }; } } catch (e) {}
  const t0 = dayStart(), log = local.log || [], since = t0 - 59 * DAY;
  const days = [];
  for (let i = 59; i >= 0; i--) {
    const a = t0 - i * DAY, es = log.filter((e) => e.t >= a && e.t < a + DAY);
    if (!es.length) continue;
    days.push({ d: ymd(a), q: es.length, g: es.reduce((x, e) => x + (e.g || 0), 0), m: es.reduce((x, e) => x + (e.m || 0), 0), min: minutesOf(es) });
  }
  const recent = log.filter((e) => e.t >= since);
  // when they study: hour of day and day of week (device time), counted in questions
  const hours = Array(24).fill(0), wdays = Array(7).fill(0);
  recent.forEach((e) => { const d = new Date(e.t); hours[d.getHours()]++; wdays[d.getDay()]++; });
  // questions and score by practice mode
  const modes = {};
  recent.forEach((e) => { const k = e.k || 'practice'; const x = modes[k] || (modes[k] = { q: 0, g: 0, m: 0 }); x.q++; x.g += e.g || 0; x.m += e.m || 0; });
  const bk = [];
  for (const b of books.filter((x) => !x.demo).slice(0, 12)) {
    let pct = null; try { pct = (await bookMastery(b)).pct; } catch (e) {}
    const es = log.filter((e) => e.q && e.q.startsWith(b.id + ':')), g = es.reduce((x, e) => x + (e.g || 0), 0), m = es.reduce((x, e) => x + (e.m || 0), 0);
    bk.push({ title: b.title, subject: b.subject || '', level: b.level || '', chapters: b.units.length, pct, q: es.length, acc: m ? Math.round(100 * g / m) : null });
  }
  const g = log.reduce((x, e) => x + (e.g || 0), 0), m = log.reduce((x, e) => x + (e.m || 0), 0);
  const st = starsOn() || local.stars ? starState() : null;
  const why = {};
  if (st) (st.log || []).forEach((x) => { const k = String(x.why || '').split(':')[0]; why[k] = (why[k] || 0) + x.n; });
  const U = local.usage || {}, usage = { usd: 0, calls: 0, by: {} };
  Object.entries(U).forEach(([k, v]) => { usage.usd += v.usd || 0; usage.calls += v.requests || 0; usage.by[k] = { n: v.requests || 0, usd: Math.round((v.usd || 0) * 1000) / 1000 }; });
  usage.usd = Math.round(usage.usd * 1000) / 1000;
  const dset = new Set(log.map((e) => dayStart(e.t)));
  let streak = 0; for (let d = dset.has(t0) ? t0 : t0 - DAY; dset.has(d); d -= DAY) streak++;
  let best = 0, run = 0, prev = 0; [...dset].sort((a, b) => a - b).forEach((d) => { run = prev && d - prev <= DAY + 3600e3 ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  const mk = Object.values(local.mistakes || {});
  return {
    v: 2, at: Date.now(), name: (local.name || '').trim().slice(0, 30), lang: LANG, plan: planId(), primary: !!primaryCache, learner: profileOn() && gradeNow() ? { grade: gradeNow(), country: country(), pace: local.learner.pace || '', medium: local.learner.medium || '', zhLang: local.learner.zhLang || '', explain: local.learner.explain || '', goals: local.learner.goals || [], kid: KIDS.list.length > 1 ? KIDS.list.indexOf(KID) + 1 : 0 } : null,
    // School marks entered by the parent (subject: percent), and school test results the child noted after each test.
    marks: (local.marks || []).slice(-12).map((m) => ({ kind: m.kind, exam: m.exam, when: m.when, s: m.s, other: m.other ? String(m.other).slice(0, 20) : '' })),
    // Getting stronger, per subject (see progress.js), plus first-attempt totals by level for the admin's calibration check.
    prog: (() => { try { const st = pgState(), P = PG.summary(st);
      return { v: 2, s: P.subjects.map((x) => ({ key: x.key, level: x.level, se: x.se, status: x.status, change: x.change, cse: x.cse, n: x.n, weeks: x.weeks, start: x.start, since: x.since, line: x.line.map((p) => p[1]), wkLeft: x.wkLeft, next: NEXT_CACHE[x.key] || null,
        books: x.books.map((k) => { const b = books.find((y) => y.id === k.id); return { t: b ? String(b.title).slice(0, 40) : '', level: k.level, status: k.status, change: k.change, n: k.n }; }) })),
        fixed: P.fixed, kept: P.kept, cal: PG.calibData(st) }; } catch (e) { return null; } })(),
    // The weekly report as of this sync, for the parent's report link (admin → Weekly updates; opened via /r/<token>).
    rep: await (async () => { try { const rep = await currentReport(); if (locked('report')) { Object.assign(rep, { ch: [], ms: [], tr: [], ts: [], ex: null, bs: 1 }); delete rep.sk; } return encodeReport(rep); } catch (e) { return null; } })(),
    stests: schoolTests().filter((x) => typeof x.score === 'number').slice(-20).map((x) => ({ d: new Date(testDay(x)).toISOString().slice(0, 10), score: x.score })),
    inst: isInstalled(), keep: persisted, ios: isIOS,
    ua: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'phone' : /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'computer',
    first: log.length ? log[0].t : null, last: log.length ? log[log.length - 1].t : null,
    total: { q: log.length, acc: m ? Math.round(100 * g / m) : null, min: minutesOf(log) },
    days, hours, wdays, modes, books: bk, fx: local.fx || {}, streak, best,
    sess: (local.sess || []).filter((x) => x.t >= since).slice(-150),
    goal: local.goal || null, usage,
    stars: st ? { on: starsOn(), bal: st.bal, total: st.total, why, redeemed: (st.redeemed || []).length, rewards: (st.rewards || []).length, rushedQ: st.rushedQ || 0, capDays: st.capDays || 0, badges: Object.keys(st.badges || {}).length } : null,
    parent: { pin: !!local.pin, pinAt: local.pinAt || null }, consent: local.consent || null, toured: local.toured || null,
    counts: { mistakes: mistakeCount(), fixed: mk.filter((x) => x.done).length, learned: Object.keys(local.learned || {}).length, tests: (local.tests || []).length, schoolTests: (local.sched || []).length, homework: (local.hw || []).length,
      writing: (local.wr || []).reduce((x, w) => x + w.drafts.length, 0), speaking: (local.sp || []).reduce((x, w) => x + w.tries.length, 0), placement: Object.keys(local.placement || {}).length,
      dictation: (local.dict || []).reduce((x, d) => x + ((d.runs || []).length), 0) },
    errs: (local.errs || []).slice(-10),
  };
}
let syncing = false;
async function pilotSync(force) {
  if (!local.pilot || !local.code || !local.consent || syncing) return; // nothing is sent before a parent agrees
  if (!force && local.syncAt && Date.now() - local.syncAt < 4 * 60000) return;
  syncing = true;
  try {
    const snap = await pilotSnap(); const r = await pilotPost({ step: 'sync', code: local.code, device: local.device, snap }); local.syncAt = Date.now();
    // The admin can put a pilot family on a plan; that overrides any preview on the device.
    if (r && r.plan && TIERS[r.plan]) { const changed = planId() !== r.plan; local.plan = r.plan; local.planLock = true; delete local.planPreview; if (changed) renderTabs(); }
    else if (r && r.ok && local.planLock && !r.plan) { local.planLock = false; delete local.plan; }
    saveLocal();
  }
  catch (e) { if (e.status === 401) { local.pilot = true; } }
  finally { syncing = false; }
}
setInterval(() => pilotSync(), 10 * 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { pilotSync(); if (KIDS.list.length > 1 && kidPickFresh()) kidPicked(); } }); // keeps the choice fresh while in use; never changes which child

/* ---------- back up and restore (until accounts) ----------
   Everything PrepBuddy keeps on this device in one file: progress, settings, textbooks, questions, notes,
   essays, homework. Restore replaces what is on the device with the file's contents. Speaking recordings stay
   behind (too big); their marks and feedback are included. */
const BK = (en, zh) => (LANG === 'zh' ? zh : en);
// Backups hold every child on this device (books, questions, progress, settings), but never the parent PIN.
const BK_SKIP = ['pin', 'pinAt', 'pinLock'];
const bkLocal = (l) => { const o = { ...l }; BK_SKIP.forEach((k) => delete o[k]); return o; };
const idbKeep = (k, v) => !String(k).startsWith('spaud:') && v !== null && v !== undefined && !(typeof Blob !== 'undefined' && v instanceof Blob);
function idbOpen(name) {
  return new Promise((resolve, reject) => { try { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); } catch (e) { reject(e); } });
}
// everything in another child's database (the current child's goes through store, which caches it)
async function idbAll(name) {
  const db = await idbOpen(name);
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readonly'), st = t.objectStore('kv'), kr = st.getAllKeys(), vr = st.getAll();
      t.oncomplete = () => { const o = {}; kr.result.forEach((k, i) => { if (idbKeep(k, vr.result[i])) o[k] = vr.result[i]; }); resolve(o); };
      t.onerror = t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}
// one transaction: either every value is written or none is
async function idbPutAll(name, entries) {
  const db = await idbOpen(name);
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readwrite'), st = t.objectStore('kv');
      st.clear(); for (const [k, v] of Object.entries(entries)) st.put(v, k);
      t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error || new Error('write failed'));
    });
  } finally { db.close(); }
}
const idbDrop = (name) => new Promise((r) => { try { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); } catch (e) { r(); } });
async function backupFile() {
  const children = [];
  for (const k of KIDS.list) {
    let l, db;
    if (k.id === KID.id) {
      local.backupAt = Date.now(); saveLocal(); l = local;
      const ks = await store.keys(''), vals = await store.getMany(ks, null); db = {};
      ks.forEach((key, i) => { if (idbKeep(key, vals[i])) db[key] = vals[i]; });
    } else {
      try { l = JSON.parse(localStorage.getItem(k.key)) || {}; } catch (e) { l = {}; }
      try { db = await idbAll(k.db); } catch (e) { db = {}; }
    }
    children.push({ meta: { name: k.name || '', nick: k.nick || '', grade: k.grade || '', av: k.av || 0, cur: k.id === KID.id }, local: bkLocal(l), db });
  }
  const data = { app: 'prepbuddy', v: 2, at: new Date().toISOString(), ui: (() => { try { return localStorage.getItem('prepbuddy.ui'); } catch (e) { return null; } })(), children };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const who = KIDS.list.length > 1 ? `${KIDS.list.length} children ` : (local.name || '').trim() ? local.name.trim() + ' ' : '';
  const name = `PrepBuddy backup ${who}${ymd(Date.now())}.json`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return blob.size;
}
async function restoreFile(file) {
  const bad = () => new Error(BK('That file isn’t a PrepBuddy backup, or it is damaged.', '這個檔案不是 PrepBuddy 備份，或者已損壞。'));
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw bad(); }
  if (!data || data.app !== 'prepbuddy' || isNaN(Date.parse(data.at))) throw bad();
  // v1 files (before November 2026) hold one child: they replace the child using the app now
  const whole = data.v >= 2;
  const children = whole ? data.children : [{ meta: null, local: data.local, db: data.db }];
  const okChild = (c) => c && c.local && typeof c.local === 'object' && c.local.stats && typeof c.local.stats === 'object' && Array.isArray(c.local.log) && c.db && typeof c.db === 'object' && !Array.isArray(c.db);
  if (!Array.isArray(children) || !children.length || children.length > 6 || !children.every(okChild)) throw bad();
  const when = new Date(data.at).toLocaleString(LOCALE(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const names = children.map((c) => (c.meta && (c.meta.nick || c.meta.name)) || c.local.name || '').filter(Boolean).join(', ');
  const ok = await confirmLeave({ title: whole ? BK('Replace everything on this device?', '取代這部裝置上的所有資料？') : BK(`Replace ${kidLabel(KID)}’s progress?`, `取代${kidLabel(KID)}的進度？`),
    body: BK(`This backup is from ${when}${names ? ` (${names})` : ''}. ${whole ? 'Every child’s books and progress on this device now' : 'This child’s books and progress on this device now'} will be replaced by it.`,
      `這個備份來自 ${when}${names ? `（${names}）` : ''}。${whole ? '這部裝置上所有孩子現在的課本和進度' : '這個孩子現在的課本和進度'}會被備份取代。`),
    stay: BK('Cancel', '取消'), leave: BK('Restore', '還原') });
  if (!ok) return false;
  if (local.pin && !(await askPin(BK('Enter the parent PIN to restore a backup.', '輸入家長密碼以還原備份。')))) return false;
  // Write the backup into new storage first; only when all of it is saved does the old data go.
  const stamp = Date.now().toString(36), keep = {}, dflt = {};
  ['pin', 'pinAt'].forEach((k) => { if (local[k] !== undefined) keep[k] = local[k]; });
  KID_SHARED.forEach((k) => { if (local[k] !== undefined) dflt[k] = local[k]; }); // family code, consent… when the backup has none
  const made = children.map((c, i) => { const id = `k${stamp}${i}`; return { id, key: `prepbuddy.v2:${id}`, db: `prepbuddy:${id}`, av: c.meta ? c.meta.av || 0 : KID.av || 0, name: (c.meta && c.meta.name) || (c.local.name || '').slice(0, 20), nick: (c.meta && c.meta.nick) || (whole ? '' : KID.nick || ''), grade: (c.meta && c.meta.grade) || '' }; });
  const undo = async () => { for (const m of made) { try { localStorage.removeItem(m.key); } catch (e) {} await idbDrop(m.db); } };
  try {
    for (let i = 0; i < made.length; i++) {
      await idbPutAll(made[i].db, children[i].db);
      localStorage.setItem(made[i].key, JSON.stringify({ ...dflt, ...bkLocal(children[i].local), ...keep }));
    }
  } catch (e) {
    await undo();
    throw new Error(BK('Couldn’t restore: this device may be out of storage space. Nothing was changed.', '未能還原：這部裝置的儲存空間可能不足。資料沒有改變。'));
  }
  const old = whole ? KIDS.list.slice() : [KID];
  const curIdx = Math.max(0, children.findIndex((c) => c.meta && c.meta.cur));
  if (whole) { KIDS.list = made; KIDS.cur = made[curIdx].id; } else { KIDS.list = KIDS.list.map((k) => (k.id === KID.id ? made[0] : k)); KIDS.cur = made[0].id; }
  kidSave(); kidPicked(KIDS.cur);
  WIPING = true; // the old child's data is about to go: nothing may write it back
  await store.close();
  for (const k of old) { try { localStorage.removeItem(k.key); } catch (e) {} await idbDrop(k.db); }
  try { if (data.ui) localStorage.setItem('prepbuddy.ui', data.ui); } catch (e) {}
  location.replace(location.pathname + location.search);
  return true;
}

/* ---------- stars and rewards (for younger students; parents set the rewards) ----------
   Stars reward effort and learning, never speed: finishing a set, a good score, fixing mistakes, daily reviews,
   the weekly goal, chapter tests and badges. Everyday stars are capped per day; stars are never taken away for
   wrong answers. The child spends them in the Star shop on rewards a parent set up, and a parent approves each
   one on the spot with a 4-digit PIN. Everything is kept on this device. */
const ST = (en, zh) => (LANG === 'zh' ? zh : en);
const DAY_CAP = 10;
const looksPrimary = (b) => /\bP\.?\s?[1-6]\b|primary|小[一二三四五六]|小學|初小|高小/i.test(`${b.title || ''} ${b.level || ''}`);
let primaryCache = null;
function starsOn() {
  if (!cap('stars')) return false;
  if (local.starsOn === true || local.starsOn === false) return local.starsOn;
  return isPrimaryKid();
}
function starState() {
  local.stars = local.stars || { bal: 0, total: 0, log: [], badges: {}, rewards: null, saving: null, redeemed: [], day: null };
  const s = local.stars;
  if (!s.rewards) s.rewards = defaultRewards();
  return s;
}
function defaultRewards() {
  const zh = LANG === 'zh';
  return [
    ['📱', zh ? '30 分鐘 iPad 時間' : '30 min iPad time', 20],
    ['🍦', zh ? '雪糕一杯' : 'Ice cream treat', 30],
    ['🍕', zh ? '選星期五晚餐' : 'Pick Friday dinner', 40],
    ['🎬', zh ? '家庭電影夜' : 'Family movie night', 60],
    ['🧸', zh ? '去玩具店' : 'Trip to the toy shop', 100],
  ].map(([icon, name, cost]) => ({ id: uid(), icon, name, cost }));
}
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Adds stars; everyday stars respect the daily cap. Returns how many were added.
function addStars(n, why, capped = true) {
  if (!starsOn() || n <= 0) return 0;
  const s = starState(), today = dayStart();
  if (!s.day || s.day.d !== today) s.day = { d: today, n: 0, once: {} };
  if (capped) n = Math.max(0, Math.min(n, DAY_CAP - s.day.n));
  if (!n) return 0;
  if (capped) { s.day.n += n; if (s.day.n >= DAY_CAP && !s.day.hit) { s.day.hit = 1; s.capDays = (s.capDays || 0) + 1; } }
  s.bal += n; s.total += n;
  s.log.push({ t: Date.now(), n, why });
  if (s.log.length > 400) s.log = s.log.slice(-400);
  saveLocal();
  return n;
}
const onceToday = (key) => { const s = starState(), today = dayStart(); if (!s.day || s.day.d !== today) s.day = { d: today, n: 0, once: {} }; s.day.once = s.day.once || {}; if (s.day.once[key]) return false; s.day.once[key] = 1; return true; };

const BADGES = [
  { id: 'first', icon: '🌱', en: 'First steps', zh: '踏出第一步', den: 'Finish your first practice set', dzh: '完成第一組練習', stars: 5, test: (c) => c.sets >= 1 },
  { id: 'q100', icon: '💯', en: '100 questions', zh: '100 題', den: 'Answer 100 questions', dzh: '答 100 題', stars: 5, test: (c) => c.answered >= 100 },
  { id: 'streak3', icon: '🔥', en: '3 days in a row', zh: '連續 3 日', den: 'Practise 3 days in a row', dzh: '連續練習 3 日', stars: 5, test: (c) => c.streak >= 3 },
  { id: 'streak7', icon: '🏅', en: '7-day streak', zh: '連續 7 日', den: 'Practise 7 days in a row', dzh: '連續練習 7 日', stars: 10, test: (c) => c.streak >= 7 },
  { id: 'fix10', icon: '🛠️', en: 'Mistake fixer', zh: '改錯高手', den: 'Fix 10 mistakes', dzh: '改正 10 題錯題', stars: 5, test: (c) => c.fixed >= 10 },
  { id: 'perfect', icon: '🌟', en: 'Perfect set', zh: '全對', den: 'Get every question right in a set of 5 or more', dzh: '一組 5 題或以上全部答對', stars: 5, test: (c) => c.perfect },
  { id: 'test', icon: '🎓', en: 'Test passed', zh: '測驗合格', den: 'Pass a chapter test', dzh: '通過章節測驗', stars: 10, test: (c) => c.testsPassed >= 1 },
  { id: 'goal', icon: '🎯', en: 'Goal getter', zh: '目標達成', den: 'Reach your weekly goal', dzh: '達成每週目標', stars: 5, test: (c) => c.goalWeeks >= 1 },
  { id: 'q500', icon: '🚀', en: '500 questions', zh: '500 題', den: 'Answer 500 questions', dzh: '答 500 題', stars: 15, test: (c) => c.answered >= 500 },
];
function badgeCounts(extra = {}) {
  const s = starState();
  const days = new Set(local.log.map((e) => dayStart(e.t)));
  let streak = 0; for (let d = days.has(dayStart()) ? dayStart() : dayStart() - DAY; days.has(d); d -= DAY) streak++;
  return {
    sets: (s.sets || 0), answered: Math.max(0, Object.values(local.stats).reduce((a, x) => a + (x.seen || 0), 0) - (s.rushedQ || 0)), streak,
    fixed: Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && m.earned !== 0 && (m.earned || !m.doneAt || m.doneAt < STAR_RULES_AT)).length,
    perfect: !!extra.perfect, testsPassed: (local.tests || []).filter((t) => t.kind === 'test' && t.m && t.g / t.m >= 0.8).length,
    goalWeeks: Object.keys(s.goalWeeks || {}).length,
  };
}
// New badges earned now (each also gives its stars, outside the daily cap).
function checkBadges(extra) {
  if (!starsOn()) return [];
  const s = starState(), c = badgeCounts(extra), won = [];
  for (const b of BADGES) if (!s.badges[b.id] && b.test(c)) { s.badges[b.id] = Date.now(); addStars(b.stars, 'badge:' + b.id, false); won.push(b); }
  if (won.length) saveLocal();
  return won;
}

// Stars for a finished set (called once, from the results screen).
const STAR_PASS = 50, RUSH_SECS = 4, STAR_RULES_AT = Date.UTC(2026, 10, 12, 12);
// The score used for stars only counts marks the child can't give themselves: choice questions and AI-marked
// written answers (using the AI's own marks, not ticks changed afterwards). Self-ticked answers still show in results.
function starScore(qs) {
  let g = 0, m = 0;
  qs.forEach((q, k) => {
    if (choiceType(q)) { g += S.got[k] || 0; m += marksOf(q); return; }
    const mk = S.marks && S.marks[k];
    if (mk && mk.essay && q.type === 'essay') { g += mk.total || 0; m += marksOf(q); return; }
    if (mk && mk.parts) { g += (q.parts || []).reduce((a, p, j) => a + Math.min(p.marks, ((mk.parts[j] || {}).awarded || []).length), 0); m += marksOf(q); }
  });
  return m ? Math.round(100 * g / m) : null;
}
// A set counts as rushed when most of it is choice questions and the typical (median) time per answer is under RUSH_SECS.
function rushedSet(qs) {
  if (!S || !S.times || !qs.length) return false;
  const choice = qs.filter((q) => choiceType(q)).length;
  if (choice < qs.length * 0.6) return false;
  const ts = [S.at, ...S.times].slice(0, qs.length + 1), gaps = [];
  for (let k = 1; k < ts.length; k++) gaps.push((ts[k] - ts[k - 1]) / 1000);
  if (gaps.length < 3) return false;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] < RUSH_SECS;
}
function awardSession(qs, pct) {
  if (!starsOn() || !S || S.starred || S.endedEarly || !qs.length) return null;
  S.starred = true;
  const s = starState(), lines = [];
  let n = 0;
  const add = (k, why, label) => { const got = addStars(k, why); if (got) { n += got; lines.push([label, got]); } };
  // Stars are for real effort: a set that was rushed (tapping through choice questions in a few seconds each)
  // or scored under half earns no set star. Fixing mistakes and passing tests still need right answers.
  const rushed = rushedSet(qs), sp = starScore(qs), trusted = sp !== null;
  pct = trusted ? sp : 0;
  const passed = !trusted || pct >= STAR_PASS; // a set of only self-marked answers still earns the effort star
  if (rushed) s.rushedQ = (s.rushedQ || 0) + qs.length;
  if (qs.length >= 3 && passed && !rushed) { s.sets = (s.sets || 0) + 1; add(1, 'set', ST('Finished a set', '完成一組練習')); }
  if (qs.length >= 5 && trusted && pct >= 80 && !rushed) add(1, 'score', ST('Scored 80% or more', '得分 80% 或以上'));
  S.starNote = qs.length < 3 ? '' : rushed
    ? ST('No stars for this set: the answers came too fast. Take your time to read each question and stars come back.', '這組沒有星星：答得太快了。慢慢讀清楚每一題，就可以再賺星星。')
    : !passed ? ST(`Score ${STAR_PASS}% or more to earn a star for a set. Fix the ones you missed and try again!`, `得分 ${STAR_PASS}% 或以上才可以賺到星星。改正錯題再試一次吧！`) : '';
  if (S.fixedNow) add(S.fixedNow, 'fix', ST(`Fixed ${S.fixedNow} mistake${S.fixedNow > 1 ? 's' : ''}`, `改正了 ${S.fixedNow} 題錯題`));
  if (S.mode === 'spaced' && !rushed && onceToday('reviews')) add(1, 'reviews', ST('Did today’s reviews', '完成今日溫習'));
  if (S.test && trusted && pct >= 80) {
    // Test stars: once per chapter per day, so retaking the same test doesn't keep paying out.
    const key = `${S.book ? S.book.id : ''}:${S.title || ''}`;
    s.testDays = s.testDays || {};
    if (s.testDays[key] !== dayStart()) { s.testDays[key] = dayStart(); const g = addStars(3, 'test', false); if (g) { n += g; lines.push([ST('Passed the chapter test', '通過章節測驗'), g]); } }
  }
  // weekly goal reached (once per week)
  const G = typeof goalWeek === 'function' ? goalWeek() : null;
  if (G && G.reached) {
    s.goalWeeks = s.goalWeeks || {};
    const wk = String(G.week[0].t);
    if (!s.goalWeeks[wk]) { s.goalWeeks[wk] = 1; const g = addStars(5, 'goal', false); if (g) { n += g; lines.push([ST('Reached your weekly goal!', '達成每週目標！'), g]); } }
  }
  const capped = s.day && s.day.n >= DAY_CAP;
  const badges = checkBadges({ perfect: qs.length >= 5 && trusted && pct === 100 && !rushed });
  saveLocal();
  return n || badges.length ? { n: n + badges.reduce((a, b) => a + b.stars, 0), lines, badges, capped } : (capped ? { n: 0, lines: [], badges: [], capped } : null);
}

function starSVG(size = 18) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="#FFC531" stroke="#E0A100" stroke-width="1.2" stroke-linejoin="round"/></svg>`; }
function starChip() { return starsOn() ? `<button class="starchip" data-stargo aria-label="${ST(`${starState().bal} stars. Open the Star shop`, `${starState().bal} 粒星。打開星星商店`)}">${starSVG(18)}<b>${starState().bal}</b><span class="sc-lbl">${ST('Star shop', '星星商店')}</span></button>` : ''; }
// One click handler for every star counter on any screen (menu, Today, Progress), so none can be left unwired.
function bindStarChips() {}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-stargo]');
  if (!b) return;
  e.preventDefault();
  const q = inSession();
  if (q && !(await confirmLeave(leaveText(q.dataset.kind, true)))) return;
  go({ name: 'stars' });
});

// Celebration: stars fly in, Buddy cheers, new badges shown.
function celebrate(won) {
  if (!won) return;
  const box = document.createElement('div');
  box.className = 'cdlg-wrap star-cel';
  const conf = Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${(i % 9) * 0.07}s;background:${['#FFC531', '#FF7A59', '#4CC38A', '#5B8DEF', '#B57AF0'][i % 5]}"></i>`).join('');
  // the next reward to aim for: the one being saved for, else the cheapest one not yet affordable
  const st = starState(), rw = (st.rewards || []).filter((r) => r && r.cost);
  let goal = rw.find((r) => r.id === st.saving) || rw.filter((r) => r.cost > st.bal).sort((x, y) => x.cost - y.cost)[0] || null;
  const was = Math.max(0, st.bal - (won.n || 0));
  // the reward card: the one the child is saving for (or the cheapest they can't get yet). "Change" lets them pick another.
  const goalHTML = (g, anim) => !g ? `<span>${ST('You have', '你現在有')} <b>${st.bal}</b> ${starSVG(18)}</span>` : `<div class="sc2-goal"><span class="sc2-gi">${esc(g.icon || '🎁')}</span><div><b>${st.bal >= g.cost ? ST(`You can get ${g.name}!`, `可以換「${g.name}」了！`) : ST(`${g.cost - st.bal} more to ${g.name}`, `再儲 ${g.cost - st.bal} 粒換「${g.name}」`)}</b>
      <div class="sc2-bar"><i style="width:${Math.min(100, Math.round(100 * (anim ? was : st.bal) / g.cost))}%" data-to="${Math.min(100, Math.round(100 * st.bal / g.cost))}"></i></div><small>${starSVG(13)} ${st.bal} / ${g.cost}${st.saving === g.id ? ` · ${ST('Saving for this', '正在儲')}` : ''}</small></div>
      ${rw.length > 1 ? `<button class="btn-sm quiet sc2-chg" id="sc-chg">${ST('Change', '更改')}</button>` : ''}</div>`;
  const pickHTML = () => `<div class="sc2-pick"><small>${ST('Which reward are you saving for?', '你想儲星換甚麼？')}</small><div>${rw.map((r) => `<button class="${(goal && goal.id === r.id) ? 'on' : ''}" data-pick="${esc(r.id)}"><i>${esc(r.icon || '🎁')}</i><span>${esc(r.name)}</span><em>${starSVG(12)} ${r.cost}</em></button>`).join('')}</div></div>`;
  const rays = Array.from({ length: 12 }, (_, i) => `<i style="transform:rotate(${i * 30}deg)"></i>`).join('');
  const fly = Array.from({ length: Math.min(8, Math.max(3, won.n || 3)) }, (_, i) => `<span style="--a:${-70 + i * (140 / Math.max(1, Math.min(8, Math.max(3, won.n || 3)) - 1))}deg;--d:${(0.15 + i * 0.06).toFixed(2)}s">${starSVG(18)}</span>`).join('');
  box.innerHTML = `<div class="confetti" aria-hidden="true">${conf}</div><div class="cdlg sc-card sc2" role="dialog" aria-modal="true" aria-labelledby="sc-t" data-raw>
    <div class="sc2-top"><div class="sc2-rays" aria-hidden="true">${rays}</div><div class="sc2-fly" aria-hidden="true">${fly}</div>
      <div class="sc2-star" aria-hidden="true">${starSVG(92)}</div><div class="sc2-bud" aria-hidden="true">${buddySVG('happy', 58)}</div></div>
    ${won.n ? `<b id="sc-t" class="sc-big sc2-big"><span>+<span id="sc-n">0</span></span> ${ST(won.n === 1 ? 'star' : 'stars', '粒星')}</b>` : `<b id="sc-t" class="sc-big sc2-big">${ST('Great work!', '做得好！')}</b>`}
    ${won.lines.length ? `<div class="sc2-lines">${won.lines.map(([l, k]) => `<div><span class="sc2-ic">${starSVG(16)}</span><span>${esc(l)}</span><b>+${k}</b></div>`).join('')}</div>` : ''}
    ${won.badges.length > 2 ? `<div class="sc2-badges"><small>${ST(`${won.badges.length} new badges!`, `${won.badges.length} 個新徽章！`)}</small><div>${won.badges.map((b) => `<span title="${esc(ST(b.den, b.dzh))}"><i>${b.icon}</i><b>${esc(ST(b.en, b.zh))}</b><em>+${b.stars} ★</em></span>`).join('')}</div></div>`
      : won.badges.map((b) => `<div class="sc-badge"><span>${b.icon}</span><div><small>${ST('New badge!', '新徽章！')}</small><b>${esc(ST(b.en, b.zh))}</b><span>${esc(ST(b.den, b.dzh))} · +${b.stars} ★</span></div></div>`).join('')}
    ${won.capped ? `<p class="sc-cap">${ST('That’s all the stars for today. Come back tomorrow for more!', '今日的星星已經全部拿到，明天再來吧！')}</p>` : ''}
    <div class="sc2-bal" id="sc-goal">${goalHTML(goal, true)}</div>
    <div class="rd-row"><button class="btn ghost" id="sc-shop">${ST('Star shop', '星星商店')}</button><button class="btn" id="sc-ok">${ST('Yay!', '好呀！')}</button></div>
  </div>`;
  // count the stars up and fill the bar towards the reward
  setTimeout(() => { const n = box.querySelector('#sc-n'); if (n && won.n) { let k = 0; const step = () => { k++; n.textContent = k; if (k < won.n) setTimeout(step, Math.max(60, 400 / won.n)); }; step(); }
    const bar = box.querySelector('.sc2-bar i'); if (bar) bar.style.width = bar.dataset.to + '%'; }, 450);
  document.body.appendChild(box);
  const gbox = box.querySelector('#sc-goal');
  const wireGoal = () => { const c = gbox.querySelector('#sc-chg'); if (c) c.onclick = () => { gbox.innerHTML = pickHTML();
    gbox.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { st.saving = b.dataset.pick; saveLocal(); goal = rw.find((r) => r.id === st.saving); gbox.innerHTML = goalHTML(goal); wireGoal(); })); }; };
  if (gbox) wireGoal();
  const close = () => box.remove();
  box.querySelector('#sc-ok').onclick = close;
  box.querySelector('#sc-shop').onclick = () => { close(); go({ name: 'stars' }); };
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('#sc-ok').focus();
}

// Parent PIN: set the first time a parent opens the parent area or approves a reward.
function askPin(purpose) {
  return new Promise((resolve) => {
    const has = !!local.pin;
    const box = document.createElement('div');
    box.className = 'cdlg-wrap';
    box.innerHTML = `<div class="cdlg rdlg pin-dlg" role="dialog" aria-modal="true" aria-labelledby="pn-t" data-raw>
      <b id="pn-t">${has ? ST('Parent PIN', '家長密碼') : ST('Set a parent PIN', '設定家長密碼')}</b>
      <span>${esc(purpose)}</span>
      <input id="pn-in" class="input pin-in" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]*" placeholder="••••" aria-label="${ST('4-digit PIN', '4 位數密碼')}">
      ${has ? '' : `<input id="pn-in2" class="input pin-in" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]*" placeholder="${ST('Again', '再輸入一次')}" aria-label="${ST('Repeat the PIN', '再輸入密碼')}"><span class="hint">${ST('Only parents should know this. It’s needed to approve rewards and change them.', '只有家長應該知道這個密碼，批准和修改獎勵時需要用到。')}</span>`}
      <p class="pin-err" id="pn-err" role="alert"></p>
      <div class="rd-row"><button class="btn ghost" id="pn-no">${ST('Cancel', '取消')}</button><button class="btn" id="pn-ok">${ST('OK', '確定')}</button></div>
    </div>`;
    document.body.appendChild(box);
    const inp = box.querySelector('#pn-in'), err = box.querySelector('#pn-err');
    const done = (v) => { box.remove(); resolve(v); };
    box.querySelector('#pn-no').onclick = () => done(false);
    const ok = () => {
      const v = inp.value.trim();
      if (!/^\d{4}$/.test(v)) { err.textContent = ST('Enter 4 digits.', '請輸入 4 位數字。'); return; }
      if (has) {
        const L = local.pinLock || (local.pinLock = { n: 0, until: 0 });
        if (L.until > Date.now()) { err.textContent = ST(`Too many tries. Wait ${Math.ceil((L.until - Date.now()) / 60000)} min.`, `試太多次了，請等 ${Math.ceil((L.until - Date.now()) / 60000)} 分鐘。`); inp.value = ''; return; }
        if (v === local.pin) { L.n = 0; saveLocal(); return done(true); }
        L.n++; if (L.n >= 5) { L.n = 0; L.until = Date.now() + 10 * 60000; } saveLocal();
        err.textContent = ST('That PIN isn’t right.', '密碼不正確。'); inp.value = ''; return;
      }
      if (v !== box.querySelector('#pn-in2').value.trim()) { err.textContent = ST('The two PINs don’t match.', '兩次輸入的密碼不一樣。'); return; }
      local.pin = v; local.pinAt = Date.now(); saveLocal(); done(true);
    };
    box.querySelector('#pn-ok').onclick = ok;
    box.querySelectorAll('.pin-in').forEach((x) => (x.onkeydown = (e) => { if (e.key === 'Enter') ok(); }));
    inp.focus();
  });
}

function renderStars(parent = false) {
  const s = starState(), zh = LANG === 'zh';
  const saving = s.rewards.find((r) => r.id === s.saving) || null;
  const weekAgo = Date.now() - 7 * DAY;
  const thisWeek = s.log.filter((x) => x.t > weekAgo).reduce((a, x) => a + x.n, 0);
  const fmt = (t) => new Date(t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' });
  const rewardCard = (r) => {
    const can = s.bal >= r.cost, pct = Math.min(100, Math.round(100 * s.bal / r.cost));
    return `<div class="rw ${can ? 'can' : ''} ${s.saving === r.id ? 'saving' : ''}">
      <span class="rw-ic" aria-hidden="true">${esc(r.icon)}</span>
      <b class="rw-n">${esc(r.name)}</b>
      <span class="rw-c">${starSVG(16)} ${r.cost}</span>
      ${can ? `<button class="btn rw-go" data-get="${r.id}">${ST('Get it!', '換領！')}</button>`
        : `<div class="pg-bar mid"><i style="width:${pct}%"></i></div><span class="rw-left">${ST(`${r.cost - s.bal} more`, `還差 ${r.cost - s.bal} 粒`)}</span>
           <button class="btn-sm ${s.saving === r.id ? '' : 'quiet'}" data-save="${r.id}">${s.saving === r.id ? ST('Saving for this ✓', '正在儲 ✓') : ST('Save for this', '儲星換這個')}</button>`}
    </div>`;
  };
  $app.innerHTML = `
  ${backTop({name:'progress'}, 'Back')}
  <main class="pad stack g18 starpage" data-view="stars" data-raw style="flex:1">
    <h1 class="pagetitle">${ST('Star shop', '星星商店')}</h1>
    ${!starsOn() ? `<div class="card" style="padding:16px;line-height:1.5">${ST('Stars are switched off. Turn them on in Settings.', '星星功能已關閉，可在設定中開啟。')}</div>` : ''}
    <section class="st-hero">
      <div class="st-bal">${starSVG(46)}<div><b>${s.bal}</b><span>${ST('stars to spend', '粒星星可以用')}</span></div></div>
      <div class="st-meta"><span>${ST(`${thisWeek} earned this week`, `本週賺了 ${thisWeek} 粒`)}</span><span>${ST(`${s.total} earned in total`, `累計 ${s.total} 粒`)}</span></div>
      ${saving ? `<div class="st-save"><span>${ST('Saving for', '正在儲')}: <b>${esc(saving.icon)} ${esc(saving.name)}</b></span><div class="pg-bar good"><i style="width:${Math.min(100, Math.round(100 * s.bal / saving.cost))}%"></i></div><small>${s.bal >= saving.cost ? ST('You have enough! Ask Mum or Dad.', '星星夠了！去問爸爸媽媽吧。') : ST(`${saving.cost - s.bal} more stars to go!`, `還差 ${saving.cost - s.bal} 粒星！`)}</small></div>` : ''}
    </section>
    <section class="stack g10"><h2 class="st-h">${ST('Rewards', '獎勵')}</h2>
      <div class="rw-grid">${s.rewards.slice().sort((a, b) => a.cost - b.cost).map(rewardCard).join('') || `<p class="muted">${ST('No rewards yet. Ask a parent to add some.', '還沒有獎勵，請家長加入。')}</p>`}</div>
    </section>
    <section class="stack g10"><h2 class="st-h">${ST('How to earn stars', '怎樣賺星星')}</h2>
      <div class="st-earn">${[
        ['📘', ST(`Finish a practice set with ${STAR_PASS}% or more`, `完成一組練習並得 ${STAR_PASS}% 或以上`), 1], ['🎯', ST('Score 80% or more', '得分 80% 或以上'), '+1'], ['🛠️', ST('Fix a mistake from an earlier day', '改正之前的錯題'), 1],
        ['🔁', ST('Do today’s reviews', '完成今日溫習'), 1], ['🏆', ST('Reach your weekly goal', '達成每週目標'), 5], ['🎓', ST('Pass a chapter test (once a day per chapter)', '通過章節測驗（每章每日一次）'), 3], ['✍️', ST('Get writing marked (80+ words)', '寫作批改（80 字以上）'), '2–3'], ['🎤', ST('Speak for 30 seconds or more', '說話 30 秒或以上'), 2], ['📝', ST('Dictation with half or more right', '默書答對一半或以上'), 1]]
        .map(([i, t, n]) => `<div><span>${i}</span><span>${t}</span><b>${n} ★</b></div>`).join('')}</div>
      <p class="hint">${ST(`Up to ${DAY_CAP} stars a day from practice. Badges and goals give extra. Rushing through answers earns no stars.`, `練習每日最多可賺 ${DAY_CAP} 粒星，徽章和目標另有獎勵。亂答一通不會賺到星星。`)}</p>
    </section>
    <section class="stack g10"><h2 class="st-h">${ST('Badges', '徽章')}</h2>${badgeShelf()}</section>
    ${s.redeemed.length ? `<section class="stack g10"><h2 class="st-h">${ST('Rewards you got', '已換領的獎勵')}</h2><div class="st-hist">${s.redeemed.slice().reverse().slice(0, 8).map((x) => `<div><span>${esc(x.icon || '🎁')}</span><span>${esc(x.name)}</span><small>${fmt(x.t)} · ${x.cost} ★</small></div>`).join('')}</div></section>` : ''}
    <button class="btn-sm quiet" id="st-parent" style="align-self:center">🔒 ${ST('For parents: change rewards', '家長專區：修改獎勵')}</button>
  </main>`;
  $app.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => { s.saving = s.saving === b.dataset.save ? null : b.dataset.save; saveLocal(); renderStars(); }));
  $app.querySelectorAll('[data-get]').forEach((b) => (b.onclick = async () => {
    const r = s.rewards.find((x) => x.id === b.dataset.get); if (!r || s.bal < r.cost) return;
    if (!local.pin) { toast(ST('A parent needs to set a PIN first, in the Parent dashboard.', '家長要先在家長主頁設定密碼。')); return; }
    if (!(await askPin(ST(`Ask Mum or Dad! ${r.icon} ${r.name} costs ${r.cost} stars. A parent enters the PIN to say yes.`, `去問爸爸媽媽！${r.icon} ${r.name}需要 ${r.cost} 粒星。家長輸入密碼即表示批准。`)))) return;
    s.bal -= r.cost; s.redeemed.push({ t: Date.now(), id: r.id, name: r.name, icon: r.icon, cost: r.cost });
    if (s.saving === r.id) s.saving = null;
    saveLocal(); renderStars();
    celebrate({ n: 0, lines: [], badges: [], capped: false });
    const t = document.querySelector('.star-cel #sc-t'); if (t) t.textContent = ST(`Enjoy: ${r.icon} ${r.name}!`, `好好享受：${r.icon} ${r.name}！`);
  }));
  document.getElementById('st-parent').onclick = async () => { if (await askPin(ST('Enter the parent PIN to change rewards.', '輸入家長密碼以修改獎勵。'))) rewardEditor(); };
  bindStarChips();
  window.scrollTo(0, 0);
}
function badgeShelf() {
  const s = starState();
  return `<div class="badges">${BADGES.map((b) => { const got = s.badges[b.id]; return `<div class="bdg ${got ? 'got' : ''}" title="${esc(ST(b.den, b.dzh))}"><span>${b.icon}</span><b>${esc(ST(b.en, b.zh))}</b><small>${got ? new Date(got).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' }) : esc(ST(b.den, b.dzh))}</small></div>`; }).join('')}</div>`;
}
function rewardEditor() {
  const s = starState();
  const ICONS = ['📱', '🎮', '🍦', '🍕', '🎬', '🧸', '📚', '🏊', '🎨', '🛝', '🍰', '🎁'];
  const row = (r) => `<div class="re-row" data-id="${r.id}">
    <select class="input re-ic" aria-label="${ST('Icon', '圖示')}">${ICONS.map((i) => `<option ${i === r.icon ? 'selected' : ''}>${i}</option>`).join('')}</select>
    <input class="input re-n" value="${esc(r.name)}" maxlength="40" aria-label="${ST('Reward', '獎勵')}">
    <input class="input re-c" type="number" min="1" max="999" value="${r.cost}" aria-label="${ST('Stars', '星星')}">
    <button class="btn-sm quiet re-del" aria-label="${ST('Remove', '刪除')}">✕</button></div>`;
  const box = document.createElement('div');
  box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg rdlg re-dlg" role="dialog" aria-modal="true" aria-labelledby="re-t" data-raw>
    <b id="re-t">${ST('Rewards (for parents)', '獎勵（家長專用）')}</b>
    <span>${ST('Choose rewards your child can save stars for, and how many stars each costs. About 8–10 stars is a good day of practice.', '選擇孩子可以儲星換領的獎勵和所需星星數目。一日認真練習大約可賺 8 至 10 粒星。')}</span>
    <div class="re-list">${s.rewards.map(row).join('')}</div>
    <button class="btn-sm" id="re-add" style="align-self:flex-start">+ ${ST('Add a reward', '加入獎勵')}</button>
    <div class="re-more"><button class="btn-sm quiet" id="re-pin">${ST('Change PIN', '更改密碼')}</button><span class="hint">${ST(`Balance ${s.bal} ★ · ${s.redeemed.length} rewards given`, `餘額 ${s.bal} 粒 · 已換領 ${s.redeemed.length} 次`)}</span></div>
    <div class="rd-row"><button class="btn ghost" id="re-no">${ST('Cancel', '取消')}</button><button class="btn" id="re-ok">${ST('Save', '儲存')}</button></div>
  </div>`;
  document.body.appendChild(box);
  const list = box.querySelector('.re-list');
  const bindDel = () => list.querySelectorAll('.re-del').forEach((b) => (b.onclick = () => b.closest('.re-row').remove()));
  bindDel();
  box.querySelector('#re-add').onclick = () => { list.insertAdjacentHTML('beforeend', row({ id: uid(), icon: '🎁', name: '', cost: 20 })); bindDel(); list.lastElementChild.querySelector('.re-n').focus(); };
  box.querySelector('#re-no').onclick = () => box.remove();
  box.querySelector('#re-pin').onclick = async () => { const old = local.pin; local.pin = ''; const ok = await askPin(ST('Choose a new 4-digit PIN.', '設定新的 4 位數密碼。')); if (!ok) { local.pin = old; } saveLocal(); };
  box.querySelector('#re-ok').onclick = () => {
    s.rewards = [...list.querySelectorAll('.re-row')].map((x) => ({ id: x.dataset.id, icon: x.querySelector('.re-ic').value, name: x.querySelector('.re-n').value.trim().slice(0, 40), cost: Math.max(1, Math.min(999, parseInt(x.querySelector('.re-c').value, 10) || 0)) })).filter((r) => r.name);
    if (s.saving && !s.rewards.some((r) => r.id === s.saving)) s.saving = null;
    saveLocal(); box.remove(); renderStars();
  };
}

/* ---------- tab bar ---------- */
const TABS = [['home', 'Today', 'today'], ['books', 'Books', 'books'], ['practice', 'Practice', 'practice'], ['progress', 'Progress', 'chart'], ['settings', 'Settings', 'gear']]; // the Mistake book is a block on Practice
let tabNow = null;
function renderTabs(active = tabNow) {
  tabNow = active;
  const nav = document.getElementById('tabs');
  if (!active) { delete document.body.dataset.tab; return; }
  document.body.dataset.tab = active;
  const mk = mistakeCount();
  nav.innerHTML = `<span class="brand-side">${logoSVG(30)}<span>PrepBuddy</span></span><div class="tabs-in">${TABS.map(([k, label, ic]) => `<button class="${k === active ? 'on' : ''}" data-tabgo="${k}" ${k === active ? 'aria-current="page"' : ''}>${menuIcon(k, k === active)}<span>${label}</span>${k === 'practice' && mk ? `<span class="badge">${mk > 99 ? '99+' : mk}</span>` : ''}</button>`).join('')}</div>${planId() !== 'pro' ? `<button class="side-up" id="sideUp"><span class="plan-pill ${planId()}">${PL(curPlan().name, curPlan().zh)}</span><b>${PL('Upgrade', '升級')} →</b></button>` : ''}`;
  bindStarChips(nav);
  { const su = nav.querySelector('#sideUp'); if (su) su.onclick = () => go({ name: 'plans' }); }
  nav.querySelectorAll('[data-tabgo]').forEach((b) => (b.onclick = async () => {
    const q = inSession();
    if (q) {
      if (!(await confirmLeave(leaveText(q.dataset.kind, true)))) return;
      if (q.dataset.kind === 'practice') saveOpenAnswer();
    }
    go({ name: b.dataset.tabgo });
  }));
}
// The menu shows on every screen except timed papers (mock exams, chapter tests, mini mocks), which get the
// whole screen like a real exam. Screens that aren't one of the four tabs light up the tab they belong to.
const TAB_OF = { mistakes: 'practice', chapters: 'practice', practice: 'practice', listening: 'practice', parent: 'progress', plans: 'settings', speaking: 'practice', writing: 'practice', learn: 'books', dictation: 'practice', homework: 'practice', stars: 'progress', settings: 'settings', home: 'home', books: 'books', mistakes: 'mistakes', progress: 'progress', book: 'books', notes: 'books', cards: 'books', paper: 'books', edit: 'books', library: 'books', pick: 'practice', worksheets: 'practice', usage: 'home' };
const MAIN_TABS = ['home', 'books', 'practice', 'progress', 'settings'];
function tabFor(v) {
  if (!v) return 'home';
  if (MAIN_TABS.includes(v.name) || ['book', 'learn', 'notes', 'cards', 'paper'].includes(v.name)) return TAB_OF[v.name] || 'home';
  for (let i = navStack.length - 2; i >= 0; i--) { const t = TAB_OF[navStack[i].name]; if (t && MAIN_TABS.includes(navStack[i].name)) return t; }
  return TAB_OF[v.name] || 'home';
}
const timedPaper = () => !!(S && $app.querySelector('#quit') && (S.mode === 'dse' || S.deadline) && !S.review);
new MutationObserver(() => {
  const m = $app.querySelector('main[data-view]');
  if (m && backTo && m.dataset.view === 'learn') return renderTabs('practice');
  if (m) return renderTabs(view && !MAIN_TABS.includes(m.dataset.view) ? tabFor(view) : TAB_OF[m.dataset.view] || m.dataset.view);
  if (timedPaper()) return renderTabs(null);
  if (backTo && view && ['learn', 'notes', 'cards', 'session'].includes(view.name)) return renderTabs('practice');
  renderTabs(tabFor(view));
}).observe($app, { childList: true });

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
  if (!DEV) { const me = normCode(local.code); list = list.filter((b) => b.starter || b.families === true || (Array.isArray(b.families) && !!me && b.families.map(normCode).includes(me))); } // PrepBuddy's own books, books on for every family, and books the admin turned on for this family
  const mine = new Set((await getBooks()).map((b) => b.id));
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Books</span></button><span style="font-weight:600;font-size:16px">Textbook library</span></div>
  <main class="stack g14" data-view="books" style="flex:1;padding:4px 20px 24px">
    <form id="find" class="searchbox light" role="search">
      <span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off" value="${esc(query)}">
    </form>
    <label class="card up-card">
      <span class="up-ic" aria-hidden="true">${ICON.upload}</span>
      <span class="stack" style="gap:2px;min-width:0"><b>${LANG === 'zh' ? '上載你自己的課本（PDF）' : 'Upload your own textbook (PDF)'}</b><span class="muted">${LANG === 'zh' ? '例如學校課本或作業的 PDF。PrepBuddy 會把它分成章節，並為每章出題。' : 'A PDF of your child’s school textbook or workbook. PrepBuddy splits it into chapters and makes practice for each one.'}</span></span>
      <input type="file" id="file" accept="application/pdf,.pdf" style="position:absolute;width:1px;height:1px;opacity:0">
    </label>
    <div id="chips"></div>
    <div id="results" class="stack g10" aria-live="polite"></div>
  </main>`;
  // Families add only books they own, for their child's own study (content-copyright model, 13 Nov 2026): asked once per upload.
  document.getElementById('file').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (limitOf('books') !== UNL && (await getBooks()).length >= limitOf('books')) return upsell('books', 'limit');
    const zh = LANG === 'zh';
    const ok = await confirmLeave({ title: zh ? '這是你家庭擁有的書嗎？' : 'Is this a book your family owns?', body: zh ? '請只上載你家庭擁有的課本或作業，供孩子自己溫習。書的內容只保存在這部裝置，不會與其他家庭分享。' : 'Please upload only textbooks or workbooks your family owns, for your child’s own study. The book stays on this device and is never shared with other families.', stay: zh ? '取消' : 'Cancel', leave: zh ? '是，上載' : 'Yes, upload it' });
    if (!ok) return;
    local.ownBooksOk = Date.now(); saveLocal();
    uploadBook(f);
  };
  const q = document.getElementById('q');
  const groupsAll = groupBySubject(list, subjectOf);
  let pickSubj = 'all';
  const drawChips = () => {
    document.getElementById('chips').innerHTML = subjectChips(groupsAll, pickSubj, list.length);
    document.querySelectorAll('#chips [data-subj]').forEach((c) => (c.onclick = () => { pickSubj = c.dataset.subj; drawChips(); draw(); }));
  };
  const card = (b) => {
    const added = mine.has(libBookId(b));
    return `<div class="card libcard">
          <div class="cover" aria-hidden="true" style="background:${subjectColour(b.subject, b.title)}1F">${subjectIcon(b.subject, 30, null, b.title)}</div>
          <div class="stack g6" style="flex:1;min-width:0">
            ${b.starter ? `<span class="st-badge">${LANG === 'zh' ? '免費入門書 · PrepBuddy 編寫' : 'Free starter book · by PrepBuddy'}</span>` : ''}<b style="font-size:16px;line-height:1.35" data-raw>${esc(b.title)}</b>
            <span class="muted" style="font-size:14px" data-raw>${esc([subj(b.subject), b.level, b.publisher].filter(Boolean).join(' · '))}</span>
            <span class="muted" style="font-size:12px">${b.units.length} chapter${b.units.length === 1 ? '' : 's'} · ${b.questionCount ? b.questionCount + ' questions ready · ' : ''}code <span style="white-space:nowrap">${esc(b.code)}</span></span>
            ${added
              ? `<button class="btn ghost small" data-open="${esc(b.id)}">${ICON.check} Added · open</button>`
              : `<button class="btn small" data-add="${esc(b.id)}">${ICON.plus} Add to my textbooks</button>`}
          </div></div>`;
  };
  const draw = () => {
    const raw = q.value.trim(), words = raw.toLowerCase().split(/\s+/).filter(Boolean), code = normCode(raw);
    const hits = list.filter((b) => {
      if (code && normCode(b.code) === code) return true;
      if (pickSubj !== 'all' && subjectOf(b) !== pickSubj) return false;
      const hay = `${b.title} ${b.subject} ${subjectName(b.subject, 'zh')} ${b.level} ${b.publisher} ${b.code}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const codeHit = code.length >= 4 && hits.find((b) => normCode(b.code) === code);
    const grouped = groupBySubject(hits, subjectOf);
    document.getElementById('results').innerHTML = (codeHit ? '<p class="hint" style="margin:0;font-weight:600;color:var(--good)">Book code matched</p>' : '') + (hits.length
      ? (grouped.length > 1 ? grouped.map(([k, xs]) => `<section class="stack g10 bgroup" aria-label="${esc(subjLabel(k))}"><h2>${subjectIcon(k === 'Other' || k === 'My uploads' ? '' : k, 22, null, k)}<span data-raw>${esc(subjLabel(k))}</span><small>${xs.length}</small></h2>${xs.map(card).join('')}</section>`).join('') : hits.map(card).join(''))
      : `<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5">No textbook matches “${esc(raw)}”.</p><p class="muted" style="margin:8px 0 0;font-size:14px;line-height:1.5">Check the spelling or the book code and try again.</p></div>`);
    document.querySelectorAll('[data-add]').forEach((btn) => (btn.onclick = () => addFromLibrary(list.find((b) => b.id === btn.dataset.add), btn)));
    document.querySelectorAll('[data-open]').forEach((btn) => (btn.onclick = () => go({ name: 'book', bookId: 'lib-' + btn.dataset.open })));
  };
  q.oninput = draw;
  document.getElementById('find').onsubmit = (e) => { e.preventDefault(); q.blur(); };
  document.getElementById('back').onclick = () => go({ name: 'books' });
  drawChips();
  draw();
  q.focus();
}

async function addFromLibrary(entry, btn, opts = {}) {
  if (limitOf('books') !== UNL && (await getBooks()).length >= limitOf('books')) return opts.quiet ? false : upsell('books', 'limit');
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
    books.unshift({ id, library: entry.id, rev: entry.rev || 1, code: entry.code, title: entry.title, subject: entry.subject, level: entry.level,
      credit: entry.credit, pageCount: entry.pageCount, addedAt: Date.now(), units: entry.units.map((u) => ({ ...u })), kind: entry.kind || guessKind(`${entry.subject || ''} ${entry.title}`, '') });
    await store.set('books', books);
    if (opts.quiet) return true;
    toast('Added to your textbooks');
    go({ name: 'book', bookId: id });
  } catch (e) {
    if (opts.quiet) return false;
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
          <div class="eacts"><button class="btn small" id="doSplit" data-u="${esc(u.id)}">Split here</button><button class="btn-sm quiet" id="noSplit">Cancel</button></div></div>`
        : `<div class="eacts">${last ? '' : `<button class="btn-sm" data-merge="${esc(u.id)}">Merge with next</button>`}${canSplit ? `<button class="btn-sm" data-split="${esc(u.id)}">Split</button>` : ''}<button class="btn-sm quiet" data-hide="${esc(u.id)}">Hide</button></div>`}
    </div>`;
  };
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Chapters</span></button><span style="font-weight:600;font-size:16px">Edit chapters</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Fix chapter names, merge or split chapters, or hide parts that aren’t for revising (like answers or the index). Your questions and progress are kept.</p>
    ${pages ? '' : `<p class="hint" style="margin:0">${book.library ? 'Library books can be renamed, merged or hidden.' : 'Splitting needs the book uploaded again (books uploaded before today can still be renamed, merged or hidden).'}</p>`}
    <div class="card stack">${book.units.map(row).join('')}</div>
    ${hidden.length ? `<p style="margin:6px 0 0;font-size:16px;font-weight:600">Hidden (${hidden.length})</p>
      <div class="card stack">${hidden.map((u) => `<div class="erow hiddenrow"><span data-raw>${esc(u.title)}</span><span class="muted epages">${u.startPage ? `pp. ${u.startPage}–${u.endPage}` : ''}</span><div class="eacts"><button class="btn-sm" data-show="${esc(u.id)}">Show</button></div></div>`).join('')}</div>` : ''}
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

// Opened from Practice → Lessons / Practice questions: scroll straight to that part of the book page (once).
let bookFocus = null;
// Opened from Practice → Revision notes / Flashcards: the main button opens those instead of starting questions.
let bookTool = null;
async function renderBook(bookId) {
  backTo = null;
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  if (pick.bookId !== bookId) pick = { bookId, ids: new Set(book.units.length === 1 ? [book.units[0].id] : []), open: new Set() };
  if (!book.kind) {
    const books = await store.get('books', []); const b = books.find((x) => x.id === bookId);
    const sample = book.units[0] ? await store.get(`text:${bookId}:${book.units[0].id}`, '') : '';
    book.kind = guessKind(`${book.subject || ''} ${book.title}`, sample);
    if (b) { b.kind = book.kind; await store.set('books', books); }
  }
  bookKinds.set(book.id, kindOfBook(book));
  const t = curTypes();
  const count = local.count || sessionSize();
  const bm = await bookMastery(book);
  const bmByUnit = Object.fromEntries(bm.chapters.map((c) => [c.unit.id, c]));
  // Sections are grouped under their chapter ("1.1", "1.2" → Chapter 1) so long books stay short to scroll.
  const groupOf = (u) => { if (u.chapter) return u.chapter; const m = String(u.title).match(/^\s*(\d{1,2})\.\d/); return m ? `Chapter ${m[1]}` : null; };
  const groups = [];
  // sections without a number (e.g. "Glossary") belong to the chapter they follow
  for (const u of book.units) { const last = groups[groups.length - 1]; const g = groupOf(u) || (last ? last.name : ''); if (last && last.name === g) last.units.push(u); else groups.push({ name: g, units: [u] }); }
  // only fold sections into chapters when chapters really have several sections; one section each = a plain list with titles
  const grouped = book.units.length > 12 && groups.length >= 2 && groups.every((g) => g.name) && groups.some((g) => g.units.length > 1) && groups.length < book.units.length * 0.8;
  if (!pick.open) pick.open = new Set();
  if (grouped && !pick.openSet) {
    pick.openSet = true;
    groups.forEach((g) => { if (g.units.some((u) => pick.ids.has(u.id) || (bmByUnit[u.id] || {}).done)) pick.open.add(g.name); });
    if (!pick.open.size) pick.open.add(groups[0].name);
  }
  const cleanTitle = (t) => String(t).replace(/\s*\*+\s*$/, '');
  const pctColour = (sc) => (!sc ? 'var(--muted)' : sc < 60 ? 'var(--warn)' : sc < 80 ? 'var(--accent)' : 'var(--good)');
  // A book with only a few chapters gets bigger chapter cards, one per line, with progress.
  const few = book.units.length <= 8;
  const richRow = (u) => {
    const c = bmByUnit[u.id] || { pct: 0, done: 0 };
    const on = pick.ids.has(u.id);
    const pages = u.startPage ? (u.endPage && u.endPage !== u.startPage ? `pp. ${u.startPage}–${u.endPage}` : `p. ${u.startPage}`) : '';
    return `<button class="crow rich ${on ? 'picked' : ''}" data-unit="${esc(u.id)}" aria-pressed="${on}" data-name="${esc(String(u.title).toLowerCase())}">
      <span class="box ${on ? 'on' : ''}" aria-hidden="true">${on ? ICON.check : ''}</span>
      <span class="cbody"><span class="ct" data-raw>${esc(cleanTitle(u.title))}</span>
        <span class="cmeta">${[pages, c.done ? `${c.done} question${c.done === 1 ? '' : 's'} answered` : 'Not started yet'].filter(Boolean).join(' · ')}</span>
        <span class="cbar" aria-hidden="true"><i style="width:${c.pct}%;background:${pctColour(c.pct)}"></i></span></span>
      <span class="cp" style="color:${c.done ? pctColour(c.pct) : 'var(--muted-2)'}">${c.pct}%<small>mastery</small></span>
    </button>`;
  };
  const row = (u) => {
    if (few) return richRow(u);
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
          <button class="gtoggle" data-gtoggle="${esc(g.name)}" aria-expanded="${open}"><b data-raw>${esc(g.name)}</b><span class="gmeta">${g.units.length} section${g.units.length === 1 ? '' : 's'}${nOn ? ` · ${nOn} ticked` : ''}</span>${done ? `<span class="cp" style="color:${pctColour(gp)}">${gp}%</span>` : ''}<span class="chev" aria-hidden="true">${ICON.back}</span></button>
        </div>
        ${open ? `<div class="gbody">${g.units.map(row).join('')}</div>` : ''}
      </section>`;
    }).join('')
    : `<div class="gbody flat ${few ? 'few' : ''}">${book.units.map(row).join('')}</div>`;
  const n = pick.ids.size;
  const mins = Math.max(1, Math.round(count * (t === 'mcq' ? 0.5 : t === 'written' ? 1.5 : 0.8)));
  const { n: qReady } = await bookSummary(book);
  const answered = bm.chapters.reduce((x, c) => x + (c.done || 0), 0);
  const pl = (local.placement || {})[book.id];
  const plHTML = !pl && !answered && !(local.plHide || {})[book.id]
    ? `<section class="pl-card"><span class="pl-ic">${buddySVG('happy', 44)}</span><div class="pl-ct"><b>New to this book? Find your level first</b><span>About ${Math.max(6, Math.min(12, levelUnits(book).length * 2))} quick questions, about 5 minutes. Then every chapter starts at the right level for you.</span></div>
        <div class="pl-acts"><button class="btn" id="plGo">Start level check</button><button class="btn-sm quiet" id="plSkip">Not now</button></div></section>`
    : pl ? `<p class="pl-done">✓ Level check done ${new Date(pl.t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} · <button class="linkbtn" id="plGo">Take it again</button></p>` : '';
  // Learn: a guided lesson per chapter, shown as its own section above the practice list.
  const learned = local.learned || {};
  const lkey = (u) => learned[`${book.id}:${u.id}`];
  const lstat = (u) => (lkey(u) ? `✓ Learned ${new Date(lkey(u)).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}` : 'Not learned yet · about 5 min');
  const plWeak = (u) => { const r = ((pl || {}).u || {})[u.id]; return r && r[1] && r[0] / r[1] < 0.4; };
  const nextU = book.units.find((u) => pick.ids.has(u.id) && !lkey(u)) || book.units.find((u) => plWeak(u) && !lkey(u)) || book.units.find((u) => !lkey(u)) || book.units[0];
  const lrow = (u, cls = '', tag = 'Up next') => `<div class="lc-row ${cls} ${lkey(u) ? 'done' : ''}">${cls === 'next' ? `<span class="lc-up">${tag}</span>` : ''}<span class="lc-t"><b data-raw>${esc(shortTitle(u.title))}</b><small>${lstat(u)}</small></span><button class="btn-sm lc-go ${lkey(u) ? '' : 'primary'}" data-learn="${esc(u.id)}">${lkey(u) ? 'Learn again' : 'Start lesson'}</button></div>`;
  const nLearned = book.units.filter(lkey).length;
  const learnHTML = `<section class="learn-card" aria-label="Learn">
      <div class="lc-head"><span class="lc-ic">${actionIcon('learn', 24)}</span><div><h2>Learn${book.units.length > 1 ? ` <small>${nLearned} of ${book.units.length} learned</small>` : ''}</h2><p>New to a chapter? Buddy teaches it step by step, with quick checks as you go. Then practise it below.</p></div></div>
      ${book.units.length <= 4 ? `<div class="lc-list">${book.units.map((u) => lrow(u)).join('')}</div>`
        : `<div class="lc-list" id="lclist">${lrow(nextU, 'next')}</div>
        <label class="lc-pick"><span>Or choose a chapter</span><select id="learnpick"><option value="">Choose…</option>${book.units.map((u) => `<option value="${esc(u.id)}">${lkey(u) ? '✓ ' : ''}${esc(cleanTitle(u.title))}</option>`).join('')}</select></label>`}
    </section>`;
  const stat = (v, label) => `<span><b>${v}</b> ${label}</span>`;
  const bkT = (() => { try { return PG.trackSummary(pgState().b[book.id]); } catch (e) { return null; } })();
  const bkLevel = bkT && bkT.level != null && bkT.n >= 15 ? `<span class="bk-lv ${bkT.status}" title="${LANG === 'zh' ? '程度 1–4：大約答對三分之二的題目難度' : 'Level 1–4: the difficulty you get about 2 in 3 right'}">${LANG === 'zh' ? '程度' : 'Level'} <b>${bkT.level.toFixed(1)}</b>${bkT.status === 'rising' ? ' ▲' : bkT.status === 'dipping' ? ' ▼' : ''}</span>` : '';
  const head = `<section class="bk-head">
      <div class="bk-cover" style="background:${coverColour(book)}" aria-hidden="true">${subjectIcon(book.subject, 30, '#FFFFFF', book.title)}</div>
      <div class="bk-info">
        <h1 data-raw>${esc(book.title)}</h1>
        <p data-raw>${esc([subj(book.subject), book.level, book.library ? '' : (LANG === 'zh' ? '自行上載' : 'Uploaded by you')].filter(Boolean).join(' · ') || ' ')}</p>
        <div class="bk-stats">${stat(book.units.length, book.units.length === 1 ? 'chapter' : 'chapters')}${stat(qReady, qReady === 1 ? 'question ready' : 'questions ready')}${stat(answered, 'answered')}${bkLevel}</div>
      </div>
    </section>`;
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button></div>
  <div class="bookpage">
  <div class="bk-head-m">${head}</div>
  <main class="bk-main stack g14">
    <div class="bk-head-d">${head}</div>
    ${plHTML}
    ${learnHTML}
    <h2 class="bk-sec" id="bk-practise"><span class="bk-sec-ic">${actionIcon('practise', 22)}</span>Practise</h2>
    <div class="chtools">
      <p style="margin:0;font-size:16px;font-weight:600">${book.units.length === 1 ? '1. Your chapter' : `1. Choose chapters to practise <span class="muted" style="font-weight:500">(${book.units.length})</span>`}</p>
      ${book.units.length > 1 ? `<button class="btn-sm" id="all" >${n === book.units.length ? 'Clear all' : 'Select all'}</button>` : ''}
      ${book.units.length > 12 ? `<label class="chsearch"><span aria-hidden="true">${ICON.search}</span><input id="chsearch" type="search" placeholder="Find a chapter" aria-label="Find a chapter" autocomplete="off"></label>` : ''}
    </div>
    <div class="chlist" id="chlist">${listHTML}</div>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.5">${book.library
      ? `From the PrepBuddy library · book code ${esc(book.code)}${book.credit ? `<br>Source: ${esc(book.credit)}` : ''}`
      : `Uploaded by you · ${book.pageCount} pages · chapters found from ${book.method === 'ai' ? 'the contents page and headings, checked by AI' : book.method === 'bookmarks' ? 'the book’s bookmarks' : book.method === 'headings' ? 'numbered headings' : '8-page blocks (no headings found)'}`}</p>
    <button class="btn-sm danger" id="delete" style="align-self:flex-start">Remove from my textbooks</button>
  </main>
  <aside class="bk-side">
    ${masteryCard(bm)}
  <div class="sheet sticky setup ${n ? 'armed' : ''} ${pick.opts ? 'expanded' : ''}">
    <div class="setup-head"><p style="margin:0;font-size:16px;font-weight:600">2. Set up your practice${n ? ` <span class="muted" style="font-weight:500">· ${n} chapter${n > 1 ? 's' : ''} ticked</span>` : ''}</p>${n ? `<button class="btn-sm setup-more" id="opts" aria-expanded="${!!pick.opts}">${pick.opts ? 'Fewer options' : 'More options'}</button>` : ''}</div>
    <div class="setup-row">
      <span id="types-label">Questions</span>
      <div class="seg" role="radiogroup" aria-labelledby="types-label">
        ${TYPE_CHOICES.map(([k, l]) => `<button role="radio" aria-checked="${t === k}" data-types="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="setup-row diffrow">
      <span id="diff-label">Difficulty</span>
      <div class="seg diffseg" role="radiogroup" aria-labelledby="diff-label">
        ${DIFFS.map(([k, l]) => `<button role="radio" aria-checked="${curDiff() === k}" data-diff="${k}" class="${curDiff() === k ? 'on' : ''} ${!cap('hardDiff') && !['easy', 'medium'].includes(k) ? 'dlock' : ''}" title="${{ auto: 'Adjusts to how you are doing', easy: 'Remember and understand', medium: 'Understand and apply', hard: 'Apply and analyse', master: 'Analyse and evaluate: the hardest questions' }[k]}">${l}${!cap('hardDiff') && !['easy', 'medium'].includes(k) ? ' 🔒' : ''}</button>`).join('')}
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
    <div class="more-ways"><p class="mw-h">More ways to study${n ? '' : ' <span class="muted">· tick a chapter first</span>'}</p>
      <div class="mw-grid">
        <button class="mw" id="ctest" ${n ? '' : 'disabled'}>${lockTag('test')}${actionTile('test', 40)}<b>Chapter test</b><span>Timed, like a school test</span></button>
        <button class="mw" id="notes" ${n ? '' : 'disabled'}>${actionTile('notes', 40)}<b>Notes</b><span>Key points to revise</span></button>
        <button class="mw" id="cards" ${n ? '' : 'disabled'}>${actionTile('flashcards', 40)}<b>Flashcards</b><span>Quick-fire recall</span></button>
        <button class="mw" id="paper">${lockTag('mock')}${actionTile('mock', 40)}<b>Mock exam</b><span>DSE-style or worksheet</span></button>
      </div>
    </div>
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
  document.getElementById('back').onclick = () => { pick = { bookId: null, ids: new Set() }; goBack({ name: 'books' }); };
  const a = document.getElementById('all');
  if (a) a.onclick = () => { if (pick.ids.size === book.units.length) pick.ids.clear(); else book.units.forEach((u) => pick.ids.add(u.id)); keep(); };
  function bindRows() { $app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => { const id = b.dataset.unit; pick.ids.has(id) ? pick.ids.delete(id) : pick.ids.add(id); keep(); })); }
  bindRows();
  prefetch(book, book.units.filter((u) => pick.ids.has(u.id)));
  $app.querySelectorAll('[data-types]').forEach((b) => (b.onclick = () => { local.types = b.dataset.types; local.typesSet = true; saveLocal(); keep(); }));
  $app.querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => { if (b.classList.contains('dlock')) return upsell('hardDiff', 'locked'); local.diff = b.dataset.diff; saveLocal(); keep(); }));
  const step = (d) => { local.count = Math.min(100, Math.max(5, (local.count || sessionSize()) + d)); saveLocal(); keep(); };
  document.getElementById('minus').onclick = () => step((local.count || sessionSize()) > 20 ? -10 : -5);
  document.getElementById('plus').onclick = () => step((local.count || sessionSize()) >= 20 ? 10 : 5);
  document.getElementById('go').onclick = () => { const units = book.units.filter((u) => pick.ids.has(u.id)); startUnits(book, units, local.count || sessionSize()); };
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
  const bindLearn = () => $app.querySelectorAll('[data-learn]').forEach((b) => (b.onclick = () => go({ name: 'learn', bookId, unitId: b.dataset.learn })));
  bindLearn();
  { const pg = document.getElementById('plGo'); if (pg) pg.onclick = () => startPlacement(book); }
  { const ps = document.getElementById('plSkip'); if (ps) ps.onclick = () => { local.plHide = { ...(local.plHide || {}), [book.id]: 1 }; saveLocal(); keep(); }; }
  { const lp = document.getElementById('learnpick'); if (lp) lp.onchange = () => {
    // picking a chapter shows it in the card above; the child then presses Start lesson
    const u = book.units.find((x) => x.id === lp.value) || nextU, box = document.getElementById('lclist');
    if (!box) return;
    box.innerHTML = lrow(u, 'next', lp.value ? 'Your choice' : 'Up next');
    bindLearn();
    const r = box.querySelector('.lc-row'); if (r) { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); }
  }; }
  document.getElementById('cards').onclick = () => go({ name: 'cards', bookId });
  if (bookTool && bookTool.bookId === bookId) {
    const isN = bookTool.tool === 'notes', zh = LANG === 'zh', g = document.getElementById('go'), nT = pick.ids.size;
    const what = isN ? (zh ? '溫習筆記' : 'revision notes') : (zh ? '閃卡' : 'flashcards');
    const h = $app.querySelector('.chtools'); if (h) h.insertAdjacentHTML('afterend', `<p class="bk-tip">${zh ? `剔選你想溫習的章節，然後按「打開${what}」。` : `Tick the chapters you want, then tap Open ${what}.`}</p>`);
    const sh = $app.querySelector('.setup-head p'); if (sh) sh.innerHTML = `${zh ? '2. 打開' + what : '2. Open ' + what}${nT ? ` <span class="muted" style="font-weight:500">· ${nT} ${zh ? '章' : nT > 1 ? 'chapters' : 'chapter'}</span>` : ''}`;
    if (g) { g.textContent = nT ? (zh ? `打開${what}` : `Open ${what}`) : (zh ? '先剔選至少一章' : 'Tick at least one chapter'); g.onclick = () => { document.getElementById(isN ? 'notes' : 'cards').click(); backTo = { name: 'book', bookId, focus: bookTool.tool }; }; }
  }
  window.scrollTo(0, 0);
  if (bookFocus) {
    const el = $app.querySelector(bookFocus === 'learn' ? 'section.learn-card' : '#bk-practise'); bookFocus = null;
    if (el) requestAnimationFrame(() => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 76)));
  }
}

// As soon as chapters are ticked, the first batch of questions (and the quick-look cards) starts being made,
// so by the time the student presses Start there is little or nothing left to wait for.
async function prefetch(book, units) {
  if (!units.length || units.length > 3 || navigator.onLine === false) return;
  const types = curTypes(), count = local.count || sessionSize();
  for (const u of units) {
    getSnippets(book, u).catch(() => {});
    const diff = curDiff();
    if (jobs.has(`${book.id}:${u.id}:${types}${diff === 'auto' ? '' : ':' + diff}`)) continue;
    const fresh = (await getQs(book.id, u.id)).filter((q) => !local.stats[q.id] && matchType(q, types) && diffOK(q, diff)).length;
    const want = Math.ceil(count / units.length);
    if (fresh < want) ensureFill(book, u, Math.min(BATCH, want - fresh), types, 1, true, diff);
  }
}

/* ---------- revision notes and flashcards (made once per chapter, kept on this device) ---------- */
const notesJobs = new Map();
function getNotes(book, unit, fresh) {
  const key = `notes:${book.id}:${unit.id}`;
  if (!fresh && notesJobs.has(key)) return notesJobs.get(key);
  const p = (async () => {
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    const lg = langOf(text);
    // Notes saved before a chapter's language was recognised (French, Japanese) are written again in that language.
    if (!fresh) { const have = await store.get(key, null); if (have && Array.isArray(have.sections) && ((have.lang === lg && (have.v >= 2 || (lg !== 'fr' && lg !== 'ja'))) || (!have.lang && lg !== 'fr' && lg !== 'ja'))) return have; }
    if (!text) throw new Error('This chapter’s text is missing on this device.');
    const n = await api('notes', { title: unit.title, text, kind: kindOfBook(book), lang: lg });
    delete n.usage;
    n.at = Date.now(); n.lang = lg; n.v = 2; // v2: classroom style for French/Japanese
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
  const units = await studyUnits(book), myView = view;
  $app.innerHTML = `
  <div class="topbar noprint"><button class="backbtn" id="back">${ICON.back}<span>${backLabel('Chapters')}</span></button><span style="font-weight:600;font-size:16px;flex:1">Revision notes</span><button class="btn-sm" id="printn">Print</button></div>
  <main class="stack g18 notes" style="flex:1;padding:4px 20px 24px">
    <div class="wslot noprint" id="nwaitc" hidden></div>
    ${units.map((u) => `<section class="ncard" id="n-${esc(u.id)}"><h2 class="ntitle" data-raw>${esc(u.title)}</h2><div class="nwait"><div class="spinner small" aria-hidden="true"></div><span>Writing notes from your textbook…</span></div></section>`).join('')}
    <p class="hint" style="margin:0;line-height:1.5">Written by AI from your textbook. If something looks wrong, check it against the book.</p>
  </main>
  <div class="sheet sticky noprint">
    <button class="btn" id="tocards">${ICON.cards} Practise with flashcards</button>
    <span class="hint" style="text-align:center">Notes are saved on this device, so they open instantly next time.</span>
  </div>`;
  document.getElementById('back').onclick = () => leaveTo(bookId);
  document.getElementById('printn').onclick = () => window.print();
  document.getElementById('tocards').onclick = () => go({ name: 'cards', bookId });
  // one quick-look card at the top while notes are still being written (not when they're saved already)
  let pending = 0, stopWait = null;
  const track = (pr) => { pending++; if (!stopWait) stopWait = mountWaitCards(document.getElementById('nwaitc'), book, units); pr.catch(() => {}).finally(() => { if (--pending === 0 && stopWait) { stopWait(); stopWait = null; } }); };
  const fill = (u, fresh) => {
    const el = document.getElementById(`n-${u.id}`); if (!el) return;
    if (fresh) el.innerHTML = `<h2 class="ntitle" data-raw>${esc(u.title)}</h2><div class="nwait"><div class="spinner small" aria-hidden="true"></div><span>Writing notes from your textbook…</span></div>`;
    const pr = getNotes(book, u, fresh); track(pr);
    pr.then((n) => {
      if (view !== myView) return;
      const e2 = document.getElementById(`n-${u.id}`); if (!e2) return;
      e2.innerHTML = notesHTML(u, n) + `<button class="btn-sm quiet noprint" data-remake="${esc(u.id)}" style="align-self:flex-start">Make these notes again</button>`;
      e2.querySelector('[data-remake]').onclick = () => fill(u, true);
    }).catch((e) => {
      if (view !== myView) return;
      const e2 = document.getElementById(`n-${u.id}`); if (!e2) return;
      e2.innerHTML = `<h2 class="ntitle" data-raw>${esc(u.title)}</h2><p class="hint" style="margin:0;color:var(--miss-dark)">${esc(notesError(e))}</p><button class="btn-sm" data-retry>Try again</button>`;
      e2.querySelector('[data-retry]').onclick = () => fill(u, false);
    });
  };
  units.forEach((u) => fill(u, false));
}

let C = null; // the flashcard session
async function renderCards(bookId, only) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = await studyUnits(book), myView = view;
  if (!only) {
    $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${backLabel('Chapters')}</span></button></div>
    <main class="pad stack g18" style="flex:1;justify-content:center;text-align:center;align-items:center">
      <div class="spinner" aria-hidden="true"></div><h1 class="display" style="margin:0;font-size:22px">Making your flashcards</h1>
      <p class="muted" id="cw" style="margin:0;line-height:1.5;max-width:320px">Written from your textbook. The first time takes about 20–40 seconds per chapter.</p><div class="wslot" id="cwait" hidden></div></main>`;
    document.getElementById('back').onclick = () => leaveTo(bookId);
    const stopWait = mountWaitCards(document.getElementById('cwait'), book, units);
    const res = await Promise.allSettled(units.map((u) => getNotes(book, u).then((n) => n.flashcards.map((c) => ({ ...c, unit: u.title })))));
    stopWait();
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
  <div class="topbar"><button class="backbtn" id="quit" data-kind="cards">${ICON.back}<span>Back</span></button><div class="progress"><i style="width:${Math.round(100 * done / C.total)}%"></i></div><span class="count">${done + 1} / ${C.total}</span></div>
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
  document.getElementById('quit').onclick = async () => { if (await confirmLeave(leaveText('cards'))) leaveTo(C.bookId); };
}
function cardsDone() {
  const missed = C.missed.length;
  $app.innerHTML = `<main class="pad stack g22" style="flex:1">
    <div class="stack g6"><span class="muted" style="font-size:14px">Flashcards · done</span><span class="score">${C.firstTry.size} / ${C.total}</span><span style="font-size:16px;font-weight:600;color:var(--good)">known first time</span></div>
    ${missed ? `<p style="margin:0;line-height:1.5;color:var(--text-2)">${missed} card${missed > 1 ? 's' : ''} needed another go. Going through them again helps them stick.</p>` : '<p style="margin:0;line-height:1.5;color:var(--text-2)">You knew every card first time.</p>'}
    <div class="stack g10">
      ${missed ? `<button class="btn" id="redo">Go through the ${missed} I missed</button>` : ''}
      <button class="btn ${missed ? 'ghost' : ''}" id="all">Shuffle all and go again</button>
      <button class="btn ghost" id="practise">Practise questions on these chapters</button>
      <button class="btn ghost" id="back">${backTo ? (LANG === 'zh' ? '返回' : 'Back to ') + backLabel('') : 'Back to chapters'}</button>
    </div></main>`;
  const deck = [...C.firstTry, ...C.missed];
  const r = document.getElementById('redo'); if (r) r.onclick = () => { const m = shuffle([...C.missed]); const id = C.bookId; C = null; renderCards(id, m); };
  document.getElementById('all').onclick = () => { const id = C.bookId; renderCards(id, shuffle(deck)); };
  document.getElementById('practise').onclick = async () => { const b = (await getBooks()).find((x) => x.id === C.bookId); startUnits(b, paperUnits(b), local.count || sessionSize()); };
  document.getElementById('back').onclick = () => leaveTo(C.bookId);
}

/* ---------- my progress + report for parents ---------- */
// The parts of the weekly report that sell what PrepBuddy did: the work done for the child this week, the next test
// with its forecast and plan, what Buddy noticed, and proof it's working. Compact, because it travels in the link.
// A made-up child's report, to show families what the weekly parent report looks like.
function sampleReportURL() {
  const zh = LANG === 'zh', T = (en, c) => (zh ? c : en), t0 = dayStart(), D = DAY;
  const r = { v: 1, sm: 1, u: zh ? 'zh' : 'en', n: T('Sam', '小明'), b: [T('Science', '常識'), T('Maths', '數學'), T('English', '英文')], from: t0 - 6 * D, at: Date.now(),
    days: [18, 12, 22, 15, 0, 20, 13], q: 142, a: 78, pa: 74, dp: 6, tr: [64, 66, 70, 72, 74, 78], st: 12, pq: 120, pm: 90, mk: 9, fx: 11, lt: 214, rd: 6,
    ch: [[T('Water cycle', '水的循環'), 64, 24, 58], [T('Fractions', '分數'), 81, 30, 70], [T('Electricity', '電'), 45, 12, null], [T('Plants', '植物'), 92, 20, 88]],
    up: T('Fractions: up from 70% to 81% since last week.', '分數：由上週 70% 進步至 81%。'), weak: T('Electricity: 6 of 12 questions not fully right.', '電：12 題中有 6 題未完全答對。'),
    rev: '', next: T('Two 15-minute sessions on Electricity, and keep up daily review.', '為「電」做兩次 15 分鐘練習，並保持每日溫習。'),
    sk: [[88, 40], [80, 52], [61, 36], [48, 14]], ms: [[T('Science', '常識'), 58, 74], [T('Maths', '數學'), 72, 90], [T('English', '英文'), 47]],
    g: null, ex: null, ts: [['test', T('Chapter test · Plants', '章節測驗 · 植物'), t0 - 3 * D, 85, 15]], sr: null, gs: null,
    x: { dw: { q: 142, w: 18, mx: 2, rv: 46, fx: 11, ls: 2, hw: 3 },
      nt: { n: T('Science test', '常識測驗'), d: t0 + 9 * D, l: 9, r: 58, f: 74, st: 'close', sc: T('Chapters 1–6', '第 1–6 章'), pl: [[t0 + D, T('Learn Heat', '學習「熱」')], [t0 + 2 * D, T('Learn Magnets', '學習「磁石」')], [t0 + 3 * D, T('Practise Electricity', '練習「電」')], [t0 + 8 * D, T('Practice test on Chapters 1–6', '模擬測驗')], [t0 + 9 * D, T('10-minute warm-up', '10 分鐘熱身')]] },
      mx: [[T('Mixes up evaporation and boiling', '混淆了蒸發和沸騰'), T('In 4 answers Sam said water has to boil before it can evaporate. That costs marks in the water cycle chapter, which is in the test.', '小明在 4 個答案中說水要先沸騰才會蒸發。這會令「水的循環」一章失分，而這章在測驗範圍內。')], [T('Adds the bottoms of fractions', '把分母相加'), T('3 times this week, e.g. 1/3 + 1/4 = 2/7. Buddy has set 10 targeted questions.', '本週 3 次，例如 1/3 + 1/4 = 2/7。Buddy 已安排 10 條針對性題目。')]],
      hi: [82, 61], pc: [[T('Maths', '數學'), 50, 88, t0 - 40 * D]], gn: T('Primary 4', '小四'), ge: [[T('Maths', '數學'), 'above'], [T('Science', '常識'), 'meet'], [T('English', '英文'), 'build']],
      mk: [[T('Science', '常識'), 62, 71], [T('Maths', '數學'), 70, 78]] } };
  return `${location.origin}/report.html#d=${encodeReport(r)}`;
}
async function reportExtras(books, gs) {
  const now = Date.now(), wk = now - 7 * DAY, t0 = dayStart();
  const week = local.log.filter((e) => e.t >= t0 - 6 * DAY);
  const sname = (b) => (b.subject ? subj(b.subject) : b.title);
  // what PrepBuddy did this week
  const dw = {
    q: week.length,
    w: week.filter((e) => e.ty === 'w').length,
    mx: local.insights && local.insights.lang === LANG ? (local.insights.list || []).length : 0,
    rv: week.filter((e) => e.k === 'spaced').length,
    fx: Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > wk).length,
    ls: Object.values(local.learned || {}).filter((t) => (typeof t === 'number' ? t : (t && t.t) || 0) > wk).length,
    hw: (local.hw || []).filter((h) => h.t > wk).length,
  };
  // next school test: ready now, by the test, and a day-by-day plan to close the gap
  let nt = null;
  const T = await schoolTestsHTML(); const p = T.steps.find((x) => x.ready != null) || T.steps[0];
  if (p) {
    const RH = await readyHist(books), h = p.book ? RH.find((y) => y.b.id === p.book.id) : null;
    const fcCh = p.book && p.units && p.units.length ? (await bookMastery(p.book)).chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)) : [];
    const fc = p.ready == null || locked('forecast') ? null : planForecast(p.ready, fcCh, p.left);
    const v = fc ?? p.ready, st = v == null ? 'none' : v >= 80 ? 'ok' : v >= 65 ? 'close' : 'risk';
    const plan = [];
    if (p.book && p.units && p.units.length && (p.x.kind || 'test') !== 'dict') {
      const m = await bookMastery(p.book), chs = m.chapters.filter((c) => p.units.some((u) => u.id === c.unit.id));
      const todo = [...chs.filter((c) => !c.done && !c.tests).map((c) => LANG === 'zh' ? `學習「${shortTitle(c.unit.title)}」` : `Learn ${shortTitle(c.unit.title)}`),
        ...chs.filter((c) => (c.done || c.tests) && c.pct < 70).sort((a, b) => a.pct - b.pct).map((c) => LANG === 'zh' ? `練習「${shortTitle(c.unit.title)}」` : `Practise ${shortTitle(c.unit.title)}`)];
      const td = testDay(p.x), slots = Math.max(0, p.left - 1);
      todo.slice(0, Math.min(4, slots)).forEach((t, i) => plan.push([t0 + (i + 1) * DAY, t]));
      if (p.left >= 2) plan.push([td - DAY, LANG === 'zh' ? '模擬測驗' : `Practice test on ${testScope(p)}`]);
      if (p.left >= 1) plan.push([td, LANG === 'zh' ? '10 分鐘熱身' : '10-minute warm-up']);
    }
    nt = { n: String(p.x.name).slice(0, 50), d: testDay(p.x), l: p.left, r: p.ready, f: fc, st, sc: p.book ? String(testScope(p)).slice(0, 60) : '', pl: plan.slice(0, 6).map(([t, x]) => [t, String(x).slice(0, 60)]) };
  }
  // what Buddy noticed: mix-ups from wrong answers, plus independence
  const mx = local.insights && local.insights.lang === LANG ? (local.insights.list || []).slice(0, 3).map((m) => [String(m.title).slice(0, 90), String(m.detail || '').slice(0, 260)]) : [];
  const lw = local.log.filter((e) => e.t > now - 14 * DAY), lp = local.log.filter((e) => e.t <= now - 14 * DAY && e.t > now - 56 * DAY);
  const own = (es) => Math.round(100 * es.filter((e) => !e.h).length / es.length);
  const hi = lw.length >= 30 && lp.length >= 30 ? [own(lw), own(lp)] : null;
  // proof it's working: progress checks, level against the grade, school marks before and after
  const pc = books.filter((b) => (local.placement || {})[b.id]).map((b) => { const pl = local.placement[b.id], c = (local.pchecks || []).filter((x) => x.b === b.id && x.t > pl.t).pop(); if (!c) return null;
    const pct = (per) => { const v = Object.values(per || {}); const g = v.reduce((a, x) => a + x[0], 0), m = v.reduce((a, x) => a + x[1], 0); return m ? Math.round(100 * g / m) : null; };
    return [sname(b), pct(pl.u), pct(c.per), pl.t]; }).filter(Boolean).slice(0, 3);
  const gName = gradeNow() ? gradeName(gradeNow()) : '';
  const ge = gName && gs && gs.s ? gs.s.filter((x) => x[1] != null).slice(0, 4).map((x) => [x[0], x[1] >= 3 ? 'above' : x[1] >= 2 ? 'meet' : 'build']) : [];
  const ML = marksList(), mB = ML.find((m) => m.kind === 'before'), mL = ML.filter((m) => m.kind === 'later').pop();
  const mk = mB && mL ? MARK_SUBJ().filter(([k]) => typeof mB.s[k] === 'number' && typeof mL.s[k] === 'number').map(([k, z, e]) => [LANG === 'zh' ? z : e, mB.s[k], mL.s[k]]).slice(0, 4) : [];
  const nb = local.noticed && local.noticed.lang === LANG && Date.now() - local.noticed.t < 8 * DAY ? local.noticed.list : null;
  return { nb, dw, nt, mx, hi, pc, gn: gName, ge, mk };
}
async function currentReport() {
  const books = await getBooks();
  const practised = new Set(local.log.filter((e) => e.t >= Date.now() - 7 * DAY).map((e) => e.q.split(':')[0]));
  const names = books.filter((b) => practised.has(b.id)).map((b) => (b.subject ? subj(b.subject) : b.title));
  const ms = [], subjects = [];
  for (const b of books) { const m = await bookMastery(b); subjects.push({ book: b, pct: m.pct }); if (m.chapters.some((c) => c.done)) ms.push([b.subject ? subj(b.subject) : b.title, m.pct, b.id]); }
  // the exam forecast travels with the report: [name, % by the exam] for books with a pace
  const E = examInfo(subjects);
  ms.forEach((x) => { const f = E && E.fc.find((y) => y.x.book.id === x[2]); x.length = 2; if (f && !f.wait) x.push(f.by); });
  const weekAgo = Date.now() - 7 * DAY, monthAgo = Date.now() - 30 * DAY;
  const fx = Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > weekAgo).length;
  const ts = (local.tests || []).filter((t) => t.kind && t.t > monthAgo).slice(-6).reverse().map((t) => [t.kind, String(t.title || '').slice(0, 60), t.t, t.m ? Math.round(100 * t.g / t.m) : 0, t.min || 0]);
  const gs = await gsData().catch(() => null);
  const un = {}; books.forEach((b) => b.units.forEach((u) => { un[`${b.id}:${u.id}`] = shortTitle(u.title); }));
  const x = await reportExtras(books, gs).catch(() => null);
  return buildReport({ log: local.log, stats: local.stats, name: local.name, books: [...new Set(names)], lang: LANG, ms, mk: mistakeCount(), fx, gs, un, x,
    goal: local.goal || null, exam: E && E.left !== null ? { left: E.left, date: E.date } : null, ts,
    sr: starsOn() ? (() => { const st = starState(), wk = Date.now() - 7 * DAY;
      return { w: st.log.filter((x) => x.t > wk).reduce((a, x) => a + x.n, 0), bal: st.bal,
        b: BADGES.filter((b) => (st.badges[b.id] || 0) > wk).map((b) => `${b.icon} ${LANG === 'zh' ? b.zh : b.en}`),
        r: st.redeemed.filter((x) => x.t > wk).map((x) => `${x.icon || '🎁'} ${x.name}`) }; })() : null });
}

// The week (days practised + three numbers) and "How ready you are", shared by Today and Progress.
function weekHTML(r) {
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LOCALE(), { weekday: 'narrow' }));
  const mins = r.days.reduce((a, m) => a + m, 0);
  const hm = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  const trend = r.a !== null && r.pa !== null ? (r.a >= r.pa ? `<span style="color:var(--good);font-weight:600">↑ ${r.a - r.pa} from last week</span>` : `<span style="color:var(--miss-dark);font-weight:600">↓ ${r.pa - r.a} from last week</span>`) : '<span>correct</span>';
  return `<div class="week">${r.days.map((m, i) => `<div><span class="${m ? 'on' : ''} ${i === 6 ? 'today' : ''}" title="${m} min"></span><small>${dayNames[i]}</small></div>`).join('')}</div>
    <div class="tiles">
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.q}</b><span>questions</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${hm}</b><span>practising</span></div>
      <div class="tile" style="cursor:default"><b class="display" style="font-size:22px">${r.a === null ? '–' : r.a + '%'}</b>${trend}</div>
    </div>`;
}
async function readyRowsHTML(limit = Infinity) {
  const books = await getBooks(), rows = [];
  for (const b of books) {
    const m = await bookMastery(b);
    rows.push({ b, pct: m.pct, html: `<button class="mrowb" data-book="${esc(b.id)}">${subjectTile(b.subject, 36, b.title)}<span class="mt"><b data-raw>${esc(b.subject ? subj(b.subject) : b.title)}</b><span class="bar ${m.pct < 60 ? 'warn' : m.pct < 80 ? 'mid' : ''}"><i style="width:${m.pct}%"></i></span></span><span class="m-pill ${m.pct >= 80 ? 'good' : m.pct >= 60 ? 'mid' : m.pct ? '' : 'zero'}">${m.pct}%</span></button>` });
  }
  // On Today, the books you've made most progress in come first.
  if (limit < Infinity) rows.sort((x, y) => y.pct - x.pct);
  return { html: rows.slice(0, limit).map((x) => x.html).join(''), more: Math.max(0, rows.length - limit), n: rows.length };
}
// Small line icons for the progress page.
const PI = {
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  up: '<path d="M4 16l5-5 4 4 7-7"/><path d="M15 8h5v5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
  bars: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  ring: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  line: '<path d="M3 17l5-6 4 3 5-7 4 4"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  memory: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 7v5l3 2"/><path d="M17 17l2 2 3-3"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
};
const pIcon = (k, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PI[k]}</svg>`;
const PT = (en, zh) => (LANG === 'zh' ? zh : en);
const SKILL_PLAIN = () => (LANG === 'zh' ? ['記憶事實', '理解', '應用', '深入思考'] : ['Remembering facts', 'Understanding', 'Using it', 'Thinking it through']);

// Weekly goal (days × minutes), counted Monday to Sunday.
function goalWeek() {
  const g = local.goal; if (!g) return null;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const mon = d0.getTime() - ((d0.getDay() + 6) % 7) * DAY;
  const week = Array.from({ length: 7 }, (_, i) => {
    const t = mon + i * DAY, m = minutesOf(local.log.filter((e) => e.t >= t && e.t < t + DAY));
    return { t, m, met: m >= g.mins, future: t > d0.getTime(), today: t === d0.getTime() };
  });
  const met = week.filter((x) => x.met).length;
  const left = week.filter((x) => x.future || (x.today && !x.met)).length;
  return { ...g, week, met, left, reached: met >= g.days, possible: met + left >= g.days };
}
// Exam countdown, and a forecast per textbook from how fast its readiness has been rising (last 4 weeks).
function examInfo(subjects) {
  const today = new Date(); today.setHours(0, 0, 0, 0); const t0 = today.getTime();
  // keep one readiness reading per book per day, so a pace can be worked out
  local.mhist = local.mhist || {};
  for (const x of subjects) {
    const h = (local.mhist[x.book.id] || []).filter((p) => p[0] !== t0);
    h.push([t0, x.pct]); local.mhist[x.book.id] = h.slice(-120);
  }
  saveLocal();
  if (!local.exam) return null;
  const ex = new Date(local.exam + 'T00:00:00').getTime();
  const left = Math.round((ex - t0) / DAY);
  if (!(left >= 0)) return { date: ex, left: null, fc: [] };
  const fc = subjects.map((x) => {
    const h = (local.mhist[x.book.id] || []).filter((p) => p[0] >= t0 - 28 * DAY);
    if (!h.length || t0 - h[0][0] < 7 * DAY) return { x, wait: true };
    const rate = (x.pct - h[0][1]) / ((t0 - h[0][0]) / DAY);
    return { x, rate, by: Math.min(100, Math.round(x.pct + Math.max(0, rate) * left)) };
  });
  return { date: ex, left, fc };
}

// Everything the progress page shows, worked out from the activity log, scores and textbooks on this device.
async function progressData() {
  const r = await currentReport();
  const books = await getBooks();
  const log = local.log, d0 = new Date(); d0.setHours(0, 0, 0, 0); const today = d0.getTime();
  const dayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const accOf = (es) => { const m = es.reduce((x, e) => x + e.m, 0); return m ? Math.round(100 * es.reduce((x, e) => x + e.g, 0) / m) : null; };
  // streak: days in a row with practice, up to today (or yesterday, if today hasn't started yet)
  const days = new Set(log.map((e) => dayOf(e.t)));
  let streak = 0; for (let d = days.has(today) ? today : today - DAY; days.has(d); d -= DAY) streak++;
  // weekly score for the last 6 weeks (each week ends today)
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const end = today + DAY - (5 - i) * 7 * DAY, start = end - 7 * DAY;
    const es = log.filter((e) => e.t >= start && e.t < end);
    return { start, a: accOf(es), n: es.length };
  });
  // chapters this week, compared with last week
  const from = r.from, prevFrom = from - 7 * DAY, by = new Map();
  for (const e of log) {
    if (e.t < prevFrom) continue;
    const [b, u] = e.q.split(':'), k = `${b}:${u}`;
    if (!by.has(k)) by.set(k, { b, u, now: [], prev: [] });
    (e.t >= from ? by.get(k).now : by.get(k).prev).push(e);
  }
  const chapters = [...by.values()].filter((c) => c.now.length).map((c) => {
    const book = books.find((x) => x.id === c.b), unit = book && book.units.find((x) => x.id === c.u);
    return book && unit ? { book, unit, a: accOf(c.now), was: c.prev.length >= 3 ? accOf(c.prev) : null, n: c.now.length, wrong: c.now.filter((e) => e.g < e.m).length } : null;
  }).filter(Boolean).sort((x, y) => y.n - x.n);
  const weak = chapters.filter((c) => c.n >= 3 && c.a < 70).sort((x, y) => x.a - y.a)[0] || null;
  let up = chapters.filter((c) => c !== weak && c.was !== null && c.a > c.was).sort((x, y) => (y.a - y.was) - (x.a - x.was))[0] || null;
  if (!up) up = chapters.filter((c) => c !== weak && c.n >= 3 && c.a >= 70).sort((x, y) => y.a - x.a)[0] || null;
  // readiness per textbook: mastery, or how much has been covered while mastery is still at 0
  const subjects = [];
  for (const b of books) { const m = await bookMastery(b); subjects.push({ book: b, pct: m.pct, covered: Math.round(100 * (m.areas.covered || 0)) }); }
  const stats = Object.values(local.stats);
  const weekAgo = Date.now() - 7 * DAY;
  return {
    r, streak, weeks, chapters, weak, up, subjects, goal: goalWeek(), exam: examInfo(subjects),
    tests: (local.tests || []).filter((t) => t.kind).sort((a, b) => b.t - a.t),
    due: (await dueItems()).length,
    mistakes: mistakeCount(),
    fixed: Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > weekAgo).length,
    longTerm: stats.filter((st) => (st.box || 0) >= 3).length,
    total: stats.reduce((x, st) => x + (st.seen || 0), 0),
  };
}

function ringHTML(p, tone, label, size = 76) {
  const R = 30, C = 2 * Math.PI * R, off = C * (1 - Math.max(0, Math.min(100, p)) / 100);
  return `<span class="pg-ring ${tone}" style="width:${size}px;height:${size}px"><svg viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="${R}" class="trk"/><circle cx="38" cy="38" r="${R}" class="val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><b>${label}</b></span>`;
}
function trendSVG(weeks) {
  const pts = weeks.map((w, i) => ({ i, a: w.a })).filter((p) => p.a !== null);
  if (pts.length < 2) return `<p class="pg-empty">${PT('Practise for two weeks to see your score over time.', '練習兩星期後，就會看到分數的走勢。')}</p>`;
  const narrow = !matchMedia('(min-width:700px)').matches;
  const W = narrow ? 340 : 520, H = narrow ? 130 : 150, px = (i) => (narrow ? 44 : 56) + i * (W - (narrow ? 70 : 100)) / 5, py = (a) => 22 + (100 - a) * (H - 40) / 100;
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${px(p.i).toFixed(1)} ${py(p.a).toFixed(1)}`).join(' ');
  const lab = (t) => new Date(t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' });
  return `<svg class="pg-trend" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${PT('Weekly score', '每週分數')}: ${weeks.map((w) => (w.a === null ? '–' : w.a + '%')).join(', ')}">
    ${[50, 80].map((g) => `<line x1="34" x2="${W - 12}" y1="${py(g)}" y2="${py(g)}" class="grid"/><text x="0" y="${py(g) + 4}" class="gl">${g}%</text>`).join('')}
    <path d="${path}" class="ln"/>
    ${pts.map((p) => `<circle cx="${px(p.i)}" cy="${py(p.a)}" r="4.5" class="dot"/><text x="${px(p.i)}" y="${py(p.a) - 10}" text-anchor="middle" class="vl">${p.a}%</text>`).join('')}
    ${weeks.map((w, i) => `<text x="${px(i)}" y="${H + 14}" text-anchor="middle" class="xl">${i === 5 ? PT('This week', '本週') : lab(w.start)}</text>`).join('')}
  </svg>`;
}

// ---- helpers for the Progress page ----
// Each book's readiness: today, about a week ago, its pace (per day, last 4 weeks) and one reading per week for 6 weeks.
async function readyHist(books) {
  const t0 = dayStart(); local.mhist = local.mhist || {}; const out = [];
  for (const b of books) {
    const m = await bookMastery(b), pct = m.pct;
    const h = (local.mhist[b.id] || []).filter((p) => p[0] !== t0); h.push([t0, pct]); local.mhist[b.id] = h.slice(-120);
    const near = (t, min) => h.filter((p) => p[0] <= min).sort((x, y) => Math.abs(x[0] - t) - Math.abs(y[0] - t))[0];
    const old = near(t0 - 7 * DAY, t0 - 5 * DAY);
    const h28 = h.filter((p) => p[0] >= t0 - 28 * DAY);
    const rate = h28.length && t0 - h28[0][0] >= 7 * DAY ? (pct - h28[0][1]) / ((t0 - h28[0][0]) / DAY) : null;
    const weeks = Array.from({ length: 6 }, (_, k) => { const t = t0 - (5 - k) * 7 * DAY; const p = h.filter((x) => x[0] <= t).pop(); return p ? p[1] : null; });
    const days = Array.from({ length: 28 }, (_, k) => { const t = t0 - (27 - k) * DAY; const p = h.find((x) => x[0] === t); return p ? p[1] : null; });
    out.push({ b, pct, days, first: h.length ? h[0][0] : t0, covered: Math.round(100 * (m.areas.covered || 0)), was: old ? old[1] : null, rate, weeks, started: startedOf(m), used: (local.log || []).some((e) => e.q && e.q.startsWith(b.id + ':')) });
  }
  saveLocal();
  return out.sort((x, y) => (y.used - x.used) || (y.pct - x.pct));
}
const LINE_COLS = ['#26357A', '#18966A', '#C2620F', '#7A4FC2', '#C2357A', '#0E7490'];
// One plain sentence on top of the readiness chart: who moved most (and what that means in chapters), who dipped, who stalled.
function readySummary(rows, name, U = { daily: false, n: 6 }) {
  const Z = PT, R = rows.map((r) => { const v = (r.ser || r.weeks).map((x, k) => [k, x]).filter(([, x]) => x != null); if (v.length < 2) return null;
    const [k0, a] = v[0], [, b] = v[v.length - 1], prev = v.length > 1 ? v[v.length - 2][1] : a;
    return { r, n: name(r), ch: b - a, wk: U.n - 1 - k0, k0, last: b, step: b - prev, chs: Math.floor(((b - a) / 100) * (r.b.units || []).length) }; }).filter(Boolean);
  if (!R.length) return '';
  const best = R.slice().sort((x, y) => y.ch - x.ch)[0], dip = R.filter((x) => x.step <= -3).sort((x, y) => x.step - y.step)[0];
  const flat = R.filter((x) => x !== best && x.ch <= 2 && x.wk >= (U.daily ? 5 : 2)).sort((x, y) => x.ch - y.ch)[0];
  const wks = (n) => Z(`${n} week${n === 1 ? '' : 's'}`, `${n} 星期`);
  const span = (x) => (!U.daily ? Z(`in ${wks(x.wk)}`, `${wks(x.wk)}內`) : x.wk <= 6 ? Z(`since ${new Date(U.at(x.k0)).toLocaleDateString(LOCALE(), { weekday: 'long' })}`, `自${new Date(U.at(x.k0)).toLocaleDateString(LOCALE(), { weekday: 'long' })}起`) : Z(`in ${x.wk} days`, `${x.wk} 日內`));
  const when = U.daily ? Z('since yesterday', '比昨天') : Z('this week', '本週');
  const parts = [];
  if (best.ch >= (U.daily ? 2 : 3)) parts.push(Z(`<b>${esc(best.n)} up ${best.ch}% ${span(best)}</b>${best.chs >= 1 ? `, about ${best.chs} more chapter${best.chs === 1 ? '' : 's'} known well` : ''}.`, `<b>${esc(best.n)}${span(best)}上升 ${best.ch}%</b>${best.chs >= 1 ? `，約多掌握 ${best.chs} 章` : ''}。`));
  if (dip && dip !== best) parts.push(Z(`${esc(dip.n)} dipped ${-dip.step}% ${when}: fixing mistakes and doing reviews brings it back.`, `${esc(dip.n)}${when}下跌 ${-dip.step}%：改正錯題、做溫習就能追回。`));
  else if (dip) parts.push(Z(`It dipped ${-dip.step}% ${when}: fixing mistakes and doing reviews brings it back.`, `${when}下跌 ${-dip.step}%：改正錯題、做溫習就能追回。`));
  if (flat && parts.length < 2) parts.push(Z(`${esc(flat.n)} has barely moved: try a lesson this week.`, `${esc(flat.n)}幾乎沒有變化：這星期試上一課吧。`));
  if (!parts.length) parts.push(best.ch > 0 ? Z(`Small steps up. A short mission most days gets the lines climbing.`, `有少少進步。大部分日子做個小任務，線就會上升。`) : Z('Not much change yet. A short mission most days gets the lines moving.', '暫時變化不大。大部分日子做個小任務，線就會上升。'));
  return parts.join(' ');
}
function readyLinesSVG(rows) {
  // the first 4 weeks: one dot per day, so a new child sees the line start straight away; after that, one per week
  const t0 = dayStart(), seen = rows.filter((r) => (r.days || []).some((v) => v != null) || r.weeks.some((v) => v != null));
  const oldest = seen.length ? Math.min(...seen.map((r) => r.first || t0)) : t0;
  const daily = seen.length && t0 - oldest < 28 * DAY && rows.some((r) => r.days);
  let n = 6, lab, ser, unit;
  if (daily) {
    const from = Math.max(0, 27 - Math.round((t0 - oldest) / DAY)); n = 28 - from;
    ser = (r) => (r.days || []).slice(from);
    const dl = (k) => { const t = t0 - (n - 1 - k) * DAY; return k === n - 1 ? PT('Today', '今天') : new Date(t).toLocaleDateString(LOCALE(), n <= 8 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }); };
    const every = n <= 8 ? 1 : Math.ceil(n / 5);
    lab = Array.from({ length: n }, (_, k) => (k === n - 1 || (n - 1 - k) % every === 0 ? dl(k) : ''));
    unit = { daily: true, at: (k) => t0 - (n - 1 - k) * DAY };
  } else {
    ser = (r) => r.weeks; lab = [PT('5 wks', '5 週前'), '4', '3', '2', PT('Last', '上週'), PT('Now', '本週')]; unit = { daily: false };
  }
  rows = rows.map((r) => ({ ...r, ser: ser(r) })).filter((r) => r.ser.filter((v) => v != null).length >= 2).slice(0, 6);
  if (!rows.length) return `<p class="pg-empty">${PT('Practise again tomorrow and your line starts here.', '明天再練習，你的線就會在這裏開始。')}</p>`;
  // the scale fits the data (0-20%, 0-40%, … 0-100%), so small early numbers still show their climb
  const top = Math.min(100, Math.max(20, Math.ceil(Math.max(...rows.flatMap((r) => r.ser.filter((v) => v != null))) * 1.15 / 20) * 20));
  const W = 380, H = 190, L = 40, B = 26, x = (k) => L + 14 + k * (W - 28 - L - 14) / Math.max(1, n - 1), y = (p) => H - B - (p / top) * (H - B - 10);
  let g = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * top)).map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#EEF1F6"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" font-size="14" fill="#5A6380" text-anchor="end">${v}%</text>`).join('');
  g += lab.map((t, k) => (t ? `<text x="${x(k).toFixed(1)}" y="${H - 6}" font-size="14" fill="#5A6380" text-anchor="middle">${esc(t)}</text>` : '')).join('');
  rows.forEach((r, i) => { const pts = r.ser.map((v, k) => (v == null ? null : `${x(k).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean); const c = LINE_COLS[i];
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (daily && n <= 14) pts.forEach((pt) => { const [px, py] = pt.split(','); g += `<circle cx="${px}" cy="${py}" r="2.5" fill="${c}"/>`; });
    const [lx, ly] = pts[pts.length - 1].split(','); g += `<circle cx="${lx}" cy="${ly}" r="4" fill="${c}"/>`; });
  const name = (r) => (r.b.subject ? subj(r.b.subject) : shortTitle(r.b.title));
  const sum = readySummary(rows, name, { ...unit, n });
  return `${sum ? `<p class="rw-sum">${sum}</p>` : ''}<svg class="pg-lines" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rows.map((r) => `${name(r)} ${r.pct}%`).join(', '))}">${g}</svg>
    <div class="pg-legend">${rows.map((r, i) => `<span><i style="background:${LINE_COLS[i]}"></i>${esc(name(r))} ${r.pct}%</span>`).join('')}</div>`;
}
// Writing, speaking, dictation and lessons: the latest result and the change since the first try.
function beyondData() {
  const out = [], wk = Date.now() - 7 * DAY, mon = Date.now() - 30 * DAY;
  const wr = (local.wr || []).filter((w) => w.drafts && w.drafts.length).sort((a, b) => b.drafts[b.drafts.length - 1].t - a.drafts[a.drafts.length - 1].t);
  if (wr.length) { const w = wr[0], f = wrLevel(w.drafts[0].fb, w.kind), l = wrLevel(w.drafts[w.drafts.length - 1].fb, w.kind), k = WR_KINDS[w.kind];
    out.push({ k: `${PT('Writing', '寫作')}${k ? ' · ' + (LANG === 'zh' ? k.zh : k.en) : ''}`, v: lvShow(l) || '–', c: w.drafts.length > 1 && f !== l ? PT(`from ${lvShow(f)} on the first draft`, `初稿 ${lvShow(f)}`) : '', up: w.drafts.length > 1, n: PT(`${wr.filter((x) => x.drafts[0].t > mon).length} this month`, `本月 ${wr.filter((x) => x.drafts[0].t > mon).length} 篇`) }); }
  const sp = (local.sp || []).filter((x) => x.tries && x.tries.length).sort((a, b) => b.tries[b.tries.length - 1].t - a.tries[a.tries.length - 1].t);
  if (sp.length) { const x = sp[0], l = spLevel(x.tries[x.tries.length - 1].fb, x), f = spLevel(x.tries[0].fb, x);
    out.push({ k: PT('Speaking', '說話'), v: lvShow(l) || '–', c: x.tries.length > 1 && f !== l ? PT(`from ${lvShow(f)} on the first try`, `首次 ${lvShow(f)}`) : '', up: x.tries.length > 1, n: PT(`${sp.reduce((a, s) => a + s.tries.filter((t) => t.t > wk).length, 0)} tries this week`, `本週 ${sp.reduce((a, s) => a + s.tries.filter((t) => t.t > wk).length, 0)} 次`) }); }
  const dl = (local.dict || []).filter((L) => (L.runs || []).length).sort((a, b) => b.runs[b.runs.length - 1].t - a.runs[a.runs.length - 1].t);
  if (dl.length) { const L = dl[0], last = L.runs[L.runs.length - 1], first = L.runs[0], pc = (q) => (q.n ? Math.round(100 * q.g / q.n) : 0);
    out.push({ k: PT('Dictation', '默書'), v: pc(last) + '%', c: L.runs.length > 1 && pc(first) !== pc(last) ? PT(`from ${pc(first)}% on the first try`, `首次 ${pc(first)}%`) : '', up: pc(last) > pc(first), n: L.title }); }
  const les = Object.values(local.learned || {}), pl = Object.keys(local.placement || {}).length;
  if (les.length || pl) out.push({ k: PT('Lessons with Buddy', '與 Buddy 上課'), v: String(les.filter((t) => t > wk).length), c: PT('this week', '本週'), up: false, n: `${PT(`${les.length} in total`, `累計 ${les.length} 課`)}${pl ? PT(` · level check done in ${pl} book${pl > 1 ? 's' : ''}`, ` · ${pl} 本書已做程度評估`) : ''}` });
  return out;
}
// Honest effort signals for this week: hints used, rushed or stopped sets, usual time, chapter tests passed.
function howData(logW) {
  const wk = Date.now() - 7 * DAY;
  const own = logW.length ? Math.round(100 * logW.filter((e) => !e.h).length / logW.length) : 0;
  const ss = (local.sess || []).filter((x) => x.t > wk);
  const hrs = Array(24).fill(0); logW.forEach((e) => hrs[new Date(e.t).getHours()]++);
  let bh = 0; for (let h = 0; h < 23; h++) if (hrs[h] + hrs[h + 1] > hrs[bh] + hrs[bh + 1]) bh = h;
  const fmtH = (h) => (LANG === 'zh' ? `${h}:00` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`);
  const passed = (local.tests || []).filter((x) => x.kind === 'test' && x.t > wk && x.m && x.g / x.m >= 0.8).length;
  return { own, sets: ss.length, steady: ss.filter((x) => !x.r).length, rushed: ss.filter((x) => x.r).length, early: ss.filter((x) => x.e).length, when: logW.length >= 5 ? `${fmtH(bh)}–${fmtH(bh + 2)}` : '', passed };
}
const pgBar = (label, pct, note, tn) => `<div class="pg-ch"><div class="pg-ch-top"><span>${label}</span><b class="${tn}">${note}</b></div><div class="pg-bar ${tn}"><i style="width:${pct}%"></i></div></div>`;

// Tapping a chapter on Progress: Buddy's read of where the chapter stands, its pick for what to do next,
// and every other way to work on it, so the child chooses knowing what each one does.
function chapterSheet(book, c) {
  const T = c.target || 10, learned = !!c.learned, acc = c.done ? Math.round(100 * Math.min(1, c.score.accurate / Math.max(0.01, Math.min(1, c.done / T)))) : null;
  const n = local.count || sessionSize(), name = shortTitle(c.unit.title);
  // where the chapter stands, in plain words (no formula), and what's still to do for 100%
  const fmtD = (t) => new Date(t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
  const now = Date.now(), wk = 7 * DAY, recentTest = c.lastTest && now - c.lastTest < wk, retestAt = c.lastTest + wk;
  // the six steps to 100%, each a tile: done (green), started (amber) or still to do (grey), with one line
  // that says where it stands or what's needed next
  const ST3 = (done, part) => (done ? 'done' : part ? 'part' : 'todo');
  const steps = [
    ['learn', PT('Lesson', '課堂'), ST3(learned, false), learned ? PT('Done', '已完成') : PT('Take the lesson', '上課')],
    ['practise', PT('Practice', '練習'), ST3(c.done >= T && (acc || 0) >= 75, c.done > 0), c.done ? PT(`${c.done}/${T} questions · ${acc}% first try`, `${c.done}/${T} 題 · 第一次答對 ${acc}%`) : PT(`Answer ${T} questions`, `回答 ${T} 題`)],
    ['level', PT('Harder questions', '較深題目'), ST3(c.score.deep >= 1, c.lvTop >= 3), c.score.deep >= 1 ? PT('Analyse level done', '分析程度完成') : c.lvTop >= 3 ? PT('Apply reached · analyse next', '已到應用 · 下一步分析') : PT('Unlocks as you improve', '進步後解鎖')],
    ['mistakes', PT('Mistakes', '錯題'), ST3(c.done > 0 && !c.open, c.open > 0), c.open ? PT(`${c.open} to fix`, `${c.open} 題要改正`) : c.done ? PT('All fixed', '全部改正') : PT('None yet', '暫時沒有')],
    ['review', PT('Memory', '記憶'), ST3(c.score.remembered >= 1, c.done > 0), c.due ? PT(`${c.due} reviews due now`, `${c.due} 題到期溫習`) : c.nextDue < Infinity ? PT(`Next review ${fmtD(c.nextDue)}`, `下次溫習 ${fmtD(c.nextDue)}`) : PT('Right again over 2 weeks', '兩星期內再答對')],
    ['test', PT('Chapter test', '章節測驗'), ST3(c.spread && c.lastPass, c.passes > 0), c.spread && c.lastPass ? PT('Passed twice', '兩次合格') : recentTest ? PT(`Passed ${fmtD(c.lastTest)} · retest ${fmtD(retestAt)}`, `${fmtD(c.lastTest)} 合格 · ${fmtD(retestAt)} 再考`) : c.passes ? PT('Passed once · retest now', '合格一次 · 可再考') : c.tests ? PT('Not passed yet · 80%', '未合格 · 80%') : PT('Pass with 80%', '80% 合格')],
  ];
  const left = steps.filter((x) => x[2] !== 'done').length;
  const LV = [PT('Remember', '記憶'), PT('Understand', '理解'), PT('Apply', '應用'), PT('Analyse', '分析')];
  const ladder = `<section class="cs2-sec"><h3>${PT('Question difficulty level', '題目難度級別')}</h3>
    <div class="cs2-lv">${LV.map((l, i) => `<div class="${i + 1 <= c.lvTop ? 'got' : ''}${i + 1 === c.lvNow ? ' now' : ''}">${i + 1 === c.lvNow ? `<span class="cs2-you">${buddySVG('happy', 30)}</span>` : ''}<i style="height:${10 + i * 6}px"></i><b>${l}</b></div>`).join('')}</div>
    <p class="cs2-sub">${c.done >= 5 ? PT(`Buddy is giving you <b>${LV[c.lvNow - 1].toLowerCase()}</b> questions now. Get 80% right and it steps up; under 50% and it eases off.`, `Buddy 現在給你<b>${LV[c.lvNow - 1]}</b>題目。答對 80% 會升一級；低於 50% 會調低。`) : PT('After 5 questions Buddy starts moving the difficulty up or down to match you.', '做了 5 題之後，Buddy 會按你的表現調高或調低難度。')}</p></section>`;
  // Buddy's pick, in the order a tutor would go
  const retestOK = c.passes && Date.now() >= c.firstPass + 7 * DAY;
  const pick = !learned && !c.done ? 'lesson' : c.open >= 3 ? 'fix' : c.done < Math.ceil(T / 2) || (acc ?? 0) < 60 ? 'practise' : c.due >= 3 ? 'review'
    : (!c.passes || !c.lastPass) && !(c.lastTest && Date.now() - c.lastTest < 2 * DAY) ? 'test' : !c.spread && retestOK ? 'test' : c.score.deep < 1 ? 'practise' : 'review';
  const why = {
    lesson: PT('You haven’t started this chapter. The lesson explains it step by step with quick checks.', '你還未開始這一章。課堂會一步步講解，並有小測。'),
    fix: PT(`You have ${c.open} mistakes open here. Fixing them is the fastest way up.`, `這一章有 ${c.open} 題錯題，改正它們是最快的進步方法。`),
    practise: c.passes && c.score.deep < 1 ? PT('You’ve passed the test. Now the harder apply and analyse questions: Buddy moves you up as you get them right.', '你已通過測驗。接著挑戰較深的應用和分析題，答對了 Buddy 會再調高程度。') : c.done ? PT(`${acc}% right so far over ${c.done} questions. More practice will firm it up${learned ? '' : ', or take the lesson first if it feels shaky'}.`, `目前 ${c.done} 題答對 ${acc}%。多做練習可以鞏固${learned ? '' : '；如果覺得不穩，可以先上課'}。`) : PT('You’ve done the lesson. Now practise so it sticks.', '你已上了課，現在做練習鞏固。'),
    review: !c.due && c.passes && !retestOK ? PT(`Nice work. You tested this recently, so give it a few days. Come back on ${new Date(c.firstPass + 7 * DAY).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' })} to retest and show it stuck. Flashcards keep it fresh meanwhile.`, `做得好！你最近考過，先休息幾日。${new Date(c.firstPass + 7 * DAY).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}再回來考一次，證明記得。期間可以用閃卡保持記憶。`) : PT(`${c.due || 'A few'} questions are due. Getting them right days later is what makes it stick.`, `有 ${c.due || '幾'} 題到期溫習。隔幾日仍答對，才算真正記住。`),
    test: c.tests && !c.lastPass ? PT('Your practice is strong. Try the timed chapter test again: 80% passes.', '練習做得好，再試一次限時章節測驗：80% 合格。') : c.passes ? PT('It’s been a week since you passed. Passing again now shows it has stuck.', '距離上次合格已經一星期，現在再合格一次，證明你真的記住了。') : PT('Your practice is strong. A timed chapter test (like a mock exam) proves it: 80% passes.', '練習做得好。做一次限時章節測驗（像模擬試）來證明：80% 合格。'),
  }[pick];
  const O = [
    ['lesson', 'learn', learned ? PT('Redo the lesson', '重溫課堂') : PT('Take the lesson', '上課'), PT('Step-by-step teaching with quick checks', '一步步講解，附小測'), () => go({ name: 'learn', bookId: book.id, unitId: c.unit.id })],
    ['practise', 'practise', PT(`Practise ${n} questions`, `練習 ${n} 題`), PT('New questions that adapt to you', '會按你的程度調整的新題目'), () => startUnits(book, [c.unit], n)],
    c.open ? ['fix', 'mistakes', PT(`Fix ${c.open} mistakes`, `改正 ${c.open} 題錯題`), PT('Try the ones you got wrong again', '再做一次答錯的題目'), () => go({ name: 'mistakes', book: book.id })] : null,
    c.done ? ['review', 'review', PT(c.due ? `Review ${c.due} due` : 'Review', c.due ? `溫習 ${c.due} 題` : '溫習'), PT('Questions from before, just before you’d forget', '在快忘記前再做以前的題目'), () => startReview('spaced', book.id)] : null,
    ['test', 'test', PT('Chapter test', '章節測驗'), c.lastTest && Date.now() - c.lastTest < 7 * DAY ? PT(`You did one ${new Date(c.lastTest).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' })}. Another now is fine for practice; the one that proves it stuck is from ${new Date(c.lastTest + 7 * DAY).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' })}`, `你在${new Date(c.lastTest).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}做過。現在再做可當練習；${new Date(c.lastTest + 7 * DAY).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}起再做才能證明記得`) : PT('Timed, like a mock exam · 80% passes', '限時，像模擬試 · 80% 合格'), () => startChapterTest(book, [c.unit])],
    c.done >= 3 ? ['drill', 'weak', PT('Drill my weak spots', '針對弱項練習'), PT('New questions on the ideas you got wrong', '針對你答錯的概念出新題目'), async () => {
      const qs = (await getQs(book.id, c.unit.id)).filter((q) => local.stats[q.id] && (local.stats[q.id].last || 0) < 1 && canDrill(q))
        .sort((a, b) => (local.stats[a.id].last || 0) - (local.stats[b.id].last || 0)).slice(0, 6);
      if (!qs.length) return toast(PT('No weak spots in this chapter right now. Nice!', '這一章暫時沒有弱項，做得好！'));
      const idea = (q) => choiceType(q) ? `Question: ${q.stem}\nCorrect answer: ${(q.options || [])['ABCD'.indexOf(q.correct_option)] || ''}\nWhy: ${q.explanation || ''}`
        : `Question: ${writtenStem(q)}\nMarks were for: ${(q.parts || []).flatMap((p) => p.mark_scheme || []).slice(0, 4).join('; ')}\nWhy: ${q.explanation || ''}`;
      startDrills(qs.map((q) => ({ q, idea: idea(q) })), book, 'mix');
    }] : null,
    ['cards', 'flashcards', PT('Flashcards', '閃卡'), PT('Key words and ideas, quick fire', '重點詞語和概念，快速溫習'), () => go({ name: 'cards', bookId: book.id })],
    ['notes', 'notes', PT('Revision notes', '溫習筆記'), PT('The chapter on one page', '一頁看完整章'), () => go({ name: 'notes', bookId: book.id })],
  ].filter(Boolean);
  const best = O.find((o) => o[0] === pick) || O[0], rest = O.filter((o) => o !== best);
  const tone = c.pct >= 70 ? 'hi' : c.pct >= 40 ? 'mid' : 'lo';
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2" role="dialog" aria-modal="true" aria-labelledby="chs-t">
    <header class="cs2-h"><div class="rsg-meter ${tone}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="tr"/><circle cx="18" cy="18" r="15.5" class="fg" stroke-dasharray="${(c.pct * 0.974).toFixed(1)} 100"/></svg><b>${c.pct}%</b></div>
      <div class="cs2-ht"><small data-raw>${esc(book.subject ? subj(book.subject) : book.title)}</small><div class="cs2-tl"><b id="chs-t" data-raw>${esc(name)}</b><span class="cs2-pill ${tone}"><i></i>${esc(masteryLabel(c.pct))}</span></div></div>
      <button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <div class="cs2-body"><div class="cs2-col">
    <section class="cs2-pick"><div class="cs2-pk-h">${buddySVG('happy', 40)}<div><small>${PT('Buddy suggests', 'Buddy 建議')}</small><p>${why}</p></div></div>
      <button class="cs2-go" data-o="0">${actionTile(best[1], 36)}<span><b>${best[2]}</b><em>${best[3]}</em></span><i>›</i></button></section>
    <section class="cs2-sec"><h3>${PT('Or choose for yourself', '或自己選擇')}</h3><div class="cs2-more">${rest.map((o, i) => `<button data-o="${i + 1}">${actionTile(o[1], 32)}<span><b>${o[2]}</b><em>${o[3]}</em></span><i>›</i></button>`).join('')}</div></section>
    </div><div class="cs2-col">
    ${ladder}
    <section class="cs2-sec"><h3>${left ? PT(`${6 - left} of 6 steps to 100%`, `100% 的 6 步中完成了 ${6 - left} 步`) : PT('All 6 steps done: mastered', '6 步全部完成：已掌握')}</h3>
      <div class="cs2-steps">${steps.map(([ic, l, st3, v]) => `<div class="cs2-st s-${st3}"><span class="cs2-ic">${pIcon({ learn: 'book', practise: 'target', level: 'bars', mistakes: 'pencil', review: 'memory', test: 'check' }[ic], 18)}</span><div><b>${l}</b><em>${v}</em></div><i aria-label="${st3}">${st3 === 'done' ? '✓' : ''}</i></div>`).join('')}</div></section>
    </div></div>
  </div>`;
  document.body.appendChild(box);
  const all = [best, ...rest], close = () => box.remove();
  box.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { close(); all[+b.dataset.o][4](); }));
  box.querySelector('.chs-x').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('.cs2-go').focus({ preventScroll: true });
}
// A test's plan: how ready now vs the target, what each chapter needs, and a day-by-day (or week-by-week)
// plan up to the test, with today's step ready to start.
// The day-by-day plan up to a test: what each chapter needs (weakest first), then one job per day.
// Each day's task: [label, run, kind] — kind is learn, practise, test, mixed, mock or test-day.
function testDayPlan(p, chs, aim = 80) {
  const book = p.book, units = p.units, n = local.count || sessionSize(), t0 = dayStart(), left = p.left;
  const nm = (u) => shortTitle(u.title);
  // what each chapter needs, weakest first
  const need = chs.slice().sort((a, b) => a.pct - b.pct).map((c) => {
    const fresh = !c.done && !c.learned;
    const act = fresh ? ['learn', PT('Learn it', '先上課'), () => go({ name: 'learn', bookId: book.id, unitId: c.unit.id })]
      : c.pct < Math.min(aim, 70) || !c.passes ? (c.done >= (c.target || 8) && (c.pct >= 55) && !c.passes ? ['test', PT('Chapter test', '章節測驗'), () => startChapterTest(book, [c.unit])] : ['practise', PT('Practise', '練習'), () => startUnits(book, [c.unit], n)])
      : c.due ? ['review', PT('Review', '溫習'), () => startReview('spaced', book.id)] : ['ok', PT('Keep it fresh', '保持'), () => startUnits(book, [c.unit], 5)];
    return { c, act };
  });
  // the task list, in the order a tutor would go: new chapters, then the weakest, then tests, then mixed practice
  const tasks = [];
  need.filter((x) => x.act[0] === 'learn').forEach((x) => { tasks.push([PT(`Lesson: ${nm(x.c.unit)}`, `上課：${nm(x.c.unit)}`), x.act[2], 'learn']); tasks.push([PT(`Practise ${nm(x.c.unit)}`, `練習：${nm(x.c.unit)}`), () => startUnits(book, [x.c.unit], n), 'practise']); });
  need.filter((x) => x.act[0] === 'practise').forEach((x) => { tasks.push([PT(`Practise ${nm(x.c.unit)} · ${x.c.pct}%`, `練習：${nm(x.c.unit)} · ${x.c.pct}%`), x.act[2], 'practise']); });
  need.filter((x) => !x.c.passes).forEach((x) => tasks.push([PT(`Chapter test: ${nm(x.c.unit)}`, `章節測驗：${nm(x.c.unit)}`), () => startChapterTest(book, [x.c.unit]), 'test']));
  const filler = () => { const w = need[0]; return [PT(`Mixed practice · weakest first`, '混合練習 · 先做最弱'), () => startUnits(book, units, n), 'mixed']; };
  // lay out the days up to the test
  const days = [];
  for (let d = 0; d <= left; d++) {
    const t = t0 + d * DAY;
    let task;
    if (d === left) task = [PT('Test day: 5-question warm-up', '考試日：5 題熱身'), () => startUnits(book, units, 5), 'test-day'];
    else if (d === left - 1 && left >= 2) task = [PT('Practice test on all the chapters (timed)', '所有章節模擬測驗（限時）'), () => startChapterTest(book, units), 'mock'];
    else task = tasks.shift() || filler();
    days.push({ t, d, task });
  }
  return { need, days };
}
function testPlanSheet(p, chs, aim, fc) {
  const book = p.book, units = p.units, n = local.count || sessionSize();
  const fmt = (t, o) => new Date(t).toLocaleDateString(LOCALE(), o || { weekday: 'short', day: 'numeric', month: 'short' });
  const t0 = dayStart(), tday = testDay(p.x), left = p.left;
  const nm = (u) => shortTitle(u.title);
  const { need, days } = testDayPlan(p, chs, aim);
  // chapters listed in textbook order (Unit 1, 2, 3…), not by how much each one needs
  const uIdx = (u) => { const k = (p.book && p.book.units || []).findIndex((x) => x.id === u.id); return k < 0 ? 999 : k; };
  const needInOrder = need.slice().sort((a, b) => uIdx(a.c.unit) - uIdx(b.c.unit));
  const weekly = left > 14;
  const rows = weekly
    ? Array.from({ length: Math.ceil((left + 1) / 7) }, (_, w) => { const part = days.slice(w * 7, w * 7 + 7); return `<div class="tp-row ${w === 0 ? 'now' : ''}"><span class="tp-d"><b>${PT(`Week ${w + 1}`, `第 ${w + 1} 週`)}</b><small>${fmt(part[0].t, { day: 'numeric', month: 'short' })}–${fmt(part[part.length - 1].t, { day: 'numeric', month: 'short' })}</small></span><ul>${[...new Set(part.map((x) => x.task[0]))].slice(0, 4).map((x) => `<li data-raw>${esc(x)}</li>`).join('')}</ul></div>`; }).join('')
    : days.map((x) => `<div class="tp-row ${x.d === 0 ? 'now' : ''} ${x.task[2] || ''}"><span class="tp-d"><b>${x.d === 0 ? PT('Today', '今日') : x.d === 1 ? PT('Tomorrow', '明日') : fmt(x.t, { weekday: 'short' })}</b><small>${fmt(x.t, { day: 'numeric', month: 'short' })}</small></span><span class="tp-t" data-raw>${esc(x.task[0])}</span>${x.d === 0 ? `<button class="btn-sm primary" data-tp="0">${PT('Start', '開始')}</button>` : ''}</div>`).join('');
  const tone = aimTone(fc ?? p.ready ?? 0, aim);
  const gap = Math.max(0, aim - (fc ?? p.ready ?? 0));
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg tp" role="dialog" aria-modal="true" aria-labelledby="tp-t">
    <header class="tp-h"><div><small>${fmt(tday, { weekday: 'long', day: 'numeric', month: 'long' })} · ${leftText(left)}</small><b id="tp-t" data-raw>${esc(p.x.name)}</b></div><span class="pv-pill ${tone}">${{ ok: PT('On track', '進度理想'), close: PT('Close', '接近'), risk: PT('At risk', '需要加把勁') }[tone]}</span><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <div class="tp-body"><div class="tp-col">
      <div class="tp-sum"><div><b>${p.ready}%</b><span>${PT('ready now', '現在')}</span></div><i>→</i><div><b class="fc ${tone}">${fc ?? p.ready}%</b><span>${PT('on test day with the plan', '跟著計劃考試當日')}</span></div><i>·</i><div><b>${aim}%</b><span>${PT('your goal', '你的目標')}</span></div></div>
      <p class="tp-p">${gap ? PT(`About ${gap} points short of your goal at the current pace. Follow the plan and most of that gap closes.`, `按現時進度，距離目標約 ${gap} 分。跟著計劃做，大部分差距都能補回。`) : PT('On course for your goal. The plan keeps it there with practice and a final practice test.', '正朝目標前進。計劃會用練習和最後一次模擬測驗保持狀態。')}</p>
      <h3>${PT('What each chapter needs', '每章需要做甚麼')}</h3>
      <div class="tp-ch">${needInOrder.map((x, i) => `<div class="tp-c"><span><b data-raw>${esc(nm(x.c.unit))}</b><i><em style="width:${x.c.pct}%"></em><s style="left:${aim}%"></s></i></span><strong>${x.c.pct}%</strong><button class="btn-sm ${x.act[0] === 'ok' ? 'quiet' : ''}" data-tc="${i}">${x.act[1]}</button></div>`).join('')}</div>
    </div><div class="tp-col">
      <h3>${weekly ? PT('Week by week', '每週計劃') : PT('Day by day', '每日計劃')}</h3>
      <div class="tp-plan">${rows}</div>
    </div></div></div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector('.cs2-x').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelectorAll('[data-tc]').forEach((b) => (b.onclick = () => { close(); needInOrder[+b.dataset.tc].act[2](); }));
  const st = box.querySelector('[data-tp]'); if (st) st.onclick = () => { close(); days[0].task[1](); };
}
// Tapping "In long-term memory": what it means, where it stands, and the reviews that grow it (nothing starts until asked).
async function memorySheet() {
  const due = (await dueItems()).length, st = Object.values(local.stats || {});
  const lt = st.filter((x) => (x.box || 0) >= 3).length, twk = st.filter((x) => (x.box || 0) >= 5).length;
  const learning = st.filter((x) => (x.box || 0) >= 1 && (x.box || 0) < 3).length;
  const next = st.reduce((m, x) => (x.due && x.due > Date.now() ? Math.min(m, x.due) : m), Infinity);
  const fmt = (t) => new Date(t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2 mem" role="dialog" aria-modal="true" aria-labelledby="mem-t">
    <header class="cs2-h"><div class="cs2-ht"><b id="mem-t">${PT('In long-term memory', '長期記憶')}</b><small>${PT('Things you still get right a week or more later', '一星期或更久之後仍然答對的題目')}</small></div><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <section class="cs2-sec" style="padding-top:0"><div class="mem-g">
      <div><b>${learning}</b><span>${PT('still settling in', '正在鞏固')}</span></div>
      <div class="ok"><b>${lt}</b><span>${PT('in long-term memory', '已進入長期記憶')}</span></div>
      <div class="ok2"><b>${twk}</b><span>${PT('of those, still right after 2+ weeks', '其中兩星期後仍答對')}</span></div>
    </div>
    <p class="cs2-sub">${PT('Questions come back after 1, 3, 7, 14 and 30 days. Each time you get one right it waits longer; get it wrong and it starts again. Once a question has been right on its first try and in the next two reviews, it counts as in long-term memory.', '題目會在 1、3、7、14、30 日後再出現。答對了，下次會隔更久；答錯了就重新開始。這樣才能把知識存進長期記憶。')}</p></section>
    <section class="cs2-pick" style="margin-top:14px;margin-bottom:20px">${due ? `<button class="cs2-go" data-o="0">${actionTile('review', 36)}<span><b>${PT(`Review ${due} due now`, `溫習 ${due} 題到期題目`)}</b><em>${PT('A few minutes · just before you’d forget them', '幾分鐘 · 在快忘記之前')}</em></span><i>›</i></button>`
      : `<p class="mem-none">${next < Infinity ? PT(`Nothing due right now. Next review: ${fmt(next)}.`, `暫時沒有到期的題目。下次溫習：${fmt(next)}。`) : PT('Practise a chapter and its questions start coming back for review.', '練習一個章節後，題目就會開始回來讓你溫習。')}</p>`}</section>
  </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector('.cs2-x').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  const go = box.querySelector('[data-o]'); if (go) { go.onclick = () => { close(); reviewSheet(); }; go.focus({ preventScroll: true }); }
}
// Before a review: what reviews are, which chapters these ones come from, how long they've waited, then Start
async function reviewSheet() {
  const zh = LANG === 'zh', due = await dueItems(), t0 = startOfToday(), cap = 15;
  if (!due.length) return toast(PT('Nothing to review right now.', '暫時沒有要溫習的題目。'));
  const wait = (x) => Math.max(0, Math.round((t0 - local.stats[x.q.id].due) / DAY));
  const over = due.filter((x) => wait(x) >= 2).length, oldest = wait(due[0]);
  const pick = due.slice(0, cap), mins = Math.max(3, Math.round(pick.length * 0.6));
  const by = new Map(); pick.forEach((x) => { const k = `${x.book.id}:${x.unit.id}`; const g = by.get(k) || { x, n: 0, w: 0, wrong: 0 }; g.n++; g.w = Math.max(g.w, wait(x)); if ((local.stats[x.q.id].box || 1) === 1) g.wrong++; by.set(k, g); });
  const rows = [...by.values()].sort((a, b) => b.w - a.w || b.n - a.n);
  const wtxt = (w) => (w === 0 ? PT('due today', '今日到期') : PT(`waiting ${w} day${w === 1 ? '' : 's'}`, `等了 ${w} 日`));
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2 mem rvs" role="dialog" aria-modal="true" aria-labelledby="rvs-t">
    <header class="cs2-h"><div class="cs2-ht"><b id="rvs-t">${PT('Your reviews', '你的溫習')}</b><small>${PT('Questions you’ve done before, coming back to check you still remember', '做過的題目再出現，看看你是否仍然記得')}</small></div><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <section class="cs2-sec" style="padding-top:0">
      <ol class="rvs-how"><li><b>1</b><span>${PT('You answer a question', '你答一條題目')}</span></li><li><b>2</b><span>${PT('It comes back after a gap: 1, 3, 7, 14, then 30 days', '它會隔一段時間再出現：1、3、7、14，然後 30 日')}</span></li><li><b>3</b><span>${PT('Right: the gap gets longer. Wrong: back tomorrow', '答對：隔更久。答錯：明天再來')}</span></li></ol>
      <div class="mem-g">
        <div><b>${due.length}</b><span>${PT('due now', '現在到期')}</span></div>
        <div class="${over ? 'bad' : ''}"><b>${over}</b><span>${PT('overdue (waiting 2+ days)', '過期（等了 2 日以上）')}</span></div>
        <div class="${oldest >= 2 ? 'bad' : ''}"><b>${oldest}</b><span>${PT(`day${oldest === 1 ? '' : 's'} the oldest has waited`, '日：最久的已等了')}</span></div>
      </div>
      ${over ? `<p class="cs2-sub">${PT('<b>Overdue</b> means the day it was meant to come back has passed. The longer it waits, the more likely it’s been forgotten, so the oldest go first.', '<b>過期</b>即是本來應該再出現的日子已經過了。等得越久，越可能已經忘記，所以最舊的先做。')}</p>` : ''}
    </section>
    <section class="cs2-sec"><h3 class="rvs-h">${PT(`In this review (${pick.length} question${pick.length === 1 ? '' : 's'}, oldest first)`, `今次溫習（${pick.length} 題，最舊的先做）`)}</h3>
      <ul class="rvs-list">${rows.map((g) => `<li><span class="rvs-s">${esc(g.x.book.subject ? subj(g.x.book.subject) : shortTitle(g.x.book.title))}</span><b data-raw>${esc(shortTitle(g.x.unit.title))}</b><small>${PT(`${g.n} question${g.n === 1 ? '' : 's'}`, `${g.n} 題`)} · ${wtxt(g.w)}${g.wrong ? ` · ${PT(`${g.wrong} you got wrong last time`, `${g.wrong} 題上次答錯`)}` : ''}</small></li>`).join('')}</ul>
      ${due.length > pick.length ? `<p class="cs2-sub">${PT(`The other ${due.length - pick.length} will be in your next review.`, `其餘 ${due.length - pick.length} 題會在下次溫習。`)}</p>` : ''}
    </section>
    <section class="cs2-pick" style="margin:6px 0 18px"><button class="cs2-go" data-o="0">${actionTile('review', 36)}<span><b>${PT('Start review', '開始溫習')}</b><em>${PT(`${pick.length} questions · about ${mins} min`, `${pick.length} 題 · 大約 ${mins} 分鐘`)}</em></span><i>›</i></button></section>
  </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector('.cs2-x').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  const go = box.querySelector('[data-o]'); go.onclick = () => { close(); startReview('spaced', null, cap); }; go.focus({ preventScroll: true });
}
// Tapping "Days practised": the last 4 weeks as a calendar (tap a day for its minutes and questions),
// streaks, this week vs last, the weekly goal, the best time of day, and a button if today is still empty.
function daysSheet() {
  const t0 = dayStart(), now = Date.now(), L = local.log;
  const byDay = new Map(); L.forEach((e) => { const d = dayStart(e.t); const x = byDay.get(d) || []; x.push(e); byDay.set(d, x); });
  const mon = t0 - ((new Date(t0).getDay() + 6) % 7) * DAY, start = mon - 3 * 7 * DAY;
  const fmt = (t, o) => new Date(t).toLocaleDateString(LOCALE(), o);
  const info = (d) => { const es = byDay.get(d) || [], m = es.reduce((a, e) => a + (e.m || 0), 0); return { q: es.length, min: minutesOf(es), acc: m ? Math.round(100 * es.reduce((a, e) => a + (e.g || 0), 0) / m) : null }; };
  const shade = (q) => (!q ? 0 : q < 10 ? 1 : q < 20 ? 2 : q < 40 ? 3 : 4);
  // what was done on a day, as three small tiles under the day's name
  const dayInfo = (d) => { const x = info(d), lab = d === t0 ? PT('Today', '今日') : fmt(d, { weekday: 'long', day: 'numeric', month: 'short' });
    return `<small class="ds-il">${lab}</small>${x.q ? `<div class="ds-it"><div><b>${x.min}</b><span>${PT('minutes', '分鐘')}</span></div><div><b>${x.q}</b><span>${PT('questions', '題目')}</span></div><div class="${x.acc >= 70 ? 'ok' : x.acc != null && x.acc < 50 ? 'lo' : ''}"><b>${x.acc != null ? x.acc + '%' : '–'}</b><span>${PT('right', '答對')}</span></div></div>` : `<p class="ds-none">${d === t0 ? PT('No practice yet today. Tap any day above to see it.', '今日仍未練習。按上面任何一日查看。') : PT('No practice this day.', '這一日沒有練習。')}</p>`}`; };
  const cells = Array.from({ length: 28 }, (_, i) => { const d = start + i * DAY, x = info(d), fut = d > t0;
    return `<button class="ds-day s${fut ? 'f' : shade(x.q)} ${d === t0 ? 'tod' : ''}" ${fut ? 'disabled' : ''} data-d="${d}"><span>${new Date(d).getDate()}</span></button>`; }).join('');
  let streak = 0; for (let d = byDay.has(t0) ? t0 : t0 - DAY; byDay.has(d); d -= DAY) streak++;
  const allDays = [...byDay.keys()].sort((a, b) => a - b); let best = 0, run = 0, prev = 0;
  allDays.forEach((d) => { run = prev && d - prev <= DAY + 3600e3 ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  const wk = (a, b) => { const es = L.filter((e) => e.t >= a && e.t < b); return { d: new Set(es.map((e) => dayStart(e.t))).size, min: minutesOf(es), q: es.length }; };
  const thisW = wk(mon, t0 + DAY), lastW = wk(mon - 7 * DAY, t0 + DAY - 7 * DAY); // same days of last week, so it's a fair comparison
  const cmp = (a, b) => (a > b ? `<em class="up">${PT(`▲ was ${b}`, `▲ 之前 ${b}`)}</em>` : a < b ? `<em class="down">${PT(`▼ was ${b}`, `▼ 之前 ${b}`)}</em>` : `<em>${PT('same', '一樣')}</em>`);
  const band = {}; L.filter((e) => e.t > now - 30 * DAY).forEach((e) => { const h = Math.floor(new Date(e.t).getHours() / 2) * 2; const x = band[h] || (band[h] = [0, 0, 0]); x[0] += e.g || 0; x[1] += e.m || 0; x[2]++; });
  const bands = Object.entries(band).filter(([, x]) => x[2] >= 20 && x[1]).map(([h, x]) => [+h, x[0] / x[1]]).sort((a, b) => b[1] - a[1]);
  const fmtH = (h) => (LANG === 'zh' ? `${h}:00` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`);
  const G = goalWeek(), today = info(t0);
  const days28 = Array.from({ length: 28 }, (_, i) => t0 - i * DAY).filter((d) => byDay.has(d)).length;
  const dow = Array.from({ length: 7 }, (_, i) => fmt(mon + i * DAY, { weekday: 'narrow' }));
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2 ds" role="dialog" aria-modal="true" aria-labelledby="ds-t">
    <header class="cs2-h"><div class="cs2-ht"><b id="ds-t">${PT(`Practised ${days28} of the last 28 days`, `過去 28 日中練習了 ${days28} 日`)}</b><small>${PT('A little most days beats a lot once a week', '每天少少，勝過一星期一次做很多')}</small></div><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <div class="ds-body">
      <section class="ds-cal"><div class="ds-dow">${dow.map((x) => `<span>${x}</span>`).join('')}</div><div class="ds-grid">${cells}</div>
        <div class="ds-info" id="ds-info">${dayInfo(t0)}</div></section>
      <section class="ds-side">
        <div class="ds-st"><div><b>${streak}</b><span>${PT('day streak now', '日連續')}</span></div><div><b>${best}</b><span>${PT('best streak', '最長連續')}</span></div></div>
        <div class="ds-wk"><h3>${PT('This week vs the same days last week', '本週 vs 上週同期')}</h3>
          <div><span>${PT('Days', '日數')}</span><b>${thisW.d}</b>${cmp(thisW.d, lastW.d)}</div>
          <div><span>${PT('Minutes', '分鐘')}</span><b>${thisW.min}</b>${cmp(thisW.min, lastW.min)}</div>
          <div><span>${PT('Questions', '題目')}</span><b>${thisW.q}</b>${cmp(thisW.q, lastW.q)}</div></div>
        ${G ? `<div class="ds-goal"><h3>${PT('Weekly goal', '每週目標')}</h3><b>${G.reached ? PT('Reached this week!', '本週已達成！') : PT(`${G.met} of ${G.days} days done`, `已完成 ${G.met}／${G.days} 日`)}</b><span>${PT(`${G.days} days a week, ${G.mins} min each`, `每星期 ${G.days} 日，每次 ${G.mins} 分鐘`)}</span><button class="btn-sm quiet" data-ds="goal">${PT('Change goal', '修改目標')}</button></div>`
          : `<div class="ds-goal"><h3>${PT('Weekly goal', '每週目標')}</h3><span>${PT('Pick how many days a week. Reaching it earns bonus stars.', '選擇每星期練習幾日，達成可得額外星星。')}</span><button class="btn-sm primary" data-ds="goal">${PT('Set a weekly goal', '設定每週目標')}</button></div>`}
        ${bands.length >= 2 ? `<p class="ds-best">${PT(`Best time to practise: <b>${fmtH(bands[0][0])}–${fmtH((bands[0][0] + 2) % 24)}</b>. Scores are highest then.`, `最好的練習時段：<b>${fmtH(bands[0][0])}–${fmtH((bands[0][0] + 2) % 24)}</b>，這段時間分數最高。`)}</p>` : ''}
      </section>
    </div>
    ${!today.q ? `<section class="cs2-pick ds-go"><button class="cs2-go" data-o="go">${actionTile('practise', 36)}<span><b>${PT('Practise now', '現在練習')}</b><em>${PT('Today’s mission keeps the streak going', '完成今日任務，保持連續')}</em></span><i>›</i></button></section>` : ''}
  </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector('.cs2-x').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelectorAll('.ds-day[data-d]').forEach((b) => (b.onclick = () => {
    box.querySelectorAll('.ds-day.on').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    box.querySelector('#ds-info').innerHTML = dayInfo(+b.dataset.d);
  }));
  const g = box.querySelector('[data-ds="goal"]'); if (g) g.onclick = () => { close(); goalDialog(); };
  const p = box.querySelector('[data-o="go"]'); if (p) p.onclick = () => { close(); go({ name: 'home' }); };
}
// Tapping "Overall readiness": each subject's readiness, and the chapters worth doing next (plain words, no recipe).
function readySheet(subs, overall) {
  const sname2 = (b) => (b.subject ? subj(b.subject) : b.title), nm = (u) => shortTitle(u.title);
  const all = subs.flatMap((x) => x.m.chapters.map((c) => ({ b: x.b, c })));
  const weak = all.filter((x) => x.c.done && x.c.pct < 80).sort((a, b) => a.c.pct - b.c.pct)[0];
  const close = all.filter((x) => x.c.pct >= 50 && x.c.pct < 80).sort((a, b) => b.c.pct - a.c.pct)[0];
  const fresh = all.find((x) => !x.c.done && !x.c.learned);
  const tone = (p) => (p >= 70 ? 'hi' : p >= 40 ? 'mid' : 'lo');
  const acts = [weak && [weak, 'target', PT(`Practise ${nm(weak.c.unit)}`, `練習「${nm(weak.c.unit)}」`), PT(`Your weakest chapter · ${weak.c.pct}%`, `最弱的章節 · ${weak.c.pct}%`)],
    close && close !== weak && [close, 'up', PT(`Finish off ${nm(close.c.unit)}`, `完成「${nm(close.c.unit)}」`), PT(`Closest to strong · ${close.c.pct}%`, `最接近掌握 · ${close.c.pct}%`)],
    fresh && [fresh, 'book', PT(`Start ${nm(fresh.c.unit)}`, `開始「${nm(fresh.c.unit)}」`), PT(`A new chapter in ${sname2(fresh.b)}`, `${sname2(fresh.b)}的新章節`)]].filter(Boolean);
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2 rs" role="dialog" aria-modal="true" aria-labelledby="rs-t">
    <header class="cs2-h"><div class="rsg-meter ${tone(overall)}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="tr"/><circle cx="18" cy="18" r="15.5" class="fg" stroke-dasharray="${(overall * 0.974).toFixed(1)} 100"/></svg><b>${overall}%</b></div>
      <div class="cs2-ht"><b id="rs-t">${PT('Overall readiness', '整體準備度')}</b><small>${PT('How much of your textbooks you really know. Subjects with a test coming up count more.', '你真正掌握多少課本內容。快要考試的科目佔比較大。')}</small></div><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <section class="cs2-sec" style="padding-top:0"><h3>${PT('Readiness in each subject', '各科準備度')}</h3><div class="rs-subs">${subs.map((x) => `<span data-raw>${esc(sname2(x.b))}</span><i><em class="${tone(x.pct)}" style="width:${x.pct}%"></em></i><b>${PT(`${x.pct}% ready`, `準備度 ${x.pct}%`)}</b>`).join('')}</div></section>
    ${acts.length ? `<section class="cs2-sec"><h3>${PT('Best next steps', '最好的下一步')}</h3><div class="cs2-more">${acts.map(([x, ic, t, sub], i) => `<button data-o="${i}">${actionTile(ic === 'up' ? 'test' : ic === 'book' ? 'learn' : 'practise', 32)}<span><b data-raw>${esc(t)}</b><em data-raw>${esc(sub)}</em></span><i>›</i></button>`).join('')}</div></section>` : ''}
  </div>`;
  document.body.appendChild(box);
  const close2 = () => box.remove();
  box.querySelector('.cs2-x').onclick = close2; box.onclick = (e) => { if (e.target === box) close2(); };
  box.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { const x = acts[+b.dataset.o][0]; close2(); chapterSheet(x.b, x.c); }));
}
// Tapping "Chapters mastered": how many per subject, and the chapters closest to getting there.
function masteredSheet(subs, done, all) {
  const sname2 = (b) => (b.subject ? subj(b.subject) : b.title), nm = (u) => shortTitle(u.title);
  const near = subs.flatMap((x) => x.m.chapters.map((c) => ({ b: x.b, c }))).filter((x) => x.c.pct < 80 && (x.c.done || x.c.learned)).sort((a, b) => b.c.pct - a.c.pct).slice(0, 3);
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg cs2 rs" role="dialog" aria-modal="true" aria-labelledby="ms-t">
    <header class="cs2-h"><div class="cs2-ht"><b id="ms-t">${PT(`${done} of ${all} chapters mastered`, `${all} 章中掌握了 ${done} 章`)}</b><small>${PT('Mastered means passed the test, handled the harder questions, and still remembered it later. It takes a few weeks per chapter, on purpose.', '掌握代表通過測驗、應付到較深題目，而且之後仍記得。每章需要幾個星期，這是刻意的。')}</small></div><button class="chs-x cs2-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
    <section class="cs2-sec" style="padding-top:0"><h3>${PT('Chapters mastered in each subject', '各科已掌握的章節')}</h3><div class="rs-subs">${subs.map((x) => { const n = x.m.chapters.length, d = x.m.chapters.filter((c) => c.pct >= 80).length;
      return `<span data-raw>${esc(sname2(x.b))}</span><i><em class="hi" style="width:${n ? Math.round(100 * d / n) : 0}%"></em></i><b>${PT(`${d} of ${n}`, `${d}／${n}`)}</b>`; }).join('')}</div></section>
    ${near.length ? `<section class="cs2-sec"><h3>${PT('Closest to mastered', '最接近掌握')}</h3><div class="cs2-more">${near.map((x, i) => `<button data-o="${i}">${actionTile('test', 32)}<span><b data-raw>${esc(nm(x.c.unit))}</b><em data-raw>${esc(sname2(x.b))}</em></span><strong class="rs-pct">${x.c.pct}%</strong><i>›</i></button>`).join('')}</div></section>`
      : `<section class="cs2-sec"><p class="cs2-sub">${PT('Start practising a chapter and it will show up here.', '開始練習一章，就會在這裡出現。')}</p></section>`}
  </div>`;
  document.body.appendChild(box);
  const close2 = () => box.remove();
  box.querySelector('.cs2-x').onclick = close2; box.onclick = (e) => { if (e.target === box) close2(); };
  box.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { const x = near[+b.dataset.o]; close2(); chapterSheet(x.b, x.c); }));
}
// The full school-test card (goal slider with Buddy, test-day forecast, Buddy's plan, chapter rows, My plan, edit).
// It lives on Today, where the child acts on it; Progress shows a simpler on-track summary.
let tcFcLine = null;
async function fullTestCards(tests, btn) {
  const MB = new Map(); for (const p of tests.steps) if (p.book && !MB.has(p.book.id)) MB.set(p.book.id, await bookMastery(p.book));
  const chName = (u) => shortTitle(u.title);
  const fresh = (c) => !c.done && !c.tests && !c.learned;
  const fcLocked = locked('forecast');
  const fmtDay = (t) => new Date(t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
  // each test chapter with its own readiness, so it's clear what the number is made of
  const chOf = (p) => (p.book && p.units && p.units.length ? MB.get(p.book.id).chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)) : []);
  // each test chapter as one slim row (name, %, bar), weakest first; past 3 the rest fold behind a button
  // the test's chapters in book order; past 4 the rest fold behind a "+N more" row at the bottom of the list
  const chipsOf = (p) => { const order = p.book ? p.book.units.map((u) => u.id) : [], cs = chOf(p).slice().sort((a, b) => order.indexOf(a.unit.id) - order.indexOf(b.unit.id));
    if (!cs.length || (p.x.kind || 'test') === 'dict') return '';
    const SHOWN = 4, more = cs.length - SHOWN;
    const row = (c, hid) => `<div class="pv-tr ${c.pct >= 70 ? 'good' : c.pct >= 40 ? 'mid' : c.pct > 0 ? 'low' : 'zero'}${hid ? ' hid' : ''}"><span data-raw>${esc(chName(c.unit))}</span><em>${c.done ? `${c.pct}%` : c.learned ? PT(`Lesson · ${c.pct}%`, `已上課 · ${c.pct}%`) : PT('Not started', '未開始')}</em><i><b style="width:${c.pct}%"></b></i></div>`;
    const id = `tch${p.x.id}`.replace(/\W/g, ''), lab = PT(`+ ${more} more chapter${more === 1 ? '' : 's'}`, `+ 還有 ${more} 章`);
    return `<div class="pv-tch" id="${id}">${cs.map((c, i) => row(c, i >= SHOWN && more > 1)).join('')}${more > 1 ? btn(lab, () => {
      const el = document.getElementById(id), open = el.classList.toggle('open'), bt = el.querySelector('.pv-tmore');
      if (bt) bt.textContent = open ? PT('Show fewer', '顯示較少') : lab; }, 'pv-tmore') : ''}</div>`; };
  // practice that went on other chapters of the same book doesn't move this test's number: say so
  const outside = (p) => { if (!p.book || p.all) return ''; const cs = chOf(p); if (!cs.length) return '';
    const other = MB.get(p.book.id).chapters.filter((c) => (c.done || c.learned) && !p.units.some((u) => u.id === c.unit.id));
    if (!other.length || cs.some((c) => c.done)) return '';
    return `<p class="pv-out">ⓘ ${PT(`Your practice so far was on ${other.slice(0, 2).map((c) => chName(c.unit)).join(' and ')}, which ${other.length > 1 ? 'aren’t' : 'isn’t'} in this test. If the test covers ${other.length > 1 ? 'them' : 'it'}, tap Edit and add ${other.length > 1 ? 'them' : 'it'}.`, `你目前練習的是${other.slice(0, 2).map((c) => `「${chName(c.unit)}」`).join('和')}，不在這個測驗範圍內。如果測驗包括，請按「修改」加入。`)}</p>`; };
  // one plain sentence under each test bar: where it's heading, or why there's no forecast yet, and what it would take
  // under each test bar, Buddy as a coach: honest about where the usual pace lands, then the plan to make the goal
  const fcLine = (ready, aim, left, I) => {
    const E = esc, li = (t) => `<li>${t}</li>`, box = (head, steps, extra = '') => `<div class="pv-coach"><div><b>${head}</b>${steps.length ? `<ol>${steps.map(li).join('')}</ol>` : ''}${extra}</div></div>`;
    if (ready >= aim) return box(E(PT(`You’ve reached your ${aim}% goal. Nice work!`, `已達到 ${aim}% 目標，做得好！`)), [E(PT('Keep it there with short reviews every few days.', '每隔幾日做短時間溫習，保持狀態。'))]);
    const ord = I.names.map((n, k) => [n, I.pcts[k]]).sort((a, b) => a[1] - b[1]);
    const todayStep = ord.length ? (ord[0][1] === 0 ? PT(`Today: take the lesson on ${ord[0][0]}. It’s not started yet.`, `今天：先上「${ord[0][0]}」這一課，還未開始。`) : PT(`Today: practise ${ord[0][0]}, your weakest chapter (${ord[0][1]}%).`, `今天：練習最弱的「${ord[0][0]}」（${ord[0][1]}%）。`)) : '';
    const testStep = left >= 2 ? PT(`${I.prev}: a practice test, so test day feels familiar.`, `${I.prev}：做一次模擬測驗，考試時更有把握。`) : '';
    if (I.lock) return box(E(PT(`Here’s how to reach ${aim}%`, `這樣做就能達到 ${aim}%`)), [todayStep, testStep].filter(Boolean).map(E));
    const usual = Math.max(1, Math.round(left * I.habit)), dayW = (n) => (n >= left ? PT('every day', '每天') : PT(`on ${n} of the ${left} days left`, `餘下 ${left} 日中的 ${n} 日`));
    const mins = (sets, days) => Math.max(10, Math.round((sets * SET_MIN) / Math.max(1, days) / 5) * 5);
    const N = planNeeds(ready, I.pcts, left, aim), easy = N.sets <= Math.round(left * I.habit * 2);
    const days = easy || Math.ceil(N.sets / usual) <= 3 ? usual : left, m = mins(N.sets, days);
    const how = m > 40 ? PT(`Practise ${dayW(days)} for about ${m} minutes, split into two sessions (after school and after dinner works well). Buddy’s plan picks what to do in each one.`, `${dayW(days)}練習大約 ${m} 分鐘，分兩次做（例如放學後和晚飯後）。Buddy 的計劃會安排每次做甚麼。`)
      : PT(`Practise ${dayW(days)} for about ${m} minutes. Buddy’s plan picks what to do each day.`, `${dayW(days)}練習大約 ${m} 分鐘，Buddy 的計劃會安排每天做甚麼。`);
    const steps = [how, todayStep, PT('Every wrong answer goes into your Mistake book. Fix them the next day so they don’t cost marks twice.', '答錯的題目會放進錯題簿，第二天改正，就不會再失分。'), testStep].filter(Boolean).map(E);
    if (easy) return box(E(PT(`You’re on track for ${aim}%. Keep it up!`, `你正朝 ${aim}% 進發，繼續努力！`)), steps.filter((x, k) => k !== 2));
    const push = I.fc + 15 < aim;
    return box(E(push ? PT(`At your usual pace you’d reach about ${I.fc}%. ${aim}% means stepping it up, and we can do it together. Here’s the plan:`, `照平時的步伐，考試時約 ${I.fc}%。要達到 ${aim}% 就要加把勁，我們一起做得到。計劃是這樣：`)
      : PT(`At your usual pace you’d reach about ${I.fc}%, close to your ${aim}% goal. A bit more each day gets you there. Here’s the plan:`, `照平時的步伐，考試時約 ${I.fc}%，接近 ${aim}% 目標。每天多做一點就能達到。計劃是這樣：`)), steps);
  };
  tcFcLine = fcLine;
  return tests.steps.map((p, ti) => {
    const habit = practiceHabit(), fc = p.ready == null ? null : planForecast(p.ready, chOf(p), p.left, habit);
    const fcI = { pcts: chOf(p).map((c) => c.pct || 0), names: chOf(p).map((c) => chName(c.unit)), habit, fc, lock: !!fcLocked, prev: fmtDay(testDay(p.x) - DAY) };
    const aim = p.x.aim || 80; // the parent's target for this test, set with the slider
    const st = p.ready == null ? 'none' : aimTone(fc ?? p.ready, aim);
    const stLab = { ok: PT('On track', '進度理想'), close: PT('Close', '接近'), risk: PT('At risk', '需要加把勁'), none: PT('Not started', '未開始') }[st];
    const steps = [];
    if (p.book && p.units && p.units.length && (p.x.kind || 'test') !== 'dict') {
      const m = MB.get(p.book.id), chs = m.chapters.filter((c) => p.units.some((u) => u.id === c.unit.id));
      chs.filter(fresh).slice(0, 2).forEach((c) => steps.push(PT(`Learn ${chName(c.unit)} · not started`, `學習「${chName(c.unit)}」· 未開始`)));
      const weak = chs.filter((c) => !fresh(c) && c.pct < 70).sort((a, b) => a.pct - b.pct)[0];
      if (weak) steps.push(PT(`Practise ${chName(weak.unit)} · ${weak.pct}%`, `練習「${chName(weak.unit)}」· ${weak.pct}%`));
      if (p.left >= 2) steps.push(PT(`Practice test on ${fmtDay(testDay(p.x) - DAY)}`, `${fmtDay(testDay(p.x) - DAY)} 做模擬測驗`));
    }
    const what = p.ready == null ? PT('Add the textbook so Buddy can get you ready.', '加入課本，Buddy 便可幫你準備。')
      : fcLocked || fc === p.ready ? (st === 'ok' ? PT('Ready already. Short reviews keep it there.', '已經準備好，短時間溫習保持狀態。') : PT(`Aim for 80% by test day.`, '目標：考試前達到 80%。'))
      : st === 'ok' ? PT(`With the plan you’ll reach about ${fc}%. Short reviews keep it there; Today’s mission takes care of it.`, `按現時進度，考試時約 ${fc}%。今日任務會安排溫習，保持狀態。`)
      : PT(`With the plan you’ll reach about ${fc}%. Aim for 80%.`, `按現時進度，考試時約 ${fc}%。目標 80%。`);
    const bar = p.ready == null ? '' : `<div class="pv-track"><div class="pv-num"><b>${p.ready}%</b><span>${PT('ready now', '現在')}</span></div>
      <div class="pv-bar ${st}"><i style="width:${p.ready}%"></i>${!fcLocked && fc > p.ready ? `<em style="left:${p.ready}%;width:${fc - p.ready}%"></em>` : ''}<span class="pv-flag" style="left:${aim}%;--a:${aim}"><span class="pv-fbud">${buddySVG('happy', 30)}</span><b>${PT(`Goal ${aim}%`, `目標 ${aim}%`)}</b></span><input type="range" class="pv-aim" min="0" max="100" step="5" value="${aim}" data-aim="${esc(p.x.id)}" data-fc="${fc ?? p.ready}" aria-label="${PT('Goal for this test', '這個測驗的目標')}"></div>
      ${fcLocked ? btn(`🔒 ${PT('Test-day forecast', '考試日預測')}`, () => go({ name: 'plans', hi: 'pro' }), 'pv-lockfc') : `<div class="pv-num"><b class="fc ${st}">${fc}%</b><span>${PT('on test day', '考試當日')}</span></div>`}</div>`;
    const coach = p.ready == null ? '' : `<div class="pv-fcline" data-ready="${p.ready}" data-left="${p.left}" data-info="${esc(JSON.stringify(fcI))}">${fcLine(p.ready, aim, p.left, fcI)}</div>`;
    return `<div class="pv-test ${st}"><div class="pv-test-h"><div><b data-raw>${esc(p.x.name)}</b><span>${fmtDay(testDay(p.x))} · ${leftText(p.left)}${p.book ? ` · <span data-raw>${esc(testScope(p))}</span>` : ''}</span></div><em class="pv-pill ${st}">${stLab}</em></div>
      ${bar}${p.ready != null && ti === 0 ? `<p class="pv-aimhint">${PT('Slide Buddy to set your own goal for this test.', '拖動 Buddy，為這個測驗設定你自己的目標。')}</p>` : ''}${coach}${chipsOf(p)}${p.ready == null ? `<p class="pv-p">${what}</p>` : ''}
      <div class="pv-test-f">${p.book && p.ready != null && (p.x.kind || 'test') !== 'dict' ? btn(PT('My plan for this test', '這個測驗的計劃'), () => testPlanSheet(p, chOf(p), (local.sched || []).find((y) => y.id === p.x.id)?.aim || 80, fc), 'pv-btn primary') : p.step ? btn(esc(p.step.t), p.step.run, 'pv-btn primary') : ''}${btn(`${pIcon('pencil', 18)}<span class="sr">${PT('Edit test', '修改測驗')}</span>`, () => testDialog((local.sched || []).find((x) => x.id === p.x.id)), 'pv-btn quiet pv-edit')}</div></div>`;
  });
}
// goal sliders on the full test cards: move the line and the status live; save when let go
function bindTestCards(root) {
  root.querySelectorAll('.pv-aim').forEach((r) => {
    const card = r.closest('.pv-test'), bar = r.closest('.pv-bar'), fc = +r.dataset.fc;
    const LAB = { ok: PT('On track', '進度理想'), close: PT('Close', '接近'), risk: PT('At risk', '需要加把勁') };
    const show = () => { if (+r.value < 50) r.value = 50; const a = +r.value, t = aimTone(fc, a); const fl = bar.querySelector('.pv-flag'); fl.style.left = a + '%'; fl.style.setProperty('--a', a); fl.querySelector('b').textContent = PT(`Goal ${a}%`, `目標 ${a}%`);
      ['ok', 'close', 'risk'].forEach((k) => { card.classList.toggle(k, k === t); bar.classList.toggle(k, k === t); }); const pill = card.querySelector('.pv-pill'); if (pill) { pill.className = `pv-pill ${t}`; pill.textContent = LAB[t]; }
      const f = card.querySelector('.pv-num .fc'); if (f) f.className = `fc ${t}`;
      const ln = card.querySelector('.pv-fcline'); if (ln) { ln.innerHTML = tcFcLine(+ln.dataset.ready, a, +ln.dataset.left, JSON.parse(ln.dataset.info)); bindSet(); } };
    const bindSet = () => card.querySelectorAll('[data-setaim]').forEach((b) => (b.onclick = () => { r.value = b.dataset.setaim; r.onchange(); }));
    r.oninput = show; r.onpointerdown = () => bar.classList.add('drag'); r.onpointerup = r.onblur = () => bar.classList.remove('drag');
    // nothing is saved until it's confirmed: a slip of the finger while scrolling is easy to undo
    const saved = () => { const x = (local.sched || []).find((y) => y.id === r.dataset.aim); return (x && x.aim) || 80; };
    r.onchange = () => {
      show();
      let cf = card.querySelector('.pv-aimok'); const a = +r.value, was = saved();
      if (a === was) { if (cf) cf.remove(); return; }
      if (!cf) { cf = document.createElement('div'); cf.className = 'pv-aimok'; (bar.closest('.pv-track') || bar).after(cf); }
      cf.innerHTML = `<span>${PT(`Change the goal from ${was}% to ${a}%?`, `把目標由 ${was}% 改為 ${a}%？`)}</span><button type="button" class="btn-sm" data-k="no">${PT(`Keep ${was}%`, `保留 ${was}%`)}</button><button type="button" class="btn-sm primary" data-k="yes">${PT(`Set ${a}%`, `設為 ${a}%`)}</button>`;
      cf.querySelector('[data-k="no"]').onclick = () => { r.value = was; show(); cf.remove(); };
      cf.querySelector('[data-k="yes"]').onclick = () => {
        const x = (local.sched || []).find((y) => y.id === r.dataset.aim); if (x) { x.aim = a; saveLocal(); }
        cf.remove(); toast(PT(`Goal set to ${a}%`, `目標已設為 ${a}%`));
        // Today's mission and minutes follow the goal: redraw, staying where the child was on the page
        if (view && view.name === 'home') { const id = r.dataset.aim, top = card.getBoundingClientRect().top; renderHome().then(() => { const c = [...document.querySelectorAll('.pv-aim')].find((e) => e.dataset.aim === id), t = c && c.closest('.pv-test'); if (!t) return; const keep = () => window.scrollTo(0, window.scrollY + t.getBoundingClientRect().top - top); keep(); requestAnimationFrame(keep); t.classList.add('aim-saved'); setTimeout(() => t.classList.remove('aim-saved'), 1200); }); }
      };
    };
    bindSet();
  });
}
// On track / close / at risk, against the target the parent set for that test (default 80%).
const aimTone = (v, aim = 80) => (v >= aim ? 'ok' : v >= aim - 15 ? 'close' : 'risk');
async function renderProgress() {
  // The Progress page answers five questions, in order: am I on track for my tests, what has Buddy noticed,
  // what should I work on, is it working, and am I putting in the effort. Every card has a number,
  // one line on what it means, and (where there's something to do) a button.
  const zh = LANG === 'zh';
  const D = await progressData(), r = D.r;
  const books = (await getBooks()).filter((b) => !b.demo);
  const RH = await readyHist(books);
  const MB = new Map(); for (const b of books) MB.set(b.id, await bookMastery(b));
  const GS = await gsData().catch(() => null);
  const t0 = dayStart(), now = Date.now();
  const sname = (b) => (b.subject ? subj(b.subject) : b.title);
  const chName = (u) => shortTitle(u.title);
  const acts = []; // [run] for every button on the page, bound by index
  const btn = (label, run, cls = 'pv-btn') => { acts.push(run); return `<button class="${cls}" data-pv="${acts.length - 1}">${label}</button>`; };
  const fresh = (c) => !c.done && !c.tests && !c.learned;
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  // ⓘ pop-ups: how each number is worked out, in plain words
  const how = (id, title, body) => `<details class="ms-how how-panel" id="${id}"><summary>${title}</summary><div>${body}</div></details>`;
  const ib = (id, title) => infoBtn(id, title);

  // ---------- 1. Am I on track for my tests? ----------
  const tests = await schoolTestsHTML();
  const fmtDay = (t) => new Date(t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
  const chOf = (p) => (p.book && p.units && p.units.length ? MB.get(p.book.id).chapters.filter((c) => p.units.some((u) => u.id === c.unit.id)) : []);
  // Progress only reports: on track or not, ready now, where it's heading, the goal. Acting on it happens on Today.
  const testCards = tests.steps.map((p) => {
    const aim = p.x.aim || 80, fc = p.ready == null ? null : planForecast(p.ready, chOf(p), p.left, practiceHabit());
    const st = p.ready == null ? 'none' : aimTone(fc ?? p.ready, aim);
    const stLab = { ok: PT('On track', '進度理想'), close: PT('Close', '接近'), risk: PT('At risk', '需要加把勁'), none: PT('Not started', '未開始') }[st];
    const say = p.ready == null ? PT('Add the textbook so Buddy can track this test.', '加入課本，Buddy 便可追蹤這個測驗。')
      : st === 'ok' ? PT(`Heading for about ${fc}% on test day, at or above the ${aim}% goal.`, `考試當日預計約 ${fc}%，達到 ${aim}% 目標。`)
      : st === 'close' ? PT(`Heading for about ${fc}%, a little short of the ${aim}% goal.`, `考試當日預計約 ${fc}%，略低於 ${aim}% 目標。`)
      : PT(`Heading for about ${fc}%, well short of the ${aim}% goal. Today’s plan steps it up.`, `考試當日預計約 ${fc}%，離 ${aim}% 目標較遠，今日的計劃會加把勁。`);
    const nums = p.ready == null ? '' : `<div class="pv-snum"><div><b>${p.ready}%</b><span>${PT('ready now', '現在')}</span></div><i aria-hidden="true">→</i><div><b class="fc ${st}">${fc}%</b><span>${PT('on test day', '考試當日')}</span></div><div><b>${aim}%</b><span>${PT('goal', '目標')}</span></div></div>
      <div class="pv-sbar ${st}"><i style="width:${p.ready}%"></i>${fc > p.ready ? `<em style="left:${p.ready}%;width:${fc - p.ready}%"></em>` : ''}<s style="left:${aim}%"></s></div>`;
    return `<div class="pv-test pv-simple ${st}"><div class="pv-test-h"><div><b data-raw>${esc(p.x.name)}</b><span>${fmtDay(testDay(p.x))} · ${leftText(p.left)}</span></div><em class="pv-pill ${st}">${stLab}</em></div>
      ${nums}<p class="pv-p">${say}</p>${btn(`${PT('Plan and today’s step on Today', '計劃和今天的步驟在「今日」')} ›`, () => { go({ name: 'home' }); setTimeout(() => { const el = document.querySelector('.td-sec'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); }, 'linkbtn pv-tolink')}</div>`;
  });
  const testedBooks = new Set(tests.steps.map((p) => p.book && p.book.id).filter(Boolean));
  const noTest = RH.filter((x) => x.used && !testedBooks.has(x.b.id)).slice(0, Math.max(1, 3 - testCards.length)).map((x) => `<div class="pv-test none"><b data-raw>${esc(sname(x.b))} · ${PT('no test added', '未加入測驗')}</b>
      <p class="pv-p">${PT(`${x.pct}% ready overall. Add the next ${esc(sname(x.b))} test and Buddy plans backwards from the date.`, `整體準備度 ${x.pct}%。加入下一個${esc(sname(x.b))}測驗，Buddy 會按日期倒數安排。`)}</p>
      ${btn(`+ ${PT('Add a test', '加入測驗')}`, () => testDialog())}</div>`);
  const sec1 = `<section class="pv-sec"><div class="pv-h"><h2 class="h-info">${PT('Am I on track for my tests?', '考試準備好了嗎？')}${infoBtn('howTestP', PT('How is this worked out?', '這是怎樣計算的？'))}</h2><span class="pv-h-r">${PT('Readiness now, and where it’s heading by test day', '現在的準備度，以及考試當日的預測')}${testCards.length ? btn(`+ ${PT('Add a test', '加入測驗')}`, () => testDialog(), 'pv-btn pv-addt') : ''}</span></div>
    <div class="pv-grid3">${testCards.join('') || `<div class="pv-test none"><b>${PT('Got a test coming up?', '快要測驗？')}</b><p class="pv-p">${PT('Add it and Buddy plans backwards from the date: new chapters first, then the weakest, then a practice test the day before.', '加入後，Buddy 會按日期倒數安排：先學新章節，再練最弱的，前一天做模擬測驗。')}</p>${btn(`+ ${PT('Add a test', '加入測驗')}`, () => testDialog())}</div>`}</div>
    <details class="ms-how how-panel" id="howTestP"><summary>${PT('How is this worked out?', '這是怎樣計算的？')}</summary><div>
      <p>${PT('Ready now is the readiness of the chapters in the test (or everything practised so far, if you didn’t choose chapters).', '「現在」是測驗範圍內各章節的準備度（未選章節的話，就是所有練習過的內容）。')}</p>
      <p>${PT('Finishing a chapter’s lesson counts as 10%. Practice, reviews and chapter tests take it the rest of the way. Practice on chapters that aren’t in the test doesn’t change this number.', '完成一章的課堂計 10%，之後靠練習、溫習和章節測驗提升。練習測驗範圍以外的章節不會影響這個數字。')}</p>
      <p>${PT('On test day is where Buddy expects you to be if you practise as often as you usually do and follow its plan for these chapters. It works from day one, even for a test that’s only days away.', '「考試當日」是預計：如果你像平時一樣經常練習，並跟著 Buddy 為這些章節訂的計劃，考試時會到達的程度。由第一日就有，即使測驗只剩幾日。')}</p>
      <ul><li><b>${PT('On track', '進度理想')}</b> · ${PT('your goal or more by test day (80% unless you drag the goal line)', '考試時達到你的目標或以上（預設 80%，可拖動目標線）')}</li><li><b>${PT('Close', '接近')}</b> · ${PT('within 15% of your goal', '與目標相差 15% 以內')}</li><li><b>${PT('At risk', '需要加把勁')}</b> · ${PT('more than 15% below your goal', '比目標低超過 15%')}</li></ul></div></details></section>`;

  // ---------- 2. What Buddy has noticed ----------
  const cards = [], add = (pri, html, win = false, par = null) => cards.push({ pri, html, win, par });
  // each card: what Buddy saw (proof: bars, a number or the child's own words), why it matters, and an action box that says what the button does
  const bars = (rows, note) => `<div class="pv-ev">${rows.map(([l, p, t]) => `<div class="pv-evr"><span>${esc(l)}</span><i><b class="${t}" style="width:${Math.max(2, Math.min(100, Math.round(p || 0)))}%"></b></i><em>${Math.round(p || 0)}%</em></div>`).join('')}${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  const stat = (n, t) => `<div class="pv-ev pv-evs"><b>${n}</b><span>${esc(t)}</span></div>`;
  const quote = (t, sub) => `<div class="pv-q" data-raw>“${esc(t)}”<small>${esc(sub)}</small></div>`;
  const card = (tag, cls, title, detail, button = '', x = {}) => {
    const act = button && x.act ? `<div class="pv-act2"><div><b>${esc(x.act[0])}</b>${x.act[1] ? `<small>${esc(x.act[1])}</small>` : ''}</div>${button.replace(/(<button[^>]*>)[\s\S]*(<\/button>)$/, `$1${x.go || PT('Start', '開始')}$2`)}</div>` : button;
    return `<div class="pv-ins"><em class="pv-tag ${cls}">${tag}</em><b data-raw>${esc(title)}</b>${x.quote || ''}${x.ev ? x.ev : ''}${!x.ev || x.keep ? `<p class="pv-p" data-raw>${esc(detail)}</p>` : ''}${x.why ? `<p class="pv-why"><b>${x.lead || (cls === 'green' ? PT('Nice work:', '做得好：') : PT('Why it matters:', '為甚麼重要：'))}</b> ${esc(x.why)}</p>` : ''}${act}</div>`; };
  const ins = local.insights && local.insights.lang === LANG ? local.insights : null;
  const MK = await mistakeItems(false), mkAll = MK.flatMap((g) => g.items.map((x) => ({ ...x, g })));
  (ins ? ins.list : []).forEach((m) => {
    const qs = mkAll.filter((x) => m.ids.includes(x.q.id));
    const g = qs[0] ? qs[0].g : null;
    const run = qs.length >= 2 ? () => { S = newSession({ mode: 'mistakes', title: m.title, qs: shuffle(qs.map((x) => x.q)).map(shuffleOptions), target: qs.length }); renderQuestion(); }
      : g && g.unit ? () => startUnits(g.book, [g.unit], 8) : null;
    add(15, card(PT('Mix-up', '常見混淆'), 'red', m.title, m.detail, `${run ? btn(PT('Practise this', '練習這個'), run, 'pv-btn soft') : ''}`, { quote: (() => { const at = qs[0] && (local.mistakes[qs[0].q.id] || {}).ansText; return at && String(at).length > 3 ? quote(String(at).slice(0, 140), qs.length > 1 ? PT(`your answer · same idea in ${qs.length} questions`, `你的答案 · ${qs.length} 題同一個錯誤`) : PT('your answer', '你的答案')) : ''; })(), keep: true, why: PT('It will keep costing marks on any question about this idea until it’s fixed.', '在改正之前，每條關於這個概念的題目都會失分。'), act: qs.length >= 2 ? [PT(`Redo those ${qs.length} questions`, `重做這 ${qs.length} 題`), PT(`About ${Math.max(2, qs.length)} min`, `大約 ${Math.max(2, qs.length)} 分鐘`)] : g && g.unit ? [PT(`Practise ${chName(g.unit)}`, `練習「${chName(g.unit)}」`), PT('8 new questions on this chapter', '這一章 8 條新題目')] : null }), false, ['red', m.title, m.detail]);
  });
  // rushing: multiple-choice sets answered too fast to be thinking, in the last 2 weeks
  const ss = (local.sess || []).filter((x) => x.t > now - 14 * DAY);
  const rushed = ss.filter((x) => x.r);
  // only worth raising when rushing costs marks: fast and right just means they know it well
  const avgP = (xs) => Math.round(xs.reduce((a, x) => a + (x.p || 0), 0) / Math.max(1, xs.length)), steadyS = ss.filter((x) => !x.r);
  if (rushed.length >= 2 && rushed.length / ss.length >= 0.3 && steadyS.length >= 2 && avgP(steadyS) - avgP(rushed) >= 10) {
    const late = rushed.filter((x) => new Date(x.t).getHours() >= 21).length;
    const avg = (xs) => Math.round(xs.reduce((a, x) => a + (x.p || 0), 0) / Math.max(1, xs.length)), steady = ss.filter((x) => !x.r);
    const gap = steady.length ? avg(steady) - avg(rushed) : 0;
    add(45, card(PT('Habit', '習慣'), 'orange', late >= 2 ? PT('Rushes multiple choice late at night', '夜晚做選擇題太快') : PT('Rushes some multiple-choice sets', '有時做選擇題太快'),
      PT(`${rushed.length} of ${ss.length} sets in the last 2 weeks were answered too fast to think${late >= 2 ? `, ${late} of them after 9pm` : ''}${gap >= 5 ? `, scoring ${gap}% lower than steady sets` : ''}.`, `過去兩星期 ${ss.length} 次練習中有 ${rushed.length} 次答得太快${late >= 2 ? `，其中 ${late} 次在晚上 9 時後` : ''}${gap >= 5 ? `，分數比慢慢做時低 ${gap}%` : ''}。`), '', { ev: bars([[PT('Steady sets', '慢慢做'), avg(steady), 'good'], [PT('Rushed sets', '做得太快'), avg(rushed), 'low']], PT('Average score, last 2 weeks', '過去兩星期平均分')), why: PT('Rushing turns questions you know into lost marks. Read every option before choosing.', '太快會令你懂的題目也失分。選之前看清每個選項。') }), false, ['orange', PT('Rushes multiple-choice sets', '做選擇題太快'), PT(`${rushed.length} of ${ss.length} sets in 2 weeks were answered too fast to think.`, `兩星期內 ${ss.length} 次練習中有 ${rushed.length} 次答得太快。`)]);
  }
  // independence: answers without Buddy's help, last 2 weeks vs the 6 weeks before
  const lw = local.log.filter((e) => e.t > now - 14 * DAY), lp = local.log.filter((e) => e.t <= now - 14 * DAY && e.t > now - 56 * DAY);
  const own = (es) => Math.round(100 * es.filter((e) => !e.h).length / es.length);
  if (lw.length >= 30) {
    const a = own(lw), b = lp.length >= 30 ? own(lp) : null;
    if (b != null && a - b >= 8) add(8, card(PT('Growing', '進步'), 'green', PT('Needs Buddy’s hints less', '越來越少需要提示'), PT(`${a}% of answers now without hints, up from ${b}%. Working things out alone.`, `現在 ${a}% 的題目不用提示，之前是 ${b}%。越來越能自己想通。`), '', { ev: bars([[PT('Before', '之前'), b, 'mut'], [PT('Last 2 weeks', '過去兩星期'), a, 'good']], PT('Answers given without a hint', '不用提示作答的比例')), why: PT('Working things out alone is exactly what tests ask for.', '自己想通正是考試需要的能力。') }), true, ['green', PT('Needs hints far less', '越來越少需要提示'), PT(`${a}% of answers without help, up from ${b}%.`, `現在 ${a}% 的題目不用提示，之前是 ${b}%。`)]);
    else if (a < 60) add(50, card(PT('Habit', '習慣'), 'orange', PT('Leans on hints a lot', '經常依賴提示'), PT(`Only ${a}% of answers in the last 2 weeks were without Buddy’s help. Try first, then ask.`, `過去兩星期只有 ${a}% 的題目不用 Buddy 幫忙。先自己試，再問。`), '', { ev: bars([[PT('Without a hint', '不用提示'), a, 'low']], PT('Answers, last 2 weeks', '過去兩星期的答題')), why: PT('In a test there’s no Buddy to ask. Try first, then ask.', '考試時沒有 Buddy 可以問。先自己試，再問。') }), false, ['orange', PT('Leans on Buddy’s hints', '經常依賴提示'), PT(`Only ${a}% of answers in 2 weeks were without help. Encourage trying first.`, `兩星期內只有 ${a}% 的題目不用幫忙。鼓勵先自己試。`)]);
  }
  // memory: reviews answered right after a gap (from the level model)
  const kt = GS && GS.kt; const ret = kt && kt[1] >= 15 ? Math.round(100 * kt[0] / kt[1]) : null;
  if (ret != null) add(ret >= 75 ? 9 : 35, ret >= 75 ? card(PT('Growing', '進步'), 'green', PT('What’s learned is sticking', '學過的記得牢'), PT(`${ret}% of review questions right days later. ${D.longTerm} questions remembered for a week or more.`, `${ret}% 的溫習題幾天後仍答對。${D.longTerm} 題已記得一星期或以上。`), '', { ev: bars([[PT('Right days later', '幾天後仍答對'), ret, 'good']], PT('Review questions', '溫習題')), why: PT('Remembering it days later is what counts on test day.', '幾天後仍記得，考試時才用得上。') })
    : card(PT('Memory', '記憶'), 'orange', PT('Forgets some things after a few days', '有些內容過幾天就忘記'), PT(`Only ${ret}% of review questions right days later. Doing reviews on the day they come back fixes this.`, `只有 ${ret}% 的溫習題幾天後仍答對。按時溫習就能改善。`), (D.due ? btn(PT('See your reviews', '看看要溫習甚麼'), () => reviewSheet(), 'pv-btn soft') : ''), { ev: bars([[PT('Right days later', '幾天後仍答對'), ret, 'low']], PT('Review questions', '溫習題')), why: PT('If it’s forgotten after a few days, it won’t be there on test day.', '幾天就忘記，考試時就用不上。'), go: PT('See them', '查看'), act: [PT(`${D.due} question${D.due === 1 ? '' : 's'} ready to review`, `${D.due} 題可以溫習`), PT('See which chapters first · a few minutes', '先看看是哪些章節 · 幾分鐘')] }), false, ret >= 75 ? ['green', PT('What’s learned is sticking', '學過的記得牢'), PT(`${ret}% of review questions right days later.`, `${ret}% 的溫習題幾天後仍答對。`)] : ['orange', PT('Forgets some things after a few days', '有些內容過幾天就忘記'), PT(`Only ${ret}% of review questions right days later. Reviews on time fix this.`, `只有 ${ret}% 的溫習題幾天後仍答對。按時溫習可改善。`)]);
  // writing: which rubric parts are strong and which keep losing marks (last 3 months)
  const drafts = (local.wr || []).flatMap((w) => (w.drafts || []).filter((d) => d.fb && d.fb.criteria && d.t > now - 90 * DAY).map((d) => ({ w, d })));
  if (drafts.length >= 2) {
    const by = {}; drafts.forEach(({ d }) => d.fb.criteria.forEach((c) => { const x = by[c.name] || (by[c.name] = []); x.push(c.band); }));
    const rows = Object.entries(by).map(([n, v]) => [n, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => b[1] - a[1]);
    if (rows.length >= 2 && rows[0][1] - rows[rows.length - 1][1] >= 1) {
      const w = drafts[drafts.length - 1].w;
      add(40, card(PT('Writing', '寫作'), 'blue', PT(`${rows[0][0]} strong, ${rows[rows.length - 1][0]} weakest`, `「${rows[0][0]}」最好，「${rows[rows.length - 1][0]}」最弱`),
        PT(`Across ${drafts.length} drafts, ${rows[rows.length - 1][0].toLowerCase()} has lost the most marks.`, `${drafts.length} 份草稿中，「${rows[rows.length - 1][0]}」失分最多。`), btn(PT('Practise writing', '練習寫作'), () => go({ name: 'writing', id: w.id }), 'pv-btn soft'), { ev: bars(rows.map(([n, v]) => [n, Math.round(100 * v / Math.max(5, rows[0][1])), v === rows[rows.length - 1][1] ? 'low' : 'good']), PT(`Across ${drafts.length} drafts`, `${drafts.length} 份草稿`)), why: PT('It’s the part losing you the most marks in writing.', '這是寫作中失分最多的部分。'), act: [PT('Redraft your latest piece', '修改最新的文章'), PT('Buddy marks it again with feedback', 'Buddy 會再批改並給意見')] }), false, ['blue', PT(`Writing: ${rows[rows.length - 1][0]} is weakest`, `寫作：「${rows[rows.length - 1][0]}」最弱`), PT(`Across ${drafts.length} drafts it has lost the most marks.`, `${drafts.length} 份草稿中失分最多。`)]);
    }
  }
  // dictation: the words that keep tripping them up
  const words = [];
  (local.dict || []).forEach((L) => (L.items || []).forEach((w, i) => { const x = (L.res || {})[i]; if (x && x.wrong >= 2) words.push({ w, n: x.wrong, L }); }));
  if (words.length) {
    const byL = {}; words.forEach((x) => (byL[x.L.id] = (byL[x.L.id] || 0) + x.n)); const bestL = Object.keys(byL).sort((a, b) => byL[b] - byL[a])[0];
    const top = words.filter((x) => x.L.id === bestL).sort((a, b) => b.n - a.n).slice(0, 3);
    add(40, card(PT('Dictation', '默書'), 'blue', PT(`${top.length} word${top.length === 1 ? '' : 's'} keep tripping you up`, `${top.length} 個詞語經常寫錯`), top.map((x) => x.w).join(' · '), btn(PT('Practise these', '練習這些'), () => go({ name: 'dictation', id: top[0].L.id, sub: 'run' }), 'pv-btn soft'), { ev: `<div class="pv-ev pv-words">${top.map((x) => `<span>${esc(x.w)}<small>${PT(`missed ${x.n}×`, `錯 ${x.n} 次`)}</small></span>`).join('')}</div>`, why: PT('Words missed twice tend to be missed in the real 默書 too.', '錯過兩次的詞語，在真正默書時也容易寫錯。'), act: [PT(`Practise “${top[0].L.title || 'this list'}”`, `練習「${top[0].L.title || '這個默書'}」`), PT(`The list these ${top.length} words are in · about 5 min`, `這 ${top.length} 個詞語所在的默書 · 大約 5 分鐘`)] }), false, ['blue', PT('Dictation words keep slipping', '默書詞語經常寫錯'), top.map((x) => x.w).join(' · ')]);
  }

  // ----- more noticings, from data already recorded (no extra AI) -----
  const L30 = local.log.filter((e) => e.t > now - 30 * DAY && e.q && e.m);
  const seenQ = new Set(), firsts = [];
  for (const e of local.log) { if (!e.q || !e.m || seenQ.has(e.q)) continue; seenQ.add(e.q); if (e.t > now - 30 * DAY && e.k !== 'mistakes' && e.k !== 'spaced') firsts.push(e); }
  const accP = (es) => { const m = es.reduce((x, e) => x + e.m, 0); return m ? Math.round(100 * es.reduce((x, e) => x + e.g, 0) / m) : null; };
  const bookOf = (id) => books.find((x) => x.id === String(id).split(':')[0]);
  const unitOf = (id) => { const bk = bookOf(id), u = String(id).split(':')[1]; return bk ? bk.units.find((x) => x.id === u) : null; };
  const topUnit = (es) => { const c = {}; es.forEach((e) => { const k = String(e.q).split(':').slice(0, 2).join(':'); c[k] = (c[k] || 0) + 1; }); const k = Object.keys(c).sort((x, y) => c[y] - c[x])[0]; return k ? { book: bookOf(k), unit: unitOf(k) } : null; };
  const nQ = local.count || sessionSize();
  const runSet = (qs, title, mode = 'mistakes') => () => { const pick = shuffle(qs).slice(0, 15); S = newSession({ mode, title, qs: pick.map(shuffleOptions), target: pick.length }); renderQuestion(); };
  const QM = new Map(); for (const x of await allQuestions()) QM.set(x.q.id, x.q);
  // 1. multiple choice vs written answers
  { const c = firsts.filter((e) => e.ty === 'c'), w = firsts.filter((e) => e.ty === 'w');
    if (c.length >= 15 && w.length >= 8) { const ac = accP(c), aw = accP(w), tu = topUnit(w);
      if (ac - aw >= 25) add(30, card(PT('Answers', '作答'), 'orange', PT('Strong on multiple choice, weaker on written answers', '選擇題強，文字題較弱'), PT(`${ac}% on multiple choice but ${aw}% on written answers. In tests, the marks are in explaining.`, `選擇題 ${ac}%，文字題只有 ${aw}%。考試的分數多數在解釋題。`),
        tu && tu.book && tu.unit ? btn(PT('Practise written answers', '練習文字題'), () => startUnits(tu.book, [tu.unit], nQ, { types: 'written' }), 'pv-btn soft') : '', { ev: bars([[PT('Multiple choice', '選擇題'), ac, 'good'], [PT('Written', '文字題'), aw, 'low']], PT('Last 30 days, first tries', '過去 30 日，第一次作答')), why: PT('In school tests most marks are for explaining, not picking an answer.', '學校考試大部分分數在解釋，不是選答案。'), act: tu && tu.unit ? [PT('Practise written answers', '練習文字題'), PT(`${nQ} questions on ${chName(tu.unit)} · marked with feedback`, `「${chName(tu.unit)}」${nQ} 題 · 有批改和意見`)] : null }), false, ['orange', PT('Strong on multiple choice, weaker on written answers', '選擇題強，文字題較弱'), PT(`${ac}% vs ${aw}%. Test marks are mostly in explaining.`, `${ac}% 對 ${aw}%。考試分數多數在解釋題。`)]); } }
  // 2. hits a ceiling at the harder levels
  { const lo = firsts.filter((e) => (e.l || 2) <= 2), hi = firsts.filter((e) => (e.l || 2) >= 3);
    if (lo.length >= 15 && hi.length >= 8) { const al = accP(lo), ah = accP(hi), tu = topUnit(hi);
      if (al >= 75 && ah <= 50) add(28, card(PT('Level', '程度'), 'orange', PT('Gets stuck at the harder questions', '較深的題目卡住了'), PT(`${al}% on remember and understand questions, but ${ah}% on apply and analyse. That’s where the top marks are.`, `記憶和理解題 ${al}%，應用和分析題只有 ${ah}%。高分就在這裡。`),
        tu && tu.book && tu.unit ? btn(PT('Practise harder questions', '練習較深題目'), () => startUnits(tu.book, [tu.unit], nQ, { diff: 'hard' }), 'pv-btn soft') : '', { ev: bars([[PT('Remember & understand', '記憶和理解'), al, 'good'], [PT('Apply & analyse', '應用和分析'), ah, 'low']], PT('Last 30 days, first tries', '過去 30 日，第一次作答')), why: PT('The harder questions are where the top marks are.', '較深的題目才是拿高分的地方。'), act: tu && tu.unit ? [PT('Practise harder questions', '練習較深題目'), PT(`${nQ} questions on ${chName(tu.unit)}`, `「${chName(tu.unit)}」${nQ} 題`)] : null }), false, ['orange', PT('Gets stuck at the harder questions', '較深題目卡住了'), PT(`${al}% on recall and understanding, ${ah}% on apply and analyse.`, `記憶和理解 ${al}%，應用和分析 ${ah}%。`)]); } }
  // 3. tires in long sessions: answers after 20 minutes vs the first 15, across 3+ long sessions
  { const sess2 = []; let cur = null;
    for (const e of L30) { if (cur && e.t - cur.end < 20 * 60000) { cur.end = e.t; cur.es.push(e); } else { cur = { start: e.t, end: e.t, es: [e] }; sess2.push(cur); } }
    const long = sess2.filter((x) => x.end - x.start >= 30 * 60000 && x.es.length >= 20);
    if (long.length >= 3) { const early = long.flatMap((x) => x.es.filter((e) => e.t - x.start < 15 * 60000)), late = long.flatMap((x) => x.es.filter((e) => e.t - x.start >= 20 * 60000));
      if (early.length >= 20 && late.length >= 20) { const ae = accP(early), al = accP(late);
        if (ae - al >= 15) add(55, card(PT('Tip', '小貼士'), 'blue', PT('Scores drop in long sessions', '長時間練習後分數下降'), PT(`${ae}% in the first 15 minutes, ${al}% after 20 minutes. Shorter sets with a break work better.`, `頭 15 分鐘 ${ae}%，20 分鐘後只有 ${al}%。短一點、中間休息會更好。`), '', { ev: bars([[PT('First 15 min', '頭 15 分鐘'), ae, 'good'], [PT('After 20 min', '20 分鐘後'), al, 'low']], PT('In long sessions', '長時間練習中')), lead: PT('Tip:', '小貼士：'), why: PT('Tired practice builds less. Two short sets with a break beat one long one.', '疲倦時練習效果較差。兩次短練習加休息，勝過一次長時間。') }), false, ['blue', PT('Scores drop in long sessions', '長時間練習後分數下降'), PT(`${ae}% in the first 15 minutes, ${al}% after 20. Shorter sets with a break help.`, `頭 15 分鐘 ${ae}%，20 分鐘後 ${al}%。短一點、中間休息會更好。`)]); } } }
  // 4. late-night dip: after 10pm vs 2pm–8pm
  { const late = L30.filter((e) => new Date(e.t).getHours() >= 22 || new Date(e.t).getHours() < 5), day = L30.filter((e) => { const h = new Date(e.t).getHours(); return h >= 14 && h < 20; });
    if (late.length >= 40 && day.length >= 40) { const al = accP(late), ad = accP(day);
      if (ad - al >= 15) add(55, card(PT('Tip', '小貼士'), 'blue', PT('Late nights cost marks', '太夜練習會失分'), PT(`${al}% after 10pm vs ${ad}% in the afternoon and early evening. Earlier is better when you can.`, `晚上 10 點後 ${al}%，下午至傍晚 ${ad}%。可以的話，早一點練習。`), '', { ev: bars([[PT('Afternoon', '下午'), ad, 'good'], [PT('After 10pm', '晚上 10 點後'), al, 'low']], PT('Last 30 days', '過去 30 日')), lead: PT('Tip:', '小貼士：'), why: PT('Memory sets in while you sleep, so earlier practice sticks better.', '記憶在睡眠時鞏固，早一點練習會記得更牢。') }), false, ['blue', PT('Late nights cost marks', '太夜練習會失分'), PT(`${al}% after 10pm vs ${ad}% in the afternoon.`, `晚上 10 點後 ${al}%，下午 ${ad}%。`)]); } }
  // 5. careless slips: wrong first time, then fully right on the very next try
  { const byQ = {}; for (const e of L30) (byQ[e.q] || (byQ[e.q] = [])).push(e);
    const slipQ = Object.values(byQ).filter((es) => es.length >= 2 && es[0].g < es[0].m && es[1].g >= es[1].m && es[1].t - es[0].t < 3 * DAY).map((es) => QM.get(es[0].q)).filter(Boolean), slips = slipQ.length;
    const wrongs = Object.values(byQ).filter((es) => es[0].g < es[0].m).length;
    if (slips >= 6 && slips / Math.max(1, wrongs) >= 0.3) add(32, card(PT('Habit', '習慣'), 'orange', PT('Some mistakes are careless slips', '有些錯誤是粗心'), PT(`${slips} wrong answers were right on the very next try. You knew them: slow down and check before moving on.`, `${slips} 題答錯後，下一次就答對了。其實你懂，答完前慢一點檢查。`), btn(PT('Redo them, checking each one', '重做這些題目，逐題檢查'), runSet(slipQ, PT('Slow down and check', '慢慢做，檢查清楚')), 'pv-btn soft'), { ev: stat(slips, PT('answers were wrong, then right on the very next try', '題答錯後，下一次就答對')), why: PT('These are marks you already know how to get. Check each answer before moving on.', '這些分數你其實拿得到。作答後先檢查再繼續。'), act: [PT(`Redo these ${slips}`, `重做這 ${slips} 題`), PT('Check each answer before you move on', '每題作答後先檢查')] }), false, ['orange', PT('Some mistakes are careless slips', '有些錯誤是粗心'), PT(`${slips} wrong answers were right on the very next try. Checking before moving on would help.`, `${slips} 題答錯後下一次就答對。答完前檢查會有幫助。`)]); }
  // 6. old mistakes left open
  { const old = Object.values(local.mistakes || {}).filter((m) => !m.done && m.t < now - 14 * DAY).length;
    if (old >= 8) add(34, card(PT('Mistakes', '錯題'), 'red', PT(`${old} mistakes are over 2 weeks old`, `${old} 題錯題已超過兩星期`), PT('Old mistakes tend to show up again in tests. Fixing a few a day clears them.', '舊錯題很容易在考試再出現。每天改正幾題就能清完。'), btn(PT('Fix the old ones', '改正舊錯題'), runSet(mkAll.filter((x) => (local.mistakes[x.q.id] || {}).t < now - 14 * DAY).map((x) => x.q), PT('Old mistakes', '舊錯題')), 'pv-btn soft'), { ev: stat(old, PT('mistakes older than 2 weeks, still not fixed', '題超過兩星期仍未改正的錯題')), why: PT('Old mistakes tend to show up again in tests.', '舊錯題很容易在考試再出現。'), act: [PT('Fix the old ones', '改正舊錯題'), PT(`${Math.min(15, old)} questions · about ${Math.max(3, Math.round(Math.min(15, old) * 0.7))} min`, `${Math.min(15, old)} 題 · 大約 ${Math.max(3, Math.round(Math.min(15, old) * 0.7))} 分鐘`)] }), false, ['red', PT(`${old} mistakes over 2 weeks old`, `${old} 題錯題超過兩星期`), PT('Old mistakes tend to come back in tests.', '舊錯題很容易在考試再出現。')]); }
  // 7. reviews piling up: questions whose come-back day passed 2+ days ago
  { const t0 = startOfToday(), dueAll = await dueItems(), odI = dueAll.filter((x) => t0 - local.stats[x.q.id].due >= 2 * DAY), od = odI.length;
    if (od >= 10) { const cc = {}; odI.forEach((x) => { const k = x.book.subject ? subj(x.book.subject) : shortTitle(x.book.title); cc[k] = (cc[k] || 0) + 1; });
      const tops = Object.entries(cc).sort((a, b) => b[1] - a[1]), names = tops.slice(0, 2).map((x) => x[0]).join(PT(' and ', '和')), more = tops.length - 2;
      const oldest = Math.round((t0 - local.stats[dueAll[0].q.id].due) / DAY), n = Math.min(15, dueAll.length);
      add(25, card(PT('Memory', '記憶'), 'red', PT(`${od} questions are overdue for review`, `${od} 題溫習已過期`), PT('Buddy brings back questions you’ve done after a gap, to check you still remember them. These have been waiting more than 2 days.', 'Buddy 會隔一段時間再問你做過的題目，看看你是否仍然記得。這些已經等了超過 2 日。'), btn(PT('See your reviews', '看看要溫習甚麼'), () => reviewSheet(), 'pv-btn soft'), { ev: stat(od, PT(`questions past their review day, the oldest by ${oldest} days. Mostly ${names}${more > 0 ? ` and ${more} more subject${more === 1 ? '' : 's'}` : ''}.`, `題已過了溫習日，最久的已過 ${oldest} 日。主要是${names}${more > 0 ? `及另外 ${more} 科` : ''}。`)), why: PT('The longer a review waits, the more likely it’s been forgotten. A few minutes now saves relearning it.', '溫習等得越久，越可能已經忘記。現在花幾分鐘，好過之後重新學。'), go: PT('See them', '查看'), act: [PT(`Review the oldest ${n}`, `溫習最舊的 ${n} 題`), PT(`See which chapters first · about ${Math.max(3, Math.round(n * 0.6))} min`, `先看看是哪些章節 · 大約 ${Math.max(3, Math.round(n * 0.6))} 分鐘`)] }), false, ['red', PT(`${od} reviews overdue`, `${od} 題溫習已過期`), PT(`Questions Buddy brought back to check they’re remembered, waiting 2+ days. Mostly ${names}.`, `Buddy 安排再做的題目，已等了 2 日以上。主要是${names}。`)]); } }
  // 8. avoiding the subject with the nearest test
  { const wk7 = local.log.filter((e) => e.t > now - 7 * DAY && e.q);
    const soon = tests.steps.find((p) => p.book && p.left >= 1 && p.left <= 10 && (p.x.kind || 'test') !== 'dict');
    if (soon && wk7.length >= 30) { const share = wk7.filter((e) => e.q.startsWith(soon.book.id + ':')).length / wk7.length;
      if (share < 0.2) add(10, card(PT('Tests', '測驗'), 'red', PT(`${soon.x.name} is ${leftText(soon.left)}, but little practice on it`, `「${soon.x.name}」${leftText(soon.left)}，但很少練習`), PT(`Only ${Math.round(share * 100)}% of this week’s questions were ${sname(soon.book)}. Switch some practice over now.`, `本週只有 ${Math.round(share * 100)}% 的題目是${sname(soon.book)}。現在多練習一點。`), btn(PT(`Practise ${sname(soon.book)}`, `練習${sname(soon.book)}`), () => startUnits(soon.book, soon.units, nQ), 'pv-btn soft'), { ev: bars([[PT(`${sname(soon.book)} this week`, `本週${sname(soon.book)}`), share * 100, 'low']], PT('Share of this week’s questions', '本週題目所佔比例')), why: PT(`The ${soon.x.name} is ${leftText(soon.left)}. Every day of practice on it counts now.`, `「${soon.x.name}」${leftText(soon.left)}，現在每天練習都很重要。`), act: [PT(`Practise ${sname(soon.book)}`, `練習${sname(soon.book)}`), PT(`${nQ} questions on the test chapters`, `考試章節 ${nQ} 題`)] }), false, ['red', PT(`Little practice for the ${soon.x.name}`, `「${soon.x.name}」練習不足`), PT(`It’s ${leftText(soon.left)}, and only ${Math.round(share * 100)}% of this week’s questions were ${sname(soon.book)}.`, `${leftText(soon.left)}考試，本週只有 ${Math.round(share * 100)}% 的題目是${sname(soon.book)}。`)]); } }
  // 9. practising a chapter without its lesson, and struggling
  { const byU = {}; firsts.forEach((e) => { const k = String(e.q).split(':').slice(0, 2).join(':'); (byU[k] || (byU[k] = [])).push(e); });
    const cand = Object.entries(byU).filter(([k, es]) => es.length >= 5 && accP(es) < 50 && !(local.learned || {})[k]).sort((x, y) => accP(x[1]) - accP(y[1]))[0];
    if (cand) { const bk = bookOf(cand[0]), u = unitOf(cand[0]);
      if (bk && u) add(26, card(PT('Lessons', '課堂'), 'orange', PT(`Practising ${chName(u)} without the lesson`, `未上課就練習「${chName(u)}」`), PT(`${accP(cand[1])}% so far. The lesson explains it step by step and usually lifts scores a lot.`, `目前 ${accP(cand[1])}%。課堂會一步步講解，通常能大大提升分數。`), btn(PT('Take the lesson', '上課'), () => go({ name: 'learn', bookId: bk.id, unitId: u.id }), 'pv-btn soft'), { ev: bars([[PT('Right so far', '目前答對'), accP(cand[1]), 'low']], PT('Without the lesson', '未上課')), why: PT('The lesson explains it step by step and usually lifts scores a lot.', '課堂會一步步講解，通常能大大提升分數。'), act: [PT('Take the lesson', '上課'), PT('About 10 min · with quick checks', '大約 10 分鐘 · 附小測')] }), false, ['orange', PT(`Practising ${chName(u)} without the lesson`, `未上課就練習「${chName(u)}」`), PT(`${accP(cand[1])}% so far. The lesson usually lifts scores a lot.`, `目前 ${accP(cand[1])}%。上課通常能大大提升分數。`)]); } }
  // 10. strong in practice, weaker when timed
  { const tt = (local.tests || []).filter((x) => x.t > now - 30 * DAY && x.m);
    if (tt.length >= 2 && firsts.length >= 20) { const at = Math.round(100 * tt.reduce((a, x) => a + x.g, 0) / tt.reduce((a, x) => a + x.m, 0)), ap = accP(firsts);
      if (ap - at >= 15) { const k = Object.keys(tt[tt.length - 1].per || {})[0], bk = k && bookOf(k), u = k && unitOf(k);
        add(30, card(PT('Tests', '測驗'), 'orange', PT('Scores drop when the clock is running', '限時下分數下降'), PT(`${ap}% in practice but ${at}% in timed tests. More timed practice builds speed and calm.`, `練習 ${ap}%，限時測驗只有 ${at}%。多做限時練習，會更快更冷靜。`), bk && u ? btn(PT('Try a timed chapter test', '做限時章節測驗'), () => startChapterTest(bk, [u]), 'pv-btn soft') : '', { ev: bars([[PT('Practice', '練習'), ap, 'good'], [PT('Timed tests', '限時測驗'), at, 'low']], PT('Last 30 days', '過去 30 日')), why: PT('Timed practice builds speed and calm for the real test.', '限時練習能培養速度和冷靜。'), act: u ? [PT('Try a timed chapter test', '做限時章節測驗'), PT(`${chName(u)} · 80% passes`, `「${chName(u)}」· 80% 合格`)] : null }), false, ['orange', PT('Scores drop when timed', '限時下分數下降'), PT(`${ap}% in practice, ${at}% in timed tests.`, `練習 ${ap}%，限時測驗 ${at}%。`)]); } } }
  // 11 & 12. long, wordy questions and diagram questions (need the question text)
  if (firsts.length >= 30) {
    const withQ = firsts.map((e) => [e, QM.get(e.q)]).filter(([, q]) => q);
    const len = (q) => String(q.stem || '').length + (q.parts || []).reduce((a, p) => a + String(p.prompt || '').length, 0);
    if (withQ.length >= 30) {
      const sorted = withQ.map(([e, q]) => len(q)).sort((x, y) => x - y), cut = sorted[Math.floor(sorted.length * 0.75)];
      const longQ = withQ.filter(([, q]) => len(q) >= Math.max(cut, 220)).map(([e]) => e), shortQ = withQ.filter(([, q]) => len(q) < cut).map(([e]) => e);
      if (longQ.length >= 12 && shortQ.length >= 12) { const al = accP(longQ), as = accP(shortQ);
        if (as - al >= 20) add(52, card(PT('Tip', '小貼士'), 'blue', PT('Long questions are harder for you', '長題目比較難'), PT(`${al}% on long, wordy questions vs ${as}% on short ones. Underline the key words and what it’s asking before answering.`, `長題目 ${al}%，短題目 ${as}%。作答前先劃出關鍵字和題目要求。`), '', { ev: bars([[PT('Short questions', '短題目'), as, 'good'], [PT('Long questions', '長題目'), al, 'low']], PT('Last 30 days, first tries', '過去 30 日，第一次作答')), lead: PT('Tip:', '小貼士：'), why: PT('Underline the key words and what it’s asking before you answer.', '作答前先劃出關鍵字和題目要求。') }), false, ['blue', PT('Long questions are harder', '長題目比較難'), PT(`${al}% on long questions vs ${as}% on short ones.`, `長題目 ${al}%，短題目 ${as}%。`)]); }
      const fig = withQ.filter(([, q]) => q.figure || (q.graphs && q.graphs.length)).map(([e]) => e), nof = withQ.filter(([, q]) => !(q.figure || (q.graphs && q.graphs.length))).map(([e]) => e);
      if (fig.length >= 8 && nof.length >= 20) { const af = accP(fig), an = accP(nof), tu = topUnit(fig);
        if (an - af >= 25) add(50, card(PT('Tip', '小貼士'), 'blue', PT('Diagram questions are a weak spot', '圖表題是弱項'), PT(`${af}% on questions with a diagram vs ${an}% without. Read the labels and units on the diagram first.`, `有圖的題目 ${af}%，沒有圖的 ${an}%。先看清圖上的標籤和單位。`), btn(PT('Practise diagram questions', '練習圖表題'), () => { const dq = [...QM.values()].filter((q) => (q.figure || (q.graphs && q.graphs.length)) && !blocked(q)).sort((x, y) => ((local.stats[x.id] || {}).last ?? 0.5) - ((local.stats[y.id] || {}).last ?? 0.5)); runSet(dq.slice(0, 20), PT('Diagram questions', '圖表題'), 'weak')(); }, 'pv-btn soft'), { ev: bars([[PT('Without a diagram', '沒有圖'), an, 'good'], [PT('With a diagram', '有圖'), af, 'low']], PT('Last 30 days, first tries', '過去 30 日，第一次作答')), why: PT('Read the labels and units on the diagram before the question.', '先看清圖上的標籤和單位，再看題目。'), act: [PT('Practise diagram questions', '練習圖表題'), PT('Up to 20, weakest first', '最多 20 題，先做最弱的')] }), false, ['blue', PT('Diagram questions are a weak spot', '圖表題是弱項'), PT(`${af}% with a diagram vs ${an}% without.`, `有圖 ${af}%，沒有圖 ${an}%。`)]); }
    }
  }
  // 13. wins: a chapter that jumped this week, chapters newly mastered
  if (D.up && D.up.was != null && D.up.a - D.up.was >= 15) add(5, card(PT('Win', '進步'), 'green', PT(`${chName(D.up.unit)} jumped up`, `「${chName(D.up.unit)}」大進步`), PT(`From ${D.up.was}% last week to ${D.up.a}% this week. That practice paid off.`, `由上週 ${D.up.was}% 升到本週 ${D.up.a}%。練習有成果！`), '', { ev: bars([[PT('Last week', '上週'), D.up.was, 'mut'], [PT('This week', '本週'), D.up.a, 'good']], PT('Right answers in this chapter', '這一章答對的比例')), why: PT('That practice paid off. Reviews will keep it fresh.', '練習有成果！溫習會幫你保持。') }), true, ['green', PT(`${chName(D.up.unit)} jumped up`, `「${chName(D.up.unit)}」大進步`), PT(`From ${D.up.was}% last week to ${D.up.a}% this week.`, `由上週 ${D.up.was}% 升到本週 ${D.up.a}%。`)]);
  { const k7 = (local.kpi || []).filter((k) => k.d <= t0 - 6 * DAY).pop(), chNow = (local.kpi || []).slice(-1)[0];
    if (k7 && chNow && chNow.c > k7.c) add(6, card(PT('Win', '進步'), 'green', PT(chNow.c - k7.c === 1 ? 'A chapter mastered this week' : `${chNow.c - k7.c} chapters mastered this week`, `本週掌握了 ${chNow.c - k7.c} 章`), PT('Passed the test, right first time on harder questions and still remembered. Well done!', '通過測驗、較深題目第一次就答對，而且記得牢。做得好！'), '', { why: PT('Passed the test, handled the harder questions and still remembered it.', '通過測驗、應付到較深題目，而且仍然記得。') }), true, ['green', PT(chNow.c - k7.c === 1 ? 'A chapter mastered this week' : `${chNow.c - k7.c} chapters mastered this week`, `本週掌握了 ${chNow.c - k7.c} 章`), PT('Passed the test and still remembered.', '通過測驗而且記得牢。')]); }
  // order: most important first; always keep one win near the top if there is one
  cards.sort((x, y) => x.pri - y.pri);
  // the most important thing first, then the best win, then the rest in order
  const firstIssue = cards.find((c) => !c.win), winC = cards.find((c) => c.win);
  const ordered = [firstIssue, winC, ...cards.filter((c) => c !== firstIssue && c !== winC)].filter(Boolean);
  // the same findings, worded for parents, go in the weekly report (top 5)
  local.noticed = { t: now, lang: LANG, list: ordered.filter((c) => c.par).slice(0, 5).map((c) => [c.par[0], String(c.par[1] || '').slice(0, 90), String(c.par[2] || '').slice(0, 160)]) }; saveLocal();
  // show two full rows at whatever width (4, 3, 2 or 1 across)
  const cols = innerWidth >= 1650 ? 4 : innerWidth >= 1100 ? 3 : innerWidth >= 700 ? 2 : 1, SHOW = Math.max(4, cols * 2), cardsHTML = ordered.map((c, i) => (i < SHOW ? c.html : c.html.replace('class="pv-ins"', 'class="pv-ins pv-hid"')));
  const sec2 = `<section class="pv-sec"><div class="pv-h"><h2 class="h-info">${PT('What Buddy has noticed', 'Buddy 的觀察')}${ib('howNotP', PT('Where do these come from?', '這些從哪裡來？'))}</h2><span>${PT('From your wrong answers, hints, timing and reviews', '根據答錯的題目、提示、時間和溫習')}</span></div>
    ${cards.length ? `<div class="pv-grid3" id="pv-ins">${cardsHTML.join('')}</div>${cards.length > SHOW ? btn(PT(`Show ${cards.length - SHOW} more`, `再顯示 ${cards.length - SHOW} 項`), () => { const el = document.getElementById('pv-ins'), open = el.classList.toggle('open'); const bt = el.nextElementSibling; if (bt) bt.textContent = open ? PT('Show fewer', '顯示較少') : PT(`Show ${cards.length - SHOW} more`, `再顯示 ${cards.length - SHOW} 項`); }, 'pv-btn quiet pv-insmore') : ''}` : `<p class="pv-empty">${PT('Buddy needs about a week of practice to spot patterns. Keep going!', 'Buddy 需要大約一星期的練習才能看出規律。繼續加油！')}</p>`}
    ${how('howNotP', PT('Where do these come from?', '這些從哪裡來？'), `<p>${PT('Each card appears only when the numbers really show something. Nothing here is guessed.', '只有數據真的顯示出規律，才會出現卡片，不會憑空估計。')}</p><ul>
      <li><b>${PT('Mix-up', '常見混淆')}</b> · ${PT('About once a week Buddy reads your recent wrong answers (what you wrote and what the right answer was) and names the same wrong idea showing up 2 or more times.', '大約每星期一次，Buddy 會看你最近答錯的題目（你的答案和正確答案），找出重複出現 2 次或以上的錯誤概念。')}</li>
      <li><b>${PT('Rushing', '答得太快')}</b> · ${PT('A multiple-choice set counts as rushed when answers came faster than anyone could read the question. Shown when 30% or more of the last 2 weeks’ sets were rushed.', '選擇題答得比讀題還快，就算太快。過去兩星期有 30% 或以上的練習太快，才會顯示。')}</li>
      <li><b>${PT('Hints', '提示')}</b> · ${PT('The share of answers given without asking Buddy first: the last 2 weeks against the 6 weeks before.', '不先問 Buddy 就作答的比例：過去兩星期與之前 6 星期比較。')}</li>
      <li><b>${PT('Memory', '記憶')}</b> · ${PT('Review questions come back after 1, 3, 7, 14 and 30 days. This is how many were right when they came back.', '溫習題會在 1、3、7、14、30 日後再出現。這是再出現時答對的比例。')}</li>
      <li><b>${PT('Answers and levels', '作答和程度')}</b> · ${PT('Multiple choice vs written answers, and remember/understand vs apply/analyse questions, on first tries in the last 30 days.', '過去 30 日第一次作答：選擇題對比文字題，記憶/理解對比應用/分析。')}</li>
      <li><b>${PT('Habits', '習慣')}</b> · ${PT('Careless slips (wrong, then right on the very next try), long sessions where scores drop, late nights, and long or diagram questions.', '粗心（答錯後下一次就答對）、長時間練習後分數下降、太夜練習，以及長題目或圖表題。')}</li>
      <li><b>${PT('To do', '待辦')}</b> · ${PT('Reviews more than 2 days overdue, mistakes older than 2 weeks, chapters practised without their lesson, little practice on a subject with a test soon, and lower scores when timed.', '過期 2 日以上的溫習、超過兩星期的錯題、未上課就練習的章節、快考試但很少練習的科目，以及限時下分數較低。')}</li>
      <li><b>${PT('Wins', '進步')}</b> · ${PT('A chapter that jumped this week, and chapters newly mastered.', '本週大進步的章節，以及新掌握的章節。')}</li>
      <li><b>${PT('Writing and dictation', '寫作和默書')}</b> · ${PT('Writing: the rubric scores across your drafts. Dictation: words missed 2 or more times.', '寫作：各份草稿的評分項目。默書：寫錯 2 次或以上的詞語。')}</li></ul>`)}
    ${!ins && mkAll.length >= 3 ? `<p class="pv-empty pv-loading" id="pvMix">${PT('Buddy is looking through your mistakes for mix-ups…', 'Buddy 正在從錯題中找出常見混淆…')}</p>` : ''}</section>`;

  // ---------- 3. What should I work on? ----------
  // One box per subject; a subject with several textbooks (4A, 4B, workbook) shows each book's chapters under its own small header.
  const pool = RH.some((x) => x.used) ? RH.filter((x) => x.used) : RH;
  const groups = [];
  for (const x of pool) { const k = (x.b.subject || x.b.title || '').toLowerCase(); const g = groups.find((y) => y.k === k); if (g) g.list.push(x); else groups.push({ k, list: [x] }); }
  const subjHTML = groups.slice(0, 6).map((g) => {
    const many = g.list.length > 1;
    let w = 0, sum = 0, nch = 0;
    for (const x of g.list) for (const c of MB.get(x.b.id).chapters) { w += c.weight; sum += c.pct * c.weight; nch++; }
    const gp = w ? Math.round(sum / w) : 0;
    const bookHTML = (x) => {
      const chs = MB.get(x.b.id).chapters, max = chs.length > 6 ? 5 : 6; // a list on every screen: 5 chapters, then "+N more"
      const tile = (c) => { const st = fresh(c) ? 'none' : c.pct >= 80 ? 'good' : c.pct >= 60 ? 'mid' : 'low';
        const word = { none: PT('Not started', '未開始'), good: PT('Strong', '掌握'), mid: PT('Getting there', '漸入佳境'), low: PT('Needs work', '要加強') }[st];
        return btn(`<i class="pv-tdot"></i><span class="pv-tn"><b data-raw>${esc(chName(c.unit))}</b><small>${word}${c.learned && !c.done ? ` · ${PT('lesson done', '已上課')}` : ''}</small></span>${fresh(c) ? '' : `<span class="pv-tp"><i><b style="width:${Math.max(3, c.pct)}%"></b></i><em>${c.pct}%</em></span>`}<em class="pv-tgo">›</em>`, () => chapterSheet(x.b, c), `pv-tile ${st}`); };
      return `${many ? `<div class="pv-bk-h"><b data-raw>${esc(x.b.title)}</b><span>${PT(`${x.pct}% · ${chs.length} chapters`, `${x.pct}% · ${chs.length} 章`)}</span></div>` : ''}
      <div class="pv-tiles" id="pvt-${esc(x.b.id)}">${chs.map((c, i) => (i < max ? tile(c) : tile(c).replace('class="pv-tile', 'class="pv-tile pv-hid'))).join('')}${chs.length > max ? btn(PT(`+${chs.length - max} more`, `還有 ${chs.length - max} 章`), () => {
        const el = document.getElementById(`pvt-${x.b.id}`), open = el.classList.toggle('open'), bt = el.querySelector('.pv-tile.more');
        if (bt) bt.textContent = open ? PT('Show fewer', '顯示較少') : PT(`+${chs.length - max} more`, `還有 ${chs.length - max} 章`); }, 'pv-tile more') : ''}</div>`;
    };
    const one = g.list[0].b;
    return `<div class="pv-subj"><div class="pv-subj-h"><b data-raw>${esc(sname(one))}${!many && one.subject && one.title && one.title !== sname(one) ? `<small class="pv-subj-bk">${esc(one.title)}</small><small class="pv-subj-n">${PT(`${nch} chapters`, `${nch} 章`)}</small>` : many ? `<small class="pv-subj-bk">${PT(`${g.list.length} textbooks · ${nch} chapters`, `${g.list.length} 本課本 · ${nch} 章`)}</small>` : `<small class="pv-subj-n">${PT(`${nch} chapters`, `${nch} 章`)}</small>`}</b><span class="pv-sr ${gp >= 70 ? 'hi' : gp >= 40 ? 'mid' : 'lo'}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="tr"/><circle cx="18" cy="18" r="15" class="fg" stroke-dasharray="${(gp * 0.943).toFixed(1)} 94.3"/></svg><span><b>${gp}%</b><small>${PT('ready', '準備度')}</small></span></span></div>
      ${g.list.map(bookHTML).join('')}</div>`;
  }).join('');
  // Each next step says why it was picked: a short reason tag and one plain sentence with the real number.
  const next = [];
  const nt = tests.steps.find((p) => p.step && p.step.u);
  if (nt) { const uu = nt.book && nt.book.units.find((u) => u.id === nt.step.u), cc = uu && MB.get(nt.book.id).chapters.find((c) => c.unit.id === uu.id);
    next.push([nt.step.t, uu && cc && !cc.done && !cc.learned ? PT(`Your ${nt.x.name} is ${leftText(nt.left)} and covers ${chName(uu)}, which you haven’t started yet.`, `「${nt.x.name}」${leftText(nt.left)}，範圍包括「${chName(uu)}」，你還未開始。`)
      : PT(`Your ${nt.x.name} is ${leftText(nt.left)}. This is the chapter in it that needs the most work${cc ? ` (${cc.pct}% ready)` : ''}.`, `「${nt.x.name}」${leftText(nt.left)}。這是範圍內最需要加強的章節${cc ? `（準備度 ${cc.pct}%）` : ''}。`), nt.step.run, ['test', PT(`Test ${leftText(nt.left)}`, `${leftText(nt.left)}測驗`)]]); }
  if (D.weak && !(nt && nt.step.u === D.weak.unit.id)) { const cc = MB.get(D.weak.book.id).chapters.find((c) => c.unit.id === D.weak.unit.id);
    next.push([PT(`Practise ${chName(D.weak.unit)}`, `練習「${chName(D.weak.unit)}」`), PT(`You got ${D.weak.a}% right on it this week, your lowest of any chapter${cc ? `. It’s ${cc.pct}% ready` : ''}.`, `本週這一章只答對 ${D.weak.a}%，是所有章節中最低${cc ? `，準備度 ${cc.pct}%` : ''}。`), () => startUnits(D.weak.book, [D.weak.unit], local.count || sessionSize()), ['weak', PT('Weakest chapter', '最弱章節')]]); }
  if (D.mistakes) { const top = MK.slice().sort((a, b) => b.items.length - a.items.length)[0];
    next.push([PT(`Fix your mistakes${top && top.unit ? ` in ${chName(top.unit)}` : ''}`, `改正${top && top.unit ? `「${chName(top.unit)}」的` : ''}錯題`), PT(`${D.mistakes} questions you got wrong are waiting${top && top.unit ? `, ${top.items.length} of them in this chapter` : ''}. Fixing them is the quickest way to win marks back.`, `有 ${D.mistakes} 題答錯的題目等你改正${top && top.unit ? `，其中 ${top.items.length} 題在這一章` : ''}。改正錯題是最快拿回分數的方法。`), () => go({ name: 'mistakes', book: top && top.book ? top.book.id : undefined }), ['mistakes', PT(`${D.mistakes} mistakes`, `${D.mistakes} 題錯題`)]]); }
  if (D.due) next.push([PT(`Do ${D.due} review${D.due === 1 ? '' : 's'}`, `溫習 ${D.due} 題`), PT('These questions are due back today. Getting them right now is what makes them stick.', '這些題目今天到期。現在答對，才會記得牢。'), () => startReview('spaced'), ['review', PT('Due today', '今日到期')]]);
  if (!next.length) next.push([PT('Practise a chapter', '練習一個章節'), PT('Pick any chapter to start. Buddy will suggest more as you go.', '選一個章節開始，Buddy 之後會給你更多建議。'), () => go({ name: 'books' }), ['learn', PT('Get started', '開始')]]);
  const names = SKILL_PLAIN();
  const rated = r.sk.map(([a, n], i) => ({ a, n, i })).filter((x) => x.n >= 5 && x.a !== null);
  const best = rated.slice().sort((x, y) => y.a - x.a)[0], worst = rated.slice().sort((x, y) => x.a - y.a)[0];
  const gapNote = best && worst && best.i !== worst.i && best.a - worst.a >= 15
    ? PT(`Strongest at “${names[best.i].toLowerCase()}”. “${names[worst.i]}” questions are the gap, and that’s where test marks are.`, `最擅長「${names[best.i]}」；「${names[worst.i]}」是弱項，也是考試失分的地方。`) : rated.length ? PT('Fairly even across question types.', '各類題型表現大致平均。') : '';
  const sec3 = `<section class="pv-sec"><div class="pv-h"><h2 class="h-info">${PT('Am I mastering my subjects?', '我掌握了各科嗎？')}${ib('howWorkP', PT('How to read this', '怎樣看'))}</h2>
      <span class="pv-legend"><span class="pv-lsub">${PT('How well you know each textbook, chapter by chapter', '你對每本課本、每一章的掌握程度')}</span><i class="good"></i>${PT('Strong', '強')}<i class="mid"></i>${PT('Getting there', '漸入佳境')}<i class="low"></i>${PT('Needs work', '需加強')}</span></div>
    ${how('howWorkP', PT('How to read this', '怎樣看'), `<p>${PT('Each tile is a chapter, coloured by its readiness: green 80% or more, yellow 60–79%, red under 60%, white not started yet. Tap a tile to practise it (or to start its lesson).', '每格是一章，按準備度上色：綠色 80% 或以上，黃色 60–79%，紅色低於 60%，白色未開始。按一格就可以練習（或開始上課）。')}</p>
      <p><b>${PT('Most useful next', '下一步')}</b> · ${PT('in order: what your nearest test needs, then this week’s weakest chapter, then mistakes to fix, then reviews due.', '次序：最近的測驗需要的、本週最弱的章節、要改正的錯題、到期的溫習。')}</p>
      <p><b>${PT('Types of question', '題型')}</b> · ${PT('every question has a level: 1 remember facts, 2 understand, 3 use it, 4 think it through. This is your score on each, over the last 30 days.', '每題都有級別：1 記憶、2 理解、3 應用、4 深入思考。這是過去 30 日各級的得分。')}</p>`)}
    ${subjHTML ? `<div class="pv-subjs">${subjHTML}</div>` : ''}
    </section>`;

  // ---------- 4. Is it working? ----------
  const spark = (pts, cls) => { if (!pts || pts.length < 2) return ''; const lo = Math.min(...pts) - 0.2, hi = Math.max(...pts) + 0.2, W = 110, H = 30;
    return `<svg class="pv-spark ${cls}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.map((v, i) => `${(2 + i * (W - 4) / (pts.length - 1)).toFixed(1)},${(H - 3 - (v - lo) / (hi - lo || 1) * (H - 6)).toFixed(1)}`).join(' ')}" fill="none" stroke-width="2.5" stroke-linecap="round"/></svg>`; };
  const lv = (GS ? GS.s : []).filter((x) => x[1] != null);
  const gName = gradeNow() ? gradeName(gradeNow()) : '';
  const levelCard = `<div class="pv-card"><b class="pv-ct h-info">${PT('Level, by subject', '各科程度')}${infoBtn('howLevelP', PT('What is level?', '甚麼是程度？'))}</b><p class="pv-sm">${PT('How hard a question you get right 2 times in 3, out of 10. It doesn’t drop when questions get harder. The tick marks the level expected for your grade.', '答對三分之二的題目有多難（滿分 10）。題目變難時不會下跌。小直線是你年級的預期程度。')}</p>
    ${lv.length ? lv.slice(0, 5).map(([lab, level, status, change, , line]) => { const r1 = (v) => Math.round(v * 10) / 10, start = change != null ? r1(level - change) : null; level = r1(level); const sl = { rising: PT('Rising', '上升'), dipping: PT('Dipping', '下跌'), steady: PT('Steady', '平穩'), building: PT('Early days', '初步') }[status] || '';
      const ge = gName ? (level >= 3 ? ['above', PT(`Above ${gName}`, `高於${gName}`)] : level >= 2 ? ['meet', PT(`Meeting ${gName}`, `達到${gName}`)] : ['build', PT(`Building to ${gName}`, `邁向${gName}`)]) : null;
      // shown out of 10 (level 1 = 0, level 4 = 10), as a gauge: where they started (ghost), now (fill), and the grade mark
      const t10 = (v) => Math.max(0, Math.min(10, Math.round(((v - 1) / 3) * 100) / 10)), now10 = t10(level), was10 = start != null ? t10(start) : null, gm = t10(2);
      return `<div class="pv-lv2"><div class="pv-lv2-h"><span data-raw>${esc(lab)}</span><em class="${status}">${sl}</em></div>
        <div class="pv-lv2-m"><b>${now10.toFixed(1)}<small>/10</small></b>${was10 != null && Math.abs(now10 - was10) >= 0.1 ? `<span class="${now10 > was10 ? 'up' : 'down'}">${now10 > was10 ? '▲' : '▼'} ${PT(`from ${was10.toFixed(1)}`, `由 ${was10.toFixed(1)}`)}</span>` : ''}</div>
        <div class="pv-gauge"><i class="fill ${ge ? ge[0] : ''}" style="width:${now10 * 10}%"></i>${was10 != null ? `<i class="was" style="left:${was10 * 10}%"></i>` : ''}${gName ? `<i class="gm" style="left:${gm * 10}%" title="${esc(gName)}"></i>` : ''}</div>
        ${ge ? `<i class="pv-ge ${ge[0]}">${ge[1]}</i>` : ''}</div>`; }).join('') : `<p class="pv-empty">${PT('About 2 weeks of practice shows your level.', '練習大約兩星期後就會顯示程度。')}</p>`}
    <details class="ms-how how-panel" id="howLevelP"><summary>${PT('What is level?', '甚麼是程度？')}</summary><div><p>${PT('Questions come in 4 levels: 1 remember, 2 understand, 3 apply, 4 think it through. Your level is the hardest level you get right about 2 times in 3, worked out from first attempts only, allowing for lucky guesses and for help from Buddy. It’s shown out of 10: level 1 is 0, level 4 is 10.', '題目分 4 級：1 記憶、2 理解、3 應用、4 深入思考。程度是你大約答對三分之二的最難級別，只計第一次作答，並考慮猜中和 Buddy 的幫助。')}</p><p>${PT('Unlike % right, it doesn’t fall when the questions get harder, so it’s the fairest way to see whether you’re improving.', '和答對率不同，題目變難時它不會下跌，所以最能公平反映有沒有進步。')}</p>${gName ? `<p><b>${PT(`Against ${gName} expectations`, `與${gName}要求比較`)}</b> · ${PT(`Questions are written for ${gName}: level 2 is what a typical ${gName} school test expects, and levels 3–4 are its harder questions. So under 2 is building towards ${gName}, 2–2.9 is meeting it, and 3 or more is above it.`, `題目按${gName}程度出題：第 2 級是一般${gName}測驗的要求，第 3–4 級是較難的題目。所以低於 2 是邁向${gName}，2–2.9 是達到，3 或以上是高於${gName}。`)}</p>` : ''}</div></details></div>`;
  const lineHTML = `<div id="rwBody">${readyLinesSVG(RH.filter((x) => x.used))}</div>${DEV && RH.length ? `<div class="rw-demo" role="group" aria-label="Sample data"><span>Sample data (dev)</span>${['Real', 'Day 2', 'Day 5', 'Day 12', 'Day 25', 'Wk 6', 'Wk 10'].map((t, k) => `<button type="button" class="${k ? '' : 'on'}" data-rw="${k}">${t}</button>`).join('')}</div>` : ''}`;
  const readyCard = `<div class="pv-card"><b class="pv-ct h-info">${PT('Readiness over time', '準備度的變化')}${ib('howRwP', PT('What is readiness?', '甚麼是準備度？'))}</b>${lineHTML}${how('howRwP', PT('What is readiness?', '甚麼是準備度？'), `<p>${PT('How much of each textbook you really know, out of 100%: the average of its chapters, with longer chapters counting more. One line per subject: one point per day for the first 4 weeks, then one per week.', '你真正掌握每本課本的程度（滿分 100%）：各章的平均，較長的章節比重較大。每科一條線：頭 4 星期每日一點，之後每星期一點。')}</p><p>${PT('It only goes up for real learning: covering every part, getting harder questions right, remembering days later and passing timed chapter tests. Answering lots of easy questions doesn’t move it much.', '只有真正學會才會上升：涵蓋每部分、答對較難的題目、幾天後仍記得、通過限時章節測驗。做很多容易的題目不會令它上升很多。')}</p>`)}</div>`;
  const ML = marksList(), mBase = ML.find((m) => m.kind === 'before'), mLast = ML.filter((m) => m.kind === 'later').pop();
  const msubs = MARK_SUBJ().filter(([k]) => (mBase && typeof mBase.s[k] === 'number') || (mLast && typeof mLast.s[k] === 'number'));
  const marksCard = `<div class="pv-card"><b class="pv-ct h-info">${PT('School marks', '學校成績')}${ib('howMkP', PT('About school marks', '關於學校成績'))}</b>${how('howMkP', PT('About school marks', '關於學校成績'), `<p>${PT('A parent enters the child’s school marks (as %) from the last test or exam before PrepBuddy, then after each test or exam since. Change is the latest minus before.', '家長填寫使用 PrepBuddy 前最後一次測驗或考試的分數（%），之後每次再填。變化是最新減使用前。')}</p><p>${PT('School tests differ in difficulty, so look at the trend over a few tests rather than one result.', '學校測驗難度不一，看幾次的走勢比單次分數更有意思。')}</p>`)}
    ${msubs.length ? `<p class="pv-sm">${PT('Before PrepBuddy vs the latest test, entered by a parent.', '使用 PrepBuddy 前與最近一次測驗，由家長填寫。')}</p><div class="pv-mk"><span></span><span>${PT('Before', '使用前')}</span><span>${PT('Latest', '最新')}</span><span>${PT('Change', '變化')}</span>
      ${msubs.map(([k, z, e]) => { const a = mBase ? mBase.s[k] : null, b = mLast ? mLast.s[k] : null, d = a != null && b != null ? b - a : null;
        return `<span>${zh ? z : e}</span><span class="m0">${a ?? '–'}</span><b>${b ?? '–'}</b><b class="${d == null ? '' : d >= 2 ? 'up' : d <= -2 ? 'down' : ''}">${d == null ? '–' : d > 0 ? '+' + d : d}</b>`; }).join('')}</div>`
      : `<p class="pv-sm">${PT('Add school marks from before PrepBuddy, then after each test, to see subject by subject whether practice is paying off.', '加入使用 PrepBuddy 前的學校分數，之後每次測驗再加入，就能逐科看到練習有沒有成效。')}</p>`}
    ${btn(`+ ${PT('Add results', '加入成績')}`, async () => { await marksScreen(); go({ name: 'progress' }); }, 'pv-btn quiet')}</div>`;
  // growth since the level check: the level of question each chapter serves now, against where it started
  const grow = [];
  for (const b of books) { const pl = ((local.placement || {})[b.id] || {}).u || {};
    for (const [uid, rr] of Object.entries(pl)) { const u = b.units.find((x) => x.id === uid); if (!u || !rr || !rr[1]) continue;
      const pre = `${b.id}:${uid}:`; const n = local.log.filter((e) => e.q && e.q.startsWith(pre) && e.k !== 'mistakes').length; if (n < 5) continue;
      const a = rr[0] / rr[1], s0 = 2 + (a >= 0.99 ? 1 : a < 0.4 ? -1 : 0), s1 = 2 + levelShift(b.id, uid); grow.push({ u, s0, s1 }); } }
  grow.sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0));
  const growCard = grow.length ? `<div class="pv-card"><b class="pv-ct h-info">${PT('Grown since the level check', '自程度測試以來的進步')}${ib('howGrP', PT('How is this worked out?', '這是怎樣計算的？'))}</b>${how('howGrP', PT('How is this worked out?', '這是怎樣計算的？'), `<p>${PT('The level check set a starting level (1–4) for each chapter. Since then, the app moves each chapter’s questions up a level when you score 80% or more and down when you score under 50%, from your last 15 answers.', '程度測試為每章定了起點（1–4 級）。之後，按你最近 15 題的表現，得分 80% 或以上就升一級，低於 50% 就降一級。')}</p><p>${PT('So “Level 1 → 3” means that chapter now gives you level 3 questions, and you’re keeping up.', '所以「程度 1 → 3」表示那一章現在給你第 3 級的題目，而你應付得來。')}</p>`)}<p class="pv-sm">${PT('The level of question each chapter gives you now, against where you started.', '每章現在給你的題目程度，與開始時比較。')}</p>
    ${grow.slice(0, 5).map((g) => `<div class="pv-gr"><span data-raw>${esc(chName(g.u))}</span><b>${PT('Level', '程度')} ${g.s0} → <em class="${g.s1 > g.s0 ? 'up' : ''}">${g.s1}</em></b></div>`).join('')}</div>` : '';
  // progress check: the level-check chapters again, at the same level, to compare before and now
  const plBooks = books.filter((b) => (local.placement || {})[b.id]);
  const pcCard = plBooks.length ? (() => {
    const rows = plBooks.slice(0, 3).map((b) => {
      const pl = local.placement[b.id], pc = (local.pchecks || []).filter((x) => x.b === b.id && x.t > pl.t).pop();
      const pctOf = (per) => { const v = Object.values(per || {}); const g = v.reduce((a, x) => a + x[0], 0), m = v.reduce((a, x) => a + x[1], 0); return m ? Math.round(100 * g / m) : null; };
      const before = pctOf(pl.u), nowP = pc ? pctOf(pc.per) : null, last = pc ? pc.t : pl.t, due = last + 28 * DAY;
      const chs = pc ? b.units.filter((u) => pl.u[u.id] && pc.per[u.id]).map((u) => { const a = pl.u[u.id], c = pc.per[u.id]; return { u, a: Math.round(100 * a[0] / a[1]), c: Math.round(100 * c[0] / c[1]) }; }) : [];
      return `<div class="pv-pc"><div class="pv-pc-h"><b data-raw>${esc(sname(b))}</b>${nowP != null ? `<span><s>${before}%</s> → <b class="${nowP > before ? 'good' : nowP < before ? 'low' : ''}">${nowP}%</b></span>` : `<span>${PT('Level check', '程度評估')} ${before}%</span>`}</div>
        ${chs.length ? `<div class="pv-pcch">${chs.slice(0, 6).map((x) => `<span data-raw>${esc(chName(x.u))}</span><em>${x.a}% → <b class="${x.c > x.a ? 'good' : x.c < x.a ? 'low' : ''}">${x.c}%</b></em>`).join('')}</div>` : ''}
        ${now >= due ? btn(pc ? PT('Take the next progress check · 5 min', '做下一次進度檢查 · 5 分鐘') : PT('Take a progress check · 5 min', '做進度檢查 · 5 分鐘'), () => startProgressCheck(b), 'pv-btn soft') : `<p class="pv-sm">${PT(`Next progress check from ${new Date(due).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}.`, `下次進度檢查：${new Date(due).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} 起。`)}</p>`}</div>`;
    }).join('');
    return `<div class="pv-card"><b class="pv-ct h-info">${PT('Progress check: before and now', '進度檢查：之前與現在')}${ib('howPc', PT('What is a progress check?', '甚麼是進度檢查？'))}</b>${rows}<span class="pv-op">${PT('Only PrepBuddy · before and after at the same level', '只有 PrepBuddy · 相同程度的前後對比')}</span>
      ${how('howPc', PT('What is a progress check?', '甚麼是進度檢查？'), `<p>${PT('When a textbook is added, a short level check asks about 2 questions from each of up to 6 chapters. Every 4 weeks, a progress check asks the same chapters again, at the same level, with new questions.', '加入課本時，程度評估會在最多 6 章中每章問約 2 題。之後每 4 星期，進度檢查會用新題目、以相同程度再問同樣的章節。')}</p><p>${PT('Because the chapters and the level are the same, the two scores compare fairly: it’s the clearest before-and-after there is. It takes about 5 minutes.', '章節和程度都一樣，兩次分數可以公平比較，是最清楚的前後對比。大約 5 分鐘。')}</p>`)}</div>`;
  })() : '';
  const memCard = ret != null || D.longTerm ? `<div class="pv-card"><b class="pv-ct h-info">${PT('Remembered, not just learned', '記得，不只是學過')}${ib('howMemP', PT('How is this worked out?', '這是怎樣計算的？'))}</b>${how('howMemP', PT('How is this worked out?', '這是怎樣計算的？'), `<p>${PT('Every question you get fully right comes back later: after 1 day, then 3, 7, 14 and 30 days. The % is how many you got right when they came back.', '每題完全答對後會再出現：1 日後，然後 3、7、14、30 日後。百分比是再出現時答對的比例。')}</p><p>${PT('“Remembered for a week or more” counts questions that have come back right at the 7-day step or later.', '「記得一星期或以上」是在 7 日或之後再出現時仍答對的題目。')}</p>`)}${ret != null ? `<div class="pv-big"><b>${ret}%</b><span>${PT('of reviews right days later', '的溫習題幾天後仍答對')}</span></div>` : ''}<p class="pv-sm">${PT(`${D.longTerm} questions remembered for a week or more.`, `${D.longTerm} 題已記得一星期或以上。`)}</p></div>` : '';
  const timed = (local.tests || []).filter((x) => x.t > now - 60 * DAY && x.m && x.nt === 0);
  const prac = local.log.filter((e) => e.t > now - 60 * DAY && !['dse', 'mock', 'mistakes'].includes(e.k));
  const tAcc = timed.length >= 2 ? Math.round(100 * timed.reduce((a, x) => a + x.g, 0) / timed.reduce((a, x) => a + x.m, 0)) : null;
  const pAcc = prac.length >= 30 ? Math.round(100 * prac.reduce((a, e) => a + e.g, 0) / Math.max(1, prac.reduce((a, e) => a + e.m, 0))) : null;
  const timedCard = tAcc != null && pAcc != null ? `<div class="pv-card"><b class="pv-ct h-info">${PT('Under test conditions', '考試狀態下')}${ib('howTmP', PT('How is this worked out?', '這是怎樣計算的？'))}</b>${how('howTmP', PT('How is this worked out?', '這是怎樣計算的？'), `<p>${PT('Practice is your score on normal practice over the last 60 days. Timed tests is your score on timed chapter tests and papers over the same 60 days.', '練習是過去 60 日一般練習的得分。限時測驗是同一期間限時章節測驗和試卷的得分。')}</p><p>${PT('A drop of 8% or more under time usually means working too slowly or panicking, not missing knowledge. Timed practice fixes it.', '限時下跌 8% 或以上，通常是太慢或緊張，而不是不懂。多做限時練習就能改善。')}</p>`)}<div class="pv-pair"><span>${PT('Practice', '練習')} <b>${pAcc}%</b></span><span>${PT('Timed tests', '限時測驗')} <b class="${pAcc - tAcc >= 8 ? 'mid' : 'good'}">${tAcc}%</b></span></div>
    <p class="pv-sm">${pAcc - tAcc >= 8 ? PT(`${pAcc - tAcc}% lower when timed. One timed chapter test a week builds exam stamina.`, `限時下低 ${pAcc - tAcc}%。每星期做一次限時章節測驗，可以增強考試耐力。`) : PT('Holds up well under time pressure.', '在時間壓力下表現穩定。')}</p>
    ${pAcc - tAcc >= 8 && shown[0] ? btn(PT('Take a timed chapter test', '做限時章節測驗'), () => go({ name: 'book', bookId: shown[0].b.id }), 'pv-btn soft') : ''}</div>` : '';

  // ---------- headline numbers + charts ----------
  const WK = 7 * DAY, mon0 = (() => { const d = new Date(t0); const k = (d.getDay() + 6) % 7; return t0 - k * DAY; })(); // Monday this week
  // a daily snapshot of the headline numbers, so their trend lines build up over time
  const used = RH.filter((x) => x.used);
  const testSoon = new Set(tests.steps.filter((p) => p.book && p.left <= 30).map((p) => p.book.id));
  const wOf = (x) => (testSoon.has(x.b.id) ? 2 : 1);
  const overall = used.length ? Math.round(used.reduce((a, x) => a + x.pct * wOf(x), 0) / used.reduce((a, x) => a + wOf(x), 0)) : 0;
  let chDone = 0, chAll = 0; for (const x of (used.length ? used : RH)) { const m = MB.get(x.b.id); chAll += m.chapters.length; chDone += m.chapters.filter((c) => c.pct >= 80).length; }
  local.kpi = (local.kpi || []).filter((k) => k.d !== t0).concat([{ d: t0, r: overall, c: chDone, m: D.longTerm }]).slice(-180);
  const kAt = (t, f) => { const k = local.kpi.filter((x) => x.d <= t).pop(); return k ? k[f] : null; };
  const weekly = (f) => Array.from({ length: 12 }, (_, i) => kAt(t0 - (11 - i) * WK, f)).filter((v) => v != null);
  // readiness can also be rebuilt from each book's own history, so its line works from day one
  const rdLine = Array.from({ length: 12 }, (_, i) => { const t = t0 - (11 - i) * WK; const pts = used.map((x) => { const p = (local.mhist[x.b.id] || []).filter((h) => h[0] <= t).pop(); return p ? [p[1], wOf(x)] : null; }).filter(Boolean);
    return pts.length ? Math.round(pts.reduce((a, p) => a + p[0] * p[1], 0) / pts.reduce((a, p) => a + p[1], 0)) : null; }).filter((v) => v != null);
  const dayMap = new Map(); local.log.forEach((e) => { const d = dayStart(e.t); dayMap.set(d, (dayMap.get(d) || 0) + 1); });
  const days28 = Array.from({ length: 28 }, (_, i) => t0 - i * DAY).filter((d) => dayMap.has(d)).length;
  const consLine = Array.from({ length: 12 }, (_, i) => { const end = t0 - (11 - i) * WK; return Array.from({ length: 7 }, (_, k) => end - k * DAY).filter((d) => dayMap.has(d)).length; });
  const ago = (line, n = 4) => (line.length > n ? line[line.length - 1 - n] : null);
  const delta = (now2, was, unit = '') => (was == null ? '' : now2 > was ? `<small class="up">▲ ${now2 - was}${unit} ${PT('in 4 weeks', '（4 星期）')}</small>` : now2 < was ? `<small class="down">▼ ${was - now2}${unit} ${PT('in 4 weeks', '（4 星期）')}</small>` : `<small>${PT('no change in 4 weeks', '4 星期沒有變化')}</small>`);
  const kspark = (pts) => { if (!pts || pts.length < 2) return ''; const lo = Math.min(...pts), hi = Math.max(...pts), W = 120, H = 34;
    return `<svg class="pv-kspark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.map((v, i) => `${(2 + i * (W - 4) / (pts.length - 1)).toFixed(1)},${(H - 3 - ((v - lo) / ((hi - lo) || 1)) * (H - 6)).toFixed(1)}`).join(' ')}" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
  const cLine = weekly('c'), mLine = weekly('m');
  // headline tiles: a coloured icon, the number, and a small picture of it (ring, bar, dots or trend line)
  const KI = { ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>', book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M9 8h7M9 12h5"/>', brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>' };
  const kic = (k) => `<span class="pv-kic ${k}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KI[k]}</svg></span>`;
  const kpi = (k, v, lab, sub, vis, id, t) => `<div class="pv-kpi k-${k}"><div class="pv-kpi-t">${kic(k)}<span class="h-info">${lab}${ib(id, t)}</span></div><div class="pv-kpi-m"><div class="pv-kpi-v"><b>${v}</b>${sub}</div>${vis}</div></div>`;
  const kring = (p) => `<svg class="pv-kring" width="64" height="64" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#E6EAF4" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(94.25 * Math.max(0, Math.min(100, p)) / 100).toFixed(1)} 94.25" transform="rotate(-90 18 18)"/></svg>`;
  const kbar = (a, b) => (b <= 12 ? `<div class="pv-kbar" aria-hidden="true">${Array.from({ length: b }, (_, i) => `<i class="${i < a ? 'on' : ''}"></i>`).join('')}</div>` : `<div class="pv-ktrack" aria-hidden="true"><i style="width:${Math.round(100 * a / Math.max(1, b))}%"></i></div>`);
  const kdots = () => `<div class="pv-kdots" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => { const d = t0 - (27 - i) * DAY; return `<i class="${dayMap.has(d) ? 'on' : ''} ${d === t0 ? 'today' : ''}"></i>`; }).join('')}</div>`;
  // What PrepBuddy did this week: the work a tutor would do, counted
  const wkLog = local.log.filter((e) => e.t >= t0 - 6 * DAY), wAgo = now - 7 * DAY;
  const didL = [[wkLog.length, PT('questions from your own textbooks', '條題目來自你自己的課本'), 'practise'], [wkLog.filter((e) => e.ty === 'w').length, PT('written answers marked, with feedback', '條文字答案已批改並有評語'), 'writing'],
    [ins ? ins.list.length : 0, PT(ins && ins.list.length === 1 ? 'mix-up found by reading your answers' : 'mix-ups found by reading your answers', '個混淆從你的答案中找出'), 'weak'], [wkLog.filter((e) => e.k === 'spaced').length, PT('reviews brought back just before you’d forget', '條溫習題在快忘記前再出現'), 'review'],
    [Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > wAgo).length, PT('mistakes fixed on a second try', '題錯題再做時改正'), 'mistakes'],
    [Object.values(local.learned || {}).filter((t) => (typeof t === 'number' ? t : 0) > wAgo).length, PT('lessons taught by Buddy', '堂 Buddy 課堂'), 'learn'],
    [(local.hw || []).filter((h) => h.t > wAgo).length, PT('homework sheets helped with', '份功課得到協助'), 'homework']].filter(([n]) => n > 0).slice(0, 6);
  const nt0 = tests.steps.find((p) => p.left >= 1 && p.left <= 21);
  const didHTML = didL.length ? `<section class="pv-sec pv-did"><div class="pv-h"><h2>${PT('What PrepBuddy did for you this week', 'PrepBuddy 本週為你做了甚麼')}</h2><span>${PT('The work of a tutor, every day you practised', '好導師會做的事，你每次練習都有')}</span></div>
    <div class="pv-didg2">${didL.map(([n, l, ic]) => `<div class="dd-${ic}">${actionTile(ic, 40)}<b>${n}</b><span>${l}</span></div>`).join('')}${nt0 ? `<div class="dd-test">${actionTile('test', 40)}<b>${PT(`${nt0.left} days`, `${nt0.left} 日`)}</b><span data-raw>${esc(PT(`planned towards the ${nt0.x.name}`, `為「${nt0.x.name}」安排`))}</span></div>` : ''}</div></section>` : '';
  const kpiHTML = `<section class="pv-kpis\" aria-label="${PT('Headline numbers', '主要數字')}">
    ${kpi('ring', `${overall}%`, `<span class="kl-l">${PT('Overall readiness', '整體準備度')}</span><span class="kl-s">${PT('Readiness', '準備度')}</span>`, delta(overall, ago(rdLine), '%'), `<div class="pv-kvis">${kring(overall)}<div class="pv-ktrack pv-kmob" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, overall))}%"></i></div></div>`, 'howK1', PT('What is overall readiness?', '甚麼是整體準備度？'))}
    ${kpi('book', `${chDone}<small>/${chAll}</small>`, `<span class="kl-l">${PT('Chapters mastered', '已掌握的章節')}</span><span class="kl-s">${PT('Mastered', '已掌握')}</span>`, delta(chDone, ago(cLine)) || `<small>${chAll - chDone ? PT(`${chAll - chDone} to go`, `還有 ${chAll - chDone} 章`) : PT('all mastered', '全部掌握')}</small>`, `<div class="pv-kvis">${kbar(chDone, chAll)}</div>`, 'howK2', PT('What counts as mastered?', '怎樣才算掌握？'))}
    ${kpi('brain', String(D.longTerm), `<span class="kl-l">${PT('In long-term memory', '長期記憶')}</span><span class="kl-s">${PT('Memory', '記憶')}</span>`, delta(D.longTerm, ago(mLine)) || `<small>${PT('questions remembered a week later', '題一星期後仍記得')}</small>`, `<div class="pv-kvis">${kspark(mLine)}</div>`, 'howK3', PT('What is long-term memory?', '甚麼是長期記憶？'))}
    ${kpi('cal', `${days28}<small>/28</small>`, `<span class="kl-l">${PT('Days practised', '練習日數')}</span><span class="kl-s">${PT('Days', '日數')}</span>`, `<small>${PT('in the last 4 weeks', '過去 4 星期')}</small>`, `<div class="pv-kvis">${kdots()}</div>`, 'howK4', PT('Why consistency?', '為甚麼看持續性？'))}
    ${how('howK1', PT('What is overall readiness?', '甚麼是整體準備度？'), `<p>${PT('One number for how prepared you are across all your subjects: the readiness of each textbook you practise, averaged, with subjects that have a test in the next 30 days counting double.', '所有科目準備程度的一個數字：每本有練習的課本的準備度平均，30 日內有測驗的科目計雙倍。')}</p><p>${PT('The line shows it week by week over the last 12 weeks.', '線圖顯示過去 12 星期每週的變化。')}</p>`)}
    ${how('howK2', PT('What counts as mastered?', '怎樣才算掌握？'), `<p>${PT('A chapter counts as mastered at 80% readiness or more. That needs a timed chapter test passed, plus covering the chapter, harder questions right first time and things remembered in reviews.', '準備度達 80% 或以上的章節就算掌握。這需要通過限時章節測驗，並涵蓋全章、較深題目第一次就答對和溫習時記得。')}</p><p>${PT('Out of all the chapters in the textbooks you practise.', '分母是你有練習的課本的所有章節。')}</p>`)}
    ${how('howK3', PT('What is long-term memory?', '甚麼是長期記憶？'), `<p>${PT('Questions you got right again a week or more after first getting them right. Reviews bring questions back after 1, 3, 7, 14 and 30 days; reaching the 7-day step means it has stuck.', '答對後一星期或更久仍再次答對的題目。溫習會在 1、3、7、14、30 日後再出題；到了 7 日那一步，就代表記住了。')}</p><p>${PT('This only grows if reviews are done, so it shows real learning, not cramming.', '只有做溫習才會增加，所以反映的是真正學會，而不是臨急抱佛腳。')}</p>`)}
    ${how('howK4', PT('Why consistency?', '為甚麼看持續性？'), `<p>${PT('Days with any practice in the last 4 weeks. The line shows days per week over 12 weeks.', '過去 4 星期有練習的日數。線圖顯示 12 星期內每星期的日數。')}</p><p>${PT('A little most days beats a lot once a week: memory works best with short, spaced practice.', '每天少少，勝過一星期一次做很多：短時間、分散的練習最能幫助記憶。')}</p>`)}
  </section>`;

  // practice calendar: the last 12 weeks, one square a day, shaded by questions answered
  const calStart = mon0 - 11 * WK, shade = (n) => (!n ? 0 : n < 10 ? 1 : n < 20 ? 2 : n < 40 ? 3 : 4);
  const calCols = Array.from({ length: 12 }, (_, w) => `<div class="pv-calc">${Array.from({ length: 7 }, (_, d) => { const t = calStart + w * WK + d * DAY, n = dayMap.get(t) || 0, fut = t > t0;
    return `<i class="${fut ? 'fut' : 's' + shade(n)}" title="${new Date(t).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' })}: ${n} ${PT('questions', '題')}"></i>`; }).join('')}</div>`).join('');
  const dl = zh ? ['一', '', '三', '', '五', '', '日'] : ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
  const calCard = `<div class="pv-card pv-calcard"><b class="pv-ct h-info">${PT('Practice calendar', '練習日曆')}${ib('howCal', PT('How to read this', '怎樣看這個圖'))}</b><p class="pv-sm">${PT('The last 12 weeks. Darker means more questions that day.', '過去 12 星期，顏色越深，當天做的題目越多。')}</p>
    <div class="pv-cal"><div class="pv-cald">${dl.map((x) => `<span>${x}</span>`).join('')}</div>${calCols}</div>
    <div class="pv-callg"><span>${PT('Less', '少')}</span><i class="s0"></i><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i><span>${PT('More', '多')}</span></div>
    ${how('howCal', PT('How to read this', '怎樣看這個圖'), `<p>${PT('Each square is a day, each column a week (Monday at the top). The colour shows how many questions were answered that day: none, under 10, 10–19, 20–39, 40 or more.', '每格是一日，每直行是一星期（星期一在最上）。顏色代表當天答了多少題：沒有、少於 10、10–19、20–39、40 或以上。')}</p><p>${PT('Look for gaps: missed weekends or a quiet week before a test are easy to spot here.', '留意空白：漏了的週末或測驗前很少練習的一星期，在這裡一看便知。')}</p>`)}</div>`;

  // taking on harder questions: the mix of question levels answered each week (last 8 weeks)
  const mixW = Array.from({ length: 8 }, (_, i) => { const end = t0 + DAY - (7 - i) * WK, start = end - WK; const c = [0, 0, 0, 0]; local.log.forEach((e) => { if (e.t >= start && e.t < end) c[Math.max(1, Math.min(4, e.l || 2)) - 1]++; }); return { c, n: c.reduce((a, b) => a + b, 0), start }; });
  const mixCard = mixW.some((w) => w.n) ? `<div class="pv-card"><b class="pv-ct h-info">${PT('Taking on harder questions', '挑戰較難的題目')}${ib('howMix', PT('How to read this', '怎樣看這個圖'))}</b><p class="pv-sm">${PT('The mix of question levels each week. More dark blue means harder questions.', '每星期各級題目的比例，深藍色越多代表題目越難。')}</p>
    <div class="pv-mix">${mixW.map((w) => `<div class="pv-mixc" title="${w.n} ${PT('questions', '題')}">${w.n ? [3, 2, 1, 0].map((k) => (w.c[k] ? `<i class="l${k + 1}" style="height:${(100 * w.c[k] / w.n).toFixed(1)}%"></i>` : '')).join('') : '<i class="l0" style="height:100%"></i>'}</div>`).join('')}</div>
    <div class="pv-mixx">${mixW.map((w, i) => `<span>${i === 7 ? PT('This wk', '本週') : i === 0 ? PT('8 wks ago', '8 週前') : ''}</span>`).join('')}</div>
    <div class="pv-callg">${[1, 2, 3, 4].map((k) => `<i class="l${k}"></i><span>${[PT('Remember', '記憶'), PT('Understand', '理解'), PT('Use it', '應用'), PT('Think it through', '深入思考')][k - 1]}</span>`).join('')}</div>
    ${how('howMix', PT('How to read this', '怎樣看這個圖'), `<p>${PT('Every question has a level from 1 (remember a fact) to 4 (think it through). Each bar is one week of answers, split by level.', '每題都有 1（記憶事實）至 4（深入思考）的級別。每條棒是一星期的答題，按級別分開。')}</p><p>${PT('The app gives harder questions as you get them right, so the dark part growing over the weeks is proof of progress, even when % right stays the same.', '你答對了，程序就會出較難的題目。所以深色部分逐週增加，就是進步的證明，即使答對率沒有變。')}</p>`)}</div>` : '';

  // the mistake book over time: open mistakes at the end of each week, and fixed vs new that week
  const firstWrong = new Map(); local.log.forEach((e) => { if (e.g < e.m && !firstWrong.has(e.q)) firstWrong.set(e.q, e.t); });
  const MKE = Object.entries(local.mistakes || {}).map(([id, m]) => ({ made: Math.min(firstWrong.get(id) || m.t, m.t), done: m.done ? m.doneAt || m.t : null }));
  const mkW = Array.from({ length: 8 }, (_, i) => { const end = t0 + DAY - (7 - i) * WK, start = end - WK;
    return { open: MKE.filter((x) => x.made < end && (!x.done || x.done >= end)).length, fixed: MKE.filter((x) => x.done && x.done >= start && x.done < end).length, made: MKE.filter((x) => x.made >= start && x.made < end).length }; });
  const mkMax = Math.max(1, ...mkW.map((w) => Math.max(w.open, w.fixed, w.made)));
  const mkCard = MKE.length ? (() => { const W = 300, H = 120, x = (i) => 14 + i * (W - 28) / 7, y = (v) => H - 18 - v / mkMax * (H - 30);
    const bars = mkW.map((w, i) => `<rect x="${(x(i) - 9).toFixed(1)}" y="${y(w.fixed).toFixed(1)}" width="8" height="${(H - 18 - y(w.fixed)).toFixed(1)}" rx="2" fill="#18966A"/><rect x="${(x(i) + 1).toFixed(1)}" y="${y(w.made).toFixed(1)}" width="8" height="${(H - 18 - y(w.made)).toFixed(1)}" rx="2" fill="#F0A35E"/>`).join('');
    const line = `<polyline points="${mkW.map((w, i) => `${x(i).toFixed(1)},${y(w.open).toFixed(1)}`).join(' ')}" fill="none" stroke="#26357A" stroke-width="2.5" stroke-linejoin="round"/>${mkW.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.open).toFixed(1)}" r="3" fill="#26357A"/>`).join('')}`;
    const a = mkW[0].open, b = mkW[7].open;
    return `<div class="pv-card"><b class="pv-ct h-info">${PT('Mistake book over time', '錯題簿的變化')}${ib('howMk', PT('How to read this', '怎樣看這個圖'))}</b>
      <p class="pv-sm">${b < a ? PT(`Down from ${a} to ${b} open mistakes in 8 weeks: gaps are closing.`, `8 星期內未改正的錯題由 ${a} 減至 ${b}，漏洞正在補上。`) : b > a ? PT(`Up from ${a} to ${b} open mistakes in 8 weeks. Fixing a few each day turns it around.`, `8 星期內未改正的錯題由 ${a} 增至 ${b}。每天改正幾題就能扭轉。`) : PT(`${b} open mistakes, about the same as 8 weeks ago.`, `未改正的錯題 ${b} 題，和 8 星期前差不多。`)}</p>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${PT('Open mistakes each week, with mistakes fixed and new', '每星期未改正的錯題，以及改正和新增的錯題')}"><line x1="0" y1="${H - 18}" x2="${W}" y2="${H - 18}" stroke="#E6EAF2"/>${bars}${line}<text x="4" y="${H - 4}" font-size="10" fill="#5A6380">${PT('8 wks ago', '8 週前')}</text><text x="${W - 4}" y="${H - 4}" font-size="10" fill="#5A6380" text-anchor="end">${PT('This wk', '本週')}</text></svg>
      <div class="pv-callg"><i style="background:#26357A;border-radius:50%"></i><span>${PT('Open', '未改正')}</span><i style="background:#18966A"></i><span>${PT('Fixed', '已改正')}</span><i style="background:#F0A35E"></i><span>${PT('New', '新錯題')}</span></div>
      ${how('howMk', PT('How to read this', '怎樣看這個圖'), `<p>${PT('The blue line is how many mistakes were still open (not yet got right) at the end of each week. Green bars are mistakes fixed that week; orange bars are new mistakes that week.', '藍線是每星期結束時仍未改正的錯題數。綠色棒是當星期改正的錯題，橙色棒是當星期新增的錯題。')}</p><p>${PT('Every wrong answer goes into the mistake book; getting it fully right later fixes it. A falling blue line means the gaps are closing.', '每題答錯都會放進錯題簿；之後完全答對就算改正。藍線下降，代表漏洞正在補上。')}</p>`)}</div>`; })() : '';
  // first tries only (reviews and redone mistakes are mostly remembering questions seen before), last 30 days
  const tySeen = new Set(), FT = [];
  for (const e of local.log) { if (!e.q || !e.m || tySeen.has(e.q)) continue; tySeen.add(e.q); if (e.t >= now - 30 * DAY && e.k !== 'mistakes' && e.k !== 'spaced') FT.push(e); }
  const tyAcc = (es) => { const m = es.reduce((a, e) => a + e.m, 0); return m ? Math.round(100 * es.reduce((a, e) => a + e.g, 0) / m) : null; };
  const tyL = (e) => Math.max(1, Math.min(4, Math.round(e.l || 2)));
  const byL = [1, 2, 3, 4].map((l) => { const es = FT.filter((e) => tyL(e) === l); return { l, a: tyAcc(es), n: es.length }; }).filter((x) => x.n >= 3 && x.a != null);
  // the weakest subject x type with enough answers to trust
  const cellM = new Map(); for (const e of FT) { const bk = books.find((b) => e.q.startsWith(b.id + ':')); if (!bk) continue; const k = `${bk.id}|${tyL(e)}`; (cellM.get(k) || cellM.set(k, { bk, l: tyL(e), es: [] }).get(k)).es.push(e); }
  const weakC = [...cellM.values()].filter((c) => c.es.length >= 6).map((c) => ({ ...c, a: tyAcc(c.es) })).filter((c) => c.a != null && c.a < 70).sort((a, b) => a.a - b.a)[0];
  const tyBest = byL.slice().sort((a, b) => b.a - a.a)[0], tyWorst = byL.slice().sort((a, b) => a.a - b.a)[0];
  const tyNote = weakC ? PT(`Weakest spot: <b>${esc(sname(weakC.bk))} · ${names[weakC.l - 1].toLowerCase()}</b>, ${weakC.a}% right on first tries.`, `最弱的地方：<b>${esc(sname(weakC.bk))} ·「${names[weakC.l - 1]}」</b>，第一次作答答對 ${weakC.a}%。`)
    : tyBest && tyWorst && tyBest.l !== tyWorst.l && tyBest.a - tyWorst.a >= 15 ? PT(`Strongest at “${names[tyBest.l - 1].toLowerCase()}”. “${names[tyWorst.l - 1]}” questions are the gap, and that’s where test marks are.`, `最擅長「${names[tyBest.l - 1]}」；「${names[tyWorst.l - 1]}」是弱項，也是考試失分的地方。`)
    : byL.length ? PT('Fairly even across question types.', '各類題型表現大致平均。') : '';
  const weakUnits = weakC ? [...new Set(weakC.es.map((e) => qUnit(e.q)[1]))].map((id) => weakC.bk.units.find((u) => u.id === id)).filter(Boolean).slice(0, 3) : [];
  const typesCard = byL.length ? `<div class="pv-card pv-typescard"><b class="pv-ct">${PT('Types of question', '題型')}</b><p class="pv-sm">${PT('How often you get each kind right on the first try, last 30 days.', '過去 30 日第一次作答時，各類題目的答對率。')}</p>
    <div class="pv-tbars">${byL.map((x) => `<div class="pv-tb ${tone(x.a)}"><span>${names[x.l - 1]}</span><b>${x.a}%</b><i><s style="width:${x.a}%"></s></i></div>`).join('')}</div>${tyNote ? `<p class="pv-sm" style="margin:0">${tyNote}</p>` : ''}
    ${weakC && weakUnits.length ? btn(PT(`Practise ${names[weakC.l - 1].toLowerCase()} questions in ${sname(weakC.bk)}`, `練習${sname(weakC.bk)}的「${names[weakC.l - 1]}」題`), () => startUnits(weakC.bk, weakUnits, 8, { diff: `l${weakC.l}` }), 'pv-btn soft') : ''}</div>` : '';
  const sec4 = `<section class="pv-sec"><div class="pv-h"><h2>${PT('Is it working?', '有沒有成效？')}</h2><span>${PT('Proof that practice is paying off', '練習有沒有效果')}</span></div>
    <div class="pv-grid3">${levelCard}${pcCard}${readyCard}${mixCard}${typesCard}${mkCard}${marksCard}${growCard}${memCard}${timedCard}</div>
</section>`;

  // ---------- 5. Effort and habits ----------
  const mins = r.days.reduce((a, m) => a + m, 0), hmOf = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : PT(`${m} min`, `${m} 分鐘`));
  const logP = local.log.filter((e) => e.t >= t0 - 13 * DAY && e.t < t0 - 6 * DAY), daysP = new Set(logP.map((e) => dayStart(e.t))).size;
  const allDays = [...new Set(local.log.map((e) => dayStart(e.t)))].sort((a, b) => a - b);
  let bestRun = 0, run = 0, prevD = 0; allDays.forEach((d) => { run = prevD && d - prevD <= DAY + 3600e3 ? run + 1 : 1; bestRun = Math.max(bestRun, run); prevD = d; });
  const cmp = (a, b, unit = '') => (b == null ? '' : a > b ? `<small class="up">▲ ${PT(`from ${b}${unit}`, `上週 ${b}${unit}`)}</small>` : a < b ? `<small class="down">▼ ${PT(`from ${b}${unit}`, `上週 ${b}${unit}`)}</small>` : `<small>${PT('same as last week', '和上週一樣')}</small>`);
  const wk = now - 7 * DAY, ME = Object.values(local.mistakes || {});
  const fixedW = ME.filter((m) => m.done && (m.doneAt || 0) > wk && !m.manual).length, newW = ME.filter((m) => !m.done && m.t > wk).length;
  // best time of day: the 2-hour band with the highest score over the last 30 days (needs 20+ answers in it)
  const band = {}; local.log.filter((e) => e.t > now - 30 * DAY).forEach((e) => { const h = Math.floor(new Date(e.t).getHours() / 2) * 2; const x = band[h] || (band[h] = [0, 0, 0]); x[0] += e.g; x[1] += e.m; x[2]++; });
  const bands = Object.entries(band).filter(([, x]) => x[2] >= 20 && x[1]).map(([h, x]) => [+h, x[0] / x[1]]).sort((a, b) => b[1] - a[1]);
  const fmtH = (h) => (zh ? `${h}:00` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`);
  const tileE = (v, lab, sub) => `<div class="pv-eff"><b>${v}</b><span>${lab}</span>${sub || ''}</div>`;
  const BY = beyondData(), wMarked = wkLog.filter((e) => e.ty === 'w').length;
  const sec5 = `<section class="pv-sec"><div class="pv-h"><h2 class="h-info">${PT('Effort and habits', '努力與習慣')}${ib('howEffP', PT('How is this counted?', '這是怎樣計算的？'))}</h2><span>${PT('This week, compared with last week', '本週，與上週比較')}</span></div>
    ${how('howEffP', PT('How is this counted?', '這是怎樣計算的？'), `<ul><li><b>${PT('Days, time and questions', '日數、時間和題數')}</b> · ${PT('the last 7 days, against the 7 days before. Time is counted from when you answer questions.', '過去 7 日，與之前 7 日比較。時間按作答時計算。')}</li>
      <li><b>${PT('Streak', '連續練習')}</b> · ${PT('days in a row with some practice, up to today.', '連續有練習的日數，直到今天。')}</li><li><b>${PT('Missions finished', '完成的任務')}</b> · ${PT('days this week when every step of Today’s mission was done, out of the days Today was opened. Finishing the plan matters more than total time.', '本週打開「今天」的日子中，完成所有任務步驟的日數。完成計劃比總時間更重要。')}</li>
      <li><b>${PT('Fixed vs new mistakes', '改正與新錯題')}</b> · ${PT('mistakes put right this week against new ones still open. Fixing faster than making means the mistake book is shrinking.', '本週改正的錯題與仍未改正的新錯題比較。改正比犯錯快，代表錯題簿在減少。')}</li>
      <li><b>${PT('Best time', '最好的時段')}</b> · ${PT('the 2-hour slot with your highest score over the last 30 days (with at least 20 answers in it).', '過去 30 日得分最高的兩小時時段（最少 20 題）。')}</li></ul>`)}
    <div class="pv-grid6">${tileE(`${r.dp}<small>/7</small>`, PT('days practised', '日有練習'), cmp(r.dp, logP.length ? daysP : null))}
      ${tileE(hmOf(mins), PT('practising', '練習時間'), r.pm != null && (r.pm || mins) ? (mins > r.pm ? `<small class="up">▲ ${PT(`from ${hmOf(r.pm)}`, `上週 ${hmOf(r.pm)}`)}</small>` : mins < r.pm ? `<small class="down">▼ ${PT(`from ${hmOf(r.pm)}`, `上週 ${hmOf(r.pm)}`)}</small>` : `<small>${PT('same as last week', '和上週一樣')}</small>`) : '')}
      ${tileE(String(r.q), PT('questions', '題目'), r.pq || r.q ? cmp(r.q, r.pq) : '')}
      ${tileE(PT(`${D.streak} day${D.streak === 1 ? '' : 's'}`, `${D.streak} 日`), PT('streak', '連續練習'), bestRun > 1 ? `<small>${PT(`best ever: ${bestRun}`, `最長：${bestRun} 日`)}</small>` : '')}
      ${(() => { const md = local.mdone || {}, wkDays = Object.keys(md).map(Number).filter((d) => d > t0 - 7 * DAY), pv = Object.keys(md).map(Number).filter((d) => d <= t0 - 7 * DAY && d > t0 - 14 * DAY);
        const fin = (ds) => ds.filter((d) => md[d][1] && md[d][0] >= md[d][1]).length;
        return wkDays.length ? tileE(`${fin(wkDays)}<small>/${wkDays.length}</small>`, PT('missions finished', '完成的任務'), pv.length ? cmp(fin(wkDays), fin(pv)) : `<small>${PT('days a mission was set', '有任務的日數')}</small>`) : ''; })()}
      ${fixedW || newW ? tileE(PT(`${fixedW} fixed`, `改正 ${fixedW} 題`), PT(`vs ${newW} new mistakes`, `新錯題 ${newW} 題`), `<small class="${fixedW >= newW ? 'up' : 'down'}">${fixedW >= newW ? PT('Fixing faster than making', '改正比犯錯快') : PT('More new than fixed', '新錯題比改正多')}</small>`) : ''}
      ${bands.length >= 2 ? tileE(`${fmtH(bands[0][0])}–${fmtH((bands[0][0] + 2) % 24)}`, PT('your best time', '你最好的時段'), `<small>${PT('Scores highest here', '這段時間分數最高')}</small>`) : ''}</div>
    ${BY.length || wMarked ? `<div class="pv-chips">${wMarked ? `<span>${PT(`Buddy marked ${wMarked} of your written answers this week`, `Buddy 本週批改了你 ${wMarked} 個文字答案`)}</span>` : ''}${BY.map((x) => `<span data-raw>${esc(x.k)}: ${esc(x.v)}${x.c ? ` (${esc(x.c)})` : ''}</span>`).join('')}${starsOn() ? `<span>${PT('Stars to spend', '可用星星')}: ${starState().bal}</span>` : ''}</div>` : ''}
    ${calCard}${goalCardHTML(D)}</section>`;

  // the one-line summary at the top
  const rising = lv.filter((x) => x[2] === 'rising').map((x) => x[0]);
  const close = tests.steps.find((p) => p.ready != null && p.ready < 80 && p.left <= 14);
  const quiet = RH.filter((x) => x.used).map((x) => x.b).find((b) => { const last = local.log.filter((e) => e.q && e.q.startsWith(b.id + ':')).pop(); return last && now - last.t > 4 * DAY; });
  const head = !local.log.length ? PT('Practise a few chapters and this page fills up with how you’re doing.', '練習幾個章節後，這一頁就會顯示你的學習情況。')
    : rising.length ? PT(`You’re getting stronger in ${rising.slice(0, 2).join(' and ')}.`, `你在${rising.slice(0, 2).join('和')}越來越強。`) : r.dp >= 4 ? PT('A steady week of practice.', '本週練習穩定。') : PT('Every short session adds up.', '每次短時間練習都有幫助。');
  const sub2 = [close ? PT(`${close.x.name} is ${leftText(close.left)}: ${close.ready}% ready.`, `「${close.x.name}」${leftText(close.left)}：準備度 ${close.ready}%。`) : '', quiet ? PT(`${sname(quiet)} has been quiet for a few days.`, `${sname(quiet)}已經幾天沒有練習。`) : ''].filter(Boolean).join(' ');

  // The summary card at the top: Buddy's verdict, three takeaways (going well / keep an eye on / next), and the four headline numbers.
  const goodTx = !local.log.length ? '' : rising.length ? PT(`Getting stronger in ${rising.slice(0, 2).join(' and ')}`, `${rising.slice(0, 2).join('和')}越來越強`)
    : days28 >= 12 ? PT(`Practised on ${days28} of the last 28 days`, `過去 28 日中有 ${days28} 日練習`) : D.longTerm ? PT(`${D.longTerm} questions now in long-term memory`, `${D.longTerm} 題已進入長期記憶`) : PT(`${r.dp} days of practice this week`, `本週練習了 ${r.dp} 日`);
  const closeAim = close ? ((local.sched || []).find((y) => y.id === close.x.id) || {}).aim || 80 : 80;
  const watchTx = close ? PT(`${close.x.name} ${leftText(close.left)}: ${close.ready}% ready, goal ${closeAim}%`, `「${close.x.name}」${leftText(close.left)}：準備度 ${close.ready}%，目標 ${closeAim}%`)
    : quiet ? PT(`${sname(quiet)} has been quiet for a few days`, `${sname(quiet)}已經幾天沒有練習`) : D.weak ? PT(`Weakest chapter: ${chName(D.weak.unit)} · ${D.weak.a}%`, `最弱的章節：${chName(D.weak.unit)} · ${D.weak.a}%`) : '';
  const nx = next[0];
  const jump = (id) => () => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const goodRun = rising.length ? jump('pv-s4') : jump('pv-s5');
  const watchRun = close ? () => { const h = RH.find((x) => x.b.id === close.book.id); const fc = planForecast(close.ready, chOf(close), close.left); testPlanSheet(close, chOf(close), closeAim, fc); }
    : quiet ? jump('pv-s3') : D.weak ? () => { const c = MB.get(D.weak.book.id).chapters.find((y) => y.unit.id === D.weak.unit.id); if (c) chapterSheet(D.weak.book, c); } : null;
  const row = (cls, ic, lab, tx, run, go) => { const inner = `<i>${ic}</i><span><small>${lab}</small><b data-raw>${esc(tx)}</b></span>${go ? `<em class="pv-sum-go">${go}</em>` : '<em class="pv-sum-ch">›</em>'}`;
    return run ? btn(inner, run, `pv-sum-row ${cls}`) : `<div class="pv-sum-row ${cls}">${inner}</div>`; };
  // a longer summary under the verdict: how much was done, how it went, and what's coming
  const sumLine = !local.log.length ? '' : [r.q ? PT(`You practised on ${r.dp} of the last 7 days and answered ${r.q} questions${r.a != null ? `, getting ${r.a}% right` : ''}.`, `過去 7 日中你練習了 ${r.dp} 日，答了 ${r.q} 題${r.a != null ? `，答對 ${r.a}%` : ''}。`) : PT('No practice in the last 7 days yet.', '過去 7 日還沒有練習。'),
    close ? PT(`The ${close.x.name} is ${leftText(close.left)}, so that’s the one to focus on next.`, `「${close.x.name}」${leftText(close.left)}，下一步先集中準備它。`) : rising.length ? PT(`${rising[0]} is improving: keep it going.`, `${rising[0]}正在進步，繼續努力。`) : ''].filter(Boolean).join(' ');
  const sumHTML = `<section class="pv-sum">
    <div class="pv-sum-l">
      <div class="pv-sum-h">${buddySVG(local.log.length ? 'happy' : 'think', 52)}<div><b data-raw>${esc(head)}</b>${sumLine ? `<span data-raw>${esc(sumLine)}</span>` : ''}</div></div>
      ${local.log.length ? `<div class="pv-sum-t">
        ${goodTx ? row('g', '✓', PT('Going well', '做得好'), goodTx, goodRun) : ''}
        ${watchTx ? row('w', '!', PT('Keep an eye on', '要留意'), watchTx, watchRun) : ''}
      </div>` : ''}
    </div>
    <div class="pv-sum-r">${kpiHTML}</div>
  </section>`;
  $app.innerHTML = `
  <main class="pad pgpage pv" data-view="progress" data-raw style="flex:1">
    <div class="pv-top"><div><h1 class="pagetitle" style="margin:0">${PT('Progress', '進度')}</h1><p>${PT('How you’re doing, whether it’s working, and what to do next.', '你的學習情況、練習有沒有成效，以及下一步。')}</p></div>
      <div class="pv-topb">${btn(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg><span>${PT('Weekly report', '每週報告')}</span>`, () => reportDialog(), 'pv-btn primary pv-topbtn')}${btn(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 5"/></svg><span>${PT('Parent dashboard', '家長主頁')}${locked('parent') ? ' 🔒' : ''}</span>`, () => openParent(), 'pv-btn primary pv-topbtn')}</div></div>
    <section class="pv-sec pv-sumsec"><div class="pv-h"><h2 class="h-info">${PT('Your week at a glance', '本週一覽')}${ib('howGlance', PT('What’s in this summary?', '這個總結有甚麼？'))}</h2><span>${PT('The big picture first. Tap anything for the details.', '先看大局，按任何一項看詳情。')}</span></div>${sumHTML}${how('howGlance', PT('What’s in this summary?', '這個總結有甚麼？'), '')}</section>
    <div id="pv-s2">${sec2}</div><div id="pv-s1">${sec1}</div><div id="pv-s3">${sec3}</div><div id="pv-s4">${sec4}</div><div id="pv-s5">${sec5}</div>
  </main>`;
  $app.querySelectorAll('[data-pv]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const f = acts[+b.dataset.pv]; if (f) f(); }));
  // Info pop-ups in plain words: a few short lines with a picture each, for kids and parents alike
  { const L = (rows) => `<ul class="how-easy">${rows.map(([i, en, zh, den, dzh]) => `<li><span>${i}</span><div><p>${PT(en, zh)}</p>${den ? `<small>${PT(den, dzh)}</small>` : ''}</div></li>`).join('')}</ul>`;
    const HOW = {
      howGlance: L([['🙂', 'Buddy’s one-line verdict on your week.', 'Buddy 對你這星期的一句總結。', 'It weighs up how often you practised, what’s improving and what’s coming up.', '會綜合你練習的次數、進步的地方和快到的事情。'],
        ['✅', '<b>Going well</b>: something to be proud of.', '<b>做得好</b>：值得開心的事。', 'The strongest good news this week, like a subject that’s levelling up.', '本週最好的消息，例如某科程度上升。'],
        ['⚠️', '<b>Keep an eye on</b>: the one thing that needs you most.', '<b>要留意</b>：最需要你注意的一件事。', 'Usually a test that needs more work, or a subject that’s gone quiet.', '通常是需要多準備的測驗，或者很久沒練習的科目。'],
        ['👆', 'Tap any of it, or the 4 numbers, to see more.', '按任何一項或 4 個數字，看詳情。']]),
      howNotP: L([['🔍', 'Buddy watches how you answer, not just what you get right.', 'Buddy 會留意你怎樣作答，不只是對錯。', 'Your answers, hints, timing and reviews all feed in.', '你的答案、提示、時間和溫習都會考慮。'],
        ['🧩', 'A card only appears when the pattern is clear.', '只有規律清楚才會出現卡片。', 'One bad day won’t trigger a card. It needs to keep happening.', '一次失手不會出現卡片，要持續出現才會。'],
        ['🧠', '<b>Mix-ups</b> are found by AI reading your wrong answers.', '<b>混淆</b>由 AI 閱讀你答錯的題目找出。', 'It looks for the same wrong idea showing up more than once.', '找出重複出現的同一個錯誤概念。'],
        ['👉', 'Most important first, with a win near the top.', '最重要的排第一，進步排在前面。', 'Tap the button on a card to fix it straight away.', '按卡片上的按鈕，馬上去改善。']]),
      howTestP: L([['📊', '<b>Ready now</b>: how well you know the chapters in this test.', '<b>現在</b>：你對這個測驗的章節有多熟。', 'Built from your practice, chapter tests and reviews on those chapters only.', '只根據這些章節的練習、章節測驗和溫習計算。'],
        ['🔮', '<b>On test day</b>: where you’ll be if you keep going like this.', '<b>考試當日</b>：照現在的速度會到哪裡。', 'Based on how fast you’ve been improving recently.', '根據你最近進步的速度推算。'],
        ['🎯', '<b>Goal</b>: slide Buddy to set your own.', '<b>目標</b>：拖動 Buddy 設定你自己的目標。', 'Each test keeps its own goal. It starts at 80%.', '每個測驗各有目標，預設 80%。'],
        ['🚦', 'Green = on track · Yellow = close · Red = at risk', '綠色 = 理想 · 黃色 = 接近 · 紅色 = 要加把勁', 'Compares where you’re heading with your goal.', '比較預測結果和你的目標。']]),
      howWorkP: L([['🟩', 'Each box is a chapter, coloured by how ready you are.', '每格是一章，按準備度上色。', 'Green strong, yellow getting there, red needs work, white not started.', '綠色好、黃色漸入佳境、紅色要加油、白色未開始。'],
        ['💯', 'Readiness is more than getting questions right.', '準備度不只是答對題目。', 'It also checks you can handle harder questions, pass a timed test and still remember it later.', '還要能應付較深的題目、通過限時測驗，而且之後仍然記得。'],
        ['🔒', 'It can’t be rushed.', '不能一蹴而就。', 'The top scores only come with proof over time, so 100% really means ready.', '最高分要經過一段時間證明，所以 100% 是真正準備好。'],
        ['👆', 'Tap a chapter to see what to do next.', '按一章看看下一步做甚麼。']]),
      howLevelP: L([['📈', 'How hard a question you can get right, out of 10.', '你能答對多難的題目（滿分 10）。', 'From remembering facts up to analysing and explaining.', '由記住事實，到分析和解釋。'],
        ['🧗', 'Harder questions right = it goes up.', '答對較深題目就會上升。', 'It won’t drop just because the questions got harder.', '題目變難也不會因此下跌。'],
        ['📍', 'The small line is what’s expected for your grade.', '小直線是你年級的預期程度。', 'To the right of it means you’re ahead.', '在它右邊就是超前。']]),
      howRwP: L([['📈', 'One line per subject: a dot per day for the first 4 weeks, then per week.', '每科一條線：頭 4 星期每日一點，之後每星期一點。', 'Each dot is how ready you were in that subject then.', '每點是當時該科的準備度。'], ['⬆️', 'Going up = you know more of the textbook.', '向上 = 你掌握更多課本內容。']]),
      howMkP: L([['📝', 'Real school test marks, added by a parent.', '家長輸入的學校測驗成績。', 'Before PrepBuddy, then each new test.', '用 PrepBuddy 前，以及之後每次測驗。'], ['🔁', 'The before-and-after you can see for yourself.', '你自己就能看到的前後對比。', 'The one number here that isn’t worked out by PrepBuddy.', '這是唯一不是 PrepBuddy 計算的數字。']]),
      howGrP: L([['🌱', 'How much harder each chapter’s questions are now, vs when you started.', '每章現在的題目比剛開始時難了多少。', 'Buddy raises the level as you get things right.', '你答對了，Buddy 就會提升程度。']]),
      howPc: L([['🧪', 'A short quiz at the same level as your first level check.', '與第一次程度評估同樣難度的小測。', 'About 5 minutes.', '大約 5 分鐘。'], ['⚖️', 'Same difficulty, so any change is real progress.', '難度一樣，所以分數變化就是真正的進步。', 'Worth doing about once a month.', '大約每月做一次。']]),
      howMemP: L([['🔁', 'Questions come back after a few days, then longer and longer.', '題目會隔幾天再出現，之後越隔越久。', 'Get it right and it waits longer; get it wrong and it comes back soon.', '答對就隔更久；答錯就很快再出現。'], ['🧠', 'The % is how many you still got right days later.', '百分比是幾天後仍答對的比例。']]),
      howTmP: L([['⏱️', 'Your practice scores vs your timed test scores.', '練習分數對比限時測驗分數。'], ['😌', 'Close together = calm under time pressure.', '兩者接近 = 限時下也能保持冷靜。', 'A big gap means more timed practice would help.', '差距大代表需要多做限時練習。']]),
      howK1: L([['🎯', 'How much of your textbooks you really know, out of 100%.', '你真正掌握多少課本內容（滿分 100%）。', 'Not just questions right, but harder questions, tests passed and things remembered.', '不只是答對，還包括較深題目、通過測驗和記得。'], ['📅', 'Subjects with a test coming up count more.', '快要考試的科目佔比較大。']]),
      howK2: L([['📚', 'Chapters you’ve truly got.', '真正掌握的章節。', 'Passed the test, handled the harder questions, and still remembered it later.', '通過測驗、應付到較深題目，而且之後仍記得。'], ['⏳', 'This takes a few weeks per chapter.', '每章需要幾個星期。', 'That’s on purpose: it shows learning that lasts.', '這是刻意的：顯示能持久的學習。']]),
      howK3: L([['🧠', 'Things you still get right a week or more later.', '一星期或更久之後仍答對的內容。', 'Learning for tomorrow is easy; this shows it stuck.', '明天記得很容易，這個顯示真的記住了。'], ['🔁', 'It grows when you do your reviews.', '做溫習就會增加。']]),
      howK4: L([['📅', 'Days with any practice in the last 4 weeks.', '過去 4 星期有練習的日數。'], ['🐢', 'A little most days beats a lot once a week.', '每天少少，勝過一星期一次做很多。', 'Short, regular practice is how memory works best.', '短時間、有規律的練習最能幫助記憶。']]),
      howCal: L([['🟦', 'Each square is a day. Darker = more questions.', '每格是一日，顏色越深 = 題目越多。'], ['📆', 'Each column is a week, Monday at the top.', '每一列是一星期，星期一在最上面。']]),
      howMix: L([['📊', 'Each bar is a week of questions, by how hard they were.', '每條是一星期的題目，按難度分。', 'Light = remembering facts; darkest = thinking it through.', '淺色 = 記住事實；最深 = 深入思考。'], ['🟦', 'More dark = taking on harder work.', '深色越多 = 挑戰越難。']]),
      howMk: L([['🔵', 'Blue line = mistakes still to fix.', '藍線 = 未改正的錯題。', 'You want it heading down.', '越低越好。'], ['🟢', 'Green = fixed · Orange = new ones.', '綠色 = 已改正 · 橙色 = 新錯題。']]),
      howEffP: L([['📅', 'Days, minutes and questions this week vs last.', '本週的日數、分鐘和題目，與上週比較。', 'Minutes count time spent answering, not breaks.', '分鐘只計作答時間，休息不計。'], ['🔥', 'Streak = days in a row with practice.', '連續 = 連續有練習的日數。'], ['⏰', 'Best time = when your scores tend to be highest.', '最好時段 = 你分數通常最高的時候。']]),
    };
    Object.entries(HOW).forEach(([id, html]) => { const d = document.getElementById(id); const b = d && d.querySelector(':scope > div'); if (b) b.innerHTML = html; });
    window.__pvActs = acts; }
  // headline numbers lead somewhere: readiness and chapters to what to work on, memory to reviews, days to the calendar
  { const go2 = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const KT = { 'k-ring': () => readySheet(used.map((x) => ({ b: x.b, pct: x.pct, m: MB.get(x.b.id) })), overall), 'k-book': () => masteredSheet(used.map((x) => ({ b: x.b, m: MB.get(x.b.id) })), chDone, chAll), 'k-brain': () => memorySheet(), 'k-cal': () => daysSheet() };
    $app.querySelectorAll('.pv-sum .pv-kpi').forEach((k) => { const key = Object.keys(KT).find((c) => k.classList.contains(c)); if (!key) return;
      k.classList.add('pv-click'); k.setAttribute('role', 'button'); k.tabIndex = 0;
      const run = (e) => { if (e.target.closest('.info-btn')) return; KT[key](); };
      k.onclick = run; k.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(e); } }; }); }
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on('goal-edit', () => goalDialog());
  on('goal-set', () => goalDialog());
  on('fcUp', () => go({ name: 'plans', hi: 'pro' }));
  bindStarChips($app);
  // dev only: page through sample weeks to see how the readiness chart and its sentence change
  $app.querySelectorAll('[data-rw]').forEach((b) => (b.onclick = () => {
    const n = +b.dataset.rw, box = document.getElementById('rwBody'); if (!box) return;
    $app.querySelectorAll('[data-rw]').forEach((x) => x.classList.toggle('on', x === b));
    if (!n) { box.innerHTML = readyLinesSVG(RH.filter((x) => x.used)); return; }
    // sample: each book's readiness on each of the last 70 days (practice most days, a dip in one subject)
    const D = [2, 5, 12, 25, 42, 70][n - 1], t00 = dayStart();
    const curve = (i, d) => [Math.round(1 + d * 0.45), Math.round(1 + d * 0.2 - (d % 9 === 8 ? 2 : 0)), Math.round(1 + d * 0.08)][i];
    box.innerHTML = readyLinesSVG(RH.slice(0, 3).map((x, i) => {
      const val = (age) => (age >= D ? null : (age % 6 === 5 && age > 0 ? null : curve(i, D - 1 - age))); // a few days without the app
      const days = Array.from({ length: 28 }, (_, k) => val(27 - k));
      const weeks = Array.from({ length: 6 }, (_, k) => { const age = (5 - k) * 7; let v = null; for (let a = age; a < D && v == null; a++) v = curve(i, D - 1 - a); return age < D ? v : null; });
      return { ...x, days, weeks, first: t00 - (D - 1) * DAY, pct: curve(i, D - 1) }; }));
  }));
  // Mix-ups from wrong answers: worked out by Buddy about once a week, kept on this device.
  if (!ins || now - ins.t > 7 * DAY) refreshInsights(mkAll).catch(() => {});
}
async function refreshInsights(mkAll) {
  if (refreshInsights.busy || !navigator.onLine) return; const now = Date.now();
  const open = (mkAll || []).filter((x) => x.m.t > now - 45 * DAY).sort((a, b) => (b.m.n - a.m.n) || (b.m.t - a.m.t)).slice(0, 40);
  const done = () => { const el = document.getElementById('pvMix'); if (el) el.remove(); };
  if (open.length < 3) { local.insights = { t: now, lang: LANG, list: [] }; saveLocal(); return done(); }
  refreshInsights.busy = true;
  try {
    const items = open.map(({ q, m, g }) => ({ id: q.id, ch: g.unit ? cleanUnitTitle(g.unit.title) : '', q: String(choiceType(q) ? `${q.stem}\nOptions: ${(q.options || []).join(' | ')}` : [writtenStem(q), ...(q.parts || []).map((p) => p.prompt)].filter(Boolean).join('\n')).slice(0, 600),
      right: choiceType(q) ? (q.options || [])['ABCD'.indexOf(q.correct_option)] || '' : (q.parts || []).map((p) => (p.mark_scheme || []).join('; ')).join(' / ').slice(0, 500),
      said: choiceType(q) ? m.ansText || '' : (Array.isArray(m.ans) ? m.ans.filter(Boolean).join(' / ') : '').slice(0, 500), n: m.n }));
    const r = await api('insights', { items, lang: LANG === 'zh' ? 'zh' : LANG });
    local.insights = { t: Date.now(), lang: LANG, list: (r.mixups || []).filter((x) => x.title) }; saveLocal();
    if (view && view.name === 'progress') renderProgress(); else done();
  } catch (e) { done(); } finally { refreshInsights.busy = false; }
}

function goalCardHTML(D) {
  const G = D.goal, E = D.exam;
  const fmt = (t, o) => new Date(t).toLocaleDateString(LOCALE(), o);
  if (!G && !E) return `<section class="pgcard pg-goal0"><span class="pg-ic orange">${pIcon('target')}</span><div><b>${PT('Set a weekly goal', '設定每週目標')}</b><span>${PT('Pick how often to practise and your exam date. We’ll track it here and in your parent report.', '選擇練習次數和考試日期，進度會在這裡和家長報告中顯示。')}</span></div><button class="btn-sm" id="goal-set">${PT('Set goal', '設定')}</button></section>`;
  const tone = (p) => (p >= 85 ? 'good' : p >= 60 ? 'mid' : 'low');
  const goalPart = G ? `<div class="pg-gl">
      <div class="pg-gdays">${G.week.map((d) => `<span class="${d.met ? 'met' : d.m ? 'some' : ''} ${d.future ? 'fut' : ''} ${d.today ? 'tod' : ''}" title="${fmt(d.t, { weekday: 'long' })}: ${d.m} min">${d.met ? pIcon('check', 14) : fmt(d.t, { weekday: 'narrow' })}</span>`).join('')}</div>
      <b class="pg-gmsg ${G.reached ? 'ok' : ''}">${G.reached ? PT('Goal reached this week!', '本週目標已達成！') : PT(`${G.met} of ${G.days} days done · ${G.days - G.met} to go`, `已完成 ${G.met}／${G.days} 日 · 尚餘 ${G.days - G.met} 日`)}</b>
      <span class="pg-gsub">${PT(`Goal: ${G.days} days a week, ${G.mins} min each`, `目標：每星期 ${G.days} 日，每次 ${G.mins} 分鐘`)}${!G.reached && !G.possible ? PT(' · try again next week', ' · 下星期再努力') : ''}</span></div>` : '';
  const examPart = E && E.left !== null && locked('forecast') ? `<div class="pg-ex"><div class="pg-exn"><b>${E.left}</b><span>${PT(E.left === 1 ? 'day to your exam' : 'days to your exam', '日後考試')}</span></div><div class="pg-fc"><button class="btn-sm" id="fcUp">🔒 ${PT('See your exam forecast with Pro', '升級 Pro 查看考試預測')}</button></div></div>`
    : E && E.left !== null ? `<div class="pg-ex"><div class="pg-exn"><b>${E.left}</b><span>${PT(E.left === 1 ? 'day to your exam' : 'days to your exam', '日後考試')}</span><small>${fmt(E.date, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
      <div class="pg-fc">${E.fc.length ? E.fc.map((f) => `<div><span data-raw>${esc(f.x.book.subject ? subj(f.x.book.subject) : f.x.book.title)}</span>${f.wait ? `<small>${PT('Forecast after a week of practice', '練習一星期後會有預測')}</small>` : `<b class="${tone(f.by)}">${f.by >= 85 ? PT(`On track: ~${f.by}% by the exam`, `進度理想：考試時約 ${f.by}%`) : f.rate > 0 ? PT(`At this pace: ~${f.by}% by the exam`, `按現時進度：考試時約 ${f.by}%`) : PT('Not moving yet: practise to start climbing', '暫未進步：多練習就會上升')}</b>`}</div>`).join('') : ''}</div></div>`
    : E ? `<div class="pg-ex"><span class="pg-gsub">${PT('Your exam date has passed. Set the next one.', '考試日期已過，請設定下一個。')}</span></div>` : '';
  return `<section class="pgcard"><h2>${pIcon('target', 18)} ${PT('Your goal', '你的目標')}<button class="btn-sm quiet" id="goal-edit">${PT('Edit', '修改')}</button></h2>
    ${goalPart || `<button class="btn-sm" id="goal-set" style="align-self:flex-start">${PT('Set a weekly goal', '設定每週目標')}</button>`}${examPart}</section>`;
}

function testsCardHTML(D) {
  const list = D.tests;
  const KIND = { paper: [PT('Mock exam', '模擬考試'), 'blue'], test: [PT('Chapter test', '章節測驗'), 'purple'], mini: [PT('Mini mock', '小型模擬'), 'orange'] };
  const fmt = (t) => new Date(t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' });
  const row = (x) => { const p = x.m ? Math.round(100 * x.g / x.m) : 0, k = KIND[x.kind] || KIND.paper, pass = x.kind === 'test' ? p >= 80 : null;
    return `<div class="pg-test"><span class="pg-ic ${k[1]}">${pIcon(x.kind === 'test' ? 'check' : 'pencil', 18)}</span><div class="pg-tt"><small>${k[0]} · ${fmt(x.t)}</small><b data-raw>${esc(String(x.title || '').replace(/^(Chapter test|章節測驗) · /, ''))}</b><span>${x.g} / ${x.m} ${PT('marks', '分')} · ${x.min} ${PT('min', '分鐘')}${x.nt ? PT(' · no time limit', ' · 不限時') : x.x ? PT(` · +${x.x} min extra`, ` · 加時 ${x.x} 分鐘`) : ''}</span></div><b class="pg-tp ${p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low'}">${p}%${pass === null ? '' : `<small>${pass ? PT('Passed', '合格') : PT('Not yet', '未合格')}</small>`}</b></div>`; };
  return `<section class="pgcard"><h2>${pIcon('pencil', 18)} ${PT('Tests and mock exams', '測驗及模擬考試')}</h2>
    ${list.length ? `<div class="pg-tests">${list.slice(0, 4).map(row).join('')}${list.length > 4 ? `<div hidden>${list.slice(4, 20).map(row).join('')}</div><button class="btn-sm quiet" data-tests-more>${PT(`Show ${Math.min(16, list.length - 4)} more`, `顯示多 ${Math.min(16, list.length - 4)} 個`)}</button>` : ''}</div>`
      : `<p class="pg-empty">${PT('Chapter tests and mock exams you finish show up here, with your score and time.', '完成的章節測驗和模擬考試會在這裡顯示分數和用時。')}</p>`}
  </section>`;
}

function goalDialog() {
  const g = local.goal || { days: 5, mins: 20 };
  let days = g.days, mins = g.mins;
  const box = document.createElement('div');
  box.className = 'cdlg-wrap';
  const draw = () => {
    const tot = days * mins, pick = (n) => (n <= 2 ? PT('A gentle start', '輕鬆開始') : n <= 4 ? PT('A steady habit', '穩定的習慣') : n <= 6 ? PT('Most days: great for memory', '大部分日子：最幫助記憶') : PT('Every day!', '每天！'));
    box.innerHTML = `<div class="cdlg gd2" role="dialog" aria-modal="true" aria-labelledby="gd-t" data-raw>
      <header class="gd2-h">${buddySVG('happy', 44)}<div><b id="gd-t">${PT('Your weekly goal', '你的每週目標')}</b><small>${PT('Small and steady beats long and rare.', '少量而穩定，勝過偶爾做很多。')}</small></div><button class="chs-x cs2-x" id="gd-x" aria-label="${PT('Close', '關閉')}">✕</button></header>
      <section><div class="gd2-lh"><label>${PT('How many days a week?', '每星期練習幾日？')}</label><em>${pick(days)}</em></div>
        <div class="gd2-days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="${n === days ? 'on' : ''} ${n < days ? 'in' : ''}" data-d="${n}" aria-pressed="${n === days}">${n}</button>`).join('')}</div></section>
      <section><div class="gd2-lh"><label>${PT('Minutes each day', '每日分鐘')}</label></div>
        <div class="gd2-mins">${[10, 15, 20, 30, 45, 60].map((n) => `<button class="${n === mins ? 'on' : ''}" data-m="${n}" aria-pressed="${n === mins}"><b>${n}</b><small>${PT('min', '分鐘')}</small></button>`).join('')}</div></section>
      <div class="gd2-sum"><span>🎯</span><div><b>${PT(`${days} day${days === 1 ? '' : 's'} × ${mins} min = ${tot} min a week`, `${days} 日 × ${mins} 分鐘 = 每星期 ${tot} 分鐘`)}</b><small>${starsOn() ? PT('Reach it and you earn bonus stars ⭐', '達成就可得額外星星 ⭐') : PT('You’ll see your progress on Today and Progress.', '可在今日和進度頁看到進度。')}</small></div></div>
      <details class="gd2-exam" ${local.exam ? 'open' : ''}><summary>${PT('Add an exam date (optional)', '加入考試日期（可選）')}</summary>
        <input id="gd-exam" class="input" type="date" value="${esc(local.exam || '')}" aria-label="${PT('Exam date', '考試日期')}">
        <span class="hint">${inHK() ? PT('For the DSE, use the date of your first paper.', '如果是 DSE，請用第一份試卷的日期。') : PT('Buddy counts down to it and shows a forecast.', 'Buddy 會倒數，並顯示預測。')}</span></details>
      <div class="rd-row"><button class="btn ghost" id="gd-cancel">${PT('Cancel', '取消')}</button><button class="btn" id="gd-save">${local.goal ? PT('Save goal', '儲存目標') : PT('Set my goal', '設定目標')}</button></div>
      ${local.goal ? `<button class="gd2-rm" id="gd-clear">${PT('Remove goal', '刪除目標')}</button>` : ''}
    </div>`;
    box.querySelector('#gd-x').onclick = () => box.remove();
    box.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { days = +b.dataset.d; keep(); }));
    box.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mins = +b.dataset.m; keep(); }));
    box.querySelector('#gd-cancel').onclick = () => box.remove();
    box.querySelector('#gd-save').onclick = () => { local.goal = { days, mins }; local.exam = box.querySelector('#gd-exam').value || ''; saveLocal(); box.remove(); renderProgress(); };
    const c = box.querySelector('#gd-clear'); if (c) c.onclick = () => { local.goal = null; local.exam = ''; saveLocal(); box.remove(); renderProgress(); };
  };
  const keep = () => { const ex = box.querySelector('#gd-exam').value; draw(); box.querySelector('#gd-exam').value = ex; };
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  draw();
  document.body.appendChild(box);
}

// The parent report: name, preview, send. A small dialog instead of a block of text on the page.
function reportDialog() {
  track('parent_report');
  const box = document.createElement('div');
  box.className = 'cdlg-wrap';
  box.innerHTML = `<div class="cdlg rdlg" role="dialog" aria-modal="true" aria-labelledby="rd-t" data-raw>
    <b id="rd-t">${PT('Weekly report for parents', '家長每週報告')}</b>
    <span>${PT('This week’s practice, scores by chapter, what’s improving and what needs work. Your parent opens it as a link, no sign-in needed.', '本週的練習、各章分數、進步和需要加強的地方。家長只需打開連結，不用登入。')}</span>
    <label for="rd-name">${PT('Your name on the report', '報告上的名字')}</label>
    <input id="rd-name" class="input" autocomplete="given-name" placeholder="${PT('e.g. Ka Yan', '例如：嘉欣')}" value="${esc(local.name)}">
    <div class="rd-row"><button class="btn ghost" id="rd-prev">${PT('Preview', '預覽')}</button><button class="btn" id="rd-send">${pIcon('send', 18)} ${PT('Send', '傳送')}</button></div>
    <div id="rd-fallback"></div>
    <button class="btn-sm quiet" id="rd-close" style="align-self:center">${PT('Close', '關閉')}</button>
  </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.onclick = (e) => { if (e.target === box) close(); };
  document.getElementById('rd-close').onclick = close;
  const nameEl = document.getElementById('rd-name');
  nameEl.oninput = () => { local.name = nameEl.value.trim().slice(0, 30); saveLocal(); };
  const link = async () => { const rep = await currentReport(); if (locked('report')) { Object.assign(rep, { ch: [], ms: [], tr: [], ts: [], ex: null, bs: 1 }); delete rep.sk; } return { rep, url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}report.html#d=${encodeReport(rep)}` }; };
  document.getElementById('rd-prev').onclick = async () => { const { url } = await link(); window.open(url, '_blank', 'noopener'); };
  document.getElementById('rd-send').onclick = async () => {
    const { rep, url } = await link();
    const text = LANG === 'zh' ? `${headline(rep)}。這是${rep.n || '我'}本週的 PrepBuddy 報告：` : `${headline(rep)}. Here is ${rep.n ? rep.n + '’s' : 'my'} PrepBuddy report for this week:`;
    if (navigator.share) {
      try { await navigator.share({ title: LANG === 'zh' ? 'PrepBuddy 每週報告' : 'PrepBuddy weekly report', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    document.getElementById('rd-fallback').innerHTML = `<div class="rd-row"><a class="btn" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn ghost" id="rd-copy">${PT('Copy link', '複製連結')}</button></div>`;
    document.getElementById('rd-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast(PT('Link copied', '已複製連結')); } catch (e) { prompt('Copy this link:', url); } };
  };
  nameEl.focus();
}

/* ---------- AI usage on this device ---------- */
function renderUsage() {
  const u = local.usage || {};
  const steps = [['warm', 'Storing the chapter (cache)'], ['generate', 'Writing questions'], ['verify', 'Checking questions'], ['mark', 'Marking answers'], ['explain', 'Tutor (I don’t get it)'], ['notes', 'Notes and flashcards'], ['snippets', 'Quick-look cards'], ['coach', 'Study coach']];
  const fmt = (n) => (n || 0).toLocaleString('en');
  const tot = { calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0 };
  const usd = (n) => '$' + (n || 0).toFixed((n || 0) >= 1 ? 2 : 3);
  steps.forEach(([k]) => { const r = u[k]; if (r) for (const f in tot) tot[f] += r[f] || 0; });
  const rows = steps.map(([k, name]) => { const r = u[k] || {}; return `<tr><th scope="row">${name}</th><td>${fmt(r.calls)}</td><td>${fmt(r.input)}</td><td>${fmt(r.cache_write)}</td><td>${fmt(r.cache_read)}</td><td>${fmt(r.output)}</td><td><b>${usd(r.usd)}</b></td></tr>`; }).join('');
  const made = u.made || 0;
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Settings</span></button><span style="font-weight:600;font-size:16px">AI usage on this device</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:var(--text-2)">Tokens used since you last reset. Reading PDFs happens on your device and uses no tokens.</p>
    <div style="overflow-x:auto"><table class="data usage">
      <tr><th>Step</th><th>AI calls</th><th>Input</th><th>Cache write</th><th>Cache read</th><th>Output</th><th>Cost (USD)</th></tr>
      ${rows}
      <tr><th scope="row">Total</th><td>${fmt(tot.calls)}</td><td>${fmt(tot.input)}</td><td>${fmt(tot.cache_write)}</td><td>${fmt(tot.cache_read)}</td><td>${fmt(tot.output)}</td><td><b>${usd(tot.usd)}</b></td></tr>
    </table></div>
    <p style="margin:0;font-size:16px;line-height:1.5">Estimated cost: <b>${usd(tot.usd)}</b>${made ? (LANG === 'zh' ? ` · 每條題目約 ${usd((tot.usd - ['mark', 'explain', 'notes'].reduce((x, k) => x + ((u[k] || {}).usd || 0), 0)) / made)}` : ` · about ${usd((tot.usd - ['mark', 'explain', 'notes'].reduce((x, k) => x + ((u[k] || {}).usd || 0), 0)) / made)} per question made`) : ''}${(u.mark || {}).requests ? ` · ${usd(u.mark.usd / u.mark.requests)} per answer marked` : ''}</p>
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Questions that passed checking: <b>${fmt(made)}</b>${made ? `<br>${LANG === 'zh' ? `每條題目：輸入 ${fmt(Math.round((tot.input + tot.cache_write) / made))} · 快取讀取 ${fmt(Math.round(tot.cache_read / made))} · 輸出 ${fmt(Math.round(tot.output / made))}` : `Per question: ${fmt(Math.round((tot.input + tot.cache_write) / made))} input · ${fmt(Math.round(tot.cache_read / made))} cache read · ${fmt(Math.round(tot.output / made))} output`}` : ''}.<br>
    <span>Costs are estimates from Claude's published prices; your bill on console.anthropic.com is the exact figure. Older entries made before this update have no cost recorded.</span></p>
    <button class="btn ghost" id="reset">Reset the counter</button>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'settings' });
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
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Back</span></button></div>
  <main class="pad stack g18" style="flex:1;padding-top:4px">
    <h1 class="display" style="margin:0;font-size:22px;line-height:1.25">Remove this textbook?</h1>
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

// Notes and flashcards: the chapters ticked on the book page, or else just the chapter to work on next
// (not all 18 at once: a 108-card deck, and one AI request per chapter the first time).
async function studyUnits(book) {
  if (pick.bookId === book.id && pick.ids.size) return book.units.filter((u) => pick.ids.has(u.id));
  try { const m = await bookMastery(book); const c = m.chapters.find((x) => x.pct > 0 && x.pct < 80) || m.chapters.find((x) => x.pct < 80); if (c) return [c.unit]; } catch (e) {}
  return book.units.slice(0, 1);
}
function paperUnits(book) {
  return pick.bookId === book.id && pick.ids.size ? book.units.filter((u) => pick.ids.has(u.id)) : book.units;
}

async function renderPaper(bookId, from) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  if (!book) return go({ name: 'home' });
  const units = paperUnits(book);
  const { a, b } = paperSet;
  const suggested = paperMinutes(a, b);
  const mins = paperSet.t === 0 ? 0 : (paperSet.t || suggested);
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${from === 'pick' ? 'Mock exam' : from === 'home' ? 'Home' : 'Chapters'}</span></button></div>
  <main class="stack g18" style="flex:1;padding:4px 20px 24px">
    <div class="pick-head">${actionTile('mock', 52)}<div class="stack g6"><h1 class="pagetitle" style="margin:0">${LANG === 'zh' ? '模擬考試' : 'Mock exam'}</h1><p class="muted" style="margin:0;line-height:1.5;font-size:16px">${LANG === 'zh' ? `${isPrimaryKid() ? '學校測驗形式的試卷' : 'DSE 模式試卷'}：<b>甲部</b>多項選擇題，然後<b>乙部</b>文字題。可以在這裏限時作答，或列印成工作紙，之後再輸入答案。` : `${isPrimaryKid() ? 'A school-style test paper' : 'A DSE-style paper'}: <b>Section A</b> multiple choice, then <b>Section B</b> written questions. Sit it timed here, or print it as a worksheet and enter your answers afterwards.`}</p></div></div>
    <div class="card stack g6" style="padding:14px 16px">
      <span class="muted" style="font-size:14px">Chapters</span>
      <b style="font-weight:600;line-height:1.4">${units.length === book.units.length ? `All ${book.units.length} chapters` : esc(units.map((u) => u.title).join(' · '))}</b>
      <button class="btn-sm" id="change" style="align-self:flex-start">Change chapters</button>
    </div>
    <div class="stack g10">
      <span style="font-size:16px;font-weight:600">Length</span>
      <div class="chips-row">${PAPER_PRESETS.map(([k, l, pa, pb]) => `<button class="choice ${pa === a && pb === b ? 'on' : ''}" data-preset="${k}"><b>${l}</b><span>${pa} MCQ · ${pb} written · ${paperMinutes(pa, pb)} min</span></button>`).join('')}</div>
    </div>
    <div class="card stack g14" style="padding:14px 16px">
      <div class="setup-row"><span>Section A · MCQ</span><div class="stepper"><button data-step="a:-2" aria-label="Fewer MCQs" ${a <= 0 ? 'disabled' : ''}>−</button><output>${a}</output><button data-step="a:2" aria-label="More MCQs" ${a >= 40 ? 'disabled' : ''}>+</button></div></div>
      <div class="setup-row"><span>Section B · Written</span><div class="stepper"><button data-step="b:-1" aria-label="Fewer written questions" ${b <= 0 ? 'disabled' : ''}>−</button><output>${b}</output><button data-step="b:1" aria-label="More written questions" ${b >= 10 ? 'disabled' : ''}>+</button></div></div>
      <div class="setup-row"><span>Time allowed</span><div class="stepper"><button data-time="-5" aria-label="Less time" ${!mins || mins <= 5 ? 'disabled' : ''}>−</button><output>${mins ? mins + ' min' : 'No limit'}</output><button data-time="5" aria-label="More time" ${!mins || mins >= 180 ? 'disabled' : ''}>+</button></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><label class="tm-none"><input type="checkbox" id="notime" ${mins ? '' : 'checked'}> No time limit</label>
      <span class="muted" style="font-size:14px">${mins && mins !== suggested ? `Suggested: ${suggested} min · <button class="linkbtn" id="tsug">use it</button>` : mins ? 'Suggested time, at about exam pace' : ''}</span></div>
    </div>
  </main>
  <div class="sheet sticky">
    <button class="btn" id="sit" ${a + b ? '' : 'disabled'}>Start mock exam · ${mins ? mins + ' min' : 'no time limit'}</button>
    <button class="btn ghost" id="print" ${a + b ? '' : 'disabled'}>Print as a worksheet</button>
  </div>`;
  document.getElementById('back').onclick = () => go(from === 'pick' ? { name: 'pick', mode: 'mock' } : from === 'home' ? { name: 'home' } : { name: 'book', bookId });
  document.getElementById('change').onclick = () => go({ name: 'book', bookId });
  $app.querySelectorAll('[data-preset]').forEach((el) => (el.onclick = () => { const p = PAPER_PRESETS.find((x) => x[0] === el.dataset.preset); paperSet = { a: p[2], b: p[3], t: paperSet.t === 0 ? 0 : undefined }; renderPaper(bookId, from); }));
  $app.querySelectorAll('[data-time]').forEach((el) => (el.onclick = () => { paperSet = { ...paperSet, t: Math.min(180, Math.max(5, (mins || suggested) + Number(el.dataset.time))) }; renderPaper(bookId, from); }));
  document.getElementById('notime').onchange = (e) => { paperSet = { ...paperSet, t: e.target.checked ? 0 : undefined }; renderPaper(bookId, from); };
  const ts = document.getElementById('tsug'); if (ts) ts.onclick = () => { paperSet = { ...paperSet, t: undefined }; renderPaper(bookId, from); };
  $app.querySelectorAll('[data-step]').forEach((el) => (el.onclick = () => {
    const [k, d] = el.dataset.step.split(':'); const max = k === 'a' ? 40 : 10;
    paperSet = { ...paperSet, [k]: Math.min(max, Math.max(0, paperSet[k] + Number(d))) }; renderPaper(bookId);
  }));
  const go2 = async (purpose) => {
    try {
      const paper = await preparePaper(book, units, a, b, purpose);
      if (!paper) return;
      meter('mock'); track(purpose === 'print' ? 'worksheet' : 'mock_paper');
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
  const dl = mins ? Date.now() + mins * 60 * 1000 : null; // 0 = no time limit
  if (!paper.live) {
    const qs = [...paper.A, ...paper.B];
    S = newSession({ mode: 'dse', title: 'DSE-style mock exam', book, qs, target: qs.length, sectionA: paper.A.length, deadline: dl });
  } else {
    // Section A fills up first; written questions wait in bQueue until Section A is complete.
    const full = paper.A.length >= paper.nA;
    S = newSession({ mode: 'dse', title: 'DSE-style mock exam', book, qs: full ? [...paper.A, ...paper.B] : [...paper.A], bQueue: full ? [] : [...paper.B],
      target: paper.nA + paper.nB, sectionA: paper.nA, deadline: dl,
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
  const written = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">${marksOf(q)} mark${marksOf(q) === 1 ? '' : 's'}</span></div>${figHTML(q, 'pfig')}${q.stem ? renderStem(writtenStem(q), 'pstem') : ''}
    ${q.parts.map((p) => `<div class="ppart"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="pm">(${p.marks})</span></div>${lines(Math.max(2, p.marks + 1))}`).join('')}</div>`;
  const draw = () => {
    const who = (local.name || '').trim();
    $app.innerHTML = `
  <div class="noprint topbar"><button class="backbtn" id="back">${ICON.back}<span>Back</span></button><span style="font-weight:600;font-size:16px">Worksheet ${ws.code}</span></div>
  <div class="noprint stack g10" style="padding:0 20px 16px">
    <label for="wsname" style="font-size:14px;font-weight:600;color:var(--muted)">Name on every page</label>
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
  const when = (t) => new Date(t).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' });
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button><span style="font-weight:600;font-size:16px">Printed worksheets</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Pick the worksheet you did. Check the code at the bottom of the page. Enter what you wrote on paper, and PrepBuddy marks it.</p>
    ${list.length ? `<div class="card stack">${list.map((ws) => { const b = books.find((x) => x.id === ws.bookId); return `<div class="row wsrow"><div class="top"><span><b style="font-weight:600">${ws.code}</b> <span class="muted" style="font-size:14px">· ${when(ws.at)}</span><br><span class="muted" style="font-size:14px"><span data-raw>${esc((b.subject ? subj(b.subject) : b.title))}</span> · ${ws.A.length + ws.B.length} questions${ws.score ? ` · Marked: ${ws.score}` : ''}</span></span></div>
      <div style="display:flex;gap:14px;margin-top:8px"><button class="btn-sm" data-ws="${ws.code}">${ws.score ? 'Mark again' : 'Enter answers'}</button><button class="btn-sm quiet" data-reprint="${ws.code}">Print again</button></div></div>`; }).join('')}</div>`
      : '<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:var(--text-2)">No printed worksheets yet. Open a textbook, choose Mock exam, then Print as a worksheet.</p></div>'}
  </main>`;
  document.getElementById('back').onclick = () => goBack({ name: 'home' });
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
  return Object.assign({ at: Date.now(), i: 0, answers: [], got: [], ticks: {}, marks: {}, phase: 'answer', review: false, deadline: null, waiting: false, generating: false, error: null }, props);
}

// A session over one or more chapters. Ready questions are used first; everything still missing is ordered
// the moment the session starts (several batches side by side), plus a few spare for next time, so even a
// fast student rarely catches up with the AI. Spare questions stay in the bank and are used first next session.
const SPARE = 3;
const MAKE_PAR = 4;
async function startUnits(book, units, count = sessionSize(), opts = {}) {
  track(opts.placement ? 'level_check' : 'practice');
  if (!opts.placement) { if (!allow('q')) return; if (limitOf('q') !== UNL) count = Math.max(1, Math.min(count, leftOf('q'))); }
  const k = units.length, quota = Math.ceil(count / k);
  let types = opts.types || curTypes(); const diff = opts.diff || curDiff();
  if (types !== 'mcq' && limitOf('written') !== UNL && leftOf('written') <= 0) { types = 'mcq'; toast(PL('Today’s written questions are used up: multiple choice for now. Standard has unlimited.', '今日的文字題已用完，暫時只有選擇題。標準計劃無限使用。')); }
  const pools = [];
  for (const u of units) {
    const want = opts.pcheck ? 2 : 2 + levelShift(book.id, u.id); // a progress check asks at the level-check level, so before and now compare fairly
    const all_ = (await getQs(book.id, u.id)).filter((q) => matchType(q, types) && diffOK(q, diff));
    // a progress check may reuse questions answered before (least recently seen first), so it never has to wait for new ones
    const pool = opts.pcheck ? shuffle(all_).sort((a, b) => ((local.stats[a.id] || {}).last_t || 0) - ((local.stats[b.id] || {}).last_t || 0)) : shuffle(all_.filter((q) => !local.stats[q.id]));
    // closest to the student's level first, with some variety
    pools.push(pool.map((q) => [q, Math.abs((q.level || 2) - want) + Math.random() * 1.5]).sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  }
  let qs = [];
  pools.forEach((p) => qs.push(...p.slice(0, quota)));
  if (qs.length < count) pools.forEach((p) => qs.push(...p.slice(quota)));   // top up from chapters that have more
  qs = shuffle(qs.slice(0, count));
  // unused questions each chapter still has after this session: spares are only written when that runs low
  const bankLeft = {}; units.forEach((u, i) => { bankLeft[u.id] = pools[i].filter((q) => !qs.includes(q)).length; });
  const title = k === 1 ? units[0].title : `${k} chapters`;
  S = newSession({ mode: 'unit', title: opts.title || title, book, units, qs, target: count, pending: 0, types, count, diff, placement: !!opts.placement, pcheck: !!opts.pcheck, bankLeft });
  topUp(S);
  if (S.qs.length) renderQuestion(); else renderWaiting();
}



/* ---------- plans: Standard and Pro (internal id 'plus' = Standard) ----------
   One table decides what each plan includes; everything else asks it. Limits count per day or per week on
   this device (accounts and payments come later). While PrepBuddy is in testing everyone has Pro, and Settings
   (or ?plan=free in the address) previews the other plans, so their layouts can be shown. */
const PL = (en, zh) => (LANG === 'zh' ? zh : en);
const UNL = Infinity;
const TIERS = {
  free: { name: 'Free', zh: '免費', price: 0, year: 0, tag: ['Practise and fix mistakes. Free forever.', '練習、改正錯誤，永久免費。'],
    lim: { books: 1, q: 20, written: 3, lesson: 2, buddy: 10, hardDiff: 0, stars: 0, coach: 0, report: 0, test: 0, sched: 0, homework: 0, writing: 0, speaking: 0, mock: 0, voice: 0, forecast: 0, parent: 0 },
    pitch: ['', ''], has: [['Practice questions from your textbooks: multiple choice, plus 3 written a day', '課本練習題：選擇題，另每日 3 條文字題'], ['Learn mode lessons with Buddy', '學習模式課堂，有 Buddy 陪你'], ['Buddy hints on every question', '每條題目都有 Buddy 提示'], ['Mistake book, reviews and level check', '錯題簿、溫習和程度評估'], ['Notes, flashcards and dictation', '筆記、溫習卡和默書'], ['Easy and Medium difficulty', '容易和中等難度'], ['Weekly activity report for parents', '家長每週練習報告']] },
  plus: { name: 'Standard', zh: '標準', price: 218, year: 2180, tag: ['Exam-ready at school', '應付校內考試'],
    lim: { books: 3, q: 80, written: UNL, lesson: 10, buddy: 60, hardDiff: 1, stars: 1, coach: 1, report: 1, test: UNL, sched: UNL, homework: 10, writing: 2, speaking: 2, mock: 0, voice: 0, forecast: 0, parent: 0 },
    pitch: ['', ''], has: [['Practice questions from your textbooks, written answers marked by AI', '課本練習題，文字答案由 AI 批改'], ['Learn mode lessons with Buddy, and Buddy hints on every question', '學習模式課堂，每條題目都有 Buddy 提示'], ['Mistake book, reviews, notes, flashcards and dictation', '錯題簿、溫習、筆記、溫習卡和默書'], ['Hard and Master difficulty', '困難和大師難度'], ['Chapter tests and the school test planner', '章節測驗和學校測驗計劃'], ['Homework help from photos', '拍照功課輔導'], ['Study coach with daily plans', '溫習教練，每日計劃'], ['Stars and rewards', '星星獎勵'], ['Full parent report: chapters, skills, trends', '完整家長報告：章節、能力、趨勢'], ['Writing and speaking marking, 2 a week each', '寫作和說話評分，每週各 2 次']] },
  pro: { name: 'Pro', zh: 'Pro', price: 298, year: 2980, best: true, tag: ['A private tutor, for less than one lesson a month', '私人導師，每月比一堂補習更便宜'],
    lim: { books: UNL, q: UNL, written: UNL, lesson: UNL, buddy: UNL, hardDiff: 1, stars: 1, coach: 1, report: 1, test: UNL, sched: UNL, homework: UNL, writing: UNL, speaking: UNL, mock: UNL, voice: 1, forecast: 1, parent: 1 },
    pitch: ['Everything in Standard, plus:', '標準計劃的全部功能，再加上：'], has: [['Mock exams (school tests and exams) and printable worksheets', '模擬考試（校內考試、呈分試或 DSE）和可列印工作紙'], ['Unlimited writing marking with redrafts', '無限寫作批改和修改稿'], ['Unlimited speaking practice', '無限說話練習'], ['Talk to Buddy by voice', '用語音和 Buddy 對話'], ['Exam forecast and goals', '考試預測和目標'], ['No daily limits on anything', '所有功能都沒有每日上限'], ['A parent dashboard: today, this week, tests and what needs attention', '家長主頁：今日、本週、測驗和需要留意的地方']] },
};
// No free plan (decided 14 Nov 2026): families start with a free trial; bursaries and vouchers cover families who can't pay.
// 'free' stays defined only so an old preview setting on a device still works.
const PLAN_ORDER = ['plus', 'pro'];
// What each capability or allowance is, how it's counted, how it reads, and (for locked ones) what it does.
const FEAT = {
  q: { per: 'day', en: ['New practice questions', 'question a day', 'questions a day'], zh: ['新練習題目', '題／日'] },
  written: { per: 'day', en: ['Written questions marked by AI', 'a day'], zh: ['AI 批改文字題', '題／日'] },
  lesson: { per: 'day', en: ['Learn mode lessons', 'lesson a day', 'lessons a day'], zh: ['學習模式課堂', '課／日'] },
  buddy: { per: 'day', en: ['Ask Buddy messages', 'message a day', 'messages a day'], zh: ['問 Buddy 訊息', '則／日'] },
  books: { per: 'total', en: ['Textbooks', 'textbook', 'textbooks'], zh: ['課本', '本課本'] },
  hardDiff: { per: 'flag', en: ['Hard and Master difficulty'], zh: ['困難和大師難度'], d: ['Questions that stretch top students: applying and analysing, like the hardest exam questions.', '挑戰尖子的題目：應用和分析，好似考試最難的題目。'] },
  test: { per: 'week', en: ['Chapter tests', 'a week'], zh: ['章節測驗', '次／週'], d: ['Timed tests on a chapter, 80% to pass, like a school test.', '限時章節測驗，80% 合格，好似學校測驗。'] },
  sched: { per: 'total', en: ['School test planner', 'test at a time', 'tests at a time'], zh: ['學校測驗計劃', '個測驗'], d: ['Add a school test and Today’s mission works on it, day by day.', '加入學校測驗，今日任務會每天幫你準備。'] },
  homework: { per: 'week', en: ['Homework help (photos)', 'a week'], zh: ['功課輔導（拍照）', '次／週'], d: ['Snap tonight’s homework: Buddy explains, gives hints and checks your answers.', '拍下今晚的功課，Buddy 會解釋、給提示和檢查答案。'] },
  coach: { per: 'flag', en: ['Study coach'], zh: ['溫習教練'], d: ['A coach that sees your scores and mistakes, plans your day and starts it in one tap.', '教練看得到你的分數和錯題，幫你計劃每天溫習，一按就開始。'] },
  stars: { per: 'flag', en: ['Stars and rewards'], zh: ['星星獎勵'], d: ['Earn stars for practising and spend them on rewards your parents choose.', '練習賺星星，換取家長設定的獎勵。'] },
  report: { per: 'flag', en: ['Full parent report'], zh: ['完整家長報告'], d: ['Chapter scores, how ready for each subject, trends, tests and thinking skills.', '各章分數、各科準備程度、趨勢、測驗和思考能力。'] },
  writing: { per: 'week', en: ['Writing marked (DSE criteria)', 'a week'], zh: ['寫作批改（DSE 準則）', '篇／週'], d: ['DSE-style feedback on your essays with estimated bands, then redraft and see what improved.', '按 DSE 準則批改文章，估計等級，再修改並看到進步。'] },
  speaking: { per: 'week', en: ['Speaking answers marked', 'a week'], zh: ['說話回應評分', '次／週'], d: ['Answer DSE Paper 4 questions out loud and get marked on the four speaking domains.', '大聲回答 DSE 卷四題目，按四個說話範疇評分。'] },
  mock: { per: 'week', en: ['DSE mock exams and worksheets', 'a week'], zh: ['DSE 模擬考試和工作紙', '份／週'], d: ['Full DSE-style papers, timed like the real exam, or printed as worksheets.', '完整 DSE 模式試卷，像真實考試限時，或列印成工作紙。'] },
  voice: { per: 'flag', en: ['Talk to Buddy (voice)'], zh: ['與 Buddy 對話（語音）'], d: ['Ask Buddy out loud in English or Cantonese and hear the answer.', '用英文或廣東話問 Buddy，並聽到回答。'] },
  parent: { per: 'flag', en: ['Parent dashboard'], zh: ['家長主頁'], d: ['A PIN-protected dashboard for parents: today’s practice, the week, school tests coming up, each subject and what needs attention.', '家長專用、有密碼保護的主頁：今日練習、本週情況、即將來臨的測驗、各科進度和需要留意的地方。'] },
  forecast: { per: 'flag', en: ['Exam forecast'], zh: ['考試預測'], d: ['See where each subject is heading by your exam date, at your current pace.', '按現時進度，預測考試時各科的準備程度。'] },
};
const ALWAYS = [['Mistake book, reviews and level check', '錯題簿、溫習和程度評估'], ['Notes, flashcards and dictation', '筆記、溫習卡和默書'], ['Weekly activity report', '每週練習報告']];
const cap = (f) => !!limitOf(f);
(() => { try { const m = location.search.match(/[?&]plan=(free|plus|pro)\b/); if (m) { local.planPreview = m[1]; saveLocal(); } } catch (e) {} })();
const planId = () => (local.planLock ? local.plan : local.planPreview || local.plan) || 'pro'; // testing: Pro unless previewing
const curPlan = () => TIERS[planId()];
const limitOf = (f) => curPlan().lim[f];
const weekStart = (t = Date.now()) => { const d = new Date(dayStart(t)); const k = (d.getDay() + 6) % 7; return d.getTime() - k * DAY; };
function usedOf(f) {
  const per = FEAT[f].per;
  if (f === 'books') return 0; // checked against the shelf when adding
  if (f === 'sched') return new Set(upcomingTests().map((x) => x.grp || x.id)).size;
  const u = (local.meter || {})[f]; if (!u) return 0;
  return u.p === (per === 'day' ? dayStart() : weekStart()) ? u.n : 0;
}
function meter(f, n = 1) {
  if (TOURING) return; // the tour's sample book never uses up the family's allowance
  const per = FEAT[f].per; if (per !== 'day' && per !== 'week') return;
  const p = per === 'day' ? dayStart() : weekStart();
  local.meter = local.meter || {};
  const u = local.meter[f]; local.meter[f] = { p, n: (u && u.p === p ? u.n : 0) + n };
  saveLocal();
}
const leftOf = (f) => Math.max(0, limitOf(f) - usedOf(f));
const locked = (f) => !limitOf(f);
// Can they use it now? If not, the upgrade sheet explains and this returns false.
function allow(f) {
  if (TOURING) return true; // the tour may show any screen; the overlay stops anything being used
  if (limitOf(f) === UNL || (FEAT[f].per === 'flag' && limitOf(f))) return true;
  if (locked(f)) { upsell(f, 'locked'); return false; }
  if (leftOf(f) <= 0) { upsell(f, 'limit'); return false; }
  return true;
}
const nextPlanFor = (f) => PLAN_ORDER.slice(PLAN_ORDER.indexOf(planId()) + 1).find((p) => TIERS[p].lim[f] > (curPlan().lim[f] || 0)) || 'pro';
const limText = (f, v) => { const F = FEAT[f]; if (v === UNL) return PL('Unlimited', '無限'); if (F.per === 'flag') return v ? '✓' : '—'; if (!v) return '—'; return `${v} ${PL(v === 1 || !F.en[2] ? F.en[1] : F.en[2], F.zh[1])}`.trim(); };
function upsell(f, why) {
  track('upsell:' + f);
  document.querySelectorAll('.up-wrap').forEach((x) => x.remove());
  const F = FEAT[f], np = nextPlanFor(f), P = TIERS[np];
  const name = PL(F.en[0], F.zh[0]);
  const reset = FEAT[f].per === 'day' ? PL('It resets tomorrow.', '明天會重設。') : FEAT[f].per === 'week' ? PL('It resets on Monday.', '星期一會重設。') : '';
  const box = document.createElement('div'); box.className = 'cdlg-wrap up-wrap';
  box.innerHTML = `<div class="cdlg updlg" role="dialog" aria-modal="true" aria-labelledby="up-t" data-raw>
    <span class="up-bud">${buddySVG(why === 'locked' ? 'think' : 'happy', 64)}</span>
    <b id="up-t">${why === 'locked' ? PL(`${name} is part of ${P.name}`, `${name}屬於 ${P.zh} 計劃`) : F.per === 'day' ? PL(`You’ve used today’s ${name}`, `你已用完今日的${name}`) : F.per === 'week' ? PL(`You’ve used this week’s ${name}`, `你已用完本週的${name}`) : PL(`Your plan’s limit for ${name}`, `你的計劃的${name}已達上限`)}</b>
    <span>${why === 'locked' ? `${F.d ? PL(F.d[0], F.d[1]) + ' ' : ''}${PL(`Upgrade to ${P.name} to unlock it.`, `升級至 ${P.zh} 即可使用。`)}` : PL(`The ${TIERS[planId()].name} plan includes ${limText(f, limitOf(f))}. ${reset} ${P.name} gives you ${limText(f, P.lim[f]).toLowerCase()}.`, `${TIERS[planId()].zh}計劃包括 ${limText(f, limitOf(f))}。${reset}${P.zh} 計劃有 ${limText(f, P.lim[f])}。`)}</span>
    <div class="up-price"><b>HK$${P.price}</b><small>${PL('a month', '每月')}</small>${P.year ? `<em>${PL(`or HK$${P.year} a year`, `或每年 HK$${P.year}`)}</em>` : ''}</div>
    <button class="btn" id="up-see">${PL(`See ${P.name}`, `查看 ${P.zh}`)}</button>
    <button class="btn-sm quiet" id="up-later">${why === 'limit' && reset ? PL('OK, I’ll come back', '好，我稍後再來') : PL('Not now', '稍後再說')}</button>
  </div>`;
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  box.querySelector('#up-later').onclick = () => box.remove();
  box.querySelector('#up-see').onclick = () => { box.remove(); go({ name: 'plans', hi: np }); };
  document.body.appendChild(box);
}
// API calls that use up a plan's allowance: which feature, by path and step.
function apiFeature(path, body) {
  if (path === 'explain' || path === 'coach') return 'buddy';
  if (path === 'learn') return body && body.ask !== undefined ? 'buddy' : null;
  if (path === 'homework') return body && body.step === 'read' ? 'homework' : body && body.step === 'chat' ? 'buddy' : null;
  if (path === 'writing') return body && body.step === 'mark' ? 'writing' : null;
  if (path === 'speaking') return body && body.step === 'mark' ? 'speaking' : null;
  return null;
}
function gateApi(path, body) {
  const f = apiFeature(path, body); if (!f) return null;
  if (!allow(f)) { const e = new Error(PL('That’s the limit on your plan for now.', '已達到你計劃的使用上限。')); e.status = 402; e.plan = true; throw e; }
  return f;
}
// A small lock badge for tiles and buttons on plans that don't include the feature.
const lockTag = (f) => (locked(f) ? `<span class="lock-tag">🔒 ${TIERS[nextPlanFor(f)].name}</span>` : '');

function renderPlans(hi) {
  const yearly = !!local.planYearly, cur = planId();
  const cell = (p, f) => { const v = TIERS[p].lim[f]; return `<td class="${v === UNL || (FEAT[f].per === 'flag' && v) ? 'pt-yes' : !v ? 'pt-no' : ''}">${limText(f, v)}</td>`; };
  $app.innerHTML = `
  ${backTop({name:'settings'}, 'Back')}
  <main class="pad stack g18 planpage" data-view="plans" data-raw style="flex:1">
    <div class="pp-head"><h1 class="pagetitle">${PL('Choose your plan', '選擇你的計劃')}</h1>
      <div class="seg pp-bill" role="radiogroup" aria-label="${PL('Billing', '付款方式')}"><button role="radio" aria-checked="${!yearly}" class="${!yearly ? 'on' : ''}" data-bill="m">${PL('Monthly', '按月')}</button><button role="radio" aria-checked="${yearly}" class="${yearly ? 'on' : ''}" data-bill="y">${PL('Yearly · 2 months free', '按年 · 免費兩個月')}</button></div></div>
    <div class="pp-cards">${PLAN_ORDER.map((p) => { const P = TIERS[p]; const price = yearly ? Math.round(P.year / 12) : P.price;
      return `<section class="pp-card ${P.best ? 'best' : ''} ${p === hi ? 'hi' : ''} ${p === cur ? 'cur' : ''}">
        ${P.best ? `<span class="pp-flag">${PL('Most popular', '最受歡迎')}</span>` : ''}
        <h2>${PL(P.name, P.zh)}</h2><p class="pp-tag">${PL(...P.tag)}</p>
        <div class="pp-price"><b>${price ? `HK$${price}` : PL('Free', '免費')}</b>${price ? `<small>${PL('/ month', '／月')}</small>` : ''}</div>
        <p class="pp-sub">${!price ? PL('No card needed', '不用信用卡') : yearly ? PL(`HK$${P.year} billed yearly`, `每年收費 HK$${P.year}`) : PL(`or HK$${Math.round(P.year / 12)}/month yearly`, `按年只需每月 HK$${Math.round(P.year / 12)}`)}</p>
        ${P.pitch[0] ? `<p class="pp-pitch">${PL(...P.pitch)}</p>` : ''}
        <ul>${P.has.map((h) => `<li>✓ ${PL(...h)}</li>`).join('')}</ul>
        ${p === cur ? `<button class="btn ghost" disabled>${PL('Your plan', '你的計劃')}</button>` : `<button class="btn ${P.best ? '' : 'ghost'}" data-pick="${p}">${p === 'free' ? PL('Use Free', '使用免費計劃') : PL(`Choose ${P.name}`, `選擇 ${P.zh}`)}</button>`}
      </section>`; }).join('')}</div>
    <section class="card pp-social"><span>${buddySVG('happy', 44)}</span><div><b>${PL('No student is left out', '不讓任何學生落後')}</b>
      <span>${PL('Families receiving CSSA or the full Student Finance grant can get Pro at no cost through the PrepBuddy bursary. Schools and NGOs can ask us about sponsored places.', '領取綜援或全額學生資助的家庭，可透過 PrepBuddy 助學計劃免費使用 Pro。學校和社福機構可向我們查詢資助名額。')}</span>
      <button class="btn-sm" id="bursary">${PL('Apply for the bursary', '申請助學計劃')}</button></div></section>
    <section class="card pp-table"><h2>${PL('Compare plans', '比較計劃')}</h2><div class="pt-scroll"><table>
      <thead><tr><th></th>${PLAN_ORDER.map((p) => `<th class="${TIERS[p].best ? 'best' : ''}">${PL(TIERS[p].name, TIERS[p].zh)}</th>`).join('')}</tr></thead>
      <tbody>${Object.keys(FEAT).map((f) => `<tr><th>${PL(FEAT[f].en[0], FEAT[f].zh[0])}</th>${PLAN_ORDER.map((p) => cell(p, f)).join('')}</tr>`).join('')}
      ${ALWAYS.map((a) => `<tr><th>${PL(...a)}</th>${PLAN_ORDER.map(() => '<td class="pt-yes">✓</td>').join('')}</tr>`).join('')}</tbody></table></div></section>
    <p class="pp-trial">${PL('Every family starts with a free trial of Pro.', '每個家庭都可以先免費試用 Pro。')}</p>
    <p class="hint" style="margin:0;text-align:center">${PL('Prices are a draft while PrepBuddy is in testing. Payments aren’t switched on yet: choosing a plan previews it on this device.', '測試期間價錢只是初稿，暫未接受付款：選擇計劃只會在這部裝置預覽。')}</p>
  </main>`;
  $app.querySelectorAll('[data-bill]').forEach((b) => (b.onclick = () => { local.planYearly = b.dataset.bill === 'y'; saveLocal(); renderPlans(hi); }));
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { if (local.planLock) return toast(PL('Your plan is set for the pilot. Ask us if you’d like to change it.', '試用期間的計劃已設定，如想更改請聯絡我們。')); local.planPreview = b.dataset.pick; saveLocal(); renderTabs(); toast(PL(`Previewing ${TIERS[b.dataset.pick].name}. Payments come later.`, `正在預覽 ${TIERS[b.dataset.pick].zh}，付款功能稍後推出。`)); renderPlans(); }));
  document.getElementById('bursary').onclick = () => toast(PL('Bursary applications open with accounts. Coming soon.', '助學計劃會在帳戶功能推出時開放申請。'));
  window.scrollTo(0, 0);
}
// Settings: the plan card with today's and this week's allowance.
function planCardHTML() {
  // pilot families: everything is free, so no plans or prices (they're shown with ?dev=1 for testing)
  if (local.pilot && !DEV) return `<section class="card stack g6 plancard" style="padding:16px"><b style="font-size:16px">${PL('Free during the pilot', '試用期間免費')}</b><span class="muted" style="font-size:14px;line-height:1.5">${PL('Everything is included while you help us test PrepBuddy. Thank you!', '在你幫我們試用 PrepBuddy 期間，所有功能都可以免費使用。謝謝你！')}</span></section>`;
  const P = curPlan(), id = planId();
  const meters = ['q', 'written', 'buddy', 'lesson', 'homework', 'writing', 'speaking', 'mock'].filter((f) => limitOf(f) !== UNL && limitOf(f) > 0).map((f) => { const lim = limitOf(f), u = Math.min(lim, usedOf(f)); return `<div class="pm"><span>${PL(FEAT[f].en[0], FEAT[f].zh[0])}</span><span class="pm-bar"><i style="width:${(u / lim) * 100}%" class="${u >= lim ? 'full' : ''}"></i></span><b>${u}/${lim}</b><small>${FEAT[f].per === 'day' ? PL('today', '今日') : PL('this week', '本週')}</small></div>`; }).join('');
  return `<section class="card stack g10 plancard" style="padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b style="font-size:16px">${PL('Your plan', '你的計劃')}: <span class="plan-pill ${id}">${PL(P.name, P.zh)}</span></b><button class="btn-sm ${id === 'pro' ? '' : 'primary'}" id="splans">${id === 'pro' ? PL('See plans', '查看計劃') : PL('Upgrade', '升級')}</button></div>
    ${meters ? `<div class="pms">${meters}</div>` : `<span class="muted" style="font-size:14px">${PL('Everything unlimited.', '全部無限使用。')}</span>`}
    ${local.planLock || !DEV ? '' : `<div class="pv"><span class="muted">${PL('Testing: preview a plan on this device', '測試中：在這部裝置預覽計劃')}</span><div class="seg">${PLAN_ORDER.map((p) => `<button class="${p === id ? 'on' : ''}" data-pv="${p}">${PL(TIERS[p].name, TIERS[p].zh)}</button>`).join('')}</div></div>`}
  </section>`;
}


/* ---------- parent dashboard (Pro) ----------
   A parent opens it on the child's device with the parent PIN and sees what the child has been doing, live from
   this device's data: today, this week, upcoming school tests, subjects, what needs attention and recent
   activity. With accounts later, the same screen moves to the parent's own phone. */
const PD = (en, zh) => (LANG === 'zh' ? zh : en);
let parentUntil = 0;
async function openParent() {
  if (!allow('parent')) return;
  if (Date.now() < parentUntil) return go({ name: 'parent' });
  const ok = await askPin(PD('Parent dashboard: enter the parent PIN.', '家長主頁：請輸入家長密碼。'));
  if (!ok) return;
  parentUntil = Date.now() + 15 * 60000; track('parent_dashboard');
  go({ name: 'parent' });
}
const agoWords = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return PD('just now', '剛剛');
  if (m < 60) return PD(`${m} min ago`, `${m} 分鐘前`);
  const h = Math.round(m / 60); if (h < 24) return PD(`${h} h ago`, `${h} 小時前`);
  const d = Math.round(h / 24); return d === 1 ? PD('yesterday', '昨天') : PD(`${d} days ago`, `${d} 天前`);
};
async function renderParent() {
  const subj_ = (x) => subjectName(x, LANG);
  if (locked('parent') || Date.now() > parentUntil) return go({ name: 'progress' });
  const books = await getBooks();
  const r = await currentReport();
  const t0 = dayStart(), log = local.log || [];
  const today = log.filter((e) => e.t >= t0);
  const todayMin = minutesOf(today);
  const tg = today.reduce((a, e) => a + (e.g || 0), 0), tm = today.reduce((a, e) => a + (e.m || 0), 0);
  const last = log.length ? log[log.length - 1].t : 0;
  const name = (local.name || '').trim() || PD('Your child', '你的孩子');
  const weekMin = r.days.reduce((a, b) => a + b, 0);
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LOCALE(), { weekday: 'short' }));
  const maxMin = Math.max(20, ...r.days);
  // subjects
  const subj = [];
  for (const b of books) { const m = await bookMastery(b); subj.push({ b, m }); }
  const started = subj.flatMap(({ b, m }) => m.chapters.filter((c) => c.done).map((c) => ({ b, c })));
  const weakest = started.slice().sort((x, y) => x.c.pct - y.c.pct).slice(0, 3);
  const due = (await dueItems()).length, mk = mistakeCount();
  const tests = (await Promise.all(upcomingTests().slice(0, 3).map(testStep))).filter(Boolean);
  // recent activity, newest first
  const feed = [];
  const sessions = []; // group answers within 20 minutes of each other into one session
  for (const e of log.slice(-300)) { const s = sessions[sessions.length - 1]; if (s && e.t - s.end < 20 * 60000 && s.b === String(e.q).split(':')[0]) { s.end = e.t; s.n++; s.g += e.g || 0; s.m += e.m || 0; } else sessions.push({ start: e.t, end: e.t, n: 1, g: e.g || 0, m: e.m || 0, b: String(e.q).split(':')[0] }); }
  const bookName = (id) => { const b = books.find((x) => x.id === id); return b ? (b.subject ? subj_(b.subject) : b.title) : ''; };
  sessions.slice(-12).forEach((s) => feed.push({ t: s.end, ic: 'bars', tx: PD(`Practised ${bookName(s.b)}: ${s.n} question${s.n > 1 ? 's' : ''}, ${s.m ? Math.round(100 * s.g / s.m) : 0}% of marks`, `練習 ${bookName(s.b)}：${s.n} 題，得分率 ${s.m ? Math.round(100 * s.g / s.m) : 0}%`) }));
  (local.tests || []).slice(-8).forEach((x) => feed.push({ t: x.t, ic: 'pencil', tx: PD(`${x.kind === 'test' ? 'Chapter test' : 'Mock exam'}: ${x.m ? Math.round(100 * x.g / x.m) : 0}%`, `${x.kind === 'test' ? '章節測驗' : '模擬考試'}：${x.m ? Math.round(100 * x.g / x.m) : 0}%`) + ` · ${x.title || ''}` }));
  Object.entries(local.learned || {}).forEach(([k, t]) => { const [bid, uid_] = k.split(':'); const b = books.find((x) => x.id === bid); const u = b && b.units.find((x) => x.id === uid_); if (u) feed.push({ t, ic: 'book', tx: PD(`Finished a lesson: ${cleanUnitTitle(u.title)}`, `完成一課：${cleanUnitTitle(u.title)}`) }); });
  (local.wr || []).forEach((w) => w.drafts.forEach((d, i) => feed.push({ t: d.t, ic: 'pencil', tx: PD(`Writing marked (draft ${i + 1}): ${lvShow(wrLevel(d.fb, w.kind))}`, `寫作批改（第 ${i + 1} 稿）：${lvShow(wrLevel(d.fb, w.kind))}`) + ` · ${w.title}` })));
  (local.sp || []).forEach((x) => x.tries.forEach((t) => feed.push({ t: t.t, ic: 'send', tx: PD(`Speaking answer marked: ${lvShow(spLevel(t.fb, x))}`, `說話回應評分：${lvShow(spLevel(t.fb, x))}`) + ` · ${x.task.title}` })));
  (local.hw || []).forEach((h) => feed.push({ t: h.t, ic: 'check', tx: PD(`Homework help: ${h.title || 'homework'}`, `功課輔導：${h.title || '功課'}`) }));
  schoolTests().filter((x) => typeof x.score === 'number').forEach((x) => feed.push({ t: testDay(x), ic: 'target', tx: PD(`School test result: ${x.name} ${x.score}%`, `學校測驗成績：${x.name} ${x.score}%`) }));
  feed.sort((a, b) => b.t - a.t);
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  // The dashboard is the weekly report, live, plus what only a live view can show: today, tests coming up, activity.
  const todayCard = `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('clock', 18)} ${PD('Today', '今日')}</h2><span>${last ? PD(`Last practised ${agoWords(last)}`, `上次練習：${agoWords(last)}`) : PD('No practice yet', '仍未練習')}</span></div>
    <div class="rp-today"><div class="${todayMin ? '' : 'warn'}"><b>${todayMin}</b><span>${PD('minutes', '分鐘')}</span></div><div><b>${today.length}</b><span>${PD('questions', '題目')}</span></div><div><b>${tm ? Math.round(100 * tg / tm) + '%' : '–'}</b><span>${PD('marks scored', '得分率')}</span></div></div>
    ${!today.length ? `<p style="font-size:14px;color:#B4531A">${PD('No practice yet today.', '今日仍未練習。')}</p>` : ''}</section>`;
  const testsCard = tests.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('target', 18)} ${PD('School tests coming up', '即將來臨的學校測驗')}</h2><span>${PD('and today’s plan for each', '及每個測驗的今日計劃')}</span></div>
    <div class="rp-up">${tests.map((p) => `<div><span class="rp-cal ${p.left <= 1 ? 'soon' : ''}"><b>${new Date(testDay(p.x)).getDate()}</b><small>${new Date(testDay(p.x)).toLocaleDateString(LOCALE(), { month: 'short' })}</small></span><span class="rp-ut"><b>${esc(p.x.name)}</b><small>${leftText(p.left)} · ${esc(p.step.t)}</small></span><b class="${tone(p.ready || 0)}">${p.ready == null ? '–' : p.ready + '%'}</b></div>`).join('')}</div></section>` : '';
  const feedCard = `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('bars', 18)} ${PD('Recent activity', '最近活動')}</h2><span>${PD('newest first', '最新在前')}</span></div>
    ${feed.length ? `<ol class="rp-feed">${feed.slice(0, 12).map((f) => `<li><span class="rp-fi">${pIcon(f.ic, 14)}</span><span>${esc(f.tx)}<small>${agoWords(f.t)}</small></span></li>`).join('')}</ol>` : `<p style="font-size:14px;color:var(--muted)">${PD('Activity will show here as your child studies.', '孩子溫習時，活動會在這裏顯示。')}</p>`}</section>`;
  const fixCard = mk || due ? `<section class="rp-call weak"><h3>${PD('To do', '待處理')}</h3><p>${[mk ? PD(`${mk} mistake${mk > 1 ? 's' : ''} to fix`, `${mk} 題錯題待改正`) : '', due ? PD(`${due} review${due > 1 ? 's' : ''} due`, `${due} 題待溫習`) : ''].filter(Boolean).join(' · ')}</p></section>` : '';
  $app.innerHTML = `
  ${backTop({name:'progress'}, 'Progress')}
  <main class="pad stack g14 parentpage" data-view="parent" data-raw style="flex:1">
    <div class="pd-top"><span class="muted" style="font-size:14px">${PD('Updates as your child practises', '孩子練習時會即時更新')}</span>
      <div class="pd-acts"><button class="btn-sm" id="pdReport">${pIcon('send', 16)} ${PD('Send as weekly report', '傳送每週報告')}</button><button class="btn-sm quiet" id="pdLock">🔒 ${PD('Lock', '鎖上')}</button></div></div>
    <div class="pd-rep">${reportHTML(r, { live: true, top: todayCard + testsCard, sideTop: fixCard, bottom: marksCard() + feedCard })}</div>
    <p class="hint" style="margin:0;text-align:center">${PD('Same as the weekly report, kept up to date. With PrepBuddy accounts (coming soon) it will open on your own phone.', '與每週報告相同，但會即時更新。推出 PrepBuddy 帳戶後，可在你自己的手機查看。')}</p>
  </main>`;
  document.getElementById('pdReport').onclick = () => reportDialog();
  document.getElementById('pdLock').onclick = () => { parentUntil = 0; go({ name: 'progress' }); };
  { const b = document.getElementById('pdMarks'); if (b) b.onclick = async () => { await marksScreen(); go({ name: 'parent' }); }; }
  $app.querySelectorAll('[data-mk]').forEach((b) => (b.onclick = async () => { await marksScreen((local.marks || []).find((x) => x.id === b.dataset.mk)); go({ name: 'parent' }); }));
  window.scrollTo(0, 0);
}

/* ---------- school tests: plan the days before a test ----------
   The student adds a school test (name, date, book, chapters). Today's plan then counts down to it:
   learn chapters not met yet, practise the weakest, a timed practice test the day before, a short warm-up
   on the day. Afterwards they can note how it went. Kept on this device. */
const SCH = (en, zh) => (LANG === 'zh' ? zh : en);
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const testDay = (x) => new Date(x.date + 'T00:00:00').getTime();
const testLeft = (x) => Math.round((testDay(x) - dayStart()) / DAY);
function schoolTests() { return (local.sched || []).slice().sort((a, b) => testDay(a) - testDay(b)); }
const upcomingTests = () => schoolTests().filter((x) => testLeft(x) >= 0);
const leftText = (n) => (n === 0 ? SCH('today', '今天') : n === 1 ? SCH('tomorrow', '明天') : SCH(`in ${n} days`, `${n} 天後`));
// What to do today for one test: the step, plus a function that starts it.
// Subjects a school test can be for, and which subject a textbook belongs to.
// French and Japanese show up once the child has a book in that language (all = every subject, for names).
let EXTRA_SUBJ = new Set();
// School dictation languages: [key, 中文 name, English name, subject key]. Word lists in Cantonese or Putonghua are both Chinese.
const DICT_LANGS = [['zh', '中文', 'Chinese', 'chi'], ['en', '英文', 'English', 'eng'], ['fr', '法文', 'French', 'fre'], ['ja', '日文', 'Japanese', 'jpn']];
const dictGroup = (l) => (l === 'yue' || l === 'cmn' || l === 'zh' ? 'zh' : l);
const TEST_SUBJ = (all) => [['chi', '中文', 'Chinese'], ['eng', '英文', 'English'], ...(all || EXTRA_SUBJ.has('fre') ? [['fre', '法文', 'French']] : []), ...(all || EXTRA_SUBJ.has('jpn') ? [['jpn', '日文', 'Japanese']] : []), ['math', '數學', 'Maths'], isPrimaryKid() ? ['gs', '常識', 'General Studies'] : ['gs', '科學／人文', 'Science / Humanities'], ['other', '其他', 'Other subject']];
const tSubjName = (k) => { const x = TEST_SUBJ(true).find((s) => s[0] === k); return x ? (LANG === 'zh' ? x[1] : x[2]) : ''; };
function bookSubjKey(b) {
  const t = String((b && (b.subject + ' ' + b.title)) || '');
  return /french|français|francais|法文|法語/i.test(t) ? 'fre' : /japanese|日本語|国語|日文|日語/i.test(t) ? 'jpn' : /english|英文/i.test(t) ? 'eng' : /math|數學|algebra/i.test(t) ? 'math' : /chinese|中文|中國語文/i.test(t) ? 'chi' : /science|general studies|humanities|常識|科學|人文/i.test(t) ? 'gs' : 'other';
}
// A small tear-off calendar: month band, big day number, weekday. Used for school tests.
function calTile(t, size = 'lg') {
  const d = new Date(t), zh = LANG === 'zh';
  return `<span class="cal-tile ${size}" aria-hidden="true"><span class="cal-m">${d.toLocaleDateString(LOCALE(), { month: 'short' })}</span><b class="cal-d">${d.getDate()}</b><span class="cal-w">${d.toLocaleDateString(LOCALE(), { weekday: 'short' })}</span></span>`;
}
// What the test covers, in a few words, for lists and cards.
function testScope(p) {
  if (p.dict) return SCH(`Dictation · ${p.dict.title}`, `默書 · ${p.dict.title}`);
  if ((p.x.kind || 'test') === 'dict') return SCH('Dictation · words not added yet', '默書 · 未加入詞語');
  if (!p.book) return SCH(`${p.x.sname || tSubjName(p.x.subj) || 'Subject'} · no textbook in the app yet`, `${p.x.sname || tSubjName(p.x.subj) || '科目'} · 未加入課本`);
  if (p.all) return SCH('Everything practised so far', '至今練習過的所有內容');
  return p.units.length === 1 ? cleanUnitTitle(p.units[0].title) : SCH(`${p.units.length} chapters`, `${p.units.length} 個章節`);
}
async function testStep(x) {
  const left = testLeft(x);
  if ((x.kind || 'test') === 'dict') {
    // 默書: readiness is the latest score on its word list
    const L = (local.dict || []).find((d) => d.id === x.L) || null;
    const last = L && (L.runs || []).length ? L.runs[L.runs.length - 1] : null;
    const ready = last && last.n ? Math.round(100 * last.g / last.n) : 0;
    const step = !L ? { icon: 'learn', t: SCH('Add your dictation words', '加入默書詞語'), s: SCH('Type them in or snap the list, then practise', '輸入或拍下詞語表，然後練習'), go: SCH('Add', '加入'), run: () => go({ name: 'dictation', id: 'new' }) }
      : { icon: 'practise', t: SCH(`Practise dictation: ${L.title}`, `練習默書：${L.title}`), s: last ? SCH(`${last.g} of ${last.n} right last time`, `上次 ${last.n} 個中寫對 ${last.g} 個`) : SCH('Not tried yet', '未試過'), go: SCH('Practise', '練習'), run: () => go({ name: 'dictation', id: L.id, sub: 'run' }) };
    return { x, book: null, units: [], left, ready, step, dict: L, last };
  }
  const book = x.b ? (await getBooks()).find((b) => b.id === x.b) : null;
  if (!book) {
    const step = { icon: 'learn', t: SCH(`Add your ${tSubjName(x.subj) || ''} textbook`.replace('  ', ' '), `加入${tSubjName(x.subj)}課本`), s: SCH('Then Buddy can get you ready for this test', '加入後，Buddy 便可幫你準備這個測驗'), go: SCH('Add', '加入'), run: () => go({ name: 'library' }) };
    return { x, book: null, units: [], left, ready: null, step };
  }
  const m = await bookMastery(book);
  const all = !(x.u && x.u.length);
  // "everything so far": the chapters already practised (or the first one, if none yet)
  let chs = all ? m.chapters.filter((c) => c.done) : m.chapters.filter((c) => x.u.includes(c.unit.id));
  if (!chs.length) chs = m.chapters.slice(0, 1);
  if (!chs.length) return null;
  const units = chs.map((c) => c.unit);
  const ready = Math.round(chs.reduce((t, c) => t + c.pct, 0) / chs.length);
  const learned = (u) => !!(local.learned || {})[`${book.id}:${u.id}`];
  const weakest = chs.slice().sort((a, b) => a.pct - b.pct)[0];
  const name = (u) => shortTitle(u.title);
  let step;
  if (left === 0) step = { icon: 'weak', t: SCH('Test today: a 5-question warm-up', '今天考試：5 題熱身'), s: SCH('Wake your brain up, then good luck!', '熱熱身，祝你考試順利！'), go: SCH('Warm up', '熱身'), run: () => startUnits(book, units, 5) };
  else if (left === 1) step = { icon: 'test', t: SCH('Practice test for tomorrow', '為明天做一次模擬測驗'), s: SCH('Timed, on all the test chapters', '限時，包括所有考試章節'), go: SCH('Start', '開始'), run: () => startChapterTest(book, units) };
  else {
    const fresh = chs.find((c) => !c.done && !learned(c.unit));
    if (fresh) step = { u: fresh.unit.id, icon: 'learn', t: SCH(`Learn: ${name(fresh.unit)}`, `學習：${name(fresh.unit)}`), s: SCH('Not started yet: a guided lesson first', '未開始：先上一課'), go: SCH('Learn', '學習'), run: () => go({ name: 'learn', bookId: book.id, unitId: fresh.unit.id }) };
    else if (weakest.pct < 75) step = { icon: 'practise', t: SCH(`Practise: ${name(weakest.unit)}`, `練習：${name(weakest.unit)}`), s: SCH(`Your weakest test chapter, ${weakest.pct}% so far`, `最弱的考試章節，目前 ${weakest.pct}%`), go: SCH('Practise', '練習'), run: () => { pick = { bookId: book.id, ids: new Set([weakest.unit.id]) }; startUnits(book, [weakest.unit], 10); } };
    else step = { icon: 'review', t: SCH('Mixed practice on all test chapters', '所有考試章節混合練習'), s: SCH('You’re in good shape: keep it fresh', '準備得不錯，保持手感'), go: SCH('Practise', '練習'), run: () => startUnits(book, units, 10) };
  }
  return { x, book, units, left, ready, step, all };
}
// Add or edit a school test. Three kinds: a test or quiz (one subject, textbook and chapters optional),
// 默書 (a word list), or exams (several subjects, each with its own date; saved as one record per subject sharing grp).
function testDialog(edit) {
  if (!allow('sched')) return;
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  const group = edit && edit.grp ? (local.sched || []).filter((x) => x.grp === edit.grp).sort((a, b) => testDay(a) - testDay(b)) : null;
  const wk = ymd(Date.now() + 7 * DAY);
  const st = {
    kind: edit ? (edit.grp ? 'exam' : edit.kind || 'test') : 'test',
    id: edit ? edit.id : uid(), name: edit ? (edit.grp ? edit.gname || '' : edit.name) : '', named: !!edit,
    date: edit ? edit.date : wk, subj: edit ? edit.subj || '' : '', b: edit ? edit.b || null : null, u: new Set(edit && edit.u ? edit.u : []),
    lang: edit && edit.lang ? edit.lang : 'zh', L: edit ? edit.L || '' : '',
    parts: group ? group.map((x) => ({ id: x.id, subj: x.subj || '', date: x.date, b: x.b || '', score: x.score })) : [{ id: uid(), subj: '', date: wk, b: '' }],
  };
  const autoName = () => {
    if (st.kind === 'dict') { const n = DICT_LANGS.find((x) => x[0] === st.lang) || DICT_LANGS[0]; return SCH(`${n[2]} dictation`, `${n[1]}默書`); }
    if (st.kind === 'exam') return SCH('Exams', '考試');
    const nm = st.sname || (st.subj && st.subj !== 'other' ? tSubjName(st.subj) : '');
    return nm ? SCH(`${nm} test`, `${nm}測驗`) : '';
  };
  // Subjects come from the child's own textbooks first (by their real names, e.g. "Science"), then any other subject.
  const bookLabel = (b, books) => { const n = String(b.subject || b.title || '').trim(); return books.filter((x) => String(x.subject || x.title || '').trim() === n).length > 1 ? `${n} · ${b.title}` : n; };
  const choices = (books) => {
    const mine = books.map((b) => ({ v: `b:${b.id}`, label: bookLabel(b, books), subj: bookSubjKey(b), b: b.id }));
    const have = new Set(mine.map((x) => x.subj));
    const rest = TEST_SUBJ().filter(([k]) => k === 'other' || !have.has(k)).map(([k, z, e]) => ({ v: `s:${k}`, label: LANG === 'zh' ? z : e, subj: k, b: null }));
    return { mine, rest };
  };
  const subjOpts = (books, curB, curS) => { const { mine, rest } = choices(books); const cur = curB ? `b:${curB}` : curS ? `s:${curS}` : '';
    const o = (x) => `<option value="${esc(x.v)}" ${x.v === cur ? 'selected' : ''}>${esc(x.label)}</option>`;
    return `<option value="">${SCH('Choose a subject', '選擇科目')}</option>${mine.length ? `<optgroup label="${SCH('Your textbooks', '你的課本')}">${mine.map(o).join('')}</optgroup><optgroup label="${SCH('Other subjects', '其他科目')}">${rest.map(o).join('')}</optgroup>` : rest.map(o).join('')}`; };
  const parseChoice = (v, books) => { if (!v) return { subj: '', b: null }; if (v.startsWith('b:')) { const b = books.find((x) => x.id === v.slice(2)); return b ? { subj: bookSubjKey(b), b: b.id } : { subj: '', b: null }; } return { subj: v.slice(2), b: null }; };
  // Typing the name picks the subject: "Science test" → the Science textbook.
  const KW = [[/scien|科學|理科|常識|general stud|\bgs\b|生物|biolog|chemi|化學|physic|物理/i, 'sci'], [/math|數學|算數|算術|数学/i, 'math'], [/english|英文|英語|英语/i, 'eng'], [/chinese|中文|中國語文|國文/i, 'chi'], [/french|français|法文|法語/i, 'fre'], [/japanese|日本語|日文|国語/i, 'jpn'], [/histor|歷史|历史/i, 'hist'], [/geograph|地理/i, 'geo']];
  const groupOf = (t) => { const k = KW.find(([re]) => re.test(t)); return k ? k[1] : ''; };
  const guess = (name, books) => {
    const t = String(name || '').toLowerCase(); if (t.trim().length < 3) return null;
    const byWord = books.find((b) => String(b.subject || '').toLowerCase().split(/[^a-z\u3400-\u9fff]+/).some((w) => w.length >= 4 && t.includes(w)));
    if (byWord) return { subj: bookSubjKey(byWord), b: byWord.id };
    const g = groupOf(t); if (!g) return null;
    const bk = books.find((b) => groupOf(`${b.subject || ''} ${b.title || ''}`) === g);
    if (bk) return { subj: bookSubjKey(bk), b: bk.id };
    const key = { sci: 'gs', math: 'math', eng: 'eng', chi: 'chi', fre: 'fre', jpn: 'jpn' }[g];
    return key ? { subj: key, b: null } : null;
  };
  const bookOpts = (books, subjK, cur) => {
    const mine = books.filter((b) => !subjK || subjK === 'other' || bookSubjKey(b) === subjK);
    const list = mine.length ? mine : books;
    return list.map((b) => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.title)}</option>`).join('') + `<option value="" ${!cur ? 'selected' : ''}>${SCH('No textbook in the app for this', '這科未有課本')}</option>`;
  };
  const pickBook = (books, subjK) => { const m = books.filter((b) => subjK && bookSubjKey(b) === subjK); return m.length ? m[0].id : ''; };
  let dlgBooks = [];
  const draw = async () => {
    const books = (await getBooks()).filter((b) => !b.demo); dlgBooks = books;
    const keep = box.querySelector('.cdlg') ? box.querySelector('.cdlg').scrollTop : 0;
    const book = books.find((b) => b.id === st.b);
    if (!st.subj && book && st.kind === 'test') st.subj = bookSubjKey(book);
    st.sname = book ? String(book.subject || book.title || '').trim() : '';
    if (!st.named) st.name = autoName();
    const kinds = [['test', SCH('Test or quiz', '測驗或小測'), SCH('One subject', '一個科目')], ['exam', SCH('Exams', '考試'), SCH('Several subjects', '多個科目')], ['dict', SCH('Dictation', '默書'), SCH('Spelling words', '默寫詞語')]];
    const lists = (local.dict || []).filter((L) => dictGroup(L.lang) === st.lang);
    const dls = DICT_LANGS.filter((x) => x[0] === 'zh' || x[0] === 'en' || x[0] === st.lang || EXTRA_SUBJ.has(x[3]) || (local.dict || []).some((L) => L.lang === x[0]));
    let body = '';
    if (st.kind === 'test') {
      body = `<div class="td-two"><div><label for="td-d">${SCH('Date', '日期')}</label><input id="td-d" class="input" type="date" min="${ymd(Date.now())}" value="${esc(st.date)}"></div>
      <div><label for="td-s">${SCH('Subject', '科目')}</label><select id="td-s" class="input">${subjOpts(books, st.b, st.subj)}</select></div></div>
      ${book ? `<label>${SCH('Chapters in the test', '測驗範圍')} <span class="td-opt">${SCH('optional', '可不填')}</span></label>
        <div class="td-chs">${book.units.map((u) => `<label class="td-ch"><input type="checkbox" data-u="${esc(u.id)}" ${st.u.has(u.id) ? 'checked' : ''}><span>${esc(cleanUnitTitle(u.title))}</span></label>`).join('')}</div>
        <span class="td-hint">${SCH('Not sure? Leave them all unticked: Buddy will use everything you’ve practised so far.', '不清楚範圍？全部不剔：Buddy 會用你至今練習過的內容。')}</span>`
      : st.subj ? `<span class="td-hint">${SCH('No textbook for this subject yet. The test still counts down on Today, and you can add the book any time.', '這科未有課本。測驗仍會在「今天」倒數，你可隨時加入課本。')}</span>` : ''}`;
    } else if (st.kind === 'dict') {
      body = `<div class="${dls.length > 2 ? 'td-one' : 'td-two'}"><div><label for="td-d">${SCH('Date', '日期')}</label><input id="td-d" class="input" type="date" min="${ymd(Date.now())}" value="${esc(st.date)}"></div>
      <div><label>${SCH('Language', '語文')}</label><div class="td-seg">${dls.map((x) => `<button type="button" data-lang="${x[0]}" class="${st.lang === x[0] ? 'on' : ''}">${x[0] === 'zh' ? '中文' : x[0] === 'en' ? 'English' : LANG === 'zh' ? x[1] : x[2]}</button>`).join('')}</div></div></div>
      <label for="td-l">${SCH('Word list', '詞語表')}</label><select id="td-l" class="input">${lists.map((L) => `<option value="${esc(L.id)}" ${L.id === st.L ? 'selected' : ''}>${esc(L.title)} · ${L.items.length}</option>`).join('')}<option value="" ${!st.L ? 'selected' : ''}>${SCH('Add the words after saving', '儲存後加入詞語')}</option></select>
      <span class="td-hint">${SCH('Today’s mission will have you practise this list, and readiness is your latest score on it.', '「今日任務」會讓你練習這個詞語表，準備度是你最近一次的分數。')}</span>`;
    } else {
      body = `<label>${SCH('Subjects and dates', '科目及日期')}</label>
      <div class="td-parts">${st.parts.map((pt, i) => `<div class="td-part"><select class="input" data-ps="${i}" aria-label="${SCH('Subject', '科目')}">${subjOpts(books, pt.b, pt.subj)}</select><input class="input" type="date" data-pd="${i}" min="${ymd(Date.now())}" value="${esc(pt.date)}" aria-label="${SCH('Date', '日期')}">${st.parts.length > 1 ? `<button type="button" class="btn-sm quiet" data-px="${i}" aria-label="${SCH('Remove', '移除')}">✕</button>` : ''}</div>`).join('')}</div>
      <button type="button" class="btn-sm" id="td-addp" style="align-self:flex-start">+ ${SCH('Add a subject', '加入科目')}</button>
      <span class="td-hint">${SCH('Each subject uses its textbook, and everything you’ve practised in it so far. Buddy plans the soonest and weakest first.', '每科會用相關課本及至今練習過的內容。Buddy 會先安排最近和最弱的科目。')}</span>`;
    }
    box.innerHTML = `<div class="cdlg rdlg tdlg" role="dialog" aria-modal="true" aria-labelledby="td-t" data-raw>
      <div class="td-head"><b id="td-t">${edit ? SCH('Edit school test', '修改學校測驗') : SCH('Add a school test', '加入學校測驗')}</b>${edit ? `<button type="button" class="btn-sm danger td-delbtn" id="td-del"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>${SCH('Delete', '刪除')}</button>` : ''}</div>
      ${edit ? '' : `<div class="td-kinds" role="radiogroup" aria-label="${SCH('What kind of test?', '甚麼類型？')}">${kinds.map(([k, t, sub]) => `<button type="button" role="radio" aria-checked="${st.kind === k}" data-kind="${k}" class="${st.kind === k ? 'on' : ''}"><b>${t}</b><small>${sub}</small></button>`).join('')}</div>`}
      <label for="td-n">${SCH('Name', '名稱')}</label><input id="td-n" class="input" placeholder="${SCH('e.g. Science test, Term 1 exams', '例如：科學測驗、上學期考試')}" value="${esc(st.name)}">
      ${body}
      <p class="hw-err" id="td-err" role="alert" hidden></p>
      <div class="rd-row"><button class="btn ghost" id="td-cancel">${SCH('Cancel', '取消')}</button><button class="btn" id="td-save">${SCH('Save', '儲存')}</button></div>
    </div>`;
    box.querySelector('.cdlg').scrollTop = keep;
    const $ = (q) => box.querySelector(q);
    $('#td-n').oninput = (e) => {
      st.name = e.target.value; st.named = !!st.name.trim();
      if (st.kind !== 'test' || st.picked) return;
      clearTimeout(st.gt); st.gt = setTimeout(() => {
        const g = guess(st.name, books); if (!g || (g.b === st.b && g.subj === st.subj)) return;
        st.subj = g.subj; st.b = g.b; st.u = new Set();
        const pos = e.target.selectionStart; draw().then(() => { const n = box.querySelector('#td-n'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } });
      }, 350);
    };
    box.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { st.kind = b.dataset.kind; draw(); }));
    if ($('#td-d')) $('#td-d').oninput = (e) => (st.date = e.target.value);
    if ($('#td-s')) $('#td-s').onchange = (e) => { const c = parseChoice(e.target.value, books); st.subj = c.subj; st.b = c.b; st.u = new Set(); st.picked = true; draw(); };
    box.querySelectorAll('[data-u]').forEach((c) => (c.onchange = () => (c.checked ? st.u.add(c.dataset.u) : st.u.delete(c.dataset.u))));
    box.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { st.lang = b.dataset.lang; st.L = ''; draw(); }));
    if ($('#td-l')) $('#td-l').onchange = (e) => (st.L = e.target.value);
    box.querySelectorAll('[data-ps]').forEach((x) => (x.onchange = () => { const pt = st.parts[+x.dataset.ps]; const c = parseChoice(x.value, books); pt.subj = c.subj; pt.b = c.b || pickBook(books, c.subj); }));
    box.querySelectorAll('[data-pd]').forEach((x) => (x.oninput = () => (st.parts[+x.dataset.pd].date = x.value)));
    box.querySelectorAll('[data-px]').forEach((x) => (x.onclick = () => { st.parts.splice(+x.dataset.px, 1); draw(); }));
    if ($('#td-addp')) $('#td-addp').onclick = () => { const last = st.parts[st.parts.length - 1]; st.parts.push({ id: uid(), subj: '', date: last ? last.date : wk, b: '' }); draw(); };
    $('#td-cancel').onclick = () => box.remove();
    const done = (msg) => { box.remove(); if (view.name === 'home') renderHome(); else if (view.name === 'progress') renderProgress(); if (msg) toast(msg); };
    $('#td-save').onclick = () => {
      const err = $('#td-err'); const name = st.name.trim().slice(0, 60);
      const past = (d) => !d || testLeft({ date: d }) < 0;
      const bad = !name ? SCH('Give it a name.', '請輸入名稱。')
        : st.kind === 'exam' ? (st.parts.some((pt) => !pt.subj) ? SCH('Choose a subject for each row.', '請為每一行選擇科目。') : st.parts.some((pt) => past(pt.date)) ? SCH('Pick dates from today on.', '請選擇今天或之後的日期。') : '')
        : past(st.date) ? SCH('Pick a date from today on.', '請選擇今天或之後的日期。')
        : st.kind === 'test' && !st.subj ? SCH('Choose the subject.', '請選擇科目。') : '';
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      const groups = (xs) => new Set(xs.map((x) => x.grp || x.id)).size;
      if (!edit && limitOf('sched') !== UNL && groups(upcomingTests()) >= limitOf('sched')) { box.remove(); return upsell('sched', 'limit'); }
      let others = (local.sched || []).filter((x) => x.id !== st.id && !(group && x.grp === edit.grp));
      let recs;
      if (st.kind === 'exam') {
        const grp = group ? edit.grp : uid();
        recs = st.parts.map((pt) => ({ id: pt.id, kind: 'test', grp, gname: name, name: `${name} · ${pt.b ? (dlgBooks.find((b) => b.id === pt.b) || {}).subject || tSubjName(pt.subj) : tSubjName(pt.subj)}`.slice(0, 60), date: pt.date, subj: pt.subj, b: pt.b || null, u: [], ...(typeof pt.score === 'number' ? { score: pt.score } : {}) }));
      } else if (st.kind === 'dict') recs = [{ id: st.id, kind: 'dict', name, date: st.date, subj: (DICT_LANGS.find((x) => x[0] === st.lang) || DICT_LANGS[0])[3], lang: st.lang, L: st.L || null }];
      else recs = [{ id: st.id, kind: 'test', name, date: st.date, subj: st.subj, b: st.b || null, u: [...st.u], ...(st.sname ? { sname: st.sname } : {}) }];
      if (edit && typeof edit.score === 'number' && !group) recs[0].score = edit.score;
      local.sched = [...others, ...recs].slice(-40);
      if (recs.some((r) => testLeft(r) <= 14)) local.mission = null; // rebuild today's mission so it includes the new test
      saveLocal();
      if (st.kind === 'dict' && !st.L) { box.remove(); toast(SCH('Saved. Now add the words for your dictation.', '已儲存。請加入默書詞語。')); return go({ name: 'dictation', id: 'new' }); }
      done(SCH(`Added. Today’s mission now gets you ready for ${name}.`, `已加入。今日任務會幫你準備「${name}」。`));
    };
    // delete sits at the top; a second tap confirms
    const del = $('#td-del'); if (del) del.onclick = () => {
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.lastChild.textContent = st.kind === 'exam' ? SCH('Tap again to delete all subjects', '再按一次刪除所有科目') : SCH('Tap again to delete', '再按一次刪除'); del.classList.add('sure'); return; }
      local.sched = (local.sched || []).filter((x) => x.id !== st.id && !(group && x.grp === edit.grp)); saveLocal();
      done(SCH(`Deleted ${st.kind === 'exam' ? st.name || 'the exams' : st.name || 'the test'}.`, `已刪除「${st.name}」。`));
    };
  };
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  draw(); document.body.appendChild(box);
}
// Today: a "School tests" section, and how-did-it-go for tests just passed.
async function schoolTestsHTML() {
  const up = upcomingTests().slice(0, 12);
  const steps = (await Promise.all(up.map(testStep))).filter(Boolean)
    .sort((a, b) => a.left - b.left || (a.ready ?? 101) - (b.ready ?? 101)); // same day (e.g. exams): weakest first
  const past = schoolTests().filter((x) => testLeft(x) < 0 && testLeft(x) >= -21 && x.score === undefined); // papers often come back 1-2 weeks later
  const rows = steps.map((p) => `<div class="stx ${p.left <= 1 ? 'soon' : ''}"><button class="stx-main" data-tedit="${esc(p.x.id)}" aria-label="${SCH('Edit', '修改')} ${esc(p.x.name)}">
      ${calTile(testDay(p.x), 'sm')}
      <span class="stx-t"><b data-raw>${esc(p.x.name)}</b><small>${leftText(p.left)} · <span data-raw>${esc(testScope(p))}</span></small></span>
      <span class="stx-r"><b>${p.ready == null ? '–' : p.ready + '%'}</b><small>${SCH('ready', '準備度')}</small></span></button></div>`).join('');
  const pastHTML = past.map((x) => `<div class="card stx-past" data-raw><span>${SCH(`How did <b>${esc(x.name)}</b> go?`, `「<b>${esc(x.name)}</b>」考得怎樣？`)}</span><button class="btn-sm primary stx-snap" data-snapscore="${esc(x.id)}">${SCH('Snap the marked paper', '拍下已批改的試卷')}</button><span class="stx-sc"><span class="muted" style="font-size:14px">${SCH('or type it:', '或輸入：')}</span><input class="input" type="number" min="0" max="100" inputmode="numeric" placeholder="%" data-score="${esc(x.id)}" aria-label="${SCH('Score in percent', '分數（百分比）')}"><button class="btn-sm" data-savescore="${esc(x.id)}">${SCH('Save', '儲存')}</button><button class="btn-sm quiet" data-skipscore="${esc(x.id)}">${SCH('Skip', '略過')}</button></span></div>`).join('');
  return { steps, pastHTML, html: `<section class="stack g10" aria-label="${SCH('School tests', '學校測驗')}">
      <div class="sect-head"><h2>${SCH('School tests', '學校測驗')}</h2><button class="btn-sm" id="addTest">+ ${SCH('Add a test', '加入測驗')}${locked('sched') ? ' 🔒' : ''}</button></div>
      ${past.map((x) => `<div class="card stx-past" data-raw><span>${SCH(`How did <b>${esc(x.name)}</b> go?`, `「<b>${esc(x.name)}</b>」考得怎樣？`)}</span><button class="btn-sm primary stx-snap" data-snapscore="${esc(x.id)}">${SCH('Snap the marked paper', '拍下已批改的試卷')}</button><span class="stx-sc"><span class="muted" style="font-size:14px">${SCH('or type it:', '或輸入：')}</span><input class="input" type="number" min="0" max="100" inputmode="numeric" placeholder="%" data-score="${esc(x.id)}" aria-label="${SCH('Score in percent', '分數（百分比）')}"><button class="btn-sm" data-savescore="${esc(x.id)}">${SCH('Save', '儲存')}</button><button class="btn-sm quiet" data-skipscore="${esc(x.id)}">${SCH('Skip', '略過')}</button></span></div>`).join('')}
      ${rows ? `<div class="card stx-list">${rows}</div>` : `<button class="weekstrip" id="addTest2"><span class="wt"><b>${SCH('Got a test coming up?', '快要測驗？')}</b><span>${SCH('Add it and Today’s plan will count down to it, day by day.', '加入後，今日計劃會每天幫你倒數準備。')}</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">+</span></button>`}
    </section>` };
}
function bindSchoolTests() {
  const add = () => testDialog();
  ['addTest', 'addTest2'].forEach((id) => { const b = document.getElementById(id); if (b) b.onclick = add; });
  $app.querySelectorAll('[data-tedit]').forEach((b) => (b.onclick = () => testDialog((local.sched || []).find((x) => x.id === b.dataset.tedit))));
  const setScore = (id, v) => { local.sched = (local.sched || []).map((x) => (x.id === id ? { ...x, score: v } : x)); saveLocal(); renderHome(); };
  $app.querySelectorAll('[data-savescore]').forEach((b) => (b.onclick = () => { const i = $app.querySelector(`[data-score="${b.dataset.savescore}"]`); const v = Math.max(0, Math.min(100, Math.round(Number(i.value)))); if (i.value === '' || !Number.isFinite(v)) return i.focus(); setScore(b.dataset.savescore, v); toast(SCH('Saved. Well done for getting it done!', '已儲存。辛苦了！')); }));
  $app.querySelectorAll('[data-skipscore]').forEach((b) => (b.onclick = () => setScore(b.dataset.skipscore, null)));
  // Snap the marked paper: the marks form reads it (and any other papers), saves it to School results, and the score fills in here.
  $app.querySelectorAll('[data-snapscore]').forEach((b) => (b.onclick = async () => {
    const x = (local.sched || []).find((t) => t.id === b.dataset.snapscore); if (!x) return;
    const M = await marksScreen(null, { snap: true });
    if (M) {
      const book = (await getBooks()).find((bk) => bk.id === x.b), sub = String((book && (book.subject + ' ' + book.title)) || '');
      const key = x.subj && x.subj !== 'other' ? x.subj : /english|英文/i.test(sub) ? 'eng' : /math|數學/i.test(sub) ? 'math' : /chinese|中文|中國語文/i.test(sub) ? 'chi' : /science|general studies|humanities|常識|科學|人文/i.test(sub) ? 'gs' : '';
      const v = key && M.s[key] !== undefined ? M.s[key] : Object.keys(M.s).length === 1 ? Object.values(M.s)[0] : null;
      local.sched = (local.sched || []).map((t) => (t.id === x.id ? { ...t, score: v } : t)); saveLocal();
    }
    go({ name: 'home' });
  }));
}

/* ---------- level check: a short quiz across the book when it's new ----------
   About 2 multiple-choice questions from each of up to 6 chapters spread through the book. The result sets
   where each chapter's questions start (see levelShift) and suggests where to begin. */
const LV = (en, zh) => (LANG === 'zh' ? zh : en);
const bookAnswered = (bookId) => local.log.some((e) => e.q && e.q.startsWith(bookId + ':'));
function levelUnits(book) {
  const us = book.units;
  if (us.length <= 6) return us.slice();
  return [...new Set([0, 1, 2, 3, 4, 5].map((i) => Math.round(i * (us.length - 1) / 5)))].map((i) => us[i]);
}
async function startProgressCheck(book) {
  const pl = (local.placement || {})[book.id]; if (!pl) return startPlacement(book);
  const units = book.units.filter((u) => pl.u && pl.u[u.id]);
  if (!units.length) return startPlacement(book);
  const count = Math.max(6, Math.min(12, units.length * 2));
  await startUnits(book, units, count, { types: 'mcq', diff: 'auto', pcheck: true, title: LV('Progress check', '進度檢查') });
}
async function startPlacement(book) {
  const units = levelUnits(book);
  const count = Math.max(6, Math.min(12, units.length * 2));
  await startUnits(book, units, count, { types: 'mcq', diff: 'auto', placement: true, title: LV('Level check', '程度評估') });
}
function renderPlacementResult() {
  stopTimer();
  const qs = S.qs.slice(0, Math.max(S.i + 1, 0)), book = S.book;
  const per = {};
  qs.forEach((q, k) => { const u = qUnit(q.id)[1]; const r = per[u] || (per[u] = [0, 0]); r[0] += S.got[k] || 0; r[1] += marksOf(q); });
  if (!S.recorded) {
    S.recorded = true;
    local.placement = { ...(local.placement || {}), [book.id]: { t: Date.now(), u: per, q: qs.map((q) => q.id) } }; saveLocal();
    if (starsOn()) addStars(2, 'level check');
  }
  const g = qs.reduce((a, q, k) => a + (S.got[k] || 0), 0), m = qs.reduce((a, q) => a + marksOf(q), 0);
  const rows = S.units.filter((u) => per[u.id]).map((u) => {
    const [gu, mu] = per[u.id], a = mu ? gu / mu : 0;
    const st = a >= 0.99 ? ['strong', LV('Strong', '掌握得好'), LV('Harder questions from the start', '一開始就出較難的題目')]
      : a >= 0.4 ? ['ok', LV('Some gaps', '有些地方未掌握'), LV('Practice will fill the gaps', '多練習就能補上')]
      : ['weak', LV('Start here', '從這裏開始'), LV('A lesson first, then the basics', '先上一課，再由基礎題開始')];
    return { u, a, st, gu, mu };
  });
  const weak = rows.filter((r) => r.st[0] === 'weak');
  const first = (weak[0] || rows.slice().sort((x, y) => x.a - y.a)[0] || {}).u;
  $app.innerHTML = `
  <div class="topbar"><span style="font-weight:600;font-size:16px;padding-left:4px">${LV('Level check', '程度評估')}</span></div>
  <main class="pad stack g18 plres" data-view="placement" style="flex:1">
    <section class="pl-hero">${buddySVG('done', 72)}<div><h1>${LV('Here’s your starting point', '這是你的起點')}</h1>
      <p>${LV(`You got ${g} of ${m}. From now on, each chapter’s questions start at the right level for you.`, `你答對了 ${g}／${m} 題。之後每一章的題目都會由適合你的程度開始。`)}</p></div></section>
    <section class="card pl-list">${rows.map((r) => `<div class="pl-row ${r.st[0]}"><span class="pl-dot" aria-hidden="true"></span><span class="pl-t"><b data-raw>${esc(cleanUnitTitle(r.u.title))}</b><small>${r.st[2]}</small></span><span class="pl-chip">${r.st[1]}</span><span class="pl-s">${r.gu}/${r.mu}</span></div>`).join('')}</section>
    ${first ? `<section class="card pl-next"><h2>${LV('Where to begin', '建議由這裏開始')}</h2><p data-raw><b>${esc(cleanUnitTitle(first.title))}</b></p>
      <div class="rd-row"><button class="btn" id="plLearn">${LV('Learn it first', '先上一課')}</button><button class="btn ghost" id="plPrac">${LV('Practise it', '直接練習')}</button></div></section>` : ''}
    <button class="btn ghost" id="plBook">${LV('Back to the book', '返回課本')}</button>
    <p class="hint" style="margin:0;text-align:center">${LV('Only a few questions per chapter, so it’s a rough guide. It gets more accurate as you practise.', '每章只有幾題，所以只是大概的參考，練習越多會越準確。')}</p>
  </main>`;
  const bk = book;
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on('plLearn', () => go({ name: 'learn', bookId: bk.id, unitId: first.id }));
  on('plPrac', () => { pick = { bookId: bk.id, ids: new Set([first.id]) }; startUnits(bk, [first], local.count || sessionSize()); });
  on('plBook', () => go({ name: 'book', bookId: bk.id }));
  window.scrollTo(0, 0);
}

// Order every question the session still needs, minus what's already being made for it.
function topUp(sess) {
  if (sess.mode === 'drill') return pumpDrills(sess);
  if (sess.fill) return pumpPaper(sess);
  if (!sess.units || sess.error) return;
  const coming = [...(sess.jobs || [])].filter((j) => !j.done).reduce((n, j) => n + Math.max(0, j.want - j.made), 0);
  let need = sess.target - sess.qs.length - coming;
  const spareN = sess.spared ? 0 : Math.max(1, Math.ceil(SPARE / sess.units.length));
  // no spares for a chapter whose bank still has a full session of unused questions (saves AI cost, and keeps
  // the hand-checked starter books from filling up with AI-written questions)
  const spareOf = (u) => (sess.bankLeft && (sess.bankLeft[u.id] || 0) >= Math.ceil((sess.count || sess.target) / sess.units.length) ? 0 : spareN);
  const spare = sess.units.reduce((n, u) => n + spareOf(u), 0);
  if (need <= 0 && !spare) return;
  // the bank covers this session: next session's questions are written once they're halfway through, not
  // the moment they start (a child who stops after two questions shouldn't cost a batch of AI questions)
  if (need <= 0 && (sess.i || 0) < Math.floor(sess.target / 2)) return;
  need = Math.max(0, need);
  sess.spared = true;
  // spread across the chosen chapters, starting with the ones that have given fewest questions so far
  const used = (u) => sess.qs.filter((q) => q.id.startsWith(`${sess.book.id}:${u.id}:`)).length;
  const order = [...sess.units].sort((a, b) => used(a) - used(b));
  const per = Math.ceil(need / order.length);
  let left = need;
  for (const u of order) {
    const want = Math.min(per, left); left -= want;
    const spare = spareOf(u);
    if (want + spare <= 0) continue;
    // a job already making questions for this session keeps what it still owes, plus the new ones
    const j = jobs.get(`${sess.book.id}:${u.id}:${sess.types}${sess.diff && sess.diff !== 'auto' ? ':' + sess.diff : ''}`);
    const owed = j && sess.jobs && sess.jobs.has(j) ? Math.max(0, j.want - j.made) : 0;
    followFill(sess, ensureFill(sess.book, u, owed + want + spare, sess.types, MAKE_PAR, true, sess.diff));
  }
}

/* ---------- mistake book (錯題簿) ---------- */
// Mistakes from textbooks that were removed are dropped (older versions kept them, so the count stayed).
async function pruneMistakes(books) {
  const ids = new Set(books.map((b) => b.id)), qsOf = new Map(); let n = 0;
  for (const k of Object.keys(local.mistakes || {})) {
    const [b, u] = qUnit(k);
    if (!ids.has(k.split(':')[0])) { delete local.mistakes[k]; n++; continue; }
    // the question itself is gone (reported, or the chapter was re-made): it can never be shown, so don't count it
    const key = `${b}:${u}`;
    if (!qsOf.has(key)) qsOf.set(key, await getQs(b, u));
    const qs = qsOf.get(key);
    if (!qs.some((q) => q.id === k)) { delete local.mistakes[k]; n++; }
  }
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
  const missed = m.done ? '' : `<div class="mk-missed ${m.n > 1 ? 'often' : ''}"><b>${LANG === 'zh' ? (m.n > 1 ? `錯了 ${m.n} 次` : '錯了 1 次') : m.n > 1 ? `Missed ${m.n} times` : 'Missed once'}<em> · ${esc(agoText(m.t))}</em></b><span>${LANG === 'zh' ? '答對之前，Buddy 會不時再出這題。' : 'Buddy brings it back until you get it right.'}</span></div>`;
  return `<div class="mcard" data-raw>
    ${missed}${figHTML(q)}${renderStem(q.type === 'graph' || choiceType(q) ? q.stem : writtenStem(q), 'stem')}
    ${!choiceType(q) ? q.parts.map((p) => `<p class="mprompt">${esc(p.label)} ${esc(p.prompt)}</p>`).join('') : ''}
    <div class="mrow bad"><span>${LANG === 'zh' ? '你的答案' : 'Your answer'}</span><p class="nomath">${esc(yours)}</p></div>
    ${right ? `<div class="mrow good"><span>${LANG === 'zh' ? '答案' : 'Answer'}</span><p>${esc(right)}</p></div>` : ''}
    <p class="expl">${esc(q.explanation || '')}</p>
    ${m.chat && m.chat.length ? `<details class="mchat"><summary>${LANG === 'zh' ? '你和 AI 導師的對話' : 'Your chat with the tutor'} (${m.chat.length})</summary>${m.chat.map((x) => x.role === 'user' ? `<div class="tmsg me nomath">${esc(x.text)}</div>` : `<div class="tmsg ai">${tutorMd(x.text)}</div>`).join('')}</details>` : ''}
    ${m.done ? '' : `<div class="mfoot"><button class="btn-sm primary" data-redo1="${esc(q.id)}">${LANG === 'zh' ? '再試這一題' : 'Try it again'}</button></div><div class="mk-rbox"><button class="mk-rm" data-mkreport="${esc(q.id)}">${LANG === 'zh' ? '這題有問題？' : 'Something wrong with this question?'}</button></div>`}
  </div>`;
}
async function renderMistakes(tab, openBook) {
  // Filter by textbook (remembered). Only shown when mistakes come from more than one book.
  const books = await getBooks();
  await pruneMistakes(books);
  const entries = Object.entries(local.mistakes || {});
  const bookIds = [...new Set(entries.map(([id]) => id.split(':')[0]))].filter((id) => books.some((b) => b.id === id));
  const only = 'all'; // subjects are now cards on the page itself
  const inBook = ([id]) => only === 'all' || id.startsWith(only + ':');
  const groups = (await mistakeItems(tab === 'done')).filter((g) => only === 'all' || g.book.id === only);
  const todo = entries.filter((e) => inBook(e) && !e[1].done).length, done = entries.filter((e) => inBook(e) && e[1].done).length;
  const chips = bookIds.length >= 2 ? `<div class="bookchips" role="tablist" aria-label="Textbook">${[['all', LANG === 'zh' ? '全部' : 'All'], ...bookIds.map((id) => { const b = books.find((x) => x.id === id); const same = bookIds.filter((x) => { const o = books.find((y) => y.id === x); return (o.subject || o.title) === (b.subject || b.title); }).length > 1; return [id, same ? b.title : (b.subject ? subj(b.subject) : b.title)]; })]
    .map(([id, name]) => { const n = entries.filter(([q, m]) => !m.done && (id === 'all' || q.startsWith(id + ':'))).length; return `<button role="tab" class="${only === id ? 'on' : ''}" data-mkbook="${esc(id)}"><span ${id === 'all' ? '' : 'data-raw'}>${esc(name)}</span>${n ? ` <b>${n}</b>` : ''}</button>`; }).join('')}</div>` : '';
  const all = groups.flatMap((g) => g.items.map((x) => x.q));
  const zh = LANG === 'zh';
  const weekAgo = Date.now() - 7 * 864e5;
  const fixedWeek = entries.filter((e) => inBook(e) && e[1].done && (e[1].doneAt || 0) > weekAgo && !e[1].manual).length;
  // A question is listed as one short line; tap it to see your answer, the right answer and the explanation.
  const line = (x) => {
    const q = x.q, m = x.m;
    const ask = choiceType(q) ? q.stem : [writtenStem(q), ...(q.parts || []).map((p) => p.prompt).filter((t) => !GENERIC_ASK.test(t || ''))].filter(Boolean).join(' ');
    return `<details class="mq ${m.n > 1 ? 'often' : ''}"><summary>
        <span class="mq-dot" aria-hidden="true"></span>
        <span class="mq-text" data-raw>${esc(String(ask || '').replace(/\s*\n+\s*/g, ' '))}</span>
        ${m.done ? `<span class="mq-meta"><span>${esc(agoText(m.doneAt || m.t))}</span></span>` : m.n > 1 ? `<span class="mq-pill">${zh ? `錯 ${m.n} 次` : `${m.n}×`}</span>` : ''}
        <span class="mq-chev" aria-hidden="true">›</span></summary>
      <div class="mq-body">${mistakeCard(q, m)}</div></details>`;
  };
  // Subjects first (one card each, no question text), then a subject's chapters, then a chapter's questions:
  // the page stays short however many books there are.
  const subjects = [];
  groups.forEach((g, gi) => { let s = subjects.find((x) => x.book.id === g.book.id); if (!s) subjects.push(s = { book: g.book, chs: [] }); s.chs.push({ g, gi }); });
  subjects.forEach((x) => { x.n = x.chs.reduce((t, c) => t + c.g.items.length, 0); x.often = x.chs.reduce((t, c) => t + c.g.items.filter((i) => i.m.n > 1).length, 0); x.chs.sort((p, q) => q.g.items.length - p.g.items.length); });
  subjects.sort((p, q) => q.n - p.n);
  const open = subjects.length === 1 ? subjects[0] : subjects.find((x) => x.book.id === openBook);
  const sname = (bk) => (bk.subject ? subj(bk.subject) : bk.title);
  const chRow = ({ g, gi }) => { const often = g.items.filter((i) => i.m.n > 1).length; return `<details class="mk-ch"><summary>
      <span class="mk-count ${tab === 'done' ? 'ok' : ''}">${g.items.length}</span>
      <span class="mk-gt"><b data-raw>${esc(g.unit ? shortTitle(g.unit.title) : '')}</b><span class="muted">${often ? `${often} ${zh ? '題錯了多次' : 'missed more than once'} · ` : ''}${zh ? '最近' : 'latest'} ${esc(agoText(Math.max(...g.items.map((i) => (tab === 'done' ? i.m.doneAt || i.m.t : i.m.t)))))}</span></span>
      <span class="mq-chev" aria-hidden="true">›</span></summary>
      <div class="mk-list">${g.items.map(line).join('')}${tab === 'todo' ? `<button class="btn mk-redo" data-redo="${gi}">${zh ? `重做這一章的 ${g.items.length} 題` : `Redo all ${g.items.length} in this chapter`}</button>` : ''}</div></details>`; };
  const mkBody = open
    ? `${subjects.length > 1 ? `<button class="mk-backsub" data-mkopen="">${ICON.back} ${zh ? '所有科目' : 'All subjects'}</button>` : ''}
      <section class="mk-sub-open"><div class="mk-ghead">${subjectTile(open.book.subject, 44, open.book.title)}<div class="mk-gt"><b data-raw>${esc(sname(open.book))}</b>${sname(open.book) !== open.book.title ? `<span class="muted" data-raw>${esc(open.book.title)}</span>` : ''}</div>
        ${tab === 'todo' && subjects.length > 1 ? `<button class="btn-sm" data-redobook="${esc(open.book.id)}">${zh ? `全部重做（${Math.min(open.n, 30)}）` : `Redo all ${Math.min(open.n, 30)}`}</button>` : ''}</div>
      <p class="mk-tip muted">${zh ? '按章節查看題目、你的答案和解釋。' : 'Tap a chapter to see the questions, your answer and the explanation.'}</p>
      <div class="mk-chs">${open.chs.map(chRow).join('')}</div></section>`
    : `<div class="mk-subs">${subjects.map((x) => `<button class="mk-sub" data-mkopen="${esc(x.book.id)}">
        <span class="mk-sub-top">${subjectTile(x.book.subject, 40, x.book.title)}<span class="mk-gt"><b data-raw>${esc(sname(x.book))}</b>${sname(x.book) !== x.book.title ? `<span class="muted" data-raw>${esc(x.book.title)}</span>` : ''}</span></span>
        <span class="mk-sub-n"><b class="${tab === 'done' ? 'ok' : ''}">${x.n}</b><span>${tab === 'done' ? (zh ? '已掌握' : 'mastered') : (zh ? '題待改正' : 'to get right')} · ${zh ? `${x.chs.length} 個章節` : `${x.chs.length} chapter${x.chs.length > 1 ? 's' : ''}`}</span></span>
        ${x.often && tab === 'todo' ? `<span class="mk-sub-often">${zh ? `${x.often} 題錯了多次` : `${x.often} missed more than once`}</span>` : ''}
        <span class="mk-sub-most muted" data-raw>${zh ? '最多：' : 'Most in: '}${esc(shortTitle((x.chs[0].g.unit || {}).title || ''))}</span>
        <span class="mk-sub-go">${zh ? '查看' : 'Open'} ›</span></button>`).join('')}</div>`;
  const SHOW = 4;
  $app.innerHTML = `
  <main class="pad stack g18 mkpage" data-view="mistakes" style="flex:1">
    ${tab === 'done' ? backTop({ name: 'mistakes', tab: 'todo', book: openBook }, 'Back') : backTop({ name: 'practice' }, 'Practice')}<h1 class="pagetitle">${tab === 'done' ? (zh ? '已掌握' : 'Mastered') : zh ? '錯題簿' : 'Mistake book'}</h1>
    ${tab === 'done' && done ? `<p class="muted mk-donesub">${zh ? `你已改正 ${done} 題。` : `${done} ${done === 1 ? 'question' : 'questions'} you got wrong, then got right.`}</p>` : ''}
    ${tab === 'todo' && todo ? `<section class="mk-hero">
      <div class="mk-hero-l">${buddySVG('happy', 64)}<div class="stack g6"><b class="mk-big">${todo} ${todo === 1 ? 'question' : 'questions'} to get right</b>
        <span class="muted">Get one right again and it moves to Mastered.${fixedWeek ? ` <b class="mk-win">${fixedWeek} fixed this week</b>` : ''}</span></div></div>
      <div class="mk-hero-r"><button class="btn" id="redoall">Redo all ${Math.min(all.length, 30)}</button>${all.length > 5 ? '<button class="btn ghost" id="quick5">Quick 5</button>' : ''}</div>
    </section>` : ''}
    ${groups.length ? mkBody : `<div class="card mk-empty">${buddySVG(tab === 'todo' ? 'done' : 'think', 72)}<div class="stack g6"><b>${tab === 'todo' ? 'Nothing to fix right now' : 'Nothing mastered yet'}</b><span class="muted">${tab === 'todo' ? 'Questions you get wrong are saved here automatically, so you can come back and get them right.' : 'Get a mistake right again and it moves here.'}</span></div></div>`}
    ${tab === 'todo' && done ? `<button class="mk-mastered" data-tab="done">${ICON.check}<span class="stack g2"><b>${zh ? `已掌握 ${done} 題` : `Mastered · ${done}`}</b><span class="muted">${zh ? '看看你已改正的題目' : 'Questions you’ve fixed'}</span></span><span class="mk-sub-go">›</span></button>` : ''}
  </main>`;

  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go({ name: 'mistakes', tab: b.dataset.tab, book: openBook })));
  $app.querySelectorAll('[data-mkbook]').forEach((b) => (b.onclick = () => { local.mkBook = b.dataset.mkbook; saveLocal(); renderMistakes(tab); }));
  const start = (qs, title) => { S = newSession({ mode: 'mistakes', title, qs: shuffle(qs).slice(0, 30).map(shuffleOptions), target: Math.min(qs.length, 30) }); renderQuestion(); };
  const bookName = only === 'all' ? '' : ` · ${subj((books.find((b) => b.id === only) || {}).subject || '')}`;
  const ra = document.getElementById('redoall'); if (ra) ra.onclick = () => start(all, (zh ? '錯題簿' : 'Mistake book') + bookName);
  // Quick 5: the ones missed most often, then the oldest
  const q5 = document.getElementById('quick5'); if (q5) q5.onclick = () => {
    const ranked = groups.flatMap((g) => g.items).sort((a, b) => (b.m.n - a.m.n) || (a.m.t - b.m.t)).slice(0, 5).map((x) => x.q);
    S = newSession({ mode: 'mistakes', title: (zh ? '錯題簿 · 快速 5 題' : 'Mistake book · Quick 5') + bookName, qs: ranked.map(shuffleOptions), target: ranked.length }); renderQuestion();
  };
  $app.querySelectorAll('[data-redo]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const g = groups[+b.dataset.redo]; start(g.items.map((x) => x.q), g.unit ? g.unit.title : 'Mistake book'); }));
  $app.querySelectorAll('[data-mkopen]').forEach((b) => (b.onclick = () => go({ name: 'mistakes', tab, book: b.dataset.mkopen || undefined })));
  $app.querySelectorAll('[data-redobook]').forEach((b) => (b.onclick = () => { const x = subjects.find((y) => y.book.id === b.dataset.redobook); start(x.chs.flatMap((c) => c.g.items.map((i) => i.q)), (zh ? '錯題簿 · ' : 'Mistake book · ') + sname(x.book)); }));
  $app.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => { const box = b.previousElementSibling; box.hidden = false; b.remove(); }));
  $app.querySelectorAll('[data-redo1]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const q = all.find((x) => x.id === b.dataset.redo1); if (q) start([q], zh ? '錯題簿' : 'Mistake book'); }));
  $app.querySelectorAll('[data-mkreport]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.mkreport, box = b.parentElement, g = groups.find((x) => x.items.some((y) => y.q.id === id)); if (!g) return;
    const q = g.items.find((y) => y.q.id === id).q, m = local.mistakes[id] || {}; let reason = '';
    box.innerHTML = `<div class="rform"><b>${zh ? '這題有甚麼問題？' : 'What’s wrong with this question?'}</b>
      <div class="rreasons" role="radiogroup">${REPORT_REASONS.map(([k, t]) => `<button type="button" role="radio" aria-checked="false" data-reason="${k}">${t}</button>`).join('')}</div>
      <textarea class="input mk-rnote" rows="2" maxlength="1000" placeholder="${zh ? '補充（可選）' : 'Tell us more (optional)'}"></textarea>
      <p class="muted" style="font-size:13px;margin:0">${zh ? '送出後，這題會從錯題簿移除，你不會再見到它。' : 'Once sent, it comes off your Mistake book and you won’t see it again.'}</p>
      <div class="rbtns"><button class="btn ghost" data-rc>${zh ? '取消' : 'Cancel'}</button><button class="btn" data-rs disabled>${zh ? '送出' : 'Send report'}</button></div></div>`;
    box.querySelectorAll('[data-reason]').forEach((r) => (r.onclick = () => { reason = r.dataset.reason; box.querySelectorAll('[data-reason]').forEach((x) => x.setAttribute('aria-checked', String(x === r))); box.querySelector('[data-rs]').disabled = false; }));
    box.querySelector('[data-rc]').onclick = () => { const y = window.scrollY; renderMistakes(tab).then(() => window.scrollTo(0, y)); };
    box.querySelector('[data-rs]').onclick = async () => {
      const s2 = box.querySelector('[data-rs]'); s2.disabled = true; s2.textContent = zh ? '送出中…' : 'Sending…';
      await sendReport({ reason, note: box.querySelector('.mk-rnote').value.trim(), lang: LANG, from: 'mistakes', book: { id: g.book.id, title: g.book.title, library: g.book.library, code: g.book.code }, unit: { id: g.unit && g.unit.id, title: g.unit && g.unit.title }, q, answer: m.ansText || (Array.isArray(m.ans) ? m.ans.join('\n') : String(m.ans || '')) });
      local.reports = local.reports || []; if (!local.reports.includes(id)) local.reports.push(id);
      delete local.mistakes[id]; saveLocal();
      box.innerHTML = `<p class="rdone">${ICON.check} ${zh ? '謝謝，已交給 PrepBuddy 團隊檢查。' : 'Thanks. The PrepBuddy team will check it.'}</p>`;
      setTimeout(() => { const y = window.scrollY; renderMistakes(tab).then(() => window.scrollTo(0, y)); }, 1600);
    };
  }));
}
function agoText(t) {
  const d = Math.floor((Date.now() - (t || 0)) / 864e5), zh = LANG === 'zh';
  if (d <= 0) return zh ? '今天' : 'Today';
  if (d === 1) return zh ? '昨天' : 'Yesterday';
  if (d < 7) return zh ? `${d} 天前` : `${d} days ago`;
  if (d < 30) { const w = Math.floor(d / 7); return zh ? `${w} 星期前` : `${w} week${w > 1 ? 's' : ''} ago`; }
  const mo = Math.floor(d / 30); return zh ? `${mo} 個月前` : `${mo} month${mo > 1 ? 's' : ''} ago`;
}

/* ---------- 呈分試 sprint (P5-P6, when the parent picked it as a goal) ----------
   A timed paper across the child's Chinese, English and Maths books: mostly the questions they found hardest,
   topped up with ones they haven't tried, easiest first, like a school exam. */
const ssaOn = () => inHK() && /^P[56]$/.test(gradeNow() || '') && ((local.learner && local.learner.goals) || []).includes('ssa');
const SSA_SUBJ = /chinese|中文|中國語文|english|英文|英國語文|math|數學|数学/i;
async function startSprint() {
  const all = (await allQuestions()).filter((x) => SSA_SUBJ.test(String(x.book.subject || '') + ' ' + x.book.title));
  if (all.length < 6) return toast(LANG === 'zh' ? '先加入中文、英文或數學課本，並練習幾個章節。' : 'Add your Chinese, English or Maths books and practise a few chapters first.');
  const tried = all.filter((x) => local.stats[x.q.id]).sort((a, b) => local.stats[a.q.id].last - local.stats[b.q.id].last);
  const weak = tried.filter((x) => isWeak(x.q)).slice(0, 10);
  const fresh = shuffle(all.filter((x) => !local.stats[x.q.id]));
  const rest = shuffle(tried.filter((x) => !isWeak(x.q)));
  const seen = new Set(), pick = [];
  for (const x of [...weak, ...fresh, ...rest]) { if (pick.length >= 15) break; if (!seen.has(x.q.id)) { seen.add(x.q.id); pick.push(x); } }
  const qs = pick.map((x) => shuffleOptions(x.q)).sort((a, b) => a.level - b.level);
  const subs = [...new Set(pick.map((x) => subj(x.book.subject || '')).filter(Boolean))].join(', ');
  const mm = await askTime('呈分試 sprint', LANG === 'zh' ? `${qs.length} 題，來自${subs}，以弱項為主。` : `${qs.length} questions from ${subs}, mostly your weak spots.`, 30);
  if (mm === null) return;
  S = newSession({ mode: 'mock', title: '呈分試 sprint', qs, target: qs.length, deadline: mm ? Date.now() + mm * 60 * 1000 : null });
  renderQuestion();
}

/* ---------- listening practice ----------
   Buddy writes a short passage (sized by grade) and reads it aloud with the device voice, up to twice, as in the
   TSA and school listening papers. The child answers multiple-choice questions, then sees the answers and the script. */
const lnx = { lang: null, busy: '', error: null, item: null, picks: {}, plays: 0, done: false };
async function renderListening() {
  const x = lnx, it = x.item, L = (en, zh) => (it ? (it.lang === 'zh' ? zh : en) : SPK(en, zh));
  if (!window.speechSynthesis && TTS_OFF) { $app.innerHTML = `${backTop({ name: 'home' }, 'Today')}<main class="pad stack g18 wrpage" style="flex:1"><h1 class="pagetitle">${SPK('Listening practice', '聆聽練習')}</h1><p class="hw-err">${SPK('This browser can’t read aloud. Please use Chrome, Edge or Safari.', '這個瀏覽器不能朗讀，請使用 Chrome、Edge 或 Safari。')}</p></main>`; return; }
  const score = it && x.done ? it.questions.filter((q, i) => x.picks[i] === q.answer).length : 0;
  $app.innerHTML = `
  ${backTop({ name: 'home' }, 'Today')}
  <main class="pad stack g18 wrpage lnpage" data-view="listening" data-raw style="flex:1">
    <h1 class="pagetitle">${SPK('Listening practice', '聆聽練習')}</h1>
    ${!it ? `<section class="hw-hero">${buddySVG('listen', 56)}<div><b>${SPK('Listen carefully, then answer.', '留心聆聽，然後作答。')}</b>
      <span>${SPK('Like the school listening test: Buddy reads a short passage aloud (you can hear it twice), then you answer the questions.', '就像學校的聆聽測驗：Buddy 會朗讀一段短文（可以聽兩次），然後你回答問題。')}</span></div></section>
    <section class="card wr-step"><h2 class="st-h">${SPK('Which language?', '哪一種語言？')}</h2>
      <div class="wr-kinds"><button class="wr-kind" data-ln="en"><b>English</b><span>${SPK('English listening', '英文聆聽')}</span></button><button class="wr-kind" data-ln="zh"><b>中文</b><span>${zhVoice() === 'cmn' ? SPK('Chinese listening (Putonghua voice)', '中文聆聽（普通話）') : SPK('Chinese listening (Cantonese voice)', '中文聆聽（廣東話）')}</span></button></div>
      ${x.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(x.busy)}</p>` : ''}
      ${x.error ? `<p class="hw-err" role="alert">${esc(x.error)}</p>` : ''}
    </section>` : `
    <section class="card ln-play">
      <div class="ln-ph">${buddySVG(x.done ? 'happy' : 'listen', 48)}<div><b>${esc(it.title)}</b><small>${x.done ? L('Here is what Buddy read.', '以下是 Buddy 讀的內容。') : L(`You can listen ${Math.max(0, 2 - x.plays)} more time${2 - x.plays === 1 ? '' : 's'}. Read the questions first.`, `你還可以聽 ${Math.max(0, 2 - x.plays)} 次。先看看問題。`)}</small></div></div>
      ${x.done ? `<div class="ln-script">${esc(it.passage).replace(/\n/g, '<br>')}</div><button class="btn-sm" id="lnAgain">🔊 ${L('Hear it again', '再聽一次')}</button>` : `<button class="btn" id="lnPlay" ${x.plays >= 2 ? 'disabled' : ''}>▶ ${x.plays ? L('Play again', '再播一次') : L('Play', '播放')}</button>`}
    </section>
    <section class="stack g14">${it.questions.map((q, i) => `<div class="card ln-q"><b>${i + 1}. ${esc(q.q)}</b><div class="stack g8">${q.options.map((o, j) => {
      const cls = x.done ? (j === q.answer ? 'right' : x.picks[i] === j ? 'wrong' : '') : x.picks[i] === j ? 'picked' : '';
      return `<button class="opt ${cls}" data-q="${i}" data-o="${j}" ${x.done ? 'disabled' : ''} aria-pressed="${x.picks[i] === j}"><span class="dot">${'ABCD'[j]}</span><span>${esc(o)}</span></button>`; }).join('')}</div>
      ${x.done && q.why ? `<p class="hint" style="margin:0">${esc(q.why)}</p>` : ''}</div>`).join('')}</section>
    ${x.done ? `<section class="card ln-score"><b>${score} / ${it.questions.length}</b><span>${score === it.questions.length ? L('All correct. Great listening!', '全部答對，聽得很仔細！') : L('Listen again to the parts you missed.', '再聽聽你答錯的部分。')}</span><button class="btn" id="lnNew">${L('Another one', '再做一份')}</button></section>`
      : `<button class="btn" id="lnCheck" ${Object.keys(x.picks).length < it.questions.length ? 'disabled' : ''}>${L('Check my answers', '核對答案')}</button>`}`}
  </main>`;
  $app.querySelectorAll('[data-ln]').forEach((b) => (b.onclick = async () => {
    if (x.busy) return;
    x.lang = b.dataset.ln; x.busy = SPK('Buddy is writing a passage…', 'Buddy 正在寫短文…'); x.error = null; renderListening();
    try { const r = await api('speaking', { step: 'listen', lang: x.lang }); delete r.usage; Object.assign(x, { item: r, picks: {}, plays: 0, done: false, busy: '' }); }
    catch (e) { x.busy = ''; x.error = wrErr(e); }
    if (view.name === 'listening') renderListening();
  }));
  const pl = document.getElementById('lnPlay'); if (pl) pl.onclick = () => { x.plays++; sayAloud(it.passage, it.lang === 'zh' ? 'zh' : 'en'); renderListening(); };
  const ag = document.getElementById('lnAgain'); if (ag) ag.onclick = () => sayAloud(it.passage, it.lang === 'zh' ? 'zh' : 'en');
  $app.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { x.picks[+b.dataset.q] = +b.dataset.o; renderListening(); }));
  const ck = document.getElementById('lnCheck'); if (ck) ck.onclick = () => {
    stopSaying();
    x.done = true; const n = it.questions.filter((q, i) => x.picks[i] === q.answer).length;
    local.ln = [...(local.ln || []), { t: Date.now(), lang: it.lang, title: it.title, score: n, of: it.questions.length }].slice(-30); saveLocal();
    if (n >= Math.ceil(it.questions.length / 2)) addStars(n === it.questions.length ? 2 : 1, 'listening');
    renderListening(); window.scrollTo(0, 0);
  };
  const nw = document.getElementById('lnNew'); if (nw) nw.onclick = () => { Object.assign(x, { item: null, picks: {}, plays: 0, done: false }); renderListening(); };
}

/* ---------- choose a textbook for weak topics / mock exam ---------- */
const isWeak = (q) => { const st = local.stats[q.id]; return !!st && st.last < 1; };
async function renderPick(mode) {
  const books = await getBooks();
  if (!books.length) return go({ name: 'home' });
  const weakMode = mode === 'weak';
  const items = await allQuestions();
  const inBook = (id) => items.filter((x) => !id || x.book.id === id);
  const weakIn = (id) => inBook(id).filter((x) => isWeak(x.q)).length;
  const triedIn = (id) => inBook(id).filter((x) => local.stats[x.q.id]).length;
  // Same rules as startReview: weak topics need a few answered questions to pick from.
  const ready = (id) => !weakMode || (inBook(id).length >= 4 && triedIn(id) >= 3);
  const row = (id, title, sub, ok, subject, name) => `<button class="row pickrow" ${ok ? `data-pick="${esc(id)}"` : 'disabled aria-disabled="true"'}>
      <div class="top"><span style="display:flex;gap:12px;align-items:center;min-width:0">${id ? subjectTile(subject, 40, name) : `<span class="stile" style="width:40px;height:40px;background:#EEF1FB">${menuIcon('books', true, 24)}</span>`}
        <span style="min-width:0"><b style="font-weight:600" ${id ? 'data-raw' : ''}>${esc(title)}</b><br><span class="muted" style="font-size:14px">${sub}</span></span></span>
      ${ok ? `<span class="go-arrow" aria-hidden="true">›</span>` : ''}</div></button>`;
  const rows = books.map((b) => {
    if (!weakMode) return row(b.id, b.title, `${b.units.length} chapter${b.units.length === 1 ? '' : 's'}`, true, b.subject, b.title);
    const n = weakIn(b.id), ok = ready(b.id);
    return row(b.id, b.title, ok ? (n ? `${n} question${n === 1 ? '' : 's'} to work on` : 'Questions you found hardest so far') : 'Answer a few questions first', ok, b.subject, b.title);
  });
  if (weakMode && books.length > 1) {
    const n = weakIn(''), ok = ready('');
    rows.unshift(row('', 'All my textbooks', ok ? `${n} question${n === 1 ? '' : 's'} to work on` : 'Answer a few questions first', ok));
  }
  const anyReady = !weakMode || books.some((b) => ready(b.id)) || ready('');
  const title = weakMode ? 'Weak topics' : 'Mock exam';
  const intro = weakMode
    ? `The questions you didn’t get fully right, mixed together so you can fix them.${anyReady ? ' Choose a textbook.' : ''}`
    : 'A DSE-style paper: Section A multiple choice, then Section B written questions, timed. Choose a textbook, then the chapters and length.';
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button></div>
  <main class="pad stack g18 pickpage" style="flex:1">
    <div class="pick-head">${actionTile(weakMode ? 'weak' : 'mock', 52)}<div class="stack g6"><h1 class="pagetitle" style="margin:0">${title}</h1><p class="muted" style="margin:0;line-height:1.5;font-size:16px">${intro}</p></div></div>
    ${anyReady ? `<div class="card stack">${rows.join('')}</div>` : `<div class="card pick-empty">
      ${buddySVG('think', 84)}
      <div class="stack g6"><b style="font-size:18px">No weak topics yet</b><span class="muted" style="line-height:1.5">As you practise, the questions you find hard collect here so you can come back and fix them.</span></div>
      <button class="btn" id="practise" style="width:auto;padding:12px 22px">Practise a chapter</button></div>`}
  </main>`;
  document.getElementById('back').onclick = () => goBack({ name: 'home' });
  const pr = document.getElementById('practise'); if (pr) pr.onclick = () => go({ name: 'books' });
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => (weakMode
    ? startReview('weak', b.dataset.pick || null)
    : go({ name: 'paper', bookId: b.dataset.pick, from: 'pick' }))));
}

async function startReview(mode, bookId = null, cap = 15) {
  if (mode === 'ssa') return startSprint();
  const items = (await allQuestions()).filter((x) => !bookId || x.book.id === bookId);
  if (items.length < 4) return toast('Practise a chapter first, then come back here.');
  let pick;
  if (mode === 'spaced') {
    pick = (await dueItems()).slice(0, cap).map((x) => shuffleOptions(x.q));
    if (!pick.length) return toast('Nothing to review today.');
    S = newSession({ mode: 'spaced', title: LANG === 'zh' ? '溫習' : 'Reviews', qs: shuffle(pick), target: pick.length });
    return renderQuestion();
  }
  if (mode === 'weak') {
    const tried = items.filter((x) => local.stats[x.q.id]);
    if (tried.length < 3) return toast('Answer a few questions first, so PrepBuddy knows your weak spots.');
    pick = shuffle(tried).sort((a, b) => local.stats[a.q.id].last - local.stats[b.q.id].last).slice(0, sessionSize()).map((x) => shuffleOptions(x.q));
    const book = bookId && items[0] && items[0].book;
    S = newSession({ mode: 'weak', title: book ? `${LANG === 'zh' ? '弱項' : 'Weak topics'} · ${book.subject ? subj(book.subject) : book.title}` : (LANG === 'zh' ? '弱項' : 'Weak topics'), qs: pick, target: pick.length });
  } else {
    pick = shuffle(items).slice(0, 12).map((x) => x.q).sort((a, b) => a.level - b.level);
    const mm = await askTime('Mini mock', `${pick.length} questions from your textbooks.`, 20);
    if (mm === null) return;
    S = newSession({ mode: 'mock', title: 'Mini mock', qs: pick, target: pick.length, deadline: mm ? Date.now() + mm * 60 * 1000 : null });
  }
  renderQuestion();
}

/* ---------- making questions on demand ---------- */
// One background job per chapter. Several batches run side by side, each on a different
// part of the chapter, so 10 questions take about as long as 3 used to.
const jobs = new Map();
const warmed = new Map(); // chapter -> when its text was last put in the AI's cache
const PARALLEL = 3;

function ensureFill(book, unit, want, types = 'mix', par = PARALLEL, adapt = false, diff = 'auto') {
  if (!DIFF_RANGE[diff]) diff = 'auto';
  const key = `${book.id}:${unit.id}:${types}${diff === 'auto' ? '' : ':' + diff}`;
  if (jobs.has(key)) { const j = jobs.get(key); j.want = Math.max(j.want, j.made + want); j.par = Math.max(j.par, par); if (j.spawn) j.spawn(); return j; }
  const kp = KIND_PLANS[kindOfBook(book)];
  const job = { want, made: 0, error: null, done: false, listeners: new Set(), plan: gradePlan((kp && kp[types]) || PLANS[types] || PLAN, types), par, adapt, diff };
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
      const R = DIFF_RANGE[job.diff];
      const items = Array.from({ length: BATCH }, (_, k) => job.plan[(slot + k) % job.plan.length]).map(([level, type]) => ({ level: R ? Math.max(R[0], Math.min(R[1], level)) : type === 'essay' ? level : shiftLevel(level, d), type }));
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
      try { gen = await api('generate', { title, text, items, avoid, focus, kind: kindOfBook(book), bookLevel: (book && book.level) || '', lang: langOf(text), figures: pages ? pages.map((f) => f.img.split(',')[1]) : undefined, figureRegions: pages ? pages.map((f) => f.rects || []) : undefined }); }
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
      // Each question is checked on its own and joins the bank (and the session) the moment it passes,
      // rather than waiting for the slowest check in the batch.
      let ok = 0;
      await Promise.all(gen.questions.map(async (q) => {
        let v;
        try { v = await api('verify', { title, text, question: qForServer(q), figure: figB64(q) }); }
        catch (e) { if (e.status === 401) { stop = true; throw e; } return; }
        if (!v.passed || !usable(q)) return;
        q.id = `${book.id}:${unit.id}:${uid()}`;
        q.section = title;
        q.pages = unit.startPage ? `${unit.startPage}-${unit.endPage}` : '';
        ok++;
        await addToBank(book.id, unit.id, [q]);
        job.made++;
        local.usage.made = (local.usage.made || 0) + 1; saveLocal();
        job.listeners.forEach((f) => f([q], false));
      }));
      if (!ok) continue;
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
  sess.jobs = sess.jobs || new Set();
  if (sess.jobs.has(job)) return;
  sess.jobs.add(job);
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
      sess.pending--; sess.jobs.delete(job);
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
    // At the start of a session the student is reading a card: offer a Start button instead of jumping away.
    if (S.i < S.qs.length && !S.holdStart) { S.waiting = false; renderQuestion(); }
    else if (done && S.i >= S.qs.length && !S.generating) renderWaiting();
    else paintWait();
  } else {
    const c = document.getElementById('count'); if (c) c.textContent = `${S.i + 1} / ${S.target}`;
  }
}

// If the student catches up with the AI, they get a question from these chapters they've done before
// (ones they got wrong first) instead of a spinner. It counts as one of the session's questions.
const MAX_RECAPS = 3;
async function recapFor(sess) {
  const have = new Set(sess.qs.map((q) => q.id));
  const all = (await Promise.all(sess.units.map((u) => getQs(sess.book.id, u.id)))).flat()
    .filter((q) => local.stats[q.id] && !have.has(q.id) && matchType(q, sess.types));
  if (!all.length) return null;
  const rank = (q) => { const m = (local.mistakes || {})[q.id]; return m && !m.done ? 0 : isWeak(q) ? 1 : 2; };
  const best = Math.min(...all.map(rank));
  const pick = shuffle(all.filter((q) => rank(q) === best))[0];
  return { ...shuffleOptions(pick), recap: true };
}
function tryRecap() {
  const sess = S;
  if (!sess || sess.mode !== 'unit' || !sess.i || sess.review || sess.recapping || (sess.recaps || 0) >= MAX_RECAPS || !sess.generating) return;
  sess.recapping = true;
  recapFor(sess).then((q) => {
    sess.recapping = false;
    if (!q || sess !== S || !sess.waiting || sess.i < sess.qs.length || !sess.generating) return;
    sess.recaps = (sess.recaps || 0) + 1;
    sess.qs.splice(sess.i, 0, q);
    sess.waiting = false;
    renderQuestion();
  }).catch(() => { sess.recapping = false; });
}

/* While questions are being written the student reads short cards about the chapter (key terms, key
   ideas, exam tips, made once per chapter by the fast model) mixed with a little encouragement. */
const CHEERS = [
  ['Keep going', 'Getting a question wrong now is how you get it right in the exam. Every mistake is saved in your Mistake book.'],
  ['Little and often', 'Short, regular practice beats cramming the night before.'],
  ['Exam tip', 'Read every option before you choose. In DSE papers the wrong options are often almost right.'],
  ['Stuck?', 'Ask the tutor beside the question for a hint. Working it out yourself makes it stick.'],
];
const snipJobs = new Map();
function getSnippets(book, unit) {
  const key = `snips:${book.id}:${unit.id}`;
  if (snipJobs.has(key)) return snipJobs.get(key);
  const p = (async () => {
    const have = await store.get(key, null); if (have) return have;
    const notes = await store.get(`notes:${book.id}:${unit.id}`, null);
    if (notes && (notes.key_terms || []).length) {
      const fromNotes = [...notes.key_terms.slice(0, 3).map((k) => ({ kind: 'term', title: k.term, text: k.meaning })),
        ...(notes.sections || []).flatMap((x) => x.points.slice(0, 1).map((pt) => ({ kind: 'fact', title: x.heading, text: pt }))).slice(0, 3)];
      if (fromNotes.length >= 3) return fromNotes;
    }
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    if (!text) return [];
    const r = await api('snippets', { title: unit.title, text, lang: langOf(text) });
    const list = (r.snippets || []).filter((x) => x.title && x.text);
    if (list.length) await store.set(key, list);
    return list;
  })();
  snipJobs.set(key, p);
  p.catch(() => snipJobs.delete(key));
  return p;
}
const SNIP_LABEL = { term: 'Key term', fact: 'Key idea', tip: 'Exam tip', cheer: '' };
function waitCards(sess) {
  if (sess.cards) return sess.cards;
  const cheers = shuffle(CHEERS.map(([title, text]) => ({ kind: 'cheer', title, text })));
  sess.cards = [cheers[0]];
  sess.cardAt = 0;
  if (sess.book && sess.units) {
    Promise.all(sess.units.slice(0, 2).map((u) => getSnippets(sess.book, u).catch(() => []))).then((lists) => {
      const snips = shuffle(lists.flat());
      const mixed = [];
      snips.forEach((x, k) => { mixed.push(x); if (k % 3 === 2 && cheers[1 + Math.floor(k / 3)]) mixed.push(cheers[1 + Math.floor(k / 3)]); });
      if (!snips.length) mixed.push(...cheers.slice(1));
      sess.cards = [sess.cards[sess.cardAt] || cheers[0], ...mixed];
      sess.cardAt = 0;
      if (sess === S && S.waiting) paintCard();
      if (sess.onCards) sess.onCards();
    });
  } else sess.cards = cheers;
  return sess.cards;
}
// The same quick-look cards (key terms, key ideas, exam tips and Buddy's cheers) for any other wait:
// a lesson, revision notes or flashcards being made. Shown only if the wait lasts; turns every 10 s unless touched.
function mountWaitCards(slot, book, units, delay = 700) {
  const st = { book, units, cardAt: 0 };
  let timer = null, stopped = false;
  const paint = () => {
    if (stopped || !slot.isConnected) return stop();
    const cards = waitCards(st), c = cards[st.cardAt % cards.length];
    slot.innerHTML = `<div class="card wcard k-${c.kind}"><div class="wcard-top">${c.kind === 'cheer' ? `<span class="wbuddy" aria-hidden="true">${buddySVG('happy', 30)}</span>` : `<span class="wk">${SNIP_LABEL[c.kind]}</span>`}
      ${cards.length > 1 ? `<span class="wdots" aria-hidden="true">${cards.map((_, k) => `<i class="${k === st.cardAt % cards.length ? 'on' : ''}"></i>`).join('')}</span>` : ''}</div>
      <b class="wtitle" ${c.kind === 'cheer' ? '' : 'data-raw'}>${esc(c.title)}</b><p class="wtext" ${c.kind === 'cheer' ? '' : 'data-raw'}>${esc(c.text)}</p>
      ${cards.length > 1 ? `<button class="btn-sm quiet wnext" type="button">Next card ›</button>` : ''}</div>`;
    const n = slot.querySelector('.wnext'); if (n) n.onclick = (e) => { e.stopPropagation(); st.touch = Date.now(); st.cardAt++; paint(); };
    slot.firstElementChild.onclick = () => { st.touch = Date.now(); };
  };
  const stop = () => { stopped = true; clearTimeout(st.startT); clearInterval(timer); };
  st.onCards = () => { if (!stopped && slot.innerHTML) paint(); };
  st.startT = setTimeout(() => {
    if (stopped || !slot.isConnected) return stop();
    slot.hidden = false; paint();
    timer = setInterval(() => { if (!slot.isConnected) return stop(); if (Date.now() - (st.touch || 0) > 15000) { st.cardAt++; paint(); } }, 10000);
  }, delay);
  return () => { stop(); slot.hidden = true; slot.innerHTML = ''; };
}
function paintCard() {
  const box = document.getElementById('wcard'); if (!box || !S) return;
  const cards = waitCards(S), c = cards[S.cardAt % cards.length];
  box.className = `card wcard k-${c.kind}`;
  box.innerHTML = `<div class="wcard-top">${c.kind === 'cheer' ? `<span class="wbuddy" aria-hidden="true">${buddySVG('happy', 30)}</span>` : `<span class="wk">${SNIP_LABEL[c.kind]}</span>`}
      ${cards.length > 1 ? `<span class="wdots" aria-hidden="true">${cards.map((_, k) => `<i class="${k === S.cardAt % cards.length ? 'on' : ''}"></i>`).join('')}</span>` : ''}</div>
    <b class="wtitle" ${c.kind === 'cheer' ? '' : 'data-raw'}>${esc(c.title)}</b>
    <p class="wtext" ${c.kind === 'cheer' ? '' : 'data-raw'}>${esc(c.text)}</p>
    ${cards.length > 1 ? `<button class="btn-sm quiet wnext" id="wnext">Next card ›</button>` : ''}`;
  const n = document.getElementById('wnext');
  if (n) n.onclick = () => { S.cardAt++; S.cardTick = Date.now(); paintCard(); };
  box.onclick = () => readingNow();
}
// Any touch on the card means the student is reading: stop the auto-start and let them press Start.
function readingNow() {
  if (!S) return;
  S.readAt = Date.now();
  if (S.countdown) { clearInterval(S.countdown); S.countdown = null; S.autoOff = true; const b = document.getElementById('startnow'); if (b) b.innerHTML = 'Start practising <span aria-hidden="true">→</span>'; }
}
const WAIT_STEPS = ['Reading your textbook…', 'Picking an important idea…', 'Writing a question…', 'Checking the answer is right…', 'Making sure it’s clear…', 'Almost there…'];
function paintWait() {
  if (!S || !document.getElementById('wcard')) return renderWaiting();
  const ready = Math.min(S.target, S.qs.length), go = S.holdStart && S.i < S.qs.length;
  const bar = document.getElementById('wbar'); if (bar) bar.style.width = `${Math.round(100 * ready / Math.max(1, S.target))}%`;
  { const pr = document.getElementById('wprog'); if (pr) pr.classList.toggle('busy', !go); }
  if (go) {
    const wb = document.getElementById('wbud');
    if (wb && !wb.classList.contains('ready')) { wb.classList.add('ready'); const f = document.getElementById('wbudFace'); if (f) f.innerHTML = buddySVG('done', 92); }
    const st = document.getElementById('wstat'); if (st) { st.dataset.done = '1'; st.textContent = 'Ready when you are!'; }
  }
  const r = document.getElementById('wready'); if (r) r.textContent = S.holdStart ? `${ready} of ${S.target} ready` : 'Checking your next question';
  const g = document.getElementById('wgo');
  if (g && go && !g.firstChild) {
    g.innerHTML = `<button class="btn" id="startnow">Start practising <span aria-hidden="true">→</span></button>`;
    document.getElementById('startnow').onclick = startFromWait;
    const h = document.getElementById('wtitle'); if (h) h.textContent = 'Your first question is ready';
    const sub = document.getElementById('wsub'); if (sub) sub.textContent = 'One more look before you start';
    // Not reading (no touch on the cards in the last 8 seconds)? Start by itself after a short countdown.
    if (!S.autoOff && !(S.readAt && Date.now() - S.readAt < 8000)) {
      const sess = S; let left = 5;
      const btn = document.getElementById('startnow');
      const show = () => { btn.innerHTML = `Starting in ${left}… <span class="cdhint">tap to start now</span>`; };
      show();
      sess.countdown = setInterval(() => {
        if (sess !== S || !document.getElementById('startnow')) { clearInterval(sess.countdown); sess.countdown = null; return; }
        if (--left <= 0) { clearInterval(sess.countdown); sess.countdown = null; startFromWait(); } else show();
      }, 1000);
    }
  }
}
function startFromWait() {
  if (!S || S.i >= S.qs.length) return;
  if (S.countdown) { clearInterval(S.countdown); S.countdown = null; }
  S.holdStart = false; S.waiting = false;
  renderQuestion();
}

function renderWaiting() {
  S.waiting = true;
  navSession();
  tryRecap();
  const e = S.error;
  if (e && e.status === 401) return renderAccess(() => { refill(S); renderWaiting(); }, 'That access code didn’t work. Please check it and try again.');
  const failed = !S.generating && S.i >= S.qs.length;
  if (!failed && S.i === 0 && !S.answers.length && S.holdStart === undefined) S.holdStart = true;
  const top = `<div class="topbar"><button class="backbtn" id="quit" data-kind="wait">${ICON.back}<span>Back</span></button><div class="progress"><i style="width:${Math.round(100 * S.i / Math.max(1, S.target))}%"></i></div><span class="count">${Math.min(S.i + 1, S.target)} / ${S.target}</span></div>`;
  if (failed) {
    $app.innerHTML = `${top}
  <main class="pad stack g18" style="flex:1;justify-content:center;text-align:center;align-items:center">
    <h1 class="display" style="margin:0;font-size:22px">${e ? 'Couldn’t make questions' : 'No more questions right now'}</h1>
    <p style="margin:0;line-height:1.5;max-width:320px">${esc(e ? e.message : 'Try this chapter again in a moment.')}</p>
    <button class="btn" id="retry" style="max-width:320px">Try again</button>
    ${S.qs.length ? '<button class="btn ghost" id="finish">See my results</button>' : '<button class="btn ghost" id="home">Back</button>'}
  </main>`;
  } else {
    const where = S.mode === 'drill' ? 'New questions on the ideas you missed' : S.units ? S.units.map((u) => u.title).join(', ') : '';
    $app.innerHTML = `${top}
  <main class="pad waitpage" style="flex:1">
    <div class="wait-head">
      <div class="wbud ${S.holdStart ? '' : 'small'}" id="wbud" aria-hidden="true">
        <div class="wbud-paper"><svg viewBox="0 0 60 72" width="60" height="72"><rect x="1" y="1" width="58" height="70" rx="7" fill="#fff" stroke="#DCE2EE" stroke-width="2"/><path class="wl l1" d="M10 18H50"/><path class="wl l2" d="M10 30H46"/><path class="wl l3" d="M10 42H50"/><path class="wl l4" d="M10 54H36"/></svg><span class="wbud-pen">✏️</span></div>
        <div class="wbud-me"><div class="wbud-bubble"><i></i><i></i><i></i></div><div class="wbud-b" id="wbudFace">${buddySVG('think', 92)}</div><div class="wbud-shadow"></div></div>
        <span class="wsp s1">✦</span><span class="wsp s2">✦</span><span class="wsp s3">✦</span>
      </div>
      <h1 class="display" id="wtitle">${S.holdStart ? 'Getting your questions ready' : 'Your next question is almost ready'}</h1>
      <p class="muted" data-raw>${esc(where)}</p>
      <div class="wait-prog"><div class="progress" id="wprog"><i id="wbar" style="width:0%"></i></div><span id="wready" class="hint"></span></div>
      <p class="wstat" id="wstat" aria-live="polite">${WAIT_STEPS[0]}</p>
    </div>
    <p class="hint wait-sub" id="wsub">${S.holdStart ? 'While you wait, a quick look at this chapter' : 'A quick look while it’s checked'}</p>
    <section class="card wcard" id="wcard" aria-live="polite"></section>
    <div id="wgo" class="wgo"></div>
    <p class="hint wait-foot">Each question is written from your textbook, then checked by a second AI.</p>
  </main>`;
    paintCard(); paintWait();
    // the cards turn over by themselves every 9 seconds (a tap on Next restarts the clock)
    clearInterval(S.cardTimer);
    const sess = S; sess.cardTick = Date.now();
    sess.cardTimer = setInterval(() => {
      if (sess !== S || !document.getElementById('wcard')) return clearInterval(sess.cardTimer);
      if (Date.now() - sess.cardTick >= 9000 && (sess.cards || []).length > 1) { sess.cardAt++; sess.cardTick = Date.now(); paintCard(); }
      sess.waitTick = (sess.waitTick || 0) + 1;
      const st = document.getElementById('wstat');
      if (st && !st.dataset.done && sess.waitTick % 3 === 0) { st.classList.remove('in'); void st.offsetWidth; st.textContent = WAIT_STEPS[(sess.waitTick / 3) % WAIT_STEPS.length]; st.classList.add('in'); }
    }, 1000);
  }
  document.getElementById('quit').onclick = async () => { if (await confirmLeave(leaveText('wait'))) go(S && S.book ? { name: 'book', bookId: S.book.id } : { name: 'home' }); };
  const r = document.getElementById('retry'); if (r) r.onclick = () => {
    if (S.mode === 'drill') { S.error = null; S.target = Math.max(S.target, S.qs.length + 1); pumpDrills(S); return renderWaiting(); }
    if (S.fill) { S.error = null; S.fill.rounds = 0; pumpPaper(S); return renderWaiting(); }
    S.target = Math.max(S.target, SESSION_SIZE); refill(S); renderWaiting(); };
  const f = document.getElementById('finish'); if (f) f.onclick = () => { S.qs = S.qs.slice(0, S.i); renderSummary(); };
  const h = document.getElementById('home'); if (h) h.onclick = () => go({ name: 'book', bookId: S.book.id });
}

function renderAccess(onOk, msg) {
  $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Back</span></button></div>
  <main class="pad stack g14" style="flex:1">
    <h1 class="display" style="margin:0;font-size:22px">Enter your access code</h1>
    <p style="margin:0;line-height:1.5;color:var(--text-2)">PrepBuddy is in testing. You need a code to make new questions. Ask the person who invited you.</p>
    ${msg ? `<p style="margin:0;color:var(--miss-dark);font-weight:600">${esc(msg)}</p>` : ''}
    <label for="code" style="font-size:14px;font-weight:600;color:var(--muted)">Access code</label>
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
  const gen = await api('generate', { title, text, items, avoid, target: idea, kind: await kindOfId(q.id), bookLevel: await levelOfId(q.id), lang: langOf(text) });
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
    <button class="backbtn" id="quit" data-kind="${isExam() && !S.review ? 'exam' : 'practice'}">${ICON.back}<span>Back</span></button>
    <div class="progress" role="progressbar" aria-valuenow="${S.i}" aria-valuemin="0" aria-valuemax="${n}"><i style="width:${pct}%"></i></div>
    <span class="count">${S.deadline && !S.review ? '<span class="timer" id="timer"></span><button class="btn-sm quiet addtime" id="addtime" title="Add 5 minutes">+5 min</button>' : `<span id="count">${S.i + 1} / ${n}</span>`}</span>
  </div>`;
}

// Laptops: the right-hand panel where marks and feedback appear, before there are any.
function qSide(q) {
  const mcq = choiceType(q);
  const [t, d] = isExam() ? ['Exam conditions', 'Answers and marks come at the end, like the real paper.']
    : mcq ? ['Pick an answer', 'You’ll see straight away if it’s right, with the explanation here.']
    : ['Write your answer', 'When you press Mark my answer, your marks and feedback show here.'];
  const keys = mcq ? '<span class="qkeys" aria-hidden="true"><kbd>A</kbd><kbd>B</kbd><kbd>C</kbd><kbd>D</kbd> to choose · <kbd>Enter</kbd> for next</span>' : '';
  if (preTutorInSide(q)) return `<aside class="qside chatside">${preTutorHTML(q)}${keys}</aside>`;
  return `<aside class="qside"><b>${t}</b><span>${d}</span>${keys}</aside>`;
}

// Before answering, the tutor can explain what the question means (never the answer). Not in timed tests.
const preTutorOK = (q) => S.phase !== 'revealed' && !isExam();
// Laptops show it in the right-hand panel next to the question (every type); phones have it under the question.
const preTutorInSide = (q) => preTutorOK(q) && matchMedia('(min-width:1024px)').matches;
const preTutorHTML = (q) => `<div class="tutor pre" id="tutor">${tutorHTML(q)}</div>`;
// Phones: Buddy starts folded into one button, so the question comes first. It opens when tapped, and on its own
// after a wrong answer. Laptops keep it in the side panel.
const phoneQ = () => !matchMedia('(min-width:1024px)').matches;
const practiceIcon = () => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>`;
const progressIcon = () => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>`;
const tutorCTA = (label) => `<button class="tutor-cta" id="tutorOpen" type="button">${buddySVG('happy', 30)}<span>${label}</span><span aria-hidden="true" class="tc-go">›</span></button>`;
function tutorFolded(q) {
  return false; // Philip prefers the chat already open on practice screens
  if (!phoneQ()) return false;
  const c = chatOf(); if (c.shown || c.msgs.length) return false;
  if (S.phase !== 'revealed') return true;
  return choiceType(q) ? S.answers[S.i] === q.correct_option : partsGot(q) === marksOf(q); // right answers: folded
}
function bindTutorCTA(q, cls) {
  const b = document.getElementById('tutorOpen'); if (!b) return;
  b.onclick = () => { chatOf().shown = true; const d = document.createElement('div'); d.className = cls; d.id = 'tutor'; d.innerHTML = tutorHTML(q); b.replaceWith(d); bindTutor(q); const i = d.querySelector('input, textarea'); d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
}

// In mixed sets (reviews, mistakes, weak spots) say where each question is from, and for reviews when it was last seen
function qWhere(q) {
  if (!S || S.mode === 'unit' || S.mode === 'dse' || S.placement) return '';
  const c = QCTX.get(q.id); if (!c) return '';
  const zh = LANG === 'zh', name = `${c.book.subject ? subj(c.book.subject) : shortTitle(c.book.title)} · ${shortTitle(c.unit.title)}`;
  const st = local.stats[q.id], d = st && st.at ? Math.max(0, Math.round((startOfToday() - new Date(st.at).setHours(0, 0, 0, 0)) / DAY)) : null;
  const seen = S.mode === 'spaced' && d != null ? (zh ? ` · ${d === 0 ? '今日' : d === 1 ? '昨日' : `${d} 日前`}做過` : ` · last seen ${d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}`) : '';
  return `<p class="qwhere" data-raw>${S.mode === 'spaced' ? `<b>${zh ? '溫習' : 'Review'}</b>` : ''}<span>${esc(name)}${seen}</span></p>`;
}
function renderQuestion() {
  S.waiting = false;
  navSession();
  const q = S.qs[S.i];
  if (renderQuestion.last !== q) { if (renderQuestion.last && sayingText) stopSaying(); renderQuestion.last = q; } // a new question stops reading the old one
  if (S.mode === 'unit' && !S.placement && !S.review && !q.recap) { S.metered = S.metered || new Set(); if (!S.metered.has(q.id)) { S.metered.add(q.id); meter('q'); if (!choiceType(q)) meter('written'); } }
  const body = choiceType(q) ? mcqBody(q, S.phase === 'revealed') : writtenBody(q, S.phase === 'revealed');
  $app.innerHTML = header() + `
  <main class="stack g18 qpaper" style="flex:1;padding:14px 20px 20px">
    ${qWhere(q)}<div class="chips">${S.mode === 'dse' ? `<span class="chip sec">${S.i < S.sectionA ? 'Section A' : 'Section B'}</span>` : ''}<span class="chip" title="${esc(LEVEL[q.level] || '')}">${LANG === 'zh' ? '程度' : 'Level'} ${q.level}<span class="hide-sm"> · ${LEVEL[q.level]}</span></span><span class="chip grey">${TYPE[q.type]} · ${marksOf(q)} mark${marksOf(q) > 1 ? 's' : ''}</span>${readAloudOn() ? `<button class="chip say" id="sayq" aria-label="${LANG === 'zh' ? '讀出題目' : 'Read the question to me'}" title="${LANG === 'zh' ? '讀出題目' : 'Read the question to me'}">🔊</button>` : ''}${S.review ? '<span class="chip grey">Review</span>' : ''}${q.recap ? '<span class="chip recap" title="Done before. A quick recap while the next new question is checked">Quick recap</span>' : ''}</div>
    ${body.main}
    ${preTutorOK(q) && !preTutorInSide(q) ? (tutorFolded(q) ? tutorCTA(LANG === 'zh' ? '不明白？問 Buddy' : 'Stuck? Ask Buddy') : preTutorHTML(q)) : ''}
  </main>
  ${body.footer}${/class="sheet/.test(body.footer) ? '' : qSide(q)}`;
  liftActions();
  bindCommon(q);
  body.bind && body.bind();
  { const sq = document.getElementById('sayq'); if (sq) sq.onclick = () => sayAloud(questionSpeech(q)); }
  // Only if the parent turned it on (Settings → About your child → Reading voice): read each new question aloud once
  if ((local.learner || {}).autoread === 'on' && S.phase !== 'revealed' && S.saidQ !== q.id && navigator.userActivation && navigator.userActivation.hasBeenActive) { S.saidQ = q.id; setTimeout(() => { if (S && S.qs[S.i] === q) sayAloud(questionSpeech(q)); }, 350); }
  startTimer();
  // After answering on a phone, stay on the answers (not the top of a long passage) so the child sees right or wrong.
  const o1 = S.phase === 'revealed' && !matchMedia('(min-width:1024px)').matches && $app.querySelector('main.qpaper .opt');
  if (o1) window.scrollTo(0, Math.max(0, o1.getBoundingClientRect().top + window.scrollY - 150));
  else window.scrollTo(0, 0);
}
/* ---------- read aloud (primary): questions and Buddy's replies, with the same free browser voices as 默書 ---------- */
const readAloudOn = () => !!(window.speechSynthesis && isPrimaryKid());
const plainSpeech = (t) => String(t || '').replace(/\$([^$]+)\$/g, (m, x) => x.replace(/\\(text|mathrm|ce)\{([^}]*)\}/g, '$2').replace(/(\d)\s*\\[dt]?frac/g, '$1 and \\frac').replace(/\\[dt]?frac\{([^}]*)\}\{([^}]*)\}/g, ' $1 over $2 ').replace(/\\square/g, ' blank ').replace(/\\times/g, ' times ').replace(/[{}\\^_]/g, ' '))
  .replace(/[*#>|`]/g, ' ').replace(/_{2,}/g, LANG === 'zh' ? '，空格，' : ', blank, ').replace(/\s+/g, ' ').trim();
function questionSpeech(q) {
  const parts = [q.stem || ''];
  if (choiceType(q)) (q.options || []).forEach((o, i) => parts.push(`${'ABCD'[i]}. ${o}`));
  else (q.parts || []).forEach((p) => parts.push(`${p.label || ''} ${p.prompt || ''}`));
  return parts.join('. ');
}
// Read any text aloud (questions, Buddy's replies, listening passages): the natural voice when the server has one,
// otherwise the phone's own. lang: 'en' | 'yue' | 'cmn' | 'zh' (= the child's Chinese, Cantonese or Putonghua); guessed if left out.
function sayAloud(text, lang) {
  try {
    const t = plainSpeech(text); if (!t) return;
    if (sayingText === t) return stopSaying(); // tapping 🔊 again while it reads = stop
    stopSaying(); const my = ttsSeq;
    const L = ['yue', 'cmn', 'en', 'fr', 'ja'].includes(lang) ? lang : lang === 'zh' ? zhVoice() : voiceOf(langOf(t));
    const done = () => { if (my === ttsSeq) sayPill(null); };
    const phone = (rest) => {
      if (!window.speechSynthesis || my !== ttsSeq) return done();
      const u = new SpeechSynthesisUtterance(rest), v = dictVoice(L);
      if (v) u.voice = v; u.lang = v ? v.lang : DL[L][2];
      u.rate = gradeBand() === 'p12' ? 0.85 : 0.95;
      u.onend = done; u.onerror = done;
      sayPill('play'); speechSynthesis.speak(u);
    };
    sayPill('load'); sayingText = t;
    const parts = speechChunks(t), clips = [];
    const clip = (i) => (i < parts.length ? (clips[i] = clips[i] || ttsClip(parts[i], L, 'normal').catch(() => null)) : null);
    clip(0); clip(1);
    const play = async (i) => {
      if (my !== ttsSeq) return;
      if (i >= parts.length) return done();
      if (i > 0) sayPill(clips[i] ? 'play' : 'load');
      const url = await clip(i); clip(i + 1); clip(i + 2);
      if (my !== ttsSeq) return;
      if (!url) return phone(parts.slice(i).join(' '));
      const a = ttsPlayer(); a.onended = () => play(i + 1); a.src = url;
      try { await a.play(); if (my === ttsSeq) sayPill('play'); } catch (e) { a.onended = null; phone(parts.slice(i).join(' ')); }
    };
    play(0);
  } catch (e) {}
}
// A small 🔊 on each of Buddy's replies (tutor, coach, homework, lessons), for primary children.
(() => {
  const add = () => {
    if (!readAloudOn()) return;
    document.querySelectorAll('.tmsg.ai:not([data-say-on])').forEach((m) => {
      if (m.querySelector('.dots') || m.closest('.coach-demo')) return;
      m.setAttribute('data-say-on', '1');
      const b = document.createElement('button'); b.className = 'say-mini'; b.type = 'button'; b.textContent = '🔊';
      b.setAttribute('aria-label', LANG === 'zh' ? '讀出來' : 'Read this to me');
      b.onclick = (e) => { e.stopPropagation(); const c = m.cloneNode(true); c.querySelectorAll('.say-mini').forEach((x) => x.remove()); sayAloud(c.textContent); };
      m.appendChild(b);
    });
  };
  try { new MutationObserver(() => { clearTimeout(add.t); add.t = setTimeout(add, 120); }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();

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

// On a laptop the answer panel sits beside the question, so Next and "Report a problem" go under the question
// itself (where the eye already is) instead of at the bottom of the side panel.
function liftActions() {
  if (!matchMedia('(min-width:1024px)').matches) {
    // Phones: once answered, keep "Next" fixed at the bottom of the screen so there's no scrolling past the explanation.
    const nx = $app.querySelector(':scope > .sheet > #next');
    if (nx) { const bar = document.createElement('div'); bar.className = 'qnext-fixed'; bar.appendChild(nx); $app.appendChild(bar); }
    return;
  }
  const main = $app.querySelector(':scope > main.qpaper'), sheet = $app.querySelector(':scope > .sheet');
  if (!main || !sheet) return;
  const next = sheet.querySelector(':scope > #next'), rb = sheet.querySelector('#rbox');
  if (!next && !rb) return;
  const box = document.createElement('div'); box.className = 'qafter';
  if (rb) box.appendChild(rb);
  if (next) box.appendChild(next);
  main.appendChild(box);
}
function feedbackBits(q) {
  return `<p class="expl">${esc(q.explanation)}</p>
    ${q.source_quote ? `<p class="src">${esc(q.section || 'Textbook')}${q.pages ? `, pp. ${esc(q.pages)}` : ''}: “${esc(q.source_quote)}”</p>` : ''}
    ${tutorFolded(q) ? tutorCTA(LANG === 'zh' ? '問 Buddy 關於這題' : 'Ask Buddy about this question') : `<div class="tutor" id="tutor">${tutorHTML(q)}</div>`}
    <div class="rbox" id="rbox">${(local.reports || []).includes(q.id) ? '<p class="rdone">You reported this question. We’ll check it.</p>' : '<div style="display:flex;justify-content:flex-end"><button class="btn-sm quiet" id="report">Report a problem</button></div>'}</div>`;
}
const REPORT_REASONS = [['wrong_answer', 'The answer is wrong'], ['unclear', 'The question doesn’t make sense'], ['missing_figure', 'It needs a diagram or table I can’t see'], ['off_topic', 'It’s not from my textbook'], ['typo', 'Spelling or formatting mistake'], ['other', 'Something else']];
// Sends a report to the admin. If it can't be sent now (offline), it's kept and sent next time the app opens.
async function sendReport(payload) {
  try { await apiOnce('report', payload); return true; } catch (e) {
    if (e.status === 400) return false;
    local.pendingReports = [...(local.pendingReports || []), payload].slice(-30); saveLocal(); return false;
  }
}
async function flushReports() {
  const list = local.pendingReports || []; if (!list.length) return;
  local.pendingReports = []; saveLocal();
  for (const p of list) await sendReport(p);
}
function bindReport(q) {
  const box = document.getElementById('rbox'); const r = document.getElementById('report');
  if (!box || !r) return;
  r.onclick = () => {
    let reason = '';
    box.innerHTML = `<div class="rform"><b>What’s wrong with this question?</b>
      <div class="rreasons" role="radiogroup">${REPORT_REASONS.map(([k, t]) => `<button type="button" role="radio" aria-checked="false" data-reason="${k}">${t}</button>`).join('')}</div>
      <textarea id="rnote" class="input" rows="2" maxlength="1000" placeholder="Tell us more (optional)"></textarea>
      <div class="rbtns"><button class="btn ghost" id="rcancel">Cancel</button><button class="btn" id="rsend" disabled>Send report</button></div></div>`;
    box.querySelectorAll('[data-reason]').forEach((b) => (b.onclick = () => {
      reason = b.dataset.reason;
      box.querySelectorAll('[data-reason]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      document.getElementById('rsend').disabled = false;
    }));
    document.getElementById('rcancel').onclick = () => { box.innerHTML = '<div style="display:flex;justify-content:flex-end"><button class="btn-sm quiet" id="report">Report a problem</button></div>'; bindReport(q); };
    document.getElementById('rsend').onclick = async () => {
      const btn = document.getElementById('rsend'); btn.disabled = true; btn.textContent = 'Sending…';
      const book = (S && S.book) || {}; const uid = qUnit(q.id)[1]; const unit = (book.units || []).find((u) => u.id === uid) || {};
      const ans = S && S.answers ? S.answers[S.i] : '';
      const payload = { reason, note: document.getElementById('rnote').value.trim(), lang: LANG, book: { id: book.id, title: book.title, library: book.library, code: book.code }, unit: { id: unit.id, title: unit.title }, q, answer: Array.isArray(ans) ? ans.join('\n') : String(ans || '') };
      const sent = await sendReport(payload);
      if (!local.reports.includes(q.id)) { local.reports.push(q.id); saveLocal(); }
      box.innerHTML = `<p class="rdone">${ICON.check} ${sent ? 'Thanks. We’ve sent this to the PrepBuddy team to check. You won’t see this question again.' : 'Thanks. We’ll send this when you’re back online. You won’t see this question again.'}</p>`;
    };
  };
}

/* ---------- "I don't get it": ask the AI tutor about this question ---------- */
const qForServer = (q) => (q.figure ? { ...q, figure: { image: q.figure.image, box: q.figure.box } } : q);
const figB64 = (q) => (q.figure && q.figure.img ? q.figure.img.split(',')[1] : undefined);
// The tutor chat is always open under every question: no extra tap to start asking.
function chatOf() { S.chat = S.chat || {}; return S.chat[S.i] || (S.chat[S.i] = { open: true, msgs: [], busy: false }); }
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
  const vkey = `${q.id}#${S.i}`, von = voiceOn('tutor', vkey);
  const before = S.phase !== 'revealed';
  const chips = before ? [
    ['mean', 'What is this question asking?'],
    ['words', 'Explain the key words'],
    ['hint', 'Give me a hint'],
  ] : [
    ...(wrongAnswer(q) ? [['why', 'Why is my answer wrong?']] : []),
    ['simple', 'Explain it more simply'],
    ['steps', 'Go through it step by step'],
    ['example', 'Give me another example'],
  ];
  return `<div class="tchat">
    <div class="thead"><b class="thead-t">${buddySVG('happy', 28)}<span>Ask Buddy<small>About this question, or anything else</small></span></b><span style="display:flex;gap:6px">${von ? '' : `<button class="vtalk" id="tutorTalk">${ICON.mic} Talk${locked('voice') ? ' 🔒' : ''}</button>`}</span></div>
    ${von ? voicePanelHTML() + (c.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(c.error)}</p>` : '') : `
    <div class="tlog" id="tlog">${!c.msgs.length && !c.busy ? `<div class="tempty">${buddySVG('happy', 64)}<b>${before ? 'Stuck? Ask me.' : 'Want to understand it better?'}</b><span>${before ? 'I can explain what the question means or give you a hint, without giving away the answer. You can also ask me about anything else, like how to use the app.' : 'Ask why the answer is right, or have it explained another way.'}</span>${before ? `<span class="tnote">${choiceType(q) ? 'Pick an answer to see if it’s right, with the explanation.' : 'Your marks and feedback appear here when you press Mark my answer.'}</span>` : ''}</div>` : ''}
    ${c.msgs.map((m) => m.role === 'user' ? `<div class="tmsg me nomath" data-raw>${esc(m.text)}</div>` : `<div class="tmsg ai" data-raw>${tutorMd(m.text)}</div>`).join('')}
    ${c.busy ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}</div>
    ${c.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(c.error)}</p>` : ''}
    ${voiceNoticeHTML('tutor')}
    ${c.busy ? '' : `<div class="tchips">${chips.filter(([k]) => !c.msgs.some((m) => m.chip === k)).map(([k, l]) => `<button class="tchip" data-chip="${k}">${l}</button>`).join('')}</div>`}
    <form class="tform" id="tform"><input id="tq" class="tinput" placeholder="Type your question…" autocomplete="off" ${c.busy ? 'disabled' : ''}><button class="tsend" aria-label="Send" ${c.busy ? 'disabled' : ''}>${ICON.send}</button></form>`}
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
  const redraw = () => { if (S !== sess || S.i !== idx) return; const b = document.getElementById('tutor'); if (!b) return; b.innerHTML = tutorHTML(q); bindTutor(q); const l = document.getElementById('tlog'); if (l) l.scrollTop = l.scrollHeight; };
  const ask = async (text, chip, voice, onChunk) => {
    text = String(text || '').trim(); if (!text || c.busy) return;
    let reply = '';
    const history = c.msgs.map((m) => ({ role: m.role, text: m.text }));
    c.msgs.push({ role: 'user', text, chip }); c.busy = true; c.error = null; redraw();
    document.getElementById('tutor').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      const [bookId, unitId] = qUnit(q.id);
      const chapter = await store.get(`text:${bookId}:${unitId}`, '');
      if (!chapter) throw new Error('This chapter’s text is missing on this device.');
      const before = S.phase !== 'revealed';
      const req = { title: q.section, text: chapter, question: qForServer(q), figure: figB64(q), answer: before ? '' : studentAnswerText(q), before, ask: text, history, lang: voice ? ({ yue: 'zh-HK', fr: 'fr', ja: 'ja' }[voice] || 'en') : langOf(chapter), voice };
      const r = onChunk ? await apiStream('explain', req, onChunk) : await api('explain', req);
      c.msgs.push({ role: 'assistant', text: r.reply }); reply = r.reply;
      const mk = local.mistakes[q.id];
      if (mk) { mk.chat = c.msgs.slice(-12).map((x) => ({ role: x.role, text: x.text.slice(0, 2500) })); saveLocal(); }
    } catch (e) {
      c.msgs.pop();
      c.error = e.status === 0 ? 'You seem to be offline.' : (e.message && e.status !== 500 ? e.message : 'The tutor is not available right now. Try again in a moment.');
    }
    c.busy = false; redraw();
    const t = document.getElementById('tutor'); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return reply;
  };
  const talk = document.getElementById('tutorTalk');
  if (talk) talk.onclick = async () => {
    c.open = true;
    const [bookId, unitId] = qUnit(q.id);
    const chapter = await store.get(`text:${bookId}:${unitId}`, '');
    const bl = langOf(chapter), lang = bl === 'fr' || bl === 'ja' ? bl : (LANG === 'zh' || bl === 'zh-HK') ? 'yue' : 'en';
    startVoiceChat({ where: 'tutor', key: `${q.id}#${idx}`, lang, send: (t, l, onChunk) => ask(t, undefined, l, onChunk), alive: () => S === sess && S.i === idx && c.open && !!document.getElementById('tutor'), redraw, title: VL('Tutor · this question', '導師 · 呢條題目') });
  };
  bindVoiceBar();
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
// Short fill-in answers ("Answer: 1081", "cried (spelling…)", "Answer: no. …") are checked on the device:
// no AI call, instant and free. Only full marks, or a plain number that's simply a different number, are decided
// here; anything else (a sentence, units, another wording) still goes to the AI marker.
const normAns = (t) => { let x = String(t || '').toLowerCase().replace(/[‘’'"“”]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!?。]+$/, '').trim();
  if (/^\d{1,3}([ ,]\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/[\s,]/g, ''); return x; }; // 10 810 / 10,810 → 10810
const isNum = (x) => /^-?\d+(\.\d+)?$/.test(x);
function acceptedOf(line) {
  let t = String(line || '').trim().replace(/^answer\s*:\s*/i, '');
  const acc = [];
  const am = t.match(/\baccept\s+(.+?)\s*\)?\s*$/i);
  if (am && !/with or without|unit|any |either/i.test(am[1])) am[1].split(/\s+or\s+|\s*,\s*|\s+\/\s+/).forEach((a) => acc.push(a));
  t = t.split(' (')[0].split(/\.\s+/)[0];
  t.split(/\s+\/\s+/).forEach((a) => acc.push(a));
  if (am && /without the unit/i.test(am[1])) { const n = t.match(/^-?[\d.]+/); if (n) acc.push(n[0]); }
  if (/^[tf]$/i.test(t.trim())) acc.push(/^t$/i.test(t.trim()) ? 'true' : 'false');
  const out = [...new Set(acc.map(normAns).filter(Boolean))];
  return out.length && out.every((a) => a.split(' ').length <= 4 && !/\b(mark|accept|must|any)\b/.test(a)) ? out : null;
}
function localMark(q, answers) {
  if (q.type === 'essay' || !q.parts || !q.parts.length) return null;
  if (!q.parts.every((p) => p.blank && p.marks === 1 && (p.mark_scheme || []).length === 1)) return null;
  const parts = [];
  for (let k = 0; k < q.parts.length; k++) {
    const acc = acceptedOf(q.parts[k].mark_scheme[0]); const a = normAns(answers[k]);
    if (!acc || !a) return null;
    if (acc.includes(a)) parts.push({ awarded: [0], feedback: 'Correct.' });
    else if (isNum(a) && acc.every(isNum)) parts.push({ awarded: [], feedback: 'Not quite. Check your working and try a similar one.' });
    else return null;
  }
  return { parts, tip: '', local: true };
}
async function markAnswer(sess, idx) {
  // Mark as pending straight away: the screen redraw that follows the tap must not start a second marking.
  sess.marks = sess.marks || {};
  if (sess.marks[idx] && sess.marks[idx].pending) return;
  sess.marks[idx] = { pending: true };
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
      const lm = !inks.some(Boolean) && localMark(q, answers);
      if (lm) { sess.marks[idx] = lm; throw 'done'; }
      const [bookId, unitId] = qUnit(q.id);
      const text = await store.get(`text:${bookId}:${unitId}`, '');
      if (!text) throw new Error('missing text');
      sess.marks[idx] = await api('mark', { title: q.section, text, question: qForServer(q), figure: figB64(q), answers, inks: inks.some(Boolean) ? inks.map((x) => (x ? x.split(',')[1] : null)) : undefined, kind: await kindOfId(q.id), lang: langOf(q.stem + ' ' + q.parts.map((p) => p.prompt).join(' ')) });
    } catch (e) {
      if (e !== 'done') sess.marks[idx] = { error: e.status === 0 ? 'You seem to be offline, so the AI could not mark this.' : 'The AI marker is not available right now.' };
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
  const stem = figHTML(q) + (q.stem ? renderStem(writtenStem(q), 'q') : ''); // the question is the biggest text on the screen
  if (!revealed) {
    // The maths keypad and "show your working" only for questions that involve working something out.
    const maths = kindSync(q.id) === 'maths' && q.type !== 'essay' && /\d|calculat|work out|find|solve|show that|evaluate|simplif|expand|factori|prove|estimate|計算|求/i.test(q.parts.map((p) => `${p.prompt} ${p.mark_scheme.join(' ')}`).join(' ')), essay = q.type === 'essay';
    const parts = q.parts.map((p, k) => {
      const ink = inkOf(S.i, k, true);
      // a one-word blank (cloze, proofreading line, verb form): a one-line box, no handwriting pad
      // (a maths blank like "47 × 23" gets the full box instead: type with the maths keys, or handwrite)
      if (p.blank && !essay && !maths) return `<div class="part"><label class="ph${GENERIC_ASK.test(p.prompt) ? ' generic' : ''}" for="a${k}"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></label>
      <input id="a${k}" data-k="${k}" class="blank-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Your answer" value="${esc(ans[k])}"></div>`;
      return `<div class="part">
      <label class="ph${GENERIC_ASK.test(p.prompt) ? ' generic' : ''}" for="a${k}"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="mk">${p.marks} mark${p.marks > 1 ? 's' : ''}</span></label>
      <div class="ansmode" role="radiogroup" aria-label="How to answer"><button role="radio" aria-checked="${!ink.on}" class="${ink.on ? '' : 'on'}" data-hand="${k}:0">${ICON.keys} Type</button><button role="radio" aria-checked="${ink.on}" class="${ink.on ? 'on' : ''}" data-hand="${k}:1">${ICON.pen} Write by hand</button></div>
      ${ink.on ? `<div class="inkpad"><canvas id="ink${k}" data-k="${k}" aria-label="Writing area: write your answer with your finger or a stylus"></canvas>
          <div class="inktools"><button data-undo="${k}">Undo</button><button data-clear="${k}">Clear</button><button data-more="${k}">More space</button></div></div>`
        : `${maths ? mathKeys(`a${k}`) : ''}
      <textarea id="a${k}" data-k="${k}" class="${essay ? 'essay' : ''}" placeholder="${essay ? 'Write your answer here' : maths ? 'Show your working, one step per line' : 'Type, or tap the microphone on your keyboard to speak'}">${esc(ans[k])}</textarea>
      ${essay ? `<span class="hint" id="wc">${wordCount(ans[k])} words</span>` : ''}`}</div>`;
    }).join('');
    const main = `${stem}${parts}${essay ? `<p class="hint">Marked on ${(q.rubric || []).map((r) => esc(r.criterion)).join(', ')}.</p>` : `<p class="hint ahint">${q.parts.every((p) => p.blank) ? (kindSync(q.id) === 'maths' ? (maths ? 'Type or handwrite your answer. Showing your working helps Buddy see where it went wrong.' : 'Write just the answer. Units like cm² can be typed as cm2.') : 'Check your spelling: it counts.') : maths ? 'Method marks are given for correct working, even if the final answer is wrong.' : 'Aim for one clear point per mark.'}</p>`}`;
    const footer = `<div class="pad stack g8" style="padding-top:0"><button class="btn" id="check">${isExam() ? nextLabel() : 'Mark my answer'}</button>${isExam() ? '' : '<button class="btn-sm quiet" id="skip" style="align-self:center">I don’t know this one. Show me the answer</button><span class="hint" style="text-align:center">It goes into your Mistake book so you can try it again later.</span>'}</div>`;
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
      $app.querySelectorAll('textarea, input.blank-in').forEach((t) => (t.oninput = grab));
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
      ${pm ? `<div class="marker ${got === p.marks ? 'full' : ''}">${q.parts.length > 1 ? `<b>${got} / ${p.marks}</b> ` : ''}${esc(pm.feedback)}</div>` : ''}
      <span class="hint" style="font-weight:600">${ai ? 'Mark scheme (ticked = points you earned):' : m.skipped ? 'Mark scheme:' : `Tick each point your answer makes${p.mark_scheme.length > p.marks ? ` (max ${p.marks})` : ''}:`}</span>
      ${p.mark_scheme.map((pt, j) => `<button class="point ${ticks[k][j] ? 'on' : ''}" data-k="${k}" data-j="${j}" aria-pressed="${ticks[k][j]}"><span class="box">${ticks[k][j] ? ICON.check : ''}</span><span>${esc(pt.replace(/\s*\(1\)\s*$/, ''))}</span></button>`).join('')}
    </div>`;
  }).join('');
  const got = partsGot(q);
  const note = m.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(m.error)} Tick the points you made instead.</p>`
    : m.local ? '<p class="hint" style="margin:0">Checked against the answer. Think it got one wrong? Tap a point to change it.</p>'
    : ai ? '<p class="hint" style="margin:0">Marked by AI. Think it got one wrong? Tap a point to change it.</p>' : '';
  const footer = `<div class="sheet"><span class="verdict ${got === marksOf(q) ? 'ok' : 'no'}">${got} / ${marksOf(q)} mark${marksOf(q) === 1 ? '' : 's'}</span>
    ${m.tip ? `<p class="tipline"><b>Tip:</b> <span data-raw>${esc(m.tip)}</span></p>` : ''}${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${partHtml}${note}`, footer, bind() {
    $app.querySelectorAll('.point').forEach((b) => (b.onclick = () => { const k = +b.dataset.k, j = +b.dataset.j; ticks[k][j] = !ticks[k][j]; const y = window.scrollY; renderQuestion(); window.scrollTo(0, y); }));
  } };
}

const GENERIC_ASK = /^(write|show) (your|the)\b/i; // "Write your answer.": an instruction, not the question
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
  const footer = `<div class="sheet"><span class="verdict ${m.total >= max * 0.7 ? 'ok' : 'no'}">${m.total} / ${max} mark${max === 1 ? '' : 's'}</span>
    ${e.tip ? `<p class="tipline"><b>Tip:</b> <span data-raw>${esc(e.tip)}</span></p>` : ''}${feedbackBits(q)}<button class="btn" id="next">${nextLabel()}</button></div>`;
  return { main: `${stem}${task}<p class="hint" style="margin:0">Marked by AI against the rubric.</p><div class="card stack g14" style="padding:14px 16px">${crit}</div>${imp}`, footer };
}

function record(q, got) {
  // Getting stronger (progress.js): first attempts only, allowing for guessing and for help asked from Buddy first.
  const k_ = S && S.qs ? S.qs.indexOf(q) : -1, helped = !!(k_ >= 0 && S.chat && S.chat[k_] && S.chat[k_].msgs.length), ty = choiceType(q) ? 'c' : 'w';
  try { PG.update(pgState(), { t: Date.now(), q: q.id, g: got, m: marksOf(q), l: q.level, ty, h: helped }, prevAnswer(q.id) || (local.stats[q.id] ? { t: Date.now(), g: 1, m: 1 } : null), BOOK_SUBJ[String(q.id).split(':')[0]]); } catch (e) {}
  const s = local.stats[q.id] || { seen: 0, got: 0, total: 0, last: 0 };
  s.seen++; s.got += got; s.total += marksOf(q); s.last = got / marksOf(q);
  schedule(s, got >= marksOf(q));
  local.stats[q.id] = s;
  // Activity log for progress reports: when, which question/chapter, marks, and how it was practised.
  local.log.push({ t: Date.now(), q: q.id, c: q.section || '', g: got, m: marksOf(q), l: q.level, k: (S && S.mode) || '', ty, ...(helped ? { h: 1 } : {}) });
  // Mistake book: every question not fully right goes in; getting it fully right later marks it mastered.
  const mk = local.mistakes[q.id];
  if (got < marksOf(q)) {
    const k = S ? S.qs.indexOf(q) : -1;
    const ans = k >= 0 ? S.answers[k] : null;
    // MCQ options are shuffled per session, so keep the text of the chosen option, not just its letter.
    const ansText = choiceType(q) && ans ? (q.options || [])['ABCD'.indexOf(ans)] || '' : null;
    local.mistakes[q.id] = { t: Date.now(), n: ((mk && mk.n) || 0) + 1, got, ans: Array.isArray(ans) ? ans.map((a) => String(a || '').slice(0, 1500)) : null, ansText, chat: (mk && mk.chat) || null, done: false };
  } else if (mk && !mk.done) { mk.done = true; mk.doneAt = Date.now(); if (mk.t < dayStart()) { mk.earned = 1; if (S) S.fixedNow = (S.fixedNow || 0) + 1; } }
  const ids = Object.keys(local.mistakes);
  if (ids.length > 600) ids.sort((a, b) => local.mistakes[a].t - local.mistakes[b].t).slice(0, ids.length - 600).forEach((id) => delete local.mistakes[id]);
  if (local.log.length > 5000) local.log = local.log.slice(-5000);
  saveLocal();
}

function endEarly() {
  if (isExam() && !S.review) return S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' });
  saveOpenAnswer();
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
  document.getElementById('quit').onclick = async () => {
    if (await confirmLeave(leaveText(isExam() && !S.review ? 'exam' : 'practice'))) endEarly();
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
  bindTutor(q); bindTutorCTA(q, S.phase === 'revealed' ? 'tutor' : 'tutor pre');
  bindReport(q);
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
    S.review = true; S.i = 0; S.phase = 'revealed'; stopTimer(); S.examEnd = Date.now();
    toast('Time to review. Tick the points you made in written answers.');
    return renderQuestion();
  }
  renderSummary();
}

function renderSummary() {
  setTimeout(() => pilotSync(), 3000);
  if (S && S.placement) return renderPlacementResult();
  stopTimer();
  const qs = S.qs.slice(0, Math.max(S.i + 1, 0));
  const total = qs.reduce((s, q) => s + marksOf(q), 0), got = qs.reduce((s, q, k) => s + (S.got[k] || 0), 0);
  const pct = total ? Math.round(100 * got / total) : 0;
  const list = qs.map((q, k) => {
    const g = S.got[k] || 0, m = marksOf(q), full = g === m;
    const plain = (t) => String(t || '').replace(/^\|.*$/gm, ' ').replace(/\\[dt]?frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2').replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/[$\\]/g, '').replace(/\s+/g, ' ').trim();
    const label = plain(q.stem) || plain(q.parts && q.parts[0] && q.parts[0].prompt);
    const st = full ? 'right' : g ? 'half' : 'miss';
    // Missed or partly right: the right answer and why, under the question.
    let fix = '';
    if (!full) {
      const ZZ = (en, zh) => (LANG === 'zh' ? zh : en), lines = [];
      // one compact line per answer: a tick, or what the child put (crossed out) → the right answer
      const norm = (t) => String(t || '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[\s.,;:!?'"’‘“”。，]/g, '');
      const line = (good, alsoOk, mine, ok, lab = '') => `<div class="rfx-line ${ok ? 'ok' : 'no'}">${lab ? `<span class="rfx-pl">${lab}</span>` : ''}<span class="rfx-ic" aria-hidden="true">${ok ? '✓' : '✗'}</span><span class="rfx-a" data-keep>${ok ? `<b>${mine || good}</b>` : `${mine ? `<s>${mine}</s>` : `<i>${ZZ('blank', '未作答')}</i>`}<span class="rfx-arr" aria-hidden="true">→</span><b>${good}</b>`}${!ok && alsoOk ? `<em>${ZZ('also OK', '亦接受')}: ${alsoOk}</em>` : ''}</span></div>`;
      if (choiceType(q) && Array.isArray(q.options)) {
        const L = q.correct_option, oi = 'ABCD'.indexOf(L), mine = S.answers && S.answers[k];
        if (oi >= 0) lines.push(line(`${L}. ${esc(plain(q.options[oi]))}`, '', mine && 'ABCD'.indexOf(mine) >= 0 ? `${mine}. ${esc(plain(q.options['ABCD'.indexOf(mine)]))}` : '', false));
      } else if (Array.isArray(q.parts)) {
        const tk = (S.ticks && S.ticks[k]) || [], my = (S.answers && S.answers[k]) || [];
        q.parts.forEach((p, pi) => {
          if (!Array.isArray(p.mark_scheme) || !p.mark_scheme.length) return;
          const lab = q.parts.length > 1 ? esc(String(p.label || pi + 1).replace(/[()]/g, '')) : '';
          // pull "Answer: 10810. Accept 10810 or 10 810" apart into the answer and the accepted forms
          let ans = '', acc = '';
          const rest = [];
          p.mark_scheme.forEach((x, j) => {
            const t = plain(x), m1 = t.match(/^(?:final\s+)?(?:answer|ans|答案)\s*[:：=]\s*(.+)$/i);
            if (m1 && !ans) {
              const sp = m1[1].split(/[.;,，。]?\s*(?:accept|also accept|或接受|接受)\s*/i);
              ans = sp[0].replace(/[.。]\s*$/, ''); acc = (sp[1] || '').replace(/[.。]\s*$/, '');
              if (acc && acc.replace(/\s/g, '') === ans.replace(/\s/g, '')) acc = '';
              acc = acc.split(/\s+or\s+|\s*\/\s*|，|,\s*/).filter((v) => v && v.replace(/\s/g, '') !== ans.replace(/\s/g, '')).join(' · ');
            } else rest.push([t, !!tk[pi] && !!tk[pi][j]]);
          });
          if (!ans && p.blank && rest.length) ans = rest.shift()[0];
          const mine = String(my[pi] || '').trim();
          const partOK = (tk[pi] && p.mark_scheme.length && p.mark_scheme.every((_, j) => tk[pi][j])) || (ans && mine && (norm(mine) === norm(ans) || acc.split(' · ').some((a) => a && norm(a) === norm(mine))));
          let h = '';
          if (ans) h += line(esc(ans), esc(acc), esc(mine.slice(0, 200)), partOK, lab);
          else if (lab) h += `<div class="rfx-part">${ZZ('Part', '部分')} ${lab}</div>`;
          if (partOK) { lines.push(`<div class="rfx-p">${h}</div>`); return; }
          if (rest.length) {
            const steps = rest.some(([t]) => /[=×÷+−\-]\s*\d|\d\s*[=×÷+−]/.test(t)) && ans;
            h += `<div class="rfx-steps"><small>${steps ? ZZ('How to get it', '計法') : ans ? ZZ('Marks also given for', '其他得分要點') : ZZ('What the marker looked for', '得分要點')}</small>
              <ol class="${steps ? 'num' : 'pts'}">${rest.slice(0, 6).map(([t, got]) => `<li class="${steps ? '' : got ? 'got' : 'lost'}"><span class="rfx-dot">${steps ? '' : got ? '✓' : '✗'}</span><span data-keep>${esc(t)}</span></li>`).join('')}</ol></div>`;
            if (!ans && mine) h += `<div class="rfx-mine2"><small>${ZZ('You wrote', '你寫了')}</small><span data-keep>${esc(mine.slice(0, 300))}</span></div>`;
          }
          if (h) lines.push(`<div class="rfx-p">${h}</div>`);
        });
      }
      if (q.explanation) lines.push(`<div class="rfx-why2"><span class="rfx-bulb" aria-hidden="true">💡</span><span data-keep>${esc(plain(q.explanation))}</span></div>`);
      if (lines.length) fix = `<div class="rfix">${lines.join('')}</div>`;
    }
    return `<div class="rrow ${st}"><span class="rnum">Q${k + 1}</span><span class="rtext" data-raw>${esc(String(label).slice(0, 110))}${String(label).length > 110 ? '…' : ''}</span><span class="rmark">${g}/${m}</span>${fix}</div>`;
  }).join('');
  const missed = qs.filter((q, k) => (S.got[k] || 0) < marksOf(q));
  const missedIdx = qs.map((q, k) => k).filter((k) => (S.got[k] || 0) < marksOf(qs[k]));
  const drillable = missedIdx.filter((k) => canDrill(qs[k])).slice(0, 10); // drill up to 10 missed ideas
  const unitRef = S.units ? { book: S.book, units: S.units } : null;
  // Timed tests and mock exams count towards mastery (per chapter, only when finished).
  // Every finished test is also kept for the Progress page and the parent report (kind, title, score, time used).
  if (((S.mode === 'dse' && !S.ws) || S.mode === 'mock') && !S.endedEarly && !S.recorded) {
    S.recorded = true;
    const per = {};
    if (S.mode === 'dse') qs.forEach((q, k) => { const key = qUnit(q.id).join(':'); const r = per[key] || (per[key] = [0, 0]); r[0] += S.got[k] || 0; r[1] += marksOf(q); });
    local.tests = [...(local.tests || []), { t: Date.now(), per, kind: S.mode === 'mock' ? 'mini' : S.test ? 'test' : 'paper', title: S.title, b: S.book ? S.book.id : '', g: got, m: total, nt: S.deadline ? 0 : 1, x: S.extra || 0, min: Math.max(1, Math.round(((S.examEnd || Date.now()) - S.at) / 60000)) }].slice(-300); saveLocal();
  }
  if (S.ws && !S.endedEarly) saveWorksheetScore(S.ws, `${got} / ${total}`);
  const won = awardSession(qs, pct);
  if (S.pcheck && !S.endedEarly && !S.pcRecorded && S.book) {
    // Progress check: the same chapters as the level check, at the same level, to compare before and now
    S.pcRecorded = true; const per = {};
    qs.forEach((q, k) => { const u = qUnit(q.id)[1]; const x = per[u] || (per[u] = [0, 0]); x[0] += S.got[k] || 0; x[1] += marksOf(q); });
    local.pchecks = [...(local.pchecks || []), { t: Date.now(), b: S.book.id, per }].slice(-40); saveLocal();
  }
  if (!S.sessLogged && qs.length) {
    // One line per finished set, for the pilot dashboard: mode, size, score, minutes, rushed or not.
    S.sessLogged = true;
    local.sess = [...(local.sess || []), { t: Date.now(), k: S.mode || '', b: S.book ? S.book.id : '', n: qs.length, p: pct, min: Math.max(1, Math.round((Date.now() - S.at) / 60000)), r: rushedSet(qs) ? 1 : 0, e: S.endedEarly ? 1 : 0, ts: S.test ? 1 : 0 }].slice(-400);
    saveLocal();
  }
  if (won) setTimeout(() => { if (document.querySelector('main.results')) celebrate(won); }, 500);
  const nRight = qs.filter((q, k) => (S.got[k] || 0) === marksOf(q)).length;
  const nMiss = qs.filter((q, k) => !(S.got[k] || 0) && marksOf(q)).length;
  const nPart = qs.length - nRight - nMiss;
  const band = pct >= 85 ? 'good' : pct >= 50 ? 'mid' : '';
  const head = pct >= 85 ? 'Excellent work' : pct >= 70 ? 'Good, solid work' : pct >= 50 ? 'Getting there' : 'Worth another go';
  const sub = pct >= 85 ? 'You know this well. Reviews over the next few days will lock it in.'
    : pct >= 70 ? 'A few slips to tidy up, then you’re there.'
    : pct >= 50 ? 'Fix the ones you missed and you’ll be well on your way.'
    : S.units ? 'This set was tough. Buddy’s suggestion below is the quickest way up.' : 'This set was tough. Drilling the ones you missed is the fastest way up.';
  const sections = S.mode === 'dse' ? (() => {
    const sec = (from, to) => { const xs = qs.slice(from, to); return [xs.reduce((a, q, k) => a + (S.got[from + k] || 0), 0), xs.reduce((a, q) => a + marksOf(q), 0)]; };
    const [ga, ta] = sec(0, S.sectionA), [gb, tb] = sec(S.sectionA, qs.length);
    return `<div class="rsecs">${ta ? `<div><span>Section A · MCQ</span><b>${ga} / ${ta}</b></div>` : ''}${tb ? `<div><span>Section B · written</span><b>${gb} / ${tb}</b></div>` : ''}</div>`;
  })() : '';
  const X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const V = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const H = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
  // Results show the side menu (as part of Books, or Today) and a back button, so it's clear where to go next.
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${S.book ? 'Chapters' : 'Home'}</span></button></div>
  <main class="pad results" data-view="${S.book ? 'books' : 'home'}">
    <div class="r-left">
    <section class="rhero ${band}">
      <span class="rmeta">${esc(S.title)} · ${S.endedEarly ? `stopped after ${qs.length}` : 'done'}</span>
      <div class="rtop"><div class="ring ${band}" style="--p:${pct}" role="img" aria-label="${pct}%"><span>${pct}%</span></div>
        <div class="rhead"><b>${head}</b><span>${got} of ${total} mark${total === 1 ? '' : 's'}</span></div>
        <span class="rbuddy">${buddySVG(pct >= 85 ? 'done' : pct >= 50 ? 'happy' : 'think', 76)}</span></div>
      <p class="rsub">${sub}</p>
      <div class="rcounts"><span class="right">${V} ${nRight} right</span>${nPart ? `<span class="part">${H} ${nPart} partly</span>` : ''}<span class="miss">${X} ${nMiss} missed</span></div>
      ${sections}
      ${starsOn() && S.starNote ? `<p class="starnote">${starSVG(16)} ${esc(S.starNote)}</p>` : ''}
    </section>
    <div class="ractions">
      ${unitRef ? `<section class="rsugg" id="rsugg" aria-live="polite"><div class="rsg-head">${buddySVG('happy', 30)}<b>${LANG === 'zh' ? 'Buddy 建議' : 'Buddy suggests'}</b></div><div class="rsg-body"><span class="dots"><i></i><i></i><i></i></span></div></section>` : ''}
      ${!unitRef && drillable.length ? `<button class="btn" id="drillall">${ICON.target.replace('width="22" height="22"', 'width="18" height="18"').replace('var(--miss)', 'currentColor')} <span class="rprim">${LANG === 'zh' ? '針對弱項練習' : 'Drill my weak spots'}<small>${LANG === 'zh' ? `${drillable.length * PER_IDEA} 條針對答錯內容的新題目` : `${drillable.length * PER_IDEA} new questions on what you missed`}</small></span></button>` : ''}
      ${(() => {
        // Primary: drill if there are weak spots, otherwise more questions. The rest sit in one tidy list.
        const sv = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
        const I = { more: sv('<path d="M12 5v14M5 12h14"/>'), retry: sv('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'), redo: sv('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'), book: sv('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>'), home: sv('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>') };
        const row = (id, icon, tone, t, sub) => `<button class="ropt" id="${id}"><span class="ropt-i ${tone}">${icon}</span><span class="ropt-t"><b>${t}</b><small>${sub}</small></span><span class="ropt-go" aria-hidden="true">›</span></button>`;
        const n = S.count || sessionSize(), many = unitRef && unitRef.units.length > 1, Z = (en, zh) => (LANG === 'zh' ? zh : en);
        const prim = '';
        const rows = [
          drillable.length && unitRef ? row('drillall', I.target || ICON.target.replace('width="22" height="22"', 'width="20" height="20"').replace('var(--miss)', 'currentColor'), 'red', Z('Drill my weak spots', '針對弱項練習'), Z(`${drillable.length * PER_IDEA} new questions on what you missed`, `${drillable.length * PER_IDEA} 條針對答錯概念的新題目`)) : '',
          unitRef ? row('more', I.more, 'blue', Z(`${n} more questions`, `再做 ${n} 題`), many ? Z('New questions on these chapters', '這些章節的新題目') : Z('New questions on this chapter', '這一章的新題目')) : '',
          missed.length ? row('retry', I.retry, 'red', Z(`Retry the ${missed.length} I missed`, `重做答錯的 ${missed.length} 題`), Z('Same questions, until they stick', '同樣的題目，直到記熟為止')) : '',
          qs.length ? row('redo', I.redo, 'violet', Z('Redo this set', '重做這一組'), Z('The same questions, shuffled', '同樣的題目，次序打亂')) : '',
          row('home', S.book ? I.book : I.home, 'grey', S.book ? Z('Back to chapters', '返回章節') : Z('Back to home', '返回主頁'), S.book ? Z('Pick another chapter or activity', '選擇其他章節或活動') : Z('See today’s plan', '查看今日計劃')),
        ].filter(Boolean).join('');
        return `${prim}${rows ? `<div class="rmore"><h3 class="rmore-h">${unitRef ? Z('Or choose for yourself', '或者自己選擇') : Z('What next?', '下一步')}</h3><div class="ropts card">${rows}</div></div>` : ''}`;
      })()}
    </div>
    </div>
    <section class="rlist"><h2>Your answers</h2>
      ${S.mode === 'spaced' ? `<p class="hint" style="margin:0 0 8px;line-height:1.5">Questions you got right come back later and later. The ones you missed come back tomorrow.</p>` : ''}
      <div class="card">${list}</div></section>
    </main>`;
  const leave = () => (S.book ? go({ name: 'book', bookId: S.book.id }) : go({ name: 'home' }));
  document.getElementById('home').onclick = leave;
  document.getElementById('back').onclick = leave;
  const m = document.getElementById('more'); if (m) m.onclick = () => startUnits(unitRef.book, unitRef.units, S.count || sessionSize());
  const r = document.getElementById('retry');
  const again = (list, title) => { const l = shuffle(list).map(shuffleOptions); S = newSession({ mode: 'retry', title, book: S.book, qs: l, target: l.length }); renderQuestion(); };
  if (r) r.onclick = () => again(missed, 'Retry');
  const rd = document.getElementById('redo'); if (rd) rd.onclick = () => again(qs, 'Redo');
  const drill = () => { const items = drillable.map((k) => ({ q: qs[k], idea: missedIdea(qs[k], k) })); startDrills(items, S.book, S.types || 'mix'); };
  const da = document.getElementById('drillall');
  if (da) da.onclick = drill;
  if (unitRef) fillSuggestion({ unitRef, qs, pct, missed, drillable, drill, again: () => again(qs, 'Redo'), rushed: rushedSet(qs), at: S.at, mode: S.mode });
  window.scrollTo(0, 0);
}

/* ---------- Buddy suggests: the best next step after a set ----------
   Worked out from this set (score, speed, question levels), the chapter (lesson done? test passed? mastery) and how the
   child did on it before. Always optional: the other choices sit underneath. */
async function fillSuggestion({ unitRef, qs, pct, missed, drillable, drill, again, rushed, at, mode }) {
  const box = document.getElementById('rsugg'); if (!box) return;
  const Z = (en, zh) => (LANG === 'zh' ? zh : en);
  const book = unitRef.book, u = unitRef.units[0], one = unitRef.units.length === 1;
  const key = `${book.id}:${u.id}`, learned = !!(local.learned || {})[key];
  let ch = null; try { ch = (await bookMastery(book)).chapters.find((c) => c.unit.id === u.id) || null; } catch (e) {}
  // How this chapter went before this set (first tries only).
  const before = (local.log || []).filter((e) => e.t < at && String(e.q).startsWith(key + ':'));
  const prevPct = before.length >= 4 ? Math.round(100 * before.reduce((a, e) => a + (e.g || 0), 0) / Math.max(1, before.reduce((a, e) => a + (e.m || 1), 0))) : null;
  const avgLv = qs.length ? qs.reduce((a, q) => a + (q.level || 2), 0) / qs.length : 2;
  const canHard = !limitOf('hardDiff');
  const idx = book.units.findIndex((x) => x.id === u.id), nextU = one ? book.units.slice(idx + 1).find((x) => !NOT_TEACHING.test(String(x.title))) : null;
  const name = shortTitle(u.title);
  const focus = (fn) => () => { pick = { bookId: book.id, ids: new Set(unitRef.units.map((x) => x.id)) }; fn(); };
  let s = null, alt = null;
  if (rushed) s = { t: Z('Slow down and redo this set', '放慢一點，重做這一組'), why: Z('The answers came very fast. Reading each question properly is the quickest way to a better score.', '你答得很快。逐題細心讀，是最快提升分數的方法。'), go: Z('Redo this set', '重做這一組'), run: again };
  else if (pct < 50 && !learned && one) {
    s = { t: Z(`Take the lesson on ${name}`, `先上「${name}」這一課`), why: Z('This set was tough and you haven’t done the lesson for this chapter yet. It teaches the ideas step by step with quick checks, so the next set feels much easier.', '這一組比較難，而你還未上這一章的課。課堂會一步步講解並有小測，之後再做題會容易得多。'), go: Z('Start the lesson', '開始上課'), run: () => go({ name: 'learn', bookId: book.id, unitId: u.id }) };
    if (drillable.length) alt = { go: Z('Drill my weak spots instead', '改為針對弱項練習'), run: drill };
  } else if (pct < 50) {
    s = { t: Z('Read the key points, then try again', '先溫習重點，再試一次'), why: Z(`The ideas haven’t stuck yet. Two minutes with the revision notes${one ? ` for ${name}` : ''}, then a drill on the ${missed.length} you missed, works better than more of the same.`, `概念還未記牢。先花兩分鐘看${one ? `「${name}」的` : ''}溫習筆記，再針對答錯的 ${missed.length} 題練習，比繼續做同類題更有效。`), go: Z('Open revision notes', '打開溫習筆記'), run: focus(() => go({ name: 'notes', bookId: book.id })) };
    if (drillable.length) alt = { go: Z('Drill my weak spots', '針對弱項練習'), run: drill };
  } else if (pct < 80 && drillable.length) {
    s = { t: Z('Drill your weak spots', '針對弱項練習'), why: Z(`You’re close. ${drillable.length === 1 ? 'One idea' : `${drillable.length} ideas`} tripped you up; new questions on exactly ${drillable.length === 1 ? 'that' : 'those'} will fix ${drillable.length === 1 ? 'it' : 'them'} fastest.`, `差一點就到了。有 ${drillable.length} 個概念出錯，針對它們做新題目最快改正。`), go: Z('Start the drill', '開始練習'), run: drill };
    alt = { go: Z('Flashcards for this chapter', '這一章的閃卡'), run: focus(() => go({ name: 'cards', bookId: book.id })) };
  } else if (pct >= 80 && avgLv < 2.6 && canHard) {
    s = { t: Z('Ready for harder questions', '可以挑戰較深的題目'), why: Z(`You got ${pct}% on mostly recall and understanding questions. Apply and analyse questions are what school exams use to separate the top marks.`, `你在記憶和理解題答對了 ${pct}%。應用和分析題才是考試拉開分數的地方。`), go: Z('Try harder questions', '挑戰較深題目'), run: () => startUnits(book, unitRef.units, S && S.count || sessionSize(), { diff: 'hard' }) };
  } else if (pct >= 80 && ch && !ch.passDays && !locked('test')) {
    s = { t: Z(`Take the chapter test on ${name}`, `做「${name}」的章節測驗`), why: Z('You’re doing well in practice. Passing a timed test (80%+) is what proves it and moves this chapter past 70% ready.', '練習做得不錯。通過限時測驗（80% 或以上）才能證明你掌握了，並令這一章的準備度超過 70%。'), go: Z('Start the test', '開始測驗'), run: () => startChapterTest(book, unitRef.units) };
  } else if (pct >= 80 && nextU) {
    const nl = !!(local.learned || {})[`${book.id}:${nextU.id}`];
    s = { t: Z(`Move on to ${shortTitle(nextU.title)}`, `繼續下一章「${shortTitle(nextU.title)}」`), why: Z(`${name} is in good shape${ch && ch.passDays ? ' and you’ve passed its test' : ''}. Reviews will bring it back at the right time.`, `「${name}」掌握得不錯${ch && ch.passDays ? '，測驗也合格了' : ''}。之後會在適當時間提醒你溫習。`), go: nl ? Z('Practise it', '練習') : Z('Start its lesson', '開始上課'), run: nl ? () => startUnits(book, [nextU]) : () => go({ name: 'learn', bookId: book.id, unitId: nextU.id }) };
  } else if (drillable.length) {
    s = { t: Z('Drill your weak spots', '針對弱項練習'), why: Z('A few slips to tidy up. New questions on the ideas you missed lock them in.', '有幾個小錯要改正。針對答錯的概念做新題目，能把它們記牢。'), go: Z('Start the drill', '開始練習'), run: drill };
  } else {
    s = { t: Z('Great set. Keep it fresh', '做得好！保持記憶'), why: Z('Nothing to fix here. Come back for your reviews over the next few days and it will stick.', '沒有需要改正的地方。接下來幾天回來溫習，就會記得牢。'), go: Z('Back to chapters', '返回章節'), run: () => go({ name: 'book', bookId: book.id }) };
  }
  const trend = prevPct === null ? '' : pct > prevPct + 4 ? Z(`Up from ${prevPct}% before on this chapter.`, `比之前在這一章的 ${prevPct}% 進步了。`) : pct < prevPct - 4 ? Z(`Below your ${prevPct}% before on this chapter.`, `低於之前在這一章的 ${prevPct}%。`) : Z(`About the same as before on this chapter (${prevPct}%).`, `與之前在這一章差不多（${prevPct}%）。`);
  const mast = ch ? Z(`Chapter ready: ${ch.pct}%`, `本章準備度：${ch.pct}%`) : '';
  if (!document.body.contains(box)) return;
  // the chapter's readiness as a big ring with a plain label, so it is the first thing a child sees
  const rp = ch ? Math.max(0, Math.min(100, ch.pct)) : null, rc = rp === null ? '' : rp >= 70 ? 'hi' : rp >= 40 ? 'mid' : 'lo';
  const rlab = rp === null ? '' : rp >= 70 ? Z('Nearly test-ready', '差不多可以應考') : rp >= 40 ? Z('Getting there', '漸入佳境') : Z('Just started', '剛剛起步');
  const meter = rp === null ? '' : `<div class="rsg-meter ${rc}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="tr"/><circle cx="18" cy="18" r="15.5" class="fg" stroke-dasharray="${(rp * 0.974).toFixed(1)} 100"/></svg><b>${rp}%</b></div>
    <div class="rsg-mtxt"><small>${esc(Z('Chapter ready for the test', '本章應考準備度'))}</small><b>${esc(rlab)}</b>${trend ? `<span class="rsg-trend ${pct > (prevPct || 0) + 4 ? 'up' : pct < (prevPct || 0) - 4 ? 'down' : ''}">${esc(Z(`This set: ${pct}%. `, `今次：${pct}%。`) + trend)}</span>` : `<span class="rsg-trend">${esc(Z(`This set: ${pct}%`, `今次：${pct}%`))}</span>`}</div>`;
  box.querySelector('.rsg-body').innerHTML = `${meter ? `<div class="rsg-ready">${meter}</div>` : ''}
    <div class="rsg-next"><small>${esc(Z('Next step', '下一步'))}</small><h3 class="rsg-t">${esc(s.t)}</h3><p class="rsg-why">${esc(s.why)}</p></div>
    ${!meter && trend ? `<div class="rsg-facts"><span>${esc(trend)}</span></div>` : ''}
    <div class="rsg-btns"><button class="btn" id="rsgGo">${esc(s.go)}</button>${alt ? `<button class="btn ghost" id="rsgAlt">${esc(alt.go)}</button>` : ''}</div>`;
  document.getElementById('rsgGo').onclick = s.run;
  if (alt) document.getElementById('rsgAlt').onclick = alt.run;
  track('suggest_shown');
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
// Extra time during a test (counted, so the results can say so).
document.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('#addtime') || !S || !S.deadline || S.review) return;
  S.deadline += 5 * 60 * 1000; S.extra = (S.extra || 0) + 5; toast('5 minutes added');
  const el = document.getElementById('timer'); if (el) el.classList.remove('low');
});

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
    const b = document.querySelector('#next:not(:disabled), #check:not(:disabled), #startnow'); if (b) { e.preventDefault(); b.click(); }
  }
});

// Formulas: anything between $…$ (written by the AI in LaTeX) is drawn as proper maths/chemistry.
const MATH_OPTS = {
  delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'svg', 'input'],
  ignoredClasses: ['nomath'],
  throwOnError: false,
};
// The AI sometimes writes plain sums in LaTeX ("$100{,}000 - 97{,}799 = 2{,}201$"). Drawn as maths these switch to a
// serif font, and a slip in the LaTeX leaves "{,}" on screen. Plain arithmetic is turned back into normal text, a
// stray "{,}" becomes a comma, and words inside real formulas are set upright instead of in italics.
const PLAIN_SUM = /^[\s\d.,+\-−×÷=%()\/:<>≈]*$/;
function tidyMath(text) {
  let out = text.replace(/(\$\$?)([^$]+?)\1/g, (m, d, inner) => {
    const flat = inner.replace(/\{,\}/g, ',').replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/\\cdot/g, '×')
      .replace(/\\%/g, '%').replace(/\\approx/g, '≈').replace(/\\[,;:! ]/g, ' ').replace(/\\left|\\right/g, '')
      .replace(/\\(?:text|mathrm)\{\s*(HKD|USD|RMB)\s*\}/g, '$1').replace(/\s+/g, ' ').trim();
    const bare = flat.replace(/\b(HKD|USD|RMB)\b/g, '');
    if (/\d/.test(bare) && PLAIN_SUM.test(bare)) return flat.replace(/(\d) ?- ?(\d)/g, '$1 − $2').replace(/ ?([=×÷+−]) ?/g, ' $1 ');
    if (/\\ce\{/.test(inner)) return m;
    // whole words (3+ letters, not commands) inside a formula are words, not variables: set them upright
    return d + inner.replace(/(^|[^\\A-Za-z{])([A-Za-z]{3,})(?![A-Za-z{])/g, '$1\\text{$2}') + d;
  });
  return out.replace(/(\d)\{,\}(\d)/g, '$1,$2');
}
function tidyMathIn(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('.nomath,.katex,textarea,script,style,code,pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { const v = n.nodeValue; if (v.includes('$') || v.includes('{,}')) { const t = tidyMath(v); if (t !== v) n.nodeValue = t; } }
}
function renderMath(root) {
  if (!root || root.nodeType !== 1) return;
  if (/\$|\{,\}/.test(root.textContent || '')) tidyMathIn(root);
  if (!window.renderMathInElement) return;
  if (!/\$|\\\(/.test(root.textContent || '')) return;
  try { window.renderMathInElement(root, MATH_OPTS); } catch (e) {}
}
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.closest('.katex')) renderMath(n); });
}).observe(document.body, { childList: true, subtree: true });

{ const st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.appendChild(st); }
initLang();
// French and Japanese screens: new English text is translated by the AI in batches (needs the family code; not counted as AI use).
setTranslator(async (lang, strings, screen) => { if (!local.code) throw new Error('no code'); return (await apiOnce('uitr', { lang, strings, screen })).out; });
watch(document.body);
// Question-writing rules change over time. When they do, questions made under the old rules that the student
// hasn't answered yet are dropped once, so they're remade under the new ones. Answered questions (and so all
// progress and mistakes) are kept.
const QRULES = 2; // 2: every condition stated (no unstated variants such as worst-of / average baskets)
async function refreshOldQuestions() {
  if ((local.qrules || 1) >= QRULES) return;
  for (const b of await getBooks()) {
    const keys = b.units.map((u) => `qs:${b.id}:${u.id}`);
    const lists = await store.getMany(keys, []);
    for (let i = 0; i < keys.length; i++) {
      const list = lists[i] || [];
      const keep = list.filter((q) => q.checked === 'human' || local.stats[q.id] || (local.mistakes || {})[q.id]); // starter-book questions are hand-written: never dropped
      if (keep.length !== list.length) await store.set(keys[i], keep);
    }
  }
  local.qrules = QRULES; saveLocal();
}
getBooks().then(pruneMistakes).catch(() => {});
// "i" buttons open their explainer in a pop-up you close when you're done reading
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-how]'); if (!b) return;
  const d = document.getElementById(b.dataset.how); if (!d) return;
  const body = d.querySelector(':scope > div'); if (!body) return;
  document.querySelectorAll('.cdlg-wrap').forEach((x) => x.remove());
  const Z = (en, zh) => (LANG === 'zh' ? zh : en), back = document.activeElement;
  const w = document.createElement('div');
  w.className = 'cdlg-wrap';
  w.innerHTML = `<div class="cdlg how-dlg" role="dialog" aria-modal="true" aria-labelledby="howT">
    <div class="how-dlg-h"><h2 id="howT">${esc(b.getAttribute('aria-label') || '')}</h2><button type="button" class="how-x" aria-label="${Z('Close', '關閉')}">${ICON.close || '✕'}</button></div>
    <div class="how-dlg-b">${body.innerHTML}</div>
    <button type="button" class="btn how-ok">${Z('Got it', '明白了')}</button></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); w.remove(); if (back && back.focus) back.focus(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); done(); } ev.stopPropagation(); };
  document.addEventListener('keydown', onKey, true);
  w.onclick = (ev) => { if (ev.target === w) done(); };
  w.querySelector('.how-x').onclick = done; w.querySelector('.how-ok').onclick = done;
  // buttons inside a pop-up (steps on the Progress page, the guide link) act and close it
  w.querySelectorAll('[data-pv]').forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); const f = (window.__pvActs || [])[+x.dataset.pv]; done(); if (f) f(); }));
  document.body.appendChild(w);
  // open at the top: the title first, not scrolled down to the button
  const bd = w.querySelector('.how-dlg-b'); if (bd) bd.scrollTop = 0; w.querySelector('.how-dlg').scrollTop = 0;
  w.querySelector('.how-ok').focus({ preventScroll: true });
});
flushReports().catch(() => {});
pilotGate().then(async () => { if ((await getBooks()).some((b) => b.demo)) await removeDemo(); }).then(() => pilotWelcome()).then(() => refreshOldQuestions().catch(() => {})).finally(async () => {
  let v = urlView() || { name: 'home' };
  // a screen whose book or item is gone (another device, cleared data) falls back to Today
  if (v.bookId && !(await getBooks()).some((b) => b.id === v.bookId)) v = { name: 'home' };
  if (v.name !== 'home') { navStack = [{ name: 'home' }]; navSet({ v: { name: 'home' }, d: 0 }, false); }
  go(v);
  setTimeout(() => pilotSync(true), 8000);
  setTimeout(offerResume, 400);
});
