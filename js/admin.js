// PrepBuddy admin: add textbooks to the shared library, edit their details, or remove them.
// Publishing saves the files to the GitHub repo in one commit (via /api/admin); Vercel then updates the site.

import { fit, LEVEL_B } from './progress.js';
import { decodeReport } from './report.js';
const $ = (id) => document.getElementById(id);
const app = $('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PW_KEY = 'prepbuddy.admin';
let pw = sessionStorage.getItem(PW_KEY) || '';

async function adminApi(body) {
  const r = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error(d.error || `Server error ${r.status}`); e.status = r.status; throw e; }
  return d;
}
async function aiApi(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
  return d;
}
async function catalog() {
  const r = await fetch(`library/catalog.json?t=${Date.now()}`, { cache: 'no-store' });
  return r.ok ? r.json() : [];
}
const b64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const rand = (n, set = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');

/* ---------- sign in ---------- */
function renderLogin(msg) {
  app.innerHTML = `<header><h1 style="display:flex;align-items:center;gap:10px"><img src="/icons/logo.svg" width="32" height="32" alt="">PrepBuddy admin</h1></header>
  <form class="card" id="login">
    <h2>Sign in</h2>
    <label>Admin password<input type="password" id="pw" autocomplete="current-password" required></label>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn">Sign in</button>
    <p class="hint">The password is the ADMIN_PASSWORD you set in Vercel.</p>
  </form>`;
  $('pw').focus();
  $('login').onsubmit = async (e) => {
    e.preventDefault(); pw = $('pw').value;
    try {
      const r = await adminApi({ action: 'check' });
      sessionStorage.setItem(PW_KEY, pw);
      if (!r.github) return renderLogin('Signed in, but GITHUB_TOKEN is not set in Vercel yet, so books can’t be published.');
      home();
    } catch (err) { pw = ''; renderLogin(err.status === 401 ? 'That password is not right.' : err.message); }
  };
}

/* ---------- the library ---------- */
// Admin sections, each with its own address (admin.html#families etc.), so Back and bookmarks work.
const NAV = [['overview', 'Overview'], ['families', 'Families'], ['updates', 'Weekly updates'], ['numbers', 'Numbers'], ['feedback', 'Feedback'], ['library', 'Library'], ['reports', 'Reports']];
const route = () => { const h = (location.hash || '').slice(1); return h === 'pilot' ? 'overview' : NAV.some(([k]) => k === h) ? h : 'overview'; };
function home() { const r = route(); if (r === 'library') return renderLibrary(); if (r === 'reports') return renderReports(); return renderPilot(null, r); }
const setHash = (h) => { if (location.hash !== h) { try { history.pushState(null, '', h); } catch (e) {} } };
window.addEventListener('popstate', () => { if (pw) home(); });
let navBadge = {};
// The top bar every section shares: brand, the sections, sign out.
function shell(active, body) {
  app.innerHTML = `<div class="adm-top"><a class="adm-brand" href="#overview" data-nav="overview"><img src="/icons/logo.svg" width="28" height="28" alt="">PrepBuddy <span>admin</span></a>
    <nav class="adm-nav" aria-label="Admin sections">${NAV.map(([k, l]) => `<a href="#${k}" data-nav="${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${l}${navBadge[k] ? `<i>${navBadge[k]}</i>` : ''}</a>`).join('')}</nav>
    <button class="link adm-out" id="out">Sign out</button></div>
  <div class="adm-body">${body}</div>`;
  app.querySelectorAll('[data-nav]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const k = a.dataset.nav; setHash('#' + k); if (k === 'library') renderLibrary(); else if (k === 'reports') renderReports(); else renderPilot(null, k); }));
  $('out').onclick = () => { sessionStorage.removeItem(PW_KEY); pw = ''; PILOT = null; renderLogin(); };
  const cur = app.querySelector('.adm-nav .on'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  window.scrollTo(0, 0);
}
async function renderLibrary(note) {
  setHash('#library');
  const cat = await catalog();
  shell('library', `<header><h1>Library</h1></header>
  ${note ? `<div class="ok">${esc(note)}</div>` : ''}
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Books in the library (${cat.length})</h2><button class="btn" id="add">Add a textbook</button></div>
    <div>${cat.map((b) => `<div class="row" data-id="${esc(b.id)}"><div class="meta"><b>${esc(b.title)}</b><span>${esc(b.subject || '')}${b.level ? ' · ' + esc(b.level) : ''} · ${b.units.length} chapters · code ${esc(b.code)}</span></div>
      <div class="acts">${b.questionCount ? `<span class="hint" style="align-self:center">${b.questionCount} questions</span>` : ''}<button class="link" data-starter="${esc(b.id)}">${b.questionCount ? 'Add more questions' : 'Add starter questions'}</button><button class="link" data-edit="${esc(b.id)}">Edit details</button><button class="link red" data-remove="${esc(b.id)}">Remove</button></div></div>`).join('') || '<p class="muted">No books yet.</p>'}</div>
  </div>
  <p class="hint">Changes go live in about 1–2 minutes, while Vercel updates the site. Students who already added a book keep their copy.</p>`);
  $('add').onclick = () => renderUpload();
  app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => renderDetails(cat.find((x) => x.id === b.dataset.edit), cat)));
  app.querySelectorAll('[data-starter]').forEach((b) => (b.onclick = async () => {
    const book = cat.find((x) => x.id === b.dataset.starter);
    try { const n = await starterFor(book); renderLibrary(`Added ${n} starter questions to “${book.title}”. Students get them in about 1–2 minutes.`); }
    catch (e) { renderLibrary(); alert(`Starter questions didn’t finish: ${e.message}`); }
  }));
  app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    const book = cat.find((x) => x.id === b.dataset.remove);
    if (!confirm(`Remove “${book.title}” from the library? Students who already added it keep their copy; nobody new can add it.`)) return;
    b.disabled = true; b.textContent = 'Removing…';
    try { await adminApi({ action: 'remove', id: book.id }); renderLibrary(`Removed “${book.title}”. The library updates in about 1–2 minutes.`); }
    catch (err) { alert(err.message); b.disabled = false; b.textContent = 'Remove'; }
  }));
}


/* ---------- pilot families ----------
   Codes for the families testing PrepBuddy, and what each family's devices report: how often they practise,
   what they use, what goes wrong, and what they tell us. Data lives in the private pilot repo (PILOT_REPO). */
const FEATURE_NAMES = {
  practice: 'Practice sets', level_check: 'Level check', chapter_test: 'Chapter tests', mock_paper: 'Mock papers', worksheet: 'Printed worksheets', parent_report: 'Parent report',
  'ai:learn:lesson': 'Learn mode lessons', 'ai:learn': 'Learn mode: Buddy chat', 'ai:explain': 'Buddy on questions', 'ai:coach': 'Study coach / Ask Buddy', 'ai:mark': 'Written answers marked',
  'ai:homework:read': 'Homework help: photos read', 'ai:homework:chat': 'Homework help: chat', 'ai:homework:list': '默書: list from photo', 'ai:writing:mark': 'Writing marked', 'ai:writing:prompt': 'Writing: task written',
  'ai:writing:read': 'Writing: handwriting read', 'ai:speaking:mark': 'Speaking answers marked', 'ai:speaking:task': 'Speaking: topics', 'ai:notes': 'Revision notes', 'ai:report': 'Parent report link',
};
const fname = (k) => FEATURE_NAMES[k] || (k.startsWith('upsell:') ? `Hit plan limit: ${(typeof UPSELL_NAMES !== 'undefined' && UPSELL_NAMES[k.slice(7)]) || k.slice(7)}` : k.startsWith('screen:') ? `Screen: ${k.slice(7)}` : k);
const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 2) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`; };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// one family = every device that used its code
function mergeFamily(snaps) {
  const days = {}, fx = {}, books = new Map(); let last = 0, first = null, errs = [], counts = {}, names = new Set(), plans = new Set(), devices = [];
  const hours = Array(24).fill(0), wdays = Array(7).fill(0), modes = {}, usage = { usd: 0, calls: 0, by: {} }, why = {}, langs = new Set();
  let sess = [], streak = 0, best = 0, stars = null, pin = false, goal = null, consent = null, toured = null, learner = null, learnerAt = 0; const grades = new Set();
  for (const s of snaps) {
    devices.push({ device: s.device, ua: s.ua, synced: s.synced, last: s.last, inst: s.inst, keep: s.keep, ios: s.ios });
    if (s.name) names.add(s.name); if (s.plan) plans.add(s.plan); if (s.lang) langs.add(s.lang);
    last = Math.max(last, s.last || 0); if (s.first) first = first ? Math.min(first, s.first) : s.first;
    for (const d of s.days || []) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.d))) continue; const x = days[d.d] || (days[d.d] = { q: 0, g: 0, m: 0, min: 0 }); x.q += +d.q || 0; x.g += +d.g || 0; x.m += +d.m || 0; x.min += +d.min || 0; }
    for (const [k, v] of Object.entries(s.fx || {})) { const x = fx[k] || (fx[k] = { n: 0, last: 0 }); x.n += v.n; x.last = Math.max(x.last, v.last || 0); }
    for (const b of s.books || []) { const o = books.get(b.title); books.set(b.title, o ? { ...b, q: (o.q || 0) + (b.q || 0), pct: Math.max(o.pct || 0, b.pct || 0) } : b); }
    errs = errs.concat((s.errs || []).map((e) => ({ ...e, device: s.device })));
    for (const [k, v] of Object.entries(s.counts || {})) if (typeof v === 'number') counts[k] = (counts[k] || 0) + v;
    (s.hours || []).forEach((n, i) => (hours[i] += n || 0)); (s.wdays || []).forEach((n, i) => (wdays[i] += n || 0));
    for (const [k, v] of Object.entries(s.modes || {})) { const x = modes[k] || (modes[k] = { q: 0, g: 0, m: 0 }); x.q += v.q; x.g += v.g; x.m += v.m; }
    if (s.usage) { usage.usd += s.usage.usd || 0; usage.calls += s.usage.calls || 0; for (const [k, v] of Object.entries(s.usage.by || {})) { const x = usage.by[k] || (usage.by[k] = { n: 0, usd: 0 }); x.n += v.n || 0; x.usd += v.usd || 0; } }
    sess = sess.concat(s.sess || []);
    streak = Math.max(streak, s.streak || 0); best = Math.max(best, s.best || 0);
    if (s.stars) { stars = stars || { on: false, bal: 0, total: 0, redeemed: 0, rewards: 0, rushedQ: 0, capDays: 0, badges: 0 }; for (const k of ['bal', 'total', 'redeemed', 'rushedQ', 'capDays', 'badges']) stars[k] += s.stars[k] || 0; stars.rewards = Math.max(stars.rewards, s.stars.rewards || 0); stars.on = stars.on || !!s.stars.on; for (const [k, v] of Object.entries(s.stars.why || {})) why[k] = (why[k] || 0) + v; }
    if (s.parent && s.parent.pin) pin = true;
    if (s.consent && (!consent || s.consent.at < consent.at)) consent = s.consent; if (s.toured) toured = Math.max(toured || 0, s.toured);
    if (s.goal) goal = s.goal;
    if (s.learner && typeof s.learner === 'object' && (s.synced || s.at || 0) >= learnerAt) { learner = s.learner; learnerAt = s.synced || s.at || 0; }
    if (s.learner && s.learner.grade) grades.add(String(s.learner.grade)); // siblings: each child syncs as its own device
  }
  sess.sort((a, b) => a.t - b.t);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  if (last < t0.getTime() - 864e5) streak = 0; // the streak broke since their last sync
  const sum = (n, from = 0) => { let q = 0, g = 0, m = 0, min = 0, act = 0; for (let i = from; i < from + n; i++) { const x = days[dayKey(t0.getTime() - i * 864e5)]; if (x) { q += x.q; g += x.g; m += x.m; min += x.min; act++; } } return { q, acc: m ? Math.round(100 * g / m) : null, min, act }; };
  const all = Object.values(days), actDays = all.length;
  const tot = all.reduce((o, x) => ({ q: o.q + x.q, g: o.g + x.g, m: o.m + x.m, min: o.min + x.min }), { q: 0, g: 0, m: 0, min: 0 });
  // came back in week 2: any activity 7–13 days after the first day (null while it's too early to tell)
  const f0 = first ? new Date(first).setHours(0, 0, 0, 0) : null;
  const wk2 = f0 === null ? null : (Date.now() - f0 < 7 * 864e5 ? null : Object.keys(days).some((k) => { const t = new Date(k + 'T00:00:00').getTime(); return t >= f0 + 7 * 864e5 && t < f0 + 14 * 864e5; }));
  if (stars) stars.why = why;
  return { days, fx, books: [...books.values()], last, first, errs: errs.sort((a, b) => b.t - a.t).slice(0, 12), counts, names: [...names], plans: [...plans], devices, w: sum(7), w2: sum(14), pw: sum(7, 7),
    hours, wdays, modes, usage, sess, streak, best, stars, pin, goal, consent, toured, learner, grades: [...grades].sort(), langs: [...langs], actDays, tot: { ...tot, acc: tot.m ? Math.round(100 * tot.g / tot.m) : null }, wk2,
    parentUse: (fx.parent_dashboard ? fx.parent_dashboard.n : 0) + (fx.parent_report ? fx.parent_report.n : 0) + (fx['ai:report'] ? fx['ai:report'].n : 0) };
}
const MODE_NAMES = { practice: 'Practice', '': 'Practice', spaced: 'Daily reviews', drill: 'Weak-spot drills', mistakes: 'Mistake book redo', dse: 'Chapter tests & DSE papers', mock: 'Mini mock tests', placement: 'Level check', units: 'Practice', unit: 'Practice', book: 'Practice' };
const money = (x) => (x >= 10 ? '$' + x.toFixed(0) : '$' + (x || 0).toFixed(2));
const pctOf = (a, b) => (b ? Math.round(100 * a / b) : 0);
// small horizontal bar list: [[label, value, note]]
const barList = (rows, fmt = (v) => v) => { const mx = Math.max(1, ...rows.map((r) => r[1])); return rows.length ? `<div class="pl-feats">${rows.map(([l, v, n]) => `<div><span>${esc(l)}</span><i style="width:${Math.max(2, Math.round(100 * v / mx))}%"></i><b>${fmt(v)}${n ? ` <small>${esc(n)}</small>` : ''}</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">Nothing yet.</p>'; };
// vertical mini bars: values with labels underneath
const colBars = (vals, labels, title = (i, v) => `${labels[i]}: ${v}`) => { const mx = Math.max(1, ...vals); return `<div class="pl-cols">${vals.map((v, i) => `<span title="${esc(title(i, v))}"><i style="height:${v ? Math.max(3, Math.round(70 * v / mx)) : 1}px" class="${v ? '' : 'none'}"></i><small>${esc(labels[i])}</small></span>`).join('')}</div>`; };

function pilotOverview(rows, fams) {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const T = t0.getTime(), D = 864e5;
  const started = rows.filter((r) => r.a.devices.length), withQ = rows.filter((r) => r.a.tot.q > 0);
  // funnel
  const elig = rows.filter((r) => r.a.wk2 !== null);
  const funnel = [
    ['Invited (family code made)', fams.length],
    ['Opened the app', started.length],
    ['Added a textbook', rows.filter((r) => r.a.books.length).length],
    ['Answered a question', withQ.length],
    ['Answered 50+ questions', rows.filter((r) => r.a.tot.q >= 50).length],
    ['Practised on 3+ different days', rows.filter((r) => r.a.actDays >= 3).length],
    ['Practised on 7+ different days', rows.filter((r) => r.a.actDays >= 7).length],
    ['Parent looked at the dashboard or report', rows.filter((r) => r.a.parentUse > 0).length],
  ];
  const wk2n = elig.filter((r) => r.a.wk2).length;
  // weekly trend, last 8 weeks (7-day blocks ending today)
  const weeks = Array.from({ length: 8 }, (_, w) => {
    let q = 0, g = 0, m = 0, min = 0; const act = new Set();
    rows.forEach((r, i) => { for (let d = 0; d < 7; d++) { const x = r.a.days[dayKey(T - (w * 7 + d) * D)]; if (x) { q += x.q; g += x.g; m += x.m; min += x.min; act.add(i); } } });
    const from = new Date(T - (w * 7 + 6) * D);
    return { label: w === 0 ? 'This week' : from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), q, min, act: act.size, acc: m ? Math.round(100 * g / m) : null };
  }).reverse();
  const firstWeek = weeks.findIndex((w) => w.q > 0); const wks = firstWeek < 0 ? weeks.slice(-1) : weeks.slice(firstWeek);
  // heatmap: families x last 28 days
  const hdays = Array.from({ length: 28 }, (_, i) => T - (27 - i) * D);
  const heat = rows.filter((r) => r.a.devices.length).map((r) => `<div class="hm-row"><span title="${esc(r.f.name)}">${esc(r.f.name)}</span>${hdays.map((t) => { const x = r.a.days[dayKey(t)]; const lv = !x ? 0 : x.min >= 30 ? 4 : x.min >= 15 ? 3 : x.min >= 5 ? 2 : 1; return `<i class="l${lv}" title="${dayKey(t)}: ${x ? `${x.min} min, ${x.q} questions` : 'nothing'}"></i>`; }).join('')}</div>`).join('');
  // study times
  const hours = Array(24).fill(0), wd = Array(7).fill(0);
  rows.forEach((r) => { r.a.hours.forEach((n, i) => (hours[i] += n)); r.a.wdays.forEach((n, i) => (wd[i] += n)); });
  // engagement per active day
  const actDays = rows.reduce((x, r) => x + r.a.actDays, 0), totMin = rows.reduce((x, r) => x + r.a.tot.min, 0), totQ = rows.reduce((x, r) => x + r.a.tot.q, 0);
  const totG = rows.reduce((x, r) => x + r.a.tot.g, 0), totM = rows.reduce((x, r) => x + r.a.tot.m, 0);
  // sessions
  const sess = rows.flatMap((r) => r.a.sess);
  const done = sess.filter((x) => !x.e);
  const avg = (xs, f) => (xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0);
  // modes
  const modes = {}; rows.forEach((r) => Object.entries(r.a.modes).forEach(([k, v]) => { const n = MODE_NAMES[k] || k; const x = modes[n] || (modes[n] = { q: 0, g: 0, m: 0, fam: 0 }); x.q += v.q; x.g += v.g; x.m += v.m; x.fam++; }));
  // subjects
  const subj = {}; rows.forEach((r) => r.a.books.forEach((b) => { const k = b.subject || 'Other'; const x = subj[k] || (subj[k] = { fam: new Set(), books: 0, q: 0, mast: [], acc: [] }); x.fam.add(r.f.code); x.books++; x.q += b.q || 0; if (b.pct !== null && b.pct !== undefined) x.mast.push(b.pct); if (b.acc !== null && b.acc !== undefined) x.acc.push(b.acc); }));
  const levels = {}; rows.forEach((r) => r.a.books.forEach((b) => { const k = b.level || 'Not set'; levels[k] = (levels[k] || 0) + 1; }));
  // stars
  const st = rows.map((r) => r.a.stars).filter(Boolean);
  const why = {}; st.forEach((x) => Object.entries(x.why || {}).forEach(([k, v]) => (why[k] = (why[k] || 0) + v)));
  const WHY = { set: 'Finished sets', score: 'Scored 80%+', fix: 'Fixed mistakes', reviews: 'Daily reviews', test: 'Chapter tests', goal: 'Weekly goals', badge: 'Badges', writing: 'Writing', speaking: 'Speaking', dictation: 'Dictation', 'dictation-perfect': 'Perfect dictation', lesson: 'Lessons', listening: 'Listening', 'level check': 'Level checks' };
  const rushedSets = sess.filter((x) => x.r).length;
  // AI cost
  const usd = rows.reduce((x, r) => x + r.a.usage.usd, 0), calls = rows.reduce((x, r) => x + r.a.usage.calls, 0);
  const byPath = {}; rows.forEach((r) => Object.entries(r.a.usage.by).forEach(([k, v]) => { const x = byPath[k] || (byPath[k] = { n: 0, usd: 0 }); x.n += v.n; x.usd += v.usd; }));
  const costWeek = rows.filter((r) => r.a.first && r.a.usage.usd).map((r) => r.a.usage.usd / Math.max(1, (Date.now() - r.a.first) / (7 * D)));
  // upgrade signals
  const ups = {}; rows.forEach((r) => Object.entries(r.a.fx).forEach(([k, v]) => { if (!k.startsWith('upsell:')) return; const x = ups[k.slice(7)] || (ups[k.slice(7)] = { fam: 0, n: 0 }); x.fam++; x.n += v.n; }));
  const plansSet = {}; rows.forEach((r) => { const p = r.f.plan || 'pro (default)'; plansSet[p] = (plansSet[p] || 0) + 1; });
  const dev = {}; rows.forEach((r) => r.a.devices.forEach((d) => (dev[d.ua || 'unknown'] = (dev[d.ua || 'unknown'] || 0) + 1)));
  const atRisk = rows.flatMap((r) => r.a.devices.filter((d) => d.ios && !d.inst).map(() => r.f.name));
  const lang = {}; rows.forEach((r) => r.a.langs.forEach((l) => (lang[l === 'zh' ? 'Chinese' : 'English'] = (lang[l === 'zh' ? 'Chinese' : 'English'] || 0) + 1)));
  const wkNow = weeks[weeks.length - 1], wkPrev = weeks[weeks.length - 2];
  const delta = (a, b) => (b ? `<small class="${a >= b ? 'up' : 'down'}">${a >= b ? '▲' : '▼'} ${Math.abs(pctOf(a - b, b))}% vs last week</small>` : '');
  const card = (h, body, sub) => `<div class="card"><h2>${h}</h2>${sub ? `<p class="hint" style="margin:-4px 0 4px">${sub}</p>` : ''}${body}</div>`;
  const kv = (list) => `<div class="pl-kv">${list.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  return `
  <div class="pl-tiles">
    <div><b>${fams.length}</b><span>families invited</span></div>
    <div><b>${started.length}</b><span>opened the app</span></div>
    <div><b>${wkNow.act}</b><span>active this week</span>${delta(wkNow.act, wkPrev.act)}</div>
    <div><b>${elig.length ? pctOf(wk2n, elig.length) + '%' : '–'}</b><span>came back in week 2${elig.length ? ` (${wk2n}/${elig.length})` : ''}</span></div>
    <div><b>${wkNow.q}</b><span>questions this week</span>${delta(wkNow.q, wkPrev.q)}</div>
    <div><b>${wkNow.min}</b><span>minutes this week</span>${delta(wkNow.min, wkPrev.min)}</div>
    <div><b>${actDays ? Math.round(totMin / actDays) : '–'}</b><span>minutes per active day</span></div>
    ${(() => { const PK = progKids(rows), R = PK.filter((k) => k.p.s.some((x) => x.status !== 'building')), U = R.filter((k) => k.p.s.some((x) => x.status === 'rising')); return `<div><b>${R.length ? `${U.length}/${R.length}` : '–'}</b><span>getting stronger</span><small>${R.length ? 'children, in 1+ subject' : `accuracy ${totM ? pctOf(totG, totM) + '%' : '–'}`}</small></div>`; })()}
    <div><b>${money(usd)}</b><span>AI cost so far</span></div>
    <div><b>${costWeek.length ? money(avg(costWeek, (x) => x)) : '–'}</b><span>AI cost per family per week</span></div>
    <div><b>${rows.reduce((x, r) => x + r.a.errs.length, 0)}</b><span>errors seen</span></div>
    <div><b>${rows.filter((r) => r.a.last && Date.now() - r.a.last > 4 * D).length}</b><span>gone quiet (4+ days)</span></div>
  </div>
  <h2 class="pl-sec">Is it working?</h2>
  ${progCard(rows, card, kv)}
  <div class="pl-grid">${marksCard(rows, card, kv)}${card('Weekly updates to parents', (() => { const due = rows.filter((r) => r.f.phone && !(r.f.sent > Date.now() - 6 * D)), sent = rows.filter((r) => r.f.sent > Date.now() - 6 * D), noPh = rows.filter((r) => r.f.name !== '(not on the list)' && !r.f.phone);
    return kv1([['Sent in the last 6 days', `${sent.length} of ${rows.length}`], ['Due now', due.length ? `${due.length} <small>${due.map((r) => esc(r.f.name.replace(/\s*\(.*\)$/, ''))).join(', ')}</small>` : 'None'], ['No WhatsApp number yet', noPh.length ? `${noPh.length} <small>${noPh.map((r) => esc(r.f.name.replace(/\s*\(.*\)$/, ''))).join(', ')}</small>` : 'None']]) + '<p style="margin:10px 0 0"><a class="btn small" href="#updates" data-nav="updates">Open Weekly updates</a></p>'; })(), 'Parents hear how their child is doing every week, without opening the child’s device.')}</div>
  <h2 class="pl-sec">How it’s being used</h2>
  <div class="pl-grid">
    ${card('Getting started funnel', barList(funnel.map(([l, v]) => [l, v, `${pctOf(v, fams.length)}%`])), 'How far each family has got. The biggest drop is where to help.')}
    ${card('Week by week', `<div class="pl-tablewrap"><table class="pl-table pl-mini"><thead><tr><th>Week starting</th><th>Active families</th><th>Questions</th><th>Minutes</th><th>Accuracy</th></tr></thead><tbody>${wks.map((w) => `<tr><td>${w.label}</td><td>${w.act}</td><td>${w.q}</td><td>${w.min}</td><td>${w.acc === null ? '–' : w.acc + '%'}</td></tr>`).join('')}</tbody></table></div>`, 'Is usage holding up, and is accuracy going up?')}
  </div>
  ${card('Who practised when (last 4 weeks)', heat ? `<div class="hm">${heat}<div class="hm-row hm-key"><span></span>${hdays.map((t, i) => `<small>${i % 7 === 6 ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</small>`).join('')}</div></div><p class="hint" style="margin:6px 0 0">Darker = more minutes (1–4, 5–14, 15–29, 30+). Hover a square for details.</p>` : '<p class="muted" style="margin:0">No activity yet.</p>')}
  <div class="pl-grid">
    ${card('Time of day', colBars(hours, hours.map((_, i) => (i % 3 === 0 ? String(i) : '')), (i, v) => `${i}:00–${i + 1}:00: ${v} questions`), 'Questions answered by hour (the device’s clock).')}
    ${card('Day of the week', colBars([1, 2, 3, 4, 5, 6, 0].map((i) => wd[i]), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']), 'Questions answered by weekday.')}
  </div>
  <div class="pl-grid">
    ${card('Practice sessions', kv([
      ['Sets finished', done.length], ['Sets left early', `${sess.length - done.length} (${pctOf(sess.length - done.length, sess.length)}%)`],
      ['Average set', `${avg(done, (x) => x.n).toFixed(1)} questions · ${avg(done, (x) => x.min).toFixed(1)} min`], ['Average score', done.length ? Math.round(avg(done, (x) => x.p)) + '%' : '–'],
      ['Rushed sets (no stars)', `${rushedSets} (${pctOf(rushedSets, sess.length)}%)`], ['Chapter tests passed', `${done.filter((x) => x.ts && x.p >= 80).length} of ${done.filter((x) => x.ts).length}`],
      ['Questions per active day', actDays ? Math.round(totQ / actDays) : '–'], ['Longest streak', `${Math.max(0, ...rows.map((r) => r.a.best))} days`]]))}
    ${card('How they practise', barList(Object.entries(modes).sort((a, b) => b[1].q - a[1].q).map(([k, v]) => [k, v.q, `${v.m ? pctOf(v.g, v.m) + '% right' : ''} · ${v.fam} fam`])), 'Questions answered in each mode.')}
  </div>
  <div class="pl-grid">
    ${card('What’s being used', barList(Object.entries(rows.reduce((o, r) => { Object.entries(r.a.fx).forEach(([k, v]) => { if (k.startsWith('screen:') || k.startsWith('upsell:')) return; const x = o[k] || (o[k] = { fam: 0, n: 0 }); x.fam++; x.n += v.n; }); return o; }, {})).sort((a, b) => b[1].fam - a[1].fam || b[1].n - a[1].n).map(([k, v]) => [fname(k), v.fam, `famil${v.fam === 1 ? 'y' : 'ies'} · ${v.n}×`])) + (() => { const used = new Set(rows.flatMap((r) => Object.keys(r.a.fx))); const un = Object.keys(FEATURE_NAMES).filter((k) => !used.has(k)); return un.length && withQ.length ? `<p class="hint" style="margin:8px 0 0"><b>Not used by anyone yet:</b> ${un.map(fname).join(' · ')}</p>` : ''; })())}
    ${card('Other work done', kv([
      ['Lessons finished', rows.reduce((x, r) => x + (r.a.counts.learned || 0), 0)], ['Mistakes fixed', rows.reduce((x, r) => x + (r.a.counts.fixed || 0), 0)], ['Mistakes still open', rows.reduce((x, r) => x + (r.a.counts.mistakes || 0), 0)],
      ['Essays marked', rows.reduce((x, r) => x + (r.a.counts.writing || 0), 0)], ['Speaking answers', rows.reduce((x, r) => x + (r.a.counts.speaking || 0), 0)], ['Dictations', rows.reduce((x, r) => x + (r.a.counts.dictation || 0), 0)],
      ['Homework sessions', rows.reduce((x, r) => x + (r.a.counts.homework || 0), 0)], ['School tests planned', rows.reduce((x, r) => x + (r.a.counts.schoolTests || 0), 0)], ['Level checks', rows.reduce((x, r) => x + (r.a.counts.placement || 0), 0)],
      ['Weekly goal set', `${rows.filter((r) => r.a.goal).length} families`]]))}
  </div>
  <div class="pl-grid">
    ${card('Subjects', Object.keys(subj).length ? `<div class="pl-tablewrap"><table class="pl-table pl-mini"><thead><tr><th>Subject</th><th>Families</th><th>Books</th><th>Questions</th><th>Accuracy</th><th>Mastery</th></tr></thead><tbody>${Object.entries(subj).sort((a, b) => b[1].q - a[1].q).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.fam.size}</td><td>${v.books}</td><td>${v.q}</td><td>${v.acc.length ? Math.round(avg(v.acc, (x) => x)) + '%' : '–'}</td><td>${v.mast.length ? Math.round(avg(v.mast, (x) => x)) + '%' : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No books yet.</p>')}
    ${card('Year levels (books)', barList(Object.entries(levels).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, `book${v === 1 ? '' : 's'}`])))}
  </div>
  <h2 class="pl-sec">Costs and plans</h2>
  <div class="pl-grid">
    ${card('AI cost', kv([['Total so far', money(usd)], ['AI requests', calls], ['Per family so far', started.length ? money(usd / started.length) : '–'], ['Per family per week', costWeek.length ? money(avg(costWeek, (x) => x)) : '–'], ['Most expensive family', rows.length ? (() => { const r = rows.slice().sort((a, b) => b.a.usage.usd - a.a.usage.usd)[0]; return r.a.usage.usd ? `${esc(r.f.name)} · ${money(r.a.usage.usd)}` : '–'; })() : '–']]) + `<h3 class="pl-h3">By feature</h3>` + barList(Object.entries(byPath).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => [k, v.usd, `${v.n} requests`]), money), 'From each device’s own record of AI use (US$). Use this to check plan prices cover the cost.')}
    ${spendCard(rows, card, kv)}
  </div>
  <div class="pl-grid">
    ${card('Upgrade signals', `${kv(Object.entries(plansSet).map(([k, v]) => [`Families on ${esc(k)}`, v]))}<h3 class="pl-h3">Plan limits hit</h3>${barList(Object.entries(ups).sort((a, b) => b[1].fam - a[1].fam).map(([k, v]) => [k, v.fam, `famil${v.fam === 1 ? 'y' : 'ies'} · ${v.n}×`]))}`, 'Put some families on Free or Plus (in the table below) to see which locked features they reach for.')}
    ${card('Stars and rewards', kv([
      ['Families with stars on', st.filter((x) => x.on).length], ['Stars earned', st.reduce((x, y) => x + y.total, 0)], ['Rewards redeemed', st.reduce((x, y) => x + y.redeemed, 0)],
      ['Families with rewards set up', st.filter((x) => x.rewards).length], ['Parent PIN set', `${rows.filter((r) => r.a.pin).length} families`], ['Days someone hit the 10-star cap', st.reduce((x, y) => x + y.capDays, 0)],
      ['Questions in rushed sets', st.reduce((x, y) => x + y.rushedQ, 0)], ['Badges won', st.reduce((x, y) => x + y.badges, 0)]]) + `<h3 class="pl-h3">Where stars come from</h3>` + barList(Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => [WHY[k] || k, v])), 'Rushed sets and cap hits show children chasing stars rather than learning.')}
  </div>
  <div class="pl-grid">
    ${card('Devices and language', (atRisk.length ? `<div class="err" style="margin:0 0 8px">${atRisk.length} iPhone/iPad device${atRisk.length > 1 ? 's' : ''} not on the Home Screen, so Safari may wipe their progress after a week away: ${esc([...new Set(atRisk)].join(', '))}</div>` : '') + kv([...Object.entries(dev).map(([k, v]) => [`On a ${esc(k)}`, `${v} device${v === 1 ? '' : 's'}`]), ...Object.entries(lang).map(([k, v]) => [`Using ${k}`, `${v} famil${v === 1 ? 'y' : 'ies'}`])]))}
  </div>`;
}


/* ---------- what the numbers mean ----------
   Plain-language reading of the pilot: each family gets a status, and the pilot gets a handful of findings
   (good / okay / watch) with what to do next, plus a ready-to-paste paragraph of evidence for funding applications.
   Thresholds are rules of thumb for a small pilot, stated on the page so they can be challenged. */
const UPSELL_NAMES = {q: 'More practice questions', written: 'More written questions', lesson: 'More lessons', buddy: 'More Buddy messages', books: 'More textbooks', test: 'Chapter tests', sched: 'School test planner', homework: 'Homework help', coach: 'Study coach', stars: 'Stars and rewards', report: 'Full parent report', writing: 'Writing marking', speaking: 'Speaking marking', mock: 'Mock papers', voice: 'Voice Buddy', parent: 'Parent dashboard', forecast: 'Exam forecast', hard: 'Hard questions', master: 'Master questions'};
const USD_HKD = 7.8, PLUS_HKD = 188, PRO_HKD = 298; // cheapest paid plan (Primary Plus) and dearest (Secondary Pro): see pricing.md
function famStatus(a, f) {
  const D = 864e5, now = Date.now();
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  if (!a.devices.length || !a.tot.q) return { k: 'none', label: 'Not started', tone: 'grey', why: a.devices.length ? 'Opened the app but hasn’t answered a question.' : 'Hasn’t opened the app yet.', act: 'Send a friendly reminder, or offer a 5-minute call to set it up together.' };
  const since = (now - (a.last || 0)) / D;
  const firstAgo = a.first ? (now - a.first) / D : 99;
  if (a.w.act >= 4 || a.w.min >= 90) return { k: 'power', label: 'Power user', tone: 'green', why: `Practised on ${a.w.act} days this week (${a.w.min} min).`, act: 'Ask for a short testimonial or a quote you can use, and what they’d pay for.' };
  if (a.w.act >= 2) return { k: 'regular', label: 'Regular', tone: 'green', why: `Practised on ${a.w.act} days this week (${a.w.min} min).`, act: 'Keep going. Ask the parent what would make it a daily habit.' };
  if (firstAgo < 7) return { k: 'new', label: 'Just started', tone: 'blue', why: `First used ${Math.max(1, Math.round(firstAgo))} day${Math.round(firstAgo) === 1 ? '' : 's'} ago.`, act: 'Check in after their first week: what did they like, what was confusing?' };
  if (since > 7 && a.actDays <= 2) return { k: 'tried', label: 'Tried it, stopped', tone: 'red', why: `Used it on ${a.actDays} day${a.actDays === 1 ? '' : 's'}, nothing for ${Math.round(since)} days.`, act: 'Ask what got in the way. This is the most useful feedback you can get.' };
  if (since > 7) return { k: 'drift', label: 'Drifting away', tone: 'red', why: `Was active on ${a.actDays} days, but nothing for ${Math.round(since)} days.`, act: 'Nudge the parent: a school test coming up is a good reason to come back.' };
  return { k: 'light', label: 'Occasional', tone: 'amber', why: `Only ${a.w.act} day${a.w.act === 1 ? '' : 's'} this week (${a.w.min} min).`, act: 'Suggest a fixed time each day (e.g. 15 min after dinner) and setting a weekly goal.' };
}
// accuracy early vs late: first half of a family's active days against the second half (4+ active days)
function accTrend(a) {
  const ds = Object.keys(a.days).sort().map((k) => a.days[k]).filter((x) => x.m);
  if (ds.length < 4) return null;
  const h = Math.floor(ds.length / 2), sum = (xs) => xs.reduce((o, x) => [o[0] + x.g, o[1] + x.m], [0, 0]);
  const [g1, m1] = sum(ds.slice(0, h)), [g2, m2] = sum(ds.slice(-h));
  return { from: Math.round(100 * g1 / m1), to: Math.round(100 * g2 / m2), g1, m1, g2, m2 };
}
function pilotInsights(rows, fams) {
  const D = 864e5;
  const st = rows.map((r) => ({ r, s: famStatus(r.a, r.f) }));
  const by = (k) => st.filter((x) => x.s.k === k);
  const started = rows.filter((r) => r.a.tot.q > 0), invited = fams.length;
  const activeNow = st.filter((x) => ['power', 'regular'].includes(x.s.k));
  const elig = rows.filter((r) => r.a.wk2 !== null), back = elig.filter((r) => r.a.wk2);
  // minutes per week for families who've practised in the last 14 days
  const recent = rows.filter((r) => r.a.w2.act > 0);
  const minWk = recent.length ? Math.round(recent.reduce((x, r) => x + r.a.w2.min, 0) / recent.length / 2) : 0;
  const daysWk = recent.length ? recent.reduce((x, r) => x + r.a.w2.act, 0) / recent.length / 2 : 0;
  // learning
  const tr = rows.map((r) => accTrend(r.a)).filter(Boolean);
  const agg = tr.reduce((o, t) => [o[0] + t.g1, o[1] + t.m1, o[2] + t.g2, o[3] + t.m2], [0, 0, 0, 0]);
  const accFrom = agg[1] ? Math.round(100 * agg[0] / agg[1]) : null, accTo = agg[3] ? Math.round(100 * agg[2] / agg[3]) : null;
  const improved = tr.filter((t) => t.to - t.from >= 5).length;
  const fixed = rows.reduce((x, r) => x + (r.a.counts.fixed || 0), 0), open = rows.reduce((x, r) => x + (r.a.counts.mistakes || 0), 0);
  const mastery = rows.flatMap((r) => r.a.books.filter((b) => b.pct !== null && b.pct !== undefined && (b.q || 0) > 0).map((b) => b.pct));
  // parents
  const parents = started.filter((r) => r.a.parentUse > 0 || r.a.pin).length;
  // features: share of started families using each
  const fx = {}; started.forEach((r) => Object.entries(r.a.fx).forEach(([k, v]) => { if (k.startsWith('screen:') || k.startsWith('upsell:') || !v.n) return; (fx[k] = fx[k] || { fam: 0, n: 0 }); fx[k].fam++; fx[k].n += v.n; }));
  const topF = Object.entries(fx).sort((a, b) => b[1].fam - a[1].fam || b[1].n - a[1].n);
  const loved = topF.filter(([, v]) => v.n / Math.max(1, v.fam) >= 3).slice(0, 3).map(([k]) => esc(fname(k)));
  const unused = Object.keys(FEATURE_NAMES).filter((k) => !fx[k]).map(fname);
  // when
  const hours = Array(24).fill(0); rows.forEach((r) => r.a.hours.forEach((n, i) => (hours[i] += n)));
  const totH = hours.reduce((a, b) => a + b, 0);
  const peak = totH ? hours.indexOf(Math.max(...hours)) : null;
  const evening = totH ? Math.round(100 * hours.slice(18, 23).reduce((a, b) => a + b, 0) / totH) : 0;
  const late = totH ? Math.round(100 * (hours.slice(23).reduce((a, b) => a + b, 0) + hours.slice(0, 5).reduce((a, b) => a + b, 0)) / totH) : 0;
  // money: AI cost per active family per month, in HKD
  const costs = rows.filter((r) => r.a.usage.usd > 0 && r.a.first).map((r) => (r.a.usage.usd * USD_HKD) / Math.max(1, (Date.now() - r.a.first) / (30 * D)));
  const costMo = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null, costMax = costs.length ? Math.max(...costs) : null;
  // upgrades
  const ups = {}; rows.forEach((r) => Object.entries(r.a.fx).forEach(([k, v]) => { if (k.startsWith('upsell:') && v.n) ups[k.slice(7)] = (ups[k.slice(7)] || 0) + 1; }));
  const onLow = rows.filter((r) => r.f.plan === 'free' || r.f.plan === 'plus').length;
  // stars
  const sess = rows.flatMap((r) => r.a.sess), rushed = sess.filter((x) => x.r).length;
  const errs = rows.reduce((x, r) => x + r.a.errs.length, 0);
  const pilotStart = Math.min(...rows.map((r) => r.a.first || Infinity), ...fams.map((f) => f.created || Infinity));
  const days = isFinite(pilotStart) ? Math.max(1, Math.round((Date.now() - pilotStart) / D)) : 0;
  const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
  const tone = (v, good, ok) => (v === null ? 'grey' : v >= good ? 'green' : v >= ok ? 'amber' : 'red');
  const F = [];
  const noConsent = rows.filter((r) => r.a.devices.length && !r.a.consent);
  if (!started.length) {
    F.push(['grey', 'Waiting for the first family', 'Nothing to read yet. Findings appear here once families start practising.', 'Make sure every family has their code and has added PrepBuddy to their Home Screen.']);
  } else {
    const act = pct(started.length, invited);
    F.push([tone(act, 80, 50), `${started.length} of ${invited} families have started (${act}%)`, act >= 80 ? 'Getting families going isn’t the problem.' : 'A big share of invited families haven’t answered a single question. That usually means setup friction (finding the code, adding a book), not lack of interest.', act >= 80 ? 'Focus on keeping them.' : `Message the ${invited - started.length} who haven’t started and offer to set it up with them.`]);
    const reg = pct(activeNow.length, started.length);
    F.push([tone(reg, 60, 35), `${activeNow.length} of ${started.length} are using it regularly this week`, `“Regularly” means 2+ days in the last 7. ${reg >= 60 ? 'That’s a strong sign it’s becoming a habit.' : reg >= 35 ? 'Some families have a habit, others dip in and out.' : 'Most families aren’t coming back often yet.'}`, reg >= 60 ? 'Ask regular families why it works for them, and use their words in your pitch.' : 'Look at the “Drifting” and “Occasional” families below and ask what got in the way.']);
    if (elig.length) { const w2 = pct(back.length, elig.length); F.push([tone(w2, 60, 40), `${w2}% came back in their second week (${back.length} of ${elig.length})`, `Week-2 return is the earliest sign of whether a learning app sticks. ${w2 >= 60 ? 'Above 60% is very good for a new app.' : w2 >= 40 ? 'Between 40 and 60% is typical; there’s room to improve.' : 'Under 40% means most families try it once and leave.'}`, w2 >= 60 ? 'Keep measuring as more families pass day 7.' : 'Add a reason to return: reminders, the weekly goal, a school test countdown.']); }
    if (recent.length) F.push([tone(minWk, 60, 30), `Active families practise about ${minWk} min a week (${daysWk.toFixed(1)} days)`, `For comparison, one tuition lesson is 60–90 minutes a week. ${minWk >= 60 ? 'PrepBuddy is getting as much time as a weekly tutor.' : minWk >= 30 ? 'Real use, but less than a weekly lesson.' : 'Usage is light so far.'}`, minWk >= 60 ? 'Use this in your pitch: same time as a weekly tutor, at a fraction of the price.' : 'Suggest 15 minutes a day; a weekly goal and stars help.']);
    // Learning outcome: the "getting stronger" levels (allow for harder questions) when there's enough data; raw accuracy otherwise.
    const PK = progKids(rows), pReady = PK.filter((k) => k.p.s.some((x) => x.status !== 'building')), pUp = pReady.filter((k) => k.p.s.some((x) => x.status === 'rising'));
    const pFlat = pUp.filter((k) => { const t = pctTrend(k.sn); return t && t[1] <= t[0] + 0.03; }).length, pDown = pReady.filter((k) => k.p.s.some((x) => x.status === 'dipping') && !k.p.s.some((x) => x.status === 'rising'));
    if (pReady.length) F.push([pUp.length >= pReady.length / 2 ? 'green' : pUp.length ? 'amber' : 'grey', `${pUp.length} of ${pReady.length} children are getting stronger in at least one subject`,
      `Level allows for questions getting harder, from first tries only.${pUp.length ? ` ${pFlat} of the ${pUp.length} got stronger even though their % of marks stayed flat or fell: the harder-questions effect.` : ''}${pDown.length ? ` ${pDown.length} ha${pDown.length === 1 ? 's' : 've'} a subject slipping and none getting stronger: ${pDown.map((k) => esc(k.fam.replace(/\s*\(.*\)$/, ''))).join(', ')}.` : ''} Details: Numbers → Getting stronger.`,
      pUp.length ? 'This is your learning-outcome evidence. Check it lines up with school marks before quoting it publicly.' : 'Look at what the steady and slipping children are practising (next steps are in their weekly update).']);
    else if (tr.length) F.push([accTo - accFrom >= 5 ? 'green' : accTo - accFrom >= -3 ? 'amber' : 'red', `Accuracy went from ${accFrom}% to ${accTo}% (${tr.length} famil${tr.length === 1 ? 'y' : 'ies'} with 4+ active days)`, `Compares each student’s first active days with their latest. ${improved} of ${tr.length} improved by 5 points or more. Questions get harder as students improve, so a steady score can still mean progress; mastery is the better long-term measure${mastery.length ? ` (average mastery so far: ${Math.round(mastery.reduce((a, b) => a + b, 0) / mastery.length)}%)` : ''}.`, accTo - accFrom >= -3 ? 'This is your learning-outcome evidence. Collect more weeks before quoting it publicly.' : 'Scores dropped: check whether questions got harder too quickly for these students. Don’t quote this yet.']);
    else F.push(['grey', 'Too early to measure learning gains', 'Needs students with at least 4 active days to compare their early and recent accuracy.', 'Check again after the first week or two.']);
    if (fixed + open) F.push([tone(pct(fixed, fixed + open), 40, 20), `${fixed} mistakes fixed, ${open} still open (${pct(fixed, fixed + open)}% fixed)`, 'Students coming back to get wrong answers right is the core learning loop.', pct(fixed, fixed + open) >= 40 ? 'Good. Mention the mistake book in your pitch.' : 'Students aren’t revisiting mistakes much. Make the Mistake book more visible in Today’s plan.']);
    F.push([tone(pct(parents, started.length), 50, 25), `Parents involved in ${parents} of ${started.length} families`, 'Counts families where a parent set the PIN or opened the dashboard or weekly report. Parents are your buyers; their engagement predicts who will pay.', pct(parents, started.length) >= 50 ? 'Ask these parents what they’d pay and which plan they’d choose.' : 'Show parents the dashboard on day one; it’s your strongest selling point.']);
    if (topF.length) F.push(['blue', `Most used: ${topF.slice(0, 3).map(([k]) => esc(fname(k))).join(', ')}`, `${loved.length ? `Used again and again: ${loved.join(', ')}. ` : ''}${unused.length ? `Nobody has tried: ${unused.slice(0, 5).join(', ')}${unused.length > 5 ? ` and ${unused.length - 5} more` : ''}.` : 'Every feature has been tried.'}`, 'Features nobody touches either need to be easier to find or can wait.']);
    if (peak !== null) F.push(['blue', `Peak study time is ${peak}:00–${peak + 1}:00`, `${evening}% of questions are answered between 6 and 11pm${late >= 10 ? `, and ${late}% late at night (11pm–5am)` : ''}. This is after school and homework time, when a tutor isn’t available.`, late >= 10 ? 'Late-night use may worry parents; consider a bedtime reminder.' : 'Send reminders around 7pm.']);
    { const M = marksStats(rows), due = rows.filter((r) => r.f.phone && !(r.f.sent > Date.now() - 6 * D)), noPhone = rows.filter((r) => r.f.name !== '(not on the list)' && !r.f.phone);
      if (started.length) F.push([M.withBase >= started.length * 0.7 ? 'green' : 'amber', `School marks before PrepBuddy: ${M.withBase} of ${M.kids || started.length} children`, `${M.pairs ? `${M.pairs} also have later results: average change ${M.avg > 0 ? '+' : ''}${M.avg.toFixed(1)} points (${M.up} improved, ${M.down} lower).` : 'No later results yet: first-term exams (Dec–Jan) give the first.'}`, M.withBase >= started.length * 0.7 ? 'After each exam, remind parents to add the new marks (Parent dashboard → School results).' : 'Ask the remaining parents to tap “Add marks” on Today this week, while last term’s results are easy to find.']);
      F.push([due.length ? 'amber' : 'green', due.length ? `${due.length} weekly update${due.length > 1 ? 's' : ''} to send` : 'Weekly updates are up to date', `${due.length ? `Not sent in 6+ days: ${due.map((r) => esc(r.f.name.replace(/\s*\(.*\)$/, ''))).join(', ')}. ` : ''}${noPhone.length ? `${noPhone.length} famil${noPhone.length > 1 ? 'ies have' : 'y has'} no WhatsApp number yet.` : ''}`, 'Weekly updates → Open in WhatsApp, every Sunday evening.']); }
    if (costMo !== null) { const m = Math.round(100 * (1 - costMo / PLUS_HKD)); F.push([costMo <= PLUS_HKD * 0.3 ? 'green' : costMo <= PLUS_HKD * 0.6 ? 'amber' : 'red', `AI costs about HK$${costMo.toFixed(costMo < 10 ? 1 : 0)} per family a month`, `Against the cheapest plan (Primary Plus, HK$${PLUS_HKD}), that leaves about ${m}% gross margin (Secondary Pro at HK$${PRO_HKD}: ${Math.round(100 * (1 - costMo / PRO_HKD))}%). The heaviest family costs HK$${costMax.toFixed(0)}/month. Early use includes one-off costs (writing questions for a new book), so this should fall.`, costMo <= PLUS_HKD * 0.3 ? 'Healthy unit economics: quote this in the business-model section.' : 'Watch the heaviest families and consider tighter fair-use limits.']); }
    if (onLow) F.push([Object.keys(ups).length ? 'blue' : 'grey', Object.keys(ups).length ? `Families on Free/Plus reached for: ${Object.entries(ups).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(UPSELL_NAMES[k] || k)} (${v} famil${v === 1 ? 'y' : 'ies'})`).join(', ')}` : 'No upgrade signals yet', 'Taps on locked features show what people would pay for.', 'Make the most-tapped feature the headline of the paid plan.']);
    else F.push(['grey', 'No upgrade data yet', 'Every family is on Pro, so nobody ever hits a locked feature.', 'Put 2–3 families on Free and 2–3 on Plus from the table.']);
    if (sess.length >= 10) F.push([tone(100 - pct(rushed, sess.length), 90, 80), `${pct(rushed, sess.length)}% of sets were rushed`, 'Rushed = answering multiple choice in under 4 seconds a question, usually to farm stars.', pct(rushed, sess.length) > 10 ? 'Talk to those families about stars; consider turning stars off for them.' : 'Students are taking the questions seriously.']);
    if (noConsent.length) F.push(['amber', `${noConsent.length} famil${noConsent.length === 1 ? 'y hasn’t' : 'ies haven’t'} agreed to the privacy note yet`, `Families who opened an older version get the consent screen next time they open the app. Until a parent agrees, nothing new is sent. ${noConsent.map((r) => esc(r.f.name)).join(', ')}.`, 'If they’re active, ask a parent to open the app and tap “Agree and continue”.']);
    if (errs) F.push(['red', `${errs} app error${errs === 1 ? '' : 's'} recorded`, 'Errors can stop a family using a feature. Check “Problems” in the family cards.', 'Send the error text to Claude to fix.']);
  }
  // CCMF-ready paragraph
  const ccmf = started.length ? `In a ${days}-day closed pilot, ${invited} Hong Kong families were invited to use PrepBuddy; ${started.length} started (${pct(started.length, invited)}%) and together answered ${rows.reduce((x, r) => x + r.a.tot.q, 0).toLocaleString('en-GB')} questions over ${Math.round(rows.reduce((x, r) => x + r.a.tot.min, 0) / 60)} hours of study. ${elig.length ? `${pct(back.length, elig.length)}% of families came back in their second week. ` : ''}${recent.length ? `Active students practised about ${minWk} minutes a week, mostly between 6 and 11pm when no tutor is available. ` : ''}${(() => { const PK = progKids(rows), R = PK.filter((k) => k.p.s.some((x) => x.status !== 'building')), U = R.filter((k) => k.p.s.some((x) => x.status === 'rising'));
    return R.length ? `${U.length} of ${R.length} students with three or more weeks of practice measurably got stronger in at least one subject, on a level measure that allows for questions getting harder as they improve. ` : tr.length && accTo > accFrom ? `Among students with four or more active days, accuracy rose from ${accFrom}% to ${accTo}%, even as questions adapted to their level. ` : ''; })()}${(() => { const M = marksStats(rows); return M.pairs >= 3 ? `Parents reported school marks before and after: across ${M.pairs} students, an average change of ${M.avg > 0 ? '+' : ''}${M.avg.toFixed(1)} points. ` : ''; })()}${fixed ? `Students went back and fixed ${fixed.toLocaleString('en-GB')} mistakes. ` : ''}${parents ? `Parents in ${parents} of ${started.length} families followed progress through the parent dashboard or weekly report. ` : ''}${costMo !== null ? `The AI cost is about HK$${costMo.toFixed(0)} per family per month, against a planned price of HK$${PLUS_HKD}–${PRO_HKD}.` : ''}` : '';
  const seg = [['power', 'Power users'], ['regular', 'Regular'], ['new', 'Just started'], ['light', 'Occasional'], ['drift', 'Drifting away'], ['tried', 'Tried it, stopped'], ['none', 'Not started']];
  const icon = { green: '●', amber: '●', red: '●', blue: '●', grey: '○' };
  return `<div class="card pl-ins"><h2>What it means</h2>
    <div class="ins-segs">${seg.map(([k, l]) => { const xs = by(k); return `<div class="ins-seg ${xs.length ? '' : 'zero'}"><b>${xs.length}</b><span>${l}</span><small>${xs.map((x) => esc(x.r.f.name.replace(/\s*\(.*\)$/, ''))).join(', ') || '–'}</small></div>`; }).join('')}</div>
    <div class="ins-list">${F.map(([t, h, why, act]) => `<div class="ins ${t}"><i>${icon[t]}</i><div><b>${h}</b><p>${why}</p><p class="ins-act">→ ${act}</p></div></div>`).join('')}</div>
    ${ccmf ? `<details class="ins-ccmf"><summary>Evidence paragraph for your CCMF application</summary><p id="ccmftext">${esc(ccmf)}</p><button class="btn ghost small" id="ccmfcopy">Copy</button><p class="hint" style="margin:6px 0 0">Updates as the pilot runs. Numbers from a small pilot are early signals, so present them as such.</p></details>` : ''}
    <details class="ins-rules"><summary>How families are grouped</summary><p class="hint">Power user: 4+ days or 90+ minutes in the last 7 days. Regular: 2–3 days in the last 7. Just started: first used under 7 days ago. Occasional: 1 day in the last 7. Drifting away: nothing for 7+ days after 3+ active days. Tried it, stopped: 1–2 active days, then nothing for 7+ days. Green / amber / red use rules of thumb for a small pilot (e.g. week-2 return above 60% is good).</p></details>
  </div>`;
}

function pilotCSV(rows) {
  const cols = ['Family', 'Code', 'Plan', 'Child', 'Grade', 'Started', 'Last active', 'Active days', 'Came back week 2', 'Questions', 'Accuracy %', 'Minutes', 'Questions 7d', 'Minutes 7d', 'Streak', 'Best streak', 'Sets', 'Rushed sets', 'Books', 'Subjects', 'Lessons', 'Essays', 'Speaking', 'Dictations', 'Mistakes open', 'Mistakes fixed', 'Stars earned', 'Rewards redeemed', 'Consent', 'Tour', 'Parent PIN', 'Parent views', 'AI requests', 'AI cost USD', 'Errors', 'Devices', 'Notes'];
  const d = (t) => (t ? dayKey(t) : ''); // local date, not UTC
  const lines = rows.map(({ f, a }) => [f.name, f.code, f.plan || 'pro', a.names.join(' / '), (a.grades || []).join(' / '), d(a.first), d(a.last), a.actDays, a.wk2 === null ? '' : a.wk2 ? 'yes' : 'no', a.tot.q, a.tot.acc ?? '', a.tot.min, a.w.q, a.w.min, a.streak, a.best,
    a.sess.filter((x) => !x.e).length, a.sess.filter((x) => x.r).length, a.books.length, [...new Set(a.books.map((b) => b.subject))].join(' / '), a.counts.learned || 0, a.counts.writing || 0, a.counts.speaking || 0, a.counts.dictation || 0,
    a.counts.mistakes || 0, a.counts.fixed || 0, a.stars ? a.stars.total : '', a.stars ? a.stars.redeemed : '', a.consent ? d(a.consent.at) : 'no', a.toured ? 'yes' : 'no', a.pin ? 'yes' : 'no', a.parentUse, a.usage.calls, a.usage.usd.toFixed(3), a.errs.length, a.devices.map((x) => x.ua).join(' / '), f.note || '']);
  const q = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && typeof v !== 'number') x = "'" + x; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }; // a leading = + - @ would run as a formula in Excel
  return [cols, ...lines].map((r) => r.map(q).join(',')).join('\n');
}
let PILOT = null; // the pilot data, loaded once and reused across sections until Refresh
async function renderPilot(note, tab = route()) {
  if (!['overview', 'families', 'updates', 'numbers', 'feedback'].includes(tab)) tab = 'overview';
  setHash('#' + tab);
  const TITLE = { overview: 'Pilot overview', families: 'Families', updates: 'Weekly updates to parents', numbers: 'All the numbers', feedback: 'Feedback' }[tab];
  if (!PILOT || note === 'reload') {
    shell(tab, `<header><h1>${TITLE}</h1></header><div class="card" id="pl-load"><p class="muted" style="margin:0">Loading the pilot…</p></div>`);
    try { PILOT = await adminApi({ action: 'pilot' }); PILOT.at = Date.now(); } catch (e) { $('pl-load').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    // each child's permanent report link (made once per device), used on the family details and in weekly updates
    if (PILOT.on) { try { const devices = []; Object.entries(PILOT.activity || {}).forEach(([code, snaps]) => (snaps || []).forEach((sn) => { if (sn && sn.device && (sn.rep || sn.prog)) devices.push({ code, device: sn.device }); })); LINKS = (await adminApi({ action: 'pilot_links', devices })).links || {}; } catch (e) { LINKS = null; } }
    if (note === 'reload') note = null;
  }
  const P = PILOT;
  if (!P.on) {
    shell(tab, `<header><h1>Pilot</h1></header><div class="card"></div>`);
    app.querySelector('.adm-body .card').innerHTML = `<h2>Set up the pilot</h2><ol class="hint" style="font-size:14px;margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
      <li>On GitHub, create a new <b>private</b> repository, e.g. <code>prepbuddy-pilot</code>, with a README so it isn’t empty. Children’s activity is kept there, never in the public code repo.</li>
      <li>Edit the GitHub token used by Vercel (<code>GITHUB_TOKEN</code>) so it can also read and write that repo’s contents.</li>
      <li>In Vercel → Settings → Environment Variables, add <code>PILOT_REPO</code> = <code>your-account/prepbuddy-pilot</code>, then redeploy.</li>
      <li>Come back here and add your first family.</li></ol>`;
    return;
  }
  const fams = (P.families || []).slice();
  const known = new Set(fams.map((f) => f.code));
  Object.keys(P.activity || {}).forEach((c) => { if (!known.has(c)) fams.push({ code: c, name: '(not on the list)', created: 0 }); });
  const rows = fams.map((f) => ({ f, a: mergeFamily(P.activity[f.code] || []) })).sort((x, y) => (y.a.last || 0) - (x.a.last || 0));
  const fb = P.feedback || [];
  const famName = (code) => (fams.find((f) => f.code === code) || {}).name || code;
  navBadge = { feedback: fb.length || 0, families: fams.length || 0, updates: fams.filter((f) => f.phone && !(f.sent > Date.now() - 6 * 864e5)).length || 0 };
  const acts = `<div class="pl-acts"><button class="btn ghost small" id="reload">↻ Refresh</button><button class="btn ghost small" id="csv">Download all stats (CSV)</button><span class="hint">Updated ${new Date(P.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>`;
  const head = `<header><h1>${TITLE}</h1></header>${note ? `<div class="ok">${note}</div>` : ''}${acts}`;
  let body = '';
  if (tab === 'overview') {
    const ov = pilotOverview(rows, fams).split('\u0001');
    body = `${ov[0]}${pilotInsights(rows, fams)}`;
  } else if (tab === 'families') {
    body = `<div class="pl-famtop"><button class="btn" id="addopen">＋ Add a family</button></div>
  <div class="card pl-add" id="addcard" ${fams.length ? 'hidden' : ''}><h2>Add a family</h2>
    <form id="addf" class="grid2"><label>Family name<input id="fname" required placeholder="e.g. Chan family (Ka Yan, S5)"></label><label>Parent’s WhatsApp (optional)<input id="fphone" inputmode="tel" placeholder="e.g. 9123 4567"></label><label>Notes (only you see these)<input id="fnote" placeholder="e.g. DSE Biology, joined via school"></label>
    <button class="btn" style="grid-column:1/-1" id="addgo">Make a family code</button></form><div id="newcode"></div></div>
  <div class="card"><h2>Families</h2>
    ${rows.length ? `<div class="pl-tablewrap"><table class="pl-table"><thead><tr><th>Family</th><th>Last active</th><th>Days active<br><small>last 14</small></th><th>Questions<br><small>7 days</small></th><th>Minutes<br><small>7 days</small></th><th>Score<br><small>7 days</small></th><th>Stronger<br><small>subjects</small></th><th>Streak</th><th>AI cost</th><th>Books</th><th>Problems</th><th>Plan</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="pl-row ${r.a.last ? (Date.now() - r.a.last > 4 * 864e5 ? 'cold' : '') : 'never'}" data-fam="${i}"><td class="c-name"><b>${esc(r.f.name)}</b> ${(() => { const x = famStatus(r.a, r.f); return `<span class="stag ${x.tone}" title="${esc(x.why)}">${x.label}</span>`; })()}<small>${esc(r.f.code)}${r.a.names.length ? ' · ' + esc(r.a.names.join(', ')) : ''}${r.a.devices.length ? ` · ${r.a.devices.length} device${r.a.devices.length > 1 ? 's' : ''}` : ''}</small></td>
      <td class="c-last" data-l="Last active">${r.a.last ? ago(r.a.last) : '<span class="tag">not started</span>'}</td><td data-l="Days active (14)">${r.a.w2.act}</td><td data-l="Questions (7d)">${r.a.w.q}</td><td data-l="Minutes (7d)">${r.a.w.min}</td><td data-l="Score (7d)">${r.a.w.acc === null ? '–' : r.a.w.acc + '%'}</td><td data-l="Stronger">${(() => { const ss = (PILOT.activity[r.f.code] || []).flatMap((sn) => (sn.prog && sn.prog.s) || []); const n = (st) => ss.filter((x) => x.status === st).length; return ss.length ? `<span class="gs-mini">${n('rising') ? `<span class="up">▲${n('rising')}</span>` : ''}${n('steady') ? `<span>=${n('steady')}</span>` : ''}${n('dipping') ? `<span class="down">▼${n('dipping')}</span>` : ''}${n('building') ? `<span class="muted">·${n('building')}</span>` : ''}</span>` : '–'; })()}</td><td data-l="Streak">${r.a.streak ? r.a.streak + ' d' : '–'}</td><td data-l="AI cost">${r.a.usage.usd ? money(r.a.usage.usd) : '–'}</td><td data-l="Books">${r.a.books.length}</td><td data-l="Problems">${r.a.errs.length ? `<span class="tag red">${r.a.errs.length}</span>` : '–'}</td><td class="c-plan" data-l="Plan"><select class="pl-plan" data-code="${esc(r.f.code)}" aria-label="Plan for ${esc(r.f.name)}">${['', 'free', 'plus', 'pro'].map((p) => `<option value="${p}" ${(r.f.plan || '') === p ? 'selected' : ''}>${p ? p[0].toUpperCase() + p.slice(1) : 'Pro (default)'}</option>`).join('')}</select></td></tr>
      <tr class="pl-detail" id="fd${i}" hidden><td colspan="12"><button class="link pl-close" data-close="${i}">Close ✕</button><div class="fd-tools"><button class="btn ghost small danger" data-remove="${esc(r.f.code)}" data-name="${esc(r.f.name)}">Remove this family</button></div>${famDetail(r, fb.filter((x) => x.code === r.f.code))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No families yet. Add one below.</p>'}
    <p class="hint" style="margin:0">Devices send a summary when the app opens, after each practice set and every 10 minutes while it’s open. Families idle for 4+ days are greyed.</p></div>
`;
  } else if (tab === 'updates') {
    body = updatesHTML(rows);
  } else if (tab === 'numbers') {
    body = pilotOverview(rows, fams).split('\u0001')[1];
  } else {
    body = `<div class="card"><h2>Feedback (${fb.length})</h2>
    ${fb.length ? fb.map((x) => `<div class="pl-fb"><div><b>${esc(famName(x.code))}</b>${x.name ? ` · ${esc(x.name)}` : ''} <small>${ago(x.at)}</small></div><p>${esc(x.text)}</p></div>`).join('') : '<p class="muted" style="margin:0">No feedback yet. Families send it from Settings in the app.</p>'}</div>`;
  }
  shell(tab, head + body);
  if (tab === 'updates') bindUpdates(rows);
  { const ao = $('addopen'); if (ao) ao.onclick = () => { const c = $('addcard'); c.hidden = !c.hidden; if (!c.hidden) $('fname').focus(); }; }
  $('reload').onclick = () => renderPilot('reload', tab);
  { const c = $('ccmfcopy'); if (c) c.onclick = () => { navigator.clipboard.writeText($('ccmftext').textContent); c.textContent = 'Copied'; }; }
  $('csv').onclick = () => { const blob = new Blob([pilotCSV(rows)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prepbuddy-pilot-${dayKey(Date.now())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  app.querySelectorAll('.pl-plan').forEach((sel) => { sel.onclick = (e) => e.stopPropagation(); sel.onchange = async () => {
    sel.disabled = true;
    try { await adminApi({ action: 'pilot_note', code: sel.dataset.code, plan: sel.value || null }); const f = fams.find((x) => x.code === sel.dataset.code); if (f) f.plan = sel.value || null; sel.insertAdjacentHTML('afterend', '<small class="pl-saved">Saved. Applies next time they open the app.</small>'); }
    catch (err) { alert('Couldn’t change the plan: ' + err.message); }
    sel.disabled = false;
  }; });
  app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Remove ${b.dataset.name}?\n\nTheir code (${b.dataset.remove}) stops working, and their activity and feedback are deleted from the pilot. Progress on their own device isn't touched. This can't be undone.`)) return;
    b.disabled = true; b.textContent = 'Removing…';
    try { await adminApi({ action: 'pilot_remove', code: b.dataset.remove }); (PILOT = null, renderPilot(`Removed ${esc(b.dataset.name)}. Their code no longer works.`, 'families')); }
    catch (err) { b.disabled = false; b.textContent = 'Remove this family'; alert('Couldn’t remove: ' + err.message); }
  }));
  app.querySelectorAll('[data-close]').forEach((x) => (x.onclick = () => { const tr = app.querySelector(`[data-fam="${x.dataset.close}"]`); if (tr) { tr.click(); tr.scrollIntoView({ block: 'nearest' }); } }));
  app.querySelectorAll('[data-fam]').forEach((tr) => (tr.onclick = () => { const d = $('fd' + tr.dataset.fam); d.hidden = !d.hidden; tr.classList.toggle('open', !d.hidden); }));
  { const af = $('addf'); if (af) af.onsubmit = async (e) => {
    e.preventDefault(); const btn = $('addgo'); btn.disabled = true;
    try {
      const r = await adminApi({ action: 'pilot_add', name: $('fname').value, note: $('fnote').value, phone: $('fphone') ? $('fphone').value : '' });
      const msg = `Hi! Thanks for trying PrepBuddy. Open ${location.origin} on your child’s phone or computer and enter this family code: ${r.family.code}\nAny feedback is welcome: there’s a box for it in Settings.`;
      $('newcode').innerHTML = `<div class="ok">Code for ${esc(r.family.name)}: <b style="font-size:18px;letter-spacing:.05em">${esc(r.family.code)}</b></div>
        <label>Message to send them<textarea id="invite" rows="3">${esc(msg)}</textarea></label><div class="acts"><button class="link" id="copyinv">Copy message</button><button class="link" id="refresh">Done: refresh the list</button></div>`;
      $('copyinv').onclick = () => { navigator.clipboard.writeText($('invite').value); $('copyinv').textContent = 'Copied'; };
      $('refresh').onclick = () => renderPilot('reload', 'families');
      $('fname').value = ''; $('fnote').value = '';
    } catch (err) { $('newcode').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    btn.disabled = false;
  }; }
}
/* ---------- weekly updates to parents ----------
   One ready-made message per family (each child's week, their subject levels, one thing to do, and a permanent
   link to the child's latest report), in the parent's language. "Open in WhatsApp" opens it addressed to the
   parent; you press send. Until accounts, this is how parents hear from PrepBuddy without opening the child's device. */
const SUBJ_ZH = { math: '數學', chi: '中文', eng: '英文', gs: '常識', phy: '物理', chem: '化學', bio: '生物', econ: '經濟', hist: '歷史', geog: '地理', csd: '公民', sci: '科學', hum: '人文', ict: 'ICT', bafs: 'BAFS' };
let LINKS = null; // { 'CODE/device': token }
function kidsOf(code) { return (PILOT.activity[code] || []).filter((sn) => sn && (sn.rep || sn.prog || sn.total)).sort((a, b) => (b.synced || 0) - (a.synced || 0)); }
function weeklyMsg(f, lang) {
  const zh = lang === 'zh', T = (en, c) => (zh ? c : en), kids = kidsOf(f.code);
  const fam = String(f.name || '').split('(')[0].trim();
  const blocks = kids.map((sn) => {
    let r = null; try { r = sn.rep ? decodeReport(sn.rep) : null; } catch (e) {}
    const who = (sn.name || (r && r.n) || '').trim() || T('Your child', '孩子');
    const grade = sn.learner && sn.learner.grade ? ` (${sn.learner.grade})` : '';
    const lines = [];
    if (r) {
      const min = (r.days || []).reduce((a, b) => a + b, 0);
      lines.push(r.q ? T(`• Practised ${r.dp} of 7 days, ${min} min, ${r.q} questions${r.a != null ? `, ${r.a}% of marks` : ''}`, `• 7 日中練習了 ${r.dp} 日，共 ${min} 分鐘、${r.q} 題${r.a != null ? `，得分率 ${r.a}%` : ''}`)
        : T('• No practice this week. 15 minutes at the same time each day helps most.', '• 本週未有練習。每天固定時間練習 15 分鐘最有效。'));
    }
    const subs = (sn.prog && sn.prog.s ? sn.prog.s : []).filter((x) => x.level != null).slice(0, 4);
    const name = (k) => (zh ? SUBJ_ZH[k] : SUBJ_NAME[k]) || (k.startsWith('s:') ? k.slice(2) : T('a book', '課本'));
    const up = subs.filter((x) => x.status === 'rising');
    const nextOf = (x) => (x.next && x.next[zh ? 'zh' : 'en'] ? T(`\n   → ${x.next.en}`, `\n   → ${x.next.zh}`) : '');
    subs.forEach((x) => {
      const lv = x.level.toFixed(1);
      lines.push(x.status === 'rising' ? T(`• ${name(x.key)}: getting stronger, level ${x.start != null ? x.start.toFixed(1) + ' → ' : ''}${lv} ▲`, `• ${name(x.key)}：進步中，程度 ${x.start != null ? x.start.toFixed(1) + ' → ' : ''}${lv} ▲`)
        : x.status === 'dipping' ? T(`• ${name(x.key)}: level ${lv}, slipping a little`, `• ${name(x.key)}：程度 ${lv}，略有退步`) + nextOf(x)
        : x.status === 'steady' ? T(`• ${name(x.key)}: holding steady at level ${lv}`, `• ${name(x.key)}：保持穩定，程度 ${lv}`) + nextOf(x)
        : T(`• ${name(x.key)}: starting level ${lv} (trend in ~${Math.max(1, x.wkLeft || 1)} week${Math.max(1, x.wkLeft || 1) > 1 ? 's' : ''})`, `• ${name(x.key)}：初步程度 ${lv}（約 ${Math.max(1, x.wkLeft || 1)} 星期後顯示走勢）`));
    });
    if (up.length) lines.push(T('  (Level = how hard the questions they get 2 in 3 right are, so it rises even when % stays the same.)', '  （程度＝孩子能答對約三分之二的題目難度，所以即使得分率不變，程度也會上升。）'));
    if (r && r.q && r.next && (r.u === 'zh') === zh) lines.push(T(`• Next: ${r.next}`, `• 下一步：${r.next}`)); // written in the app's language
    const t = LINKS && LINKS[`${f.code}/${sn.device}`];
    if (t) lines.push(T(`Full report: ${location.origin}/r/${t}`, `完整報告：${location.origin}/r/${t}`));
    return `*${who}${grade}*\n${lines.join('\n')}`;
  });
  if (!blocks.length) return T(`Hi ${fam}! Just checking in from PrepBuddy: we haven’t seen practice on the app yet. Anything we can help with to get started?`, `${fam}你好！PrepBuddy 想跟進一下：我們暫時未見孩子在 app 練習。開始使用時有甚麼需要幫忙嗎？`);
  return T(`Hi ${fam}! Your PrepBuddy weekly update:\n\n${blocks.join('\n\n')}\n\nAny questions or feedback, just reply here. Thank you!`, `${fam}你好！以下是 PrepBuddy 每週更新：\n\n${blocks.join('\n\n')}\n\n有任何問題或意見，直接回覆便可。謝謝！`);
}
function updatesHTML(rows) {
  const list = rows.filter((r) => r.f.name !== '(not on the list)');
  return `<div class="card"><p class="hint" style="margin:0">Each family’s update is written for you from their latest sync. Check it, edit if you like, then <b>Open in WhatsApp</b> (it opens addressed to the parent; press send there). Report links are permanent per child and always show their latest report. Families not updated in 6+ days are marked.</p></div>
  ${list.map((r) => { const f = r.f, lang = f.lang || ([...(r.a.langs || [])][0] === 'zh' ? 'zh' : 'en'), due = !(f.sent > Date.now() - 6 * 864e5);
    return `<div class="card wu ${due ? 'due' : ''}" data-code="${esc(f.code)}"><div class="wu-head"><b>${esc(f.name)}</b><span class="wu-sent">${f.sent ? `Sent ${ago(f.sent)}` : 'Not sent yet'}</span></div>
      <div class="wu-row"><label>WhatsApp <input class="wu-phone" inputmode="tel" value="${esc(f.phone || '')}" placeholder="e.g. 9123 4567"></label>
        <span class="wu-lang"><button class="btn ghost small ${lang === 'en' ? 'on' : ''}" data-lang="en">English</button><button class="btn ghost small ${lang === 'zh' ? 'on' : ''}" data-lang="zh">中文</button></span></div>
      <textarea class="wu-msg" rows="10">${esc(weeklyMsg(f, lang))}</textarea>
      <div class="wu-acts"><a class="btn small wu-wa" target="_blank" rel="noopener">Open in WhatsApp</a><button class="btn ghost small wu-copy">Copy</button><button class="btn ghost small wu-mark">Mark as sent</button><span class="hint wu-note"></span></div></div>`; }).join('') || '<div class="card"><p class="muted" style="margin:0">No families yet.</p></div>'}`;
}
function bindUpdates(rows) {
  const fams = rows.map((r) => r.f);
  const waLink = (card) => { const ph = String(card.querySelector('.wu-phone').value).replace(/[^0-9]/g, ''), full = ph.length === 8 ? '852' + ph : ph; const a = card.querySelector('.wu-wa');
    a.href = `https://wa.me/${full}?text=${encodeURIComponent(card.querySelector('.wu-msg').value)}`; a.classList.toggle('disabled', !full); a.title = full ? '' : 'Add the parent’s WhatsApp number first'; };
  const save = async (code, patch, card, msg) => { try { await adminApi({ action: 'pilot_note', code, ...patch }); const f = fams.find((x) => x.code === code); if (f) Object.assign(f, patch.phone !== undefined ? { phone: patch.phone } : {}, patch.lang ? { lang: patch.lang } : {}, patch.sent ? { sent: Date.now() } : {}); if (msg) card.querySelector('.wu-note').textContent = msg; } catch (e) { card.querySelector('.wu-note').textContent = 'Couldn’t save: ' + e.message; } };
  app.querySelectorAll('.wu').forEach((card) => {
    const code = card.dataset.code, f = fams.find((x) => x.code === code);
    waLink(card);
    card.querySelector('.wu-msg').oninput = () => waLink(card);
    card.querySelector('.wu-phone').oninput = () => waLink(card);
    card.querySelector('.wu-phone').onchange = (e) => save(code, { phone: e.target.value }, card, 'Number saved.');
    card.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { card.querySelectorAll('[data-lang]').forEach((x) => x.classList.toggle('on', x === b)); card.querySelector('.wu-msg').value = weeklyMsg(f, b.dataset.lang); waLink(card); save(code, { lang: b.dataset.lang }, card); }));
    const sent = () => { save(code, { sent: 1 }, card, 'Marked as sent.'); card.classList.remove('due'); card.querySelector('.wu-sent').textContent = 'Sent just now'; };
    card.querySelector('.wu-wa').addEventListener('click', (e) => { if (e.currentTarget.classList.contains('disabled')) { e.preventDefault(); card.querySelector('.wu-phone').focus(); return; } sent(); });
    card.querySelector('.wu-mark').onclick = sent;
    card.querySelector('.wu-copy').onclick = async () => { try { await navigator.clipboard.writeText(card.querySelector('.wu-msg').value); card.querySelector('.wu-note').textContent = 'Copied.'; } catch (e) {} };
  });
  // make (or fetch) the report links, then refresh the messages with them
  if (!LINKS) {
    const devices = []; rows.forEach((r) => kidsOf(r.f.code).forEach((sn) => { if (sn.device) devices.push({ code: r.f.code, device: sn.device }); }));
    adminApi({ action: 'pilot_links', devices }).then((x) => { LINKS = x.links || {}; app.querySelectorAll('.wu').forEach((card) => { const f = fams.find((y) => y.code === card.dataset.code), on = card.querySelector('[data-lang].on'); card.querySelector('.wu-msg').value = weeklyMsg(f, on ? on.dataset.lang : 'en'); waLink(card); }); })
      .catch((e) => { const c = app.querySelector('.adm-body .card'); if (c) c.insertAdjacentHTML('beforeend', `<p class="err" style="margin:8px 0 0">Couldn’t make report links: ${esc(e.message)}</p>`); });
  }
}

// Getting stronger (js/progress.js): each child's level per subject (1-4: the difficulty they get about 2 in 3
// marks on, first attempts only) and its trend, which allows for questions getting harder. One child per device snapshot.
const SUBJ_NAME = { math: 'Maths', chi: 'Chinese', eng: 'English', gs: 'General Studies', phy: 'Physics', chem: 'Chemistry', bio: 'Biology', econ: 'Economics', hist: 'History', geog: 'Geography', csd: 'Citizenship', sci: 'Science', hum: 'Humanities', ict: 'ICT', bafs: 'BAFS' };
const subjLabel = (k) => SUBJ_NAME[k] || (k.startsWith('s:') ? k.slice(2) : k.startsWith('b:') ? 'Book' : k);
function progKids(rows) {
  const kids = [];
  for (const r of rows) for (const sn of (PILOT.activity[r.f.code] || [])) if (sn.prog && sn.prog.v === 2) kids.push({ fam: r.f.name, grade: sn.learner && sn.learner.grade, p: sn.prog, sn });
  return kids;
}
// % of marks in a child's first 14 active days vs their last 14 (from the daily totals), to show "level up while % flat".
function pctTrend(sn) {
  const ds = (sn.days || []).filter((d) => d.m > 0); if (ds.length < 6) return null;
  const a = ds.slice(0, Math.min(5, Math.floor(ds.length / 2))), b = ds.slice(-Math.min(5, Math.floor(ds.length / 2)));
  const pc = (xs) => xs.reduce((s, d) => s + d.g, 0) / Math.max(1, xs.reduce((s, d) => s + d.m, 0));
  return [pc(a), pc(b)];
}
// Pooled check of the level difficulties: fit every child-subject's ability and the four level difficulties
// together (joint maximum likelihood, level 1 fixed), from first attempts only. Compare with LEVEL_B.
function calibrate(kids) {
  const groups = []; kids.forEach((k) => (k.p.cal || []).forEach((g) => groups.push(g.c)));
  const total = groups.reduce((a, c) => a + Object.values(c).reduce((x, v) => x + v[1], 0), 0);
  const lvSeen = new Set(); groups.forEach((c) => Object.keys(c).forEach((k) => lvSeen.add(k[0])));
  if (groups.length < 4 || total < 300 || lvSeen.size < 3) return { ok: false, groups: groups.length, total };
  let b = { ...LEVEL_B };
  const GU = { c: 0.25, w: 0, u: 0.15 }, sig = (x) => 1 / (1 + Math.exp(-x));
  for (let it = 0; it < 30; it++) {
    const th = groups.map((c) => fit([c], b).th);
    for (const L of [2, 3, 4]) {
      if (!lvSeen.has(String(L))) continue;
      let gr = 0, inf = 0;
      groups.forEach((c, i) => Object.entries(c).forEach(([k, [so, sw]]) => { if (k[0] !== String(L)) return; const g = GU[k[1]] ?? 0, s = sig(th[i] - b[L]), p = Math.min(0.999, Math.max(0.001, g + (1 - g) * s)), dp = (1 - g) * s * (1 - s); gr -= (so - sw * p) * dp / (p * (1 - p)); inf += sw * dp * dp / (p * (1 - p)); }));
      if (inf > 0) b[L] += Math.max(-1, Math.min(1, gr / inf));
    }
  }
  return { ok: true, groups: groups.length, total, gaps: [b[2] - b[1], b[3] - b[2], b[4] - b[3]].map((x) => Math.round(x * 100) / 100) };
}
// Spearman rank correlation.
function spearman(xs, ys) {
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = Array(a.length); o.forEach(([, i], k) => { r[i] = k + 1; }); return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length, mx = (n + 1) / 2;
  const cov = rx.reduce((a, v, i) => a + (v - mx) * (ry[i] - mx), 0), vx = rx.reduce((a, v) => a + (v - mx) ** 2, 0), vy = ry.reduce((a, v) => a + (v - mx) ** 2, 0);
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}
const kv1 = (list) => `<div class="pl-kv one">${list.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
function progCard(rows, card, kv) {
  const kids = progKids(rows);
  const subs = kids.flatMap((k) => k.p.s.map((x) => ({ ...x, k })));
  const ready = subs.filter((x) => x.status !== 'building');
  const cnt = (st) => ready.filter((x) => x.status === st).length;
  const kidsUp = kids.filter((k) => k.p.s.some((x) => x.status === 'rising')).length, kidsReady = kids.filter((k) => k.p.s.some((x) => x.status !== 'building')).length;
  const flatUp = kids.filter((k) => k.p.s.some((x) => x.status === 'rising')).filter((k) => { const t = pctTrend(k.sn); return t && t[1] <= t[0] + 0.03; }).length;
  const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const sg = (x) => (x == null ? '–' : (x > 0 ? '+' : '') + x.toFixed(1)), pc = (a) => (a && a[1] ? `${Math.round(100 * a[0] / a[1])}%` : '–');
  const fx = kids.reduce((a, k) => [a[0] + k.p.fixed[0], a[1] + k.p.fixed[1]], [0, 0]), kp = kids.reduce((a, k) => [a[0] + k.p.kept[0], a[1] + k.p.kept[1]], [0, 0]);
  const cal = calibrate(kids);
  // validation: in-app level vs the latest school marks for the same subject
  const pairs = [];
  kids.forEach((k) => { const ms = (k.sn.marks || []).slice().sort((a, b) => String(a.when).localeCompare(String(b.when))); const last = ms[ms.length - 1]; if (!last) return;
    k.p.s.forEach((x) => { if (x.level != null && x.n >= 30 && typeof last.s[x.key] === 'number') pairs.push([x.level, last.s[x.key], k.fam, x.key]); }); });
  const rho = pairs.length >= 5 ? spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null;
  const chip = (x) => `<span class="gsa ${x.status}">${esc(subjLabel(x.key))} ${x.level == null ? '–' : x.level.toFixed(1)}${x.status === 'rising' ? ` ▲${sg(x.change)}` : x.status === 'dipping' ? ` ▼${sg(x.change)}` : x.status === 'steady' ? ' =' : ' · early'}</span>`;
  const tile = (v, l, sub) => `<div><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const tiles = `<div class="pl-tiles gs-tiles">${tile(`${kidsUp}<small style="font-size:15px;font-weight:600"> of ${kidsReady}</small>`, 'children getting stronger in at least one subject', `${kids.length - kidsReady} still building a picture`)}
    ${tile(kidsUp ? `${flatUp}<small style="font-size:15px;font-weight:600"> of ${kidsUp}</small>` : '–', 'of those, with % of marks flat or lower', 'the harder-questions effect')}
    ${tile(ready.length ? `${cnt('rising')} · ${cnt('steady')} · ${cnt('dipping')}` : '–', 'subjects ▲ stronger · = steady · ▼ slipping')}
    ${tile(sg(med(ready.map((x) => x.change))), 'typical change, in levels', 'median across subjects')}
    ${tile(fx[1] ? pc(fx) : '–', 'mistakes fixed on a retry', fx[1] ? `${fx[1]} retries` : '')}
    ${tile(kp[1] ? pc(kp) : '–', 'remembered a week or more later', '')}</div>`;
  const table = kids.length ? `<div class="pl-tablewrap"><table class="pl-table pl-mini gs-table"><thead><tr><th>Child</th><th>Subjects: level now and change since they started</th><th>Fixed</th><th>Remembered</th></tr></thead><tbody>
    ${kids.slice().sort((a, b) => (b.p.s.filter((x) => x.status === 'rising').length - a.p.s.filter((x) => x.status === 'rising').length)).map((k) => `<tr class="pl-row"><td class="gs-c1"><b>${esc(k.fam.replace(/\s*\(.*\)$/, ''))}</b>${k.grade ? ` <small class="gs-in">${esc(k.grade)}</small>` : ''}${k.sn.name ? ` <small class="gs-in">· ${esc(k.sn.name)}</small>` : ''}</td><td class="gs-c2">${k.p.s.length ? k.p.s.slice(0, 6).map(chip).join(' ') : '<small class="muted">no answers yet</small>'}</td><td data-l="Mistakes fixed">${k.p.fixed[1] ? pc(k.p.fixed) : '–'}</td><td data-l="Remembered later">${k.p.kept[1] ? pc(k.p.kept) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No data yet.</p>';
  const checks = kv1([
    ['Level difficulties (pooled fit)', cal.ok ? `gaps ${cal.gaps.join(' · ')} <small>assumed 1.5 each · ${cal.total} marks</small>` : `<small>waiting for data: needs 4+ child-subjects and 300+ first-try marks (now ${cal.groups}, ${Math.round(cal.total)})</small>`],
    ['In-app level vs school marks', rho != null ? `Spearman ${rho.toFixed(2)} <small>(${pairs.length} child-subjects)</small>` : `<small>waiting for data: needs 5+ child-subjects with 30+ answers and school marks (now ${pairs.length})</small>`]]);
  return `<div class="card"><h2>Getting stronger</h2><p class="hint" style="margin:-4px 0 10px">Each child’s level per subject (1–4), allowing for questions getting harder. The headline learning-outcome measure.</p>
    ${tiles}<h3 class="pl-h3">By child</h3>${table}<h3 class="pl-h3">Checks</h3>${checks}
    <details class="gs-how"><summary>How it’s worked out</summary><p class="hint">Level (1–4) = the difficulty a child gets about 2 in 3 marks on, from first tries only (redos excluded), allowing for guessing on multiple choice and for help asked from Buddy. A subject is “stronger” or “slipping” only once it has 3+ weeks and 30+ first tries and the change is at least 0.25 levels and clearly bigger than its uncertainty (in simulations: about 2–5% false alarms for children who aren’t changing); before that it shows an early level. Pooled fit: if a gap differs from 1.5 by more than about 0.5, update LEVEL_B in js/progress.js. A positive correlation with school marks is the evidence the level means something outside the app.</p></details></div>`;
}

function marksStats(rows) {
  const kids = [];
  for (const r of rows) for (const sn of (PILOT.activity[r.f.code] || [])) {
    const ms = (sn.marks || []).slice().sort((a, b) => String(a.when).localeCompare(String(b.when)));
    const base = ms.find((m) => m.kind === 'before'), later = ms.filter((m) => m.kind === 'later'), last = later[later.length - 1];
    kids.push({ base, last });
  }
  const per = kids.filter((k) => k.base && k.last).map((k) => { const ds = Object.keys(k.base.s).filter((s) => typeof k.last.s[s] === 'number').map((s) => k.last.s[s] - k.base.s[s]); return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null; }).filter((x) => x !== null);
  return { kids: kids.length, withBase: kids.filter((k) => k.base).length, pairs: per.length, avg: per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0, up: per.filter((d) => d >= 2).length, down: per.filter((d) => d <= -2).length };
}
// Is it helping? School marks before PrepBuddy vs the latest, entered by parents (one child per device snapshot).
function marksCard(rows, card, kv) {
  const kids = [];
  for (const r of rows) for (const sn of (PILOT.activity[r.f.code] || [])) {
    const ms = (sn.marks || []).slice().sort((a, b) => String(a.when).localeCompare(String(b.when)));
    const base = ms.find((m) => m.kind === 'before'), later = ms.filter((m) => m.kind === 'later'), last = later[later.length - 1];
    kids.push({ fam: r.f.name, grade: sn.learner && sn.learner.grade, base, last });
  }
  const withBase = kids.filter((k) => k.base), pairs = withBase.filter((k) => k.last);
  const subj = {}, per = pairs.map((k) => {
    const ds = Object.keys(k.base.s).filter((s) => typeof k.last.s[s] === 'number').map((s) => { const d = k.last.s[s] - k.base.s[s]; (subj[s] || (subj[s] = [])).push(d); return d; });
    return { ...k, d: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null, n: ds.length };
  }).filter((k) => k.d !== null);
  const up = per.filter((k) => k.d >= 2).length, down = per.filter((k) => k.d <= -2).length, avg = per.length ? per.reduce((a, k) => a + k.d, 0) / per.length : null;
  const NAMES = { chi: 'Chinese', eng: 'English', math: 'Maths', gs: 'General Studies', other: 'Other' }, sg = (x) => (x > 0 ? '+' : '') + x.toFixed(1);
  return card('Is it helping? School marks', kv([
    ['Children with marks before PrepBuddy', `${withBase.length} of ${kids.length}`], ['… and later results', pairs.length],
    ['Average change (points)', avg === null ? '–' : sg(avg)], ['Improved / about the same / lower', per.length ? `${up} / ${per.length - up - down} / ${down}` : '–']])
    + (Object.keys(subj).length ? `<h3 class="pl-h3">By subject (average change)</h3>` + kv(Object.entries(subj).map(([s, ds]) => [NAMES[s] || s, `${sg(ds.reduce((a, b) => a + b, 0) / ds.length)} <small>(${ds.length})</small>`])) : '')
    + (per.length ? `<h3 class="pl-h3">By child</h3>` + kv(per.map((k) => [`${esc(k.fam)}${k.grade ? ` · ${esc(k.grade)}` : ''}`, `${sg(k.d)} <small>${esc(k.base.when)} → ${esc(k.last.when)}</small>`])) : ''),
    'Parents enter the last school test or exam before PrepBuddy, then later results (Parent dashboard, or the card on Today). “Improved” = 2+ points up on average across the subjects entered both times. Small numbers and no comparison group: treat as early signs, not proof.');
}
// The server's own count of AI cost per family per day (lib/spend.js), and the daily caps it enforces.
function spendCard(rows, card, kv) {
  const sp = PILOT && PILOT.spend; if (!sp || !sp.days) return '';
  const days = Object.keys(sp.days).sort().reverse(), today = days[0], name = (c) => { const r = rows.find((x) => x.f.code === c); return r ? r.f.name : c === 'SHARED' ? 'Shared access code' : c; };
  const t = sp.days[today] || {}, tot = Object.values(t).reduce((a, b) => a + b, 0);
  const week = {}; days.forEach((d) => Object.entries(sp.days[d]).forEach(([c, v]) => { week[c] = (week[c] || 0) + v; }));
  const near = Object.entries(t).filter(([, v]) => v >= sp.familyCap * 0.8);
  return card('Daily AI cap (server)', kv([['Today, all families', `${money(tot)} of ${money(sp.totalCap)}`], ['Cap per family per day', money(sp.familyCap)], ['Families at or near the cap today', near.length ? near.map(([c, v]) => `${esc(name(c))} · ${money(v)}`).join(', ') : 'None']])
    + `<h3 class="pl-h3">Last 7 days by family</h3>` + barList(Object.entries(week).sort((a, b) => b[1] - a[1]).map(([c, v]) => [name(c), v, `today ${money(t[c] || 0)}`]), money),
    'Counted on the server for every AI request, so it can’t be skipped like the app’s own limits. A family that reaches the cap can still practise saved questions until midnight (HK time). Change the caps in Vercel: FAMILY_DAILY_USD and DAILY_USD_CAP.');
}
function famDetail(r, fb) {
  const a = r.a, t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 21 }, (_, i) => { const t = t0.getTime() - (20 - i) * 864e5; return { t, x: a.days[dayKey(t)] }; });
  const max = Math.max(10, ...days.map((d) => (d.x ? d.x.min : 0)));
  const fx = Object.entries(a.fx).filter(([k]) => !k.startsWith('screen:')).sort((x, y) => y[1].n - x[1].n);
  const scr = Object.entries(a.fx).filter(([k]) => k.startsWith('screen:')).sort((x, y) => y[1].n - x[1].n).slice(0, 10);
  // Progress first: each child's subject levels, school marks before → latest, and the weekly update to the parent.
  const kidsHere = (PILOT.activity[r.f.code] || []).filter((sn) => sn && (sn.prog || sn.marks || sn.total));
  const sgn = (x) => (x == null ? '' : (x > 0 ? '+' : '') + x.toFixed(1));
  const chipOf = (x) => `<span class="gsa ${x.status}">${esc(subjLabel(x.key))} ${x.level == null ? '–' : x.level.toFixed(1)}${x.status === 'rising' ? ` ▲${sgn(x.change)}` : x.status === 'dipping' ? ` ▼${sgn(x.change)}` : x.status === 'steady' ? ' =' : ' · early'}</span>`;
  const marksLine = (sn) => { const ms = (sn.marks || []).slice().sort((a, b) => String(a.when).localeCompare(String(b.when))); const b0 = ms.find((m) => m.kind === 'before'), l = ms.filter((m) => m.kind === 'later').pop();
    if (!b0) return '<small class="muted">no school marks yet</small>';
    return Object.keys({ ...b0.s, ...(l ? l.s : {}) }).map((k) => { const a1 = b0.s[k], b1 = l ? l.s[k] : undefined, d = typeof a1 === 'number' && typeof b1 === 'number' ? b1 - a1 : null;
      return `<span class="gsa ${d > 0 ? 'rising' : d < 0 ? 'dipping' : ''}">${esc(subjLabel(k === 'gs' ? 'gs' : k))} ${a1 ?? '–'}${l ? ` → ${b1 ?? '–'}` : ''}</span>`; }).join(' ') + ` <small>${esc(b0.when)}${l ? ` → ${esc(l.when)}` : ''}</small>`; };
  const progress = `<div class="fd-prog"><h3>Progress</h3>${kidsHere.length ? kidsHere.map((sn) => `<div class="fd-kid"><b>${esc(sn.name || 'Child')}</b>${sn.learner && sn.learner.grade ? ` <small>${esc(sn.learner.grade)}</small>` : ''}
      <div class="fd-row"><span>Levels</span><b class="fd-chips">${sn.prog && sn.prog.s && sn.prog.s.length ? sn.prog.s.slice(0, 6).map(chipOf).join(' ') : '<small class="muted">no answers yet</small>'}</b></div>
      <div class="fd-row"><span>School marks</span><b class="fd-chips">${marksLine(sn)}</b></div>
      ${LINKS && LINKS[`${r.f.code}/${sn.device}`] ? `<div class="fd-row"><span>Report link</span><b><a href="/r/${esc(LINKS[`${r.f.code}/${sn.device}`])}" target="_blank" rel="noopener">/r/${esc(LINKS[`${r.f.code}/${sn.device}`])}</a></b></div>` : ''}</div>`).join('') : '<p class="muted">Nothing synced yet.</p>'}
    <div class="fd-row"><span>Weekly update</span><b>${r.f.sent ? `sent ${ago(r.f.sent)}` : 'not sent yet'}${r.f.phone ? ` · +${esc(r.f.phone)}` : ' · <span class="muted">no WhatsApp number</span>'} · <a href="#updates" data-nav="updates">open</a></b></div></div>`;
  return `<div class="fd">${progress}
    <div><h3>Minutes each day (last 3 weeks)</h3><div class="fd-bars">${days.map((d) => `<span title="${dayKey(d.t)}: ${d.x ? `${d.x.min} min, ${d.x.q} questions` : 'none'}"><i style="height:${d.x ? Math.max(4, Math.round(70 * d.x.min / max)) : 2}px" class="${d.x ? '' : 'none'}"></i></span>`).join('')}</div>
      <div style="margin-top:8px">${a.first ? `<div class="fd-row"><span>Started</span><b>${new Date(a.first).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b></div>` : ''}${a.learner ? `<div class="fd-row"><span>${(a.grades || []).length > 1 ? 'Children (grades)' : 'Grade (set by parent)'}</span><b>${esc((a.grades || []).length > 1 ? a.grades.join(', ') : String(a.learner.grade || ''))}${a.learner.pace ? ` <small>${esc({ support: 'needs extra help', ontrack: 'about right', ahead: 'ahead' }[a.learner.pace] || '')}</small>` : ''}</b></div>` : ''}<div class="fd-row"><span>Plan on device</span><b>${esc(a.plans.join(', ') || '–')}</b></div>${a.devices.map((d) => `<div class="fd-row"><span>${esc(d.ua ? d.ua[0].toUpperCase() + d.ua.slice(1) : 'Device')}${d.ios ? ' (iOS)' : ''}${d.inst ? ' · on Home Screen' : d.ios ? ' · <b style="color:#B22A1E">not on Home Screen</b>' : ''}</span><b>synced ${ago(d.synced)}</b></div>`).join('')}</div>
      ${r.f.note ? `<p class="hint" style="margin:6px 0 0"><b>Notes:</b> ${esc(r.f.note)}</p>` : ''}</div>
    <div><h3>Books</h3>${a.books.length ? a.books.map((b) => `<div class="fd-row"><span>${esc(b.title)} <small>${esc(b.subject)} ${esc(b.level)}</small></span><b>${b.pct === null ? '–' : b.pct + '%'}</b></div>`).join('') : '<p class="muted">None added yet.</p>'}
      <h3 style="margin-top:12px">Totals</h3>${[['Mistakes open', a.counts.mistakes], ['Mistakes fixed', a.counts.fixed], ['Lessons finished', a.counts.learned], ['Tests taken', a.counts.tests], ['School tests planned', a.counts.schoolTests], ['Homework sessions', a.counts.homework], ['Essays marked', a.counts.writing], ['Speaking answers', a.counts.speaking], ['Dictations', a.counts.dictation]].map(([k, v]) => `<div class="fd-row"><span>${k}</span><b>${v || 0}</b></div>`).join('')}</div>
    <div><h3>Features used</h3>${fx.length ? fx.map(([k, v]) => `<div class="fd-row"><span>${esc(fname(k))}</span><b>${v.n}× <small>${ago(v.last)}</small></b></div>`).join('') : '<p class="muted">Nothing yet.</p>'}</div>
    <div><h3>Screens visited</h3>${scr.map(([k, v]) => `<div class="fd-row"><span>${esc(k.slice(7))}</span><b>${v.n}</b></div>`).join('') || '<p class="muted">–</p>'}
      ${a.errs.length ? `<h3 style="margin-top:12px">Problems seen</h3>${a.errs.map((e) => `<div class="fd-err">${esc(e.m)} <small>${esc(e.v || '')} · ${ago(e.t)}</small></div>`).join('')}` : ''}
      ${fb.length ? `<h3 style="margin-top:12px">Their feedback</h3>${fb.map((x) => `<p class="fd-fb">“${esc(x.text)}” <small>${ago(x.at)}</small></p>`).join('')}` : ''}</div>
    <div><h3>Summary</h3>${(() => { const x = famStatus(a, r.f); return `<div class="ins ${x.tone} fd-status"><i>●</i><div><b>${x.label}</b><p>${esc(x.why)}</p><p class="ins-act">→ ${esc(x.act)}</p></div></div>`; })()}
      <div class="fd-tiles">${[
        [a.actDays, `active day${a.actDays === 1 ? '' : 's'}`, a.wk2 === null ? '' : a.wk2 ? 'came back in week 2' : 'didn’t come back in week 2', a.wk2 === false ? 'down' : a.wk2 ? 'up' : ''],
        [a.tot.q, 'questions', `${a.w.q} this week · ${a.pw.q} last week`],
        [a.tot.min, 'minutes', `${a.w.min} this week · ${a.pw.min} last week`],
        [a.tot.acc === null ? '–' : a.tot.acc + '%', 'right overall', a.w.acc === null ? '' : `${a.w.acc}% this week`],
        [a.streak, `day streak`, `best ${a.best}`],
        [a.goal ? `${Number(a.goal.days) || 0}×${Number(a.goal.mins) || 0}` : '–', 'weekly goal', a.goal ? 'days × minutes' : 'not set'],
        [a.consent ? '✓' : '✗', 'parent consent', a.consent ? new Date(a.consent.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'not yet', a.consent ? 'up' : 'down'],
        [a.pin ? '✓' : '✗', 'parent PIN', `${a.parentUse} parent view${a.parentUse === 1 ? '' : 's'}`, a.pin ? 'up' : 'down'],
        ...(a.stars ? [[a.stars.total, 'stars earned', `${a.stars.bal} unspent · ${a.stars.redeemed} redeemed`], [a.stars.rushedQ, 'rushed questions', `hit daily cap ${a.stars.capDays}×`, a.stars.rushedQ ? 'down' : '']] : []),
        [money(a.usage.usd), 'AI cost', `${a.usage.calls} requests`],
      ].map(([v, l, sub, tone]) => `<div><b>${v}</b><span>${l}</span>${sub ? `<small class="${tone || ''}">${sub}</small>` : ''}</div>`).join('')}</div>
      ${Object.keys(a.modes).length ? `<h3 style="margin-top:12px">How they practise</h3>${Object.entries(a.modes).sort((x, y) => y[1].q - x[1].q).map(([k, v]) => `<div class="fd-row"><span>${esc(MODE_NAMES[k] || k)}</span><b>${v.q} q <small>· ${v.m ? pctOf(v.g, v.m) + '% right' : ''}</small></b></div>`).join('')}` : ''}</div>
    <div><h3>When they study</h3>${colBars(a.hours, a.hours.map((_, i) => (i % 3 === 0 ? String(i) : '')), (i, v) => `${i}:00: ${v} questions`)}
      <h3 style="margin-top:12px">Recent sets</h3>${a.sess.length ? a.sess.slice(-8).reverse().map((x) => `<div class="fd-row"><span>${esc(MODE_NAMES[x.k] || x.k || 'Practice')} <small>${new Date(x.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${x.n} q · ${x.min} min${x.r ? ' · <span class="tag red">rushed</span>' : ''}${x.e ? ' · left early' : ''}</small></span><b>${x.p}%</b></div>`).join('') : '<p class="muted">None yet.</p>'}</div>
  </div>`;
}

/* ---------- questions students reported ---------- */
function renderReports() {
  setHash('#reports');
  shell('reports', `<header><h1>Reported questions</h1></header><div class="card" id="reports"><h2>Reported questions</h2><p class="muted" style="margin:0">Loading…</p></div>`);
  loadReports();
}
const REASON = { wrong_answer: 'The answer is wrong', unclear: 'The question doesn’t make sense', missing_figure: 'Needs a diagram or table they can’t see', off_topic: 'Not from the textbook', typo: 'Spelling or formatting mistake', other: 'Something else' };
async function loadReports() {
  const box = $('reports'); if (!box) return;
  let list;
  let stats = { right: 0, fine: 0, reasons: {} };
  try { const d = await adminApi({ action: 'reports' }); list = d.reports; stats = d.stats || stats; }
  catch (e) { box.innerHTML = `<h2>Reported questions</h2><div class="err">Couldn’t load reports: ${esc(e.message)}</div>`; return; }
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const qHTML = (q) => {
    const opts = Array.isArray(q.options) ? `<ol class="ropts" type="A">${q.options.map((o, i) => `<li class="${'ABCD'[i] === q.correct_option ? 'right' : ''}">${esc(o)}${'ABCD'[i] === q.correct_option ? ' ✓' : ''}</li>`).join('')}</ol>` : '';
    const parts = Array.isArray(q.parts) ? q.parts.map((p) => `<p class="rq-part"><b>${esc(p.label || '')}</b> ${esc(p.prompt || '')} <span class="muted">(${p.marks || 1} mark${p.marks > 1 ? 's' : ''})</span></p>${(p.mark_scheme || []).length ? `<ul class="rq-ms">${p.mark_scheme.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}`).join('') : '';
    return `${q.stem ? `<p class="rq-stem">${esc(q.stem)}</p>` : ''}${opts}${parts}${q.explanation ? `<p class="rq-exp"><b>Explanation:</b> ${esc(q.explanation)}</p>` : ''}${q.source_quote ? `<p class="hint" style="margin:0">Source${q.pages ? `, pp. ${esc(q.pages)}` : ''}: “${esc(q.source_quote)}”</p>` : ''}`;
  };
  box.innerHTML = `<h2>Reported questions (${list.length})</h2>
    ${list.length ? '<p class="hint" style="margin:0">Questions students flagged. Each question was written on that student’s device, so it only ever reached them, and they no longer see it. Decide who was right: it keeps a record of how often the AI gets questions wrong.</p>' : '<p class="muted" style="margin:0">Nothing to check. When a student taps “Report a problem” on a question, it shows up here.</p>'}
    ${stats.right + stats.fine ? `<p class="rstats">Checked so far: <b>${stats.right}</b> real problem${stats.right === 1 ? '' : 's'} · <b>${stats.fine}</b> question${stats.fine === 1 ? ' was' : 's were'} fine${stats.right ? ` · most common: ${esc(REASON[Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])[0][0]] || '')}` : ''}</p>` : ''}
    ${list.map((r, i) => `<div class="rep" data-i="${i}">
      <div class="rep-top"><span class="rtag">${esc(REASON[r.reason] || r.reason)}</span><span class="muted" style="font-size:13px">${when(r.t)}${r.lang === 'zh' ? ' · 中文' : ''}</span></div>
      <div class="hint" style="margin:0">${esc((r.book || {}).title || 'Unknown book')}${(r.book || {}).code ? ` · ${esc(r.book.code)}` : (r.book || {}).library ? '' : ' · student’s own upload'}${(r.unit || {}).title ? ` · ${esc(r.unit.title)}` : ''}${r.q && r.q.level ? ` · Level ${r.q.level}` : ''}</div>
      ${r.note ? `<p class="rnote">“${esc(r.note)}”</p>` : ''}
      <details><summary>Show the question</summary><div class="rq">${qHTML(r.q || {})}${r.answer ? `<p class="rq-ans"><b>Student’s answer:</b> ${esc(r.answer)}</p>` : ''}</div></details>
      <div class="acts verdicts"><button class="btn small" data-resolve="${i}" data-v="right">Student is right: bad question</button><button class="btn ghost small" data-resolve="${i}" data-v="fine">Question is fine</button></div>
    </div>`).join('')}`;
  box.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = async () => {
    const r = list[+b.dataset.resolve]; const row = b.closest('.rep'); row.querySelectorAll('[data-resolve]').forEach((x) => (x.disabled = true)); const label = b.textContent; b.textContent = 'Saving…';
    try { await adminApi({ action: 'resolve', path: r.path, sha: r.sha, verdict: b.dataset.v }); loadReports(); }
    catch (e) { alert(e.message); row.querySelectorAll('[data-resolve]').forEach((x) => (x.disabled = false)); b.textContent = label; }
  }));
}

/* ---------- add a textbook ---------- */
let draft = null; // { fileName, pageCount, pageTexts, units: [{ title, startPage, endPage, text, figures }], hidden: [], lang, method }
const steps = (k) => `<div class="steps">${['1. Upload', '2. Check chapters', '3. Details', '4. Publish'].map((s, i) => `<span class="${i === k ? 'on' : ''}">${s}</span>`).join('')}</div>`;

function renderUpload(msg) {
  app.innerHTML = `<header><h1>Add a textbook</h1><button class="btn ghost small" id="back">Library →</button></header>${steps(0)}
  <div class="card">
    <h2>Upload the PDF</h2>
    <p class="hint" style="margin:0">Only add books you have the right to share with every student (for example free, openly licensed books like OpenStax, or with the publisher’s permission).</p>
    <input type="file" id="file" accept="application/pdf,.pdf">
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <div id="prog" hidden><div class="progress"><i id="bar" style="width:0%"></i></div><p class="hint" id="pmsg"></p></div>
  </div>`;
  $('back').onclick = () => renderLibrary();
  $('file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    $('prog').hidden = false; $('file').disabled = true;
    const show = (pct, m) => { $('bar').style.width = pct + '%'; $('pmsg').textContent = m; };
    try {
      const { readBook, unitsFromStarts } = await import('./book.js');
      const book = await readBook(new Uint8Array(await file.arrayBuffer()), (i, n, m) => show(Math.round(90 * i / n), m || `Reading page ${i} of ${n}`));
      show(92, 'Checking chapter names with AI…');
      let units = book.units, method = book.method;
      try {
        const r = await aiApi('chapters', { title: file.name, text: book.outline, pageCount: book.pageCount });
        const t = unitsFromStarts(book.pageTexts, r.chapters || []);
        const chars = (us) => us.reduce((a, u) => a + u.text.length, 0);
        if (t.length >= 2 && t.length <= 150 && chars(t) >= 0.6 * chars(units)) {
          const figs = units.flatMap((u) => u.figures || []);
          t.forEach((u) => { u.figures = figs.filter((f, i, a) => f.page >= u.startPage && f.page <= u.endPage && a.findIndex((g) => g.page === f.page) === i).slice(0, 6); });
          units = t; method = 'ai';
        }
      } catch (err) { /* keep the reader's own split */ }
      const sample = units.slice(0, 3).map((u) => u.text).join(' ').slice(0, 20000);
      const cjk = (sample.match(/[㐀-鿿]/g) || []).length, words = (sample.match(/[A-Za-z]{2,}/g) || []).length;
      draft = { fileName: file.name, title: book.title, pageCount: book.pageCount, pageTexts: book.pageTexts, units, hidden: [], lang: cjk > words ? 'zh-HK' : 'en', method };
      // the book's details (title, subject, level, licence…) are read from its first pages while chapters are checked
      draft.infoP = aiApi('bookinfo', { fileName: file.name, pdfTitle: book.title, text: book.pageTexts.slice(0, 8).join('\n\n').slice(0, 12000) }).catch(() => null);
      renderChapters();
    } catch (err) { renderUpload(err.message || 'That PDF could not be read.'); }
  };
}

function renderChapters(openSplit = -1) {
  const d = draft;
  app.innerHTML = `<header><h1>Check the chapters</h1><button class="btn ghost small" id="back">Start again</button></header>${steps(1)}
  <div class="card">
    <p class="hint" style="margin:0">${d.units.length} chapters found in ${d.pageCount} pages${d.method === 'ai' ? ', checked by AI' : ''}. Rename, merge, split or hide parts students shouldn’t revise (contents, index, answers). Open “Preview” to check a chapter starts in the right place.</p>
    <div>${d.units.map((u, i) => `<div class="chap">
      <div class="top"><span class="num">${i + 1}</span><input value="${esc(u.title)}" data-title="${i}" aria-label="Chapter ${i + 1} name"><span class="pp">pp. ${u.startPage}–${u.endPage}</span></div>
      <details><summary>Preview</summary><pre>${esc(u.text.slice(0, 700))}${u.text.length > 700 ? '…' : ''}</pre></details>
      ${openSplit === i ? `<div class="split"><span>Start a new chapter at page</span><select id="at">${Array.from({ length: u.endPage - u.startPage }, (_, k) => u.startPage + 1 + k).map((p) => `<option value="${p}">${p} – ${esc((d.pageTexts[p - 1] || '').split('\n')[0].slice(0, 50))}</option>`).join('')}</select><button class="btn" id="dosplit">Split</button><button class="link" id="nosplit">Cancel</button></div>`
        : `<div class="acts">${i < d.units.length - 1 ? `<button class="link" data-merge="${i}">Merge with next</button>` : ''}${u.endPage > u.startPage ? `<button class="link" data-split="${i}">Split</button>` : ''}<button class="link red" data-hide="${i}">Hide</button></div>`}
    </div>`).join('')}</div>
    ${d.hidden.length ? `<h3>Hidden (${d.hidden.length})</h3><div>${d.hidden.map((u, i) => `<div class="row"><div class="meta"><b>${esc(u.title)}</b><span>pp. ${u.startPage}–${u.endPage}</span></div><button class="link" data-show="${i}">Show</button></div>`).join('')}</div>` : ''}
  </div>
  <button class="btn" id="next" ${d.units.length ? '' : 'disabled'}>Next: book details</button>`;
  $('back').onclick = () => { draft = null; renderUpload(); };
  const pageText = (a, b) => d.pageTexts.slice(a - 1, b).join('\n\n');
  app.querySelectorAll('[data-title]').forEach((inp) => (inp.oninput = () => { d.units[+inp.dataset.title].title = inp.value; }));
  app.querySelectorAll('[data-merge]').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.merge, A = d.units[i], B = d.units[i + 1];
    A.endPage = B.endPage; A.text = pageText(A.startPage, A.endPage);
    A.figures = [...(A.figures || []), ...(B.figures || [])].slice(0, 6);
    d.units.splice(i + 1, 1); renderChapters();
  }));
  app.querySelectorAll('[data-split]').forEach((b) => (b.onclick = () => renderChapters(+b.dataset.split)));
  const ns = $('nosplit'); if (ns) ns.onclick = () => renderChapters();
  const ds = $('dosplit');
  if (ds) ds.onclick = () => {
    const i = openSplit, A = d.units[i], at = +$('at').value;
    const B = { title: `${A.title} (part 2)`, startPage: at, endPage: A.endPage, text: pageText(at, A.endPage), figures: (A.figures || []).filter((f) => f.page >= at) };
    A.endPage = at - 1; A.text = pageText(A.startPage, A.endPage); A.figures = (A.figures || []).filter((f) => f.page < at);
    d.units.splice(i + 1, 0, B); renderChapters();
  };
  app.querySelectorAll('[data-hide]').forEach((b) => (b.onclick = () => { d.hidden.push(...d.units.splice(+b.dataset.hide, 1)); renderChapters(); }));
  app.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => { d.units.push(...d.hidden.splice(+b.dataset.show, 1)); d.units.sort((x, y) => x.startPage - y.startPage); renderChapters(); }));
  $('next').onclick = () => { if (d.units.some((u) => !u.title.trim())) return alert('Every chapter needs a name.'); renderDetails(null); };
}

/* ---------- details (new book, or editing one already in the library) ---------- */
const LICENCES = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC-SA 4.0', 'Public domain', 'Licensed from the publisher', 'My own material'];
const KINDS = [['science', 'Science'], ['maths', 'Maths'], ['language', 'Language'], ['humanities', 'Humanities']];
function guessKind(t) {
  t = String(t || '');
  if (/math|數學|algebra|calculus|statistic/i.test(t)) return 'maths';
  if (/english|chinese|中文|中國語文|literature|reading|writing/i.test(t)) return 'language';
  if (/history|geograph|econom|citizenship|social|business|歷史|地理|經濟|公民/i.test(t)) return 'humanities';
  return 'science';
}
async function renderDetails(existing, cat) {
  const d = draft;
  let b = existing || {};
  let ai = null;
  if (!existing && d && d.infoP) {
    app.innerHTML = `<header><h1>Book details</h1></header>${steps(2)}<div class="card"><p class="hint" style="margin:0">Reading the title and copyright pages…</p><div class="progress"><i style="width:60%"></i></div></div>`;
    ai = await d.infoP;
    if (ai) b = { title: ai.title, subject: ai.subject, level: ai.level, kind: ai.kind, publisher: ai.publisher, licence: ai.licence, credit: ai.credit };
  }
  const defTitle = b.title || (d && (d.title && d.title.length > 3 && !/^untitled|microsoft word/i.test(d.title) ? d.title : d.fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ')));
  app.innerHTML = `<header><h1>${existing ? 'Edit book details' : 'Book details'}</h1><button class="btn ghost small" id="back">${existing ? 'Back to library' : 'Back to chapters'}</button></header>${existing ? '' : steps(2)}
  <form class="card" id="f">
    ${ai ? `<div class="aifill">✨ Filled in from the book’s first pages${ai.confidence === 'low' ? ' (not sure: check carefully)' : ''}. Please check before publishing, especially the licence.</div>` : ''}
    <label>Title<input id="title" required value="${esc(defTitle)}"></label>
    <div class="grid2">
      <label>Subject<input id="subject" required placeholder="e.g. Biology, 中國語文" value="${esc(b.subject || '')}"></label>
      <label>Level<input id="level" list="levels" placeholder="e.g. S4–S6 (HKDSE)" value="${esc(b.level || 'S4–S6 (HKDSE)')}">
        <datalist id="levels"><option>S1–S3</option><option>S4–S6 (HKDSE)</option><option>Primary</option><option>IGCSE</option><option>IB</option></datalist></label>
    </div>
    <div class="grid2">
      <label>Subject type<select id="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${(b.kind || guessKind(defTitle)) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Publisher<input id="publisher" placeholder="e.g. OpenStax" value="${esc(b.publisher || '')}"></label>
    </div>
    <div class="grid2">
      <label>Licence<select id="licence">${LICENCES.map((l) => `<option ${b.licence === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Book code<input id="code" value="${esc(b.code || '')}" ${existing ? 'disabled' : ''} placeholder="made automatically"></label>
    </div>
    <label>Credit line (shown to students)<input id="credit" placeholder="e.g. OpenStax Biology 2e, CC BY-NC-SA 4.0. Access for free at openstax.org." value="${esc(b.credit || '')}"></label>
    ${existing ? '' : `<label class="check"><input type="checkbox" id="starter" ${d && d.units.length <= 60 ? 'checked' : ''}> Make starter questions now: 4 checked questions per chapter, so students can start straight away (about ${Math.max(1, Math.round((d ? d.units.length : 0) * 25 / 3 / 60))} min for ${d ? d.units.length : 0} chapters).</label>`}
    ${existing ? '' : `<label class="check"><input type="checkbox" id="rights" required> I have the right to share this book with every PrepBuddy student.</label>`}
    <div id="msg"></div>
    <button class="btn" id="go">${existing ? 'Save changes' : 'Publish to the library'}</button>
  </form>`;
  $('back').onclick = () => (existing ? renderLibrary() : renderChapters());
  if (!existing) $('subject').oninput = () => { if (!$('code').dataset.touched) $('code').placeholder = codeFor($('subject').value); };
  $('code') && ($('code').oninput = () => { $('code').dataset.touched = '1'; });
  $('f').onsubmit = async (e) => {
    e.preventDefault();
    const val = (id) => $(id).value.trim();
    const details = { title: val('title'), subject: val('subject'), level: val('level'), kind: $('kind').value, publisher: val('publisher'), licence: $('licence').value, credit: val('credit') };
    const btn = $('go'); btn.disabled = true;
    try {
      if (existing) {
        btn.textContent = 'Saving…';
        await adminApi({ action: 'update', id: existing.id, changes: details });
        return renderLibrary(`Saved “${details.title}”. The library updates in about 1–2 minutes.`);
      }
      const wantStarter = !!($('starter') && $('starter').checked);
      const pub = await publish(details, val('code'));
      if (wantStarter) {
        try { const n = await makeBank(pub.entry, pub.units); return renderLibrary(`Published “${details.title}” with book code ${pub.code} and ${n} starter questions. It will appear in the library in about 1–2 minutes.`); }
        catch (e2) { return renderLibrary(`Published “${details.title}” (code ${pub.code}), but the starter questions didn’t finish: ${e2.message}. Use “Add starter questions” to try again.`); }
      }
      renderLibrary(`Published “${details.title}” with book code ${pub.code}. It will appear in the library in about 1–2 minutes, while Vercel updates the site.`);
    } catch (err) { $('msg').innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Publish to the library'; }
  };
}
function codeFor(subject) {
  const letters = String(subject || '').normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
  return `${letters.length >= 2 ? letters : 'BK'}-${rand(4)}`;
}

async function publish(details, codeIn) {
  const d = draft;
  const cat = await catalog();
  let code = (codeIn || codeFor(details.subject)).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  while (cat.some((b) => b.code === code)) code = codeFor(details.subject);
  const slug = details.title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'book';
  const id = `${slug}-${rand(4, 'abcdefghjkmnpqrstuvwxyz23456789')}`.replace(/^-/, '');
  // files: chapter text, diagram pictures, an empty question bank
  const files = [];
  d.units.forEach((u, i) => {
    files.push({ path: `library/${id}/u${i}.txt`, content: u.text });
    if ((u.figures || []).length) files.push({ path: `library/${id}/figs/u${i}.json`, content: JSON.stringify(u.figures) });
  });
  files.push({ path: `library/${id}/questions.json`, content: '{}' });
  app.innerHTML = `<header><h1>Publishing</h1></header>${steps(3)}
    <div class="card"><div class="progress"><i id="bar" style="width:0%"></i></div><p class="hint" id="pmsg">Uploading files…</p></div>`;
  // Upload 4 files at a time; each file gets up to 3 tries if the connection hiccups.
  const out = new Array(files.length);
  let next = 0, doneCount = 0;
  const upload = async (k) => {
    for (let tryNo = 1; ; tryNo++) {
      try { const { sha } = await adminApi({ action: 'blob', content: b64(files[k].content) }); out[k] = { path: files[k].path, sha }; return; }
      catch (err) { if (tryNo >= 3 || err.status === 401) throw err; await new Promise((r) => setTimeout(r, 1500 * tryNo)); }
    }
  };
  const worker = async () => {
    while (next < files.length) {
      const k = next++;
      await upload(k);
      doneCount++;
      $('pmsg').textContent = `Uploaded ${doneCount} of ${files.length} files…`;
      $('bar').style.width = `${Math.round(90 * doneCount / files.length)}%`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  $('pmsg').textContent = 'Adding it to the library…';
  const entry = {
    id, code, ...details, lang: d.lang, pageCount: d.pageCount, addedAt: new Date().toISOString().slice(0, 10), questionCount: 0,
    units: d.units.map((u, i) => ({ id: `u${i}`, title: u.title.trim(), chapter: null, startPage: u.startPage, endPage: u.endPage, ...((u.figures || []).length ? { figs: true } : {}) })),
  };
  await adminApi({ action: 'publish', entry, files: out });
  const units = d.units.map((u, i) => ({ id: `u${i}`, title: u.title.trim(), text: u.text }));
  draft = null;
  return { entry, code, units };
}

/* ---------- starter questions ----------
   4 questions per chapter (3 multiple choice at rising levels + 1 short written), each checked by the second AI
   exactly as in the app, published as the book's question bank. Students who add the book get them at once. */
const STARTER = [{ level: 1, type: 'mcq' }, { level: 2, type: 'mcq' }, { level: 3, type: 'mcq' }, { level: 2, type: 'short' }];
// Primary English books: 2 MCQs, 1 short written item and 1 cloze passage (the HK test formats); others as before.
const STARTER_PEN = [{ level: 1, type: 'mcq' }, { level: 2, type: 'mcq' }, { level: 2, type: 'short' }, { level: 3, type: 'structured' }];
const starterItems = (e) => (e.kind === 'language' && (e.lang || 'en') === 'en' && /^P[1-6]$/i.test(String(e.level || '').trim()) ? STARTER_PEN : STARTER);
const okQ = (q) => q && (q.type === 'mcq' ? Array.isArray(q.options) && q.options.length === 4 && 'ABCD'.includes(q.correct_option || '?')
  : Array.isArray(q.parts) && q.parts.length > 0 && q.parts.every((p) => p && p.prompt && Array.isArray(p.mark_scheme) && p.marks > 0));
async function makeBank(entry, units, existing = {}) {
  app.innerHTML = `<header><h1>Starter questions</h1></header>
    <div class="card"><h2>${esc(entry.title)}</h2><div class="progress"><i id="bar" style="width:0%"></i></div><p class="hint" id="pmsg">Writing and checking questions…</p>
    <p class="hint" style="margin:0">Keep this page open. The book is already published; this adds questions to it.</p></div>`;
  const bank = JSON.parse(JSON.stringify(existing || {})); let done = 0, made = 0, next = 0;
  const tag = Date.now().toString(36).slice(-4);
  const lang = entry.lang || 'en';
  const one = async (u) => {
    if (!u.text || u.text.length < 300) return;
    let gen = null;
    for (let t = 1; t <= 2 && !gen; t++) { try { gen = await aiApi('generate', { title: u.title, text: u.text, items: starterItems(entry), kind: entry.kind, bookLevel: entry.level || '', lang }); } catch (e) { if (t === 2) return; } }
    const qs = (gen && gen.questions) || [];
    const passed = [];
    await Promise.all(qs.map(async (q, k) => {
      if (q.figure || !okQ(q)) return;
      try { const v = await aiApi('verify', { title: u.title, text: u.text, question: q }); if (v.passed) passed.push({ ...q, id: `s${tag}${k}` }); } catch (e) {}
    }));
    if (passed.length) { bank[u.id] = [...(bank[u.id] || []), ...passed]; made += passed.length; }
  };
  const worker = async () => { while (next < units.length) { const u = units[next++]; await one(u); done++; $('bar').style.width = `${Math.round(95 * done / units.length)}%`; $('pmsg').textContent = `Chapter ${done} of ${units.length} · ${made} questions ready`; } };
  await Promise.all(Array.from({ length: Math.min(3, units.length) }, worker));
  if (!made) throw new Error('no questions passed the check');
  $('pmsg').textContent = 'Publishing the questions…';
  const { sha } = await adminApi({ action: 'blob', content: b64(JSON.stringify(bank)) });
  const total = Object.values(bank).reduce((a, l) => a + l.length, 0);
  await adminApi({ action: 'bank', id: entry.id, sha, count: total });
  return made;
}
// For a book already in the library: fetch its chapters and make the bank.
async function starterFor(book) {
  app.innerHTML = `<header><h1>Starter questions</h1></header><div class="card"><p class="hint">Downloading the chapters…</p></div>`;
  const units = await Promise.all(book.units.map(async (u) => { const r = await fetch(`library/${book.id}/${u.id}.txt`); return { id: u.id, title: u.title, text: r.ok ? await r.text() : '' }; }));
  const qr = await fetch(`library/${book.id}/questions.json?t=${Date.now()}`, { cache: 'no-store' });
  const existing = qr.ok ? await qr.json().catch(() => ({})) : {};
  return makeBank(book, units, existing);
}

if (pw) adminApi({ action: 'check' }).then(() => home()).catch(() => { pw = ''; renderLogin(); });
else renderLogin();
