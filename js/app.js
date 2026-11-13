// PrepBuddy app: books, chapters, on-demand questions, practice sessions.
import * as store from './store.js';
import { DEMO_ID, installDemo, removeDemo } from './demo.js';
import { buildReport, encodeReport, headline, weekTone, minutesOf, skillsHTML, REPORT_CSS, reportHTML } from './report.js';
import { initLang, setLang, watch, LANG } from './i18n.js';
import { startVoice, voiceSupported } from './voice.js';
import { logoSVG, buddySVG, buddyFace } from './buddy.js';
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
const matchType = (q, types) => !types || types === 'mix' || (types === 'mcq' ? choiceType(q) : !choiceType(q));
// Difficulty the student picks. Auto adapts to how they're doing; the others keep questions to these levels
// (1 Recall, 2 Understand, 3 Apply, 4 Analyse / evaluate).
const DIFFS = [['auto', 'Auto'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['master', 'Master']];
const DIFF_RANGE = { easy: [1, 2], medium: [2, 3], hard: [3, 4], master: [4, 4] };
const curDiff = () => { const d = local.diff || 'auto'; return limitOf('hardDiff') || d === 'easy' || d === 'medium' ? d : 'medium'; };
const diffOK = (q, diff) => { const r = DIFF_RANGE[diff]; if (!r) return true; const l = q.level || 2; return l >= r[0] && l <= r[1]; };
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
const inSession = () => document.getElementById('quit');
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
function chapterMastery(book, u, qs, text, ntextPre) {
  const T = chapterTarget(u), now = Date.now();
  const key = `${book.id}:${u.id}`;
  const st = (q) => local.stats[q.id];
  const done = qs.filter((q) => st(q));
  const good = (q) => (st(q).last || 0) >= 0.7;
  // covered: every part of the chapter has a question answered well
  const pages = u.startPage && u.endPage ? u.endPage - u.startPage + 1 : 8;
  const parts = Math.max(3, Math.min(6, Math.round(pages / 2)));
  const ntext = ntextPre !== undefined ? ntextPre : (text ? normQ(text) : '');
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
  const pct = Math.round(chapters.reduce((t, c) => t + c.pct * c.weight, 0) / w);
  const areas = Object.fromEntries(AREAS.map(([k]) => [k, chapters.reduce((t, c) => t + c.score[k] * c.weight, 0) / w]));
  return { pct, chapters, areas };
}
const cleanUnitTitle = (t) => String(t).replace(/\s*\*+\s*$/, '');
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
      else if (c.passDays < 2 || !c.lastPass) opts.push([0.9, `Pass another chapter test on ${t} on a different day`, 'test']);
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
    <details class="areas"><summary>How this is worked out</summary>${AREAS.map(([k, label, w]) => { const v = Math.round(100 * m.areas[k]); return `<div class="area"><span>${label}<small>${w}%</small></span><span class="abar"><i style="width:${v}%" class="${v >= 85 ? 'good' : v >= 50 ? 'mid' : ''}"></i></span><b>${v}%</b></div>`; }).join('')}
      <p class="hint" style="margin:6px 0 0">A chapter can’t go above 70% until you pass a timed test on it, or reach 100% until you’ve passed two on different days.</p></details>
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
    r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': local.code || '' }, body: JSON.stringify({ ...body, stream: true }) });
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

/* ---------- navigation: the phone's Back gesture and the browser's Back button work everywhere ----------
   Every screen change is a history entry. Back closes an open dialog or the Buddy panel first; during practice
   it asks before leaving, like the Back button on screen. A screen's own back button goes to the screen you
   came from (a real step back), so the two never disagree. */
let navStack = [], navPopping = false, navCur = null;
const navKey = (v) => JSON.stringify(v || {});
// Each screen has its own address (#/book?bookId=…), so a refresh, a bookmark or a shared link opens the same screen.
const URL_OK = ['home', 'books', 'book', 'library', 'usage', 'settings', 'progress', 'stars', 'homework', 'dictation', 'writing', 'speaking', 'plans', 'learn', 'paper', 'pick', 'worksheets', 'notes', 'edit', 'mistakes', 'cards'];
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
const backTop = (fb, label) => `<div class="topbar pagetop"><button class="backbtn" data-goback='${esc(JSON.stringify(fb))}'>${ICON.back}<span>${esc(label === 'Back' ? (LANG === 'zh' ? '返回' : 'Back') : label)}</span></button></div>`;
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
window.addEventListener('popstate', (e) => {
  if (document.querySelector('main.pilotgate')) { try { history.pushState(history.state, '', location.href); } catch (er) {} return; } // the code and consent screens can't be skipped with Back
  const was = navCur;
  const dlg = [...document.querySelectorAll('.cdlg-wrap')].pop();
  if (dlg) { if (was) navSet(was, true); dlg.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
  if (helper.open) { if (was) navSet(was, true); helperClose(); return; }
  const q = inSession();
  if (q && !(e.state && e.state.session)) { if (was) navSet(was, true); q.click(); return; }
  const st = e.state && e.state.v ? e.state : { v: urlView() || { name: 'home' }, d: navStack.length }; // typed or pasted address: open it
  navCur = st;
  navStack = navStack.slice(0, st.d || 0); navStack[st.d || 0] = st.v;
  navPopping = true;
  try { go(st.v); } finally { navPopping = false; }
});

async function go(v) {
  if ((v.name === 'paper' || (v.name === 'pick' && v.mode === 'mock')) && !allow('mock')) return; // plan checks before leaving the screen
  { const f = { homework: 'homework', writing: 'writing', speaking: 'speaking', stars: 'stars' }[v.name]; if (f && locked(f) && !TOURING) return upsell(f, 'locked'); }
  // a screen's back button pointing at the screen we came from = a real step back
  if (!navPopping && navStack.length >= 2 && navKey(navStack[navStack.length - 2]) === navKey(v) && !(history.state && history.state.session)) { try { history.back(); return; } catch (e) {} }
  navPush(v);
  view = v;
  track('screen:' + v.name);
  getBooks().then((bs) => { bs.forEach((b) => { bookKinds.set(b.id, kindOfBook(b)); aliases.set(b.id, b.alias || {}); }); const pr = bs.some(looksPrimary); if (pr !== primaryCache) { primaryCache = pr; renderTabs(); } });
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  stopTimer();
  if (v.name === 'home') return renderHome();
  if (v.name === 'books') return renderBooks();
  if (v.name === 'book') return renderBook(v.bookId);
  if (v.name === 'library') return renderLibrary(v.query || '');
  if (v.name === 'usage') return renderUsage();
  if (v.name === 'settings') return renderSettings();
  if (v.name === 'progress') return renderProgress();
  if (v.name === 'stars') return renderStars();
  if (v.name === 'homework') return renderHomework(v.id);
  if (v.name === 'dictation') return renderDictation(v.id, v.sub);
  if (v.name === 'writing') return renderWriting(v.id, v.sub);
  if (v.name === 'speaking') return renderSpeaking(v.id, v.sub, v.qi);
  if (v.name === 'plans') return renderPlans(v.hi);
  if (v.name === 'parent') return renderParent();
  if (v.name === 'learn') return renderLearn(v.bookId, v.unitId);
  if (v.name === 'paper') return renderPaper(v.bookId, v.from);
  if (v.name === 'pick') return renderPick(v.mode);
  if (v.name === 'worksheets') return renderWorksheets();
  if (v.name === 'notes') return renderNotes(v.bookId);
  if (v.name === 'edit') return renderEdit(v.bookId);
  if (v.name === 'mistakes') return renderMistakes(v.tab || 'todo', v.book);
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
function voicePanelHTML() {
  return `<div class="vpanel" id="vov" data-state="${VC.state}" data-raw tabindex="-1">
    <div class="vorbbox"><canvas id="vovOrb" aria-hidden="true"></canvas><svg class="vbuddy" id="vovBuddy" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${buddyFace('listen')}</svg></div>
    <div class="vov-state" id="vovState" aria-live="polite">${VSTATE_BIG()}</div>
    <div class="vov-hint" id="vovHint">${VHINT()}</div>
    <div class="vov-cap" id="vovCap"></div>
    <div class="vov-ctrls">
      <button class="vov-cc ${local.voiceCC ? 'on' : ''}" id="vovCC" aria-pressed="${local.voiceCC ? 'true' : 'false'}" title="${VL('Show what’s being said', '顯示字幕')}">CC</button>
      <button class="vov-lang" id="vovLang">${VC.lang === 'yue' ? '廣東話' : 'English'}</button>
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
    document.getElementById('vovLang').textContent = VC.lang === 'yue' ? '廣東話' : 'English';
    const cap = document.getElementById('vovCap');
    cap.textContent = local.voiceCC ? (VC.state === 'speaking' ? VC.saying : VC.state === 'listening' ? VC.heard : '') : '';
    cap.className = `vov-cap ${VC.state === 'speaking' ? 'ai' : ''}`;
  }
}
function bindVoiceBar() {
  const el = document.getElementById('vov'); if (!el) return;
  el.querySelector('#vovEnd').onclick = () => VC.ctrl && VC.ctrl.stop();
  el.querySelector('#vovLang').onclick = () => VC.ctrl && VC.ctrl.setLang(VC.lang === 'yue' ? 'en' : 'yue');
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
  Object.assign(VC, { where, key, state: 'listening', heard: '', saying: '', lang });
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
  const lines = [`Today: ${new Date().toDateString()}. Student name: ${local.name || '(not given)'}.`,
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
    for (const x of up) { const b = books.find((y) => y.id === x.b); const bi = books.indexOf(b); if (!b) continue;
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
    case 'practise': if (book && units.length) return startUnits(book, units, Math.min(30, Math.max(5, Number(a.count) || SESSION_SIZE))); break;
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
  if (locked('coach')) return `<div class="coach-head"><span class="coach-ic buddy-ic" aria-hidden="true">${buddySVG('happy', 46)}</span><div><b>${PL('Study coach', '溫習教練')} <span class="lock-tag inl">🔒 Plus</span></b><span>${PL('Plans your day from your scores and mistakes', '按你的分數和錯題計劃每天溫習')}</span></div></div>
    <div class="coach-msgs coach-demo"><div class="tmsg me nomath">${PL('What should I work on today?', '我今天應該溫習甚麼？')}</div><div class="tmsg ai">${PL('Your weakest chapter is <b>Forces</b> (52%). Let’s do 10 questions on it, then fix the 3 mistakes from Monday. About 15 minutes.', '你最弱的章節是<b>力</b>（52%）。先做 10 題，再改正星期一的 3 題錯題，大約 15 分鐘。')}</div><div class="coach-acts"><span class="btn-sm primary">▶ ${PL('Start 10 questions', '開始 10 題')}</span></div></div>
    <div class="coach-lock"><span>${PL('Upgrade to Plus for a coach that sees your progress and plans every day.', '升級至 Plus，教練會按你的進度每天幫你計劃。')}</span><button class="btn" id="coachUp">${PL('See Plus', '查看 Plus')}</button></div>`;
  const msgs = local.coach || [];
  return `<div class="coach-head"><span class="coach-ic buddy-ic" aria-hidden="true">${buddySVG('happy', 46)}</span><div>${helper.open ? '<b>Ask Buddy</b><span>About the app or your studies</span>' : '<b>Ask Buddy</b><span>Your study coach: sees your scores, mistakes and reviews</span>'}</div>
      <span style="margin-left:auto;display:flex;gap:6px">${msgs.length && !coach.busy && !voiceOn('coach') ? '<button class="btn-sm quiet" id="coachClear">Clear</button>' : ''}
      ${voiceOn('coach') ? '' : `<button class="vtalk" id="coachTalk">${ICON.mic} Talk${locked('voice') ? ' 🔒' : ''}</button>`}</span></div>
    ${voiceOn('coach') ? voicePanelHTML() + (coach.error ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(coach.error)}</p>` : '') : `<div class="coach-msgs" id="coachMsgs">
      <div class="tmsg ai">${helper.open ? `Need help? Ask me anything about PrepBuddy or your studies.` : `Hi${local.name ? ` ${esc(local.name)}` : ''}! Ask me how you’re doing, what to focus on, or for a study plan.`}</div>
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
      const req = { snapshot: await coachSnapshot(), ask: text, history, lang: voice ? (voice === 'yue' ? 'zh' : 'en') : LANG, voice, screen: SCREEN_NAME[view && view.name] || (view && view.name) || 'Today' };
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
      <div class="hw-list">${list.slice().reverse().map((x) => `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">📝</span><span class="hw-it"><b>${esc(x.title || HW('Homework', '功課'))}</b><small>${esc([x.subject, x.level].filter(Boolean).join(' · '))}${x.subject || x.level ? ' · ' : ''}${new Date(x.t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' })} · ${x.questions.length} ${HW('questions', '題')}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div></section>` : ''}
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
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${HW('Homework', '功課')}</span></button><span style="font-weight:600;font-size:15px" data-raw>${esc(hw.title || '')}</span></div>
    <main class="hwchat" data-view="homework" data-raw style="flex:1">
      <section class="hw-qs">
        ${photos.length ? `<div class="hw-thumbs small">${photos.map((p, i) => `<button class="hw-th" data-zoom="${i}" aria-label="${HW(`Open photo ${i + 1}`, `打開相片 ${i + 1}`)}"><img src="${p}" alt=""></button>`).join('')}</div>` : ''}
        ${hw.note ? `<p class="hint" style="margin:0">⚠️ ${esc(hw.note)}</p>` : ''}
        <div class="hw-qlist">${hw.questions.map((q, i) => `<div class="hw-q ${hw.cur === i ? 'on' : ''}"><div class="hw-qt"><b>${esc(q.label || String(i + 1))}</b><div class="hw-qx">${tutorMd(q.text)}</div>${q.student_answer ? `<small>${HW('Your answer', '你的答案')}: ${esc(q.student_answer)}</small>` : ''}</div>
          <button class="btn-sm ${hw.cur === i ? 'primary' : ''}" data-help="${i}">${HW('Help me', '幫我')}</button></div>`).join('')}</div>
      </section>
      <section class="tchat hw-tchat" id="hwchat">
        <div class="thead"><b class="thead-t">${buddySVG('happy', 28)}<span>${HW('Ask Buddy', '問 Buddy')}<small>${HW('Hints and checking, not answers to copy', '提示和檢查，不是直接給答案')}</small></span></b></div>
        <div class="tlog" id="hwlog">
          ${!msgs.length ? `<div class="tmsg ai">${HW(`I’ve read your homework: ${hw.questions.length} question${hw.questions.length === 1 ? '' : 's'}. Tap <b>Help me</b> on one, or tell me which one you’re stuck on. Try it first, then show me your answer and I’ll check it!`, `我已經讀了你的功課，共 ${hw.questions.length} 題。按題目旁的<b>幫我</b>，或告訴我你哪一題不會。先自己試試，再把答案告訴我，我幫你檢查！`)}</div>` : ''}
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
    $app.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => ask(b.dataset.say)));
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
};
const wrState = { kind: null, prompt: '', topic: '', busy: '', error: null, open: {} };
const wrCount = (text, lang) => (lang === 'zh' ? String(text || '').replace(/[\s\p{P}]/gu, '').length : (String(text || '').match(/[A-Za-z’'-]+/g) || []).length);
// A rough overall DSE level from the criterion bands (weighted mean of 1-7 bands). An estimate only.
function wrLevel(fb, kind) {
  const k = WR_KINDS[kind]; if (!fb || !fb.criteria) return null;
  let s = 0, w = 0;
  fb.criteria.forEach((c, i) => { const wt = k.w[i] || 1; s += c.band * wt; w += wt; });
  const m = s / (w || 1);
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
  if (zh ? wordCount(text) < 150 : wordCount(text) < 80) return false;
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
    <section class="hw-hero">${buddySVG('happy', 56)}<div><b>${WT('Write, get DSE-style feedback, then make it better.', '寫作、取得 DSE 式評語，再改得更好。')}</b>
      <span>${WT('Buddy marks by the DSE criteria, shows what to fix first, and checks your redraft. Bands are estimates, not official marks.', 'Buddy 按 DSE 評分準則批改，指出最先要改的地方，再檢查你的修改稿。等級只是估計，並非正式分數。')}</span></div></section>
    <section class="card wr-step"><h2 class="st-h">1 · ${WT('Which paper?', '哪一份卷？')}</h2>
      <div class="wr-kinds">${Object.entries(WR_KINDS).map(([key, x]) => `<button class="wr-kind ${s.kind === key ? 'on' : ''}" data-kind="${key}" aria-pressed="${s.kind === key}"><b>${LANG === 'zh' ? x.zh : x.en}</b><span>${WT(...x.sub)}</span></button>`).join('')}</div>
    </section>
    ${k ? `<section class="card wr-step"><h2 class="st-h">2 · ${WT('The task (question)', '題目')}</h2>
      <textarea id="wrPrompt" class="wr-ta small" rows="6" placeholder="${WT('Paste or type your school’s writing task here, take a photo of it, or let Buddy write a DSE-style one.', '在這裏貼上或輸入學校的寫作題目，或拍下題目，或讓 Buddy 出一條 DSE 式題目。')}">${esc(s.prompt)}</textarea>
      <div class="wr-row">
        <button class="btn ghost" id="wrTaskPhoto" ${s.busy ? 'disabled' : ''}>📷 ${WT('Photo of the task', '拍下題目')}</button>
        <div class="wr-gen"><input id="wrTopic" class="tinput" placeholder="${WT('Topic (optional), e.g. social media', '題材（可留空），例如：社交媒體')}" value="${esc(s.topic)}"><button class="btn ghost" id="wrGen" ${s.busy ? 'disabled' : ''}>✨ ${WT('Write me a task', '幫我出題')}</button></div>
      </div>
      ${s.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(s.busy)}</p>` : ''}
      ${s.error ? `<p class="hw-err" role="alert">${esc(s.error)}</p>` : ''}
      <button class="btn" id="wrStart" ${s.busy ? 'disabled' : ''}>${WT('Start writing', '開始寫作')} →</button>
      <p class="hint" style="margin:0">${WT('No task? You can still start: Buddy will judge it as a general piece of this type.', '沒有題目？也可以開始，Buddy 會按這類文章的一般要求批改。')}</p>
    </section>` : ''}
    ${list.length ? `<section class="stack g10"><h2 class="st-h">${WT('Your writing', '你的文章')}</h2>
      <div class="hw-list">${list.slice().reverse().map((x) => { const d = x.drafts[x.drafts.length - 1], lv = d && wrLevel(d.fb, x.kind); return `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">✍️</span><span class="hw-it"><b>${esc(x.title)}</b><small>${LANG === 'zh' ? WR_KINDS[x.kind].zh : WR_KINDS[x.kind].en} · ${new Date(x.t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' })} · ${x.drafts.length ? WT(`${x.drafts.length} draft${x.drafts.length > 1 ? 's' : ''} marked`, `已批改 ${x.drafts.length} 稿`) : WT('Not marked yet', '未批改')}</small></span>${lv ? `<span class="wr-lv sm" title="${WT('Estimated level', '估計等級')}">≈${lv}</span>` : ''}<span aria-hidden="true">›</span></button>`; }).join('')}</div></section>` : ''}
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
  document.getElementById('wrGen').onclick = () => run(WT('Writing a DSE-style task…', '正在出題…'), async () => { const r = await api('writing', { step: 'prompt', kind: s.kind, topic: s.topic }); s.prompt = r.prompt; });
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
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${WT('Writing', '寫作')}</span></button><span style="font-weight:600;font-size:15px" data-raw>${n ? WT(`Draft ${n + 1}`, `第 ${n + 1} 稿`) : WT('Draft 1', '第 1 稿')}</span></div>
    <main class="pad stack g14 wrpage" data-view="writing" data-raw style="flex:1">
      <details class="card wr-task" ${it.prompt && !n ? 'open' : ''}><summary><b>${WT('Task', '題目')}</b> · ${LANG === 'zh' ? k.zh : k.en}</summary><div class="wr-ptext">${it.prompt ? esc(it.prompt).replace(/\n/g, '<br>') : `<span class="muted">${WT('No task given.', '沒有題目。')}</span>`}</div></details>
      ${n ? `<div class="wr-tip">💡 ${WT('Redraft: work on the 3 fixes first.', '修改稿：先處理三個要改的地方。')} <button class="btn-sm quiet" id="seeFb">${WT('See feedback', '看評語')}</button>
        <ol>${it.drafts[n - 1].fb.fixes.map((f) => `<li>${esc(f.issue)}</li>`).join('')}</ol></div>` : ''}
      <section class="card wr-ed">
        <textarea id="wrText" class="wr-ta" lang="${k.lang === 'zh' ? 'zh-HK' : 'en'}" spellcheck="false" placeholder="${k.lang === 'zh' ? '在這裏寫你的文章…' : 'Write your essay here…'}">${esc(it.work)}</textarea>
        <div class="wr-bar"><span class="wr-count ${c >= k.words * 0.9 ? 'ok' : ''}" id="wrCount">${c} / ~${k.words} ${k.lang === 'zh' ? '字' : WT('words', '字')}</span>
          <button class="btn-sm" id="wrPhoto" ${st.busy ? 'disabled' : ''}>📷 ${WT('Photo of handwritten pages', '拍下手寫稿')}</button></div>
        ${st.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(st.busy)}</p>` : ''}
        ${st.error ? `<p class="hw-err" role="alert">${esc(st.error)}</p>` : ''}
        <p class="hint" style="margin:0">${WT('Writing on paper? Photograph the pages: Buddy types it out exactly as you wrote it (mistakes too). Check the reading before you ask for feedback.', '在紙上寫？拍下每一頁，Buddy 會照你寫的打出來（錯字也會保留）。取得評語前請先核對。')}</p>
        <button class="btn" id="wrMark" ${st.busy || c < 30 ? 'disabled' : ''}>${n ? WT('Mark my redraft', '批改修改稿') : WT('Get feedback', '取得評語')}</button>
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
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${WT('Writing', '寫作')}</span></button><span style="font-weight:600;font-size:15px" data-raw>${esc(it.title)}</span></div>
  <main class="pad stack g14 wrpage" data-view="writing" data-raw style="flex:1">
    ${it.drafts.length > 1 ? `<div class="wr-drafts" role="tablist">${it.drafts.map((x, j) => `<button role="tab" class="${j === i ? 'on' : ''}" aria-selected="${j === i}" data-d="${j}">${WT(`Draft ${j + 1}`, `第 ${j + 1} 稿`)}${wrLevel(x.fb, it.kind) ? ` · ≈${wrLevel(x.fb, it.kind)}` : ''}</button>`).join('')}</div>` : ''}
    <section class="card wr-score">
      <div class="wr-lvbox"><span class="wr-lv">≈${lv}</span><small>${WT('Estimated level', '估計等級')}${plv && plv !== lv ? `<br><b class="${lv > plv ? 'wr-up' : 'wr-down'}">${WT('was', '之前')} ${plv}</b>` : ''}</small></div>
      <div class="wr-crits">${fb.criteria.map((c, j) => { const pc = prev && prev.fb.criteria[j], dlt = pc ? c.band - pc.band : 0; return `<div class="wr-crit"><div class="wr-ch"><b>${esc(c.name)}</b><span>${c.band}<small>/7</small>${dlt ? `<em class="${dlt > 0 ? 'wr-up' : 'wr-down'}">${dlt > 0 ? '▲' : '▼'}${Math.abs(dlt)}</em>` : ''}</span></div><div class="wr-bandbar"><i style="width:${(c.band / 7) * 100}%"></i></div><p>${esc(c.why)}</p></div>`; }).join('')}</div>
      <p class="wr-sum">${esc(fb.summary)}</p>
      <p class="wr-note">${WT('Estimate from AI marking against the HKDSE criteria. Not an official HKEAA mark: use it to see what to improve.', '按 HKDSE 評分準則的 AI 估計，並非考評局正式分數，用來找出要改進的地方。')} · ${fb.count} ${zh ? '字' : WT('words', '字')}</p>
    </section>
    ${prev && (fb.improved.length || fb.still_to_do.length) ? `<section class="card wr-box better"><h2>${L('What got better', '進步了的地方')}</h2>${fb.improved.length ? `<ul>${fb.improved.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${fb.still_to_do.length ? `<h3>${L('Still to work on', '仍要改進')}</h3><ul>${fb.still_to_do.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    <section class="card wr-box good"><h2>👍 ${L('What you did well', '做得好的地方')}</h2><ul>${fb.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card wr-box fix"><h2>🎯 ${L('Fix these first', '最先要改的三點')}</h2><ol class="wr-fixes">${fb.fixes.map((f) => `<li><b>${esc(f.issue)}</b>${f.quote ? `<q>${esc(f.quote)}</q>` : ''}<span>${esc(f.how)}</span></li>`).join('')}</ol></section>
    ${fb.corrections.length ? `<section class="card wr-box"><button class="wr-tog" id="togCorr" aria-expanded="${!!o[it.id + ':corr']}"><h2>✏️ ${L(`Language corrections (${fb.corrections.length})`, `語文修正（${fb.corrections.length} 處）`)}</h2><span>${o[it.id + ':corr'] ? WT('Hide', '隱藏') : WT('Show', '顯示')}</span></button>
      ${o[it.id + ':corr'] ? `<ol class="wr-corr">${fb.corrections.map((c) => `<li><s>${esc(c.quote)}</s> → <b>${esc(c.fix)}</b>${c.why ? `<small>${esc(c.why)}</small>` : ''}</li>`).join('')}</ol>` : ''}</section>` : ''}
    ${fb.next_step ? `<div class="wr-tip">➡️ ${esc(fb.next_step)}</div>` : ''}
    <section class="card wr-box"><button class="wr-tog" id="togEssay" aria-expanded="${showEssay}"><h2>📄 ${WT(`Your draft ${i + 1}`, `你的第 ${i + 1} 稿`)}</h2><span>${showEssay ? WT('Hide', '隱藏') : WT('Show', '顯示')}</span></button>
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
const spLevel = (fb) => (fb && fb.criteria ? wrLevel({ criteria: fb.criteria }, 'en_a') : null);
const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function spSave() { local.sp = (local.sp || []).slice(-15); saveLocal(); }
function sayQuestion(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); const v = dictVoice('en');
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = 0.95; speechSynthesis.speak(u);
  } catch (e) {}
}

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
    <section class="hw-hero">${buddySVG('listen', 56)}<div><b>${SPK('DSE English Paper 4: the one-minute individual response.', 'DSE 英文卷四：一分鐘個人回應。')}</b>
      <span>${SPK('Read a topic, prepare like the exam, then answer the examiner’s question out loud. Buddy marks it by the four speaking domains and shows you how to do better.', '閱讀題目、像考試一樣準備，然後大聲回答考官的問題。Buddy 會按四個說話範疇評分，並教你怎樣做得更好。')}</span></div></section>
    ${SREC ? '' : `<p class="hw-err" role="alert">${SPK('This browser can’t turn speech into text. Please use Chrome, Edge or Safari.', '這個瀏覽器不能把說話轉成文字，請使用 Chrome、Edge 或 Safari。')}</p>`}
    <section class="card wr-step"><h2 class="st-h">${SPK('New topic', '新題目')}</h2>
      <div class="wr-gen"><input id="spTopic" class="tinput" placeholder="${SPK('Topic (optional), e.g. online learning', '題材（可留空），例如：網上學習')}" value="${esc(spx.topic)}"><button class="btn" id="spNew" ${spx.busy ? 'disabled' : ''}>✨ ${SPK('Give me a DSE-style topic', '給我一條 DSE 式題目')}</button></div>
      ${spx.busy ? `<p class="muted wr-busy"><span class="spinner sm" aria-hidden="true"></span>${esc(spx.busy)}</p>` : ''}
      ${spx.error ? `<p class="hw-err" role="alert">${esc(spx.error)}</p>` : ''}
    </section>
    ${list.length ? `<section class="stack g10"><h2 class="st-h">${SPK('Your topics', '你的題目')}</h2>
      <div class="hw-list">${list.slice().reverse().map((x) => { const best = x.tries.reduce((b, t) => { const l = spLevel(t.fb); return l && (!b || l > b) ? l : b; }, null); return `<button class="hw-item" data-open="${x.id}"><span class="hw-ic">🎤</span><span class="hw-it"><b>${esc(x.task.title)}</b><small>${new Date(x.t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' })} · ${x.tries.length ? SPK(`${x.tries.length} answer${x.tries.length > 1 ? 's' : ''}`, `已回答 ${x.tries.length} 次`) : SPK('Not answered yet', '未回答')}</small></span>${best ? `<span class="wr-lv sm">≈${best}</span>` : ''}<span aria-hidden="true">›</span></button>`; }).join('')}</div></section>` : ''}
  </main>`;
  const tp = document.getElementById('spTopic'); tp.oninput = () => (spx.topic = tp.value);
  $app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => go({ name: 'speaking', id: b.dataset.open })));
  document.getElementById('spNew').onclick = async () => {
    spx.busy = SPK('Writing a DSE-style topic…', '正在出題…'); spx.error = null; renderSpeaking();
    try {
      const r = await api('speaking', { step: 'task', topic: spx.topic }); delete r.usage;
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
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Speaking', '說話')}</span></button><span style="font-weight:600;font-size:15px" data-raw>${esc(T.title)}</span></div>
  <main class="pad sppage" data-view="speaking" data-raw style="flex:1">
    <div class="sp-col stack g14">
      <section class="card sp-text"><small class="ln-step">${SPK('Read this', '閱讀')}</small><h2>${esc(T.title)}</h2><div>${esc(T.text).replace(/\n/g, '<br>')}</div></section>
      ${T.discussion ? `<details class="card wr-task"><summary><b>${SPK('Group discussion task', '小組討論題目')}</b></summary><div class="wr-ptext">${esc(T.discussion).replace(/\n/g, '<br>')}</div></details>` : ''}
    </div>
    <div class="sp-col stack g14">
      <section class="card sp-prep">
        <div class="sp-prep-h"><b>${SPK('Prepare', '準備')}</b><span class="sp-clock" id="spClock">${it.prepEnd && prepLeft() ? fmtSecs(prepLeft()) : '10:00'}</span>
          ${it.prepEnd && prepLeft() ? `<button class="btn-sm" id="spPrepStop">${SPK('I’m ready', '我準備好了')}</button>` : `<button class="btn-sm primary" id="spPrep">${SPK('Start 10-minute timer', '開始 10 分鐘計時')}</button>`}</div>
        <textarea id="spNotes" class="wr-ta small" rows="5" placeholder="${SPK('Notes: key words and ideas only, like your exam note card.', '筆記：只寫關鍵字和要點，像考試的筆記卡。')}">${esc(it.notes || '')}</textarea>
      </section>
      <section class="card sp-qs"><h2>${SPK('Individual response', '個人回應')}</h2><p class="hint" style="margin:0">${SPK('The examiner asks you one question. You answer for one minute.', '考官會問你一條問題，你要回答一分鐘。')}</p>
        ${T.questions.map((q, i) => { const ts = it.tries.filter((t) => t.qi === i), last = ts[ts.length - 1], lv = last && spLevel(last.fb); return `<div class="sp-q"><span class="sp-qn">${i + 1}</span><span class="sp-qt">${esc(q)}${last ? `<small>${SPK(`Answered ${ts.length}×`, `已答 ${ts.length} 次`)}${lv ? ` · ≈${lv}` : ''} · <button class="linkbtn" data-fb="${i}">${SPK('See feedback', '看評語')}</button></small>` : ''}</span><button class="btn-sm ${last ? '' : 'primary'}" data-ans="${i}">🎤 ${last ? SPK('Again', '再答') : SPK('Answer', '回答')}</button></div>`; }).join('')}
      </section>
    </div>
  </main>`;
  document.getElementById('back').onclick = () => go({ name: 'speaking' });
  const nt = document.getElementById('spNotes'); let tm; nt.oninput = () => { it.notes = nt.value; clearTimeout(tm); tm = setTimeout(saveLocal, 500); };
  const ps = document.getElementById('spPrep'); if (ps) ps.onclick = () => { it.prepEnd = Date.now() + 600000; saveLocal(); renderSpeakingTask(it); };
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
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Topic', '題目')}</span></button><span style="font-weight:600;font-size:15px">${SPK('Individual response', '個人回應')}</span></div>
    <main class="pad stack g18 sprec" data-view="speaking" data-raw style="flex:1">
      <section class="sp-exq"><span class="sp-ex">${buddySVG(R.state === 'rec' ? 'listen' : 'happy', 52)}<small>${SPK('Examiner', '考官')}</small></span><div><p>${esc(q)}</p><button class="btn-sm quiet" id="spSay">🔊 ${SPK('Hear it again', '再聽一次')}</button></div></section>
      <section class="sp-ring ${R.state}"><svg viewBox="0 0 120 120" width="170" height="170" aria-hidden="true"><circle cx="60" cy="60" r="52" class="rbg"/><circle cx="60" cy="60" r="52" class="rfg" id="spArc" style="stroke-dashoffset:${326.7 * (1 - left / 60)}"/></svg>
        <div class="sp-time"><b id="spLeft">${fmtSecs(Math.ceil(left))}</b><small>${R.state === 'rec' ? SPK('speaking…', '說話中…') : SPK('one minute', '一分鐘')}</small></div>${R.state === 'rec' ? '<span class="sp-dot" aria-hidden="true"></span>' : ''}</section>
      ${R.state === 'ready' ? `<button class="btn sp-go" id="spGo">🎤 ${SPK('Start my minute', '開始我的一分鐘')}</button><p class="hint" style="margin:0;text-align:center">${SPK('Tip: answer the question first, give two reasons with an example, then round off.', '提示：先直接回答，再給兩個理由和例子，最後作總結。')}</p>`
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
  const lv = spLevel(fb), plv = prev && spLevel(prev.fb);
  const wpm = Math.round(t.words / Math.max(1, t.secs) * 60);
  const pace = wpm < 90 ? ['slow', 'A bit slow: aim for 110–150 words a minute'] : wpm > 170 ? ['fast', 'Quite fast: slow down a little so every word is clear'] : ['ok', 'Good pace'];
  const markFill = (s) => esc(s).replace(/\b(um+|uh+|erm*|ah+|hmm+|you know|i mean)\b/gi, '<mark class="sp-fill">$1</mark>');
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${SPK('Topic', '題目')}</span></button><span style="font-weight:600;font-size:15px">${SPK('Feedback', '評語')}</span></div>
  <main class="pad stack g14 wrpage" data-view="speaking" data-raw style="flex:1">
    <section class="card sp-exq small"><span class="sp-ex">${buddySVG('happy', 40)}</span><div><p>${esc(it.task.questions[qi])}</p></div></section>
    <section class="card wr-score">
      <div class="wr-lvbox"><span class="wr-lv">≈${lv}</span><small>Estimated level${plv && plv !== lv ? `<br><b class="${lv > plv ? 'wr-up' : 'wr-down'}">was ${plv}</b>` : ''}</small></div>
      <div class="wr-crits">${fb.criteria.map((c, j) => { const pc = prev && prev.fb.criteria[j], d = pc ? c.band - pc.band : 0; return `<div class="wr-crit"><div class="wr-ch"><b>${esc(c.name)}</b><span>${c.band}<small>/7</small>${d ? `<em class="${d > 0 ? 'wr-up' : 'wr-down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : ''}</span></div><div class="wr-bandbar"><i style="width:${(c.band / 7) * 100}%"></i></div><p>${esc(c.why)}</p></div>`; }).join('')}</div>
      <p class="wr-sum">${esc(fb.summary)}</p>
      <p class="wr-note">Estimate from AI marking of a speech-to-text transcript against the HKDSE speaking domains. Pronunciation can’t be judged from text: listen back to check it yourself.</p>
    </section>
    <section class="card sp-stats">
      <div><b>${t.secs}s</b><small>of 60 spoken</small></div><div class="${pace[0]}"><b>${wpm}</b><small>words / min</small></div><div><b>${t.fillers}</b><small>fillers (um, er…)</small></div><div><b>${t.pause}s</b><small>longest pause</small></div>
      <p>${pace[1]}${t.secs < 45 ? ' · Try to use most of the minute.' : ''}${t.pause >= 4 ? ' · Long pauses: a short phrase like “Let me think…” keeps you going.' : ''}</p>
      ${url ? `<audio controls src="${url}" class="sp-audio"></audio>` : ''}
    </section>
    <section class="card wr-box"><h2>📝 What I heard</h2><p class="sp-trx">${markFill(t.tr)}</p></section>
    <section class="card wr-box good"><h2>👍 What you did well</h2><ul>${fb.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card wr-box fix"><h2>🎯 Fix these first</h2><ol class="wr-fixes">${fb.fixes.map((f) => `<li><b>${esc(f.issue)}</b>${f.quote ? `<q>${esc(f.quote)}</q>` : ''}<span>${esc(f.how)}</span></li>`).join('')}</ol></section>
    ${fb.phrases.length ? `<section class="card wr-box"><h2>💬 Useful phrases for next time</h2><div class="sp-phr">${fb.phrases.map((p) => `<button class="sp-ph" data-say="${esc(p)}">🔊 ${esc(p)}</button>`).join('')}</div></section>` : ''}
    ${fb.sample ? `<section class="card wr-box"><button class="wr-tog" id="togSample" aria-expanded="false"><h2>🌟 One way to answer</h2><span>Show</span></button><div class="sp-sample" hidden><p>${esc(fb.sample)}</p><button class="btn-sm" id="saySample">🔊 Listen</button></div></section>` : ''}
    ${fb.next_step ? `<div class="wr-tip">➡️ ${esc(fb.next_step)}</div>` : ''}
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
const DL = { yue: ['粵語', 'Cantonese', 'zh-HK'], cmn: ['普通話', 'Putonghua', 'zh-CN'], en: ['English', 'English', 'en-GB'] };
const DT = (en, zh) => (LANG === 'zh' ? zh : en);
function dictVoice(lang) {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const want = lang === 'yue' ? (v) => /^(zh-HK|yue)/i.test(v.lang) || /Cantonese|粵|粤/i.test(v.name)
    : lang === 'cmn' ? (v) => /^zh[-_](CN|TW|Hans)/i.test(v.lang) || /Mandarin|普通話|普通话/i.test(v.name)
    : (v) => /^en[-_]/i.test(v.lang);
  const ok = vs.filter(want);
  const score = (v) => (/Natural|Online|Neural|Premium|Enhanced/i.test(v.name) ? 4 : 0) + (/Google/i.test(v.name) ? 2 : 0) + (lang === 'en' && /en[-_]GB/i.test(v.lang) ? 1 : 0);
  return ok.sort((a, b) => score(b) - score(a))[0] || null;
}
function sayItem(text, lang, slow) {
  if (!window.speechSynthesis) { toast(DT('This browser can’t read aloud. Try Chrome, Edge or Safari.', '這個瀏覽器不能朗讀，請用 Chrome、Edge 或 Safari。')); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = dictVoice(lang);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = DL[lang][2];
  u.rate = slow ? 0.55 : 0.8;
  speechSynthesis.speak(u);
  return !!v;
}
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
    <h1 class="pagetitle">${DT('默書 · Dictation', '默書')}</h1>
    <section class="hw-hero">${buddySVG('happy', 56)}<div><b>${DT('I read the words, you write them.', '我讀，你寫。')}</b>
      <span>${DT('Add this week’s 默書 or spelling list. I read each one aloud in Cantonese, Putonghua or English. Write it down, then check. Words you miss come back next time.', '加入今個星期的默書或串字。我會用粵語、普通話或英文逐個讀出來，你寫低再對答案。寫錯的會在下次再出現。')}</span></div></section>
    <button class="btn" id="dnew">+ ${DT('Add a dictation list', '加入默書')}</button>
    ${lists.length ? `<div class="hw-list">${lists.slice().reverse().map((x) => { const m = missed(x), last = (x.runs || []).slice(-1)[0];
      return `<div class="dl-item"><button class="dl-main" data-run="${x.id}"><span class="hw-ic">✏️</span><span class="hw-it"><b>${esc(x.title)}</b><small>${DL[x.lang][LANG === 'zh' ? 0 : 1]} · ${x.items.length} ${DT('items', '項')}${last ? ` · ${DT('last', '上次')} ${last.g}/${last.n}` : ''}${m ? ` · <span class="dl-miss">${DT(`${m} to practise`, `${m} 個要再練`)}</span>` : ''}</small></span><span class="dl-go">▶</span></button>
        <button class="btn-sm quiet" data-edit="${x.id}">${DT('Edit', '修改')}</button></div>`; }).join('')}</div>`
      : `<p class="muted" style="margin:0">${DT('No lists yet.', '還沒有默書。')}</p>`}
  </main>`;
  document.getElementById('dnew').onclick = () => go({ name: 'dictation', id: 'new' });
  $app.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => go({ name: 'dictation', id: b.dataset.run, sub: 'run' })));
  $app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => go({ name: 'dictation', id: b.dataset.edit, sub: 'edit' })));
}

function editDictation(L) {
  const st = { title: L ? L.title : '', lang: L ? L.lang : (LANG === 'zh' ? 'yue' : 'en'), text: L ? L.items.join('\n') : '', busy: false, err: '' };
  const draw = () => {
    $app.innerHTML = `
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${DT('默書', '默書')}</span></button><span style="font-weight:600;font-size:15px">${L ? DT('Edit list', '修改默書') : DT('New list', '新默書')}</span></div>
    <main class="pad stack g14 dictpage" data-view="dictation" data-raw style="flex:1">
      <label class="dl-lab" for="dtitle">${DT('Name', '名稱')}</label>
      <input id="dtitle" class="input" maxlength="60" placeholder="${DT('e.g. 中文默書 第五課 or Spelling Unit 3', '例如：中文默書 第五課')}" value="${esc(st.title)}">
      <span class="dl-lab">${DT('Read aloud in', '朗讀語言')}</span>
      <div class="seg" role="radiogroup">${Object.entries(DL).map(([k, v]) => `<button role="radio" aria-checked="${st.lang === k}" class="${st.lang === k ? 'on' : ''}" data-lang="${k}">${LANG === 'zh' ? v[0] : v[1]}</button>`).join('')}</div>
      <div class="dl-row"><label class="dl-lab" for="ditems">${DT('Words or sentences, one per line', '詞語或句子，每行一個')}</label>
        <label class="btn-sm" style="cursor:pointer">📷 ${DT('Read from a photo', '從相片讀取')}<input type="file" accept="image/*" id="dphoto" hidden></label></div>
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
      { const ta = document.getElementById('ditems'); const tx = ta ? ta.value : st.text; if (!st.picked && !L && /[\u3400-\u9fff]/.test(tx) && st.lang === 'en') st.lang = 'yue'; } // Chinese words left on English: read them in Cantonese
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
    <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${DT('默書', '默書')}</span></button></div>
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
    draw(); setTimeout(() => sayItem(L.items[R.order[R.k]], L.lang, false), 350);
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
        <div class="dl-ctrls"><button class="btn-sm" id="again1">${DT('Again', '再聽一次')}</button><button class="btn-sm" id="slow">🐢 ${DT('Slowly', '慢一點')}</button></div>
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
    document.getElementById('play').onclick = () => say(false);
    document.getElementById('again1').onclick = () => say(false);
    document.getElementById('slow').onclick = () => say(true);
    if (!dictVoice(L.lang) && speechSynthesis.getVoices().length) document.getElementById('novoice').hidden = false;
    $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { R.mode = local.dictMode = b.dataset.mode; saveLocal(); R.shown = false; draw(); }));
    document.getElementById('quit').onclick = async () => { speechSynthesis.cancel(); if (!R.k || await confirmLeave({ title: DT('Stop this dictation?', '停止這次默書？'), body: DT('Words you’ve marked so far are saved.', '已核對的詞語會保存。'), leave: DT('Stop', '停止'), stay: DT('Keep going', '繼續') })) go({ name: 'dictation' }); };
    const sh = document.getElementById('show'); if (sh) sh.onclick = () => { const t = document.getElementById('dtyped'); if (t) R.typed = t.value; R.shown = true; draw(); };
    const ty = document.getElementById('dtyped'); if (ty && !R.shown) { ty.focus(); ty.onkeydown = (e) => { if (e.key === 'Enter') sh.click(); }; }
    const y = document.getElementById('yes'); if (y) y.onclick = () => mark(true);
    const no = document.getElementById('no'); if (no) no.onclick = () => mark(false);
    const nx = document.getElementById('next'); if (nx) { nx.onclick = () => mark(okTyped); nx.focus(); }
  };
  draw();
  setTimeout(() => sayItem(L.items[R.order[0]], L.lang, false), 500);
}

/* ---------- Learn mode: a guided lesson before practising ----------
   Explain → example → quick check, one idea at a time, then a summary and straight into practice.
   Each lesson is written once per chapter and kept on this device. */
const lessonJobs = new Map();
function getLesson(book, unit, fresh) {
  const key = `lesson:${book.id}:${unit.id}`;
  if (!fresh && lessonJobs.has(key)) return lessonJobs.get(key);
  const p = (async () => {
    if (!fresh) { const have = await store.get(key, null); if (have && Array.isArray(have.steps) && have.steps.length) return have; }
    const text = await store.get(`text:${book.id}:${unit.id}`, '');
    if (!text) throw new Error('This chapter’s text is missing on this device.');
    const l = await api('learn', { title: unit.title, text, kind: kindOfBook(book), lang: langOf(text) });
    if (!l || !Array.isArray(l.steps) || !l.steps.length) throw new Error('Buddy couldn’t put this lesson together. Please try again.');
    delete l.usage; l.at = Date.now();
    await store.set(key, l);
    return l;
  })();
  lessonJobs.set(key, p);
  p.catch(() => lessonJobs.delete(key));
  return p;
}
async function renderLearn(bookId, unitId) {
  const book = (await getBooks()).find((b) => b.id === bookId);
  const unit = book && book.units.find((u) => u.id === unitId);
  if (!unit) return go({ name: 'home' });
  if (!allow('lesson')) return go({ name: 'book', bookId });
  meter('lesson');
  const myView = view, zh = LANG === 'zh';
  const T = (en, z) => (zh ? z : en);
  $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${T('Chapter', '章節')}</span></button><span style="font-weight:600;font-size:15px" data-raw>${esc(cleanUnitTitle(unit.title))}</span></div>
    <main class="pad stack g18 learnpage" data-view="learn" style="flex:1;align-items:center;justify-content:center;text-align:center">
      ${buddySVG('think', 64)}<b style="font-size:18px">${T('Getting your lesson ready…', '正在準備你的課堂…')}</b><span class="muted">${T('Buddy is reading the chapter and planning how to teach it. This takes about half a minute the first time.', 'Buddy 正在閱讀這一章並準備教學，第一次大約需要半分鐘。')}</span><div class="spinner" aria-hidden="true"></div></main>`;
  document.getElementById('back').onclick = () => go({ name: 'book', bookId });
  let L;
  try { L = await getLesson(book, unit); } catch (e) {
    if (view !== myView) return;
    $app.querySelector('main').innerHTML = `<b>${T('Couldn’t make the lesson', '未能準備課堂')}</b><span class="muted">${esc(e.status === 0 ? T('You seem to be offline.', '你好像離線了。') : (e.message || ''))}</span><button class="btn" id="retry">${T('Try again', '再試')}</button>`;
    document.getElementById('retry').onclick = () => renderLearn(bookId, unitId);
    return;
  }
  if (view !== myView) return;
  const lsKey = `${bookId}:${unitId}`;
  const saved = (local.lessonAt || {})[lsKey];
  const R = { k: -1, picked: {}, right: 0, msgs: [], busy: false, err: null };
  if (saved && Date.now() - saved.t < 7 * DAY && saved.k < L.steps.length) { Object.assign(R, { k: saved.k, picked: saved.picked || {}, right: saved.right || 0, msgs: saved.msgs || [] }); setTimeout(() => toast(T(`Picking up where you left off: step ${saved.k + 1}`, `由上次的第 ${saved.k + 1} 步繼續`)), 300); }
  const keepPlace = () => { local.lessonAt = local.lessonAt || {}; if (R.k >= 0 && R.k < L.steps.length) local.lessonAt[lsKey] = { t: Date.now(), k: R.k, picked: R.picked, right: R.right, msgs: R.msgs.filter((m) => !m.live).slice(-20) }; else delete local.lessonAt[lsKey]; saveLocal(); };
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
        ${!R.msgs.length ? `<div class="tmsg ai">${T('I’m right here while you learn. If something doesn’t make sense, ask me: I can explain it another way, give you a new example, or help with the quick check.', '你上課時我都在這裏。有不明白的地方就問我：我可以換個方法解釋、再給你例子，或者幫你想小測。')}</div>` : ''}
        ${R.msgs.map((m) => m.role === 'user' ? `<div class="tmsg me nomath">${esc(m.text)}</div>` : `<div class="tmsg ai">${tutorMd(m.text)}</div>`).join('')}
        ${R.busy && !(R.msgs[R.msgs.length - 1] || {}).live ? '<div class="tmsg ai"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}
        ${R.err ? `<p class="hint" style="margin:0;color:var(--miss-dark)">${esc(R.err)}</p>` : ''}
      </div>
      ${R.busy ? '' : `<div class="tchips">${chips().map((t) => `<button class="tchip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="tform" id="lnform"><input id="lnq" class="tinput" placeholder="${T('Ask Buddy anything about this…', '有甚麼問題都可以問 Buddy…')}" autocomplete="off" ${R.busy ? 'disabled' : ''}><button class="tsend" aria-label="${T('Send', '傳送')}" ${R.busy ? 'disabled' : ''}>${ICON.send}</button></form>`;
    renderMath(box);
    const log = document.getElementById('lnlog'); if (log) log.scrollTop = log.scrollHeight;
    box.querySelectorAll('[data-say]').forEach((x) => (x.onclick = () => askBuddy(x.dataset.say)));
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
  const draw = () => {
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
        <button class="btn" id="practise">${T('Practise this chapter now', '現在練習這一章')} →</button>
        <div class="rd-row"><button class="btn ghost" id="again">${T('Go through it again', '再上一次')}</button><button class="btn ghost" id="done">${T('Back to the chapter', '返回章節')}</button></div></section>`;
    } else {
      const s = L.steps[R.k], c = s.check, p = R.picked[R.k];
      body = `<section class="ln-card">
        <small class="ln-step">${T(`Step ${R.k + 1} of ${n}`, `第 ${R.k + 1}／${n} 步`)}</small>
        <h2>${esc(s.heading)}</h2>
        <div class="ln-x">${tutorMd(s.explain)}</div>
        ${s.example ? `<div class="ln-ex"><b>${T('Example', '例子')}</b>${tutorMd(s.example)}</div>` : ''}
        ${c ? `<div class="ln-check"><b>${T('Quick check', '小測')}</b><div class="ln-q">${tutorMd(c.question)}</div>
          <div class="ln-opts">${c.options.map((o, i) => `<button class="ln-opt ${p !== undefined ? (i === c.answer ? 'ok' : i === p ? 'no' : '') : ''}" data-opt="${i}" ${p !== undefined ? 'disabled' : ''}><span>${'ABCD'[i]}</span>${tutorMd(o).replace(/^<p>|<\/p>$/g, '')}</button>`).join('')}</div>
          ${p !== undefined ? `<p class="ln-why ${p === c.answer ? 'ok' : 'no'}"><b>${p === c.answer ? T('Yes! ', '答對了！') : T('Not quite. ', '差一點。')}</b>${esc(c.why)}</p>` : ''}</div>` : ''}
        <div class="rd-row"><button class="btn ghost" id="prev">${T('Back', '上一步')}</button><button class="btn" id="next" ${c && p === undefined ? 'disabled' : ''}>${R.k === n - 1 ? T('Finish', '完成') : T('Next', '下一步')} →</button></div>
        ${c && p === undefined ? `<span class="hint" style="text-align:center">${T('Answer the quick check to go on.', '先回答小測再繼續。')} <button class="linkbtn" id="askb">${T('Stuck? Ask Buddy for a hint', '不明白？問 Buddy 拿提示')}</button></span>` : ''}
      </section>`;
    }
    const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
    keepPlace();
    const lm = document.getElementById('lnMain'); if (!lm) return;
    lm.innerHTML = `${R.k >= 0 && R.k < n ? dots : ''}${body}`;
    renderMath(lm);
    window.scrollTo(0, 0);
    if (!R.busy) drawChat();
    on('askb', () => { const c = document.getElementById('lnchat'); if (c && !desk()) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); askBuddy(T('Help me with the quick check', '小測給我一點提示')); });
    on('go1', () => { R.k = 0; draw(); });
    on('prev', () => { R.k--; draw(); });
    on('next', () => { R.k++; if (R.k >= n) finish(); draw(); });
    on('again', () => { R.k = 0; R.picked = {}; R.right = 0; draw(); });
    on('done', () => go({ name: 'book', bookId }));
    on('practise', () => { pick = { bookId, ids: new Set([unitId]) }; startUnits(book, [unit], local.count || SESSION_SIZE); });
    $app.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => { const s = L.steps[R.k]; R.picked[R.k] = +b.dataset.opt; if (+b.dataset.opt === s.check.answer) R.right++; draw(); }));
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
const SCREEN_NAME = { parent: 'Parent dashboard (for parents, PIN-protected)', plans: 'Plans and prices (Free, Plus, Pro)', speaking: 'Speaking practice (DSE English Paper 4 one-minute individual response)', writing: 'Writing practice (DSE composition with feedback and redrafts)', learn: 'Learn mode (a guided lesson teaching a chapter step by step)', dictation: '默書 dictation (the app reads words aloud, the child writes them)', homework: 'Homework help (photos of school homework)', home: 'Today', books: 'Books tab (their textbooks)', book: 'a book’s chapter page', library: 'the textbook library (adding a book)', mistakes: 'Mistake book', progress: 'Progress', settings: 'Settings', stars: 'Star shop', notes: 'revision notes', cards: 'flashcards', pick: 'choosing a book', usage: 'AI usage', paper: 'mock paper setup', edit: 'editing a book’s chapters', worksheets: 'worksheets' };
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
  if ($app.querySelector('#coach')) return false; // Today has the full coach
  if (document.getElementById('tutor') || $app.querySelector('#quit, #hwchat, #lnchat') || timedPaper()) return false;
  return !!$app.querySelector('main[data-view]');
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
async function renderHome() {
  S = null;
  const books = await getBooks();
  const hr = new Date().getHours();
  const hello = LANG === 'zh' ? (hr < 12 ? '早晨' : hr < 18 ? '午安' : '晚安') : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = (local.name || '').trim();
  const dateText = new Date().toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const head = `<div class="greet" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><h1 data-raw>${esc(hello)}${name ? `${LANG === 'zh' ? '，' : ', '}${esc(name)}` : ''}</h1><p data-raw>${esc(dateText)}</p></div>${starChip()}</div>`;
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
  if (due.length) items.push(`<button class="plan-item" data-mode="spaced"><span class="pi-icon pi-review">${actionIcon('review', 24)}</span><span class="pi-text"><b>Review ${due.length} question${due.length > 1 ? 's' : ''}</b><span class="sub">About ${Math.max(1, Math.round(Math.min(due.length, 15) * 0.6))} min · keeps what you learned fresh</span></span><span class="go">Start</span></button>`);
  if (mk) items.push(`<button class="plan-item" id="mistakes"><span class="pi-icon pi-mistake">${actionIcon('mistakes', 24)}</span><span class="pi-text"><b>Fix ${mk} mistake${mk > 1 ? 's' : ''}</b><span class="sub">Questions you didn’t get fully right</span></span><span class="go">Open</span></button>`);
  const tests = await schoolTestsHTML();
  tests.steps.filter((p) => p.left <= 14).slice(0, 2).forEach((p, k) => items.push(`<button class="plan-item" data-tstep="${k}"><span class="pi-icon pi-test">${actionIcon(p.step.icon, 24)}</span><span class="pi-text"><b data-raw>${esc(p.step.t)}</b><span class="sub"><span data-raw>${esc(p.x.name)}</span> ${leftText(p.left)} · ${p.step.s}</span></span><span class="go">${p.step.go}</span></button>`));
  { const nb = books.find((b) => !(local.placement || {})[b.id] && !(local.plHide || {})[b.id] && !bookAnswered(b.id));
    if (nb) items.push(`<button class="plan-item" data-lv="${esc(nb.id)}"><span class="pi-icon pi-continue">${actionIcon('level', 24)}</span><span class="pi-text"><b>Find your level</b><span class="sub"><span data-raw>${esc(nb.title)}</span> · about 5 min</span></span><span class="go">Start</span></button>`); }
  if (last) {
    const qs = await getQs(last.book.id, last.unit.id); const sc = scoreOf(qs);
    items.push(`<button class="plan-item" id="continue"><span class="pi-icon pi-continue">${actionIcon('practise', 24)}</span><span class="pi-text"><b data-raw>${esc(last.unit.title)}</b><span class="sub">Keep going${sc !== null ? ` · ${sc}% so far` : ''}</span></span><span class="go">Practise</span></button>`);
  } else {
    items.push(`<button class="plan-item" data-book="${esc(books[0].id)}"><span class="pi-icon pi-continue">${actionIcon('practise', 24)}</span><span class="pi-text"><b>Practise your first chapter</b><span class="sub" data-raw>${esc(books[0].title)}</span></span><span class="go">Choose</span></button>`);
  }
  if (!due.length && Object.keys(local.stats).length) items.push(`<div class="plan-item done"><span class="pi-icon pi-review">${actionIcon('review', 24)}</span><span class="pi-text"><b>Reviews done</b><span class="sub">${nextAt < Infinity ? `Next review ${whenText(nextAt)}` : ''}</span></span><span class="go">✓</span></div>`);
  const r = await currentReport();
  const ready = await readyRowsHTML(4);
  $app.innerHTML = `
  <main class="pad stack today" data-view="home" style="flex:1">
    ${head}
    ${installTip()}
    <section class="stack g10" aria-label="Today's plan"><div class="sect-head"><h2>Today’s plan</h2></div><div class="plan">${items.join('')}</div></section>
    ${tests.html}
    <section class="stack g10" aria-label="Practice">
      <div class="sect-head"><h2>Practice</h2></div>
      <div class="quick">
        <button class="qtile" data-mode="weak">${actionTile('weak', 44)}<b>Weak topics</b><span>Questions you found hard</span></button>
        <button class="qtile" data-mode="mock">${lockTag('mock')}${actionTile('mock', 44)}<b>Mock paper</b><span>DSE-style, timed</span></button>
        <button class="qtile hwtile" id="hwgo">${lockTag('homework')}${actionTile('homework', 44)}<b>Homework help</b><span>Snap a photo, get hints</span></button>
        <button class="qtile hwtile" id="dictgo">${actionTile('dictation', 44)}<b>默書 · Dictation</b><span>I read, you write</span></button>
        ${primaryCache ? '' : `<button class="qtile hwtile" id="wrgo">${lockTag('writing')}${actionTile('writing', 44)}<b>Writing · 寫作</b><span>DSE-style feedback, then redraft</span></button><button class="qtile hwtile" id="spgo">${lockTag('speaking')}${actionTile('speaking', 44)}<b>Speaking</b><span>DSE Paper 4, one-minute answers</span></button>`}
      </div>
      ${(local.worksheets || []).length ? `<button class="weekstrip" id="worksheets"><span class="wt"><b>Mark a printed worksheet</b><span>Enter the answers you wrote on paper</span></span><span aria-hidden="true" style="color:var(--accent);font-weight:700">›</span></button>` : ''}
    </section>
    ${ready.n ? `<section class="stack g10" aria-label="How ready you are">
      <div class="sect-head"><h2>How ready you are</h2><button class="btn-sm" id="progress">See progress</button></div>
      <div class="card stack g6 today-week">${ready.html}${ready.more ? `<button class="btn-sm quiet" id="moreready" style="align-self:flex-start;margin-top:4px">See all ${ready.n} books</button>` : ''}</div>
    </section>` : ''}
  </main>
  <aside class="coach" id="coach" aria-label="Study coach">${coachHTML()}</aside>${footerHTML()}`;
  bindHomeCommon();
  bindCoach();
  const pr = document.getElementById('progress'); if (pr) pr.onclick = () => go({ name: 'progress' });
  const mr = document.getElementById('moreready'); if (mr) mr.onclick = () => go({ name: 'progress' });
  $app.querySelectorAll('.today-week .mrowb[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  const wsb = document.getElementById('worksheets'); if (wsb) wsb.onclick = () => go({ name: 'worksheets' });
  const mkb = document.getElementById('mistakes'); if (mkb) mkb.onclick = () => go({ name: 'mistakes' });
  const ct = document.getElementById('continue');
  if (ct) ct.onclick = () => { pick = { bookId: last.book.id, ids: new Set([last.unit.id]) }; go({ name: 'book', bookId: last.book.id }); };
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  bindSchoolTests();
  $app.querySelectorAll('[data-tstep]').forEach((b) => (b.onclick = () => { const p = tests.steps.filter((q) => q.left <= 14)[+b.dataset.tstep]; if (p) p.step.run(); }));
  $app.querySelectorAll('[data-lv]').forEach((b) => (b.onclick = async () => { const bk = (await getBooks()).find((x) => x.id === b.dataset.lv); if (bk) startPlacement(bk); }));
  { const hg = document.getElementById('hwgo'); if (hg) hg.onclick = () => go({ name: 'homework' }); }
  { const dg = document.getElementById('dictgo'); if (dg) dg.onclick = () => go({ name: 'dictation' }); }
  { const wg = document.getElementById('wrgo'); if (wg) wg.onclick = () => go({ name: 'writing' }); }
  { const sg = document.getElementById('spgo'); if (sg) sg.onclick = () => go({ name: 'speaking' }); }
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => (b.dataset.mode === 'spaced' ? startReview('spaced') : go({ name: 'pick', mode: b.dataset.mode }))));
  window.scrollTo(0, 0);
}
const footerHTML = () => `<footer>Prototype. Your textbooks, questions and progress are saved on this device only. Questions are written by AI and checked by AI; tap "Report a problem" if one looks wrong. ${local.pilot ? '' : '<button class="btn-sm quiet" id="usage" >AI usage</button>'}</footer>`;
function bindHomeCommon() {
  { const u = document.getElementById('usage'); if (u) u.onclick = () => go({ name: 'usage' }); }
}

/* ---------- Books: my textbooks, the library and uploads ---------- */
// Books are grouped by subject. With lots of books, subject buttons and a search box narrow the list.
const subjectOf = (b) => String(b.subject || '').trim() || (b.library ? 'Other' : 'My uploads');
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
      <div class="stack" style="gap:2px"><h1 class="pagetitle" style="margin:0">Books</h1>${books.length ? `<span class="muted bk-count">${W(`${books.length} textbook${books.length === 1 ? '' : 's'}`, `${books.length} 本課本`)}</span>` : ''}</div>
      <button class="btn small" id="addbook" style="width:auto;padding:10px 16px;display:inline-flex;gap:6px;align-items:center">${ICON.plus} Add a textbook</button>
    </div>
    ${books.length ? `<div class="bk-tools">
      ${many ? `<form id="find" class="searchbox light" role="search"><span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Find in my textbooks" aria-label="Find in my textbooks" autocomplete="off"></form>` : '<span style="flex:1"></span>'}
      ${books.length > 1 ? `<div class="bk-view" role="group" aria-label="${W('Show as', '顯示方式')}">${viewBtn('grid', GRID, W('Covers', '封面'))}${viewBtn('list', LIST, W('List', '清單'))}</div>` : ''}
    </div>
    <div id="chips">${subjectChips(groupsAll, booksPick, books.length)}</div>
    <div id="shelf" aria-live="polite"></div>`
    : `<div class="card bk-empty"><span class="bk-empty-ic">${subjectIcon('', 34, null, '')}</span><b>${W('No textbooks yet', '仍未加入課本')}</b><p>${W('Add the textbooks you use at school, then practise any chapter.', '加入你在學校用的課本，就可以練習任何一章。')}</p></div>`}
  </main>`;
  // A cover in the subject's colour. A book not started yet says "New" instead of a discouraging 0%.
  const prog = ({ sc, t }) => (sc || t ? `<b>${sc}%</b><span class="c-meter" aria-hidden="true"><i style="width:${sc}%"></i></span>` : `<span class="c-new">${W('New', '新')}</span>`);
  const recentTag = (b) => (b.id === recentId ? `<span class="c-recent">${W('Last used', '最近使用')}</span>` : '');
  const cover = (it) => { const { b, sc } = it; return `<button class="bookcover" data-book="${esc(b.id)}" style="background:${coverColour(b)}" aria-label="${esc(b.title)}, ${sc}%">
      ${recentTag(b)}<span class="c-ic">${subjectIcon(b.subject, 20, '#FFFFFF', b.title)}</span>
      <span class="c-sub" data-raw>${esc(b.subject ? subj(b.subject) : (b.library ? '' : W('My upload', '我上載的')))}</span>
      <span class="c-title" data-raw>${esc(b.title)}</span>
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
function renderSettings() {
  const zh = LANG === 'zh';
  const opt = (k, label, sub) => `<button class="langopt ${LANG === k ? 'on' : ''}" data-lang="${k}" aria-pressed="${LANG === k}" lang="${k === 'zh' ? 'zh-HK' : 'en'}" data-raw><b>${label}</b><span>${sub}</span></button>`;
  $app.innerHTML = `
  <main class="pad stack g18 settings" data-view="settings" style="flex:1">
    <h1 class="pagetitle">Settings</h1>
    ${planCardHTML()}
    <section class="card stack g10" style="padding:16px">
      <b style="font-size:15px">Language</b>
      <span class="muted" style="font-size:13.5px;line-height:1.5">For PrepBuddy’s buttons and messages. Your textbooks and their questions stay in the book’s own language.</span>
      <div class="langopts" role="group" aria-label="Language">${opt('en', 'English', 'English')}${opt('zh', '中文（繁體）', 'Traditional Chinese')}</div>
    </section>
    <section class="card stack g10" style="padding:16px">
      <label for="sname" style="font-size:15px;font-weight:700">Your name</label>
      <span class="muted" style="font-size:13.5px;line-height:1.5">Used to greet you and on the weekly report you send your parents.</span>
      <input id="sname" class="input" autocomplete="given-name" placeholder="e.g. Ka Yan" value="${esc(local.name || '')}">
    </section>
    <section class="card stack g10" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b style="font-size:15px">Stars and rewards${locked('stars') ? ' <span class="lock-tag inl">🔒 Plus</span>' : ''}</b>
        <button class="switch ${starsOn() ? 'on' : ''}" id="sstars" role="switch" aria-checked="${starsOn()}" aria-label="Stars and rewards"><i></i></button></div>
      <span class="muted" style="font-size:13.5px;line-height:1.5">Earn stars for practising and spend them on rewards your parents choose. On automatically for primary school books.</span>
    </section>
    ${local.pilot ? `<section class="card stack g10" style="padding:16px">
      <b style="font-size:15px">${PLT('Take the tour again', '再看一次導覽')}</b>
      <span class="muted" style="font-size:13.5px;line-height:1.5">${PLT('A quick look at what PrepBuddy can do.', '快速看看 PrepBuddy 可以做甚麼。')}</span>
      <button class="btn-sm" id="stour" style="align-self:flex-start">${PLT('Start the tour', '開始導覽')}</button>
    </section>
    <section class="card stack g10 fbcard" style="padding:16px">
      <b style="font-size:15px">${PLT('Tell us what you think', '告訴我們你的意見')}</b>
      <span class="muted" style="font-size:13.5px;line-height:1.5">${PLT('You’re in the PrepBuddy pilot. What do you like? What’s confusing or broken? Parents and students both welcome.', '你正參與 PrepBuddy 試用。你喜歡甚麼？有甚麼令你困惑或出錯？家長和學生都歡迎留言。')}</span>
      <textarea id="sfb" class="wr-ta small" rows="4" placeholder="${PLT('Type here…', '在這裏輸入…')}"></textarea>
      <button class="btn-sm primary" id="sfbgo" style="align-self:flex-start">${PLT('Send', '傳送')}</button>
      <span class="hint" style="margin:0">${PLT(`Family code ${esc(local.code || '')}`, `家庭代碼 ${esc(local.code || '')}`)}</span>
    </section>` : ''}
    <section class="card stack g10" style="padding:16px">
      <b style="font-size:15px">${BK('Back up your progress', '備份你的進度')}</b>
      <span class="muted" style="font-size:13.5px;line-height:1.5">${BK('Everything is saved on this device only. Save a backup file to keep it safe, or to move to a new phone or computer.', '所有資料只儲存在這部裝置。儲存備份檔案以策安全，或轉用新手機或電腦時使用。')} <b>${local.backupAt ? BK(`Last backup: ${agoWords(local.backupAt)}.`, `上次備份：${agoWords(local.backupAt)}。`) : BK('No backup yet.', '仍未備份。')}</b></span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm primary" id="sbackup">${BK('Save a backup file', '儲存備份檔案')}</button><label class="btn-sm" style="cursor:pointer">${BK('Restore from a file', '從檔案還原')}<input type="file" id="srestore" accept="application/json,.json" hidden></label></div>
    </section>
    ${local.pilot ? '' : `<section class="card stack g10" style="padding:16px">
      <b style="font-size:15px">AI usage</b>
      <span class="muted" style="font-size:13.5px;line-height:1.5">How much the AI has been used on this device for questions, marking, the tutor and the coach, and what it cost.</span>
      <button class="btn-sm" id="susage" style="align-self:flex-start">See AI usage</button>
    </section>`}
    <p class="hint" style="margin:0;line-height:1.5">Prototype. Your textbooks, questions and progress are saved on this device only.</p>
  </main>`;
  $app.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { if (b.dataset.lang === LANG) return; setLang(b.dataset.lang); go({ name: 'settings' }); }));
  const nm = document.getElementById('sname');
  nm.oninput = () => { local.name = nm.value.trim().slice(0, 30); saveLocal(); };
  { const u = document.getElementById('susage'); if (u) u.onclick = () => go({ name: 'usage' }); }
  { const t = document.getElementById('stour'); if (t) t.onclick = () => startTour(true); }
  { const fb = document.getElementById('sfbgo'); if (fb) fb.onclick = async () => { const t = document.getElementById('sfb'); if (!t.value.trim()) return t.focus(); fb.disabled = true; try { await pilotPost({ step: 'feedback', code: local.code, device: local.device, text: t.value, screen: 'settings', name: local.name || '' }); t.value = ''; toast(PLT('Thank you! We read every message.', '謝謝！每則訊息我們都會細看。')); } catch (e) { toast(PLT('Couldn’t send. Try again in a moment.', '未能傳送，請稍後再試。')); } fb.disabled = false; }; }
  document.getElementById('sbackup').onclick = async (e) => { e.target.disabled = true; try { const n = await backupFile(); toast(BK(`Backup saved (${Math.max(1, Math.round(n / 1024))} KB). Keep the file somewhere safe.`, `備份已儲存（${Math.max(1, Math.round(n / 1024))} KB），請妥善保存檔案。`)); } catch (err) { toast(BK('Couldn’t make the backup.', '未能建立備份。')); } renderSettings(); };
  document.getElementById('srestore').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await restoreFile(f); } catch (err) { toast(err.message); } e.target.value = ''; };
  document.getElementById('splans').onclick = () => go({ name: 'plans' });
  $app.querySelectorAll('[data-pv]').forEach((b) => (b.onclick = () => { local.planPreview = b.dataset.pv; saveLocal(); renderSettings(); renderTabs(); }));
  document.getElementById('sstars').onclick = () => { if (locked('stars')) return upsell('stars', 'locked'); local.starsOn = !starsOn(); saveLocal(); renderSettings(); renderTabs(); };
  window.scrollTo(0, 0);
}



/* ---------- pilot: family codes, activity and feedback ----------
   During the pilot each family gets its own code. The app asks for it once, then uses it for the AI. Each device
   sends a short summary of how PrepBuddy is being used (days, questions, scores, which features, errors) so the
   admin page can see what's working; nothing is sent when the pilot is off. */
const PLT = (en, zh) => (LANG === 'zh' ? zh : en);
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
      <div class="pg-lang" role="group" aria-label="Language / 語言"><button data-gl="en" class="${LANG === 'en' ? 'on' : ''}" aria-pressed="${LANG === 'en'}" lang="en">English</button><button data-gl="zh" class="${LANG === 'zh' ? 'on' : ''}" aria-pressed="${LANG === 'zh'}" lang="zh-HK">中文</button></div>
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
const CONSENT_V = 1;
async function pilotWelcome() {
  if (local.pilot && local.code && !(local.consent && local.consent.v >= CONSENT_V)) await consentScreen();
  if (!local.toured) await startTour();
}
function consentScreen() {
  return new Promise((resolve) => {
    const nav = document.getElementById('tabs'); if (nav) nav.style.display = 'none';
    document.body.dataset.tab = '';
    const C = (en, zh) => (LANG === 'zh' ? zh : en);
    const items = [
      ['📱', C('Stays on this device', '保存在這部裝置'), C('Your child’s answers, textbooks, essays, recordings and progress are saved in this browser.', '子女的答案、課本、文章、錄音和進度都保存在這個瀏覽器內。')],
      ['📊', C('A short summary comes to us', '一份簡短摘要會傳送給我們'), C('First name (if entered), questions answered and how many were right, minutes, features used, book titles, and app errors. Only the PrepBuddy team can see it.', '名字（如有輸入）、答題數目和答對數目、練習分鐘、使用過的功能、課本名稱，以及程式錯誤。只有 PrepBuddy 團隊可以看到。')],
      ['🤖', C('The AI reads what it needs', 'AI 只會讀取需要的內容'), C('To write questions and mark answers, textbook text and your child’s answers, photos and essays are sent to our AI provider, Anthropic. It isn’t used to train their AI.', '為了出題和批改，課文以及子女的答案、相片和文章會傳送給我們的 AI 服務供應商 Anthropic，不會用來訓練他們的 AI。')],
      ['🚫', C('What we never ask for', '我們不會收集'), C('Full name, school, address, ID or payment details. Please remind your child not to type personal details into answers or chats.', '全名、學校、地址、身份證或付款資料。請提醒子女不要在答案或對話中輸入個人資料。')],
      ['✋', C('You’re in control', '由你決定'), C('Ask to see or delete your family’s data, or leave the pilot, any time. Pilot data is deleted within 3 months after the pilot ends.', '你可隨時要求查閱或刪除你家庭的資料，或退出試用。試用結束後 3 個月內會刪除試用資料。')],
    ];
    $app.innerHTML = `<main class="pad pilotgate" data-raw style="flex:1">
      <div class="pg-box cs-box">
        <div class="cs-head">${buddySVG('listen', 64)}<div><span class="pg-tag">${C('Step 1 of 2 · for parents', '第 1 步，共 2 步 · 家長專用')}</span><h1>${C('Before we start', '開始之前')}</h1></div></div>
        <p>${C('Please ask a parent or guardian to read this and agree. It takes a minute.', '請家長或監護人閱讀並同意以下內容，只需一分鐘。')}</p>
        <div class="cs-list">${items.map(([i, h, t]) => `<div class="cs-item"><span>${i}</span><div><b>${h}</b><p>${t}</p></div></div>`).join('')}</div>
        <div class="cs-foot"><label class="cs-agree"><input type="checkbox" id="cs-ok"><span>${C('I’m this child’s parent or guardian. I’ve read this and agree to my child taking part in the PrepBuddy pilot.', '我是這名子女的家長或監護人，已閱讀以上內容，並同意子女參加 PrepBuddy 試用計劃。')}</span></label>
        <button class="btn" id="cs-go" disabled>${C('Agree and continue', '同意並繼續')}</button></div>
        <p class="hint">${C('Questions? Ask the person who invited you. You can also send us a message any time from Settings.', '有疑問？請聯絡邀請你的人，或隨時在「設定」中發送訊息給我們。')}</p>
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
      else if (x.go) { const v = typeof x.go === 'string' ? { name: x.go } : x.go; if (view.name !== v.name || (v.bookId && view.bookId !== v.bookId) || x.fresh) await go(v); }
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
// The full tour, on the real screens, using a small sample book (removed at the end) so every feature can be shown.
async function startTour(replay) {
  const C = (en, zh) => (LANG === 'zh' ? zh : en);
  const lt = (f) => (locked(f) ? ` <span class="tr-lock">🔒 ${TIERS[nextPlanFor(f)].name}</span>` : '');
  const tab = (k) => `[data-tabgo="${k}"]`;
  await installDemo(LANG);
  const demo = async () => (await getBooks()).find((b) => b.id === DEMO_ID);
  const book = { name: 'book', bookId: DEMO_ID };
  const steps = [
    { go: 'home', t: C('Hi, I’m Buddy!', '你好，我是 Buddy！'), d: C('Let me show you everything PrepBuddy can do, on the real screens. It takes about 3 minutes, and you can skip any time.', '讓我在真實的頁面上，帶你看看 PrepBuddy 的所有功能，大約 3 分鐘，隨時可以略過。') },
    { go: 'home', sel: tab('home'), t: C('Today', '今日'), d: C('Your home screen. Buddy plans what to do each day: reviews, a chapter to practise, mistakes to fix.', '你的主頁。Buddy 每天為你安排要做的事：溫習、練習章節、改正錯題。') },
    { go: 'home', sel: 'section[aria-label="Today\'s plan"]', skipIfMissing: true, t: C('Today’s plan', '今日計劃'), d: C('Start here every day. Tap an item and Buddy takes you straight to it. 15 minutes is plenty.', '每天由這裏開始。按一下項目，Buddy 會直接帶你去。每天 15 分鐘就足夠。') },
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
    { run: async () => { pick = { bookId: DEMO_ID, ids: new Set(['u0']), open: new Set(), opts: true }; await go(book); }, sel: '#paper', skipIfMissing: true, t: C('Mock papers', '模擬試卷') + lt('mock'), d: C('Full DSE-style papers, or printable worksheets to do on paper.', '完整 DSE 模式試卷，或可列印的工作紙。') },
    { go: 'home', sel: 'section[aria-label="School tests"]', skipIfMissing: true, t: C('School tests', '學校測驗') + lt('sched'), d: C('Add your test dates. Today’s plan counts down and focuses on what’s coming up.', '加入測驗日期，今日計劃會倒數，並集中溫習要考的內容。') },
    { go: 'homework', sel: '.hw-cap, .hw-hero', t: C('Homework help', '功課幫手') + lt('homework'), d: C('Snap a photo of your homework. Buddy reads it and guides you through each question.', '拍下功課，Buddy 會讀取題目，並引導你逐題完成。') },
    { go: 'dictation', sel: '#dnew', skipIfMissing: true, t: C('默書 · Dictation', '默書'), d: C('Snap your dictation list. Buddy reads the words aloud, you write them, then check.', '拍下默書範圍，Buddy 讀出詞語，你寫下來，然後核對。') },
    { go: 'writing', sel: '.wr-step', skipIfMissing: true, t: C('Writing', '寫作') + lt('writing'), d: C('Pick a DSE paper, write or snap your essay, and get marked against the real criteria. Then redraft.', '選擇 DSE 試卷，輸入或拍下文章，按真實準則批改，再修改。') },
    { go: 'speaking', sel: '.wr-step', skipIfMissing: true, t: C('Speaking', '說話') + lt('speaking'), d: C('DSE Paper 4 practice: get a topic, speak for a minute, and get feedback on your answer.', 'DSE 卷四練習：取得題目，說一分鐘，然後獲得回饋。') },
    { go: 'mistakes', sel: tab('mistakes'), t: C('Mistake book', '錯題簿'), d: C('Every wrong answer lands here by subject and chapter. Get it right a day later and it’s mastered.', '答錯的題目會按科目和章節放在這裏。隔天再答對，就算掌握了。') },
    { go: 'progress', sel: tab('progress'), t: C('Progress', '進度'), d: C('Time practised, scores over time, and how ready you are for each book.', '練習時間、分數變化，以及每本課本的準備程度。') },
    { go: 'progress', sel: '#goal-set, #goal-edit', skipIfMissing: true, t: C('Weekly goal', '每週目標'), d: C('Pick days and minutes a week. Reaching it earns bonus stars.', '選擇每週練習的天數和分鐘。達成可以賺額外星星。') },
    { go: 'progress', sel: '#parentDash', skipIfMissing: true, t: C('Parent dashboard', '家長主頁') + lt('parent'), d: C('Behind a PIN that a parent sets: today, this week, and what needs attention.', '由家長設定密碼保護：今日、本週，以及需要留意的地方。') },
    { go: 'progress', sel: '#report', skipIfMissing: true, t: C('Weekly report', '每週報告'), d: C('A one-page summary to send to a parent as a link.', '一頁摘要，可以用連結傳送給家長。') },
    { go: 'stars', sel: 'section.stack', skipIfMissing: true, t: C('Stars and rewards', '星星與獎勵') + lt('stars'), d: C('Earn stars for real effort and swap them for rewards your parents choose. Rushing earns nothing!', '憑真正努力賺取星星，換取家長設定的獎勵。亂答一通不會有星星！') },
    { go: 'settings', sel: tab('settings'), t: C('Settings', '設定'), d: C('Your name, language, plan, stars on or off, and backups.', '你的名字、語言、計劃、開關星星，以及備份。') },
    { go: 'settings', sel: '#sfb', skipIfMissing: true, t: C('Tell us what you think', '告訴我們你的意見'), d: C('Something confusing, or a great idea? Type it here. We read every message.', '有地方令你困惑，或有好主意？在這裏輸入，我們會細閱每一個訊息。') },
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
    v: 2, at: Date.now(), name: (local.name || '').trim().slice(0, 30), lang: LANG, plan: planId(), primary: !!primaryCache,
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pilotSync(); });

/* ---------- back up and restore (until accounts) ----------
   Everything PrepBuddy keeps on this device in one file: progress, settings, textbooks, questions, notes,
   essays, homework. Restore replaces what is on the device with the file's contents. Speaking recordings stay
   behind (too big); their marks and feedback are included. */
const BK = (en, zh) => (LANG === 'zh' ? zh : en);
async function backupFile() {
  const ks = (await store.keys('')).filter((k) => !String(k).startsWith('spaud:'));
  const vals = await store.getMany(ks, null);
  const db = {};
  ks.forEach((k, i) => { const v = vals[i]; if (v !== null && v !== undefined && !(typeof Blob !== 'undefined' && v instanceof Blob)) db[k] = v; });
  local.backupAt = Date.now(); saveLocal();
  const data = { app: 'prepbuddy', v: 1, at: new Date().toISOString(), ui: (() => { try { return localStorage.getItem('prepbuddy.ui'); } catch (e) { return null; } })(), local, db };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `PrepBuddy backup ${(local.name || '').trim() ? local.name.trim() + ' ' : ''}${ymd(Date.now())}.json`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return blob.size;
}
async function restoreFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error(BK('That file isn’t a PrepBuddy backup.', '這個檔案不是 PrepBuddy 備份。')); }
  if (!data || data.app !== 'prepbuddy' || !data.local || !data.db) throw new Error(BK('That file isn’t a PrepBuddy backup.', '這個檔案不是 PrepBuddy 備份。'));
  const ok = await confirmLeave({ title: BK('Replace everything on this device?', '取代這部裝置上的所有資料？'),
    body: BK(`This backup is from ${new Date(data.at).toLocaleString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${data.local.name ? ` (${data.local.name})` : ''}. Progress on this device now will be replaced by it.`, `這個備份建立於 ${new Date(data.at).toLocaleString('zh-HK')}${data.local.name ? `（${data.local.name}）` : ''}。這部裝置現有的進度會被取代。`),
    stay: BK('Cancel', '取消'), leave: BK('Restore', '還原') });
  if (!ok) return false;
  for (const k of await store.keys('')) await store.del(k);
  for (const [k, v] of Object.entries(data.db)) await store.set(k, v);
  try { localStorage.setItem('prepbuddy.v2', JSON.stringify(data.local)); if (data.ui) localStorage.setItem('prepbuddy.ui', data.ui); } catch (e) {}
  await store.persist();
  location.reload();
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
  return !!primaryCache;
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
  box.innerHTML = `<div class="confetti" aria-hidden="true">${conf}</div><div class="cdlg sc-card" role="dialog" aria-modal="true" aria-labelledby="sc-t" data-raw>
    <div class="sc-buddy">${buddySVG('happy', 84)}</div>
    ${won.n ? `<b id="sc-t" class="sc-big">+${won.n} ${starSVG(30)}</b>` : `<b id="sc-t" class="sc-big">${ST('Great work!', '做得好！')}</b>`}
    ${won.lines.length ? `<div class="sc-lines">${won.lines.map(([l, k]) => `<div><span>${esc(l)}</span><b>+${k} ★</b></div>`).join('')}</div>` : ''}
    ${won.badges.map((b) => `<div class="sc-badge"><span>${b.icon}</span><div><small>${ST('New badge!', '新徽章！')}</small><b>${esc(ST(b.en, b.zh))}</b><span>${esc(ST(b.den, b.dzh))} · +${b.stars} ★</span></div></div>`).join('')}
    ${won.capped ? `<p class="sc-cap">${ST('That’s all the stars for today. Come back tomorrow for more!', '今日的星星已經全部拿到，明天再來吧！')}</p>` : ''}
    <div class="sc-bal">${ST('You have', '你現在有')} <b>${starState().bal}</b> ${starSVG(18)}</div>
    <div class="rd-row"><button class="btn ghost" id="sc-shop">${ST('Star shop', '星星商店')}</button><button class="btn" id="sc-ok">${ST('Yay!', '好呀！')}</button></div>
  </div>`;
  document.body.appendChild(box);
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
  const fmt = (t) => new Date(t).toLocaleDateString(zh ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' });
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
  return `<div class="badges">${BADGES.map((b) => { const got = s.badges[b.id]; return `<div class="bdg ${got ? 'got' : ''}" title="${esc(ST(b.den, b.dzh))}"><span>${b.icon}</span><b>${esc(ST(b.en, b.zh))}</b><small>${got ? new Date(got).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' }) : esc(ST(b.den, b.dzh))}</small></div>`; }).join('')}</div>`;
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
const TABS = [['home', 'Today', 'today'], ['books', 'Books', 'books'], ['mistakes', 'Mistakes', 'pen'], ['progress', 'Progress', 'chart'], ['settings', 'Settings', 'gear']];
let tabNow = null;
function renderTabs(active = tabNow) {
  tabNow = active;
  const nav = document.getElementById('tabs');
  if (!active) { delete document.body.dataset.tab; return; }
  document.body.dataset.tab = active;
  const mk = mistakeCount();
  nav.innerHTML = `<span class="brand-side">${logoSVG(30)}<span>PrepBuddy</span></span><div class="tabs-in">${TABS.map(([k, label, ic]) => `<button class="${k === active ? 'on' : ''}" data-tabgo="${k}" ${k === active ? 'aria-current="page"' : ''}>${menuIcon(k, k === active)}<span>${label}</span>${k === 'mistakes' && mk ? `<span class="badge">${mk > 99 ? '99+' : mk}</span>` : ''}</button>`).join('')}</div>${planId() !== 'pro' ? `<button class="side-up" id="sideUp"><span class="plan-pill ${planId()}">${PL(curPlan().name, curPlan().zh)}</span><b>${PL('Upgrade', '升級')} →</b></button>` : ''}`;
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
// The menu shows on every screen except timed papers (mock papers, chapter tests, mini mocks), which get the
// whole screen like a real exam. Screens that aren't one of the four tabs light up the tab they belong to.
const TAB_OF = { parent: 'progress', plans: 'settings', speaking: 'home', writing: 'home', learn: 'books', dictation: 'home', homework: 'home', stars: 'progress', settings: 'settings', home: 'home', books: 'books', mistakes: 'mistakes', progress: 'progress', book: 'books', notes: 'books', cards: 'books', paper: 'books', edit: 'books', library: 'books', pick: 'home', worksheets: 'home', usage: 'home' };
const timedPaper = () => !!(S && $app.querySelector('#quit') && (S.mode === 'dse' || S.deadline) && !S.review);
new MutationObserver(() => {
  const m = $app.querySelector('main[data-view]');
  if (m) return renderTabs(m.dataset.view);
  if (timedPaper()) return renderTabs(null);
  renderTabs((view && TAB_OF[view.name]) || 'home');
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
  const mine = new Set((await getBooks()).map((b) => b.id));
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Books</span></button><span style="font-weight:600;font-size:15px">Textbook library</span></div>
  <main class="stack g14" data-view="books" style="flex:1;padding:4px 20px 24px">
    <form id="find" class="searchbox light" role="search">
      <span aria-hidden="true" style="color:var(--muted);display:flex">${ICON.search}</span>
      <input id="q" type="search" placeholder="Search by title, subject or book code" aria-label="Search the library" autocomplete="off" value="${esc(query)}">
    </form>
    <div id="chips"></div>
    <div id="results" class="stack g10" aria-live="polite"></div>
  </main>`;
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
            <b style="font-size:15px;line-height:1.35" data-raw>${esc(b.title)}</b>
            <span class="muted" style="font-size:13px" data-raw>${esc([subj(b.subject), b.level, b.publisher].filter(Boolean).join(' · '))}</span>
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

async function addFromLibrary(entry, btn) {
  if (limitOf('books') !== UNL && (await getBooks()).length >= limitOf('books')) return upsell('books', 'limit');
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
          <div class="eacts"><button class="btn small" id="doSplit" data-u="${esc(u.id)}">Split here</button><button class="btn-sm quiet" id="noSplit">Cancel</button></div></div>`
        : `<div class="eacts">${last ? '' : `<button class="btn-sm" data-merge="${esc(u.id)}">Merge with next</button>`}${canSplit ? `<button class="btn-sm" data-split="${esc(u.id)}">Split</button>` : ''}<button class="btn-sm quiet" data-hide="${esc(u.id)}">Hide</button></div>`}
    </div>`;
  };
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Chapters</span></button><span style="font-weight:600;font-size:15px">Edit chapters</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Fix chapter names, merge or split chapters, or hide parts that aren’t for revising (like answers or the index). Your questions and progress are kept.</p>
    ${pages ? '' : `<p class="hint" style="margin:0">${book.library ? 'Library books can be renamed, merged or hidden.' : 'Splitting needs the book uploaded again (books uploaded before today can still be renamed, merged or hidden).'}</p>`}
    <div class="card stack">${book.units.map(row).join('')}</div>
    ${hidden.length ? `<p style="margin:6px 0 0;font-size:15px;font-weight:600">Hidden (${hidden.length})</p>
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

async function renderBook(bookId) {
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
    : pl ? `<p class="pl-done">✓ Level check done ${new Date(pl.t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' })} · <button class="linkbtn" id="plGo">Take it again</button></p>` : '';
  // Learn: a guided lesson per chapter, shown as its own section above the practice list.
  const learned = local.learned || {};
  const lkey = (u) => learned[`${book.id}:${u.id}`];
  const lstat = (u) => (lkey(u) ? `✓ Learned ${new Date(lkey(u)).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' })}` : 'Not learned yet · about 5 min');
  const plWeak = (u) => { const r = ((pl || {}).u || {})[u.id]; return r && r[1] && r[0] / r[1] < 0.4; };
  const nextU = book.units.find((u) => pick.ids.has(u.id) && !lkey(u)) || book.units.find((u) => plWeak(u) && !lkey(u)) || book.units.find((u) => !lkey(u)) || book.units[0];
  const lrow = (u, cls = '') => `<div class="lc-row ${cls} ${lkey(u) ? 'done' : ''}">${cls === 'next' ? '<span class="lc-up">Up next</span>' : ''}<span class="lc-t"><b data-raw>${esc(cleanTitle(u.title))}</b><small>${lstat(u)}</small></span><button class="btn-sm lc-go ${lkey(u) ? '' : 'primary'}" data-learn="${esc(u.id)}">${lkey(u) ? 'Learn again' : 'Start lesson'}</button></div>`;
  const nLearned = book.units.filter(lkey).length;
  const learnHTML = `<section class="learn-card" aria-label="Learn">
      <div class="lc-head"><span class="lc-ic">${actionIcon('learn', 24)}</span><div><h2>Learn${book.units.length > 1 ? ` <small>${nLearned} of ${book.units.length} learned</small>` : ''}</h2><p>New to a chapter? Buddy teaches it step by step, with quick checks as you go. Then practise it below.</p></div></div>
      ${book.units.length <= 4 ? `<div class="lc-list">${book.units.map((u) => lrow(u)).join('')}</div>`
        : `<div class="lc-list">${lrow(nextU, 'next')}</div>
        <label class="lc-pick"><span>Or choose a chapter</span><select id="learnpick"><option value="">Choose…</option>${book.units.map((u) => `<option value="${esc(u.id)}">${lkey(u) ? '✓ ' : ''}${esc(cleanTitle(u.title))}</option>`).join('')}</select></label>`}
    </section>`;
  const stat = (v, label) => `<span><b>${v}</b> ${label}</span>`;
  const head = `<section class="bk-head">
      <div class="bk-cover" style="background:${coverColour(book)}" aria-hidden="true">${subjectIcon(book.subject, 30, '#FFFFFF', book.title)}</div>
      <div class="bk-info">
        <h1 data-raw>${esc(book.title)}</h1>
        <p data-raw>${esc([subj(book.subject), book.level, book.library ? '' : (LANG === 'zh' ? '自行上載' : 'Uploaded by you')].filter(Boolean).join(' · ') || ' ')}</p>
        <div class="bk-stats">${stat(book.units.length, book.units.length === 1 ? 'chapter' : 'chapters')}${stat(qReady, qReady === 1 ? 'question ready' : 'questions ready')}${stat(answered, 'answered')}</div>
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
    <h2 class="bk-sec"><span class="bk-sec-ic">${actionIcon('practise', 22)}</span>Practise</h2>
    <div class="chtools">
      <p style="margin:0;font-size:15px;font-weight:600">${book.units.length === 1 ? '1. Your chapter' : `1. Choose chapters to practise <span class="muted" style="font-weight:500">(${book.units.length})</span>`}</p>
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
    <div class="setup-head"><p style="margin:0;font-size:15px;font-weight:600">2. Set up your practice${n ? ` <span class="muted" style="font-weight:500">· ${n} chapter${n > 1 ? 's' : ''} ticked</span>` : ''}</p>${n ? `<button class="btn-sm setup-more" id="opts" aria-expanded="${!!pick.opts}">${pick.opts ? 'Fewer options' : 'More options'}</button>` : ''}</div>
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
        <button class="mw" id="paper">${lockTag('mock')}${actionTile('mock', 40)}<b>Mock paper</b><span>DSE-style or worksheet</span></button>
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
  $app.querySelectorAll('[data-types]').forEach((b) => (b.onclick = () => { local.types = b.dataset.types; saveLocal(); keep(); }));
  $app.querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => { if (b.classList.contains('dlock')) return upsell('hardDiff', 'locked'); local.diff = b.dataset.diff; saveLocal(); keep(); }));
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
  $app.querySelectorAll('[data-learn]').forEach((b) => (b.onclick = () => go({ name: 'learn', bookId, unitId: b.dataset.learn })));
  { const pg = document.getElementById('plGo'); if (pg) pg.onclick = () => startPlacement(book); }
  { const ps = document.getElementById('plSkip'); if (ps) ps.onclick = () => { local.plHide = { ...(local.plHide || {}), [book.id]: 1 }; saveLocal(); keep(); }; }
  { const lp = document.getElementById('learnpick'); if (lp) lp.onchange = () => { if (lp.value) go({ name: 'learn', bookId, unitId: lp.value }); }; }
  document.getElementById('cards').onclick = () => go({ name: 'cards', bookId });
  window.scrollTo(0, 0);
}

// As soon as chapters are ticked, the first batch of questions (and the quick-look cards) starts being made,
// so by the time the student presses Start there is little or nothing left to wait for.
async function prefetch(book, units) {
  if (!units.length || units.length > 3 || navigator.onLine === false) return;
  const types = local.types || 'mix', count = local.count || SESSION_SIZE;
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
    if (!fresh) { const have = await store.get(key, null); if (have && Array.isArray(have.sections)) return have; }
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
  <div class="topbar noprint"><button class="backbtn" id="back">${ICON.back}<span>Chapters</span></button><span style="font-weight:600;font-size:15px;flex:1">Revision notes</span><button class="btn-sm" id="printn">Print</button></div>
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
  const units = paperUnits(book), myView = view;
  if (!only) {
    $app.innerHTML = `<div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Chapters</span></button></div>
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
  document.getElementById('quit').onclick = async () => { if (await confirmLeave(leaveText('cards'))) go({ name: 'book', bookId: C.bookId }); };
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
  const names = books.filter((b) => practised.has(b.id)).map((b) => (b.subject ? subj(b.subject) : b.title));
  const ms = [], subjects = [];
  for (const b of books) { const m = await bookMastery(b); subjects.push({ book: b, pct: m.pct }); if (m.chapters.some((c) => c.done)) ms.push([b.subject ? subj(b.subject) : b.title, m.pct, b.id]); }
  // the exam forecast travels with the report: [name, % by the exam] for books with a pace
  const E = examInfo(subjects);
  ms.forEach((x) => { const f = E && E.fc.find((y) => y.x.book.id === x[2]); x.length = 2; if (f && !f.wait) x.push(f.by); });
  const weekAgo = Date.now() - 7 * DAY, monthAgo = Date.now() - 30 * DAY;
  const fx = Object.values(local.mistakes || {}).filter((m) => m.done && !m.manual && (m.doneAt || 0) > weekAgo).length;
  const ts = (local.tests || []).filter((t) => t.kind && t.t > monthAgo).slice(-6).reverse().map((t) => [t.kind, String(t.title || '').slice(0, 60), t.t, t.m ? Math.round(100 * t.g / t.m) : 0, t.min || 0]);
  return buildReport({ log: local.log, stats: local.stats, name: local.name, books: [...new Set(names)], lang: LANG, ms, mk: mistakeCount(), fx,
    goal: local.goal || null, exam: E && E.left !== null ? { left: E.left, date: E.date } : null, ts,
    sr: starsOn() ? (() => { const st = starState(), wk = Date.now() - 7 * DAY;
      return { w: st.log.filter((x) => x.t > wk).reduce((a, x) => a + x.n, 0), bal: st.bal,
        b: BADGES.filter((b) => (st.badges[b.id] || 0) > wk).map((b) => `${b.icon} ${LANG === 'zh' ? b.zh : b.en}`),
        r: st.redeemed.filter((x) => x.t > wk).map((x) => `${x.icon || '🎁'} ${x.name}`) }; })() : null });
}

// The week (days practised + three numbers) and "How ready you are", shared by Today and Progress.
function weekHTML(r) {
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'narrow' }));
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
    rows.push({ b, pct: m.pct, html: `<button class="mrowb" data-book="${esc(b.id)}">${subjectTile(b.subject, 36, b.title)}<span class="mt"><b data-raw>${esc(b.subject ? subj(b.subject) : b.title)}</b><span class="bar ${m.pct < 60 ? 'warn' : m.pct < 80 ? 'mid' : ''}"><i style="width:${m.pct}%"></i></span></span><span class="m-pill ${m.pct >= 80 ? 'good' : m.pct >= 60 ? 'mid' : ''}">${m.pct}%</span></button>` });
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
  const lab = (t) => new Date(t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' });
  return `<svg class="pg-trend" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${PT('Weekly score', '每週分數')}: ${weeks.map((w) => (w.a === null ? '–' : w.a + '%')).join(', ')}">
    ${[50, 80].map((g) => `<line x1="34" x2="${W - 12}" y1="${py(g)}" y2="${py(g)}" class="grid"/><text x="0" y="${py(g) + 4}" class="gl">${g}%</text>`).join('')}
    <path d="${path}" class="ln"/>
    ${pts.map((p) => `<circle cx="${px(p.i)}" cy="${py(p.a)}" r="4.5" class="dot"/><text x="${px(p.i)}" y="${py(p.a) - 10}" text-anchor="middle" class="vl">${p.a}%</text>`).join('')}
    ${weeks.map((w, i) => `<text x="${px(i)}" y="${H + 14}" text-anchor="middle" class="xl">${i === 5 ? PT('This week', '本週') : lab(w.start)}</text>`).join('')}
  </svg>`;
}

async function renderProgress() {
  const D = await progressData(), r = D.r;
  const zh = LANG === 'zh';
  const mins = r.days.reduce((a, m) => a + m, 0);
  const hm = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : PT(`${mins} min`, `${mins} 分鐘`);
  const tone0 = weekTone(r);
  const verdict = { none: PT('No practice yet this week', '本週還未練習'), strong: PT('You had a strong week', '你本週表現出色'),
    lighter: PT('A lighter week', '本週練習較少'), steady: PT('You had a steady week', '你本週表現穩定'), start: PT('Good start this week', '本週好的開始') }[tone0];
  const sub = tone0 === 'none' ? PT('A short session today gets your week going.', '今天練習一會兒，為這星期開個好頭。')
    : tone0 === 'lighter' ? PT(`You practised ${r.pm - mins} min less than last week. A short session today gets you back on track.`, `比上週少練習了 ${r.pm - mins} 分鐘。今天練習一會兒，就能重回正軌。`)
    : PT(`Practised ${r.dp} of the last 7 days`, `過去 7 日中有 ${r.dp} 日練習`);
  const diff = r.a !== null && r.pa !== null ? r.a - r.pa : null;
  const stat = (icon, tone, value, label, extra = '') => `<div class="pg-stat"><span class="pg-ic ${tone}">${pIcon(icon, 20)}</span><div><b>${value}</b><span>${label}</span>${extra}</div></div>`;
  const dayName = (i, f) => new Date(r.from + i * DAY).toLocaleDateString(zh ? 'zh-HK' : 'en-GB', { weekday: f });
  const maxMin = Math.max(20, ...r.days);
  const longest = r.days.indexOf(Math.max(...r.days));
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  const chLabel = (p) => (p >= 80 ? PT('Strong', '強') : p >= 60 ? PT('Getting there', '漸入佳境') : PT('Needs work', '需加強'));
  const chName = (c) => cleanUnitTitle(c.unit.title);

  // what to do next: each one is something to tap
  const acts = [];
  if (D.weak) acts.push(`<button class="pg-act weak" data-unit="${esc(D.weak.book.id)}:${esc(D.weak.unit.id)}"><span class="pg-ic low">${pIcon('alert')}</span><span class="pg-at"><small>${PT('Needs work', '需要加強')}</small><b>${esc(chName(D.weak))}</b><span>${PT(`${D.weak.wrong} of ${D.weak.n} not fully right · practise it`, `${D.weak.n} 題中有 ${D.weak.wrong} 題未完全答對 · 去練習`)}</span></span>${pIcon('next', 18)}</button>`);
  if (D.due) acts.push(`<button class="pg-act" id="act-review"><span class="pg-ic blue">${pIcon('repeat')}</span><span class="pg-at"><small>${PT('Due today', '今日要溫習')}</small><b>${PT(`${D.due} review${D.due === 1 ? '' : 's'}`, `${D.due} 條溫習題`)}</b><span>${PT('Quick reviews help you remember for the exam', '快速溫習，考試時記得更牢')}</span></span>${pIcon('next', 18)}</button>`);
  if (D.mistakes) acts.push(`<button class="pg-act" id="act-mistakes"><span class="pg-ic red">${pIcon('pencil')}</span><span class="pg-at"><small>${PT('Mistake book', '錯題簿')}</small><b>${PT(`${D.mistakes} to get right`, `${D.mistakes} 題要改正`)}</b><span>${D.fixed ? PT(`${D.fixed} fixed this week`, `本週改正了 ${D.fixed} 題`) : PT('Get them right to move them to Mastered', '答對後會移到已掌握')}</span></span>${pIcon('next', 18)}</button>`);
  if (D.up) acts.push(`<div class="pg-act good"><span class="pg-ic green">${pIcon('up')}</span><span class="pg-at"><small>${PT('Getting better', '有進步')}</small><b>${esc(chName(D.up))}</b><span>${D.up.was !== null ? PT(`Up from ${D.up.was}% to ${D.up.a}% since last week`, `由上週 ${D.up.was}% 進步至 ${D.up.a}%`) : PT(`${D.up.a}% this week`, `本週 ${D.up.a}%`)}</span></span></div>`);
  if (!acts.length) acts.push(`<button class="pg-act" id="act-books"><span class="pg-ic blue">${pIcon('book')}</span><span class="pg-at"><small>${PT('Start here', '由這裡開始')}</small><b>${PT('Practise a chapter', '練習一個章節')}</b><span>${PT('Your insights appear after a few questions', '做幾題後，就會看到你的分析')}</span></span>${pIcon('next', 18)}</button>`);

  const names = SKILL_PLAIN();
  const rated = r.sk.map(([a, n], i) => ({ a, n, i })).filter((x) => x.n >= 3 && x.a !== null);
  const best = rated.slice().sort((x, y) => y.a - x.a)[0], worst = rated.slice().sort((x, y) => x.a - y.a)[0];
  const skillNote = best && worst && best.i !== worst.i && best.a - worst.a >= 15
    ? PT(`Best at ${names[best.i].toLowerCase()}. ${names[worst.i]} needs the most work.`, `最擅長「${names[best.i]}」；「${names[worst.i]}」最需要加強。`)
    : rated.length ? PT('Fairly even across question types.', '各類題型表現大致平均。') : '';

  $app.innerHTML = `
  <main class="pad pgpage" data-view="progress" data-raw style="flex:1">
    <h1 class="pagetitle">${PT('Progress', '進度')}</h1>
    <section class="pg-hero">${buddySVG(r.q ? 'happy' : 'think', 60)}<div><b>${verdict}</b><span>${sub}</span></div></section>
    <div class="pg-stats">
      ${stat('flame', 'orange', D.streak, PT(D.streak === 1 ? 'day in a row' : 'days in a row', '連續練習日數'))}
      ${stat('check', 'blue', r.q, PT('questions this week', '本週題數'), `<small>${PT(`${D.total} in total`, `累計 ${D.total} 題`)}</small>`)}
      ${stat('clock', 'purple', hm, PT('practising this week', '本週練習時間'))}
      ${stat('target', 'green', r.a === null ? '–' : r.a + '%', PT('score this week', '本週得分率'), diff === null ? '' : `<small class="${diff >= 0 ? 'upc' : 'downc'}">${diff >= 0 ? '↑' : '↓'} ${Math.abs(diff)} ${PT('from last week', '比上週')}</small>`)}
    </div>
    <div class="pg-grid">
      <div class="pg-c">
        ${goalCardHTML(D)}
        <section class="pgcard"><h2>${pIcon('bars', 18)} ${PT('This week', '本週')}<span>${r.q ? PT(`Longest: ${dayName(longest, 'long')}, ${r.days[longest]} min`, `最長：${dayName(longest, 'long')}，${r.days[longest]} 分鐘`) : ''}</span></h2>
          <div class="pg-bars">${r.days.map((m, i) => `<div title="${dayName(i, 'long')}: ${m} min"><small>${m ? m + PT('m', '分') : ''}</small><i class="${m ? '' : 'none'} ${i === 6 ? 'today' : ''}" style="height:${m ? Math.max(8, Math.round(96 * m / maxMin)) : 4}px"></i><span>${dayName(i, 'short')}</span></div>`).join('')}</div>
        </section>
        <section class="pgcard"><h2>${pIcon('target', 18)} ${PT('What to do next', '下一步')}</h2><div class="pg-acts">${acts.join('')}</div></section>
        ${D.chapters.length ? `<section class="pgcard"><h2>${pIcon('book', 18)} ${PT('Chapters this week', '本週練習的章節')}</h2>
          <div class="pg-chs">${D.chapters.slice(0, 8).map((c) => `<div class="pg-ch"><div class="pg-ch-top"><span>${esc(chName(c))}</span><b class="${tone(c.a)}">${c.a}%</b></div><div class="pg-bar ${tone(c.a)}"><i style="width:${c.a}%"></i></div><small>${chLabel(c.a)} · ${PT(`${c.n} answered`, `${c.n} 題`)}${c.was === null ? '' : c.a === c.was ? ` · ${PT('same as last week', '與上週相同')}` : ` · ${c.a > c.was ? '↑' : '↓'} ${PT(`from ${c.was}%`, `上週 ${c.was}%`)}`}</small></div>`).join('')}</div></section>` : ''}
      </div>
      <div class="pg-c">
        ${D.subjects.length ? `<section class="pgcard"><h2>${pIcon('ring', 18)} ${PT('How ready you are', '準備程度')}</h2>
          <div class="pg-rings">${D.subjects.map((x) => {
            const started = x.pct > 0;
            const ring = started ? ringHTML(x.pct, tone(x.pct), x.pct + '%') : ringHTML(x.covered, 'cov', x.covered ? x.covered + '%' : '–');
            const lab = started ? (zh ? ({ Mastered: '已掌握', 'Exam ready': '準備應考', 'Well versed': '熟練', 'Getting there': '漸入佳境', 'Building up': '逐步建立', 'Just started': '剛開始' }[masteryLabel(x.pct)] || '') : masteryLabel(x.pct)) : x.covered ? PT(`Started · ${x.covered}% covered`, `已開始 · 涵蓋 ${x.covered}%`) : PT('Not started', '未開始');
            return `<button class="pg-rg" data-book="${esc(x.book.id)}">${ring}<b>${esc(x.book.subject ? subj(x.book.subject) : x.book.title)}</b><small>${lab}</small></button>`;
          }).join('')}</div></section>` : ''}
        <section class="pgcard"><h2>${pIcon('line', 18)} ${PT('Score over time', '分數走勢')}</h2>${trendSVG(D.weeks)}</section>
        ${testsCardHTML(D)}
        ${rated.length ? `<section class="pgcard"><h2>${pIcon('brain', 18)} ${PT('Question types', '題型表現')}<span>${PT('last 30 days', '過去 30 日')}</span></h2>
          <div class="pg-chs">${r.sk.map(([a, n], i) => n ? `<div class="pg-ch"><div class="pg-ch-top"><span>${names[i]}</span><b class="${tone(a)}">${a}%</b></div><div class="pg-bar ${tone(a)}"><i style="width:${a}%"></i></div></div>` : '').join('')}</div>
          ${skillNote ? `<p class="pg-note">${skillNote}</p>` : ''}</section>` : ''}
        <section class="pg-two">
          <button class="pgcard pg-mini" id="mini-mistakes"><span class="pg-ic red">${pIcon('pencil')}</span><b>${D.mistakes}</b><span>${PT('mistakes to fix', '題要改正')}</span>${D.fixed ? `<small class="upc">${PT(`${D.fixed} fixed this week`, `本週改正 ${D.fixed} 題`)}</small>` : ''}</button>
          <div class="pgcard pg-mini"><span class="pg-ic green">${pIcon('memory')}</span><b>${D.longTerm}</b><span>${PT('remembered a week or more', '題記得一星期或以上')}</span></div>
        </section>
        ${starsOn() ? `<section class="pgcard"><h2>${starSVG(18)} ${PT('Stars and badges', '星星與徽章')}<button class="btn-sm quiet" data-stargo>${PT('Star shop', '星星商店')}</button></h2>
          <div class="pg-starrow"><b>${starState().bal}</b><span>${PT('stars to spend', '粒星星可以用')}</span><small>${PT(`${starState().log.filter((x) => x.t > Date.now() - 7 * DAY).reduce((a, x) => a + x.n, 0)} earned this week`, `本週賺了 ${starState().log.filter((x) => x.t > Date.now() - 7 * DAY).reduce((a, x) => a + x.n, 0)} 粒`)}</small></div>
          ${badgeShelf()}</section>` : ''}
        <section class="pgcard pg-parent"><span class="pg-ic blue">${pIcon('send')}</span><div><b>${PT('Weekly report for parents', '家長每週報告')}</b><span>${PT('One page, sent as a link', '一頁報告，以連結傳送')}</span></div><span class="pg-pbtns"><button class="btn-sm primary" id="parentDash">${PT('Parent dashboard', '家長主頁')}${locked('parent') ? ' 🔒' : ''}</button><button class="btn-sm" id="report">${PT('Preview & send', '預覽及傳送')}</button></span></section>
      </div>
    </div>
  </main>`;
  $app.querySelectorAll('[data-book]').forEach((b) => (b.onclick = () => go({ name: 'book', bookId: b.dataset.book })));
  $app.querySelectorAll('.pg-act[data-unit]').forEach((b) => (b.onclick = async () => {
    const [bid, uid2] = b.dataset.unit.split(':'); const book = (await getBooks()).find((x) => x.id === bid);
    const u = book && book.units.find((x) => x.id === uid2); if (u) startUnits(book, [u], local.count || SESSION_SIZE);
  }));
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on('act-review', () => startReview('spaced'));
  on('act-mistakes', () => go({ name: 'mistakes' }));
  on('mini-mistakes', () => go({ name: 'mistakes' }));
  on('act-books', () => go({ name: 'books' }));
  on('report', () => reportDialog());
  on('parentDash', () => openParent());
  bindStarChips($app);
  on('goal-edit', () => goalDialog());
  on('goal-set', () => goalDialog());
  on('fcUp', () => go({ name: 'plans', hi: 'pro' }));
  $app.querySelectorAll('[data-tests-more]').forEach((b) => (b.onclick = () => { b.previousElementSibling.hidden = false; b.remove(); }));
}

function goalCardHTML(D) {
  const G = D.goal, E = D.exam;
  const fmt = (t, o) => new Date(t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', o);
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
  const KIND = { paper: [PT('Mock paper', '模擬試卷'), 'blue'], test: [PT('Chapter test', '章節測驗'), 'purple'], mini: [PT('Mini mock', '小型模擬'), 'orange'] };
  const fmt = (t) => new Date(t).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { day: 'numeric', month: 'short' });
  const row = (x) => { const p = x.m ? Math.round(100 * x.g / x.m) : 0, k = KIND[x.kind] || KIND.paper, pass = x.kind === 'test' ? p >= 80 : null;
    return `<div class="pg-test"><span class="pg-ic ${k[1]}">${pIcon(x.kind === 'test' ? 'check' : 'pencil', 18)}</span><div class="pg-tt"><small>${k[0]} · ${fmt(x.t)}</small><b data-raw>${esc(String(x.title || '').replace(/^(Chapter test|章節測驗) · /, ''))}</b><span>${x.g} / ${x.m} ${PT('marks', '分')} · ${x.min} ${PT('min', '分鐘')}${x.nt ? PT(' · no time limit', ' · 不限時') : x.x ? PT(` · +${x.x} min extra`, ` · 加時 ${x.x} 分鐘`) : ''}</span></div><b class="pg-tp ${p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low'}">${p}%${pass === null ? '' : `<small>${pass ? PT('Passed', '合格') : PT('Not yet', '未合格')}</small>`}</b></div>`; };
  return `<section class="pgcard"><h2>${pIcon('pencil', 18)} ${PT('Tests and mock papers', '測驗及模擬試卷')}</h2>
    ${list.length ? `<div class="pg-tests">${list.slice(0, 4).map(row).join('')}${list.length > 4 ? `<div hidden>${list.slice(4, 20).map(row).join('')}</div><button class="btn-sm quiet" data-tests-more>${PT(`Show ${Math.min(16, list.length - 4)} more`, `顯示多 ${Math.min(16, list.length - 4)} 個`)}</button>` : ''}</div>`
      : `<p class="pg-empty">${PT('Chapter tests and mock papers you finish show up here, with your score and time.', '完成的章節測驗和模擬試卷會在這裡顯示分數和用時。')}</p>`}
  </section>`;
}

function goalDialog() {
  const g = local.goal || { days: 5, mins: 20 };
  let days = g.days, mins = g.mins;
  const box = document.createElement('div');
  box.className = 'cdlg-wrap';
  const draw = () => {
    box.innerHTML = `<div class="cdlg rdlg gdlg" role="dialog" aria-modal="true" aria-labelledby="gd-t" data-raw>
      <b id="gd-t">${PT('Your weekly goal', '你的每週目標')}</b>
      <label>${PT('Days a week', '每星期日數')}</label>
      <div class="gd-seg">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="${n === days ? 'on' : ''}" data-d="${n}">${n}</button>`).join('')}</div>
      <label>${PT('Minutes each day', '每次分鐘')}</label>
      <div class="gd-seg">${[10, 15, 20, 30, 45, 60].map((n) => `<button class="${n === mins ? 'on' : ''}" data-m="${n}">${n}</button>`).join('')}</div>
      <label for="gd-exam">${PT('Exam date (optional)', '考試日期（可選）')}</label>
      <input id="gd-exam" class="input" type="date" value="${esc(local.exam || '')}">
      <span class="hint">${PT('For the DSE, use the date of your first paper for this subject.', '如果是 DSE，請用該科第一份試卷的日期。')}</span>
      <div class="rd-row"><button class="btn ghost" id="gd-cancel">${PT('Cancel', '取消')}</button><button class="btn" id="gd-save">${PT('Save', '儲存')}</button></div>
      ${local.goal ? `<button class="btn-sm quiet" id="gd-clear" style="align-self:center">${PT('Remove goal', '刪除目標')}</button>` : ''}
    </div>`;
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
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>Settings</span></button><span style="font-weight:600;font-size:15px">AI usage on this device</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:var(--text-2)">Tokens used since you last reset. Reading PDFs happens on your device and uses no tokens.</p>
    <div style="overflow-x:auto"><table class="data usage">
      <tr><th>Step</th><th>AI calls</th><th>Input</th><th>Cache write</th><th>Cache read</th><th>Output</th><th>Cost (USD)</th></tr>
      ${rows}
      <tr><th scope="row">Total</th><td>${fmt(tot.calls)}</td><td>${fmt(tot.input)}</td><td>${fmt(tot.cache_write)}</td><td>${fmt(tot.cache_read)}</td><td>${fmt(tot.output)}</td><td><b>${usd(tot.usd)}</b></td></tr>
    </table></div>
    <p style="margin:0;font-size:15px;line-height:1.5">Estimated cost: <b>${usd(tot.usd)}</b>${made ? (LANG === 'zh' ? ` · 每條題目約 ${usd((tot.usd - ['mark', 'explain', 'notes'].reduce((x, k) => x + ((u[k] || {}).usd || 0), 0)) / made)}` : ` · about ${usd((tot.usd - ['mark', 'explain', 'notes'].reduce((x, k) => x + ((u[k] || {}).usd || 0), 0)) / made)} per question made`) : ''}${(u.mark || {}).requests ? ` · ${usd(u.mark.usd / u.mark.requests)} per answer marked` : ''}</p>
    <p class="muted" style="margin:0;font-size:13px;line-height:1.5">Questions that passed checking: <b>${fmt(made)}</b>${made ? `<br>${LANG === 'zh' ? `每條題目：輸入 ${fmt(Math.round((tot.input + tot.cache_write) / made))} · 快取讀取 ${fmt(Math.round(tot.cache_read / made))} · 輸出 ${fmt(Math.round(tot.output / made))}` : `Per question: ${fmt(Math.round((tot.input + tot.cache_write) / made))} input · ${fmt(Math.round(tot.cache_read / made))} cache read · ${fmt(Math.round(tot.output / made))} output`}` : ''}.<br>
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
  const suggested = paperMinutes(a, b);
  const mins = paperSet.t === 0 ? 0 : (paperSet.t || suggested);
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${from === 'pick' ? 'Mock paper' : from === 'home' ? 'Home' : 'Chapters'}</span></button><span style="font-weight:600;font-size:15px">Mock paper or worksheet</span></div>
  <main class="stack g18" style="flex:1;padding:4px 20px 24px">
    <p style="margin:0;line-height:1.5;color:var(--text-2)">A DSE-style paper: <b>Section A</b> multiple choice, then <b>Section B</b> written questions. Sit it timed here and get it marked, or print it and enter your answers in the app afterwards to get them marked.</p>
    <div class="card stack g6" style="padding:14px 16px">
      <span class="muted" style="font-size:13px">Chapters</span>
      <b style="font-weight:600;line-height:1.4">${units.length === book.units.length ? `All ${book.units.length} chapters` : esc(units.map((u) => u.title).join(' · '))}</b>
      <button class="btn-sm" id="change" style="align-self:flex-start">Change chapters</button>
    </div>
    <div class="stack g10">
      <span style="font-size:15px;font-weight:600">Length</span>
      <div class="chips-row">${PAPER_PRESETS.map(([k, l, pa, pb]) => `<button class="choice ${pa === a && pb === b ? 'on' : ''}" data-preset="${k}"><b>${l}</b><span>${pa} MCQ · ${pb} written · ${paperMinutes(pa, pb)} min</span></button>`).join('')}</div>
    </div>
    <div class="card stack g14" style="padding:14px 16px">
      <div class="setup-row"><span>Section A · MCQ</span><div class="stepper"><button data-step="a:-2" aria-label="Fewer MCQs" ${a <= 0 ? 'disabled' : ''}>−</button><output>${a}</output><button data-step="a:2" aria-label="More MCQs" ${a >= 40 ? 'disabled' : ''}>+</button></div></div>
      <div class="setup-row"><span>Section B · Written</span><div class="stepper"><button data-step="b:-1" aria-label="Fewer written questions" ${b <= 0 ? 'disabled' : ''}>−</button><output>${b}</output><button data-step="b:1" aria-label="More written questions" ${b >= 10 ? 'disabled' : ''}>+</button></div></div>
      <div class="setup-row"><span>Time allowed</span><div class="stepper"><button data-time="-5" aria-label="Less time" ${!mins || mins <= 5 ? 'disabled' : ''}>−</button><output>${mins ? mins + ' min' : 'No limit'}</output><button data-time="5" aria-label="More time" ${!mins || mins >= 180 ? 'disabled' : ''}>+</button></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><label class="tm-none"><input type="checkbox" id="notime" ${mins ? '' : 'checked'}> No time limit</label>
      <span class="muted" style="font-size:13px">${mins && mins !== suggested ? `Suggested: ${suggested} min · <button class="linkbtn" id="tsug">use it</button>` : mins ? 'Suggested time, at about exam pace' : ''}</span></div>
    </div>
  </main>
  <div class="sheet sticky">
    <button class="btn" id="sit" ${a + b ? '' : 'disabled'}>Start mock paper · ${mins ? mins + ' min' : 'no time limit'}</button>
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
    S = newSession({ mode: 'dse', title: 'DSE-style mock paper', book, qs, target: qs.length, sectionA: paper.A.length, deadline: dl });
  } else {
    // Section A fills up first; written questions wait in bQueue until Section A is complete.
    const full = paper.A.length >= paper.nA;
    S = newSession({ mode: 'dse', title: 'DSE-style mock paper', book, qs: full ? [...paper.A, ...paper.B] : [...paper.A], bQueue: full ? [] : [...paper.B],
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
  const written = (q, n) => `<div class="pq"><div class="pqh"><b>${n}.</b><span class="pm">${marksOf(q)} marks</span></div>${figHTML(q, 'pfig')}${q.stem ? renderStem(writtenStem(q), 'pstem') : ''}
    ${q.parts.map((p) => `<div class="ppart"><span>${esc(p.label)} ${esc(p.prompt)}</span><span class="pm">(${p.marks})</span></div>${lines(Math.max(2, p.marks + 1))}`).join('')}</div>`;
  const draw = () => {
    const who = (local.name || '').trim();
    $app.innerHTML = `
  <div class="noprint topbar"><button class="backbtn" id="back">${ICON.back}<span>Back</span></button><span style="font-weight:600;font-size:15px">Worksheet ${ws.code}</span></div>
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
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button><span style="font-weight:600;font-size:15px">Printed worksheets</span></div>
  <main class="stack g14" style="flex:1;padding:4px 20px 24px">
    <p class="muted" style="margin:0;font-size:14px;line-height:1.5">Pick the worksheet you did. Check the code at the bottom of the page. Enter what you wrote on paper, and PrepBuddy marks it.</p>
    ${list.length ? `<div class="card stack">${list.map((ws) => { const b = books.find((x) => x.id === ws.bookId); return `<div class="row wsrow"><div class="top"><span><b style="font-weight:600">${ws.code}</b> <span class="muted" style="font-size:13px">· ${when(ws.at)}</span><br><span class="muted" style="font-size:13px"><span data-raw>${esc((b.subject ? subj(b.subject) : b.title))}</span> · ${ws.A.length + ws.B.length} questions${ws.score ? ` · Marked: ${ws.score}` : ''}</span></span></div>
      <div style="display:flex;gap:14px;margin-top:8px"><button class="btn-sm" data-ws="${ws.code}">${ws.score ? 'Mark again' : 'Enter answers'}</button><button class="btn-sm quiet" data-reprint="${ws.code}">Print again</button></div></div>`; }).join('')}</div>`
      : '<div class="card" style="padding:18px 16px"><p style="margin:0;line-height:1.5;color:var(--text-2)">No printed worksheets yet. Open a textbook, choose Mock paper, then Print as a worksheet.</p></div>'}
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
async function startUnits(book, units, count = SESSION_SIZE, opts = {}) {
  track(opts.placement ? 'level_check' : 'practice');
  if (!opts.placement) { if (!allow('q')) return; if (limitOf('q') !== UNL) count = Math.max(1, Math.min(count, leftOf('q'))); }
  const k = units.length, quota = Math.ceil(count / k);
  let types = opts.types || local.types || 'mix'; const diff = opts.diff || curDiff();
  if (types !== 'mcq' && limitOf('written') !== UNL && leftOf('written') <= 0) { types = 'mcq'; toast(PL('Today’s written questions are used up: multiple choice for now. Plus has unlimited.', '今日的文字題已用完，暫時只有選擇題。Plus 無限使用。')); }
  const pools = [];
  for (const u of units) {
    const want = 2 + levelShift(book.id, u.id);
    const pool = shuffle((await getQs(book.id, u.id)).filter((q) => !local.stats[q.id] && matchType(q, types) && diffOK(q, diff)));
    // closest to the student's level first, with some variety
    pools.push(pool.map((q) => [q, Math.abs((q.level || 2) - want) + Math.random() * 1.5]).sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  }
  let qs = [];
  pools.forEach((p) => qs.push(...p.slice(0, quota)));
  if (qs.length < count) pools.forEach((p) => qs.push(...p.slice(quota)));   // top up from chapters that have more
  qs = shuffle(qs.slice(0, count));
  const title = k === 1 ? units[0].title : `${k} chapters`;
  S = newSession({ mode: 'unit', title: opts.title || title, book, units, qs, target: count, pending: 0, types, count, diff, placement: !!opts.placement });
  topUp(S);
  if (S.qs.length) renderQuestion(); else renderWaiting();
}



/* ---------- plans: Free, Plus and Pro ----------
   One table decides what each plan includes; everything else asks it. Limits count per day or per week on
   this device (accounts and payments come later). While PrepBuddy is in testing everyone has Pro, and Settings
   (or ?plan=free in the address) previews the other plans, so their layouts can be shown. */
const PL = (en, zh) => (LANG === 'zh' ? zh : en);
const UNL = Infinity;
const TIERS = {
  free: { name: 'Free', zh: '免費', price: 0, year: 0, tag: ['Practise and fix mistakes. Free forever.', '練習、改正錯誤，永久免費。'],
    lim: { books: 1, q: 20, written: 3, lesson: 2, buddy: 10, hardDiff: 0, stars: 0, coach: 0, report: 0, test: 0, sched: 0, homework: 0, writing: 0, speaking: 0, mock: 0, voice: 0, forecast: 0, parent: 0 },
    pitch: ['', ''], has: [['Practice questions from your textbooks: multiple choice, plus 3 written a day', '課本練習題：選擇題，另每日 3 條文字題'], ['Learn mode lessons with Buddy', '學習模式課堂，有 Buddy 陪你'], ['Buddy hints on every question', '每條題目都有 Buddy 提示'], ['Mistake book, reviews and level check', '錯題簿、溫習和程度評估'], ['Notes, flashcards and 默書 dictation', '筆記、溫習卡和默書'], ['Easy and Medium difficulty', '容易和中等難度'], ['Weekly activity report for parents', '家長每週練習報告']] },
  plus: { name: 'Plus', zh: 'Plus', price: 98, year: 980, tag: ['Exam-ready at school', '應付校內考試'],
    lim: { books: 3, q: 80, written: UNL, lesson: 10, buddy: 60, hardDiff: 1, stars: 1, coach: 1, report: 1, test: UNL, sched: UNL, homework: 10, writing: 2, speaking: 2, mock: 0, voice: 0, forecast: 0, parent: 0 },
    pitch: ['Everything in Free, plus:', 'Free 的全部功能，再加上：'], has: [['Unlimited written questions, marked by AI', '無限文字題，由 AI 批改'], ['Hard and Master difficulty', '困難和大師難度'], ['Chapter tests and the school test planner', '章節測驗和學校測驗計劃'], ['Homework help from photos', '拍照功課輔導'], ['Study coach with daily plans', '溫習教練，每日計劃'], ['Stars and rewards', '星星獎勵'], ['Full parent report: chapters, skills, trends', '完整家長報告：章節、能力、趨勢'], ['Writing and speaking marking, 2 a week each', '寫作和說話評分，每週各 2 次']] },
  pro: { name: 'Pro', zh: 'Pro', price: 168, year: 1680, best: true, tag: ['A private DSE tutor, for less than one lesson a month', '私人 DSE 導師，每月比一堂補習更便宜'],
    lim: { books: UNL, q: UNL, written: UNL, lesson: UNL, buddy: UNL, hardDiff: 1, stars: 1, coach: 1, report: 1, test: UNL, sched: UNL, homework: UNL, writing: UNL, speaking: UNL, mock: UNL, voice: 1, forecast: 1, parent: 1 },
    pitch: ['Everything in Plus, plus:', 'Plus 的全部功能，再加上：'], has: [['DSE mock papers and printable worksheets', 'DSE 模擬試卷和可列印工作紙'], ['Unlimited writing marking with redrafts', '無限寫作批改和修改稿'], ['Unlimited speaking practice', '無限說話練習'], ['Talk to Buddy by voice', '用語音和 Buddy 對話'], ['Exam forecast and goals', '考試預測和目標'], ['No daily limits on anything', '所有功能都沒有每日上限'], ['A parent dashboard: today, this week, tests and what needs attention', '家長主頁：今日、本週、測驗和需要留意的地方']] },
};
const PLAN_ORDER = ['free', 'plus', 'pro'];
// What each capability or allowance is, how it's counted, how it reads, and (for locked ones) what it does.
const FEAT = {
  q: { per: 'day', en: ['New practice questions', 'question a day', 'questions a day'], zh: ['新練習題目', '題／日'] },
  written: { per: 'day', en: ['Written questions marked by AI', 'a day'], zh: ['AI 批改文字題', '題／日'] },
  lesson: { per: 'day', en: ['Learn mode lessons', 'lesson a day', 'lessons a day'], zh: ['學習模式課堂', '課／日'] },
  buddy: { per: 'day', en: ['Ask Buddy messages', 'message a day', 'messages a day'], zh: ['問 Buddy 訊息', '則／日'] },
  books: { per: 'total', en: ['Textbooks', 'textbook', 'textbooks'], zh: ['課本', '本課本'] },
  hardDiff: { per: 'flag', en: ['Hard and Master difficulty'], zh: ['困難和大師難度'], d: ['Questions that stretch top students: applying and analysing, like the hardest exam questions.', '挑戰尖子的題目：應用和分析，好似考試最難的題目。'] },
  test: { per: 'week', en: ['Chapter tests', 'a week'], zh: ['章節測驗', '次／週'], d: ['Timed tests on a chapter, 80% to pass, like a school test.', '限時章節測驗，80% 合格，好似學校測驗。'] },
  sched: { per: 'total', en: ['School test planner', 'test at a time', 'tests at a time'], zh: ['學校測驗計劃', '個測驗'], d: ['Add a school test and Today’s plan counts down to it, day by day.', '加入學校測驗，今日計劃會每天幫你倒數準備。'] },
  homework: { per: 'week', en: ['Homework help (photos)', 'a week'], zh: ['功課輔導（拍照）', '次／週'], d: ['Snap tonight’s homework: Buddy explains, gives hints and checks your answers.', '拍下今晚的功課，Buddy 會解釋、給提示和檢查答案。'] },
  coach: { per: 'flag', en: ['Study coach'], zh: ['溫習教練'], d: ['A coach that sees your scores and mistakes, plans your day and starts it in one tap.', '教練看得到你的分數和錯題，幫你計劃每天溫習，一按就開始。'] },
  stars: { per: 'flag', en: ['Stars and rewards'], zh: ['星星獎勵'], d: ['Earn stars for practising and spend them on rewards your parents choose.', '練習賺星星，換取家長設定的獎勵。'] },
  report: { per: 'flag', en: ['Full parent report'], zh: ['完整家長報告'], d: ['Chapter scores, how ready for each subject, trends, tests and thinking skills.', '各章分數、各科準備程度、趨勢、測驗和思考能力。'] },
  writing: { per: 'week', en: ['Writing marked (DSE criteria)', 'a week'], zh: ['寫作批改（DSE 準則）', '篇／週'], d: ['DSE-style feedback on your essays with estimated bands, then redraft and see what improved.', '按 DSE 準則批改文章，估計等級，再修改並看到進步。'] },
  speaking: { per: 'week', en: ['Speaking answers marked', 'a week'], zh: ['說話回應評分', '次／週'], d: ['Answer DSE Paper 4 questions out loud and get marked on the four speaking domains.', '大聲回答 DSE 卷四題目，按四個說話範疇評分。'] },
  mock: { per: 'week', en: ['DSE mock papers and worksheets', 'a week'], zh: ['DSE 模擬試卷和工作紙', '份／週'], d: ['Full DSE-style papers, timed like the real exam, or printed as worksheets.', '完整 DSE 模式試卷，像真實考試限時，或列印成工作紙。'] },
  voice: { per: 'flag', en: ['Talk to Buddy (voice)'], zh: ['與 Buddy 對話（語音）'], d: ['Ask Buddy out loud in English or Cantonese and hear the answer.', '用英文或廣東話問 Buddy，並聽到回答。'] },
  parent: { per: 'flag', en: ['Parent dashboard'], zh: ['家長主頁'], d: ['A PIN-protected dashboard for parents: today’s practice, the week, school tests coming up, each subject and what needs attention.', '家長專用、有密碼保護的主頁：今日練習、本週情況、即將來臨的測驗、各科進度和需要留意的地方。'] },
  forecast: { per: 'flag', en: ['Exam forecast'], zh: ['考試預測'], d: ['See where each subject is heading by your exam date, at your current pace.', '按現時進度，預測考試時各科的準備程度。'] },
};
const ALWAYS = [['Mistake book, reviews and level check', '錯題簿、溫習和程度評估'], ['Notes, flashcards and 默書 dictation', '筆記、溫習卡和默書'], ['Weekly activity report', '每週練習報告']];
const cap = (f) => !!limitOf(f);
(() => { try { const m = location.search.match(/[?&]plan=(free|plus|pro)\b/); if (m) { local.planPreview = m[1]; saveLocal(); } } catch (e) {} })();
const planId = () => (local.planLock ? local.plan : local.planPreview || local.plan) || 'pro'; // testing: Pro unless previewing
const curPlan = () => TIERS[planId()];
const limitOf = (f) => curPlan().lim[f];
const weekStart = (t = Date.now()) => { const d = new Date(dayStart(t)); const k = (d.getDay() + 6) % 7; return d.getTime() - k * DAY; };
function usedOf(f) {
  const per = FEAT[f].per;
  if (f === 'books') return 0; // checked against the shelf when adding
  if (f === 'sched') return upcomingTests().length;
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
      <span>${PL('Free is free forever. Families receiving CSSA or the full Student Finance grant can get Pro at no cost through the PrepBuddy bursary.', '免費計劃永久免費。領取綜援或全額學生資助的家庭，可透過 PrepBuddy 助學計劃免費使用 Pro。')}</span>
      <button class="btn-sm" id="bursary">${PL('Apply for the bursary', '申請助學計劃')}</button></div></section>
    <section class="card pp-table"><h2>${PL('Compare plans', '比較計劃')}</h2><div class="pt-scroll"><table>
      <thead><tr><th></th>${PLAN_ORDER.map((p) => `<th class="${TIERS[p].best ? 'best' : ''}">${PL(TIERS[p].name, TIERS[p].zh)}</th>`).join('')}</tr></thead>
      <tbody>${Object.keys(FEAT).map((f) => `<tr><th>${PL(FEAT[f].en[0], FEAT[f].zh[0])}</th>${PLAN_ORDER.map((p) => cell(p, f)).join('')}</tr>`).join('')}
      ${ALWAYS.map((a) => `<tr><th>${PL(...a)}</th>${PLAN_ORDER.map(() => '<td class="pt-yes">✓</td>').join('')}</tr>`).join('')}</tbody></table></div></section>
    <p class="hint" style="margin:0;text-align:center">${PL('Prices are a draft while PrepBuddy is in testing. Payments aren’t switched on yet: choosing a plan previews it on this device.', '測試期間價錢只是初稿，暫未接受付款：選擇計劃只會在這部裝置預覽。')}</p>
  </main>`;
  $app.querySelectorAll('[data-bill]').forEach((b) => (b.onclick = () => { local.planYearly = b.dataset.bill === 'y'; saveLocal(); renderPlans(hi); }));
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { if (local.planLock) return toast(PL('Your plan is set for the pilot. Ask us if you’d like to change it.', '試用期間的計劃已設定，如想更改請聯絡我們。')); local.planPreview = b.dataset.pick; saveLocal(); renderTabs(); toast(PL(`Previewing ${TIERS[b.dataset.pick].name}. Payments come later.`, `正在預覽 ${TIERS[b.dataset.pick].zh}，付款功能稍後推出。`)); renderPlans(); }));
  document.getElementById('bursary').onclick = () => toast(PL('Bursary applications open with accounts. Coming soon.', '助學計劃會在帳戶功能推出時開放申請。'));
  window.scrollTo(0, 0);
}
// Settings: the plan card with today's and this week's allowance.
function planCardHTML() {
  const P = curPlan(), id = planId();
  const meters = ['q', 'written', 'buddy', 'lesson', 'homework', 'writing', 'speaking', 'mock'].filter((f) => limitOf(f) !== UNL && limitOf(f) > 0).map((f) => { const lim = limitOf(f), u = Math.min(lim, usedOf(f)); return `<div class="pm"><span>${PL(FEAT[f].en[0], FEAT[f].zh[0])}</span><span class="pm-bar"><i style="width:${(u / lim) * 100}%" class="${u >= lim ? 'full' : ''}"></i></span><b>${u}/${lim}</b><small>${FEAT[f].per === 'day' ? PL('today', '今日') : PL('this week', '本週')}</small></div>`; }).join('');
  return `<section class="card stack g10 plancard" style="padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b style="font-size:15px">${PL('Your plan', '你的計劃')}: <span class="plan-pill ${id}">${PL(P.name, P.zh)}</span></b><button class="btn-sm ${id === 'pro' ? '' : 'primary'}" id="splans">${id === 'pro' ? PL('See plans', '查看計劃') : PL('Upgrade', '升級')}</button></div>
    ${meters ? `<div class="pms">${meters}</div>` : `<span class="muted" style="font-size:13.5px">${PL('Everything unlimited.', '全部無限使用。')}</span>`}
    ${local.planLock ? '' : `<div class="pv"><span class="muted">${PL('Testing: preview a plan on this device', '測試中：在這部裝置預覽計劃')}</span><div class="seg">${PLAN_ORDER.map((p) => `<button class="${p === id ? 'on' : ''}" data-pv="${p}">${PL(TIERS[p].name, TIERS[p].zh)}</button>`).join('')}</div></div>`}
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
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(r.from + i * DAY).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { weekday: 'short' }));
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
  (local.tests || []).slice(-8).forEach((x) => feed.push({ t: x.t, ic: 'pencil', tx: PD(`${x.kind === 'test' ? 'Chapter test' : 'Mock paper'}: ${x.m ? Math.round(100 * x.g / x.m) : 0}%`, `${x.kind === 'test' ? '章節測驗' : '模擬試卷'}：${x.m ? Math.round(100 * x.g / x.m) : 0}%`) + ` · ${x.title || ''}` }));
  Object.entries(local.learned || {}).forEach(([k, t]) => { const [bid, uid_] = k.split(':'); const b = books.find((x) => x.id === bid); const u = b && b.units.find((x) => x.id === uid_); if (u) feed.push({ t, ic: 'book', tx: PD(`Finished a lesson: ${cleanUnitTitle(u.title)}`, `完成一課：${cleanUnitTitle(u.title)}`) }); });
  (local.wr || []).forEach((w) => w.drafts.forEach((d, i) => feed.push({ t: d.t, ic: 'pencil', tx: PD(`Writing marked (draft ${i + 1}): ≈ level ${wrLevel(d.fb, w.kind)}`, `寫作批改（第 ${i + 1} 稿）：估計等級 ${wrLevel(d.fb, w.kind)}`) + ` · ${w.title}` })));
  (local.sp || []).forEach((x) => x.tries.forEach((t) => feed.push({ t: t.t, ic: 'send', tx: PD(`Speaking answer marked: ≈ level ${spLevel(t.fb)}`, `說話回應評分：估計等級 ${spLevel(t.fb)}`) + ` · ${x.task.title}` })));
  (local.hw || []).forEach((h) => feed.push({ t: h.t, ic: 'check', tx: PD(`Homework help: ${h.title || 'homework'}`, `功課輔導：${h.title || '功課'}`) }));
  schoolTests().filter((x) => typeof x.score === 'number').forEach((x) => feed.push({ t: testDay(x), ic: 'target', tx: PD(`School test result: ${x.name} ${x.score}%`, `學校測驗成績：${x.name} ${x.score}%`) }));
  feed.sort((a, b) => b.t - a.t);
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  // The dashboard is the weekly report, live, plus what only a live view can show: today, tests coming up, activity.
  const todayCard = `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('clock', 18)} ${PD('Today', '今日')}</h2><span>${last ? PD(`Last practised ${agoWords(last)}`, `上次練習：${agoWords(last)}`) : PD('No practice yet', '仍未練習')}</span></div>
    <div class="rp-today"><div class="${todayMin ? '' : 'warn'}"><b>${todayMin}</b><span>${PD('minutes', '分鐘')}</span></div><div><b>${today.length}</b><span>${PD('questions', '題目')}</span></div><div><b>${tm ? Math.round(100 * tg / tm) + '%' : '–'}</b><span>${PD('marks scored', '得分率')}</span></div></div>
    ${!today.length ? `<p style="font-size:14px;color:#B4531A">${PD('No practice yet today.', '今日仍未練習。')}</p>` : ''}</section>`;
  const testsCard = tests.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('target', 18)} ${PD('School tests coming up', '即將來臨的學校測驗')}</h2><span>${PD('and today’s plan for each', '及每個測驗的今日計劃')}</span></div>
    <div class="rp-up">${tests.map((p) => `<div><span class="rp-cal ${p.left <= 1 ? 'soon' : ''}"><b>${new Date(testDay(p.x)).getDate()}</b><small>${new Date(testDay(p.x)).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { month: 'short' })}</small></span><span class="rp-ut"><b>${esc(p.x.name)}</b><small>${leftText(p.left)} · ${esc(p.step.t)}</small></span><b class="${tone(p.ready)}">${p.ready}%</b></div>`).join('')}</div></section>` : '';
  const feedCard = `<section class="rp-card"><div class="rp-card-head"><h2>${pIcon('bars', 18)} ${PD('Recent activity', '最近活動')}</h2><span>${PD('newest first', '最新在前')}</span></div>
    ${feed.length ? `<ol class="rp-feed">${feed.slice(0, 12).map((f) => `<li><span class="rp-fi">${pIcon(f.ic, 14)}</span><span>${esc(f.tx)}<small>${agoWords(f.t)}</small></span></li>`).join('')}</ol>` : `<p style="font-size:14px;color:var(--muted)">${PD('Activity will show here as your child studies.', '孩子溫習時，活動會在這裏顯示。')}</p>`}</section>`;
  const fixCard = mk || due ? `<section class="rp-call weak"><h3>${PD('To do', '待處理')}</h3><p>${[mk ? PD(`${mk} mistake${mk > 1 ? 's' : ''} to fix`, `${mk} 題錯題待改正`) : '', due ? PD(`${due} review${due > 1 ? 's' : ''} due`, `${due} 題待溫習`) : ''].filter(Boolean).join(' · ')}</p></section>` : '';
  $app.innerHTML = `
  ${backTop({name:'progress'}, 'Progress')}
  <main class="pad stack g14 parentpage" data-view="parent" data-raw style="flex:1">
    <div class="pd-top"><span class="muted" style="font-size:13.5px">${PD('Updates as your child practises', '孩子練習時會即時更新')}</span>
      <div class="pd-acts"><button class="btn-sm" id="pdReport">${pIcon('send', 16)} ${PD('Send as weekly report', '傳送每週報告')}</button><button class="btn-sm quiet" id="pdLock">🔒 ${PD('Lock', '鎖上')}</button></div></div>
    <div class="pd-rep">${reportHTML(r, { live: true, top: todayCard + testsCard, sideTop: fixCard, bottom: feedCard })}</div>
    <p class="hint" style="margin:0;text-align:center">${PD('Same as the weekly report, kept up to date. With PrepBuddy accounts (coming soon) it will open on your own phone.', '與每週報告相同，但會即時更新。推出 PrepBuddy 帳戶後，可在你自己的手機查看。')}</p>
  </main>`;
  document.getElementById('pdReport').onclick = () => reportDialog();
  document.getElementById('pdLock').onclick = () => { parentUntil = 0; go({ name: 'progress' }); };
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
async function testStep(x) {
  const book = (await getBooks()).find((b) => b.id === x.b);
  if (!book) return null;
  const units = book.units.filter((u) => x.u.includes(u.id));
  if (!units.length) return null;
  const left = testLeft(x);
  const m = await bookMastery(book);
  const chs = m.chapters.filter((c) => x.u.includes(c.unit.id));
  const ready = Math.round(chs.reduce((t, c) => t + c.pct, 0) / chs.length);
  const learned = (u) => !!(local.learned || {})[`${book.id}:${u.id}`];
  const weakest = chs.slice().sort((a, b) => a.pct - b.pct)[0];
  const name = (u) => cleanUnitTitle(u.title);
  let step;
  if (left === 0) step = { icon: 'weak', t: SCH('Test today: a 5-question warm-up', '今天考試：5 題熱身'), s: SCH('Wake your brain up, then good luck!', '熱熱身，祝你考試順利！'), go: SCH('Warm up', '熱身'), run: () => startUnits(book, units, 5) };
  else if (left === 1) step = { icon: 'test', t: SCH('Practice test for tomorrow', '為明天做一次模擬測驗'), s: SCH('Timed, on all the test chapters', '限時，包括所有考試章節'), go: SCH('Start', '開始'), run: () => startChapterTest(book, units) };
  else {
    const fresh = chs.find((c) => !c.done && !learned(c.unit));
    if (fresh) step = { icon: 'learn', t: SCH(`Learn: ${name(fresh.unit)}`, `學習：${name(fresh.unit)}`), s: SCH('Not started yet: a guided lesson first', '未開始：先上一課'), go: SCH('Learn', '學習'), run: () => go({ name: 'learn', bookId: book.id, unitId: fresh.unit.id }) };
    else if (weakest.pct < 75) step = { icon: 'practise', t: SCH(`Practise: ${name(weakest.unit)}`, `練習：${name(weakest.unit)}`), s: SCH(`Your weakest test chapter, ${weakest.pct}% so far`, `最弱的考試章節，目前 ${weakest.pct}%`), go: SCH('Practise', '練習'), run: () => { pick = { bookId: book.id, ids: new Set([weakest.unit.id]) }; startUnits(book, [weakest.unit], 10); } };
    else step = { icon: 'review', t: SCH('Mixed practice on all test chapters', '所有考試章節混合練習'), s: SCH('You’re in good shape: keep it fresh', '準備得不錯，保持手感'), go: SCH('Practise', '練習'), run: () => startUnits(book, units, 10) };
  }
  return { x, book, units, left, ready, step };
}
function testDialog(edit) {
  if (!allow('sched')) return;
  const box = document.createElement('div'); box.className = 'cdlg-wrap';
  const st = { id: edit ? edit.id : uid(), name: edit ? edit.name : '', date: edit ? edit.date : ymd(Date.now() + 7 * DAY), b: edit ? edit.b : null, u: new Set(edit ? edit.u : []) };
  const draw = async () => {
    const books = await getBooks();
    if (!st.b && books.length) st.b = books[0].id;
    const book = books.find((b) => b.id === st.b);
    box.innerHTML = `<div class="cdlg rdlg tdlg" role="dialog" aria-modal="true" aria-labelledby="td-t" data-raw>
      <b id="td-t">${edit ? SCH('Edit school test', '修改學校測驗') : SCH('Add a school test', '加入學校測驗')}</b>
      <label for="td-n">${SCH('What test?', '甚麼測驗？')}</label><input id="td-n" class="input" placeholder="${SCH('e.g. Science test, 中文默書, Maths quiz', '例如：科學測驗、中文默書、數學小測')}" value="${esc(st.name)}">
      <label for="td-d">${SCH('Date', '日期')}</label><input id="td-d" class="input" type="date" min="${ymd(Date.now())}" value="${esc(st.date)}">
      <label for="td-b">${SCH('Textbook', '課本')}</label><select id="td-b" class="input">${books.map((b) => `<option value="${esc(b.id)}" ${b.id === st.b ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
      <label>${SCH('Chapters in the test', '測驗範圍')}</label>
      <div class="td-chs">${book ? book.units.map((u) => `<label class="td-ch"><input type="checkbox" data-u="${esc(u.id)}" ${st.u.has(u.id) ? 'checked' : ''}><span>${esc(cleanUnitTitle(u.title))}</span></label>`).join('') : ''}</div>
      <p class="hw-err" id="td-err" role="alert" hidden></p>
      <div class="rd-row"><button class="btn ghost" id="td-cancel">${SCH('Cancel', '取消')}</button><button class="btn" id="td-save">${SCH('Save', '儲存')}</button></div>
      ${edit ? `<button class="btn-sm quiet" id="td-del" style="align-self:center">${SCH('Delete this test', '刪除這個測驗')}</button>` : ''}
    </div>`;
    const n = box.querySelector('#td-n'), d = box.querySelector('#td-d');
    n.oninput = () => (st.name = n.value); d.oninput = () => (st.date = d.value);
    box.querySelector('#td-b').onchange = (e) => { st.b = e.target.value; st.u = new Set(); draw(); };
    box.querySelectorAll('[data-u]').forEach((c) => (c.onchange = () => (c.checked ? st.u.add(c.dataset.u) : st.u.delete(c.dataset.u))));
    box.querySelector('#td-cancel').onclick = () => box.remove();
    box.querySelector('#td-save').onclick = () => {
      const err = box.querySelector('#td-err');
      const bad = !st.name.trim() ? SCH('Give the test a name.', '請輸入測驗名稱。') : !st.date || testLeft(st) < 0 ? SCH('Pick a date from today on.', '請選擇今天或之後的日期。') : !st.u.size ? SCH('Tick at least one chapter.', '請剔選最少一個章節。') : '';
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      if (!edit && limitOf('sched') !== UNL && upcomingTests().length >= limitOf('sched')) { box.remove(); return upsell('sched', 'limit'); }
      const rec = { id: st.id, name: st.name.trim().slice(0, 60), date: st.date, b: st.b, u: [...st.u] };
      local.sched = [...(local.sched || []).filter((x) => x.id !== st.id), rec].slice(-30); saveLocal();
      box.remove(); if (view.name === 'home') renderHome();
      toast(SCH(`Added. Today’s plan now counts down to ${rec.name}.`, `已加入。今日計劃會為「${rec.name}」倒數。`));
    };
    const del = box.querySelector('#td-del'); if (del) del.onclick = () => { local.sched = (local.sched || []).filter((x) => x.id !== st.id); saveLocal(); box.remove(); if (view.name === 'home') renderHome(); };
  };
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  draw(); document.body.appendChild(box);
}
// Today: a "School tests" section, and how-did-it-go for tests just passed.
async function schoolTestsHTML() {
  const up = upcomingTests().slice(0, 4);
  const steps = (await Promise.all(up.map(testStep))).filter(Boolean);
  const past = schoolTests().filter((x) => testLeft(x) < 0 && testLeft(x) >= -4 && x.score === undefined);
  const rows = steps.map((p) => `<div class="stx ${p.left <= 1 ? 'soon' : ''}"><button class="stx-main" data-tedit="${esc(p.x.id)}" aria-label="${SCH('Edit', '修改')} ${esc(p.x.name)}">
      <span class="stx-cal"><b>${new Date(testDay(p.x)).getDate()}</b><small>${new Date(testDay(p.x)).toLocaleDateString(LANG === 'zh' ? 'zh-HK' : 'en-GB', { month: 'short' })}</small></span>
      <span class="stx-t"><b data-raw>${esc(p.x.name)}</b><small>${leftText(p.left)} · <span data-raw>${esc(p.units.length === 1 ? cleanUnitTitle(p.units[0].title) : SCH(`${p.units.length} chapters`, `${p.units.length} 個章節`))}</span></small></span>
      <span class="stx-r"><b>${p.ready}%</b><small>${SCH('ready', '準備度')}</small></span></button></div>`).join('');
  return { steps, html: `<section class="stack g10" aria-label="${SCH('School tests', '學校測驗')}">
      <div class="sect-head"><h2>${SCH('School tests', '學校測驗')}</h2><button class="btn-sm" id="addTest">+ ${SCH('Add a test', '加入測驗')}${locked('sched') ? ' 🔒' : ''}</button></div>
      ${past.map((x) => `<div class="card stx-past" data-raw><span>${SCH(`How did <b>${esc(x.name)}</b> go?`, `「<b>${esc(x.name)}</b>」考得怎樣？`)}</span><span class="stx-sc"><input class="input" type="number" min="0" max="100" inputmode="numeric" placeholder="%" data-score="${esc(x.id)}" aria-label="${SCH('Score in percent', '分數（百分比）')}"><button class="btn-sm primary" data-savescore="${esc(x.id)}">${SCH('Save', '儲存')}</button><button class="btn-sm quiet" data-skipscore="${esc(x.id)}">${SCH('Skip', '略過')}</button></span></div>`).join('')}
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
    local.placement = { ...(local.placement || {}), [book.id]: { t: Date.now(), u: per } }; saveLocal();
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
  <div class="topbar"><span style="font-weight:600;font-size:15px;padding-left:4px">${LV('Level check', '程度評估')}</span></div>
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
  on('plPrac', () => { pick = { bookId: bk.id, ids: new Set([first.id]) }; startUnits(bk, [first], local.count || SESSION_SIZE); });
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
  const spare = sess.spared ? 0 : Math.max(1, Math.ceil(SPARE / sess.units.length));
  if (need <= 0 && !spare) return;
  need = Math.max(0, need);
  sess.spared = true;
  // spread across the chosen chapters, starting with the ones that have given fewest questions so far
  const used = (u) => sess.qs.filter((q) => q.id.startsWith(`${sess.book.id}:${u.id}:`)).length;
  const order = [...sess.units].sort((a, b) => used(a) - used(b));
  const per = Math.ceil(need / order.length);
  let left = need;
  for (const u of order) {
    const want = Math.min(per, left); left -= want;
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
  return `<div class="mcard" data-raw>
    ${figHTML(q)}${renderStem(q.type === 'graph' || choiceType(q) ? q.stem : writtenStem(q), 'stem')}
    ${!choiceType(q) ? q.parts.map((p) => `<p class="mprompt">${esc(p.label)} ${esc(p.prompt)}</p>`).join('') : ''}
    <div class="mrow bad"><span>${LANG === 'zh' ? '你的答案' : 'Your answer'}</span><p class="nomath">${esc(yours)}</p></div>
    ${right ? `<div class="mrow good"><span>${LANG === 'zh' ? '答案' : 'Answer'}</span><p>${esc(right)}</p></div>` : ''}
    <p class="expl">${esc(q.explanation || '')}</p>
    ${m.chat && m.chat.length ? `<details class="mchat"><summary>${LANG === 'zh' ? '你和 AI 導師的對話' : 'Your chat with the tutor'} (${m.chat.length})</summary>${m.chat.map((x) => x.role === 'user' ? `<div class="tmsg me nomath">${esc(x.text)}</div>` : `<div class="tmsg ai">${tutorMd(x.text)}</div>`).join('')}</details>` : ''}
    <div class="mfoot"><span class="hint">${m.n > 1 ? `${LANG === 'zh' ? `錯了 ${m.n} 次` : `Missed ${m.n} times`}` : ''}</span>${m.done ? '' : `<button class="btn-sm quiet" data-dismiss="${esc(q.id)}" >${LANG === 'zh' ? '我已明白，移除' : 'I understand it now'}</button>`}</div>
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
    const ask = choiceType(q) ? q.stem : [writtenStem(q), ...(q.parts || []).map((p) => p.prompt)].filter(Boolean).join(' ');
    return `<details class="mq ${m.n > 1 ? 'often' : ''}"><summary>
        <span class="mq-dot" aria-hidden="true"></span>
        <span class="mq-text" data-raw>${esc(String(ask || '').replace(/\s*\n+\s*/g, ' '))}</span>
        <span class="mq-meta">${m.n > 1 ? `<b>${zh ? `錯了 ${m.n} 次` : `Missed ${m.n}×`}</b>` : ''}<span>${esc(agoText(m.done ? m.doneAt || m.t : m.t))}</span></span>
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
      <span class="mk-gt"><b data-raw>${esc(g.unit ? cleanUnitTitle(g.unit.title) : '')}</b><span class="muted">${often ? `${often} ${zh ? '題錯了多次' : 'missed more than once'} · ` : ''}${zh ? '最近' : 'latest'} ${esc(agoText(Math.max(...g.items.map((i) => (tab === 'done' ? i.m.doneAt || i.m.t : i.m.t)))))}</span></span>
      ${tab === 'todo' ? `<button class="btn-sm primary" data-redo="${gi}">${zh ? '重做' : 'Redo'}</button>` : ''}<span class="mq-chev" aria-hidden="true">›</span></summary>
      <div class="mk-list">${g.items.map(line).join('')}</div></details>`; };
  const mkBody = open
    ? `${subjects.length > 1 ? `<button class="mk-backsub" data-mkopen="">${ICON.back} ${zh ? '所有科目' : 'All subjects'}</button>` : ''}
      <section class="mk-sub-open"><div class="mk-ghead">${subjectTile(open.book.subject, 44, open.book.title)}<div class="mk-gt"><b data-raw>${esc(sname(open.book))}</b>${sname(open.book) !== open.book.title ? `<span class="muted" data-raw>${esc(open.book.title)}</span>` : ''}</div>
        ${tab === 'todo' ? `<button class="btn-sm" data-redobook="${esc(open.book.id)}">${zh ? `全部重做（${Math.min(open.n, 30)}）` : `Redo all ${Math.min(open.n, 30)}`}</button>` : ''}</div>
      <p class="mk-tip muted">${zh ? '按章節查看題目、你的答案和解釋。' : 'Tap a chapter to see the questions, your answer and the explanation.'}</p>
      <div class="mk-chs">${open.chs.map(chRow).join('')}</div></section>`
    : `<div class="mk-subs">${subjects.map((x) => `<button class="mk-sub" data-mkopen="${esc(x.book.id)}">
        <span class="mk-sub-top">${subjectTile(x.book.subject, 40, x.book.title)}<span class="mk-gt"><b data-raw>${esc(sname(x.book))}</b>${sname(x.book) !== x.book.title ? `<span class="muted" data-raw>${esc(x.book.title)}</span>` : ''}</span></span>
        <span class="mk-sub-n"><b class="${tab === 'done' ? 'ok' : ''}">${x.n}</b><span>${tab === 'done' ? (zh ? '已掌握' : 'mastered') : (zh ? '題待改正' : 'to get right')} · ${zh ? `${x.chs.length} 個章節` : `${x.chs.length} chapter${x.chs.length > 1 ? 's' : ''}`}</span></span>
        ${x.often && tab === 'todo' ? `<span class="mk-sub-often">${zh ? `${x.often} 題錯了多次` : `${x.often} missed more than once`}</span>` : ''}
        <span class="mk-sub-most muted" data-raw>${zh ? '最多：' : 'Most in: '}${esc(cleanUnitTitle((x.chs[0].g.unit || {}).title || ''))}</span>
        <span class="mk-sub-go">${zh ? '查看' : 'Open'} ›</span></button>`).join('')}</div>`;
  const SHOW = 4;
  $app.innerHTML = `
  <main class="pad stack g18 mkpage" data-view="mistakes" style="flex:1">
    <h1 class="pagetitle">Mistake book</h1>
    ${tab === 'todo' && todo ? `<section class="mk-hero">
      <div class="mk-hero-l">${buddySVG('happy', 64)}<div class="stack g6"><b class="mk-big">${todo} ${todo === 1 ? 'question' : 'questions'} to get right</b>
        <span class="muted">Get one right again and it moves to Mastered.${fixedWeek ? ` <b class="mk-win">${fixedWeek} fixed this week</b>` : ''}</span></div></div>
      <div class="mk-hero-r"><button class="btn" id="redoall">Redo all ${Math.min(all.length, 30)}</button>${all.length > 5 ? '<button class="btn ghost" id="quick5">Quick 5</button>' : ''}</div>
    </section>` : ''}
    <div class="seg" style="grid-template-columns:1fr 1fr" role="tablist"><button role="tab" class="${tab === 'todo' ? 'on' : ''}" data-tab="todo">To get right (${todo})</button><button role="tab" class="${tab === 'done' ? 'on' : ''}" data-tab="done">Mastered (${done})</button></div>
    ${groups.length ? mkBody : `<div class="card mk-empty">${buddySVG(tab === 'todo' ? 'done' : 'think', 72)}<div class="stack g6"><b>${tab === 'todo' ? 'Nothing to fix right now' : 'Nothing mastered yet'}</b><span class="muted">${tab === 'todo' ? 'Questions you get wrong are saved here automatically, so you can come back and get them right.' : 'Get a mistake right again and it moves here.'}</span></div></div>`}
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
  $app.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => { const m = local.mistakes[b.dataset.dismiss]; if (m) { m.done = true; m.doneAt = Date.now(); m.manual = true; saveLocal(); } const y = window.scrollY; renderMistakes(tab).then(() => window.scrollTo(0, y)); }));
}
function agoText(t) {
  const d = Math.floor((Date.now() - (t || 0)) / 864e5), zh = LANG === 'zh';
  if (d <= 0) return zh ? '今天' : 'Today';
  if (d === 1) return zh ? '昨天' : 'Yesterday';
  if (d < 7) return zh ? `${d} 天前` : `${d} days ago`;
  if (d < 30) { const w = Math.floor(d / 7); return zh ? `${w} 星期前` : `${w} week${w > 1 ? 's' : ''} ago`; }
  const mo = Math.floor(d / 30); return zh ? `${mo} 個月前` : `${mo} month${mo > 1 ? 's' : ''} ago`;
}

/* ---------- choose a textbook for weak topics / mock paper ---------- */
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
        <span style="min-width:0"><b style="font-weight:600" ${id ? 'data-raw' : ''}>${esc(title)}</b><br><span class="muted" style="font-size:13px">${sub}</span></span></span>
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
  const title = weakMode ? 'Weak topics' : 'Mock paper';
  const intro = weakMode
    ? `The questions you didn’t get fully right, mixed together so you can fix them.${anyReady ? ' Choose a textbook.' : ''}`
    : 'A DSE-style paper: Section A multiple choice, then Section B written questions, timed. Choose a textbook, then the chapters and length.';
  $app.innerHTML = `
  <div class="topbar"><button class="backbtn" id="back">${ICON.back}<span>${LANG === 'zh' ? '返回' : 'Back'}</span></button></div>
  <main class="pad stack g18 pickpage" style="flex:1">
    <div class="pick-head">${actionTile(weakMode ? 'weak' : 'mock', 52)}<div class="stack g6"><h1 class="pagetitle" style="margin:0">${title}</h1><p class="muted" style="margin:0;line-height:1.5;font-size:15px">${intro}</p></div></div>
    ${anyReady ? `<div class="card stack">${rows.join('')}</div>` : `<div class="card pick-empty">
      ${buddySVG('think', 84)}
      <div class="stack g6"><b style="font-size:17px">No weak topics yet</b><span class="muted" style="line-height:1.5">As you practise, the questions you find hard collect here so you can come back and fix them.</span></div>
      <button class="btn" id="practise" style="width:auto;padding:12px 22px">Practise a chapter</button></div>`}
  </main>`;
  document.getElementById('back').onclick = () => goBack({ name: 'home' });
  const pr = document.getElementById('practise'); if (pr) pr.onclick = () => go({ name: 'books' });
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => (weakMode
    ? startReview('weak', b.dataset.pick || null)
    : go({ name: 'paper', bookId: b.dataset.pick, from: 'pick' }))));
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
  const job = { want, made: 0, error: null, done: false, listeners: new Set(), plan: (kp && kp[types]) || PLANS[types] || PLAN, par, adapt, diff };
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
    });
  } else sess.cards = cheers;
  return sess.cards;
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

function renderQuestion() {
  S.waiting = false;
  navSession();
  const q = S.qs[S.i];
  if (S.mode === 'unit' && !S.placement && !S.review && !q.recap) { S.metered = S.metered || new Set(); if (!S.metered.has(q.id)) { S.metered.add(q.id); meter('q'); if (!choiceType(q)) meter('written'); } }
  const body = choiceType(q) ? mcqBody(q, S.phase === 'revealed') : writtenBody(q, S.phase === 'revealed');
  $app.innerHTML = header() + `
  <main class="stack g18 qpaper" style="flex:1;padding:14px 20px 20px">
    <div class="chips">${S.mode === 'dse' ? `<span class="chip sec">${S.i < S.sectionA ? 'Section A' : 'Section B'}</span>` : ''}<span class="chip">Level ${q.level} · ${LEVEL[q.level]}</span><span class="chip grey">${TYPE[q.type]} · ${marksOf(q)} mark${marksOf(q) > 1 ? 's' : ''}</span>${S.review ? '<span class="chip grey">Review</span>' : ''}${q.recap ? '<span class="chip recap" title="Done before. A quick recap while the next new question is checked">Quick recap</span>' : ''}</div>
    ${body.main}
    ${preTutorOK(q) && !preTutorInSide(q) ? preTutorHTML(q) : ''}
  </main>
  ${body.footer}${/class="sheet/.test(body.footer) ? '' : qSide(q)}`;
  liftActions();
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

// On a laptop the answer panel sits beside the question, so Next and "Report a problem" go under the question
// itself (where the eye already is) instead of at the bottom of the side panel.
function liftActions() {
  if (!matchMedia('(min-width:1024px)').matches) return;
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
    <div class="tutor" id="tutor">${tutorHTML(q)}</div>
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
      const req = { title: q.section, text: chapter, question: qForServer(q), figure: figB64(q), answer: before ? '' : studentAnswerText(q), before, ask: text, history, lang: voice ? (voice === 'yue' ? 'zh-HK' : 'en') : langOf(chapter), voice };
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
    const lang = (LANG === 'zh' || langOf(chapter) === 'zh-HK') ? 'yue' : 'en';
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
  const stem = figHTML(q) + (q.stem ? renderStem(writtenStem(q)) : '');
  if (!revealed) {
    // The maths keypad and "show your working" only for questions that involve working something out.
    const maths = kindSync(q.id) === 'maths' && q.type !== 'essay' && /\d|calculat|work out|find|solve|show that|evaluate|simplif|expand|factori|prove|estimate|計算|求/i.test(q.parts.map((p) => `${p.prompt} ${p.mark_scheme.join(' ')}`).join(' ')), essay = q.type === 'essay';
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
  bindTutor(q);
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
    const label = choiceType(q) ? q.stem : ((q.parts[0] && q.parts[0].prompt) || q.stem);
    const st = full ? 'right' : g ? 'part' : 'miss';
    return `<div class="rrow ${st}"><span class="rnum">Q${k + 1}</span><span class="rtext" data-raw>${esc(String(label).slice(0, 110))}${String(label).length > 110 ? '…' : ''}</span><span class="rmark">${g}/${m}</span></div>`;
  }).join('');
  const missed = qs.filter((q, k) => (S.got[k] || 0) < marksOf(q));
  const missedIdx = qs.map((q, k) => k).filter((k) => (S.got[k] || 0) < marksOf(qs[k]));
  const drillable = missedIdx.filter((k) => canDrill(qs[k])).slice(0, 10); // drill up to 10 missed ideas
  const unitRef = S.units ? { book: S.book, units: S.units } : null;
  // Timed tests and mock papers count towards mastery (per chapter, only when finished).
  // Every finished test is also kept for the Progress page and the parent report (kind, title, score, time used).
  if (((S.mode === 'dse' && !S.ws) || S.mode === 'mock') && !S.endedEarly && !S.recorded) {
    S.recorded = true;
    const per = {};
    if (S.mode === 'dse') qs.forEach((q, k) => { const key = qUnit(q.id).join(':'); const r = per[key] || (per[key] = [0, 0]); r[0] += S.got[k] || 0; r[1] += marksOf(q); });
    local.tests = [...(local.tests || []), { t: Date.now(), per, kind: S.mode === 'mock' ? 'mini' : S.test ? 'test' : 'paper', title: S.title, b: S.book ? S.book.id : '', g: got, m: total, nt: S.deadline ? 0 : 1, x: S.extra || 0, min: Math.max(1, Math.round(((S.examEnd || Date.now()) - S.at) / 60000)) }].slice(-300); saveLocal();
  }
  if (S.ws && !S.endedEarly) saveWorksheetScore(S.ws, `${got} / ${total}`);
  const won = awardSession(qs, pct);
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
    : 'This set was tough. Drilling the ones you missed is the fastest way up.';
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
        <div class="rhead"><b>${head}</b><span>${got} of ${total} marks</span></div>
        <span class="rbuddy">${buddySVG(pct >= 85 ? 'done' : pct >= 50 ? 'happy' : 'think', 76)}</span></div>
      <p class="rsub">${sub}</p>
      <div class="rcounts"><span class="right">${V} ${nRight} right</span>${nPart ? `<span class="part">${H} ${nPart} partly</span>` : ''}<span class="miss">${X} ${nMiss} missed</span></div>
      ${sections}
      ${starsOn() && S.starNote ? `<p class="starnote">${starSVG(16)} ${esc(S.starNote)}</p>` : ''}
    </section>
    <div class="ractions">
      ${drillable.length ? `<button class="btn" id="drillall">${ICON.target.replace('width="22" height="22"', 'width="18" height="18"').replace('var(--miss)', 'currentColor')} <span class="rprim">${LANG === 'zh' ? '針對弱項練習' : 'Drill my weak spots'}<small>${LANG === 'zh' ? `${drillable.length * PER_IDEA} 條針對答錯內容的新題目` : `${drillable.length * PER_IDEA} new questions on what you missed`}</small></span></button>` : ''}
      ${(() => {
        // Primary: drill if there are weak spots, otherwise more questions. The rest sit in one tidy list.
        const sv = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
        const I = { more: sv('<path d="M12 5v14M5 12h14"/>'), retry: sv('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'), redo: sv('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'), book: sv('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>'), home: sv('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>') };
        const row = (id, icon, tone, t, sub) => `<button class="ropt" id="${id}"><span class="ropt-i ${tone}">${icon}</span><span class="ropt-t"><b>${t}</b><small>${sub}</small></span><span class="ropt-go" aria-hidden="true">›</span></button>`;
        const n = S.count || SESSION_SIZE, many = unitRef && unitRef.units.length > 1, Z = (en, zh) => (LANG === 'zh' ? zh : en);
        const prim = !drillable.length && unitRef ? `<button class="btn" id="more">${I.more} ${n} more on ${many ? 'these chapters' : 'this chapter'}</button>` : '';
        const rows = [
          drillable.length && unitRef ? row('more', I.more, 'blue', Z(`${n} more questions`, `再做 ${n} 題`), many ? Z('New questions on these chapters', '這些章節的新題目') : Z('New questions on this chapter', '這一章的新題目')) : '',
          missed.length ? row('retry', I.retry, 'red', Z(`Retry the ${missed.length} I missed`, `重做答錯的 ${missed.length} 題`), Z('Same questions, until they stick', '同樣的題目，直到記熟為止')) : '',
          qs.length ? row('redo', I.redo, 'violet', Z('Redo this set', '重做這一組'), Z('The same questions, shuffled', '同樣的題目，次序打亂')) : '',
          row('home', S.book ? I.book : I.home, 'grey', S.book ? Z('Back to chapters', '返回章節') : Z('Back to home', '返回主頁'), S.book ? Z('Pick another chapter or activity', '選擇其他章節或活動') : Z('See today’s plan', '查看今日計劃')),
        ].filter(Boolean).join('');
        return `${prim}${rows ? `<div class="ropts card">${rows}</div>` : ''}`;
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
      const keep = list.filter((q) => local.stats[q.id] || (local.mistakes || {})[q.id]);
      if (keep.length !== list.length) await store.set(keys[i], keep);
    }
  }
  local.qrules = QRULES; saveLocal();
}
getBooks().then(pruneMistakes).catch(() => {});
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
