// Hands-free voice chat with the tutor, using the browser's own speech recognition and voices (free, no extra service).
// One tap starts it: it listens, sends what the student said when they pause, reads the reply aloud, then listens again.
// Talking while it speaks interrupts it. Works in Chrome, Edge and Safari; Firefox has no speech recognition.

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const voiceSupported = () => !!(SR && window.speechSynthesis);

const PAUSE_MS = 1300;       // quiet time after the student's last words before we treat the turn as finished
const PAUSE_INTERIM_MS = 2200; // longer when the recogniser hasn't settled on final words yet
const IDLE_STOP_MS = 120000; // stop after 2 minutes with nobody talking, so the mic isn't left on

// Speech-recognition language codes. Chrome knows Cantonese as yue-Hant-HK; Safari as zh-HK.
const REC_LANGS = { en: ['en-GB', 'en-US'], yue: ['zh-HK', 'yue-Hant-HK'] };

// Turn a written reply into something that sounds right when read aloud.
export function spokenText(t) {
  return String(t || '')
    .replace(/\$\$?([^$]+)\$\$?/g, (m, x) => x.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2').replace(/\\times/g, ' times ').replace(/\\(?:text|mathrm|ce)\{([^}]*)\}/g, '$1').replace(/\^\{?2\}?/g, ' squared').replace(/\^\{?3\}?/g, ' cubed').replace(/[\\{}_^]/g, ' '))
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_#`>]/g, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' ').trim();
}
const sentences = (t) => (t.match(/[^.!?。！？]+[.!?。！？]+["”’)]*|[^.!?。！？]+$/g) || [t]).map((s) => s.trim()).filter(Boolean);

function pickVoice(lang) {
  const vs = speechSynthesis.getVoices();
  const want = lang === 'yue' ? (v) => /^(zh-HK|yue)/i.test(v.lang) || /Cantonese|粵|粤/i.test(v.name) : (v) => /^en[-_]/i.test(v.lang);
  const ok = vs.filter(want);
  const score = (v) => (/Natural|Online|Neural|Premium|Enhanced/i.test(v.name) ? 4 : 0) + (/Google/i.test(v.name) ? 2 : 0) +
    (lang === 'en' && /en[-_]GB/i.test(v.lang) ? 1 : 0) + (v.localService ? 0 : 1);
  return ok.sort((a, b) => score(b) - score(a))[0] || null;
}

// How much of what the mic heard is just the tutor's own voice coming out of the speakers?
function looksLikeEcho(heard, speaking) {
  const toks = (s) => (/[㐀-鿿]/.test(s) ? [...s.replace(/[^㐀-鿿]/g, '')] : s.toLowerCase().match(/[a-z0-9']+/g) || []);
  const h = toks(heard); if (!h.length) return true;
  const said = new Set(toks(speaking));
  return h.filter((w) => said.has(w)).length / h.length > 0.5;
}

// start a voice session.
//   lang: 'en' | 'yue'      send(text) -> Promise<reply text>      onUpdate({ state, heard, error })
//   alive() -> false when the screen it belongs to has gone (then it stops itself)
export function startVoice({ lang = 'en', send, onUpdate = () => {}, alive = () => true }) {
  const v = { state: 'listening', heard: '', saying: '', error: '', lang, on: true };
  let netErrors = 0, rec = null, recLangIdx = 0, finalText = '', interim = '', timer = null, speakingText = '', queue = [], lastActivity = Date.now(), turn = 0;
  const update = () => onUpdate({ state: v.state, heard: v.heard, saying: v.saying, error: v.error, lang: v.lang });

  // Loudness of the student's voice (0-1), so the orb can react to it. Skipped on iPhone/iPad, where a second
  // microphone user can stop speech recognition.
  let mic = null, wordAt = 0;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then((stream) => {
      if (!v.on) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      mic = { ctx, an, stream, data: new Uint8Array(an.fftSize) };
    }).catch(() => {});
  }
  function micLevel() {
    if (!mic) return 0;
    mic.an.getByteTimeDomainData(mic.data);
    let sum = 0; for (const x of mic.data) { const d = (x - 128) / 128; sum += d * d; }
    return Math.min(1, Math.sqrt(sum / mic.data.length) * 5);
  }

  // iOS only lets a page speak if the first utterance comes from a tap: say nothing, now.
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  speechSynthesis.getVoices(); // starts loading the voice list in Chrome

  function newRec() {
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.lang = REC_LANGS[v.lang][recLangIdx] || REC_LANGS[v.lang][0];
    r.onresult = (e) => {
      if (!v.on) return;
      let fin = '', mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else mid += t;
      }
      netErrors = 0;
      if (v.state === 'thinking') return; // ignore noise while waiting for the reply
      if (v.state === 'speaking') {
        const heardNow = (fin + mid).trim();
        const enough = /[㐀-鿿]/.test(heardNow) ? heardNow.length >= 2 : heardNow.split(/\s+/).length >= 2;
        if (!enough || looksLikeEcho(heardNow, speakingText)) return;
        stopSpeaking(); // the student is talking over the tutor: stop and listen
        v.state = 'listening';
      }
      finalText += fin; interim = mid;
      v.heard = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
      lastActivity = Date.now();
      update();
      clearTimeout(timer);
      if (v.heard) timer = setTimeout(endOfTurn, interim ? PAUSE_INTERIM_MS : PAUSE_MS);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') return fail(v.lang === 'yue' ? '請允許使用咪高峰，然後再試。' : 'Please allow the microphone, then try again.');
      if (e.error === 'language-not-supported' && recLangIdx + 1 < REC_LANGS[v.lang].length) { recLangIdx++; return; }
      if (e.error === 'language-not-supported') return fail(v.lang === 'yue' ? '呢個瀏覽器唔支援廣東話語音。' : 'This browser can’t listen in this language.');
      // 'network' also means this browser has no speech service (Brave, in-app browsers, some Chromium builds).
      if (e.error === 'network') {
        if (!navigator.onLine) return fail(v.lang === 'yue' ? '語音對話要連接互聯網。' : 'Voice chat needs an internet connection.');
        if (++netErrors <= 1) return; // retry once: onend restarts it
        return fail(v.lang === 'yue' ? '呢個瀏覽器用唔到語音辨識。請用 Google Chrome、Microsoft Edge 或 Safari 開 PrepBuddy。' : 'Voice listening doesn’t work in this browser. Open PrepBuddy in Google Chrome, Microsoft Edge or Safari. (Brave, Firefox and the browsers built into other apps can’t listen yet.)');
      }
      // 'no-speech' and 'aborted' are normal: onend restarts it.
    };
    r.onend = () => { if (v.on && rec === r) setTimeout(() => { if (v.on && rec === r) { try { r.start(); } catch (e) {} } }, 150); };
    return r;
  }
  function listen() { if (rec) { try { rec.onend = null; rec.abort(); } catch (e) {} } rec = newRec(); try { rec.start(); } catch (e) {} }

  async function endOfTurn() {
    const text = v.heard.trim();
    finalText = ''; interim = '';
    if (!text || !v.on) return;
    v.state = 'thinking'; update();
    const my = ++turn;
    let reply = '';
    try { reply = await send(text); } catch (e) { reply = ''; }
    if (!v.on || my !== turn) return;
    v.heard = '';
    if (!reply) { v.state = 'listening'; update(); return; }
    speak(reply);
  }

  function speak(text) {
    const voice = pickVoice(v.lang);
    queue = sentences(spokenText(text));
    speakingText = queue.join(' ');
    v.state = 'speaking'; update();
    const next = () => {
      if (!v.on || v.state !== 'speaking') return;
      const s = queue.shift();
      if (!s) { v.state = 'listening'; v.heard = ''; v.saying = ''; lastActivity = Date.now(); update(); return; }
      const u = new SpeechSynthesisUtterance(s);
      v.saying = s; wordAt = performance.now(); update();
      u.onboundary = () => { wordAt = performance.now(); };
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = v.lang === 'yue' ? 'zh-HK' : 'en-GB';
      u.rate = v.lang === 'yue' ? 1 : 1.05;
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    next();
  }
  function stopSpeaking() { queue = []; speakingText = ''; v.saying = ''; try { speechSynthesis.cancel(); } catch (e) {} }

  function fail(msg) { v.error = msg; stop(); }
  function stop() {
    v.on = false; v.state = 'off'; clearTimeout(timer); clearInterval(watch);
    stopSpeaking();
    if (rec) { try { rec.onend = null; rec.abort(); } catch (e) {} rec = null; }
    if (mic) { mic.stream.getTracks().forEach((t) => t.stop()); try { mic.ctx.close(); } catch (e) {} mic = null; }
    update();
  }
  // Stop when the student leaves the screen, or nobody has spoken for a while.
  const watch = setInterval(() => {
    if (!v.on) return;
    if (!alive()) return stop();
    if (v.state === 'listening' && !v.heard && Date.now() - lastActivity > IDLE_STOP_MS) { v.error = 'idle'; stop(); }
  }, 1000);

  listen();
  update();
  return {
    stop,
    // switch between English and Cantonese mid-conversation
    setLang(l) { if (!REC_LANGS[l] || l === v.lang) return; v.lang = l; recLangIdx = 0; stopSpeaking(); finalText = ''; interim = ''; v.heard = ''; v.state = 'listening'; turn++; listen(); update(); },
    get lang() { return v.lang; },
    // for the animation: how loud the student is, and how much the tutor is "talking" right now (0-1)
    level() {
      const t = performance.now();
      const speak = v.state === 'speaking' ? Math.max(Math.exp(-(t - wordAt) / 180), 0.35 + 0.3 * Math.abs(Math.sin(t / 110)) * Math.abs(Math.sin(t / 370))) : 0;
      return { mic: micLevel(), speak };
    },
  };
}
