// Reads an ebook PDF on the student's own device and splits it into study units.
// Order of preference: the PDF's own bookmarks, then numbered headings ("2.1 Water"), then 8-page chunks.

import * as pdfjs from '../vendor/pdf.min.mjs';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
}

const MAX_UNIT = 60000;   // characters; bigger units are split into parts
const MIN_UNIT = 1500;    // smaller units are dropped (title pages, blank sections)
const MIN_UNIT_ZH = 600;  // the same for Chinese, which packs more into fewer characters
const SKIP_TITLE = /^(table of )?contents$|^index$|^preface|^acknowledg|^copyright|^about (the|this)|^cover$|^title page|^bibliography|^references$|^answer key|^dedication|^目錄$|^目录$|^索引$|^序言?$|^前言$|^鳴謝$|^版權|^參考(書目|資料)$|^答案$|^glossary$|^key terms$|^index of|^詞彙表$/i;

export async function readBook(data, onProgress = () => {}) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const pdf = await task.promise;
  const n = pdf.numPages;
  const raw = [], info = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    raw.push(itemsToLines(tc.items));
    info.push(await drawingsOn(page));
    page.cleanup();
    onProgress(i, n);
  }
  const pages = stripRepeatedLines(raw);
  if (pages.reduce((s, p) => s + p.join(' ').length, 0) < 2000) {
    throw new Error('This PDF has almost no text. It may be scanned pages (pictures of text), which PrepBuddy cannot read yet.');
  }

  let units = null, method = 'bookmarks';
  try { units = await fromOutline(pdf, pages); } catch (e) { units = null; }
  if (!units || units.length < 2) { units = fromHeadings(pages); method = 'headings'; }
  if (!units || units.length < 2) { units = byPages(pages, 8); method = 'pages'; }

  units = units
    .filter((u) => !SKIP_TITLE.test(u.title.trim()))
    .flatMap(splitLarge)
    .filter((u) => u.text.length >= (isChinese(u.text) ? MIN_UNIT_ZH : MIN_UNIT));

  // Pictures of the pages with diagrams, for diagram questions.
  try { await addFigures(pdf, units, raw, info, onProgress); } catch (e) { units.forEach((u) => { u.figures = u.figures || []; }); }

  let title = null;
  try { const meta = await pdf.getMetadata(); title = (meta && meta.info && meta.info.Title) || null; } catch (e) {}
  try { await task.destroy(); } catch (e) {}
  const pageTexts = pages.map(joinLines);
  return { title, pageCount: n, method, units, pageTexts, outline: outlineOf(raw, pages, units) };
}

/* ---------- chapter tidy-up and editing ----------
   The outline gives the AI what it needs to fix chapter names: the contents pages, and for every page its
   printed page number and first lines. */
function outlineOf(raw, pages, units) {
  const out = [];
  const toc = [];
  for (let i = 0; i < Math.min(pages.length, 20); i++) {
    if (pages[i].some((l) => /^(table of )?contents$|^目\s*錄$|^目\s*录$/i.test(l.trim()))) toc.push(i);
  }
  if (toc.length) {
    let t = '';
    for (let i = toc[0]; i < Math.min(pages.length, toc[0] + 6) && t.length < 9000; i++) t += `\n[PDF page ${i + 1}]\n` + pages[i].join('\n');
    out.push('CONTENTS PAGES:' + t.slice(0, 9000));
  }
  out.push('\nCURRENT CHAPTER GUESS:\n' + units.map((u) => `- "${u.title}" pages ${u.startPage}-${u.endPage}`).join('\n'));
  out.push('\nEVERY PAGE (PDF page, printed page number if found, first lines):');
  const per = Math.max(60, Math.min(220, Math.floor(60000 / Math.max(1, pages.length))));
  pages.forEach((lines, i) => {
    const r = raw[i] || [];
    const edge = [...r.slice(0, 2), ...r.slice(-2)].map((l) => l.trim());
    const num = (edge.find((l) => /^\d{1,4}$/.test(l)) || (edge.join(' ').match(/(?:^|\s)(\d{1,4})(?:\s|$)/) || [])[1] || '');
    out.push(`p${i + 1}${num ? ` (printed ${num})` : ''}: ${lines.slice(0, 3).join(' | ').slice(0, per)}`);
  });
  return out.join('\n');
}

