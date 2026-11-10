// Weekly progress report: built on the student's device from the activity log, shared as a link.
// The report data travels inside the link after "#", so it is never sent to the server.

const DAY = 864e5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Minutes spent: time between answers in the same sitting (gaps over 5 min don't count), plus 1 min per sitting.
function minutesOf(entries) {
  const ts = entries.map((e) => e.t).sort((a, b) => a - b);
  let ms = 0;
  ts.forEach((t, i) => { const gap = i ? t - ts[i - 1] : Infinity; ms += gap <= 5 * 60e3 ? gap : 60e3; });
  return Math.round(ms / 60e3);
}

function acc(entries) {
  const m = entries.reduce((s, e) => s + e.m, 0);
  return m ? Math.round(100 * entries.reduce((s, e) => s + e.g, 0) / m) : null;
}

const shortTitle = (c) => c.replace(/\s*\(part \d+ of \d+\)$/i, '');

// Build the report from the log. `stats` gives the spaced-review box per question.
export function buildReport({ log, stats, name, books }) {
  const today = dayStart(Date.now());
  const from = today - 6 * DAY, prevFrom = from - 7 * DAY;
  const week = log.filter((e) => e.t >= from);
  const prev = log.filter((e) => e.t >= prevFrom && e.t < from);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d0 = from + i * DAY;
    return minutesOf(week.filter((e) => e.t >= d0 && e.t < d0 + DAY));
  });

  // chapters practised this week
  const byChapter = new Map();
  for (const e of week) { const c = shortTitle(e.c || 'Other'); if (!byChapter.has(c)) byChapter.set(c, []); byChapter.get(c).push(e); }
  const prevBy = new Map();
  for (const e of prev) { const c = shortTitle(e.c || 'Other'); if (!prevBy.has(c)) prevBy.set(c, []); prevBy.get(c).push(e); }
  const chapters = [...byChapter.entries()].map(([c, es]) => [c, acc(es), es.length])
    .sort((a, b) => b[2] - a[2]).slice(0, 8);

  // needs work: lowest chapter with 3+ answers, under 70%
  let weak = '', weakChapter = null;
  const low = chapters.filter((x) => x[2] >= 3 && x[1] < 70).sort((a, b) => a[1] - b[1])[0];
  const gainOf = (c) => { const es = byChapter.get(c), p = prevBy.get(c); return es && p && es.length >= 3 && p.length >= 3 ? { now: acc(es), was: acc(p) } : null; };
  if (low) {
    weakChapter = low[0];
    const es = byChapter.get(low[0]);
    const missed = es.filter((e) => e.g < e.m).length;
    const g = gainOf(low[0]);
    weak = `${low[0]}: ${missed} of ${es.length} questions not fully right` +
      (g && g.now > g.was ? `, though improving (up from ${g.was}% last week).` : '.');
  }

  // getting better: biggest gain vs last week (not the chapter that still needs work); otherwise the best chapter
  let up = '';
  let best = null;
  for (const [c] of byChapter) {
    if (c === weakChapter) continue;
    const g = gainOf(c);
    if (g && g.now > g.was && (!best || g.now - g.was > best.now - best.was)) best = { c, ...g };
  }
  if (best) up = `${best.c}: up from ${best.was}% to ${best.now}% since last week.`;
  else {
    const top = chapters.filter((x) => x[2] >= 3 && x[0] !== weakChapter).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 70) up = `${top[0]}: ${top[1]}% correct this week.`;
  }

  // spaced review
  const reviewDays = new Set(week.filter((e) => e.k === 'spaced').map((e) => dayStart(e.t))).size;
  const longTerm = Object.values(stats || {}).filter((s) => (s.box || 0) >= 3).length;
  const rev = reviewDays || longTerm
    ? `Did spaced review on ${reviewDays} day${reviewDays === 1 ? '' : 's'} this week. ${longTerm} question${longTerm === 1 ? ' is' : 's are'} now remembered a week or more after first learning ${longTerm === 1 ? 'it' : 'them'}.`
    : 'Spaced review starts the day after the first practice: questions come back so they stick.';

  const next = weakChapter
    ? `Two 15-minute sessions on ${weakChapter}, and keep up daily review.`
    : week.length ? 'Keep up daily review, and start the next chapter.' : 'Start with one 15-minute session on the current chapter.';

  const daysPractised = days.filter((m) => m > 0).length;
  const a = acc(week), pa = acc(prev);
  return {
    v: 1, n: (name || '').trim().slice(0, 30), b: (books || []).slice(0, 3), from, at: Date.now(),
    days, q: week.length, a, pa, dp: daysPractised, ch: chapters, up, weak, rev, next,
  };
}

