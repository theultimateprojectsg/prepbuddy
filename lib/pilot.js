// Pilot families: one code per family, and each device's activity, kept in a PRIVATE GitHub repo (PILOT_REPO),
// never in the public code repo. Codes are signed (HMAC), so checking one needs no storage:
//   CHAN27-K4QF9X = a label from the family's name + 2 digits, then a 6-character signature.
// Vercel env: PILOT_REPO (e.g. theultimateprojectsg/prepbuddy-pilot, private), GITHUB_TOKEN with Contents read & write
// on it, optional PILOT_SECRET (defaults to ADMIN_PASSWORD), optional PILOT_BLOCK (comma-separated codes to switch off).
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const secret = () => process.env.PILOT_SECRET || process.env.ADMIN_PASSWORD || '';
const pilotOn = () => !!process.env.PILOT_REPO;
function sign(label) {
  const h = crypto.createHmac('sha256', secret()).update(String(label)).digest();
  return Array.from(h.subarray(0, 6), (b) => ALPHA[b % ALPHA.length]).join('');
}
function makeCode(name) {
  const base = String(name || '').normalize('NFKD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'FAMILY';
  const label = base + String(10 + crypto.randomInt(90));
  return `${label}-${sign(label)}`;
}
function validCode(code) {
  const c = String(code || '').trim().toUpperCase();
  const m = c.match(/^([A-Z]{1,6}\d{2})-([A-Z0-9]{6})$/);
  if (!m || !secret()) return null;
  const blocked = String(process.env.PILOT_BLOCK || '').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (blocked.includes(c)) return null;
  const want = sign(m[1]);
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2])) ? c : null;
}

function err(status, message) { const e = new Error(message); e.status = status; return e; }
async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw err(500, 'GITHUB_TOKEN is not set in Vercel.');
  if (!pilotOn()) throw err(500, 'PILOT_REPO is not set in Vercel.');
  const r = await fetch(`https://api.github.com/repos/${process.env.PILOT_REPO}${path}`, {
    method: opts.method || 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'prepbuddy-pilot' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  if (!r.ok) { const e = err(502, `GitHub ${r.status}: ${(data && data.message) || text.slice(0, 200)}`); e.gh = r.status; throw e; }
  return data;
}
const enc = (o) => Buffer.from(JSON.stringify(o, null, 1)).toString('base64');
const dec = (b) => JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
async function readFile(path) {
  try { const f = await gh(`/contents/${path}`); return { sha: f.sha, data: dec(f.content) }; } catch (e) { if (e.gh === 404) return { sha: null, data: null }; throw e; }
}
// Write a file, retrying once if it changed underneath us.
async function writeFile(path, data, message) {
  for (let t = 0; t < 2; t++) {
    const cur = await readFile(path);
    try { await gh(`/contents/${path}`, { method: 'PUT', body: { message, content: enc(typeof data === 'function' ? data(cur.data) : data), ...(cur.sha ? { sha: cur.sha } : {}) } }); return; }
    catch (e) { if (e.gh !== 409 && e.gh !== 422) throw e; }
  }
}
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

async function listDir(path) {
  try { return await gh(`/contents/${path}`); } catch (e) { if (e.gh === 404) return []; throw e; }
}
// Everything the admin page shows.
async function overview() {
  const fam = (await readFile('families.json')).data || [];
  const codes = (await listDir('activity')).filter((d) => d.type === 'dir').map((d) => d.name);
  const activity = {};
  await Promise.all(codes.map(async (code) => {
    const files = (await listDir(`activity/${code}`)).filter((f) => f.type === 'file');
    activity[code] = (await Promise.all(files.map(async (f) => { try { return (await readFile(f.path)).data; } catch (e) { return null; } }))).filter(Boolean);
  }));
  const fb = (await listDir('feedback')).filter((f) => f.type === 'file').sort((a, b) => b.name.localeCompare(a.name)).slice(0, 60);
  const feedback = (await Promise.all(fb.map(async (f) => { try { return (await readFile(f.path)).data; } catch (e) { return null; } }))).filter(Boolean);
  return { families: fam, activity, feedback };
}

async function deleteFile(path, message) {
  const cur = await readFile(path); if (!cur.sha) return;
  await gh(`/contents/${path}`, { method: 'DELETE', body: { message, sha: cur.sha } });
}
// Remove a family: drop it from the list, delete its activity and feedback, and switch its code off for good.
async function removeFamily(code) {
  const c = String(code || '').toUpperCase();
  await writeFile('families.json', (cur) => (cur || []).filter((f) => f.code !== c), `Pilot: remove ${c}`);
  await writeFile('removed.json', (cur) => [...new Set([...(cur || []), c])], `Pilot: switch off ${c}`);
  const files = (await listDir(`activity/${safe(c)}`)).filter((f) => f.type === 'file');
  for (const f of files) await deleteFile(f.path, `Pilot: delete activity ${c}`);
  const fb = (await listDir('feedback')).filter((f) => f.type === 'file' && f.name.endsWith(`-${c}.json`));
  for (const f of fb) await deleteFile(f.path, `Pilot: delete feedback ${c}`);
}
// Codes the admin removed (cached for a minute per server instance).
let removedCache = { t: 0, list: [] };
async function isRemoved(code) {
  if (Date.now() - removedCache.t > 60000) { try { removedCache = { t: Date.now(), list: (await readFile('removed.json')).data || [] }; } catch (e) { removedCache.t = Date.now(); } }
  return removedCache.list.includes(code);
}

// Synchronous check for the AI endpoints: uses the cached list and refreshes it in the background.
function removedNow(code) { if (Date.now() - removedCache.t > 60000) isRemoved(code).catch(() => {}); return removedCache.list.includes(code); }

module.exports = { pilotOn, makeCode, validCode, readFile, writeFile, listDir, overview, safe, err, removeFamily, isRemoved, removedNow };
