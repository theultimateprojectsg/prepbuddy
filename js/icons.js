// PrepBuddy's icon set: two-tone menu icons, one icon and colour per subject, and action icons
// (navy outline with a yellow part, on a soft tile). Inline SVG, drawn on a 24-unit grid.

const NAVY = '#26357A', Y = '#FFE066', GREY = '#7A829C';
const wrap = (inner, size, label) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/* ---------- menu (two-tone when selected, grey outline when not) ---------- */
const MENU = {
  home: (s, f) => `<path d="M3 9.5V8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v1.5z" fill="${f}" stroke="none"/><rect x="3" y="5" width="18" height="16" rx="3" stroke="${s}" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="${s}" stroke-width="2"/><path d="M8.5 15.5l2.3 2.3 4.7-4.6" stroke="${s}" stroke-width="2"/>`,
  books: (s, f) => `<rect x="4" y="4" width="4.5" height="16" rx="1.2" fill="${f}" stroke="${s}" stroke-width="2"/><rect x="10.5" y="4" width="4.5" height="16" rx="1.2" stroke="${s}" stroke-width="2"/><path d="M17 5.6l2.6-.7 2.4 14.3-2.6.7z" stroke="${s}" stroke-width="2"/>`,
  mistakes: (s, f) => `<path d="M14.5 5.5l4 4L8.5 19.5 4 20l.5-4.5z" fill="${f}" stroke="${s}" stroke-width="2"/><path d="M12.5 7.5l4 4" stroke="${s}" stroke-width="2"/><path d="M15.5 4.5l1-1a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-1 1" stroke="${s}" stroke-width="2"/>`,
  settings: (s, f) => `<circle cx="12" cy="12" r="3.2" fill="${f}" stroke="${s}" stroke-width="2"/><path d="M12 2.8l1.6 2.3 2.7-.7.7 2.7 2.7.7-.7 2.7 2.3 1.5-2.3 1.6.7 2.7-2.7.7-.7 2.7-2.7-.7L12 21.2l-1.6-2.3-2.7.7-.7-2.7-2.7-.7.7-2.7L2.8 12l2.3-1.6-.7-2.7 2.7-.7.7-2.7 2.7.7z" stroke="${s}" stroke-width="1.9"/>`,
  progress: (s, f) => `<rect x="10.5" y="6" width="3" height="13" rx="1" fill="${f}" stroke="${s}" stroke-width="2"/><rect x="4.5" y="12" width="3" height="7" rx="1" stroke="${s}" stroke-width="2"/><rect x="16.5" y="9" width="3" height="10" rx="1" stroke="${s}" stroke-width="2"/><path d="M3 21h18" stroke="${s}" stroke-width="2"/>`,
};
export const menuIcon = (key, on, size = 22) => wrap((MENU[key] || MENU.home)(on ? NAVY : GREY, on ? Y : 'none'), size);

