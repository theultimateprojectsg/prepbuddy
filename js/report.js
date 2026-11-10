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
export function buildReport({ log, stats, name, books, lang }) {
  const zh = lang === 'zh'; const T = (en, c) => (zh ? c : en);
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
    weak = T(`${low[0]}: ${missed} of ${es.length} questions not fully right` +
      (g && g.now > g.was ? `, though improving (up from ${g.was}% last week).` : '.'),
      `${low[0]}：${es.length} 題中有 ${missed} 題未完全答對` + (g && g.now > g.was ? `，但有進步（上週 ${g.was}%）。` : '。'));
  }

  // getting better: biggest gain vs last week (not the chapter that still needs work); otherwise the best chapter
  let up = '';
  let best = null;
  for (const [c] of byChapter) {
    if (c === weakChapter) continue;
    const g = gainOf(c);
    if (g && g.now > g.was && (!best || g.now - g.was > best.now - best.was)) best = { c, ...g };
  }
  if (best) up = T(`${best.c}: up from ${best.was}% to ${best.now}% since last week.`, `${best.c}：由上週 ${best.was}% 進步至 ${best.now}%。`);
  else {
    const top = chapters.filter((x) => x[2] >= 3 && x[0] !== weakChapter).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 70) up = T(`${top[0]}: ${top[1]}% correct this week.`, `${top[0]}：本週答對 ${top[1]}%。`);
  }

  // spaced review
  const reviewDays = new Set(week.filter((e) => e.k === 'spaced').map((e) => dayStart(e.t))).size;
  const longTerm = Object.values(stats || {}).filter((s) => (s.box || 0) >= 3).length;
  const rev = reviewDays || longTerm
    ? T(`Did spaced review on ${reviewDays} day${reviewDays === 1 ? '' : 's'} this week. ${longTerm} question${longTerm === 1 ? ' is' : 's are'} now remembered a week or more after first learning ${longTerm === 1 ? 'it' : 'them'}.`,
        `本週有 ${reviewDays} 日做了間隔溫習。現有 ${longTerm} 條題目在初次學習一星期或以上後仍然記得。`)
    : T('Spaced review starts the day after the first practice: questions come back so they stick.', '間隔溫習會在首次練習翌日開始：題目會再出現，幫助記牢。');

  const next = weakChapter
    ? T(`Two 15-minute sessions on ${weakChapter}, and keep up daily review.`, `為「${weakChapter}」做兩次 15 分鐘練習，並保持每日溫習。`)
    : week.length ? T('Keep up daily review, and start the next chapter.', '保持每日溫習，並開始下一章。') : T('Start with one 15-minute session on the current chapter.', '先為目前的章節做一次 15 分鐘練習。');

  // Thinking skills over the last 30 days: % of marks by question level (1 recall … 4 analyse/evaluate).
  const month = log.filter((e) => e.t >= today - 29 * DAY);
  const sk = [1, 2, 3, 4].map((l) => { const es = month.filter((e) => (e.l || 2) === l); return [acc(es), es.length]; });
  const daysPractised = days.filter((m) => m > 0).length;
  const a = acc(week), pa = acc(prev);
  return {
    v: 1, u: zh ? 'zh' : 'en', n: (name || '').trim().slice(0, 30), b: (books || []).slice(0, 3), from, at: Date.now(),
    days, q: week.length, a, pa, dp: daysPractised, ch: chapters, up, weak, rev, next, sk,
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
let ZH = false;
const T = (en, c) => (ZH ? c : en);
const fmtDate = (t, opts) => new Date(t).toLocaleDateString(ZH ? 'zh-HK' : 'en-GB', opts);
function hm(min) { const h = Math.floor(min / 60), m = min % 60; return ZH ? (h ? `${h} 小時 ${m} 分鐘` : `${m} 分鐘`) : (h ? `${h}h ${m}m` : `${m} min`); }

export function headline(r) {
  ZH = r.u === 'zh';
  const who = r.n || T('Your child', '你的子女');
  if (!r.q) return T(`${who} didn't practise this week`, `${who}本週沒有練習`);
  if (r.dp >= 5 || (r.a !== null && r.pa !== null && r.a - r.pa >= 5)) return T(`${who} had a strong week`, `${who}本週表現出色`);
  if (r.dp >= 3) return T(`${who} had a steady week`, `${who}本週表現穩定`);
  return T(`${who} made a start this week`, `${who}本週已經起步`);
}

export function reportHTML(r) {
  ZH = r.u === 'zh';
  const who = r.n || T('Your child', '你的子女');
  const range = `${fmtDate(r.from, { day: 'numeric', month: 'short' })}–${fmtDate(r.from + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const maxMin = Math.max(30, ...r.days);
  const dayNames = Array.from({ length: 7 }, (_, i) => fmtDate(r.from + i * DAY, { weekday: 'narrow' }));
  const longest = r.days.indexOf(Math.max(...r.days));
  const trend = r.a !== null && r.pa !== null
    ? (r.a >= r.pa ? `<span class="up">${T(`up from ${r.pa}%`, `上週 ${r.pa}%`)}</span>` : `<span class="down">${T(`from ${r.pa}% last week`, `上週 ${r.pa}%`)}</span>`) : `<span>${T('correct', '答對')}</span>`;
  const label = (p) => (p >= 80 ? [T('Strong', '強'), 'ok'] : p >= 70 ? [T('Good', '良好'), 'ok'] : [T('Needs work', '需加強'), 'warn']);
  return `
  <header class="rep-head">
    <small>${T('PrepBuddy weekly report', 'PrepBuddy 每週報告')}</small>
    <h1>${esc(headline(r))}</h1>
    <p>${esc(r.b && r.b.length ? r.b.join(', ') + ' · ' : '')}${range} · ${T(`practised ${r.dp} of 7 days`, `7 日中有 ${r.dp} 日練習`)}</p>
  </header>
  <main class="rep">
    <div class="rep-stats">
      <div><b>${r.q}</b><span>${T('questions answered', '已答題目')}</span></div>
      <div><b>${hm(r.days.reduce((s, m) => s + m, 0))}</b><span>${T('time practising', '練習時間')}</span></div>
      <div><b>${r.a === null ? '–' : r.a + '%'}</b>${trend}</div>
    </div>
    <section class="rep-card">
      <h2>${T('Practice this week', '本週練習')}</h2>
      <div class="rep-bars" role="img" aria-label="${T('Minutes practised each day', '每日練習分鐘')}: ${r.days.map((m, i) => `${dayNames[i]} ${m}`).join(', ')}">
        ${r.days.map((m, i) => `<div><i style="height:${m ? Math.max(6, Math.round(70 * m / maxMin)) : 3}px" class="${m ? '' : 'none'}"></i><span>${dayNames[i]}</span></div>`).join('')}
      </div>
      <p class="rep-note">${r.q ? T(`Bars show minutes practised each day. Longest: ${fmtDate(r.from + longest * DAY, { weekday: 'long' })}, ${r.days[longest]} min.`, `棒形顯示每日練習分鐘。最長：${fmtDate(r.from + longest * DAY, { weekday: 'long' })}，${r.days[longest]} 分鐘。`) : T('No practice recorded in these 7 days.', '這 7 日沒有練習紀錄。')}</p>
    </section>
    ${r.ch.length ? `<section class="rep-card"><h2>${T('Chapters', '章節')}</h2>
      ${r.ch.map(([c, p, n]) => { const [l, k] = label(p); return `<div class="rep-ch"><div><span>${esc(c)}</span><b class="${k}">${p}% · ${l}</b></div><div class="rep-bar ${k}"><i style="width:${p}%"></i></div><small>${T(`${n} answer${n === 1 ? '' : 's'}`, `${n} 個作答`)}</small></div>`; }).join('')}
    </section>` : ''}
    ${r.up ? `<section class="rep-good"><small>${T('Getting better at', '有進步')}</small><p>${esc(r.up)}</p></section>` : ''}
    ${r.weak ? `<section class="rep-weak"><small>${T('Needs more practice', '需要多加練習')}</small><p>${esc(r.weak)}</p></section>` : ''}
    ${skillsHTML(r)}
    <section class="rep-card"><h2>${T('Remembering what was learned', '記住所學')}</h2><p>${esc(r.rev)}</p></section>
    <section class="rep-next"><small>${T('Suggested for next week', '下週建議')}</small><p>${esc(r.next)}</p></section>
    <p class="rep-foot">${T(`Snapshot sent by ${esc(who)} from PrepBuddy on ${fmtDate(r.at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${new Date(r.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}. Scores come from PrepBuddy practice questions written from the student's own textbook; written answers are marked by AI against a mark scheme.`,
      `由${esc(who)}於 ${fmtDate(r.at, { month: 'long', day: 'numeric', weekday: 'short' })} ${new Date(r.at).toLocaleTimeString('zh-HK', { hour: 'numeric', minute: '2-digit' })} 從 PrepBuddy 傳送。分數來自根據學生自己課本編寫的 PrepBuddy 練習題；文字題由 AI 按評分準則批改。`)}</p>
  </main>`;
}

// Shared by the report and the in-app progress screen.
export const SKILL_NAMES = { en: ['Recall', 'Understand', 'Apply', 'Analyse / evaluate'], zh: ['記憶', '理解', '應用', '分析／評鑑'] };
export function skillsHTML(r, zhOverride) {
  if (zhOverride !== undefined) ZH = zhOverride;
  const sk = r.sk || [];
  if (!sk.some(([, n]) => n >= 3)) return '';
  const names = SKILL_NAMES[ZH ? 'zh' : 'en'];
  const rated = sk.map(([a, n], i) => ({ a, n, i })).filter((x) => x.n >= 3 && x.a !== null);
  const best = rated.slice().sort((x, y) => y.a - x.a)[0], worst = rated.slice().sort((x, y) => x.a - y.a)[0];
  const insight = best && worst && best.i !== worst.i && best.a - worst.a >= 15
    ? T(`Strongest at ${names[best.i].toLowerCase()} questions (${best.a}%). ${names[worst.i]} questions need the most work (${worst.a}%).`,
        `最擅長${names[best.i]}題（${best.a}%）；${names[worst.i]}題最需要加強（${worst.a}%）。`)
    : T('Skills are fairly even across question types.', '各類題型的表現大致平均。');
  return `<section class="rep-card"><h2>${T('Thinking skills (last 30 days)', '思考能力（過去 30 日）')}</h2>
    ${sk.map(([a, n], i) => n ? `<div class="rep-ch"><div><span>${names[i]}</span><b class="${a >= 70 ? 'ok' : 'warn'}">${a}%</b></div><div class="rep-bar ${a >= 70 ? 'ok' : 'warn'}"><i style="width:${a}%"></i></div><small>${T(`${n} answer${n === 1 ? '' : 's'}`, `${n} 個作答`)}</small></div>` : '').join('')}
    <p class="rep-note">${insight}</p></section>`;
}

export const REPORT_CSS = `
.rep-head{background:#0F766E;color:#fff;padding:28px 20px 24px;display:flex;flex-direction:column;gap:10px}
.rep-head small{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#CCF2EE}
.rep-head h1{margin:0;font-family:'Space Grotesk',Inter,'PingFang HK','PingFang TC','Microsoft JhengHei','Noto Sans TC','Noto Sans CJK TC',sans-serif;font-size:26px;line-height:1.2}
.rep-head p{margin:0;font-size:14px;line-height:1.5;color:#E6F7F5}
.rep{display:flex;flex-direction:column;gap:18px;padding:20px}
.rep-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rep-stats div{background:#fff;border:1px solid #E3E6EA;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px}
.rep-stats b{font-family:'Space Grotesk',Inter,'PingFang HK','PingFang TC','Microsoft JhengHei','Noto Sans TC','Noto Sans CJK TC',sans-serif;font-size:22px}
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
