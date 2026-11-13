// Daily AI spending cap, enforced on the server.
//
// The plan limits in the app only stop honest use: anyone with a family code could call the API directly.
// So the server keeps its own count of what each family code costs in AI each day (Hong Kong time) and
// refuses new AI work once a family passes its daily cap, or once everyone together passes the overall cap.
//
// Where the count lives: the private pilot repo, one small file per server instance per day
// (spend/<day>/<instance>.json = { by: { CODE: usd } }). One file per instance means instances never
// overwrite each other; the totals are the sum of the day's files. Each instance re-reads the files at
// most every 90 seconds (only the ones that changed) and saves its own file at most every 2 minutes,
// so the count can lag a little: the caps are a safety net, not exact billing.
//
// Caps (Vercel environment variables, in US$):
//   FAMILY_DAILY_USD  per family code per day   (default 3: a very heavy day is about US$2.40)
//   DAILY_USD_CAP     all families together      (default 40)
// Without PILOT_REPO nothing is counted (local testing, or the app opened with the shared access code only).
const { AsyncLocalStorage } = require('async_hooks');
const pilot = require('./pilot');

const als = new AsyncLocalStorage();
const INST = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const hkDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const familyCap = () => Number(process.env.FAMILY_DAILY_USD) || 3;
const totalCap = () => Number(process.env.DAILY_USD_CAP) || 40;

let mine = { day: hkDay(), by: {}, saved: 0, savedAt: 0 };   // this instance's spend today
let others = { day: '', t: 0, files: {}, by: {}, all: 0 };   // every other instance's files today
function roll() {
  const d = hkDay();
  if (mine.day !== d) mine = { day: d, by: {}, saved: 0, savedAt: 0 };
  if (others.day !== d) others = { day: d, t: 0, files: {}, by: {}, all: 0 };
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Called by checkAccess once it knows who is asking. Everything the request does after this is counted to them.
function enter(who) { if (who) als.enterWith({ who: String(who).toUpperCase() }); }
// Called for every AI response with its cost.
function add(usd) {
  const s = als.getStore(); if (!s || !(usd > 0)) return;
  roll(); mine.by[s.who] = (mine.by[s.who] || 0) + usd;
}

async function refresh() {
  const dir = `spend/${others.day}`;
  const list = (await pilot.listDir(dir)).filter((f) => f.type === 'file' && f.name !== `${INST}.json`);
  await Promise.all(list.map(async (f) => {
    if (others.files[f.name] && others.files[f.name].sha === f.sha) return;
    try { const r = await pilot.readFile(f.path); others.files[f.name] = { sha: f.sha, by: (r.data && r.data.by) || {} }; } catch (e) {}
  }));
  const by = {};
  for (const f of Object.values(others.files)) for (const [k, v] of Object.entries(f.by)) by[k] = (by[k] || 0) + (Number(v) || 0);
  others.by = by; others.all = sum(by); others.t = Date.now();
}
async function save() {
  const total = sum(mine.by);
  if (total - mine.saved < 0.005 || (Date.now() - mine.savedAt < 120000 && total - mine.saved < 0.25)) return;
  const by = Object.fromEntries(Object.entries(mine.by).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));
  mine.savedAt = Date.now();
  await pilot.writeFile(`spend/${mine.day}/${INST}.json`, { day: mine.day, by }, `Spend ${mine.day}`);
  mine.saved = total;
}

// Before new AI work: throws if this family, or everyone together, is over today's cap.
async function gate() {
  const s = als.getStore(); if (!s || !pilot.pilotOn()) return;
  roll();
  if (Date.now() - others.t > 90000) await refresh().catch(() => { others.t = Date.now(); });
  save().catch(() => {}); // usually a no-op; when due, it finishes while the AI is working
  const fam = (others.by[s.who] || 0) + (mine.by[s.who] || 0);
  const all = others.all + sum(mine.by);
  if (fam >= familyCap()) {
    const e = new Error('Buddy has done a lot of work for your family today, so new AI questions and marking are paused until tomorrow. You can still practise saved questions and redo mistakes.');
    e.status = 429; e.cap = 'family'; throw e;
  }
  if (all >= totalCap()) {
    const e = new Error('PrepBuddy is very busy today, so new AI work is paused until tomorrow. You can still practise saved questions and redo mistakes.');
    e.status = 503; e.cap = 'all'; throw e;
  }
}

// For the admin page: each family's spend per day (server record), for the last `days` days.
async function report(days = 7) {
  const out = {};
  for (let i = 0; i < days; i++) {
    const d = hkDay(Date.now() - i * 86400e3);
    const files = (await pilot.listDir(`spend/${d}`)).filter((f) => f.type === 'file');
    const by = {};
    await Promise.all(files.map(async (f) => { try { const r = await pilot.readFile(f.path); for (const [k, v] of Object.entries((r.data && r.data.by) || {})) by[k] = (by[k] || 0) + (Number(v) || 0); } catch (e) {} }));
    out[d] = by;
  }
  return { days: out, familyCap: familyCap(), totalCap: totalCap() };
}

module.exports = { enter, add, gate, report, _test: { roll, state: () => ({ mine, others }) } };
