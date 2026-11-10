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
  app.innerHTML = `<header><h1>PrepBuddy admin</h1></header>
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
  <div class="card" id="reports"><h2>Reported questions</h2><p class="muted" style="margin:0">Loading…</p></div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Books in the library (${cat.length})</h2><button class="btn" id="add">Add a textbook</button></div>
    <div>${cat.map((b) => `<div class="row" data-id="${esc(b.id)}"><div class="meta"><b>${esc(b.title)}</b><span>${esc(b.subject || '')}${b.level ? ' · ' + esc(b.level) : ''} · ${b.units.length} chapters · code ${esc(b.code)}</span></div>
      <div class="acts"><button class="link" data-edit="${esc(b.id)}">Edit details</button><button class="link red" data-remove="${esc(b.id)}">Remove</button></div></div>`).join('') || '<p class="muted">No books yet.</p>'}</div>
  </div>
  <p class="hint">Changes go live in about 1–2 minutes, while Vercel updates the site. Students who already added a book keep their copy.</p>
  <button class="btn ghost small" id="out" style="align-self:flex-start">Sign out</button>`;
  loadReports();
  $('add').onclick = () => renderUpload();
  $('out').onclick = () => { sessionStorage.removeItem(PW_KEY); pw = ''; renderLogin(); };
  app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => renderDetails(cat.find((x) => x.id === b.dataset.edit), cat)));
  app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    const book = cat.find((x) => x.id === b.dataset.remove);
    if (!confirm(`Remove “${book.title}” from the library? Students who already added it keep their copy; nobody new can add it.`)) return;
    b.disabled = true; b.textContent = 'Removing…';
    try { await adminApi({ action: 'remove', id: book.id }); renderLibrary(`Removed “${book.title}”. The library updates in about 1–2 minutes.`); }
    catch (err) { alert(err.message); b.disabled = false; b.textContent = 'Remove'; }
  }));
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
  const b = existing || {};
  const defTitle = b.title || (d && (d.title && d.title.length > 3 && !/^untitled|microsoft word/i.test(d.title) ? d.title : d.fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ')));
  app.innerHTML = `<header><h1>${existing ? 'Edit book details' : 'Book details'}</h1><button class="btn ghost small" id="back">${existing ? 'Back to library' : 'Back to chapters'}</button></header>${existing ? '' : steps(2)}
  <form class="card" id="f">
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
      await publish(details, val('code'));
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
  draft = null;
  renderLibrary(`Published “${details.title}” with book code ${code}. It will appear in the library in about 1–2 minutes, while Vercel updates the site.`);
}

if (pw) adminApi({ action: 'check' }).then(() => renderLibrary()).catch(() => { pw = ''; renderLogin(); });
else renderLogin();