// Units from a list of chapter starts: [{ title, start, skip }] (start = PDF page number).
export function unitsFromStarts(pageTexts, chapters) {
  const list = chapters.filter((c) => Number.isInteger(c.start) && c.start >= 1 && c.start <= pageTexts.length)
    .sort((a, b) => a.start - b.start).filter((c, i, a) => i === 0 || c.start !== a[i - 1].start);
  const units = [];
  list.forEach((c, i) => {
    const end = i + 1 < list.length ? list[i + 1].start - 1 : pageTexts.length;
    if (c.skip || end < c.start) return;
    units.push({ title: String(c.title || '').trim() || `Pages ${c.start}–${end}`, chapter: null, startPage: c.start, endPage: end, text: pageTexts.slice(c.start - 1, end).join('\n\n') });
  });
  return units.flatMap(splitLarge).filter((u) => u.text.length >= (isChinese(u.text) ? MIN_UNIT_ZH : MIN_UNIT));
}
export const pagesText = (pageTexts, start, end) => pageTexts.slice(start - 1, end).join('\n\n');

/* ---------- text ---------- */

function itemsToLines(items) {
  const lines = [];
  let cur = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    cur += it.str;
    if (it.hasEOL) { lines.push(cur); cur = ''; }
  }
  if (cur) lines.push(cur);
  // NFKC turns look-alike forms some Chinese PDFs use (e.g. ⽬ U+2F6C) into normal characters (目).
  return lines.map((l) => l.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Running headers and footers repeat on many pages (often with a changing page number): remove them.
function stripRepeatedLines(pages) {
  const key = (l) => l.replace(/\d+/g, '#').toLowerCase();
  const counts = new Map();
  for (const p of pages) for (const k of new Set(p.map(key))) counts.set(k, (counts.get(k) || 0) + 1);
  const limit = Math.max(4, pages.length * 0.15);
  return pages.map((p) => p.filter((l) => (counts.get(key(l)) || 0) < limit || l.length > 120));
}

function joinLines(lines) {
  return lines.join('\n').replace(/-\n(?=[a-z])/g, '').replace(/\n{3,}/g, '\n\n');
}

function slicePages(pages, start, end) { // inclusive page indexes
  return joinLines(pages.slice(start, end + 1).flat());
}

/* ---------- figures ----------
   A page probably has a diagram if it draws pictures or lots of lines, especially with a caption
   such as "Figure 2.3" or 「圖 2.3」. Up to MAX_FIGS such pages per chapter are saved as JPEG images. */
const MAX_FIGS = 6;
const CAPTION = /^(fig(ure)?\.?\s*\d|圖\s*[\d一二三四五六七八九十])/i;
async function drawingsOn(page) {
  try {
    const ops = await page.getOperatorList();
    let images = 0, paths = 0;
    for (const f of ops.fnArray) {
      if (f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject || f === pdfjs.OPS.paintImageMaskXObject) images++;
      else if (f === pdfjs.OPS.constructPath) paths++;
    }
    return { images, paths };
  } catch (e) { return { images: 0, paths: 0 }; }
}
async function addFigures(pdf, units, raw, info, onProgress) {
  // Pictures drawn on almost every page (logos, page borders) don't count.
  const med = (k) => { const v = info.map((x) => x[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || 0; };
  const baseImg = med('images'), basePath = med('paths');
  const score = info.map((x, i) => {
    const cap = raw[i].some((l) => CAPTION.test(l.trim()));
    const img = x.images - baseImg, path = x.paths - basePath;
    if (img <= 0 && path < 60) return 0;
    return (cap ? 3 : 0) + Math.min(img, 3) + (path >= 60 ? 1 : 0);
  });
  const chosen = new Map(); // page index -> image
  const plan = units.map((u) => {
    if (!u.startPage) return [];
    const pages = [];
    for (let p = u.startPage - 1; p <= Math.min(u.endPage - 1, score.length - 1); p++) if (score[p] >= 2) pages.push(p);
    return pages.sort((a, b) => score[b] - score[a]).slice(0, MAX_FIGS).sort((a, b) => a - b);
  });
  const all = [...new Set(plan.flat())];
  for (let k = 0; k < all.length; k++) {
    const p = all[k];
    const img = await pageImage(pdf, p + 1);
    let rects = [];
    try { const pg = await pdf.getPage(p + 1); rects = await imageRects(pg); pg.cleanup(); } catch (e) {}
    chosen.set(p, img ? { img, rects } : null);
    onProgress(info.length, info.length, `Saving diagrams ${k + 1} of ${all.length}`);
  }
  units.forEach((u, i) => { u.figures = plan[i].map((p) => ({ page: p + 1, ...(chosen.get(p) || {}) })).filter((f) => f.img); });
}
// Exact positions of the pictures drawn on a page, as [left, top, right, bottom] fractions of the page.
// Used to make diagram crops include the whole picture even when the AI's box is a little off.
async function imageRects(page) {
  try {
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const O = pdfjs.OPS;
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = [], rects = [];
    ops.fnArray.forEach((f, i) => {
      const a = ops.argsArray[i];
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.transform) ctm = mul(ctm, a);
      else if (f === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(ctm, a[0]); }
      else if (f === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
        const xs = pts.map((p) => p[0] / vp.width), ys = pts.map((p) => p[1] / vp.height);
        const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000);
        const w = r[2] - r[0], h = r[3] - r[1];
        if (w > 0.06 && h > 0.04 && !(w > 0.95 && h > 0.95)) rects.push(r);
      }
    });
    // merge pictures that overlap (e.g. a photo split into tiles)
    const out = [];
    for (const r of rects) {
      const o = out.find((q) => !(r[2] < q[0] - 0.01 || r[0] > q[2] + 0.01 || r[3] < q[1] - 0.01 || r[1] > q[3] + 0.01));
      if (o) { o[0] = Math.min(o[0], r[0]); o[1] = Math.min(o[1], r[1]); o[2] = Math.max(o[2], r[2]); o[3] = Math.max(o[3], r[3]); } else out.push([...r]);
    }
    return out.slice(0, 8);
  } catch (e) { return []; }
}

async function pageImage(pdf, num) {
  if (typeof document === 'undefined') return null;
  const page = await pdf.getPage(num);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, 1100 / v1.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const url = canvas.toDataURL('image/jpeg', 0.72);
  canvas.width = canvas.height = 0;
  return url;
}

/* ---------- 1. bookmarks ---------- */

async function fromOutline(pdf, pages) {
  const outline = await pdf.getOutline();
  if (!outline || !outline.length) return null;

  async function pageOf(item) {
    let dest = item.dest;
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest) || !dest.length) return null;
    const ref = dest[0];
    if (typeof ref === 'number') return ref;
    return pdf.getPageIndex(ref);
  }
  async function resolve(items) {
    const out = [];
    for (const it of items) {
      const page = await pageOf(it).catch(() => null);
      out.push({ title: (it.title || '').trim(), page, children: it.items && it.items.length ? await resolve(it.items) : [] });
    }
    return out;
  }
  const top = (await resolve(outline)).filter((t) => t.page !== null);
  if (!top.length) return null;
  top.sort((a, b) => a.page - b.page);

  // Big chapters with sub-bookmarks are split into their sections.
  const entries = [];
  top.forEach((t, i) => {
    const next = i + 1 < top.length ? top[i + 1].page : pages.length;
    const kids = t.children.filter((c) => c.page !== null && c.page >= t.page && c.page < next);
    if (kids.length >= 2 && next - t.page > 20) {
      kids.sort((a, b) => a.page - b.page).forEach((k) => entries.push({ title: k.title, page: k.page, chapter: t.title }));
    } else {
      entries.push({ title: t.title, page: t.page, chapter: null });
    }
  });

  return entries.map((e, i) => {
    const end = i + 1 < entries.length ? Math.max(e.page, entries[i + 1].page - (entries[i + 1].page > e.page ? 1 : 0)) : pages.length - 1;
    return { title: e.title, chapter: e.chapter, startPage: e.page + 1, endPage: end + 1, text: slicePages(pages, e.page, end) };
  });
}

