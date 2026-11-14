// POST /api/tts — read text aloud (dictation items, questions, Buddy's replies, listening passages) with a natural voice (Microsoft Azure neural text to speech).
// body: { text, lang: 'yue' | 'cmn' | 'en', mode: 'normal' | 'slow' | 'teacher', voice?: short name from CHOICES, rate?: 'slower' } → audio/mpeg
//   teacher = read it, pause, read it again (how Hong Kong teachers read 默書 / spelling).
// Needs Vercel environment variables AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. eastasia).
// Without them it answers 501 and the app uses the phone's own voice instead.
// Optional: AZURE_VOICE_YUE, AZURE_VOICE_CMN, AZURE_VOICE_EN to change the voices.
// The app keeps every clip it gets on the device, so each word is only made once per device.
const { checkAccess, readJson, httpError } = require('../claude');
const spend = require('../spend');

const VOICES = {
  yue: () => process.env.AZURE_VOICE_YUE || 'zh-HK-HiuGaaiNeural',
  cmn: () => process.env.AZURE_VOICE_CMN || 'zh-CN-XiaoxiaoNeural',
  en: () => process.env.AZURE_VOICE_EN || 'en-GB-SoniaNeural',
};
const XML_LANG = { yue: 'zh-HK', cmn: 'zh-CN', en: 'en-GB' };
const USD_PER_CHAR = 16 / 1e6; // neural voices, approx.; Chinese characters are billed as two

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// The voices families can pick in the app (short names); anything else falls back to the default.
const CHOICES = { yue: ['HiuGaai', 'HiuMaan', 'WanLung'], cmn: ['Xiaoxiao', 'Xiaoyi', 'Yunxi'], en: ['Sonia', 'Libby', 'Ryan'] };
const LOCALE = { yue: 'zh-HK', cmn: 'zh-CN', en: 'en-GB' };
function voiceName(lang, pick) { return CHOICES[lang].includes(pick) ? `${LOCALE[lang]}-${pick}Neural` : VOICES[lang](); }

function ssml(text, lang, mode, pick, slower) {
  const base = lang === 'en' ? 12 : 15;
  const rate = `-${mode === 'slow' ? (slower ? 50 : 40) : base + (slower ? 15 : 0)}%`;
  const say = `<prosody rate="${rate}">${esc(text)}</prosody>`;
  const body = mode === 'teacher' ? `${say}<break time="1500ms"/>${say}` : say;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${XML_LANG[lang]}"><voice name="${voiceName(lang, pick)}">${body}</voice></speak>`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) throw httpError(501, 'no-tts');
    await spend.gate();
    const body = await readJson(req);
    const lang = VOICES[body.lang] ? body.lang : 'en';
    const mode = ['normal', 'slow', 'teacher'].includes(body.mode) ? body.mode : 'normal';
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, mode === 'normal' ? 2500 : 300);
    if (!text) throw httpError(400, 'Nothing to read.');
    const doc = ssml(text, lang, mode, String(body.voice || ''), body.rate === 'slower');
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'PrepBuddy' },
      body: doc,
    });
    if (!r.ok) throw httpError(502, `Voice service error ${r.status}`);
    const audio = Buffer.from(await r.arrayBuffer());
    const billed = [...text].reduce((n, c) => n + (/[㐀-鿿豈-﫿]/.test(c) ? 2 : 1), 0) * (mode === 'teacher' ? 2 : 1) + 120; // + markup
    spend.add(billed * USD_PER_CHAR);
    res.statusCode = 200;
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'private, max-age=31536000, immutable');
    res.end(audio);
  } catch (e) {
    res.statusCode = e.status || 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
module.exports.ssml = ssml;
