// The student profile a parent sets up (grade, school language, pace, goals, interests), turned into a short guide
// that goes into every AI call, so questions, marking, Buddy, lessons and notes all fit this child's age and level.
// Only these few fields are sent; never a name or school.

const GRADES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const band = (g) => (/^P[12]$/.test(g) ? 'p12' : /^P[34]$/.test(g) ? 'p34' : /^P[56]$/.test(g) ? 'p56' : /^S[123]$/.test(g) ? 's13' : 's46');
const NAME = { P1: 'Primary 1', P2: 'Primary 2', P3: 'Primary 3', P4: 'Primary 4', P5: 'Primary 5', P6: 'Primary 6', S1: 'Secondary 1', S2: 'Secondary 2', S3: 'Secondary 3', S4: 'Secondary 4', S5: 'Secondary 5', S6: 'Secondary 6' };
const AGE = { P1: '6-7', P2: '7-8', P3: '8-9', P4: '9-10', P5: '10-11', P6: '11-12', S1: '12-13', S2: '13-14', S3: '14-15', S4: '15-16', S5: '16-17', S6: '17-18' };

// One guide per stage. Written to be read by the AI, short and concrete.
const GUIDES = {
  p12: `STAGE: lower primary (P1-P2). A young child who is still learning to read; a parent may be sitting with them.
- Words: very short sentences (under about 12 words), everyday words, one idea at a time. Use the textbook's own words for key terms. No abstract terms.
- Questions: short and concrete, about things a young child knows (family, school, food, animals, toys). MCQ with short options; fill in the blank; true or false written as a 2-option MCQ; matching written as MCQ. Numbers within what the textbook uses (usually under 100 at P1, under 1000 at P2).
- Chinese questions: 字詞, 配詞, 填充, 量詞, simple 造句 and 標點, very short 閱讀 (2-4 sentences).
- English questions: phonics and spelling, simple vocabulary, a/an, is/are, plurals, very short reading (2-4 sentences).
- Maths questions: counting, adding and taking away, simple word problems in one step, shapes, money, time, as the chapter teaches.
- A SHORT-ANSWER question is 1 mark (a word or a short phrase). A STRUCTURED question is at most 2 short parts and 3 marks in total, with a tiny scenario. Levels 1-4 are relative to this grade: level 4 is a harder P1/P2 school-test question, never older content.
- Explaining (Buddy, lessons, notes): like a kind older sibling. Use a picture-like everyday example (sweets, toys, the MTR, pets). 1-3 short sentences, then one small question back. Notes are a few very short points.
- Marking and feedback: be generous with spelling and wording unless the question tests spelling or the exact word. Praise the effort first, then one small, clear fix. Never more than one thing to fix at a time.
- Avoid: exam language ("candidates", "marks are awarded"), long stems, anything that needs fluent reading, sarcasm or pressure.`,
  p34: `STAGE: middle primary (P3-P4). The child reads on their own but still needs short, clear text. P3 students sit the TSA in Chinese, English and Maths.
- Words: short sentences (under about 18 words), common words, textbook terms explained in plain words.
- Questions: school-test style. MCQ, fill in the blank, short answers, rearranging words into a sentence, simple reading comprehension (one short paragraph), one- or two-step word problems.
- Chinese questions: 字詞, 配詞, 詞語運用, 造句, 重組句子, 標點, 修辭 basics as taught, short 閱讀理解.
- English questions: grammar fill-ins (tenses, prepositions, pronouns, connectives as taught), vocabulary, rearranging sentences, short reading comprehension.
- Maths questions: the four operations, fractions as taught, measurement, time, money, shapes, simple data, word problems in 1-2 steps.
- A SHORT-ANSWER question is 1-2 marks. A STRUCTURED question is 2-3 short parts, 3-5 marks in total. Levels 1-4 are relative to this grade: level 4 is a stretching P3/P4 school-exam question, never secondary content.
- Explaining: friendly and encouraging, simple steps, one everyday example. 2-4 short sentences, or a few short steps for maths. Notes: short points with an example each.
- Marking and feedback: kind and specific. Accept small spelling slips unless spelling is being tested. Say what they got right, then the one or two things to fix.
- Avoid: exam jargon, long multi-part stems, DSE-style analysis.`,
  p56: `STAGE: upper primary (P5-P6). Results in P5 term 2 and both P6 terms count towards secondary school places (呈分試), so school exams matter a lot to parents.
- Words: clear and direct; textbook terms are fine, with a short explanation when new.
- Questions: Hong Kong primary school exam style. MCQ, fill in the blank, short answers, reading comprehension (one or two paragraphs), multi-step word problems with working, simple reasoning questions.
- Chinese questions: 詞語運用, 句式, 修辭, 標點, 改錯字, 閱讀理解 (including the writer's feelings and purpose), as taught.
- English questions: grammar in context (tenses, passive as taught, connectives), vocabulary, cloze, reading comprehension, short guided writing tasks.
- Maths questions: fractions, decimals, percentages, speed, volume, area, angles, simple equations as taught; multi-step word problems where the working earns marks.
- A SHORT-ANSWER question is 1-3 marks. A STRUCTURED question is 2-4 parts, 4-6 marks in total. Levels 1-4 are relative to this grade: level 4 is a demanding P5/P6 school-exam question.
- Explaining: clear steps and the reason behind them; exam tips are welcome ("show your working", "underline the key words"). Notes: exam-ready points.
- Marking and feedback: like a fair primary teacher. Award method marks for correct working. Say exactly which step or word lost the mark and how to fix it.
- Avoid: secondary-level content or DSE terms, and long lectures.`,
  s13: `STAGE: junior secondary (S1-S3). Building the base for senior secondary; many students are moving to more English-medium learning. S3 students may sit the TSA.
- Words: clear secondary-school language; explain new subject terms briefly.
- Questions: school-exam style for junior secondary, with short and longer answers; DSE-style only in a simplified form.
- A STRUCTURED question is 2-4 parts, 4-8 marks in total. Levels 1-4 are relative to junior secondary.
- Explaining: step by step, linking to what they already know; point out common mistakes. Notes: concise points.
- Marking and feedback: specific and fair; method marks for working.`,
  s46: `STAGE: senior secondary (S4-S6), preparing for the HKDSE. The default HKDSE style applies.`,
};

