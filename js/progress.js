// Is the child getting stronger? A measure of ability that allows for questions getting harder.
//
// Why: PrepBuddy raises the difficulty as a child does well, so the % of marks can stay at 60% while the
// child improves. Raw scores can't show that; this can.
//
// What: for each subject and each textbook, the child's level on the same 1-4 scale as the questions: the
// difficulty at which they get about 2 in 3 marks. 60% on level 3 questions is a higher level than 70% on
// level 2. Plus the trend: is that level rising, steady or dipping, and by how much since they started.
//
// How (an item-response model; nothing here needs the AI):
// - Each question's difficulty comes from its level (LEVEL_B below). The four values are a starting point,
//   to be re-fitted from pooled pilot answers (the admin page shows the fit).
// - Only the FIRST attempt at a question counts towards ability. Redos and reviews measure other things
//   (mistakes fixed, remembered later), and counting them would flatter the child.
// - Multiple choice can be guessed: the chance of a right answer never drops below 1 in 4.
// - An answer given after asking Buddy for help counts half.
// - Partial marks count as partial credit; questions worth more marks count a little more (up to 3x).
// - Each week's answers give that week's level and its uncertainty. The trend is a weighted straight line
//   through the weeks (weeks with more answers count more). It's only called "rising" or "dipping" when the
//   change is at least a quarter of a level AND clearly bigger than its uncertainty (95% one-sided); until 3 weeks
//   and 30 first attempts, it says it's still building up a picture.
// - Stored as weekly totals (a few numbers per week), so it survives the answer log being trimmed.
export const LEVEL_B = { 1: -2.25, 2: -0.75, 3: 0.75, 4: 2.25 }; // logits; 1.5 apart
const SPACING = 1.5;                  // logits per level, for showing ability as a level
const PRIOR_V = 4;                    // weak prior: sd 2 logits around the middle
export const MIN_N = 30;              // first attempts before a trend is shown
export const MIN_WEEKS = 3;
const Z = 1.64;                       // how clearly the change must beat its uncertainty (95%, one-sided)
const DAY = 86400000;
const LN2 = Math.log(2);
const sig = (x) => 1 / (1 + Math.exp(-x));
export const toLevel = (th) => Math.max(0.5, Math.min(4.5, (th - LN2) / SPACING + 2.5));
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

