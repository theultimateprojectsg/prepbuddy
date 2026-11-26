// POST /api/tts — read text aloud (dictation items, questions, Buddy's replies, listening passages) with a natural voice (Microsoft Azure neural text to speech).
// body: { text, lang: 'yue' | 'cmn' | 'en', mode: 'normal' | 'slow' | 'teacher', voice?: short name from CHOICES, rate?: 'slower' } → audio/mpeg
//   teacher = read it, pause, read it again (how Hong Kong teachers read 默書 / spelling).
// Needs Vercel environment variables AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. eastasia).
// Without them it answers 501 and the app uses the phone's own voice instead.
// Optional: AZURE_VOICE_YUE, AZURE_VOICE_CMN, AZURE_VOICE_EN (full Azure voice names) change the default voice when a family hasn't picked one.
// The app keeps every clip it gets on the device, so each word is only made once per device.
const { checkAccess, readJson, httpError } = require('../claude');
const spend = require('../spend');

const XML_LANG = { yue: 'zh-HK', cmn: 'zh-CN', en: 'en-GB' };
const USD_PER_CHAR = 16 / 1e6; // neural voices, approx.; Chinese characters are billed as two

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// The voices families can pick in the app (short names); anything else falls back to the default.
// HD = Azure's newer context-aware "Dragon HD" voices (more natural; only some languages have them, not Cantonese).
const CHOICES = {
  yue: { HiuGaai: 'zh-HK-HiuGaaiNeural', HiuMaan: 'zh-HK-HiuMaanNeural', WanLung: 'zh-HK-WanLungNeural' },
  cmn: { Xiaochen: 'zh-CN-Xiaochen:DragonHDLatestNeural', Yunfan: 'zh-CN-Yunfan:DragonHDLatestNeural', Xiaoxiao: 'zh-CN-XiaoxiaoNeural' },
  en: { Sonia: 'en-GB-SoniaNeural', Ryan: 'en-GB-RyanNeural', Ava: 'en-US-Ava:DragonHDLatestNeural' },
};
const DEFAULT = { yue: 'HiuGaai', cmn: 'Xiaochen', en: 'Sonia' };
function voiceName(lang, pick) { return CHOICES[lang][pick] || process.env[`AZURE_VOICE_${lang.toUpperCase()}`] || CHOICES[lang][DEFAULT[lang]]; }
const isHD = (v) => /DragonHD/.test(v);

// Older voices sound more mechanical when stretched, so speed changes stay small; HD voices set their own pace.
function ssml(text, lang, mode, voice, slower) {
  const hd = isHD(voice);
  const pct = mode === 'slow' ? (slower ? 40 : 30) : mode === 'teacher' ? (slower ? 15 : 5) : (slower ? 12 : 0);
  const say = (hd && mode !== 'slow' && !slower) || pct === 0 ? esc(text) : `<prosody rate="-${pct}%">${esc(text)}</prosody>`;
  const body = mode === 'teacher' ? `${say}<break time="1500ms"/>${say}` : say;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${XML_LANG[lang]}"><voice name="${voice}">${body}</voice></speak>`;
}
async function synth(region, key, doc) {
  return fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'PrepBuddy' },
    body: doc,
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) throw httpError(501, 'no-tts');
    await spend.gate();
    const body = await readJson(req);
    const lang = CHOICES[body.lang] ? body.lang : 'en';
    const mode = ['normal', 'slow', 'teacher'].includes(body.mode) ? body.mode : 'normal';
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, mode === 'normal' ? 2500 : 300);
    if (!text) throw httpError(400, 'Nothing to read.');
    const voice = voiceName(lang, String(body.voice || '')), slower = body.rate === 'slower';
    let r = await synth(region, key, ssml(text, lang, mode, voice, slower));
    // an HD voice not offered in this region (or a markup it doesn't take): use the standard voice instead
    if (!r.ok && isHD(voice)) r = await synth(region, key, ssml(text, lang, mode, lang === 'cmn' ? 'zh-CN-XiaoxiaoNeural' : 'en-GB-SoniaNeural', slower));
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
