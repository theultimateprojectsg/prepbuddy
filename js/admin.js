// PrepBuddy admin: add textbooks to the shared library, edit their details, or remove them.
// Publishing saves the files to the GitHub repo in one commit (via /api/admin); Vercel then updates the site.

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
      renderLibrary();
    } catch (err) { pw = ''; renderLogin(err.status === 401 ? 'That password is not right.' : err.message); }
  };
}

/* ---------- the library ---------- */
async function renderLibrary(note) {
  const cat = await catalog();
  app.innerHTML = `<header><h1>Library</h1><span class="badge">Admin</span></header>
  ${note ? `<div class="ok">${esc(note)}</div>` : ''}
  <div class="card pl-entry"><div><h2>Pilot families</h2><span class="hint">Family codes, who is practising, what they use, and their feedback.</span></div><button class="btn" id="pilot">Open</button></div>
  <div class="card" id="reports"><h2>Reported questions</h2><p class="muted" style="margin:0">Loading…</p></div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Books in the library (${cat.length})</h2><button class="btn" id="add">Add a textbook</button></div>
    <div>${cat.map((b) => `<div class="row" data-id="${esc(b.id)}"><div class="meta"><b>${esc(b.title)}</b><span>${esc(b.subject || '')}${b.level ? ' · ' + esc(b.level) : ''} · ${b.units.length} chapters · code ${esc(b.code)}</span></div>
      <div class="acts">${b.questionCount ? `<span class="hint" style="align-self:center">${b.questionCount} questions</span>` : ''}<button class="link" data-starter="${esc(b.id)}">${b.questionCount ? 'Add more questions' : 'Add starter questions'}</button><button class="link" data-edit="${esc(b.id)}">Edit details</button><button class="link red" data-remove="${esc(b.id)}">Remove</button></div></div>`).join('') || '<p class="muted">No books yet.</p>'}</div>
  </div>
  <p class="hint">Changes go live in about 1–2 minutes, while Vercel updates the site. Students who already added a book keep their copy.</p>
  <button class="btn ghost small" id="out" style="align-self:flex-start">Sign out</button>`;
  loadReports();
  $('add').onclick = () => renderUpload();
  $('pilot').onclick = () => renderPilot();
  $('out').onclick = () => { sessionStorage.removeItem(PW_KEY); pw = ''; renderLogin(); };
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
const fname = (k) => FEATURE_NAMES[k] || (k.startsWith('upsell:') ? `Hit plan limit: ${k.slice(7)}` : k.startsWith('screen:') ? `Screen: ${k.slice(7)}` : k);
const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 2) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`; };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// one family = every device that used its code
function mergeFamily(snaps) {
  const days = {}, fx = {}, books = new Map(); let last = 0, first = null, errs = [], counts = {}, names = new Set(), plans = new Set(), devices = [];
  const hours = Array(24).fill(0), wdays = Array(7).fill(0), modes = {}, usage = { usd: 0, calls: 0, by: {} }, why = {}, langs = new Set();
  let sess = [], streak = 0, best = 0, stars = null, pin = false, goal = null;
  for (const s of snaps) {
    devices.push({ device: s.device, ua: s.ua, synced: s.synced, last: s.last });
    if (s.name) names.add(s.name); if (s.plan) plans.add(s.plan); if (s.lang) langs.add(s.lang);
    last = Math.max(last, s.last || 0); if (s.first) first = first ? Math.min(first, s.first) : s.first;
    for (const d of s.days || []) { const x = days[d.d] || (days[d.d] = { q: 0, g: 0, m: 0, min: 0 }); x.q += d.q; x.g += d.g; x.m += d.m; x.min += d.min; }
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
    if (s.goal) goal = s.goal;
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
    hours, wdays, modes, usage, sess, streak, best, stars, pin, goal, langs: [...langs], actDays, tot: { ...tot, acc: tot.m ? Math.round(100 * tot.g / tot.m) : null }, wk2,
    parentUse: (fx.parent_dashboard ? fx.parent_dashboard.n : 0) + (fx.parent_report ? fx.parent_report.n : 0) + (fx['ai:report'] ? fx['ai:report'].n : 0) };
}
const MODE_NAMES = { practice: 'Practice sets', '': 'Practice sets', spaced: 'Daily reviews', drill: 'Weak-spot drills', mistakes: 'Mistake book redo', dse: 'Chapter tests & DSE papers', mock: 'Mini mock tests', placement: 'Level check', units: 'Practice sets', unit: 'Practice sets', book: 'Practice sets' };
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
  const WHY = { set: 'Finished sets', score: 'Scored 80%+', fix: 'Fixed mistakes', reviews: 'Daily reviews', test: 'Chapter tests', goal: 'Weekly goals', badge: 'Badges', writing: 'Writing', speaking: 'Speaking', dictation: 'Dictation', 'dictation-perfect': 'Perfect dictation', lesson: 'Lessons', 'level check': 'Level checks' };
  const rushedSets = sess.filter((x) => x.r).length;
  // AI cost
  const usd = rows.reduce((x, r) => x + r.a.usage.usd, 0), calls = rows.reduce((x, r) => x + r.a.usage.calls, 0);
  const byPath = {}; rows.forEach((r) => Object.entries(r.a.usage.by).forEach(([k, v]) => { const x = byPath[k] || (byPath[k] = { n: 0, usd: 0 }); x.n += v.n; x.usd += v.usd; }));
  const costWeek = rows.filter((r) => r.a.first && r.a.usage.usd).map((r) => r.a.usage.usd / Math.max(1, (Date.now() - r.a.first) / (7 * D)));
  // upgrade signals
  const ups = {}; rows.forEach((r) => Object.entries(r.a.fx).forEach(([k, v]) => { if (!k.startsWith('upsell:')) return; const x = ups[k.slice(7)] || (ups[k.slice(7)] = { fam: 0, n: 0 }); x.fam++; x.n += v.n; }));
  const plansSet = {}; rows.forEach((r) => { const p = r.f.plan || 'pro (default)'; plansSet[p] = (plansSet[p] || 0) + 1; });
  const dev = {}; rows.forEach((r) => r.a.devices.forEach((d) => (dev[d.ua || 'unknown'] = (dev[d.ua || 'unknown'] || 0) + 1)));
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
    <div><b>${totM ? pctOf(totG, totM) + '%' : '–'}</b><span>accuracy overall</span></div>
    <div><b>${money(usd)}</b><span>AI cost so far</span></div>
    <div><b>${costWeek.length ? money(avg(costWeek, (x) => x)) : '–'}</b><span>AI cost per family per week</span></div>
    <div><b>${rows.reduce((x, r) => x + r.a.errs.length, 0)}</b><span>errors seen</span></div>
    <div><b>${rows.filter((r) => r.a.last && Date.now() - r.a.last > 4 * D).length}</b><span>gone quiet (4+ days)</span></div>
  </div>
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
  <div class="pl-grid">
    ${card('Stars and rewards', kv([
      ['Families with stars on', st.filter((x) => x.on).length], ['Stars earned', st.reduce((x, y) => x + y.total, 0)], ['Rewards redeemed', st.reduce((x, y) => x + y.redeemed, 0)],
      ['Families with rewards set up', st.filter((x) => x.rewards).length], ['Parent PIN set', `${rows.filter((r) => r.a.pin).length} families`], ['Days someone hit the 10-star cap', st.reduce((x, y) => x + y.capDays, 0)],
      ['Questions in rushed sets', st.reduce((x, y) => x + y.rushedQ, 0)], ['Badges won', st.reduce((x, y) => x + y.badges, 0)]]) + `<h3 class="pl-h3">Where stars come from</h3>` + barList(Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => [WHY[k] || k, v])), 'Rushed sets and cap hits show children chasing stars rather than learning.')}
    ${card('AI cost', kv([['Total so far', money(usd)], ['AI requests', calls], ['Per family so far', started.length ? money(usd / started.length) : '–'], ['Per family per week', costWeek.length ? money(avg(costWeek, (x) => x)) : '–'], ['Most expensive family', rows.length ? (() => { const r = rows.slice().sort((a, b) => b.a.usage.usd - a.a.usage.usd)[0]; return r.a.usage.usd ? `${esc(r.f.name)} · ${money(r.a.usage.usd)}` : '–'; })() : '–']]) + `<h3 class="pl-h3">By feature</h3>` + barList(Object.entries(byPath).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => [k, v.usd, `${v.n} requests`]), money), 'From each device’s own record of AI use (US$). Use this to check plan prices cover the cost.')}
  </div>
  <div class="pl-grid">
    ${card('Upgrade signals', `${kv(Object.entries(plansSet).map(([k, v]) => [`Families on ${esc(k)}`, v]))}<h3 class="pl-h3">Plan limits hit</h3>${barList(Object.entries(ups).sort((a, b) => b[1].fam - a[1].fam).map(([k, v]) => [k, v.fam, `famil${v.fam === 1 ? 'y' : 'ies'} · ${v.n}×`]))}`, 'Put some families on Free or Plus (in the table below) to see which locked features they reach for.')}
    ${card('Devices and language', kv([...Object.entries(dev).map(([k, v]) => [`On a ${esc(k)}`, `${v} device${v === 1 ? '' : 's'}`]), ...Object.entries(lang).map(([k, v]) => [`Using ${k}`, `${v} famil${v === 1 ? 'y' : 'ies'}`])]))}
  </div>`;
}