export function weekKey(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const wkIndex = (k) => Math.round(new Date(k + 'T00:00:00').getTime() / (7 * DAY));

// Subject names vary ("Mathematics", "數學", "Maths"); group them so two maths books make one subject.
const SUBJ = [[/math|數學|数学/i, 'math'], [/chinese|中文|中國語文|中国语文/i, 'chi'], [/english|英文|英國語文/i, 'eng'], [/general studies|常識/i, 'gs'],
  [/physic|物理/i, 'phy'], [/chem|化學/i, 'chem'], [/bio|生物/i, 'bio'], [/econ|經濟/i, 'econ'], [/history|歷史/i, 'hist'], [/geog|地理/i, 'geog'],
  [/citizen|公民|liberal|通識/i, 'csd'], [/science|科學/i, 'sci'], [/humanit|人文/i, 'hum'], [/ict|資訊|computer/i, 'ict'], [/bafs|business|企業/i, 'bafs']];
export function subjectKey(subject, bookId) {
  const s = String(subject || '').trim();
  for (const [re, k] of SUBJ) if (re.test(s)) return k;
  return s ? 's:' + s.toLowerCase().slice(0, 30) : 'b:' + bookId;
}

export const newState = () => ({ v: 2, s: {}, b: {}, bs: {}, w: {} });
// A track: weeks → { n, c: { '<level><c|w|u>': [sum of weight × score, sum of weight] } }
const newTrack = () => ({ n: 0, wk: {} });
const typeCode = (e) => (e.ty === 'choice' || e.ty === 'c' ? 'c' : e.ty === 'written' || e.ty === 'w' ? 'w' : e.m === 1 ? 'u' : 'w');
const GUESS = { c: 0.25, w: 0, u: 0.15 }; // u: older answers where the type wasn't kept (1-mark ones are mostly multiple choice)

function add(T, e) {
  const lv = Math.max(1, Math.min(4, Math.round(Number(e.l) || 2)));
  const w = (1 + 0.5 * (Math.min(e.m, 5) - 1)) * (e.h ? 0.5 : 1);
  const o = Math.max(0, Math.min(1, e.g / e.m));
  const W = T.wk[weekKey(e.t)] || (T.wk[weekKey(e.t)] = { n: 0, c: {} });
  const cell = W.c[lv + typeCode(e)] || (W.c[lv + typeCode(e)] = [0, 0]);
  cell[0] = Math.round((cell[0] + w * o) * 1000) / 1000; cell[1] = Math.round((cell[1] + w) * 1000) / 1000;
  W.n++; T.n++;
  const ks = Object.keys(T.wk); if (ks.length > 80) ks.sort().slice(0, ks.length - 80).forEach((k) => delete T.wk[k]);
}

// One answer. e = { t, q, g, m, l, ty: 'c' (multiple choice) | 'w' (written) | undefined, h: asked Buddy first }.
// prev = this child's previous answer to the same question (or null); subj = subject key for the book.
export function update(st, e, prev, subj) {
  if (!e || !e.m || !e.q) return;
  const bid = String(e.q).split(':')[0];
  if (subj) st.bs[bid] = subj;
  const key = st.bs[bid] || 'b:' + bid;
  const wk = weekKey(e.t), W = st.w[wk] || (st.w[wk] = { fx: [0, 0], rt: [0, 0], n: 0, f: 0 });
  W.n++;
  if (prev) {
    if (prev.g < prev.m) { W.fx[1]++; if (e.g >= e.m) W.fx[0]++; }      // a mistake tried again: fixed?
    if (e.t - prev.t >= 7 * DAY) { W.rt[0] += e.g; W.rt[1] += e.m; }   // back a week or more later: remembered?
    return;                                                             // not a first attempt: ability unchanged
  }
  W.f++;
  add(st.s[key] || (st.s[key] = newTrack()), e);
  add(st.b[bid] || (st.b[bid] = newTrack()), e);
  const ks = Object.keys(st.w); if (ks.length > 80) ks.sort().slice(0, ks.length - 80).forEach((k) => delete st.w[k]);
}

// Rebuild from an answer log (oldest first): for families who used the app before this existed.
export function build(log, subjOf) {
  const st = newState(), last = {};
  for (const e of log || []) { if (!e || !e.q || !e.m) continue; update(st, e, last[e.q] || null, subjOf(String(e.q).split(':')[0])); last[e.q] = e; }
  return st;
}

// Ability (logits) and its standard error from a set of cells, by maximum likelihood with a weak prior.
export function fit(cells, b = LEVEL_B) {
  const rows = [];
  for (const c of cells) for (const [k, [so, sw]] of Object.entries(c)) if (sw > 0) rows.push([b[k[0]], GUESS[k[1]] ?? 0, so, sw]);
  const nw = rows.reduce((a, r) => a + r[3], 0);
  if (!nw) return null;
  let th = 0, info = 1 / PRIOR_V;
  for (let i = 0; i < 40; i++) {
    let gr = -th / PRIOR_V; info = 1 / PRIOR_V;
    for (const [bb, c, so, sw] of rows) {
      const s = sig(th - bb), p = Math.min(0.999, Math.max(0.001, c + (1 - c) * s)), dp = (1 - c) * s * (1 - s);
      gr += (so - sw * p) * dp / (p * (1 - p)); info += sw * dp * dp / (p * (1 - p));
    }
    const d = gr / info; th = Math.max(-6, Math.min(6, th + d)); if (Math.abs(d) < 1e-5) break;
  }
  return { th, se: 1 / Math.sqrt(info), nw };
}

// Where a track stands: level now, the trend since the start, how sure we are, and the weekly points.
export function trackSummary(T) {
  if (!T) return null;
  const weeks = Object.keys(T.wk).sort();
  const pts = weeks.map((k) => { const f = fit([T.wk[k].c]); return f && T.wk[k].n >= 5 ? { k, x: wkIndex(k), th: f.th, se: f.se, n: T.wk[k].n } : null; }).filter(Boolean);
  // level now: the last 2 active weeks together (more if they hold under 20 answers)
  const recent = []; let rn = 0;
  for (let i = weeks.length - 1; i >= 0 && (recent.length < 2 || rn < 20); i--) { recent.push(T.wk[weeks[i]].c); rn += T.wk[weeks[i]].n; }
  const now = fit(recent);
  const out = { n: T.n, weeks: weeks.length, level: now ? r2(toLevel(now.th)) : null, se: now ? r2(now.se / SPACING) : null,
    line: pts.slice(-12).map((p) => [p.k, r2(toLevel(p.th)), p.n]), status: 'building', change: null, cse: null, since: weeks[0] || null, start: null, perWeek: null };
  if (T.n < MIN_N || pts.length < MIN_WEEKS) return out;
  // weighted straight line through the weekly levels
  const ws = pts.map((p) => 1 / (p.se * p.se)), sw = ws.reduce((a, b) => a + b, 0);
  const mx = pts.reduce((a, p, i) => a + ws[i] * p.x, 0) / sw, my = pts.reduce((a, p, i) => a + ws[i] * p.th, 0) / sw;
  const sxx = pts.reduce((a, p, i) => a + ws[i] * (p.x - mx) ** 2, 0);
  if (sxx <= 0) return out;
  const slope = pts.reduce((a, p, i) => a + ws[i] * (p.x - mx) * (p.th - my), 0) / sxx;
  // if the weeks scatter more than their own uncertainty explains, widen the error to match
  const chi = pts.reduce((a, p, i) => a + ws[i] * (p.th - (my + slope * (p.x - mx))) ** 2, 0);
  const infl = pts.length > 2 ? Math.max(1, chi / (pts.length - 2)) : 1;
  const seSlope = Math.sqrt(infl / sxx);
  const span = pts[pts.length - 1].x - pts[0].x;
  const change = slope * span / SPACING, cse = seSlope * span / SPACING;
  const startTh = my + slope * (pts[0].x - mx);
  out.change = r2(change); out.cse = r2(cse); out.since = pts[0].k; out.start = r2(toLevel(startTh)); out.perWeek = r2(slope / SPACING);
  out.status = change >= 0.25 && change > Z * cse ? 'rising' : change <= -0.25 && change < -Z * cse ? 'dipping' : 'steady';
  return out;
}

// Everything, by subject and textbook.
export function summary(st) {
  const subjects = Object.entries(st.s).map(([key, T]) => {
    const books = Object.entries(st.b).filter(([bid]) => (st.bs[bid] || 'b:' + bid) === key).map(([id, B]) => ({ id, ...trackSummary(B) }));
    return { key, ...trackSummary(T), books };
  }).sort((a, b) => b.n - a.n);
  const ready = subjects.filter((s) => s.status !== 'building');
  const fx = Object.values(st.w).reduce((a, w) => [a[0] + w.fx[0], a[1] + w.fx[1]], [0, 0]);
  const rt = Object.values(st.w).reduce((a, w) => [a[0] + w.rt[0], a[1] + w.rt[1]], [0, 0]);
  return {
    subjects, fixed: fx, kept: rt, ready: ready.length,
    rising: ready.filter((s) => s.status === 'rising').length, steady: ready.filter((s) => s.status === 'steady').length, dipping: ready.filter((s) => s.status === 'dipping').length,
  };
}

// For the admin page's calibration check: first-attempt totals by level and type, per subject.
export function calibData(st) {
  return Object.entries(st.s).filter(([, T]) => T.n >= 20).map(([key, T]) => {
    const c = {}; Object.values(T.wk).forEach((W) => Object.entries(W.c).forEach(([k, [so, sw]]) => { const x = c[k] || (c[k] = [0, 0]); x[0] = r2(x[0] + so); x[1] = r2(x[1] + sw); }));
    return { key, c };
  });
}