// What levels 1-4 mean at each stage (the default HKDSE meanings are in lib/claude.js).
const BAND_LEVELS = {
  p12: { 1: 'Recall: a word, fact or number straight from the page.', 2: 'Understand: say the idea in simple words or pick the right meaning.', 3: 'Apply: use it in a very simple everyday example (one step).', 4: 'Think: compare two things or choose the best answer with a reason, still with P1-P2 words and numbers.' },
  p34: { 1: 'Recall: a word, fact or definition from the chapter.', 2: 'Understand: explain the idea or use the word correctly in a sentence.', 3: 'Apply: use it in a short everyday scenario or a one- or two-step problem.', 4: 'Think: a stretching P3-P4 school-exam question (two steps, compare, give a reason), never older content.' },
  p56: { 1: 'Recall: a fact, term or rule from the chapter.', 2: 'Understand: explain in their own words, or interpret a sentence or table.', 3: 'Apply: a multi-step word problem or a new example, as in P5-P6 school exams.', 4: 'Reason: a demanding P5-P6 school-exam question (several steps, infer from a passage or data, justify), never secondary content.' },
  s13: { 1: 'Recall: state facts, terms or definitions.', 2: 'Understand: explain a process or idea in their own words.', 3: 'Apply: use it on data, a table or a new example.', 4: 'Analyse: a less familiar scenario at junior-secondary level; explain, compare or predict with reasons.' },
};
function levelText(level, l) {
  const g = l && String(l.grade || '').toUpperCase();
  const b = GRADES.includes(g) ? band(g) : '';
  return (BAND_LEVELS[b] || {})[level] || '';
}

