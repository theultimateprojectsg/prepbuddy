// POST /api/admin   — the admin page publishes library books here. Files are saved to the GitHub repo
// in ONE commit, and Vercel then redeploys the site with the book in the library.
// Vercel environment variables: ADMIN_PASSWORD, GITHUB_TOKEN (fine-grained, Contents: read & write on this repo),
// optional GITHUB_REPO (default theultimateprojectsg/prepbuddy) and GITHUB_BRANCH (default main).
//
// actions:
//   { action: 'check' }                                  -> { ok, github }
//   { action: 'blob', content (base64) }                 -> { sha }      one file at a time (keeps requests small)
//   { action: 'publish', entry, files: [{ path, sha }] } -> { ok, commit } adds/replaces the book in library/catalog.json
//   { action: 'update', id, changes }                    -> { ok, commit } edits a book's details in the catalog
//   { action: 'bank', id, sha, count }                  -> { ok, commit } publishes a book's starter question bank (questions.json)
//   { action: 'remove', id }                             -> { ok, commit } takes a book out of the library (and deletes its files)
//   { action: 'reports' }                                -> { reports, stats } questions students flagged (newest first) + totals of checked ones
//   { action: 'resolve', path, sha, verdict }            -> { ok }        'right' (question was bad) or 'fine'; moves it to reports/done/

const REPO = () => process.env.GITHUB_REPO || 'theultimateprojectsg/prepbuddy';
const BRANCH = () => process.env.GITHUB_BRANCH || 'main';
const CATALOG = 'library/catalog.json';
const { listReports, resolveReport } = require('../lib/github');

function err(status, message) { const e = new Error(message); e.status = status; return e; }

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw err(500, 'GITHUB_TOKEN is not set in Vercel.');
  const r = await fetch(`https://api.github.com/repos/${REPO()}${path}`, {
    method: opts.method || 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'prepbuddy-admin' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw err(502, `GitHub ${r.status}: ${(data && data.message) || text.slice(0, 200)}`);
  return data;
}

// Read the current catalog, change it, and commit the change together with any new/deleted files.
async function commitWith({ change, files = [], deletePrefix = null, message }) {
  const ref = await gh(`/git/ref/heads/${BRANCH()}`);
  const head = ref.object.sha;
  const commit = await gh(`/git/commits/${head}`);
  const baseTree = commit.tree.sha;
  const cur = await gh(`/contents/${CATALOG}?ref=${head}`);
  const catalog = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
  const next = change(catalog);
  const catBlob = await gh('/git/blobs', { method: 'POST', body: { content: JSON.stringify(next, null, 1) + '\n', encoding: 'utf-8' } });
  const tree = [{ path: CATALOG, mode: '100644', type: 'blob', sha: catBlob.sha }, ...files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha }))];
  if (deletePrefix) {
    const all = await gh(`/git/trees/${baseTree}?recursive=1`);
    for (const t of all.tree || []) if (t.type === 'blob' && t.path.startsWith(deletePrefix)) tree.push({ path: t.path, mode: '100644', type: 'blob', sha: null });
  }
  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree } });
  const newCommit = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } });
  await gh(`/git/refs/heads/${BRANCH()}`, { method: 'PATCH', body: { sha: newCommit.sha } });
  return newCommit.sha;
}