function pilotCSV(rows) {
  const cols = ['Family', 'Code', 'Plan', 'Child', 'Started', 'Last active', 'Active days', 'Came back week 2', 'Questions', 'Accuracy %', 'Minutes', 'Questions 7d', 'Minutes 7d', 'Streak', 'Best streak', 'Sets', 'Rushed sets', 'Books', 'Subjects', 'Lessons', 'Essays', 'Speaking', 'Dictations', 'Mistakes open', 'Mistakes fixed', 'Stars earned', 'Rewards redeemed', 'Parent PIN', 'Parent views', 'AI requests', 'AI cost USD', 'Errors', 'Devices', 'Notes'];
  const d = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
  const lines = rows.map(({ f, a }) => [f.name, f.code, f.plan || 'pro', a.names.join(' / '), d(a.first), d(a.last), a.actDays, a.wk2 === null ? '' : a.wk2 ? 'yes' : 'no', a.tot.q, a.tot.acc ?? '', a.tot.min, a.w.q, a.w.min, a.streak, a.best,
    a.sess.filter((x) => !x.e).length, a.sess.filter((x) => x.r).length, a.books.length, [...new Set(a.books.map((b) => b.subject))].join(' / '), a.counts.learned || 0, a.counts.writing || 0, a.counts.speaking || 0, a.counts.dictation || 0,
    a.counts.mistakes || 0, a.counts.fixed || 0, a.stars ? a.stars.total : '', a.stars ? a.stars.redeemed : '', a.pin ? 'yes' : 'no', a.parentUse, a.usage.calls, a.usage.usd.toFixed(3), a.errs.length, a.devices.map((x) => x.ua).join(' / '), f.note || '']);
  const q = (v) => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return [cols, ...lines].map((r) => r.map(q).join(',')).join('\n');
}
async function renderPilot(note) {
  app.innerHTML = `<header><h1>Pilot families</h1><button class="btn ghost small" id="back">Back to library</button></header><div class="card"><p class="muted" style="margin:0">Loading…</p></div>`;
  $('back').onclick = () => renderLibrary();
  let P;
  try { P = await adminApi({ action: 'pilot' }); } catch (e) { app.querySelector('.card').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!P.on) {
    app.querySelector('.card').innerHTML = `<h2>Set up the pilot</h2><ol class="hint" style="font-size:14px;margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
      <li>On GitHub, create a new <b>private</b> repository, e.g. <code>prepbuddy-pilot</code>, with a README so it isn’t empty. Children’s activity is kept there, never in the public code repo.</li>
      <li>Edit the GitHub token used by Vercel (<code>GITHUB_TOKEN</code>) so it can also read and write that repo’s contents.</li>
      <li>In Vercel → Settings → Environment Variables, add <code>PILOT_REPO</code> = <code>your-account/prepbuddy-pilot</code>, then redeploy.</li>
      <li>Come back here and add your first family.</li></ol>`;
    return;
  }
  const fams = P.families || [];
  const known = new Set(fams.map((f) => f.code));
  Object.keys(P.activity || {}).forEach((c) => { if (!known.has(c)) fams.push({ code: c, name: '(not on the list)', created: 0 }); });
  const rows = fams.map((f) => ({ f, a: mergeFamily(P.activity[f.code] || []) })).sort((x, y) => (y.a.last || 0) - (x.a.last || 0));
  const ov = pilotOverview(rows, fams).split('\u0001');
  const fb = P.feedback || [];
  const famName = (code) => (fams.find((f) => f.code === code) || {}).name || code;
  app.innerHTML = `<header><h1>Pilot families</h1><button class="btn ghost small" id="back">Back to library</button></header>
  ${note ? `<div class="ok">${note}</div>` : ''}
  <div class="pl-acts"><button class="btn ghost small" id="csv">Download all stats (CSV)</button><button class="btn ghost small" id="reload">Refresh</button><span class="hint">Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
  ${ov[0]}
  <div class="card"><h2>Add a family</h2>
    <form id="addf" class="grid2"><label>Family name<input id="fname" required placeholder="e.g. Chan family (Ka Yan, S5)"></label><label>Notes (only you see these)<input id="fnote" placeholder="e.g. DSE Biology, joined via school"></label>
    <button class="btn" style="grid-column:1/-1" id="addgo">Make a family code</button></form><div id="newcode"></div></div>
  <div class="card"><h2>Families</h2>
    ${rows.length ? `<div class="pl-tablewrap"><table class="pl-table"><thead><tr><th>Family</th><th>Last active</th><th>Days active<br><small>last 14</small></th><th>Questions<br><small>7 days</small></th><th>Minutes<br><small>7 days</small></th><th>Score<br><small>7 days</small></th><th>Streak</th><th>AI cost</th><th>Books</th><th>Problems</th><th>Plan</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="pl-row ${r.a.last ? (Date.now() - r.a.last > 4 * 864e5 ? 'cold' : '') : 'never'}" data-fam="${i}"><td><b>${esc(r.f.name)}</b><small>${esc(r.f.code)}${r.a.names.length ? ' · ' + esc(r.a.names.join(', ')) : ''}${r.a.devices.length ? ` · ${r.a.devices.length} device${r.a.devices.length > 1 ? 's' : ''}` : ''}</small></td>
      <td>${r.a.last ? ago(r.a.last) : '<span class="tag">not started</span>'}</td><td>${r.a.w2.act}</td><td>${r.a.w.q}</td><td>${r.a.w.min}</td><td>${r.a.w.acc === null ? '–' : r.a.w.acc + '%'}</td><td>${r.a.streak ? r.a.streak + ' d' : '–'}</td><td>${r.a.usage.usd ? money(r.a.usage.usd) : '–'}</td><td>${r.a.books.length}</td><td>${r.a.errs.length ? `<span class="tag red">${r.a.errs.length}</span>` : '–'}</td><td><select class="pl-plan" data-code="${esc(r.f.code)}" aria-label="Plan for ${esc(r.f.name)}">${['', 'free', 'plus', 'pro'].map((p) => `<option value="${p}" ${(r.f.plan || '') === p ? 'selected' : ''}>${p ? p[0].toUpperCase() + p.slice(1) : 'Pro (default)'}</option>`).join('')}</select></td></tr>
      <tr class="pl-detail" id="fd${i}" hidden><td colspan="11">${famDetail(r, fb.filter((x) => x.code === r.f.code))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No families yet. Add one above.</p>'}
    <p class="hint" style="margin:0">Devices send a summary when the app opens, after each practice set and every 10 minutes while it’s open. Families idle for 4+ days are greyed.</p></div>
  <h2 class="pl-sec">Across all families</h2>
  ${ov[1]}
  <div class="card"><h2>Feedback (${fb.length})</h2>
    ${fb.length ? fb.map((x) => `<div class="pl-fb"><div><b>${esc(famName(x.code))}</b>${x.name ? ` · ${esc(x.name)}` : ''} <small>${ago(x.at)}</small></div><p>${esc(x.text)}</p></div>`).join('') : '<p class="muted" style="margin:0">No feedback yet. Families send it from Settings in the app.</p>'}</div>`;
  $('back').onclick = () => renderLibrary();
  $('reload').onclick = () => renderPilot();
  $('csv').onclick = () => { const blob = new Blob([pilotCSV(rows)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prepbuddy-pilot-${dayKey(Date.now())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  app.querySelectorAll('.pl-plan').forEach((sel) => { sel.onclick = (e) => e.stopPropagation(); sel.onchange = async () => {
    sel.disabled = true;
    try { await adminApi({ action: 'pilot_note', code: sel.dataset.code, plan: sel.value || null }); const f = fams.find((x) => x.code === sel.dataset.code); if (f) f.plan = sel.value || null; sel.insertAdjacentHTML('afterend', '<small class="pl-saved">Saved. Applies next time they open the app.</small>'); }
    catch (err) { alert('Couldn’t change the plan: ' + err.message); }
    sel.disabled = false;
  }; });
  app.querySelectorAll('[data-fam]').forEach((tr) => (tr.onclick = () => { const d = $('fd' + tr.dataset.fam); d.hidden = !d.hidden; tr.classList.toggle('open', !d.hidden); }));
  $('addf').onsubmit = async (e) => {
    e.preventDefault(); const btn = $('addgo'); btn.disabled = true;
    try {
      const r = await adminApi({ action: 'pilot_add', name: $('fname').value, note: $('fnote').value });
      const msg = `Hi! Thanks for trying PrepBuddy. Open ${location.origin} on your child’s phone or computer and enter this family code: ${r.family.code}\nAny feedback is welcome: there’s a box for it in Settings.`;
      $('newcode').innerHTML = `<div class="ok">Code for ${esc(r.family.name)}: <b style="font-size:18px;letter-spacing:.05em">${esc(r.family.code)}</b></div>
        <label>Message to send them<textarea id="invite" rows="3">${esc(msg)}</textarea></label><div class="acts"><button class="link" id="copyinv">Copy message</button><button class="link" id="refresh">Done: refresh the list</button></div>`;
      $('copyinv').onclick = () => { navigator.clipboard.writeText($('invite').value); $('copyinv').textContent = 'Copied'; };
      $('refresh').onclick = () => renderPilot();
      $('fname').value = ''; $('fnote').value = '';
    } catch (err) { $('newcode').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    btn.disabled = false;
  };
}
function famDetail(r, fb) {
  const a = r.a, t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 21 }, (_, i) => { const t = t0.getTime() - (20 - i) * 864e5; return { t, x: a.days[dayKey(t)] }; });
  const max = Math.max(10, ...days.map((d) => (d.x ? d.x.min : 0)));
  const fx = Object.entries(a.fx).filter(([k]) => !k.startsWith('screen:')).sort((x, y) => y[1].n - x[1].n);
  const scr = Object.entries(a.fx).filter(([k]) => k.startsWith('screen:')).sort((x, y) => y[1].n - x[1].n).slice(0, 10);
  return `<div class="fd">
    <div><h3>Minutes each day (last 3 weeks)</h3><div class="fd-bars">${days.map((d) => `<span title="${dayKey(d.t)}: ${d.x ? `${d.x.min} min, ${d.x.q} questions` : 'none'}"><i style="height:${d.x ? Math.max(4, Math.round(70 * d.x.min / max)) : 2}px" class="${d.x ? '' : 'none'}"></i></span>`).join('')}</div>
      <p class="hint" style="margin:6px 0 0">${a.first ? `Started ${new Date(a.first).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. ` : ''}Plan seen: ${esc(a.plans.join(', ') || '–')}. Devices: ${a.devices.map((d) => `${esc(d.ua || 'device')} (synced ${ago(d.synced)})`).join(', ') || '–'}.</p>
      ${r.f.note ? `<p class="hint" style="margin:6px 0 0"><b>Notes:</b> ${esc(r.f.note)}</p>` : ''}</div>
    <div><h3>Books</h3>${a.books.length ? a.books.map((b) => `<div class="fd-row"><span>${esc(b.title)} <small>${esc(b.subject)} ${esc(b.level)}</small></span><b>${b.pct === null ? '–' : b.pct + '%'}</b></div>`).join('') : '<p class="muted">None added yet.</p>'}
      <h3 style="margin-top:12px">Totals</h3><p class="hint" style="margin:0">Mistakes open ${a.counts.mistakes || 0} · lessons ${a.counts.learned || 0} · tests ${a.counts.tests || 0} · school tests ${a.counts.schoolTests || 0} · homework ${a.counts.homework || 0} · essays marked ${a.counts.writing || 0} · speaking ${a.counts.speaking || 0}</p></div>
    <div><h3>Features used</h3>${fx.length ? fx.map(([k, v]) => `<div class="fd-row"><span>${esc(fname(k))}</span><b>${v.n}× <small>${ago(v.last)}</small></b></div>`).join('') : '<p class="muted">Nothing yet.</p>'}</div>
    <div><h3>Screens visited</h3>${scr.map(([k, v]) => `<div class="fd-row"><span>${esc(k.slice(7))}</span><b>${v.n}</b></div>`).join('') || '<p class="muted">–</p>'}
      ${a.errs.length ? `<h3 style="margin-top:12px">Problems seen</h3>${a.errs.map((e) => `<div class="fd-err">${esc(e.m)} <small>${esc(e.v || '')} · ${ago(e.t)}</small></div>`).join('')}` : ''}
      ${fb.length ? `<h3 style="margin-top:12px">Their feedback</h3>${fb.map((x) => `<p class="fd-fb">“${esc(x.text)}” <small>${ago(x.at)}</small></p>`).join('')}` : ''}</div>
    <div><h3>Summary</h3>
      <div class="fd-row"><span>Active days</span><b>${a.actDays}${a.wk2 === null ? '' : a.wk2 ? ' · came back in week 2' : ' · didn’t come back in week 2'}</b></div>
      <div class="fd-row"><span>All time</span><b>${a.tot.q} questions · ${a.tot.min} min · ${a.tot.acc === null ? '–' : a.tot.acc + '%'}</b></div>
      <div class="fd-row"><span>This week vs last</span><b>${a.w.q} vs ${a.pw.q} questions · ${a.w.min} vs ${a.pw.min} min</b></div>
      <div class="fd-row"><span>Streak</span><b>${a.streak} days now · best ${a.best}</b></div>
      <div class="fd-row"><span>Weekly goal</span><b>${a.goal ? `${a.goal.days} days × ${a.goal.mins} min` : 'not set'}</b></div>
      <div class="fd-row"><span>Parent</span><b>${a.pin ? 'PIN set' : 'no PIN yet'} · ${a.parentUse} dashboard/report views</b></div>
      ${a.stars ? `<div class="fd-row"><span>Stars</span><b>${a.stars.total} earned · ${a.stars.bal} unspent · ${a.stars.redeemed} rewards redeemed</b></div>
      <div class="fd-row"><span>Star warnings</span><b>${a.stars.rushedQ} questions in rushed sets · hit the daily cap ${a.stars.capDays}×</b></div>` : ''}
      <div class="fd-row"><span>AI use</span><b>${a.usage.calls} requests · ${money(a.usage.usd)}</b></div>
      ${Object.keys(a.modes).length ? `<h3 style="margin-top:12px">How they practise</h3>${Object.entries(a.modes).sort((x, y) => y[1].q - x[1].q).map(([k, v]) => `<div class="fd-row"><span>${esc(MODE_NAMES[k] || k)}</span><b>${v.q} <small>${v.m ? pctOf(v.g, v.m) + '% right' : ''}</small></b></div>`).join('')}` : ''}</div>
    <div><h3>When they study</h3>${colBars(a.hours, a.hours.map((_, i) => (i % 3 === 0 ? String(i) : '')), (i, v) => `${i}:00: ${v} questions`)}
      <h3 style="margin-top:12px">Recent sets</h3>${a.sess.length ? a.sess.slice(-8).reverse().map((x) => `<div class="fd-row"><span>${esc(MODE_NAMES[x.k] || x.k || 'Practice')} <small>${new Date(x.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${x.n} q · ${x.min} min${x.r ? ' · <span class="tag red">rushed</span>' : ''}${x.e ? ' · left early' : ''}</small></span><b>${x.p}%</b></div>`).join('') : '<p class="muted">None yet.</p>'}</div>
  </div>`;
}

/* ---------- questions students reported ---------- */
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
  app.innerHTML = `<header><h1>Add a textbook</h1><button class="btn ghost small" id="back">Back to library</button></header>${steps(0)}
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
    for (let t = 1; t <= 2 && !gen; t++) { try { gen = await aiApi('generate', { title: u.title, text: u.text, items: STARTER, kind: entry.kind, lang }); } catch (e) { if (t === 2) return; } }
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

if (pw) adminApi({ action: 'check' }).then(() => renderLibrary()).catch(() => { pw = ''; renderLogin(); });
else renderLogin();
