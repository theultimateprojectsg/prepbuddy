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
  for (const s of snaps) {
    devices.push({ device: s.device, ua: s.ua, synced: s.synced, last: s.last });
    if (s.name) names.add(s.name); if (s.plan) plans.add(s.plan);
    last = Math.max(last, s.last || 0); if (s.first) first = first ? Math.min(first, s.first) : s.first;
    for (const d of s.days || []) { const x = days[d.d] || (days[d.d] = { q: 0, g: 0, m: 0, min: 0 }); x.q += d.q; x.g += d.g; x.m += d.m; x.min += d.min; }
    for (const [k, v] of Object.entries(s.fx || {})) { const x = fx[k] || (fx[k] = { n: 0, last: 0 }); x.n += v.n; x.last = Math.max(x.last, v.last || 0); }
    for (const b of s.books || []) books.set(b.title, b);
    errs = errs.concat((s.errs || []).map((e) => ({ ...e, device: s.device })));
    for (const [k, v] of Object.entries(s.counts || {})) if (typeof v === 'number') counts[k] = (counts[k] || 0) + v;
  }
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const sum = (n) => { let q = 0, g = 0, m = 0, min = 0, act = 0; for (let i = 0; i < n; i++) { const x = days[dayKey(t0.getTime() - i * 864e5)]; if (x) { q += x.q; g += x.g; m += x.m; min += x.min; act++; } } return { q, acc: m ? Math.round(100 * g / m) : null, min, act }; };
  return { days, fx, books: [...books.values()], last, first, errs: errs.sort((a, b) => b.t - a.t).slice(0, 12), counts, names: [...names], plans: [...plans], devices, w: sum(7), w2: sum(14) };
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
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const activeToday = rows.filter((r) => r.a.last >= t0.getTime()).length, active7 = rows.filter((r) => r.a.w.act > 0).length;
  const q7 = rows.reduce((x, r) => x + r.a.w.q, 0), min7 = rows.reduce((x, r) => x + r.a.w.min, 0);
  // features across families: how many families used each, and how often
  const feat = {};
  rows.forEach((r) => Object.entries(r.a.fx).forEach(([k, v]) => { if (k.startsWith('screen:')) return; const x = feat[k] || (feat[k] = { fam: 0, n: 0 }); x.fam++; x.n += v.n; }));
  const featList = Object.entries(feat).sort((a, b) => b[1].fam - a[1].fam || b[1].n - a[1].n);
  const unused = Object.keys(FEATURE_NAMES).filter((k) => !feat[k]);
  const maxF = Math.max(1, ...featList.map(([, v]) => v.fam));
  const fb = P.feedback || [];
  const famName = (code) => (fams.find((f) => f.code === code) || {}).name || code;
  app.innerHTML = `<header><h1>Pilot families</h1><button class="btn ghost small" id="back">Back to library</button></header>
  ${note ? `<div class="ok">${note}</div>` : ''}
  <div class="pl-tiles">
    <div><b>${fams.length}</b><span>families</span></div><div><b>${activeToday}</b><span>active today</span></div><div><b>${active7}</b><span>active this week</span></div>
    <div><b>${q7}</b><span>questions this week</span></div><div><b>${min7}</b><span>minutes this week</span></div><div><b>${fb.length}</b><span>feedback messages</span></div>
  </div>
  <div class="card"><h2>Add a family</h2>
    <form id="addf" class="grid2"><label>Family name<input id="fname" required placeholder="e.g. Chan family (Ka Yan, S5)"></label><label>Notes (only you see these)<input id="fnote" placeholder="e.g. DSE Biology, joined via school"></label>
    <button class="btn" style="grid-column:1/-1" id="addgo">Make a family code</button></form><div id="newcode"></div></div>
  <div class="card"><h2>Families</h2>
    ${rows.length ? `<div class="pl-tablewrap"><table class="pl-table"><thead><tr><th>Family</th><th>Last active</th><th>Days active<br><small>last 14</small></th><th>Questions<br><small>7 days</small></th><th>Minutes<br><small>7 days</small></th><th>Score<br><small>7 days</small></th><th>Books</th><th>Problems</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="pl-row ${r.a.last ? (Date.now() - r.a.last > 4 * 864e5 ? 'cold' : '') : 'never'}" data-fam="${i}"><td><b>${esc(r.f.name)}</b><small>${esc(r.f.code)}${r.a.names.length ? ' · ' + esc(r.a.names.join(', ')) : ''}${r.a.devices.length ? ` · ${r.a.devices.length} device${r.a.devices.length > 1 ? 's' : ''}` : ''}</small></td>
      <td>${r.a.last ? ago(r.a.last) : '<span class="tag">not started</span>'}</td><td>${r.a.w2.act}</td><td>${r.a.w.q}</td><td>${r.a.w.min}</td><td>${r.a.w.acc === null ? '–' : r.a.w.acc + '%'}</td><td>${r.a.books.length}</td><td>${r.a.errs.length ? `<span class="tag red">${r.a.errs.length}</span>` : '–'}</td></tr>
      <tr class="pl-detail" id="fd${i}" hidden><td colspan="8">${famDetail(r, fb.filter((x) => x.code === r.f.code))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No families yet. Add one above.</p>'}
    <p class="hint" style="margin:0">Devices send a summary when the app opens, after each practice set and every 10 minutes while it’s open. Families idle for 4+ days are greyed.</p></div>
  <div class="card"><h2>What’s being used</h2>
    ${featList.length ? `<div class="pl-feats">${featList.map(([k, v]) => `<div><span>${esc(fname(k))}</span><i style="width:${Math.round(100 * v.fam / maxF)}%"></i><b>${v.fam} famil${v.fam === 1 ? 'y' : 'ies'} · ${v.n}×</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">Nothing yet.</p>'}
    ${unused.length && rows.some((r) => r.a.last) ? `<p class="hint" style="margin:0"><b>Not used by anyone yet:</b> ${unused.map(fname).join(' · ')}</p>` : ''}</div>
  <div class="card"><h2>Feedback (${fb.length})</h2>
    ${fb.length ? fb.map((x) => `<div class="pl-fb"><div><b>${esc(famName(x.code))}</b>${x.name ? ` · ${esc(x.name)}` : ''} <small>${ago(x.at)}</small></div><p>${esc(x.text)}</p></div>`).join('') : '<p class="muted" style="margin:0">No feedback yet. Families send it from Settings in the app.</p>'}</div>`;
  $('back').onclick = () => renderLibrary();
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