/* ---------- 2. numbered headings ---------- */

// Chinese numerals 一 … 九十九 (and plain digits) to numbers.
function zhNum(t) {
  if (/^\d+$/.test(t)) return Number(t);
  const d = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (t === '十') return 10;
  const m = t.match(/^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
  return t.length === 1 && t in d ? d[t] : NaN;
}
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15 };
const ZHN = '[零〇一二兩三四五六七八九十]{1,3}|\\d{1,2}';

// Kinds of heading a textbook may use. Each gives the heading's number (for checking order) and its title.
const HEADING_KINDS = [
  // "2.1 Water" or "2.1 細胞的結構" (Chinese titles can be short and may follow the number without a space)
  { re: /^(\d{1,2}\.\d{1,2})(?:\s+([A-Z][^•|]{3,100})|\s*([㐀-鿿][^•|]{1,60}))$/,
    key: (m) => m[1].split('.').map(Number), title: (m) => `${m[1]} ${(m[2] || m[3]).trim()}` },
  // "第一章 交通標誌" / "第3課 光合作用" / "第二部分" / "單元四 …"
  { re: new RegExp(`^(?:第\\s*(${ZHN})\\s*([章課课單单元部篇節节])(?:分)?|(單元|单元)\\s*(${ZHN}))[\\s:：、．.]*([^•|]{0,40})$`),
    key: (m) => [zhNum(m[1] || m[4])], title: (m) => `${m[0].replace(/\s+/g, ' ').trim()}` },
  // "Chapter 3 Cells", "Unit 2: Forces", "Part IV – …"
  { re: /^(Chapter|Unit|Part|Topic|Module|Lesson|Section)\s+(\d{1,2}|[IVX]{1,5})\b[\s:.\-–—]*([^•|]{0,90})$/i,
    key: (m) => [/^\d+$/.test(m[2]) ? Number(m[2]) : ROMAN[m[2].toUpperCase()]], title: (m) => m[0].replace(/\s+/g, ' ').trim() },
  // "一、引言" (common in Chinese documents)
  { re: new RegExp(`^(${ZHN.split('|')[0]})\\s*[、．]\\s*([\\u3400-\\u9fff][^•|]{1,40})$`),
    key: (m) => [zhNum(m[1])], title: (m) => m[0].replace(/\s+/g, ' ').trim() },
];