/* ---------- subjects ---------- */
const SUBJ = {
  biology: ['#18966A', /biolog|生物/, (c) => `<path d="M5 19c0-8.3 5.7-14 14-14 0 8.3-5.7 14-14 14z" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="2"/><path d="M5 19l8.5-8.5M10 14h3.5M13.5 10.5v3" stroke="${c}" stroke-width="2"/>`],
  chemistry: ['#0E7C8C', /chemi|化學/, (c) => `<path d="M7.6 14.5h8.8l2.6 4.6A1.6 1.6 0 0 1 17.6 21H6.4A1.6 1.6 0 0 1 5 19.1z" fill="${c}" fill-opacity=".22" stroke="none"/><path d="M9 3h6M10 3v6.5L5 19.1A1.6 1.6 0 0 0 6.4 21h11.2a1.6 1.6 0 0 0 1.4-1.9L14 9.5V3" stroke="${c}" stroke-width="2"/><circle cx="11" cy="17.5" r="1" fill="${c}"/><circle cx="14" cy="16" r=".8" fill="${c}"/>`],
  physics: ['#26357A', /physic|物理/, (c) => `<ellipse cx="12" cy="12" rx="9.5" ry="3.8" stroke="${c}" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" stroke="${c}" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" stroke="${c}" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" fill="${Y}" stroke="${c}" stroke-width="1.5"/>`],
  maths: ['#A3661A', /math|algebra|geometr|calcul|statist|數學/, (c) => `<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2"/><path d="M8 6.5v4M6 8.5h4M14 8.5h4M6.5 14l3 3M9.5 14l-3 3M14 14.5h4M14 17h4" stroke="${c}" stroke-width="1.8"/>`],
  economics: ['#8A5A12', /econom|經濟/, (c) => `<path d="M3.5 20.5h17" stroke="${c}" stroke-width="2"/><path d="M4 16l5-5 3.5 3L19 7.5" stroke="${c}" stroke-width="2"/><path d="M14.5 7.5H19V12" stroke="${c}" stroke-width="2"/><circle cx="6.5" cy="6.5" r="3" fill="${Y}" stroke="${c}" stroke-width="1.6"/>`],
  english: ['#B0346A', /english|literat|英文|英語/, (c) => `<path d="M3 5.5c3-1 6-.8 9 1v14c-3-1.8-6-2-9-1z" fill="${c}" fill-opacity=".16" stroke="${c}" stroke-width="2"/><path d="M21 5.5c-3-1-6-.8-9 1v14c3-1.8 6-2 9-1z" stroke="${c}" stroke-width="2"/><path d="M15 10h3M15 13h3" stroke="${c}" stroke-width="1.6"/>`],
  chinese: ['#C2452D', /chinese|中文|中國語文/, (c) => `<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2"/><text x="12" y="17" text-anchor="middle" font-size="12" font-weight="700" fill="${c}" stroke="none" font-family="PingFang HK, Microsoft JhengHei, Noto Sans TC, sans-serif">文</text>`],
  history: ['#6B4FB0', /histor|歷史/, (c) => `<path d="M3 9.5L12 4l9 5.5z" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="2"/><path d="M6 12v6M10 12v6M14 12v6M18 12v6M3.5 20.5h17" stroke="${c}" stroke-width="2"/>`],
  geography: ['#3E6B2F', /geograph|地理/, (c) => `<circle cx="12" cy="12" r="9" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" stroke="${c}" stroke-width="1.8"/>`],
  finance: ['#0E6E4D', /financ|bafs|account|business|理財|會計|企業/, (c) => `<ellipse cx="10" cy="7" rx="6" ry="2.6" fill="${Y}" stroke="${c}" stroke-width="1.8"/><path d="M4 7v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7M4 11v4c0 1.4 2.7 2.6 6 2.6" stroke="${c}" stroke-width="1.8"/><circle cx="17" cy="16.5" r="4" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.8"/><path d="M17 14.8v3.4" stroke="${c}" stroke-width="1.6"/>`],
};
const OTHER_COLOURS = ['#26357A', '#18966A', '#C2452D', '#6B4FB0', '#0E7C8C', '#A3661A', '#B0346A', '#3E6B2F'];
const OTHER = (c) => `<rect x="4" y="4" width="4.5" height="16" rx="1.2" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="2"/><rect x="10.5" y="4" width="4.5" height="16" rx="1.2" stroke="${c}" stroke-width="2"/><path d="M17 5.6l2.6-.7 2.4 14.3-2.6.7z" stroke="${c}" stroke-width="2"/>`;
export function subjectKey(subject) {
  const s = String(subject || '').toLowerCase();
  if (!s) return null;
  for (const [k, [, re]] of Object.entries(SUBJ)) if (re.test(s)) return k;
  return null;
}
// The subject's colour; books with an unknown subject get a steady colour from their name.
export function subjectColour(subject, fallbackName = '') {
  const k = subjectKey(subject);
  if (k) return SUBJ[k][0];
  let h = 0; for (const ch of String(subject || fallbackName).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OTHER_COLOURS[h % OTHER_COLOURS.length];
}
// colour: draw the icon in this colour (e.g. white on a book cover) instead of the subject's own.
export function subjectIcon(subject, size = 22, colour = null, fallbackName = '') {
  const k = subjectKey(subject), c = colour || subjectColour(subject, fallbackName);
  return wrap(k ? SUBJ[k][2](c) : OTHER(c), size);
}
// The icon on a soft tile of its colour.
export function subjectTile(subject, size = 40, fallbackName = '') {
  const c = subjectColour(subject, fallbackName);
  return `<span class="stile" style="width:${size}px;height:${size}px;background:${c}1F" aria-hidden="true">${subjectIcon(subject, Math.round(size * 0.6), null, fallbackName)}</span>`;
}

/* ---------- actions ---------- */
const ACT = {
  review: ['#EEF1FB', `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" stroke="${NAVY}" stroke-width="2"/><path d="M19.5 4.5v4.5H15" stroke="${NAVY}" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="${Y}" stroke="${NAVY}" stroke-width="1.6"/>`],
  mistakes: ['#FDEEEC', `<path d="M14.5 5.5l4 4L8.5 19.5 4 20l.5-4.5z" fill="${Y}" stroke="${NAVY}" stroke-width="2"/><path d="M12.5 7.5l4 4" stroke="${NAVY}" stroke-width="2"/><path d="M15 19.5l1.6 1.6 3.4-3.6" stroke="#B22A1E" stroke-width="2"/>`],
  practise: ['#E5F5EE', `<circle cx="12" cy="12" r="9" stroke="${NAVY}" stroke-width="2"/><path d="M10 8.3l5.6 3.7-5.6 3.7z" fill="${Y}" stroke="${NAVY}" stroke-width="1.8"/>`],
  weak: ['#FFF6CC', `<circle cx="11" cy="13" r="8" stroke="${NAVY}" stroke-width="2"/><circle cx="11" cy="13" r="4.5" fill="${Y}" stroke="${NAVY}" stroke-width="1.8"/><circle cx="11" cy="13" r="1.2" fill="${NAVY}"/><path d="M11 13l9-9M16.5 4H20v3.5" stroke="${NAVY}" stroke-width="2"/>`],
  mock: ['#EEF1FB', `<circle cx="12" cy="13.5" r="7.5" fill="${Y}" stroke="${NAVY}" stroke-width="2"/><path d="M12 13.5V9.5M12 13.5l2.6 1.8M10 2.5h4M12 2.5V6M18.5 6l1.4-1.4" stroke="${NAVY}" stroke-width="2"/>`],
  notes: ['#FFF6CC', `<path d="M6 3h8.5L19 7.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="${NAVY}" stroke-width="2"/><path d="M14 3v5h5" stroke="${NAVY}" stroke-width="2"/><path d="M7 11.2h9" stroke="${Y}" stroke-width="3.4"/><path d="M7.5 11.5h7M7.5 15h8M7.5 18h5" stroke="${NAVY}" stroke-width="1.6"/>`],
  flashcards: ['#E5F5EE', `<rect x="3" y="6" width="13" height="15" rx="2.5" stroke="${NAVY}" stroke-width="2" transform="rotate(-8 9.5 13.5)"/><rect x="8" y="3.5" width="13" height="15" rx="2.5" fill="${Y}" stroke="${NAVY}" stroke-width="2"/><path d="M12 9.5h5M12 12.5h3.5" stroke="${NAVY}" stroke-width="1.6"/>`],
};
export const actionIcon = (kind, size = 22) => wrap((ACT[kind] || ACT.practise)[1], size);
export const actionTile = (kind, size = 44) => `<span class="atile" style="width:${size}px;height:${size}px;background:${(ACT[kind] || ACT.practise)[0]}" aria-hidden="true">${actionIcon(kind, Math.round(size * 0.58))}</span>`;