const safeId = (s) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(String(s || ''));

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw err(405, 'Use POST.');
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) throw err(500, 'ADMIN_PASSWORD is not set in Vercel.');
    if ((req.headers['x-admin-password'] || '') !== pw) throw err(401, 'Wrong admin password.');
    let body = req.body;
    if (!body || typeof body !== 'object') { const chunks = []; for await (const c of req) chunks.push(c); body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    let out;
    if (body.action === 'check') out = { ok: true, github: !!process.env.GITHUB_TOKEN, repo: REPO() };
    else if (body.action === 'blob') {
      if (typeof body.content !== 'string' || !body.content) throw err(400, 'No file content.');
      const b = await gh('/git/blobs', { method: 'POST', body: { content: body.content, encoding: 'base64' } });
      out = { sha: b.sha };
    } else if (body.action === 'publish') {
      const e = body.entry || {};
      if (!safeId(e.id) || !e.title || !Array.isArray(e.units) || !e.units.length) throw err(400, 'The book details are incomplete.');
      const files = (body.files || []).filter((f) => f && typeof f.sha === 'string' && String(f.path || '').startsWith(`library/${e.id}/`));
      const commit = await commitWith({
        files, message: `Library: publish "${String(e.title).slice(0, 60)}" (${e.code || e.id})`,
        change: (cat) => { const list = cat.filter((x) => x.id !== e.id); list.push(e); return list; },
      });
      out = { ok: true, commit };
    } else if (body.action === 'update') {
      if (!safeId(body.id)) throw err(400, 'Bad book id.');
      const allowed = ['title', 'subject', 'level', 'publisher', 'licence', 'credit', 'kind', 'units'];
      const commit = await commitWith({
        message: `Library: update details of ${body.id}`,
        change: (cat) => cat.map((x) => { if (x.id !== body.id) return x; const y = { ...x }; for (const k of allowed) if (body.changes && k in body.changes) y[k] = body.changes[k]; return y; }),
      });
      out = { ok: true, commit };
    } else if (body.action === 'bank') {
      // a book's starter question bank: commit library/<id>/questions.json and record the count in the catalog
      if (!safeId(body.id) || typeof body.sha !== 'string') throw err(400, 'Bad question bank.');
      const n = Math.max(0, Math.round(Number(body.count) || 0));
      const commit = await commitWith({ files: [{ path: `library/${body.id}/questions.json`, sha: body.sha }], message: `Library: ${n} starter questions for ${body.id}`,
        change: (cat) => cat.map((x) => (x.id === body.id ? { ...x, questionCount: n } : x)) });
      out = { ok: true, commit };
    } else if (body.action === 'pilot') {
      const P = require('../lib/pilot');
      out = P.pilotOn() ? { on: true, ...(await P.overview()) } : { on: false };
    } else if (body.action === 'pilot_add') {
      const P = require('../lib/pilot');
      if (!P.pilotOn()) throw err(400, 'Set PILOT_REPO in Vercel first.');
      const name = String(body.name || '').trim().slice(0, 60); if (!name) throw err(400, 'Give the family a name.');
      const fam = { code: P.makeCode(name), name, note: String(body.note || '').trim().slice(0, 300), created: Date.now() };
      await P.writeFile('families.json', (cur) => [...(cur || []), fam], `Pilot: add ${fam.code}`);
      out = { ok: true, family: fam };
    } else if (body.action === 'pilot_note') {
      const P = require('../lib/pilot');
      await P.writeFile('families.json', (cur) => (cur || []).map((f) => (f.code === body.code ? { ...f, ...(body.note !== undefined ? { note: String(body.note || '').slice(0, 300) } : {}), ...(body.off !== undefined ? { off: !!body.off } : {}), ...(body.plan !== undefined ? { plan: ['free', 'plus', 'pro'].includes(body.plan) ? body.plan : null } : {}) } : f)), `Pilot: update ${body.code}`);
      out = { ok: true };
    } else if (body.action === 'remove') {
      if (!safeId(body.id)) throw err(400, 'Bad book id.');
      const commit = await commitWith({ message: `Library: remove ${body.id}`, deletePrefix: `library/${body.id}/`, change: (cat) => cat.filter((x) => x.id !== body.id) });
      out = { ok: true, commit };
    } else if (body.action === 'reports') {
      out = await listReports(100);
    } else if (body.action === 'resolve') {
      await resolveReport(body.path, body.sha, body.verdict);
      out = { ok: true };
    } else throw err(400, 'Unknown action.');
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = e.status || 500; res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