function fromHeadings(pages) {
  let best = null;
  for (const kind of HEADING_KINDS) {
    const units = headingsOfKind(pages, kind);
    if (units && units.length <= 80 && (!best || units.length > best.length)) best = units;
  }
  return best;
}

function headingsOfKind(pages, kind) {
  // The same heading also appears in contents pages and summaries.
  // The real heading is the copy followed by the most text before the next heading.
  const occ = [];
  let offset = 0;
  pages.forEach((lines, p) => lines.forEach((line, l) => {
    const m = line.length <= 110 && line.match(kind.re);
    if (m) {
      const k = kind.key(m), t = kind.title(m);
      if (k.every((x) => Number.isFinite(x)) && !/\d\s*$/.test(t.replace(/^\S+\s*/, '')) && !/[.…·]{3,}/.test(t)) occ.push({ num: k.join('.'), k, p, l, offset, title: t });
    }
    offset += line.length + 1;
  }));
  if (occ.length < 2) return null;
  occ.forEach((o, i) => { o.gap = (i + 1 < occ.length ? occ[i + 1].offset : offset) - o.offset; });
  const top = new Map();
  for (const o of occ) if (!top.has(o.num) || o.gap > top.get(o.num).gap) top.set(o.num, o);
  const minGap = isChinese(pages.slice(0, 30).flat().join('')) ? MIN_UNIT_ZH : MIN_UNIT;
  const cand = [...top.values()].filter((o) => o.gap >= minGap).sort((a, b) => a.offset - b.offset);
  // keep the heaviest run of headings whose numbers go up through the book
  const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
  const score = cand.map((o) => o.gap), prev = cand.map(() => -1);
  for (let i = 0; i < cand.length; i++) for (let j = 0; j < i; j++) {
    if (cmp(cand[j].k, cand[i].k) < 0 && score[j] + cand[i].gap > score[i]) { score[i] = score[j] + cand[i].gap; prev[i] = j; }
  }
  let k = score.indexOf(Math.max(...score));
  const heads = [];
  while (k >= 0) { heads.unshift(cand[k]); k = prev[k]; }
  if (heads.length < 2) return null;
  const units = heads.map((h, i) => {
    const nx = heads[i + 1];
    const lines = [];
    const endP = nx ? nx.p : pages.length - 1;
    for (let p = h.p; p <= endP; p++) {
      const from = p === h.p ? h.l : 0;
      const to = nx && p === nx.p ? nx.l : pages[p].length;
      lines.push(...pages[p].slice(from, to));
    }
    return { title: h.title, chapter: null, startPage: h.p + 1, endPage: endP + 1, text: joinLines(lines) };
  });
  return units;
}

/* ---------- 3. fixed page chunks ---------- */

function byPages(pages, size) {
  const units = [];
  for (let s = 0; s < pages.length; s += size) {
    const e = Math.min(pages.length - 1, s + size - 1);
    units.push({ title: `Part ${units.length + 1}`, chapter: null, startPage: s + 1, endPage: e + 1, text: slicePages(pages, s, e) });
  }
  return units;
}

// Chinese uses more AI tokens per character, so Chinese chapters are split smaller.
const isChinese = (t) => { const x = t.slice(0, 20000); return (x.match(/[\u3400-\u9fff]/g) || []).length > (x.match(/[A-Za-z]{2,}/g) || []).length; };
function splitLarge(u) {
  const zh = isChinese(u.text), max = zh ? 25000 : MAX_UNIT, size0 = zh ? 18000 : 40000;
  if (u.text.length <= max) return [u];
  const parts = Math.ceil(u.text.length / size0);
  const size = Math.ceil(u.text.length / parts);
  const out = [];
  let pos = 0;
  for (let k = 1; k <= parts; k++) {
    let end = k === parts ? u.text.length : u.text.indexOf('\n', pos + size);
    if (end === -1) end = u.text.length;
    out.push({ ...u, title: `${u.title} (part ${k} of ${parts})`, text: u.text.slice(pos, end) });
    pos = end;
  }
  return out;
}
