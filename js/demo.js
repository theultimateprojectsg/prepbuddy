// A small sample book for the guided tour: one chapter with its text, questions, lesson, notes and flashcards
// already made, so the tour can open every screen instantly without calling the AI. It is added for the tour
// and removed when the tour ends; it is never counted in progress or sent in pilot summaries.
import * as store from './store.js';

export const DEMO_ID = 'demo-tour';
const U = 'u0';

const EN = {
  title: 'Sample book: The Water Cycle', subject: 'Science', level: 'Sample', unit: 'Chapter 1 The Water Cycle',
  text: `The water cycle is the continuous movement of water between the land, the oceans and the air. It is powered by energy from the Sun.

Evaporation: the Sun heats water in oceans, rivers and lakes. Liquid water turns into water vapour, an invisible gas, and rises into the air. Plants also release water vapour from their leaves; this is called transpiration.

Condensation: as water vapour rises, it cools. Cool water vapour turns back into tiny liquid water droplets. Billions of droplets together form clouds.

Precipitation: when the droplets in a cloud join together and become too heavy, they fall as rain, snow, sleet or hail.

Collection: the water collects in oceans, rivers and lakes, or soaks into the ground as groundwater. Then the cycle starts again.

The water cycle matters because it brings fresh water to people, animals and plants, and it helps to move heat around the Earth.`,
  qs: [
    { type: 'mcq', level: 1, stem: 'What powers the water cycle?', options: ['The Moon', 'Energy from the Sun', 'Wind from the oceans', 'Heat from inside the Earth'], correct_option: 'B', explanation: 'The Sun heats water so that it evaporates, which keeps the cycle going.', source_quote: 'It is powered by energy from the Sun.' },
    { type: 'mcq', level: 1, stem: 'What is evaporation?', options: ['Water vapour turning into droplets', 'Rain falling from clouds', 'Liquid water turning into water vapour', 'Water soaking into the ground'], correct_option: 'C', explanation: 'In evaporation, heated liquid water turns into water vapour, a gas.', source_quote: 'Liquid water turns into water vapour, an invisible gas, and rises into the air.' },
    { type: 'mcq', level: 2, stem: 'How are clouds formed?', options: ['Water vapour cools and condenses into tiny droplets', 'Rain rises back into the sky', 'The Sun makes new water in the air', 'Wind carries sea water into the sky'], correct_option: 'A', explanation: 'Rising water vapour cools and condenses into droplets; billions of droplets form a cloud.', source_quote: 'Cool water vapour turns back into tiny liquid water droplets.' },
    { type: 'mcq', level: 2, stem: 'Which of these is NOT a type of precipitation?', options: ['Snow', 'Hail', 'Sleet', 'Water vapour'], correct_option: 'D', explanation: 'Water vapour is a gas in the air. Precipitation is water falling as rain, snow, sleet or hail.', source_quote: 'they fall as rain, snow, sleet or hail.' },
    { type: 'mcq', level: 2, stem: 'What is transpiration?', options: ['Rain soaking into soil', 'Plants releasing water vapour from their leaves', 'Clouds moving across the sky', 'Ice melting in spring'], correct_option: 'B', explanation: 'Transpiration is water vapour given off by the leaves of plants.', source_quote: 'Plants also release water vapour from their leaves; this is called transpiration.' },
    { type: 'short', level: 2, stem: 'Answer in one or two sentences.', parts: [{ label: '', prompt: 'Explain why the water cycle is important.', marks: 2, mark_scheme: ['It brings fresh water to people, animals and plants', 'It helps to move heat around the Earth'] }], explanation: 'Two reasons are given in the text: fresh water, and moving heat around the Earth.', source_quote: 'The water cycle matters because it brings fresh water to people, animals and plants' },
  ],
  lesson: { intro: 'Water is always on the move. Let’s follow one drop around the water cycle.', steps: [
    { heading: 'Evaporation', explain: 'The Sun heats water in oceans, rivers and lakes. The liquid water turns into **water vapour**, a gas you can’t see, and rises into the air.', example: 'A puddle disappears on a sunny day: its water has evaporated.', check: { question: 'What does evaporation turn liquid water into?', options: ['Ice', 'Water vapour', 'Clouds'], answer: 1, why: 'Heated liquid water becomes water vapour, a gas.' } },
    { heading: 'Condensation', explain: 'As water vapour rises it cools, and turns back into tiny liquid **droplets**. Billions of droplets together make a **cloud**.', example: 'Drops form on the outside of a cold glass of water.', check: { question: 'What happens when water vapour cools?', options: ['It condenses into droplets', 'It disappears', 'It gets heavier and falls straight away'], answer: 0, why: 'Cooling makes the vapour condense into droplets.' } },
    { heading: 'Precipitation and collection', explain: 'When droplets join and get too heavy, they fall as **rain, snow, sleet or hail**. The water collects in oceans, rivers and lakes, or soaks into the ground, and the cycle starts again.', check: { question: 'Which is a type of precipitation?', options: ['Water vapour', 'Hail', 'Transpiration'], answer: 1, why: 'Hail is water falling from clouds as ice.' } },
  ], summary: ['The Sun powers the water cycle.', 'Evaporation → condensation → precipitation → collection.', 'It brings fresh water and moves heat around the Earth.'] },
  notes: { sections: [
    { heading: 'Evaporation', points: ['The Sun heats water in oceans, rivers and lakes.', 'Liquid water becomes **water vapour** (a gas) and rises.', 'Plants release water vapour from leaves: **transpiration**.'] },
    { heading: 'Condensation', points: ['Rising water vapour cools.', 'It turns back into tiny liquid droplets.', 'Billions of droplets form clouds.'] },
    { heading: 'Precipitation and collection', points: ['Heavy droplets fall as rain, snow, sleet or hail.', 'Water collects in oceans, rivers, lakes and as groundwater.'] },
  ], key_terms: [{ term: 'Evaporation', meaning: 'Liquid water turning into water vapour.' }, { term: 'Condensation', meaning: 'Water vapour cooling into liquid droplets.' }, { term: 'Precipitation', meaning: 'Water falling from clouds as rain, snow, sleet or hail.' }, { term: 'Transpiration', meaning: 'Water vapour released from plant leaves.' }],
  formulas: [], flashcards: [
    { front: 'What powers the water cycle?', back: 'Energy from the Sun.' }, { front: 'Evaporation', back: 'Liquid water turning into water vapour, a gas.' }, { front: 'Condensation', back: 'Water vapour cooling into tiny liquid droplets, which form clouds.' },
    { front: 'Name four kinds of precipitation', back: 'Rain, snow, sleet and hail.' }, { front: 'Transpiration', back: 'Water vapour given off by plant leaves.' }, { front: 'Why does the water cycle matter?', back: 'It brings fresh water to living things and moves heat around the Earth.' } ] },
};