// Children outside Hong Kong: the country's grade names, exams and conventions replace the Hong Kong ones.
const NUM = (g) => GRADES.indexOf(g) + 1;
const COUNTRY = {
  sg: { name: 'Singapore', grade: (g) => (g[0] === 'P' ? `Primary ${g[1]}` : +g[1] <= 4 ? `Secondary ${g[1]}` : `Junior College ${+g[1] - 4}`),
    rules: 'Follow the Singapore MOE syllabus and Singapore school-test style. Key exams: PSLE at Primary 6 (Achievement Levels AL1-AL8), O-Level / N-Level at Secondary 4-5, A-Level at JC2. Mother Tongue Chinese is taught in Mandarin with Simplified Chinese characters: write Chinese work in Simplified Chinese unless the textbook uses Traditional. Use British spelling and Singapore everyday examples (MRT, hawker centre, HDB flat).' },
  fr: { name: 'France', grade: (g) => ({ P1: 'CP', P2: 'CE1', P3: 'CE2', P4: 'CM1', P5: 'CM2', P6: '6e', S1: '5e', S2: '4e', S3: '3e', S4: 'Seconde', S5: 'Première', S6: 'Terminale' }[g]),
    rules: 'Follow the French Éducation nationale programmes and French school style: contrôles and devoirs marked out of 20, the diplôme national du brevet at the end of 3e, the baccalauréat (épreuves anticipées in Première, final exams in Terminale). Use French conventions (decimal comma, French maths notation and vocabulary) and French everyday examples.' },
  jp: { name: 'Japan', grade: (g) => (g[0] === 'P' ? `小学${g[1]}年` : +g[1] <= 3 ? `中学${g[1]}年` : `高校${+g[1] - 3}年`),
    rules: 'Follow the Japanese 学習指導要領 and Japanese school-test style: 単元テスト and 定期テスト usually marked out of 100, 中学受験 / 高校受験 entrance exams, and the 大学入学共通テスト. Use only the kanji taught up to this grade (add readings for others), Japanese maths conventions and Japanese everyday examples.' },
  intl: { name: 'an international or other school system', grade: (g) => `Grade ${NUM(g)}`,
    rules: 'Use a neutral international school-test style and everyday examples that work anywhere. Follow the textbook for spelling and conventions.' },
};
function countryText(l, g) {
  const c = COUNTRY[l.country]; if (!c) return '';
  return `- School system: ${c.name}, grade ${c.grade(g)}. IMPORTANT: this child is NOT in Hong Kong. Wherever these instructions mention Hong Kong, the HKDSE, the TSA, 呈分試, Hong Kong primary exams or Hong Kong examples (the MTR and so on), use the equivalent for this school system instead, and never mention the Hong Kong ones. ${c.rules}`;
}

