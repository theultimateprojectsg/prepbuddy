// Reads an ebook PDF on the student's own device and splits it into study units.
// Order of preference: the PDF's own bookmarks, then numbered headings ("2.1 Water"), then 8-page chunks.

import * as pdfjs from '../vendor/pdf.min.mjs';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
}

const MAX_UNIT = 60000;   // characters; bigger units are split into parts
const MIN_UNIT = 1500;    // smaller units are dropped (title pages, blank sections)
const MIN_UNIT_ZH = 600;  // the same for Chinese, which packs more into fewer characters
const SKIP_TITLE = /^(table of )?contents$|^index$|^preface|^acknowledg|^copyright|^about (the|this)|^cover$|^title page|^bibliography|^references$|^answer key|^dedication|^目錄$|^目录$|^索引$|^序言?$|^前言$|^鳴謝$|^版權|^參考(書目|資料)$|^答案$/i;

export async function readBook(data, onProgress = () => {}) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const pdf = await task.promise;
  const n = pdf.numPages;
  const raw = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    raw.push(itemsToLines(tc.items));
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

  let title = null;
  try { const meta = await pdf.getMetadata(); title = (meta && meta.info && meta.info.Title) || null; } catch (e) {}
  try { await task.destroy(); } catch (e) {}
  return { title, pageCount: n, method, units };
}

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

function fromHeadings(pages) {
  // Numbered section headings ("2.1 Water") also appear in chapter outlines and summaries.
  // The real heading is the copy followed by the most text before the next heading.
  // "2.1 Water" or "2.1 細胞的結構" (Chinese titles can be short and may follow the number without a space)
  const re = /^(\d{1,2}\.\d{1,2})(?:\s+([A-Z][^•|]{3,100})|\s*([\u3400-\u9fff][^•|]{1,60}))$/;
  const occ = [];
  let offset = 0;
  pages.forEach((lines, p) => lines.forEach((line, l) => {
    const m = line.match(re);
    const t = m && (m[2] || m[3]);
    if (m && !/\d\s*$/.test(t) && !/[.…·]{3,}/.test(t)) occ.push({ num: m[1], p, l, offset, title: `${m[1]} ${t.trim()}` });
    offset += line.length + 1;
  }));
  if (occ.length < 2) return null;
  occ.forEach((o, i) => { o.gap = (i + 1 < occ.length ? occ[i + 1].offset : offset) - o.offset; });
  const best = new Map();
  for (const o of occ) if (!best.has(o.num) || o.gap > best.get(o.num).gap) best.set(o.num, o);
  const minGap = isChinese(pages.slice(0, 30).flat().join('')) ? MIN_UNIT_ZH : MIN_UNIT;
  const cand = [...best.values()].filter((o) => o.gap >= minGap).sort((a, b) => a.offset - b.offset);
  // keep the heaviest run of headings whose numbers go up through the book
  const cmp = (a, b) => { const [a1, a2] = a.split('.').map(Number), [b1, b2] = b.split('.').map(Number); return a1 - b1 || a2 - b2; };
  const score = cand.map((o) => o.gap), prev = cand.map(() => -1);
  for (let i = 0; i < cand.length; i++) for (let j = 0; j < i; j++) {
    if (cmp(cand[j].num, cand[i].num) < 0 && score[j] + cand[i].gap > score[i]) { score[i] = score[j] + cand[i].gap; prev[i] = j; }
  }
  let k = score.indexOf(Math.max(...score));
  const heads = [];
  while (k >= 0) { heads.unshift(cand[k]); k = prev[k]; }
  if (heads.length < 2) return null;
  return heads.map((h, i) => {
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
}

/* ---------- 3. fixed page chunks ---------- */

function byPages(pages, size) {
  const units = [];
  for (let s = 0; s < pages.length; s += size) {
    const e = Math.min(pages.length - 1, s + size - 1);
    units.push({ title: `Pages ${s + 1}–${e + 1}`, chapter: null, startPage: s + 1, endPage: e + 1, text: slicePages(pages, s, e) });
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
