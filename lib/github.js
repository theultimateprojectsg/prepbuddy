// Small GitHub helper shared by the admin page and question reports.
// Uses GITHUB_TOKEN (fine-grained, Contents: read & write on this repo).
const REPO = () => process.env.GITHUB_REPO || 'theultimateprojectsg/prepbuddy';
const BRANCH = () => process.env.GITHUB_BRANCH || 'main';
// Reports live on their own branch so they never redeploy the site (vercel.json turns deploys off for it).
const REPORTS_BRANCH = 'reports';
// With the pilot on, reports (which can include a student's answer and note) go to the PRIVATE pilot repo,
// never to the public code repo.
const RREPO = () => process.env.PILOT_REPO || REPO();

function err(status, message) { const e = new Error(message); e.status = status; return e; }

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw err(500, 'GITHUB_TOKEN is not set in Vercel.');
  const r = await fetch(`https://api.github.com/repos/${opts.repo || REPO()}${path}`, {
    method: opts.method || 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'prepbuddy' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  if (!r.ok) { const e = err(502, `GitHub ${r.status}: ${(data && data.message) || text.slice(0, 200)}`); e.gh = r.status; throw e; }
  return data;
}

async function ensureReportsBranch() {
  try { await gh(`/git/ref/heads/${REPORTS_BRANCH}`, { repo: RREPO() }); return; } catch (e) { if (e.gh !== 404) throw e; }
  const main = await gh(`/git/ref/heads/${BRANCH()}`, { repo: RREPO() });
  try { await gh('/git/refs', { repo: RREPO(), method: 'POST', body: { ref: `refs/heads/${REPORTS_BRANCH}`, sha: main.object.sha } }); } catch (e) { if (e.gh !== 422) throw e; } // 422: someone made it just now
}

// Every report is its own small file, so two reports at once never clash.
async function saveReport(report) {
  await ensureReportsBranch();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `reports/${stamp}-${Math.random().toString(36).slice(2, 8)}.json`;
  await gh(`/contents/${path}`, { repo: RREPO(), method: 'PUT', body: { message: `Report: ${report.reason}`, branch: REPORTS_BRANCH, content: Buffer.from(JSON.stringify(report, null, 1)).toString('base64') } });
  return path;
}

async function listReports(limit = 100) {
  let tree;
  try { tree = await gh(`/git/trees/${REPORTS_BRANCH}?recursive=1`, { repo: RREPO() }); } catch (e) { if (e.gh === 404) return { reports: [], stats: { right: 0, fine: 0, reasons: {} } }; throw e; }
  const files = (tree.tree || []).filter((t) => t.type === 'blob' && /^reports\/[^/]+\.json$/.test(t.path)).sort((a, b) => b.path.localeCompare(a.path)).slice(0, limit);
  const out = [];
  for (let i = 0; i < files.length; i += 8) {
    const part = await Promise.all(files.slice(i, i + 8).map(async (f) => {
      try { const b = await gh(`/git/blobs/${f.sha}`, { repo: RREPO() }); return { path: f.path, sha: f.sha, ...JSON.parse(Buffer.from(b.content, 'base64').toString('utf8')) }; } catch (e) { return null; }
    }));
    out.push(...part.filter(Boolean));
  }
  // checked reports are kept under reports/done/<verdict>-<reason>-<name>, so the totals come from file names alone
  const stats = { right: 0, fine: 0, reasons: {} };
  for (const t of tree.tree || []) {
    const m = t.type === 'blob' && t.path.match(/^reports\/done\/(right|fine)-([a-z_]+)-/);
    if (!m) continue;
    stats[m[1]]++;
    if (m[1] === 'right') stats.reasons[m[2]] = (stats.reasons[m[2]] || 0) + 1;
  }
  return { reports: out, stats };
}

// verdict: 'right' (the student was right, the question was bad) or 'fine' (the question is OK).
// The report is kept under reports/done/ with the verdict in its name, for the totals.
async function resolveReport(path, sha, verdict) {
  if (!/^reports\/[\w.-]+\.json$/.test(String(path || ''))) throw err(400, 'Bad report.');
  if (!['right', 'fine'].includes(verdict)) throw err(400, 'Bad verdict.');
  const blob = await gh(`/git/blobs/${sha}`, { repo: RREPO() });
  let reason = 'other'; try { reason = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')).reason || 'other'; } catch (e) {}
  const name = path.slice('reports/'.length);
  const report = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8') || '{}');
  report.verdict = verdict; report.checkedAt = Date.now();
  await gh(`/contents/reports/done/${verdict}-${String(reason).replace(/[^a-z_]/g, '')}-${name}`, { repo: RREPO(), method: 'PUT', body: { message: `Report checked: ${verdict}`, branch: REPORTS_BRANCH, content: Buffer.from(JSON.stringify(report, null, 1)).toString('base64') } });
  await gh(`/contents/${path}`, { repo: RREPO(), method: 'DELETE', body: { message: 'Report checked', sha, branch: REPORTS_BRANCH } });
}

module.exports = { gh, err, REPO, BRANCH, saveReport, listReports, resolveReport };