const ZH = {
  title: '示範課本：水循環', subject: '科學', level: '示範', unit: '第一章 水循環',
  text: `水循環是指水在陸地、海洋和空氣之間不停流動的過程，由太陽的能量推動。

蒸發：太陽加熱海洋、河流和湖泊中的水，液態水變成看不見的水蒸氣並上升到空氣中。植物的葉子也會釋放水蒸氣，這稱為蒸騰作用。

凝結：水蒸氣上升時會冷卻，變回微小的液態水點。數以十億計的水點聚在一起便形成雲。

降水：雲中的水點結合並變得太重時，便會以雨、雪、雨夾雪或冰雹的形式落下。

匯集：水匯集在海洋、河流和湖泊中，或滲入地下成為地下水，然後循環再次開始。

水循環很重要，因為它為人類、動物和植物帶來淡水，並幫助把熱量帶到地球各處。`,
  qs: [
    { type: 'mcq', level: 1, stem: '推動水循環的是甚麼？', options: ['月亮', '太陽的能量', '海風', '地球內部的熱'], correct_option: 'B', explanation: '太陽加熱水令水蒸發，使循環持續進行。', source_quote: '由太陽的能量推動。' },
    { type: 'mcq', level: 1, stem: '甚麼是蒸發？', options: ['水蒸氣變成水點', '雨從雲中落下', '液態水變成水蒸氣', '水滲入地下'], correct_option: 'C', explanation: '蒸發時，受熱的液態水變成水蒸氣。', source_quote: '液態水變成看不見的水蒸氣並上升到空氣中。' },
    { type: 'mcq', level: 2, stem: '雲是怎樣形成的？', options: ['水蒸氣冷卻並凝結成微小水點', '雨水升回天空', '太陽在空氣中製造新的水', '風把海水吹上天空'], correct_option: 'A', explanation: '上升的水蒸氣冷卻並凝結成水點，大量水點便形成雲。', source_quote: '變回微小的液態水點。' },
    { type: 'mcq', level: 2, stem: '以下哪一項不是降水？', options: ['雪', '冰雹', '雨夾雪', '水蒸氣'], correct_option: 'D', explanation: '水蒸氣是空氣中的氣體；降水是以雨、雪、雨夾雪或冰雹落下的水。', source_quote: '以雨、雪、雨夾雪或冰雹的形式落下。' },
    { type: 'mcq', level: 2, stem: '甚麼是蒸騰作用？', options: ['雨水滲入泥土', '植物的葉子釋放水蒸氣', '雲在天空移動', '冰在春天融化'], correct_option: 'B', explanation: '蒸騰作用是植物葉子釋放水蒸氣。', source_quote: '植物的葉子也會釋放水蒸氣，這稱為蒸騰作用。' },
    { type: 'short', level: 2, stem: '用一至兩句回答。', parts: [{ label: '', prompt: '解釋為甚麼水循環很重要。', marks: 2, mark_scheme: ['為人類、動物和植物帶來淡水', '幫助把熱量帶到地球各處'] }], explanation: '課文提到兩個原因：帶來淡水，以及把熱量帶到地球各處。', source_quote: '它為人類、動物和植物帶來淡水' },
  ],
  lesson: { intro: '水一直在流動。我們跟著一滴水，走一趟水循環。', steps: [
    { heading: '蒸發', explain: '太陽加熱海洋、河流和湖泊中的水，液態水變成看不見的**水蒸氣**並上升。', example: '晴天時水氹會消失：水蒸發了。', check: { question: '蒸發把液態水變成甚麼？', options: ['冰', '水蒸氣', '雲'], answer: 1, why: '受熱的液態水變成水蒸氣。' } },
    { heading: '凝結', explain: '水蒸氣上升時會冷卻，變回微小的液態**水點**；大量水點聚在一起便形成**雲**。', example: '凍飲的杯外會出現水點。', check: { question: '水蒸氣冷卻時會怎樣？', options: ['凝結成水點', '消失', '立即變重落下'], answer: 0, why: '冷卻令水蒸氣凝結成水點。' } },
    { heading: '降水與匯集', explain: '水點結合後太重，便以**雨、雪、雨夾雪或冰雹**落下；水匯集在海洋、河流和湖泊或滲入地下，然後循環再開始。', check: { question: '以下哪一項是降水？', options: ['水蒸氣', '冰雹', '蒸騰作用'], answer: 1, why: '冰雹是從雲中落下的冰。' } },
  ], summary: ['太陽推動水循環。', '蒸發 → 凝結 → 降水 → 匯集。', '水循環帶來淡水，並把熱量帶到地球各處。'] },
  notes: { sections: [
    { heading: '蒸發', points: ['太陽加熱海洋、河流和湖泊的水。', '液態水變成**水蒸氣**並上升。', '植物葉子釋放水蒸氣：**蒸騰作用**。'] },
    { heading: '凝結', points: ['上升的水蒸氣冷卻。', '變回微小的液態水點。', '大量水點形成雲。'] },
    { heading: '降水與匯集', points: ['太重的水點以雨、雪、雨夾雪或冰雹落下。', '水匯集在海洋、河流、湖泊或成為地下水。'] },
  ], key_terms: [{ term: '蒸發', meaning: '液態水變成水蒸氣。' }, { term: '凝結', meaning: '水蒸氣冷卻成液態水點。' }, { term: '降水', meaning: '以雨、雪、雨夾雪或冰雹從雲中落下的水。' }, { term: '蒸騰作用', meaning: '植物葉子釋放水蒸氣。' }],
  formulas: [], flashcards: [
    { front: '推動水循環的是甚麼？', back: '太陽的能量。' }, { front: '蒸發', back: '液態水變成水蒸氣。' }, { front: '凝結', back: '水蒸氣冷卻成微小水點，形成雲。' },
    { front: '說出四種降水', back: '雨、雪、雨夾雪和冰雹。' }, { front: '蒸騰作用', back: '植物葉子釋放的水蒸氣。' }, { front: '為甚麼水循環重要？', back: '帶來淡水，並把熱量帶到地球各處。' } ] },
};