/* ---------- link encoding ---------- */
export function encodeReport(r) {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeReport(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/* ---------- rendering (used by the report page and the in-app preview) ---------- */
const fmtDate = (t, opts) => new Date(t).toLocaleDateString('en-GB', opts);
function hm(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${m}m` : `${m} min`; }

export function headline(r) {
  const who = r.n || 'Your child';
  if (!r.q) return `${who} didn't practise this week`;
  if (r.dp >= 5 || (r.a !== null && r.pa !== null && r.a - r.pa >= 5)) return `${who} had a strong week`;
  if (r.dp >= 3) return `${who} had a steady week`;
  return `${who} made a start this week`;
}

export function reportHTML(r) {
  const who = r.n || 'Your child';
  const range = `${fmtDate(r.from, { day: 'numeric', month: 'short' })}–${fmtDate(r.from + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const maxMin = Math.max(30, ...r.days);
  const dayNames = Array.from({ length: 7 }, (_, i) => fmtDate(r.from + i * DAY, { weekday: 'narrow' }));
  const longest = r.days.indexOf(Math.max(...r.days));
  const trend = r.a !== null && r.pa !== null
    ? (r.a >= r.pa ? `<span class="up">up from ${r.pa}%</span>` : `<span class="down">from ${r.pa}% last week</span>`) : '<span>correct</span>';
  const label = (p) => (p >= 80 ? ['Strong', 'ok'] : p >= 70 ? ['Good', 'ok'] : ['Needs work', 'warn']);
  return `
  <header class="rep-head">
    <small>PrepBuddy weekly report</small>
    <h1>${esc(headline(r))}</h1>
    <p>${esc(r.b && r.b.length ? r.b.join(', ') + ' · ' : '')}${range} · practised ${r.dp} of 7 days</p>
  </header>
  <main class="rep">
    <div class="rep-stats">
      <div><b>${r.q}</b><span>questions answered</span></div>
      <div><b>${hm(r.days.reduce((s, m) => s + m, 0))}</b><span>time practising</span></div>
      <div><b>${r.a === null ? '–' : r.a + '%'}</b>${trend}</div>
    </div>
    <section class="rep-card">
      <h2>Practice this week</h2>
      <div class="rep-bars" role="img" aria-label="Minutes practised each day: ${r.days.map((m, i) => `${dayNames[i]} ${m}`).join(', ')}">
        ${r.days.map((m, i) => `<div><i style="height:${m ? Math.max(6, Math.round(70 * m / maxMin)) : 3}px" class="${m ? '' : 'none'}"></i><span>${dayNames[i]}</span></div>`).join('')}
      </div>
      <p class="rep-note">${r.q ? `Bars show minutes practised each day. Longest: ${fmtDate(r.from + longest * DAY, { weekday: 'long' })}, ${r.days[longest]} min.` : 'No practice recorded in these 7 days.'}</p>
    </section>
    ${r.ch.length ? `<section class="rep-card"><h2>Chapters</h2>
      ${r.ch.map(([c, p, n]) => { const [l, k] = label(p); return `<div class="rep-ch"><div><span>${esc(c)}</span><b class="${k}">${p}% · ${l}</b></div><div class="rep-bar ${k}"><i style="width:${p}%"></i></div><small>${n} answer${n === 1 ? '' : 's'}</small></div>`; }).join('')}
    </section>` : ''}
    ${r.up ? `<section class="rep-good"><small>Getting better at</small><p>${esc(r.up)}</p></section>` : ''}
    ${r.weak ? `<section class="rep-weak"><small>Needs more practice</small><p>${esc(r.weak)}</p></section>` : ''}
    <section class="rep-card"><h2>Remembering what was learned</h2><p>${esc(r.rev)}</p></section>
    <section class="rep-next"><small>Suggested for next week</small><p>${esc(r.next)}</p></section>
    <p class="rep-foot">Snapshot sent by ${esc(who)} from PrepBuddy on ${fmtDate(r.at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${new Date(r.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}. Scores come from PrepBuddy practice questions written from the student's own textbook; written answers are marked by AI against a mark scheme.</p>
  </main>`;
}

export const REPORT_CSS = `
.rep-head{background:#0F766E;color:#fff;padding:28px 20px 24px;display:flex;flex-direction:column;gap:10px}
.rep-head small{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#CCF2EE}
.rep-head h1{margin:0;font-family:'Space Grotesk',Inter,sans-serif;font-size:26px;line-height:1.2}
.rep-head p{margin:0;font-size:14px;line-height:1.5;color:#E6F7F5}
.rep{display:flex;flex-direction:column;gap:18px;padding:20px}
.rep-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rep-stats div{background:#fff;border:1px solid #E3E6EA;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px}
.rep-stats b{font-family:'Space Grotesk',Inter,sans-serif;font-size:22px}
.rep-stats span{font-size:12px;color:#4B5563}.rep-stats .up{color:#0F766E;font-weight:600}.rep-stats .down{color:#9A3412;font-weight:600}
.rep-card{background:#fff;border:1px solid #E3E6EA;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.rep-card h2{margin:0;font-size:15px}.rep-card p{margin:0;font-size:14px;line-height:1.5;color:#374151}
.rep-bars{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;align-items:end;height:96px}
.rep-bars div{display:flex;flex-direction:column;align-items:center;gap:6px}
.rep-bars i{display:block;width:22px;border-radius:6px;background:#0F766E}.rep-bars i.none{background:#E3E6EA;border-radius:2px}
.rep-bars span{font-size:12px;color:#4B5563}
.rep-note{font-size:13px!important;color:#4B5563!important}
.rep-ch{display:flex;flex-direction:column;gap:6px}
.rep-ch>div:first-child{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.rep-ch b{font-size:13px;white-space:nowrap}.rep-ch b.ok{color:#0F766E}.rep-ch b.warn{color:#9A3412}
.rep-ch small{font-size:12px;color:#6B7280}
.rep-bar{height:8px;border-radius:4px;background:#EEF0F2;overflow:hidden}.rep-bar i{display:block;height:100%;background:#0F766E}.rep-bar.warn i{background:#C2410C}
.rep-good,.rep-weak,.rep-next{border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.rep-good{background:#E6F4F2}.rep-weak{background:#FFF1E8}.rep-next{background:#fff;border:2px solid #0F766E}
.rep-good small,.rep-weak small,.rep-next small{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.rep-good small,.rep-next small{color:#0F4F4A}.rep-weak small{color:#9A3412}
.rep-good p,.rep-weak p,.rep-next p{margin:0;font-size:15px;line-height:1.5}
.rep-foot{margin:0;font-size:12px;line-height:1.5;color:#4B5563}
`;
