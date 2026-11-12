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
export function buildReport({ log, stats, name, books, lang, ms, mk, fx }) {
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
  const chapters = [...byChapter.entries()].map(([c, es]) => [c, acc(es), es.length, (prevBy.get(c) || []).length >= 3 ? acc(prevBy.get(c)) : null])
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
  const lt = longTerm, rd = reviewDays;
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
  const tr = Array.from({ length: 6 }, (_, i) => { const end = today + DAY - (5 - i) * 7 * DAY; return acc(log.filter((e) => e.t >= end - 7 * DAY && e.t < end)); });
  const daysPractised = days.filter((m) => m > 0).length;
  // days in a row with practice, up to today (or yesterday)
  const pdays = new Set(log.map((e) => dayStart(e.t)));
  let st = 0; for (let d = pdays.has(today) ? today : today - DAY; pdays.has(d); d -= DAY) st++;
  const a = acc(week), pa = acc(prev);
  return {
    v: 1, u: zh ? 'zh' : 'en', n: (name || '').trim().slice(0, 30), b: (books || []).slice(0, 3), from, at: Date.now(),
    days, q: week.length, a, pa, dp: daysPractised, tr, st, pq: prev.length, pm: minutesOf(prev), mk: mk ?? null, fx: fx ?? null, lt, rd, ch: chapters, up, weak, rev, next, sk, ms: (ms || []).slice(0, 6).map(([n, p]) => [String(n).slice(0, 40), p]),
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

// How the week went, counting effort as well as scores:
// strong = practised most days (or scores clearly up) without practising much less than last week;
// lighter = clearly less practice than last week (time down by more than 30%).
export function weekTone(r) {
  if (!r.q) return 'none';
  const mins = (r.days || []).reduce((x, m) => x + m, 0);
  const less = r.pm !== undefined && r.pm >= 20 && mins < r.pm * 0.7;
  const better = r.a !== null && r.pa !== null && r.a - r.pa >= 5;
  if (!less && (r.dp >= 5 || (better && r.dp >= 3))) return 'strong';
  if (less) return 'lighter';
  if (r.dp >= 3) return 'steady';
  return 'start';
}

export function headline(r) {
  ZH = r.u === 'zh';
  const who = r.n || T('Your child', '你的子女');
  const k = weekTone(r);
  if (k === 'none') return T(`${who} didn't practise this week`, `${who}本週沒有練習`);
  if (k === 'strong') return T(`${who} had a strong week`, `${who}本週表現出色`);
  if (k === 'lighter') return T(`${who} had a lighter week`, `${who}本週練習較少`);
  if (k === 'steady') return T(`${who} had a steady week`, `${who}本週表現穩定`);
  return T(`${who} made a start this week`, `${who}本週已經起步`);
}

// Weekly score as six columns: reads well on a phone and on paper.
function trendBars(r) {
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  return `<div class="rp-wk">${r.tr.map((a, i) => `<div class="${i === 5 ? 'now' : ''}"><small>${a === null ? '–' : a + '%'}</small><i class="${a === null ? 'none' : tone(a)}" style="height:${a === null ? 4 : Math.max(6, Math.round(a * 1.1))}px"></i><span>${i === 5 ? T('This week', '本週') : fmtDate(r.from - (5 - i) * 7 * DAY, { day: 'numeric', month: 'short' })}</span></div>`).join('')}</div>`;
}

const RI = {
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z"/>',
  up: '<path d="M4 16l5-5 4 4 7-7"/><path d="M15 8h5v5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bars: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  ring: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  line: '<path d="M3 17l5-6 4 3 5-7 4 4"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  memory: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 7v5l3 2"/><path d="M17 17l2 2 3-3"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
};
const ri = (k, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RI[k]}</svg>`;

export function reportHTML(r) {
  ZH = r.u === 'zh';
  const who = r.n || T('Your child', '你的子女');
  const range = `${fmtDate(r.from, { day: 'numeric', month: 'short' })} – ${fmtDate(r.from + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const maxMin = Math.max(30, ...r.days);
  const dayNames = Array.from({ length: 7 }, (_, i) => fmtDate(r.from + i * DAY, { weekday: 'short' }));
  const longest = r.days.indexOf(Math.max(...r.days));
  const total = r.days.reduce((s, m) => s + m, 0);
  const trendOld = r.a !== null && r.pa !== null
    ? (r.a >= r.pa ? `<em class="up">▲ ${T(`from ${r.pa}% last week`, `上週 ${r.pa}%`)}</em>` : `<em class="down">▼ ${T(`from ${r.pa}% last week`, `上週 ${r.pa}%`)}</em>`) : '';
  const tone = (p) => (p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low');
  const label = (p) => (p >= 80 ? T('Strong', '強') : p >= 60 ? T('Getting there', '漸入佳境') : T('Needs work', '需加強'));
  // the chapter that needs most work (same rule as the "needs more practice" note)
  const low = (r.ch || []).filter((x) => x[2] >= 3 && x[1] < 70).sort((a, b) => a[1] - b[1])[0];
  const help = !r.q ? T(`A short routine helps most: suggest 15 minutes at the same time each day, and ask ${who} to show you the app.`, `建立習慣最有用：建議每天固定時間練習 15 分鐘，並請${who}示範一下這個應用程式。`)
    : low ? T(`Ask ${who} to explain one idea from “${low[0]}” to you in their own words. Teaching it back is one of the best ways to learn it.`, `請${who}用自己的話，向你解釋「${low[0]}」中的一個概念。把內容教給別人，是最有效的學習方法之一。`)
    : T(`Ask ${who} which question was hardest this week, and praise the effort as well as the score.`, `問問${who}本週哪一題最難，並稱讚他們付出的努力，而不只是分數。`);
  const stat = (ic, v, label, extra) => `<div><span class="rp-sic">${ri(ic, 16)}</span><b>${v}</b><span>${label}</span>${extra}</div>`;
  const chg = (now, was, unit) => { const d = now - was; if (!was && !now) return ''; return d === 0 ? `<em>${T('same as last week', '與上週相同')}</em>` : `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit} ${T('vs last week', '對比上週')}</em>`; };
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
        ${stat('check', r.q, T('questions answered', '已答題目'), r.pq !== undefined ? chg(r.q, r.pq, '') : '')}
        ${stat('clock', hm(total), T('time practising', '練習時間'), r.pm !== undefined ? chg(total, r.pm, T(' min', ' 分鐘')) : '')}
        ${stat('target', r.a === null ? '–' : r.a + '%', T('marks scored', '得分率'), r.a !== null && r.pa !== null ? chg(r.a, r.pa, T(' pts', ' 個百分點')) : '')}
        ${r.st !== undefined ? stat('flame', r.st, T(r.st === 1 ? 'day in a row' : 'days in a row', '連續練習日數'), '') : ''}
      </div>
    </div>
  </header>
  <div class="rp-grid">
    <aside class="rp-side">
      <h2 class="rp-side-h">${T('At a glance', '重點')}</h2>
      ${r.up ? `<section class="rp-call good"><span class="rp-cic">${ri('up')}</span><div><h3>${T('Getting better', '有進步')}</h3><p>${esc(r.up)}</p></div></section>` : ''}
      ${r.weak ? `<section class="rp-call weak"><span class="rp-cic">${ri('alert')}</span><div><h3>${T('Needs more practice', '需要多加練習')}</h3><p>${esc(r.weak)}</p></div></section>` : ''}
      <section class="rp-call next"><span class="rp-cic">${ri('flag')}</span><div><h3>${T('Suggested for next week', '下週建議')}</h3><p>${esc(r.next)}</p></div></section>
      <section class="rp-call help"><span class="rp-cic">${ri('heart')}</span><div><h3>${T('How you can help', '家長可以怎樣幫忙')}</h3><p>${esc(help)}</p></div></section>
    </aside>
    <main class="rp-main">
      <section class="rp-card">
        <div class="rp-card-head"><h2>${ri('bars')} ${T('Practice this week', '本週練習')}</h2><span>${r.q ? T(`Longest: ${fmtDate(r.from + longest * DAY, { weekday: 'long' })}, ${r.days[longest]} min`, `最長：${fmtDate(r.from + longest * DAY, { weekday: 'long' })}，${r.days[longest]} 分鐘`) : T('No practice in these 7 days', '這 7 日沒有練習')}</span></div>
        <div class="rp-bars" role="img" aria-label="${T('Minutes practised each day', '每日練習分鐘')}: ${r.days.map((m, i) => `${dayNames[i]} ${m}`).join(', ')}">
          ${r.days.map((m, i) => `<div><small>${m ? m + T("'", '分') : ''}</small><i style="height:${m ? Math.max(8, Math.round(110 * m / maxMin)) : 4}px" class="${m ? '' : 'none'}"></i><span>${dayNames[i]}</span></div>`).join('')}
        </div>
      </section>
      ${r.ch.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${ri('book')} ${T('Chapters practised', '練習過的章節')}</h2><span>${T('% of marks this week', '本週得分率')}</span></div>
        <div class="rp-chs">${r.ch.map(([c, p, n, was]) => `<div class="rp-ch"><div class="rp-ch-top"><span>${esc(c)}</span><b class="${tone(p)}">${p}%</b></div><div class="rp-bar ${tone(p)}"><i style="width:${p}%"></i></div><small>${label(p)} · ${T(`${n} answered`, `${n} 題`)}${was === null || was === undefined ? '' : p === was ? ` · ${T('same as last week', '與上週相同')}` : ` · <span class="${p > was ? 'cu' : 'cd'}">${p > was ? '▲' : '▼'} ${T(`from ${was}%`, `上週 ${was}%`)}</span>`}</small></div>`).join('')}</div>
      </section>` : ''}
      ${r.ms && r.ms.length ? `<section class="rp-card"><div class="rp-card-head"><h2>${ri('ring')} ${T('How ready for each subject', '各科準備程度')}</h2></div>
        <div class="rp-mast">${r.ms.map(([n, p]) => `<div>${ring(p)}<span>${esc(n)}</span></div>`).join('')}</div>
        <p class="rep-note">${T('Based on how much of the book is covered, scores, reviews and chapter tests.', '根據課本涵蓋範圍、分數、溫習及章節測驗計算。')}</p></section>` : ''}
      ${(r.tr || []).filter((x) => x !== null).length >= 2 ? `<section class="rp-card"><div class="rp-card-head"><h2>${ri('line')} ${T('Score over 6 weeks', '過去 6 星期的分數')}</h2><span>${T('% of marks each week', '每週得分率')}</span></div>${trendBars(r)}</section>` : ''}
      <div class="rp-two">
        ${skillsHTML(r)}
        <section class="rep-card"><h2>${ri('memory')} ${T('Remembering and fixing', '記憶與改正')}</h2>
          <div class="rp-tiles">
            ${r.lt !== undefined ? `<div><span class="rp-tic g">${ri('memory', 16)}</span><b>${r.lt}</b><span>${T('questions remembered a week or more', '題記得一星期或以上')}</span></div>` : ''}
            ${r.rd !== undefined ? `<div><span class="rp-tic b">${ri('repeat', 16)}</span><b>${r.rd}</b><span>${T(r.rd === 1 ? 'day of review this week' : 'days of review this week', '日本週有溫習')}</span></div>` : ''}
            ${r.mk !== null && r.mk !== undefined ? `<div><span class="rp-tic r">${ri('pencil', 16)}</span><b>${r.mk}</b><span>${T('mistakes still to fix', '題錯題仍待改正')}</span>${r.fx ? `<em>${T(`${r.fx} fixed this week`, `本週改正 ${r.fx} 題`)}</em>` : ''}</div>` : ''}
          </div>
          ${r.lt === undefined ? `<p>${esc(r.rev)}</p>` : ''}
        </section>
      </div>
    </main>
  </div>
  <footer class="rp-foot">
    <p>${T(`Sent by ${esc(who)} on ${fmtDate(r.at, { weekday: 'short', day: 'numeric', month: 'short' })}. Questions come from ${esc(who)}’s own textbook; written answers are marked by AI.`,
      `由${esc(who)}於 ${fmtDate(r.at, { month: 'long', day: 'numeric', weekday: 'short' })} 傳送。題目來自${esc(who)}自己的課本；文字題由 AI 批改。`)}</p>
    <button class="rp-print" onclick="window.print()">${T('Print or save as PDF', '列印或儲存為 PDF')}</button>
  </footer>
  </div>`;
}

// Shared by the report and the in-app progress screen.
export const SKILL_NAMES = { en: ['Remembering facts', 'Understanding', 'Using it', 'Thinking it through'], zh: ['記憶事實', '理解', '應用', '深入思考'] };
export function skillsHTML(r, zhOverride) {
  if (zhOverride !== undefined) ZH = zhOverride;
  const sk = r.sk || [];
  if (!sk.some(([, n]) => n >= 3)) return '';
  const names = SKILL_NAMES[ZH ? 'zh' : 'en'];
  const rated = sk.map(([a, n], i) => ({ a, n, i })).filter((x) => x.n >= 3 && x.a !== null);
  const best = rated.slice().sort((x, y) => y.a - x.a)[0], worst = rated.slice().sort((x, y) => x.a - y.a)[0];
  const insight = best && worst && best.i !== worst.i && best.a - worst.a >= 15
    ? T(`Best at ${names[best.i].toLowerCase()} (${best.a}%). ${names[worst.i]} needs the most work (${worst.a}%).`,
        `最擅長「${names[best.i]}」（${best.a}%）；「${names[worst.i]}」最需要加強（${worst.a}%）。`)
    : T('Skills are fairly even across question types.', '各類題型的表現大致平均。');
  return `<section class="rep-card"><h2>${ri('brain')} ${T('Question types (last 30 days)', '題型表現（過去 30 日）')}</h2>
    ${sk.map(([a, n], i) => n ? `<div class="rep-ch"><div><span>${names[i]}</span><b class="${a >= 70 ? 'ok' : 'warn'}">${a}%</b></div><div class="rep-bar ${a >= 70 ? 'ok' : 'warn'}"><i style="width:${a}%"></i></div></div>` : '').join('')}
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
.rp-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
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
.rp-card-head h2,.rep-card h2{display:flex;align-items:center;gap:8px}.rp-card-head h2 svg,.rep-card h2 svg{color:#26357A;flex:none}
.rp-stats>div{position:relative}.rp-sic{width:28px;height:28px;border-radius:9px;background:rgba(255,255,255,.12);display:grid;place-items:center;color:#FFE066;margin-bottom:4px}
.rp-side-h{margin:0 0 2px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5A6380}
.rp-call{flex-direction:row!important;gap:12px!important;align-items:flex-start}.rp-call>div{display:flex;flex-direction:column;gap:4px;min-width:0}
.rp-cic{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.7)}
.rp-call.good .rp-cic{color:#0E6E4D}.rp-call.weak .rp-cic{color:#B4531A}.rp-call.next .rp-cic{color:#26357A;background:#E8EDFB}.rp-call.help .rp-cic{color:#B07A00}
.rp-ch small .cu{color:#0E6E4D;font-weight:600}.rp-ch small .cd{color:#B4531A;font-weight:600}
.rp-wk{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;align-items:end;height:150px}
.rp-wk div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%}
.rp-wk i{display:block;width:min(40px,72%);border-radius:8px 8px 3px 3px;background:var(--accent)}
.rp-wk i.good{background:var(--good)}.rp-wk i.low{background:var(--low)}.rp-wk i.none{background:#E3E8F1;border-radius:2px}
.rp-wk small{font-size:12.5px;font-weight:700;color:var(--ink)}.rp-wk span{font-size:11.5px;color:var(--muted);text-align:center;white-space:nowrap}
.rp-wk .now span{font-weight:700;color:var(--ink)}.rp-wk div:not(.now) i{opacity:.55}
.rp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.rp-tiles>div{border:1px solid #E6E9F0;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:3px}
.rp-tiles b{font-size:24px;line-height:1.1}.rp-tiles span{font-size:12.5px;color:var(--muted);line-height:1.35}.rp-tiles em{font-style:normal;font-size:12px;font-weight:600;color:#0E6E4D}
.rp-tic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;margin-bottom:4px}.rp-tic.g{background:#E3F4EC;color:#0E6E4D}.rp-tic.b{background:#E8EDFB;color:#26357A}.rp-tic.r{background:#FDECEA;color:#C23B2C}
.rp-foot{padding:0 16px 24px;display:flex;flex-direction:column;gap:12px}
.rp-foot p{margin:0;font-size:12px;line-height:1.55;color:var(--muted)}
.rp-print{align-self:flex-start;border:1.5px solid var(--line);background:#fff;color:var(--ink);font:600 14px 'Lexend',system-ui,sans-serif;border-radius:12px;padding:10px 16px;cursor:pointer;white-space:nowrap;flex:none}
@media (min-width:900px){
  .rp-head{padding:28px 40px 34px}
  .rp-hero{flex-direction:row;align-items:flex-end;justify-content:space-between;gap:32px}
  .rp-title h1{font-size:34px}
  .rp-stats{min-width:560px;grid-template-columns:repeat(4,minmax(0,1fr))}
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
  .rp-head,.rp-week span.on,.rp-call,.rp-bar i,.rp-bars i,.rp-wk i,.rp-ring,.rp-tic,.rp-cic,.rp-sic{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .rp-side{position:static}
  .rp-card,.rp-call{break-inside:avoid}
}
`;
