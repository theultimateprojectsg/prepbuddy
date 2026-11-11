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
export function buildReport({ log, stats, name, books, lang, ms }) {
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
    days, q: week.length, a, pa, dp: daysPractised, ch: chapters, up, weak, rev, next, sk, ms: (ms || []).slice(0, 6).map(([n, p]) => [String(n).slice(0, 40), p]),
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
  const range = `${fmtDate(r.from, { day: 'numeric', month: 'short' })} – ${fmtDate(r.from + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const maxMin = Math.max(30, ...r.days);
  const dayNames = Array.from({ length: 7 }, (_, i) => fmtDate(r.from + i * DAY, { weekday: 'short' }));
  const longest = r.days.indexOf(Math.max(...r.days));
  const total = r.days.reduce((s, m) => s + m, 0);
  const trend = r.a !== null && r.pa !== null
    ? (r.a >= r.pa ? `<em class="up">▲ ${T(`from ${r.pa}% last week`, `上週 ${r.pa}%`)}</em>` : `<em class="down">▼ ${T(`from ${r.pa}% last week`, `上週 ${r.pa}%`)}</em>`) : '';
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  const label = (p) => (p >= 80 ? T('Strong', '強') : p >= 60 ? T('Getting there', '漸入佳境') : T('Needs work', '需加強'));
  // the chapter that needs most work (same rule as the "needs more practice" note)
  const low = (r.ch || []).filter((x) => x[2] >= 3 && x[1] < 70).sort((a, b) => a[1] - b[1])[0];
  const help = !r.q ? T(`A short routine helps most: suggest 15 minutes at the same time each day, and ask ${who} to show you the app.`, `建立習慣最有用：建議每天固定時間練習 15 分鐘，並請${who}示範一下這個應用程式。`)
    : low ? T(`Ask ${who} to explain one idea from “${low[0]}” to you in their own words. Teaching it back is one of the best ways to learn it.`, `請${who}用自己的話，向你解釋「${low[0]}」中的一個概念。把內容教給別人，是最有效的學習方法之一。`)
    : T(`Ask ${who} which question was hardest this week, and praise the effort as well as the score.`, `問問${who}本週哪一題最難，並稱讚他們付出的努力，而不只是分數。`);
  const ring = (p, size = 64) => `<span class="rp-ring ${tone(p)}" style="--p:${p};width:${size}px;height:${size}px"><b>${p}%</b></span>`;
  return `<div class="rp">
  <header class="rp-head">
    <div class="rp-brand"><span class="rp-logo"><svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true"><circle cx="57" cy="44" r="26" fill="#FFFFFF"/><path d="M31 44 H44 V77 L31 90 Z" fill="#FFFFFF"/><circle cx="57" cy="44" r="11" fill="#FFE066"/></svg>PrepBuddy</span><span>${T('Weekly report', '每週報告')} · ${range}</span></div>
    <div class="rp-hero">
      <div class="rp-title">
        <h1>${esc(headline(r))}</h1>
        <p>${esc(r.b && r.b.length ? r.b.join(' · ') : T('PrepBuddy practice', 'PrepBuddy 練習'))}</p>
        <div class="rp-week" aria-label="${T(`Practised ${r.dp} of 7 days`, `7 日中有 ${r.dp} 日練習`)}">${r.days.map((m, i) => `<span class="${m ? 'on' : ''}" title="${dayNames[i]}: ${m} min">${ZH ? fmtDate(r.from + i * DAY, { weekday: 'narrow' }) : dayNames[i].slice(0, 2)}</span>`).join('')}<small>${T(`${r.dp} of 7 days`, `${r.dp}/7 日`)}</small></div>
      </div>
      <div class="rp-stats">
        <div><b>${r.q}</b><span>${T('questions answered', '已答題目')}</span></div>
        <div><b>${hm(total)}</b><span>${T('time practising', '練習時間')}</span></div>
        <div><b>${r.a === null ? '–' : r.a + '%'}</b><span>${T('marks scored', '得分率')}</span>${trend}</div>
      </div>
    </div>
  </header>
  <div class="rp-grid">
    <aside class="rp-side">
      ${r.up ? `<section class="rp-call good"><h3>${T('Getting better', '有進步')}</h3><p>${esc(r.up)}</p></section>` : ''}
      ${r.weak ? `<section class="rp-call weak"><h3>${T('Needs more practice', '需要多加練習')}</h3><p>${esc(r.weak)}</p></section>` : ''}
      <section class="rp-call next"><h3>${T('Suggested for next week', '下週建議')}</h3><p>${esc(r.next)}</p></section>
      <section class="rp-call help"><h3>${T('How you can help', '家長可以怎樣幫忙')}</h3><p>${esc(help)}</p></section>
    </aside>
    <main class="rp-main">
      <section class="rp-card">
        <div class="rp-card-head"><h2>${T('Practice this week', '本週練習')}</h2><span>${r.q ? T(`Longest: ${fmtDate(r.from + longest * DAY, { weekday: 'long' })}, ${r.days[longest]} min`, `最長：${fmtDate(r.from + longest * DAY, { weekday: 'long' })}，${r.days[longest]} 分鐘`) : T('No practice in these 7 days', '這 7 日沒有練習')}</span></div>
        <div class="rp-bars" role="img" aria-label="${T('Minutes practised each day', '每日練習分鐘')}: ${r.days.map((m, i) => `${dayNames[i]} ${m}`).join(', ')}">
          ${r.days.map((m, i) => `<div><small>${m ? m + T("'", '分') : ''}</small><i style="height:${m ? Math.max(8, Math.round(110 * m / maxMin)) : 4}px" class="${m ? '' : 'none'}"></i><span>${dayNames[i]}</span></div>`).join('')}
        </div>
      </section>
      ${r.ch.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${T('Chapters practised', '練習過的章節')}</h2><span>${T('% of marks this week', '本週得分率')}</span></div>
        <div class="rp-chs">${r.ch.map(([c, p, n]) => `<div class="rp-ch"><div class="rp-ch-top"><span>${esc(c)}</span><b class="${tone(p)}">${p}%</b></div><div class="rp-bar ${tone(p)}"><i style="width:${p}%"></i></div><small>${label(p)} · ${T(`${n} answer${n === 1 ? '' : 's'}`, `${n} 個作答`)}</small></div>`).join('')}</div>
      </section>` : ''}
      ${r.ms && r.ms.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${T('How ready for each subject', '各科準備程度')}</h2></div>
        <div class="rp-mast">${r.ms.map(([n, p]) => `<div>${ring(p)}<span>${esc(n)}</span></div>`).join('')}</div>
        <p class="rep-note">${T('Mastery looks at how much of the textbook has been practised, how well, whether it is remembered in reviews, and whether timed chapter tests were passed.', '掌握程度會考慮練習了課本多少內容、表現如何、溫習時是否記得，以及有否通過限時章節測驗。')}</p></section>` : ''}
      <div class="rp-two">
        ${skillsHTML(r)}
        <section class="rep-card"><h2>${T('Remembering what was learned', '記住所學')}</h2><p>${esc(r.rev)}</p></section>
      </div>
    </main>
  </div>
  <footer class="rp-foot">
    <p>${T(`Sent by ${esc(who)} from PrepBuddy on ${fmtDate(r.at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${new Date(r.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}. Scores come from practice questions written from the student's own textbook; written answers are marked by AI against a mark scheme.`,
      `由${esc(who)}於 ${fmtDate(r.at, { month: 'long', day: 'numeric', weekday: 'short' })} ${new Date(r.at).toLocaleTimeString('zh-HK', { hour: 'numeric', minute: '2-digit' })} 從 PrepBuddy 傳送。分數來自根據學生自己課本編寫的練習題；文字題由 AI 按評分準則批改。`)}</p>
    <button class="rp-print" onclick="window.print()">${T('Print or save as PDF', '列印或儲存為 PDF')}</button>
  </footer>
  </div>`;
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
.rep-card{background:#fff;border:1px solid #DCE2EE;border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.rep-card h2{margin:0;font-size:15px;color:#1E2A5A}.rep-card p{margin:0;font-size:14px;line-height:1.55;color:#3F4868}
.rep-note{font-size:13px!important;color:#5A6380!important;line-height:1.5}
.rep-ch{display:flex;flex-direction:column;gap:6px}
.rep-ch>div:first-child{display:flex;justify-content:space-between;gap:12px;font-size:14px;color:#1E2A5A}
.rep-ch b{font-size:13px;white-space:nowrap}.rep-ch b.ok{color:#0E6E4D}.rep-ch b.warn{color:#B4531A}
.rep-ch small{font-size:12px;color:#7A829C}
.rep-bar{height:8px;border-radius:4px;background:#EEF1F6;overflow:hidden}.rep-bar i{display:block;height:100%;background:#18966A}.rep-bar.warn i{background:#E07A2E}
/* the weekly report page */
.rp{--ink:#1E2A5A;--accent:#26357A;--muted:#5A6380;--line:#DCE2EE;--good:#18966A;--mid:#26357A;--low:#E07A2E;color:var(--ink);font-family:'Lexend',system-ui,-apple-system,'PingFang HK','PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif}
.rp-head{background:var(--ink);color:#fff;padding:20px 20px 24px;display:flex;flex-direction:column;gap:18px}
.rp-brand{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;font-size:13px;color:#C9D0EA}
.rp-logo{font-weight:700;font-size:16px;color:#fff;display:inline-flex;align-items:center;gap:6px}
.rp-hero{display:flex;flex-direction:column;gap:18px}
.rp-title{display:flex;flex-direction:column;gap:8px}
.rp-title h1{margin:0;font-size:27px;line-height:1.2;font-weight:700}
.rp-title p{margin:0;font-size:14px;color:#DDE2F3;line-height:1.5}
.rp-week{display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap}
.rp-week span{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:rgba(255,255,255,.1);color:#AEB7DA}
.rp-week span.on{background:#FFE066;color:var(--ink)}
.rp-week small{margin-left:6px;font-size:13px;color:#DDE2F3}
.rp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rp-stats div{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:3px}
.rp-stats b{font-size:21px;font-weight:700;line-height:1.1;white-space:nowrap}.rp-stats span{font-size:12px;color:#C9D0EA}
.rp-stats em{font-style:normal;font-size:12px;font-weight:600}.rp-stats em.up{color:#7FE0B5}.rp-stats em.down{color:#FFB98A}
.rp-grid{display:flex;flex-direction:column;gap:16px;padding:18px 16px}
.rp-main{display:flex;flex-direction:column;gap:16px}
.rp-side{display:flex;flex-direction:column;gap:12px}
.rp-call{border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;border:1px solid transparent}
.rp-call h3{margin:0;font-size:13px;font-weight:700}
.rp-call p{margin:0;font-size:15px;line-height:1.5}
.rp-call.good{background:#E5F5EE}.rp-call.good h3{color:#0E6E4D}
.rp-call.weak{background:#FFF1E6}.rp-call.weak h3{color:#B4531A}
.rp-call.next{background:#fff;border-color:var(--accent);border-width:2px}.rp-call.next h3{color:var(--accent)}
.rp-call.help{background:#FFF8D6}.rp-call.help h3{color:#7A5B00}
.rp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.rp-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.rp-card p{margin:0}.rp-card-head h2{margin:0;font-size:16px}.rp-card-head span{font-size:12.5px;color:var(--muted)}
.rp-bars{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end;height:150px}
.rp-bars div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%}
.rp-bars i{display:block;width:min(36px,70%);border-radius:8px 8px 3px 3px;background:var(--accent)}.rp-bars i.none{background:#E3E8F1;border-radius:2px}
.rp-bars span{font-size:12px;color:var(--muted)}.rp-bars small{font-size:11px;color:var(--muted);min-height:14px}
.rp-chs{display:flex;flex-direction:column;gap:14px}
.rp-ch{display:flex;flex-direction:column;gap:6px}
.rp-ch-top{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.rp-ch-top b{font-size:14px}.rp-ch-top b.good{color:#0E6E4D}.rp-ch-top b.mid{color:var(--accent)}.rp-ch-top b.low{color:#B4531A}
.rp-ch small{font-size:12px;color:#7A829C}
.rp-bar{height:10px;border-radius:5px;background:#EEF1F6;overflow:hidden}.rp-bar i{display:block;height:100%;border-radius:5px}
.rp-bar.good i{background:var(--good)}.rp-bar.mid i{background:var(--accent)}.rp-bar.low i{background:var(--low)}
.rp-mast{display:flex;flex-wrap:wrap;gap:18px}
.rp-mast div{display:flex;align-items:center;gap:12px;font-size:14px;font-weight:600;min-width:160px}
.rp-ring{--c:var(--low);flex:none;border-radius:50%;background:conic-gradient(var(--c) calc(var(--p)*1%),#E9ECF4 0);display:grid;place-items:center}
.rp-ring.good{--c:var(--good)}.rp-ring.mid{--c:var(--accent)}
.rp-ring b{width:calc(100% - 14px);height:calc(100% - 14px);border-radius:50%;background:#fff;display:grid;place-items:center;font-size:14px}
.rp-two{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
.rp-foot{padding:0 16px 24px;display:flex;flex-direction:column;gap:12px}
.rp-foot p{margin:0;font-size:12px;line-height:1.55;color:var(--muted)}
.rp-print{align-self:flex-start;border:1.5px solid var(--line);background:#fff;color:var(--ink);font:600 14px 'Lexend',system-ui,sans-serif;border-radius:12px;padding:10px 16px;cursor:pointer;white-space:nowrap;flex:none}
@media (min-width:900px){
  .rp-head{padding:28px 40px 34px}
  .rp-hero{flex-direction:row;align-items:flex-end;justify-content:space-between;gap:32px}
  .rp-title h1{font-size:34px}
  .rp-stats{min-width:440px}
  .rp-stats b{font-size:28px}
  .rp-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;padding:26px 40px;align-items:start}
  .rp-side{grid-column:2;grid-row:1;position:sticky;top:20px}
  .rp-main{grid-column:1;grid-row:1}
  .rp-chs{display:grid;grid-template-columns:1fr 1fr;gap:16px 28px}
  .rp-two{grid-template-columns:1fr 1fr}
  .rp-foot{padding:0 40px 36px;flex-direction:row;justify-content:space-between;align-items:flex-start;gap:24px}
}
@media print{
  .rp-print{display:none}
  .rp-head,.rp-week span.on,.rp-call,.rp-bar i,.rp-bars i,.rp-ring{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .rp-side{position:static}
  .rp-card,.rp-call{break-inside:avoid}
}
`;