function clean(s, n) { return String(s || '').replace(/[<>"'`\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

// Builds the guide text from a request's "learner" field. Returns '' if there is no valid profile.
function learnerText(l) {
  if (!l || typeof l !== 'object') return '';
  const g = String(l.grade || '').toUpperCase();
  if (!GRADES.includes(g)) return '';
  const lines = [`ABOUT THIS STUDENT (from their parent). These rules decide the reading level, question style, length and tone for everything you write for this student. Where they differ from the default HKDSE style or a stated age elsewhere, follow these.`,
    COUNTRY[l.country] ? `- Grade: ${COUNTRY[l.country].grade(g)}, age about ${AGE[g]}.` : `- Grade: ${NAME[g]} (${g}), age about ${AGE[g]}.`];
  const ct = countryText(l, g); if (ct) lines.push(ct);
  if (l.pace === 'support') lines.push('- Needs extra support: start easier, use smaller steps and more examples, and be extra encouraging. Prefer levels 1-2 unless asked for harder questions.');
  if (l.pace === 'ahead') lines.push('- Working ahead of their grade: harder questions are welcome, but keep the wording at their reading level.');
  if (l.medium === 'emi') lines.push('- Their school teaches mainly in English.');
  if (l.medium === 'cmi') lines.push('- Their school teaches mainly in Chinese (Cantonese). When they write to you in Chinese or Cantonese, reply in Chinese.');
  if (l.zhLang === 'cmn') lines.push('- Their school teaches Chinese Language in Putonghua (普教中). For Chinese Language work, prefer standard written Chinese and Putonghua usage; avoid Cantonese colloquial words (e.g. use 他們, 不是, 的 rather than 佢哋, 唔係, 嘅).');
  const EX = {
    en: 'Explain in English (simple English for their grade), even when they write to you in Chinese.',
    zh: 'Explain in Traditional Chinese (Hong Kong written Chinese), even for subjects taught in English. Keep the key English subject terms from their textbook in brackets, e.g. 光合作用 (photosynthesis), so they can still answer in English.',
    mix: 'Explain in Traditional Chinese, but use the English words for key subject terms as their textbook does, so they learn the English terms.',
  };
  if (EX[l.explain]) lines.push(`- Parent's choice of explanation language: ${EX[l.explain]} This applies to explanations, hints, feedback and chat. It does not change the language of practice questions or model answers, which follow the textbook (English Language work stays in English; Chinese Language work stays in Chinese).`);
  if (l.explain === 'zh' || l.explain === 'mix') lines.push('- EXCEPTION for English Language work (the book or question teaches English itself: grammar, vocabulary, reading, writing): English is what they are learning, so explain in simple English at their grade, the way their English teacher would. Help with Chinese only in brackets: the Chinese name of a grammar term the first time it appears, e.g. simple past tense (一般過去時), or the meaning of a hard word, e.g. borrow (借).' + (l.explain === 'zh' ? ' If a rule is hard to follow, you may add ONE short Chinese tip sentence after the English explanation.' : '') + ' Never write a whole explanation in Chinese for English Language work, unless the student asks you to in chat. For Chinese Language and all other subjects, follow the choice above.');
  const GN = { tests: 'school tests and exams', tsa: 'the TSA', ssa: '呈分試 (school exams that count for secondary places)', dse: 'the HKDSE', habits: 'building a regular study habit',
    psle: 'the PSLE', olevel: 'O-Level / N-Level exams', alevel: 'A-Level exams', brevet: 'the brevet', bac: 'the baccalauréat',
    juken_j: '中学受験 (junior high entrance exams)', juken_h: '高校受験 (high school entrance exams)', juken_u: 'university entrance exams (大学入学共通テスト and 二次試験)' };
  const goals = (Array.isArray(l.goals) ? l.goals : []).filter((x) => GN[x]);
  if (goals.length) lines.push(`- Working towards: ${goals.map((x) => GN[x]).join(', ')}.`);
  const likes = clean(l.likes, 80);
  if (likes) lines.push(`- Likes: ${likes}. When an example helps, you may use these, but never force it and never change the textbook facts.`);
  lines.push('', GUIDES[band(g)]);
  return lines.join('\n');
}

// Adds the guide to an AI request's system prompt (an array of blocks, or a string), just before the textbook
// section, so the section can still be cached together with it.
function withLearner(system, text) {
  if (!text) return system;
  if (Array.isArray(system)) { const s = system.slice(); s.splice(Math.min(1, s.length), 0, { type: 'text', text }); return s; }
  return `${system || ''}\n\n${text}`;
}
// The guide rides on the usage object every AI call already receives (not sent back to the browser).
function attachLearner(usage, body) {
  const text = learnerText(body && body.learner);
  if (usage && text) Object.defineProperty(usage, 'learner', { value: text, enumerable: false, writable: true });
  return usage;
}

module.exports = { GRADES, band, learnerText, withLearner, attachLearner, levelText };