export async function installDemo(lang) {
  const D = lang === 'zh' ? ZH : EN;
  const books = (await store.get('books', [])).filter((b) => b.id !== DEMO_ID);
  books.unshift({ id: DEMO_ID, demo: true, code: 'SAMPLE', title: D.title, subject: D.subject, level: D.level, addedAt: Date.now(), kind: 'science', units: [{ id: U, title: D.unit, startPage: 1, endPage: 2 }] });
  await store.set('books', books);
  await store.set(`text:${DEMO_ID}:${U}`, D.text);
  await store.set(`qs:${DEMO_ID}:${U}`, D.qs.map((q, i) => ({ ...q, id: `${DEMO_ID}:${U}:q${i + 1}`, section: D.unit, pages: '1-2' })));
  await store.set(`lesson:${DEMO_ID}:${U}`, { ...D.lesson, at: Date.now() });
  await store.set(`notes:${DEMO_ID}:${U}`, { ...D.notes, at: Date.now() });
  return books[0];
}
export async function removeDemo() {
  await store.set('books', (await store.get('books', [])).filter((b) => b.id !== DEMO_ID));
  for (const k of [`text:${DEMO_ID}:${U}`, `qs:${DEMO_ID}:${U}`, `lesson:${DEMO_ID}:${U}`, `notes:${DEMO_ID}:${U}`]) await store.del(k);
}
