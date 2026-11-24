/* ---- voice conversation: GPT-Live over WebRTC, through nakata.app (the key never reaches the app) ---- */
const VOICE_MSG = {
  voice_closed: "Sesli konuşma şu an kapalı.",
  voice_credits: "Bugünkü ücretsiz sesli süren bitti ve kredin yetmiyor.",
  already_active: "Zaten açık bir görüşmen var.",
  slow_down: "Bugün çok fazla sesli görüşme açtın.",
  unauthorized: "Sesli konuşmak için giriş yap.",
  upstream: "Sesli görüşme başlatılamadı. Tekrar dene.",
};
let voice = null;   // { pc, dc, stream, audio, id, ping, tick, t0, ending, pingNow, discT }
const DEFAULT_VOICES = [
  { id: "marin", label: "Marin", hint: "Doğal ve dengeli (varsayılan)" },
  { id: "cedar", label: "Cedar", hint: "Sıcak ve net" },
  { id: "coral", label: "Coral", hint: "Canlı ve samimi" },
  { id: "ballad", label: "Ballad", hint: "Akıcı ve sıcak" },
  { id: "sage", label: "Sage", hint: "Yumuşak ve bilge" },
  { id: "shimmer", label: "Shimmer", hint: "Hafif ve berrak" },
  { id: "verse", label: "Verse", hint: "İfadeli ve doğal" },
  { id: "vesper", label: "Vesper", hint: "İngiliz vurgulu" },
  { id: "ash", label: "Ash", hint: "Sakin ve derin" },
];
let voiceCatalog = DEFAULT_VOICES;
let customVoices = [];
let customVoiceTokens = {};
let defaultVoiceId = "marin";
let voiceGen = 0;
let voiceSwitchGen = 0;
const CUSTOM_VOICES_KEY = "nakata_custom_voices";
const CUSTOM_VOICE_TOKENS_KEY = "nakata_custom_voice_tokens";
const SILENT_WAV_URI = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

async function loadCustomVoices(){
  const raw = LS.get(CUSTOM_VOICES_KEY, []);
  customVoices = Array.isArray(raw) ? raw.filter((v) => v && typeof v.id === "string" && typeof v.label === "string") : [];
  const kc = keychain();
  if (kc) {
    try {
      const got = (await kc.get({ key: CUSTOM_VOICE_TOKENS_KEY })).value;
      customVoiceTokens = got ? JSON.parse(got) : {};
    } catch { customVoiceTokens = {}; }
  } else {
    const t = LS.get(CUSTOM_VOICE_TOKENS_KEY, {});
    customVoiceTokens = t && typeof t === "object" ? t : {};
  }
}
function saveCustomVoices(){
  LS.set(CUSTOM_VOICES_KEY, customVoices);
  const kc = keychain();
  if (kc) kc.set({ key: CUSTOM_VOICE_TOKENS_KEY, value: JSON.stringify(customVoiceTokens) }).catch(() => {});
  else LS.set(CUSTOM_VOICE_TOKENS_KEY, customVoiceTokens);
}
function allVoiceCatalog(){
  const seen = new Set();
  const out = [];
  for (const item of [...customVoices, ...voiceCatalog]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
function voiceMeta(id){
  const list = allVoiceCatalog();
  return list.find((x) => x.id === id) || list.find((x) => x.id === defaultVoiceId) || list[0];
}
function selectedVoice(){
  const saved = LS.get("nakata_voice", defaultVoiceId);
  if (saved === "custom:sonji" || saved === "sonji") {
    LS.set("nakata_voice", defaultVoiceId);
    return voiceMeta(defaultVoiceId).id;
  }
  return voiceMeta(saved).id;
}
function voiceDisplayLabel(meta){ return meta?.label || "Marin"; }
function syncVoiceMiniBar(){
  const bar = $("#voiceMiniBar"), mic = $("#micBtn");
  const active = !!(voice && !voice.ending);
  const fullOpen = $("#f-voice")?.classList.contains("on");
  if (mic) {
    mic.classList.toggle("live", active);
    mic.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (!bar) return;
  bar.hidden = !active || fullOpen;
  if (active) {
    const cur = voice.activeVoice || voiceMeta(selectedVoice());
    if ($("#voiceMiniVoice")) $("#voiceMiniVoice").textContent = voiceDisplayLabel(cur);
    if ($("#voiceMiniState")) $("#voiceMiniState").textContent = $("#voiceState")?.textContent || tx("Dinliyorum");
    if ($("#voiceMiniTimer")) $("#voiceMiniTimer").textContent = $("#voiceTimer")?.textContent || (voice.t0 ? fmtTime(Math.round((Date.now() - voice.t0) / 1000)) : "0:00");
  }
}
function paintVoiceControls(pendingLabel = ""){
  const cur = voiceMeta(selectedVoice());
  const pick = $("#voicePick");
  if (pick) pick.textContent = pendingLabel ? pendingLabel : tx(`Ses: ${voiceDisplayLabel(cur)} ▾`);
  const sel = $("#st-voice");
  if (sel) {
    sel.innerHTML = "";
    for (const item of allVoiceCatalog()) {
      const opt = el("option");
      opt.value = item.id;
      opt.textContent = `${item.label} — ${tx(item.hint || "Sıcak ve çekici")}`;
      sel.append(opt);
    }
    sel.value = cur.id;
  }
  syncVoiceMiniBar();
}
function paintCustomVoicesUI(){
  const listEl = $("#cv-list"), emptyEl = $("#cv-empty");
  if (!listEl) return;
  listEl.replaceChildren();
  const serverCustom = voiceCatalog.filter((v) => v.kind === "custom-tts" || (v.kind === "gpt-live" && !DEFAULT_VOICES.some((d) => d.id === v.id)));
  const combined = [...customVoices, ...serverCustom.filter((s) => !customVoices.some((c) => c.id === s.id))];
  if (emptyEl) emptyEl.hidden = combined.length > 0;
  for (const item of combined) {
    const row = el("div", "cv-row");
    const meta = el("div", "cv-meta");
    meta.append(el("b", "", item.label), el("span", "", item.local ? (item.url || item.ttsVoice || item.id) : tx(item.hint || "Sıcak ve çekici")));
    row.append(meta);
    const useBtn = el("button", "", selectedVoice() === item.id ? tx("Seçili") : tx("Seç"));
    useBtn.type = "button";
    useBtn.addEventListener("click", () => { void setVoiceChoice(item.id, { restart: true }); paintCustomVoicesUI(); haptic(); });
    row.append(useBtn);
    if (item.local) {
      const del = el("button", "del", tx("Kaldır"));
      del.type = "button";
      del.addEventListener("click", () => {
        customVoices = customVoices.filter((x) => x.id !== item.id);
        delete customVoiceTokens[item.id];
        saveCustomVoices();
        if (LS.get("nakata_voice", "") === item.id) LS.set("nakata_voice", defaultVoiceId);
        paintCustomVoicesUI();
        paintVoiceControls();
        haptic();
      });
      row.append(del);
    }
    listEl.append(row);
  }
}
function splitSpeechSentences(text){
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+(?:[.!?]+["”’)]*|$)/g) || [clean];
  const merged = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    // Keep chunk 0 short so custom TTS returns first audio fast; only merge tiny fragments after chunk 0.
    if (merged.length >= 2 && merged[merged.length - 1].length < 24 && merged[merged.length - 1].length + s.length < 140) {
      merged[merged.length - 1] += " " + s;
    } else {
      merged.push(s);
    }
  }
  // If the opening sentence itself is long (>72 chars), split at the first natural clause break for fast TTFA.
  if (merged.length && merged[0].length > 72) {
    const first = merged[0];
    const m = first.slice(0, 76).match(/^(.{18,72}?(?:[,;:]|\s[—–-]))\s+(.+)$/);
    if (m && m[2].trim().length >= 8) {
      const head = m[1].trim();
      const tail = (m[2] + first.slice(76)).trim();
      if (tail) merged.splice(0, 1, head, tail);
    }
  }
  return merged.length ? merged : [clean];
}
function customEmotionForText(text){
  const face = voiceFaceFrom(text, "happy");
  if (face === "excited" || face === "happy") return "mutlu";
  if (face === "sad") return "uzgun";
  if (face === "angry") return "kizgin";
  return "normal";
}
async function fetchCustomTtsBlob(text, voiceObj, { sessionId = null, signal, emotion = "", format = "mp3", retries = 1 } = {}){
  const isLocal = !!(voiceObj?.local && voiceObj?.url);
  const endpoint = isLocal ? voiceObj.url : `${API}/voice/tts`;
  const headers = { "Content-Type": "application/json" };
  if (isLocal) {
    const tok = customVoiceTokens[voiceObj.id] || "";
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } else if (token()) {
    headers.Authorization = `Bearer ${token()}`;
  }
  const body = JSON.stringify(
    isLocal
      ? { model: "custom", input: text, voice: voiceObj.ttsVoice || voiceObj.id.replace(/^local:/, ""), ...(emotion ? { emotion } : {}), response_format: format }
      : { ...(sessionId ? { sessionId } : {}), voice: voiceObj.id, text, ...(emotion ? { emotion } : {}), format },
  );
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(endpoint, { method: "POST", headers, signal, body });
      if (res.ok) return await res.blob();
      lastErr = new Error(`custom_tts_${res.status}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw lastErr;
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") throw err;
      lastErr = err;
    }
    if (attempt < retries) await wait(250);
  }
  throw lastErr || new Error("custom_tts_failed");
}
async function fetchCustomTtsBlobUrl(text, voiceObj, opts = {}){
  const blob = await fetchCustomTtsBlob(text, voiceObj, { format: "wav", ...opts });
  return URL.createObjectURL(blob);
}
function stopCustomVoiceSpeech(v){
  if (!v) return;
  try { v.ttsAbort?.abort(); } catch {}
  v.ttsAbort = null;
  v.ttsPlaySeq = (v.ttsPlaySeq || 0) + 1;
  if (v.ttsSource) {
    try { v.ttsSource.onended = null; v.ttsSource.stop(); } catch {}
    v.ttsSource = null;
  }
  if (v.customAudio) {
    try {
      v.customAudio.onended = null;
      v.customAudio.onerror = null;
      v.customAudio.pause();
      if (v.customAudioUrl) { URL.revokeObjectURL(v.customAudioUrl); v.customAudioUrl = ""; }
      // Never call removeAttribute("src") here: on iOS WKWebView it can drop the user-gesture playback unlock.
    } catch {}
  }
}
async function playCustomTtsBlob(v, blob, seq, signal){
  if (!voice || voice !== v || v.ending || v.ttsPlaySeq !== seq || signal?.aborted) return;
  // Prefer unlocked Web AudioContext on iOS WKWebView: survives async fetches without HTMLAudioElement gesture loss.
  if (v.ttsAc && typeof v.ttsAc.decodeAudioData === "function") {
    try {
      if (v.ttsAc.state === "suspended") await v.ttsAc.resume().catch(() => {});
      if (v.ttsAc.state === "running") {
        const arrBuf = await blob.arrayBuffer();
        if (voice !== v || v.ending || v.ttsPlaySeq !== seq || signal?.aborted) return;
        const decoded = await v.ttsAc.decodeAudioData(arrBuf.slice(0));
        if (voice !== v || v.ending || v.ttsPlaySeq !== seq || signal?.aborted) return;
        await new Promise((resolve) => {
          const src = v.ttsAc.createBufferSource();
          src.buffer = decoded;
          src.connect(v.ttsAc.destination);
          v.ttsSource = src;
          const finish = () => {
            src.onended = null;
            if (v.ttsSource === src) v.ttsSource = null;
            resolve();
          };
          src.onended = finish;
          try { src.start(0); } catch { finish(); }
        });
        return;
      }
    } catch {}
  }
  const blobUrl = URL.createObjectURL(blob);
  if (voice !== v || v.ending || v.ttsPlaySeq !== seq || signal?.aborted) {
    URL.revokeObjectURL(blobUrl);
    return;
  }
  await new Promise((resolve) => {
    const a = v.customAudio;
    if (!a) { URL.revokeObjectURL(blobUrl); resolve(); return; }
    if (v.customAudioUrl) { URL.revokeObjectURL(v.customAudioUrl); }
    v.customAudioUrl = blobUrl;
    a.src = blobUrl;
    const done = () => {
      a.onended = null; a.onerror = null;
      if (v.customAudioUrl === blobUrl) { URL.revokeObjectURL(blobUrl); v.customAudioUrl = ""; }
      resolve();
    };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  });
}
function latestVoiceSentence(text){
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.split(/(?<=[.!?…]["”’)]*)\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
  let cur = parts[parts.length - 1] || clean;
  if (cur.length > 120) {
    const clauses = cur.split(/(?<=[,;:\u2014\u2013])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
    cur = clauses[clauses.length - 1] || cur;
    if (cur.length > 120) cur = "…" + cur.slice(-115).replace(/^\S*\s+/, "");
  }
  return cur;
}
function setVoiceSpeechLine(v, text){
  // Track the active spoken sentence purely in memory (for mascot mood reactivity
  // and barge-in detection); transcripts render only inside the chat thread (#thread).
  if (v) v.caption = latestVoiceSentence(text);
}
function clearVoiceSpeechLine(v){
  if (v) v.caption = "";
}
function syncVoiceQuota(v, freeLeftSec, creditsPerMin){
  if (!v) return;
  if (typeof freeLeftSec === "number" && Number.isFinite(freeLeftSec)) {
    v.freeLeftSec = Math.max(0, Math.floor(freeLeftSec));
    v.freeSyncAt = Date.now();
  }
  if (typeof creditsPerMin === "number" && Number.isFinite(creditsPerMin)) {
    v.creditsPerMin = creditsPerMin;
  }
  renderVoiceQuota(v);
}
function renderVoiceQuota(v){
  const elFree = $("#voiceFree");
  if (!elFree) return;
  if (!v || v.freeLeftSec == null) {
    elFree.textContent = "";
    elFree.hidden = true;
    return;
  }
  const elapsed = v.t0 && v.freeSyncAt ? Math.max(0, Math.floor((Date.now() - v.freeSyncAt) / 1000)) : 0;
  const rem = Math.max(0, v.freeLeftSec - elapsed);
  if (rem > 0) {
    elFree.textContent = tx(`${fmtTime(rem)} ücretsiz`);
    elFree.hidden = false;
  } else if (v.creditsPerMin != null) {
    elFree.textContent = tx(`${v.creditsPerMin} kredi/dk`);
    elFree.hidden = false;
  } else {
    elFree.textContent = "";
    elFree.hidden = true;
  }
}
function ensureVoiceChatThread(){
  showHero(false);
  if (!curId) curId = "c" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function commitVoiceUserToChat(v, rawText){
  const qText = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!v || !qText) return "";
  if (v.userPersistedForTurn && v.lastTurnUserPersisted === qText) return qText;
  ensureVoiceChatThread();
  addUser(qText);
  convo.push({ role: "user", content: qText });
  v.turns = [...(v.turns || []), { role: "user", content: qText.slice(0, 300) }].slice(-14);
  v.lastTurnUserPersisted = qText;
  v.userPersistedForTurn = true;
  persist();
  return qText;
}
function streamVoiceAssistantToChat(v, fullText){
  if (!v || v.skipLiveChatPersist) return;
  const text = String(fullText || "");
  if (!text.trim()) return;
  ensureVoiceChatThread();
  if (!v.liveAsstEl) v.liveAsstEl = addAsst();
  v.liveAsstEl.innerHTML = md(text);
  scrollDown();
}
function finalizeVoiceAssistantToChat(v, rawText, sources = []){
  const ans = String(rawText || "").trim();
  if (!v || !ans) {
    if (v) { v.liveAsstEl = null; v.liveAsstBuf = ""; }
    return;
  }
  ensureVoiceChatThread();
  const target = v.liveAsstEl || addAsst();
  target.innerHTML = md(ans);
  if (sources.length) renderSources(target.parentElement?.parentElement, sources);
  convo.push({ role: "assistant", content: ans, ...(sources.length ? { sources } : {}) });
  v.turns = [...(v.turns || []), { role: "assistant", content: ans.slice(0, 300) }].slice(-14);
  v.liveAsstEl = null;
  v.liveAsstBuf = "";
  persist();
  scrollDown();
}

async function speakCustomVoiceAnswer(v, answerText, delegationId){
  if (!voice || voice !== v || v.ending) return;
  stopCustomVoiceSpeech(v);
  const seq = v.ttsPlaySeq;
  const ctrl = v.ttsAbort = new AbortController();
  const activeVoice = v.activeVoice || voiceMeta(selectedVoice());
  const chunks = splitSpeechSentences(answerText);
  if (!chunks.length) return;
  const emotion = customEmotionForText(answerText);
  setVoiceSpeechLine(v, chunks[0]);
  voiceSay(tx("Ses hazırlanıyor…"), "thinking");
  if (v.audio) v.audio.muted = true;
  if (v.dc?.readyState === "open" && delegationId) {
    // Keep GPT-Live conversation context synchronized while suppressing GPT-Live's own speaker output.
    v.suppressNextLiveAudio = true;
    v.dc.send(JSON.stringify({ type: "session.commentary.append", delegation_id: delegationId, content: answerText }));
  }
  const fetchChunk = (idx) => fetchCustomTtsBlob(chunks[idx], activeVoice, {
    sessionId: v.id,
    signal: ctrl.signal,
    emotion,
    format: "mp3",
    retries: 1,
  });
  let pendingFetch = fetchChunk(0);
  let playedAny = false;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const blob = await pendingFetch;
      if (voice !== v || v.ending || v.ttsPlaySeq !== seq || ctrl.signal.aborted) return;
      // 1-ahead pipeline: start synthesizing chunk i+1 while chunk i plays so server lock never queues all chunks at once.
      pendingFetch = (i + 1 < chunks.length) ? fetchChunk(i + 1) : null;
      setVoiceSpeechLine(v, chunks[i]);
      if (!playedAny) {
        playedAny = true;
        voiceSay(tx("Konuşuyor…"), voiceFaceFrom(chunks[i], "happy"));
      }
      await playCustomTtsBlob(v, blob, seq, ctrl.signal);
    }
    if (voice === v && !v.ending && v.ttsPlaySeq === seq) {
      clearVoiceSpeechLine(v);
      voiceSay(tx("Dinliyorum"), "attentive");
    }
  } catch {
    if (pendingFetch) pendingFetch.catch(() => {});
    if (voice !== v || v.ending || ctrl.signal.aborted || v.ttsPlaySeq !== seq) return;
    clearVoiceSpeechLine(v);
    if (!playedAny) {
      voiceSay(tx("Özel ses şu an yanıt vermedi."), "sad");
      clearTimeout(v.faceT);
      v.faceT = setTimeout(() => { if (voice === v && !v.ending && v.ttsPlaySeq === seq) voiceSay(tx("Dinliyorum"), "attentive"); }, 1800);
    } else {
      voiceSay(tx("Dinliyorum"), "attentive");
    }
  }
}

function abortPendingDelegation(v){
  if (!v) return;
  v.delegationSeq = (v.delegationSeq || 0) + 1;
  try { v.delegationAbort?.abort(); } catch {}
  v.delegationAbort = null;
  if (typeof v.inputDoneResolve === "function") {
    const fn = v.inputDoneResolve;
    v.inputDoneResolve = null;
    try { fn(); } catch {}
  }
}
function unmuteLiveAudio(v){
  if (!v) return;
  clearTimeout(v.bargeInDuckT);
  v.bargeInDuckT = 0;
  v.bargeInMuted = false;
  if (v.audio) v.audio.muted = (v.activeVoice?.kind === "custom-tts");
}

async function waitForIceOffer(pc){
  if (pc.iceGatheringState === "complete") return;
  await new Promise((res) => {
    let settled = false, candT = 0, gotReflexive = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardT);
      clearTimeout(candT);
      res();
    };
    const hardT = setTimeout(done, 2200);
    const maybeArmShort = () => {
      const sdp = pc.localDescription?.sdp || "";
      if (!gotReflexive && /a=candidate:[^\r\n]+typ (?:srflx|relay)/i.test(sdp)) {
        gotReflexive = true;
        clearTimeout(candT);
        candT = setTimeout(done, 150);
        return;
      }
      if (!candT && /a=candidate:/i.test(sdp)) {
        candT = setTimeout(done, 600);
      }
    };
    pc.onicecandidate = () => { maybeArmShort(); };
    pc.onicegatheringstatechange = () => {
      maybeArmShort();
      if (pc.iceGatheringState === "complete") done();
    };
    maybeArmShort();
  });
}

function bindVoiceTransport(v, pc, dc, audioEl){
  const setVoiceMood = (face, minGapMs = 650) => {
    if (!voice || v.ending || !face) return;
    const now = Date.now();
    if (face !== voiceOrb.expression && (now - v.lastFaceAt >= minGapMs || minGapMs === 0)) {
      clearTimeout(v.faceT);
      v.lastFaceAt = now;
      voiceOrb.set(face);
    }
  };
  const flushLiveAssistant = (overrideText = "") => {
    if (v.liveAsstCommitted || v.skipLiveChatPersist) {
      v.liveAsstEl = null;
      v.liveAsstBuf = "";
      return;
    }
    const finalText = String(overrideText || v.liveAsstBuf || "").trim();
    if (finalText) {
      finalizeVoiceAssistantToChat(v, finalText);
      v.liveAsstCommitted = true;
    } else {
      v.liveAsstEl = null;
      v.liveAsstBuf = "";
    }
  };
  const armBargeInUnmuteFailsafe = () => {
    clearTimeout(v.bargeInDuckT);
    v.bargeInDuckT = setTimeout(() => {
      if (voice === v && !v.ending && v.bargeInMuted) unmuteLiveAudio(v);
    }, 1800);
  };
  const interruptAssistantOutput = ({ keepInput = false } = {}) => {
    clearTimeout(v.faceT);
    clearTimeout(v.asstIdleT);
    v.asstIdleT = 0;
    const wasSpeaking = !!(v.assistantSpeaking || v.liveAsstBuf || v.caption);
    abortPendingDelegation(v);
    stopCustomVoiceSpeech(v);
    v.lastUserSpeechAt = Date.now();
    v.bargeSpeechFrames = 0;
    if (v.liveAsstBuf && !v.liveAsstCommitted && !v.skipLiveChatPersist) flushLiveAssistant();
    v.liveAsstCommitted = false;
    v.skipLiveChatPersist = false;
    v.assistantSpeaking = false;
    clearVoiceSpeechLine(v);
    v.directCustomBuf = "";
    v.ignoreLiveTranscript = false;
    if (wasSpeaking && v.audio && v.activeVoice?.kind !== "custom-tts") {
      v.audio.muted = true;
      v.bargeInMuted = true;
      armBargeInUnmuteFailsafe();
      try { if (v.dc?.readyState === "open") v.dc.send(JSON.stringify({ type: "response.cancel" })); } catch {}
    }
    if (!keepInput) {
      v.inp = "";
      v.pendingUserText = "";
      v.userPersistedForTurn = false;
      v.lastTurnUserPersisted = "";
    }
    voiceSay(tx("Dinliyorum"), "curious");
  };
  v.interruptAssistantOutput = interruptAssistantOutput;
  const scheduleAssistantIdle = () => {
    clearTimeout(v.asstIdleT);
    v.asstIdleT = setTimeout(() => {
      if (voice !== v || v.ending) return;
      v.assistantSpeaking = false;
      if (v.liveAsstBuf && !v.liveAsstCommitted && !v.skipLiveChatPersist) flushLiveAssistant();
      v.liveAsstCommitted = false;
      v.skipLiveChatPersist = false;
      clearVoiceSpeechLine(v);
      voiceSay(tx("Dinliyorum"), "attentive");
    }, 1400);
  };
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
    audioEl.muted = (v.activeVoice?.kind === "custom-tts") || !!v.bargeInMuted;
    audioEl.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (v.ending || voice !== v || v.pc !== pc) return;
    if (pc.connectionState === "failed" || pc.connectionState === "closed") endVoice("Bağlantı koptu.");
    else if (pc.connectionState === "disconnected") {
      clearTimeout(v.discT);
      const graceMs = document.hidden ? 12000 : 8000;
      v.discT = setTimeout(() => { if (voice === v && v.pc === pc && !v.ending && pc.connectionState === "disconnected") endVoice("Bağlantı koptu."); }, graceMs);
    } else if (pc.connectionState === "connected") {
      clearTimeout(v.discT);
    }
  };
  dc.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.type === "session.closed") { v.closed?.(); return; }
    if (v.ending || voice !== v || v.dc !== dc) return;
    if (ev.type === "session.started") {
      clearTimeout(v.faceT);
      if (!v.t0) {
        v.t0 = Date.now();
        if (v.freeLeftSec != null) v.freeSyncAt = v.t0;
      }
      voiceSay("Dinliyorum", "attentive");
      if (!v.tick) {
        const updateClock = () => {
          const txt = fmtTime(Math.round((Date.now() - v.t0) / 1000));
          $("#voiceTimer").textContent = txt;
          if ($("#voiceMiniTimer")) $("#voiceMiniTimer").textContent = txt;
          renderVoiceQuota(v);
        };
        updateClock();
        v.tick = setInterval(updateClock, 1000);
      }
    }
    else if (ev.type === "response.created") {
      clearTimeout(v.asstIdleT);
      if (v.liveAsstBuf && !v.liveAsstCommitted && !v.skipLiveChatPersist) flushLiveAssistant();
      if (v.inp?.trim() && !v.userPersistedForTurn && !v.ignoreLiveTranscript) {
        v.pendingUserText = commitVoiceUserToChat(v, v.inp);
        v.inp = "";
      }
      v.liveAsstBuf = "";
      v.liveAsstEl = null;
      v.liveAsstCommitted = false;
      clearVoiceSpeechLine(v);
      if (v.activeVoice?.kind === "custom-tts") {
        if (v.audio) v.audio.muted = true;
        if (v.suppressNextLiveAudio) {
          v.suppressNextLiveAudio = false;
          v.ignoreLiveTranscript = true;
          try { if (dc.readyState === "open") dc.send(JSON.stringify({ type: "response.cancel" })); } catch {}
        } else {
          v.ignoreLiveTranscript = false;
          v.directCustomBuf = "";
        }
      } else if (v.suppressNextLiveAudio) {
        v.suppressNextLiveAudio = false;
        if (v.audio) v.audio.muted = true;
        try { if (dc.readyState === "open") dc.send(JSON.stringify({ type: "response.cancel" })); } catch {}
      } else {
        unmuteLiveAudio(v);
      }
    }
    else if (ev.type === "response.audio_transcript.delta" || ev.type === "response.output_audio_transcript.delta" || ev.type === "session.output_transcript.delta") {
      if (v.activeVoice?.kind === "custom-tts") {
        if (!v.ignoreLiveTranscript && ev.delta) {
          v.directCustomBuf = (v.directCustomBuf || "") + ev.delta;
          setVoiceSpeechLine(v, v.directCustomBuf);
          if (!v.skipLiveChatPersist) streamVoiceAssistantToChat(v, v.directCustomBuf);
          voiceSay(tx("Konuşuyor…"));
          setVoiceMood(voiceFaceFrom(v.caption || v.directCustomBuf, "happy"), 650);
        }
        return;
      }
      if (ev.delta) {
        if (v.bargeInMuted) {
          if (Date.now() - (v.lastUserSpeechAt || 0) < 180) return;
          unmuteLiveAudio(v);
        }
        if (v.inp?.trim() && !v.userPersistedForTurn && !v.ignoreLiveTranscript) {
          v.pendingUserText = commitVoiceUserToChat(v, v.inp);
          v.inp = "";
        }
        if (v.liveAsstCommitted) {
          // Gateway started a new response turn without firing response.created/done between them.
          v.liveAsstCommitted = false;
          v.liveAsstBuf = "";
          v.liveAsstEl = null;
        }
        if (!v.assistantSpeaking) {
          v.assistantSpeaking = true;
          v.assistantSpeakStartAt = Date.now();
        }
        v.liveAsstBuf = (v.liveAsstBuf || "") + ev.delta;
        setVoiceSpeechLine(v, v.liveAsstBuf);
        streamVoiceAssistantToChat(v, v.liveAsstBuf);
        voiceSay(tx("Konuşuyor…"));
        setVoiceMood(voiceFaceFrom(v.caption || v.liveAsstBuf, "happy"), 650);
        scheduleAssistantIdle();
      }
    }
    else if (ev.type === "response.audio_transcript.done" || ev.type === "response.output_audio_transcript.done" || ev.type === "session.output_transcript.done") {
      if (v.activeVoice?.kind === "custom-tts") return;
      clearTimeout(v.asstIdleT);
      v.assistantSpeaking = false;
      const doneText = String(ev.transcript || ev.text || v.liveAsstBuf || "").trim();
      if (doneText) setVoiceSpeechLine(v, doneText);
      flushLiveAssistant(doneText);
    }
    else if (ev.type === "response.done") {
      clearTimeout(v.asstIdleT);
      v.assistantSpeaking = false;
      if (v.activeVoice?.kind === "custom-tts") {
        const directTxt = !v.ignoreLiveTranscript && v.directCustomBuf?.trim() ? v.directCustomBuf.trim() : "";
        v.directCustomBuf = "";
        v.ignoreLiveTranscript = false;
        v.userPersistedForTurn = false;
        v.pendingUserText = "";
        if (directTxt) {
          if (!v.skipLiveChatPersist) finalizeVoiceAssistantToChat(v, directTxt);
          v.skipLiveChatPersist = false;
          void speakCustomVoiceAnswer(v, directTxt, null);
        } else {
          v.skipLiveChatPersist = false;
          clearVoiceSpeechLine(v);
        }
        return;
      }
      const finalMood = v.caption ? voiceFaceFrom(v.caption, "happy") : "attentive";
      flushLiveAssistant();
      v.liveAsstCommitted = false;
      v.skipLiveChatPersist = false;
      v.userPersistedForTurn = false;
      v.pendingUserText = "";
      clearVoiceSpeechLine(v);
      voiceSay(tx("Dinliyorum"));
      if (finalMood !== "attentive") {
        setVoiceMood(finalMood, 0);
        clearTimeout(v.faceT);
        v.faceT = setTimeout(() => { if (voice === v && !v.ending) voiceOrb.set("attentive"); }, 850);
      } else {
        voiceOrb.set("attentive");
      }
    }
    else if (ev.type === "input_audio_buffer.speech_started") {
      interruptAssistantOutput({ keepInput: false });
    }
    else if (ev.type === "session.input_transcript.delta" || ev.type === "conversation.item.input_audio_transcription.delta") {
      const piece = String(ev.delta || "");
      if (piece.trim()) {
        v.lastUserSpeechAt = Date.now();
        if (v.assistantSpeaking || v.delegationAbort || v.ttsAbort || v.ttsSource) {
          interruptAssistantOutput({ keepInput: true });
        } else if (v.bargeInMuted) {
          armBargeInUnmuteFailsafe();
        }
      }
      v.inp = ((v.inp || "") + piece).slice(-4000);
      const inpMood = voiceFaceFrom(v.inp, "curious");
      if (inpMood !== "curious") setVoiceMood(inpMood, 600);
    }
    else if (ev.type === "session.input_transcript.done" || ev.type === "conversation.item.input_audio_transcription.completed") {
      const spoken = String(ev.transcript || ev.text || v.inp || "").trim();
      v.inp = "";
      if (spoken) {
        v.pendingUserText = commitVoiceUserToChat(v, spoken);
      }
      if (typeof v.inputDoneResolve === "function") {
        const fn = v.inputDoneResolve;
        v.inputDoneResolve = null;
        try { fn(); } catch {}
      }
    }
    else if (ev.type === "session.delegation.created" && v.id) {
      abortPendingDelegation(v);
      v.ignoreLiveTranscript = true;
      v.directCustomBuf = "";
      // Selective backend delegation (live web search/weather/URLs or paired Mac tasks).
      clearTimeout(v.faceT);
      voiceSay("Düşünüyor…", "thinking");
      const delegationId = ev.delegation?.id || ev.delegation_id || null;
      const evPrompt = String(ev.delegation?.prompt || ev.delegation?.transcript || ev.delegation?.text || ev.transcript || "").trim();
      const mySeq = ++v.delegationSeq;
      const delCtrl = v.delegationAbort = new AbortController();
      (async () => {
        try {
          // Wait briefly for input_transcript.done when delegation fires mid-delta so trailing syllables aren't clipped.
          if (!evPrompt && !v.pendingUserText && v.inp?.trim()) {
            await new Promise((resolve) => {
              const t = setTimeout(() => {
                if (v.inputDoneResolve === done) v.inputDoneResolve = null;
                resolve();
              }, 300);
              const done = () => {
                clearTimeout(t);
                resolve();
              };
              v.inputDoneResolve = done;
              delCtrl.signal.addEventListener("abort", done, { once: true });
            });
            if (!voice || voice !== v || v.ending || v.delegationSeq !== mySeq || delCtrl.signal.aborted) return;
          }
          const prompt = (evPrompt || v.pendingUserText || v.inp || "").slice(-2000).trim();
          v.inp = "";
          v.pendingUserText = "";
          if (!prompt) {
            if (v.delegationAbort === delCtrl) v.delegationAbort = null;
            v.ignoreLiveTranscript = false;
            voiceSay(tx("Dinliyorum"), "attentive");
            return;
          }
          const recentHistory = Array.isArray(v.turns) ? v.turns.slice(-10) : [];
          const qText = commitVoiceUserToChat(v, prompt);
          const d = await api("/voice/delegation", { method: "POST", body: { sessionId: v.id, text: qText || prompt, history: recentHistory }, signal: delCtrl.signal });
          if (!voice || voice !== v || v.ending || v.delegationSeq !== mySeq || delCtrl.signal.aborted || d.aborted) return;
          if (v.delegationAbort === delCtrl) v.delegationAbort = null;
          const toolsUsed = Array.isArray(d.j?.toolsUsed) ? d.j.toolsUsed : [];
          const dispatched = Array.isArray(d.j?.dispatchedTasks) ? d.j.dispatchedTasks : [];
          if (dispatched.length && activeAgentPairId) {
            agentTaskAccount = agentAcct();
            agentTaskPair = activeAgentPairId;
            for (const task of dispatched) {
              if (task?.id) agentPendingIds.add(task.id);
            }
            void refreshAgentTasks();
            voiceSay(tx("Mac’e görev gönderildi"), "excited");
          } else if (toolsUsed.some((t) => t === "web_search" || t === "get_weather" || t === "fetch_url")) {
            voiceSay(tx("Bilgi bulundu"), "happy");
          }
          if (d.ok && d.j.answer) {
            const vSources = Array.isArray(d.j.sources) ? d.j.sources : [];
            finalizeVoiceAssistantToChat(v, d.j.answer, vSources);
            v.userPersistedForTurn = false;
            const ansMood = voiceFaceFrom(d.j.answer, "happy");
            if (ansMood !== "happy") setVoiceMood(ansMood, 0);
            if (v.activeVoice?.kind === "custom-tts") {
              v.skipLiveChatPersist = true;
              void speakCustomVoiceAnswer(v, d.j.answer, delegationId);
            } else if (v.dc?.readyState === "open") {
              v.skipLiveChatPersist = true;
              unmuteLiveAudio(v);
              v.dc.send(JSON.stringify({ type: "session.commentary.append", delegation_id: delegationId, content: d.j.answer }));
            }
          } else {
            // Brain failed/empty: never stay permanently muted/frozen; allow GPT-Live fallback transcript to flow.
            v.ignoreLiveTranscript = false;
            if (v.activeVoice?.kind !== "custom-tts") unmuteLiveAudio(v);
            voiceSay(tx("Dinliyorum"), "attentive");
          }
        } catch (err) {
          if (v.delegationAbort === delCtrl) v.delegationAbort = null;
          if (err?.name === "AbortError" || v.delegationSeq !== mySeq) return;
          if (voice === v && !v.ending) {
            v.ignoreLiveTranscript = false;
            if (v.activeVoice?.kind !== "custom-tts") unmuteLiveAudio(v);
            voiceSay(tx("Dinliyorum"), "attentive");
          }
        }
      })();
    }
  };
}

async function setVoiceChoice(id, { restart = false } = {}){
  const prevId = selectedVoice();
  const meta = voiceMeta(id);
  const next = meta.id;
  const changed = next !== prevId;
  LS.set("nakata_voice", next);
  paintVoiceControls();
  if (!(restart && changed && voice && !voice.ending)) return;

  const v = voice;
  const gen = ++voiceSwitchGen;
  stopCustomVoiceSpeech(v);

  // Instant 0ms hot switch for custom trained voices OR returning to the already-connected transportVoice.
  const targetTransport = meta.kind === "custom-tts" ? (v.transportVoice || defaultVoiceId) : (meta.serverVoiceId || meta.id);
  if (meta.kind === "custom-tts" || targetTransport === v.transportVoice) {
    v.activeVoice = meta;
    if (v.audio) v.audio.muted = (meta.kind === "custom-tts");
    if (meta.kind === "custom-tts") {
      try { if (v.dc?.readyState === "open") v.dc.send(JSON.stringify({ type: "response.cancel" })); } catch {}
    }
    paintVoiceControls();
    if (v.id && !meta.localOnly) {
      void api("/voice/switch", { method: "POST", body: { sessionId: v.id, voice: meta.serverVoiceId || meta.id } }).catch(() => {});
    }
    return;
  }

  // Make-before-break WebRTC hot-swap: keep current call, mic, timer, and audio running
  // until the new forked/continued WebRTC peer is ready, then atomically swap.
  paintVoiceControls(tx(`Ses: ${meta.label} · …`));
  let nextPc = null, nextDc = null, nextAudio = null;
  try {
    nextPc = new RTCPeerConnection();
    nextAudio = document.createElement("audio");
    nextAudio.autoplay = true;
    nextAudio.playsInline = true;
    nextAudio.hidden = true;
    nextAudio.muted = true;
    document.body.append(nextAudio);
    nextPc.ontrack = (e) => { nextAudio.srcObject = e.streams[0]; nextAudio.play().catch(() => {}); };
    for (const t of v.stream?.getTracks?.() || []) nextPc.addTrack(t, v.stream);
    nextDc = nextPc.createDataChannel("oai-events");
    let resolveReady;
    const readyPromise = new Promise((res) => { resolveReady = res; });
    const markReady = () => { if (nextDc.readyState === "open" || nextPc.connectionState === "connected") resolveReady?.(); };
    nextDc.onopen = markReady;
    nextPc.onconnectionstatechange = markReady;
    nextDc.onmessage = (m) => {
      try { const ev = JSON.parse(m.data); if (ev.type === "session.started") resolveReady?.(); } catch {}
    };

    await nextPc.setLocalDescription(await nextPc.createOffer());
    await waitForIceOffer(nextPc);
    if (voice !== v || v.ending || voiceSwitchGen !== gen) throw new Error("superseded");

    const r = await api("/voice/switch", {
      method: "POST",
      body: {
        sessionId: v.id,
        sdp: nextPc.localDescription.sdp,
        voice: meta.serverVoiceId || meta.id,
        history: v.turns || [],
      },
    });
    if (!r.ok || !r.j?.sdp || !r.j?.sessionId) throw new Error("switch_failed");
    if (voice !== v || v.ending || voiceSwitchGen !== gen) {
      void api("/voice/end", { method: "POST", body: { sessionId: r.j.sessionId }, keepalive: true });
      throw new Error("superseded");
    }

    await nextPc.setRemoteDescription({ type: "answer", sdp: r.j.sdp });
    markReady();
    await Promise.race([readyPromise, wait(2500)]);
    if (voice !== v || v.ending || voiceSwitchGen !== gen) {
      void api("/voice/end", { method: "POST", body: { sessionId: r.j.sessionId }, keepalive: true });
      throw new Error("superseded");
    }

    const oldId = v.id, oldPc = v.pc, oldDc = v.dc, oldAudio = v.audio;
    if (oldPc) { oldPc.onconnectionstatechange = null; oldPc.ontrack = null; }
    if (oldDc) { oldDc.onmessage = null; }

    v.id = r.j.sessionId;
    v.pc = nextPc;
    v.dc = nextDc;
    v.audio = nextAudio;
    v.transportVoice = r.j.transportVoice || targetTransport;
    v.activeVoice = meta;
    bindVoiceTransport(v, nextPc, nextDc, nextAudio);
    nextAudio.muted = false;
    nextAudio.play().catch(() => {});
    paintVoiceControls();
    voiceSay(tx("Dinliyorum"));

    try { if (oldAudio) { oldAudio.pause(); oldAudio.srcObject = null; oldAudio.remove(); } } catch {}
    try { if (oldDc?.readyState === "open") oldDc.send(JSON.stringify({ type: "session.close" })); } catch {}
    try { oldDc?.close(); oldPc?.close(); } catch {}
    if (oldId && oldId !== v.id) {
      void api("/voice/end", { method: "POST", body: { sessionId: oldId }, keepalive: true });
    }
  } catch (err) {
    try { nextDc?.close(); nextPc?.close(); } catch {}
    try { nextAudio?.pause(); if (nextAudio) { nextAudio.srcObject = null; nextAudio.remove(); } } catch {}
    if (voice === v && !v.ending && voiceSwitchGen === gen && err?.message !== "superseded") {
      LS.set("nakata_voice", prevId);
      v.activeVoice = voiceMeta(prevId);
      paintVoiceControls();
      voiceSay(tx("Ses değiştirilemedi, mevcut ses sürüyor."));
    }
  }
}

function openVoiceSheet(){
  const list = $("#voiceList"), sheet = $("#voiceSheet"), scrim = $("#scrim");
  if (!list || !sheet || !scrim) return;
  const cur = selectedVoice();
  const catalog = allVoiceCatalog();
  list.innerHTML = "";
  for (const item of catalog) {
    const row = el("div", "botopt" + (item.id === cur ? " on" : ""));
    const main = el("button", "botmain");
    const meta = el("div", "meta");
    meta.append(el("div", "nm", item.label), el("div", "ds", tx(item.hint || "Sıcak ve çekici")));
    main.append(meta);
    const chk = el("span", "chk");
    chk.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
    main.append(chk);
    main.addEventListener("click", () => { closeSheet(); haptic(); void setVoiceChoice(item.id, { restart: true }); });
    row.append(main);
    list.append(row);
  }
  const topZ = Number($("#f-voice").style.zIndex || pageZ || 70);
  scrim.style.zIndex = String(topZ + 1);
  sheet.style.zIndex = String(topZ + 2);
  scrim.classList.add("on");
  sheet.classList.add("on");
  list.scrollTop = 0;
  list.classList.toggle("scrolls", list.scrollHeight > list.clientHeight + 2);
}

const voiceOrb = orb({ size: 120, color: NAKATA_ORB_COLOR, expression: "neutral" });
$("#voiceOrb").append(voiceOrb.el);
function voiceSay(state, face){
  $("#voiceState").textContent = state;
  if ($("#voiceMiniState") && voice && !voice.ending) $("#voiceMiniState").textContent = state;
  if (face) voiceOrb.set(face);
}
function voiceFaceFrom(text, fallback = "happy"){
  const t = String(text || "").trim();
  const tone = t ? window.__mascotReact?.toneOf?.(t) : null;
  if (tone) return tone.face;
  if (/\?\s*$/.test(t)) return "curious";
  return fallback;
}
function fmtTime(sec){ return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }

function notifyNativeVoiceAudio(active){
  try { window.webkit?.messageHandlers?.nakataAudio?.postMessage({ active: !!active }); } catch {}
}
function activeVoiceChatContext(){
  if (!isMemoryEnabled()) return "";
  const parts = [];
  const sessTitle = curId ? allSessions()[curId]?.title : "";
  if (sessTitle) parts.push(`Sohbet: ${sessTitle}`);
  const recentUsers = (Array.isArray(convo) ? convo : [])
    .filter((m) => m?.role === "user" && typeof m.content === "string")
    .slice(-2)
    .map((m) => m.content.trim().slice(0, 120))
    .filter(Boolean);
  if (recentUsers.length) parts.push(recentUsers.join(" | "));
  if (!parts.length) {
    const localSummary = Object.values(allSessions())
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 3)
      .map((s) => (s.title || "").trim())
      .filter(Boolean)
      .join(" | ");
    if (localSummary) parts.push(`Son sohbetler: ${localSummary}`);
  }
  return parts.join(" — ").slice(0, 320);
}

function startOrbPulseLoop(v){
  if (!v || v.ending || !v.analyser || v.raf) return;
  const data = new Uint8Array(v.analyser.frequencyBinCount);
  const wave = new Uint8Array(v.analyser.fftSize);
  const pulse = () => {
    if (!voice || voice !== v || v.ending || !$("#f-voice")?.classList.contains("on")) {
      v.raf = 0;
      voiceOrb.el.style.transform = "";
      return;
    }
    v.analyser.getByteFrequencyData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
    const amp = Math.min(1, (sum / (data.length || 1)) / 90);
    voiceOrb.el.style.transform = `scale(${(1 + amp * 0.14).toFixed(3)})`;
    // Local AEC-cleaned mic barge-in: cut residual buffered speaker audio in <90ms when user speaks over assistant.
    if (v.assistantSpeaking && !v.bargeInMuted && Date.now() - (v.assistantSpeakStartAt || 0) > 180) {
      v.analyser.getByteTimeDomainData(wave);
      let sq = 0;
      for (let i = 0; i < wave.length; i++) {
        const n = (wave[i] - 128) / 128;
        sq += n * n;
      }
      const rms = Math.sqrt(sq / (wave.length || 1));
      if (rms >= 0.062) {
        v.bargeSpeechFrames = (v.bargeSpeechFrames || 0) + 1;
        if (v.bargeSpeechFrames >= 5) {
          v.interruptAssistantOutput?.({ keepInput: true });
        }
      } else {
        v.bargeSpeechFrames = Math.max(0, (v.bargeSpeechFrames || 0) - 2);
      }
    } else {
      v.bargeSpeechFrames = 0;
    }
    v.raf = requestAnimationFrame(pulse);
  };
  v.raf = requestAnimationFrame(pulse);
}

function minimizeVoice(){
  if ($("#voiceSheet")?.classList.contains("on")) closeSheet();
  $("#f-voice").classList.remove("on");
  if (voice && !voice.ending) {
    if (voice.raf) { cancelAnimationFrame(voice.raf); voice.raf = 0; }
    voiceOrb.el.style.transform = "";
    syncVoiceMiniBar();
    resumeVoiceAudio();
  }
}

function openVoicePage(){
  showPage("#f-voice");
  syncVoiceMiniBar();
  if (voice && !voice.ending) {
    startOrbPulseLoop(voice);
    resumeVoiceAudio();
  }
  haptic();
}

async function startVoice(){
  if (voice && !voice.ending) { openVoicePage(); return; }
  if (voice) return;
  if (!token()) { openAccount(); return; }
  showPage("#f-voice"); haptic();
  paintVoiceControls();
  voiceOrb.setColor(orbColor()); $("#voiceTimer").textContent = "";
  const vfInit = $("#voiceFree"); if (vfInit) { vfInit.textContent = ""; vfInit.hidden = true; }
  clearVoiceSpeechLine(null);
  const vctx = $("#voiceContext"); if (vctx) { vctx.textContent = ""; vctx.hidden = true; }
  const localBotPreview = !galleryBot && activeBot ? (allBots()[activeBot] || BOT_TEMPLATES.find((t) => t.name === activeBot)) : null;
  const ctxEl = $("#voiceContext");
  if (ctxEl) {
    const parts = [];
    if (galleryBot?.name) parts.push(`${tx("Bot")}: ${galleryBot.name}`);
    else if (activeBot && localBotPreview) {
      const nRules = activeBotLessons(localBotPreview).length;
      parts.push(`${tx("Bot")}: ${activeBot}${nRules ? ` (${nRules} ${tx("kural")})` : ""}`);
    }
    if (activeAgentPairId) parts.push(tx("Mac bağlı"));
    ctxEl.textContent = parts.join(" · ");
    ctxEl.hidden = parts.length === 0;
  }
  voiceSay("Bağlanıyor…", "thinking");
  const initialVoice = voiceMeta(selectedVoice());
  const v = voice = {
    ending: false, id: null, raf: 0, ac: null, analyser: null,
    caption: "", discT: 0, faceT: 0, lastFaceAt: 0, pingBusy: false,
    activeVoice: initialVoice, transportVoice: initialVoice.kind === "custom-tts" ? defaultVoiceId : (initialVoice.serverVoiceId || initialVoice.id),
    turns: [], ttsPlaySeq: 0, customAudioUrl: "",
    freeLeftSec: null, freeSyncAt: 0, creditsPerMin: null,
    liveAsstBuf: "", liveAsstEl: null, liveAsstCommitted: false,
    skipLiveChatPersist: false, userPersistedForTurn: false,
    lastTurnUserPersisted: "", pendingUserText: "",
    assistantSpeaking: false, assistantSpeakStartAt: 0, lastUserSpeechAt: 0,
    bargeInMuted: false, bargeInDuckT: 0, asstIdleT: 0,
    delegationAbort: null, delegationSeq: 0, bargeSpeechFrames: 0,
  };
  syncVoiceMiniBar();
  try {
    const hasNativeAudio = !!window.webkit?.messageHandlers?.nakataAudio;
    // Create & unlock audio elements inside the user-tap turn so iOS WebKit allows playback later when minimized or speaking custom TTS.
    v.audio = document.createElement("audio");
    v.audio.autoplay = true; v.audio.playsInline = true; v.audio.hidden = true;
    v.audio.muted = (initialVoice.kind === "custom-tts");
    document.body.append(v.audio);

    v.customAudio = document.createElement("audio");
    v.customAudio.playsInline = true; v.customAudio.hidden = true;
    document.body.append(v.customAudio);
    try { v.customAudio.src = SILENT_WAV_URI; v.customAudio.play().then(() => v.customAudio?.pause()).catch(() => {}); } catch {}
    // Create and unlock dedicated Web AudioContext inside the tap gesture so iOS WKWebView reliably plays custom TTS after async fetches.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        v.ttsAc = new AC();
        v.ttsAc.resume().catch(() => {});
        const sil = v.ttsAc.createBuffer(1, 1, 22050);
        const s0 = v.ttsAc.createBufferSource();
        s0.buffer = sil; s0.connect(v.ttsAc.destination); s0.start(0);
      }
    } catch {}

    const st = await api("/voice/status");
    if (st.ok && Array.isArray(st.j.voices) && st.j.voices.length) {
      voiceCatalog = st.j.voices;
      if (st.j.defaultVoice) defaultVoiceId = st.j.defaultVoice;
      v.activeVoice = voiceMeta(selectedVoice());
      v.transportVoice = v.activeVoice.kind === "custom-tts" ? defaultVoiceId : (v.activeVoice.serverVoiceId || v.activeVoice.id);
      if (v.audio) v.audio.muted = (v.activeVoice.kind === "custom-tts");
      paintVoiceControls();
    }
    if (st.ok && st.j.enabled === false) throw new Error(VOICE_MSG.voice_closed);
    if (st.ok && st.j.freeLeftSec != null) syncVoiceQuota(v, st.j.freeLeftSec, st.j.creditsPerMin);
    v.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (hasNativeAudio) notifyNativeVoiceAudio(true);
    else { try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {} }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        v.ac = new AC();
        v.acStream = typeof v.stream.clone === "function" ? v.stream.clone() : v.stream;
        const analyser = v.analyser = v.ac.createAnalyser(); analyser.fftSize = 128;
        v.ac.createMediaStreamSource(v.acStream).connect(analyser);
        startOrbPulseLoop(v);
      }
    } catch {}
    const pc = v.pc = new RTCPeerConnection();
    for (const t of v.stream.getTracks()) pc.addTrack(t, v.stream);
    const dc = v.dc = pc.createDataChannel("oai-events");
    bindVoiceTransport(v, pc, dc, v.audio);

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceOffer(pc);
    const pf = LS.get("nakata_profile", {});
    const memOn = isMemoryEnabled();
    const activeChat = memOn ? activeVoiceChatContext() : "";
    const voiceProfile = {
      name: pf?.name || undefined,
      about: pf?.about || undefined,
      style: pf?.style || undefined,
      activeChat: activeChat || undefined,
    };
    const localBotObj = !galleryBot && activeBot ? (allBots()[activeBot] || BOT_TEMPLATES.find((t) => t.name === activeBot)) : null;
    const customBot = !galleryBot && activeBot && localBotObj ? {
      name: activeBot,
      persona: localBotObj.persona || "",
      lessons: activeBotLessons(localBotObj).map((l) => l.text.trim()),
    } : undefined;
    const chosenVoice = v.activeVoice;
    const r = await api("/voice/session", {
      method: "POST",
      body: {
        sdp: pc.localDescription.sdp,
        voice: chosenVoice.local ? defaultVoiceId : (chosenVoice.serverVoiceId || chosenVoice.id),
        bot: galleryBot?.id || undefined,
        customBot,
        pairId: activeAgentPairId || undefined,
        memory: memOn,
        profile: voiceProfile,
      },
    });
    if (!r.ok) throw new Error(VOICE_MSG[r.j?.error?.code] || r.j?.error?.message || "Sesli görüşme başlatılamadı.");
    v.id = r.j.sessionId;
    if (r.j.transportVoice) v.transportVoice = r.j.transportVoice;
    if (r.j.freeLeftSec != null || r.j.creditsPerMin != null) syncVoiceQuota(v, r.j.freeLeftSec, r.j.creditsPerMin);
    await pc.setRemoteDescription({ type: "answer", sdp: r.j.sdp });
    v.pingNow = async (keepalive = false) => {
      if (!voice || v.ending || !v.id || v.pingBusy) return;
      v.pingBusy = true;
      try {
        const p = await api("/voice/ping", { method: "POST", body: { sessionId: v.id }, keepalive });
        if (p.ok && voice === v && !v.ending) {
          if (p.j.freeLeftSec != null || p.j.creditsPerMin != null) syncVoiceQuota(v, p.j.freeLeftSec, p.j.creditsPerMin);
          if (p.j.stop) endVoice(p.j.freeLeftSec > 0 ? "Görüşme süresi doldu." : "Kredin bitti, görüşme sonlandı.");
        }
      } finally {
        v.pingBusy = false;
      }
    };
    v.ping = setInterval(() => { void v.pingNow(false); }, Math.min(r.j.pingEverySec || 20, 12) * 1000);
  } catch (e) {
    hapticError();
    await endVoice(e.name === "NotAllowedError" ? "Mikrofon izni verilmedi. Ayarlar'dan izin verebilirsin." : (e.message || "Sesli görüşme başlatılamadı."));
  }
}

async function endVoice(note, { keepOpen = false } = {}){
  if (!keepOpen) { voiceGen++; voiceSwitchGen++; }
  const v = voice;
  if (!v || v.ending) { if (!keepOpen) { $("#f-voice").classList.remove("on"); notifyNativeVoiceAudio(false); syncVoiceMiniBar(); } return; }
  v.ending = true; voice = null;
  if (v.inp?.trim() && !v.userPersistedForTurn) commitVoiceUserToChat(v, v.inp);
  if (v.liveAsstBuf?.trim() && !v.liveAsstCommitted && !v.skipLiveChatPersist) finalizeVoiceAssistantToChat(v, v.liveAsstBuf);
  clearInterval(v.ping); clearInterval(v.tick); clearTimeout(v.discT); clearTimeout(v.faceT);
  clearTimeout(v.asstIdleT); clearTimeout(v.bargeInDuckT);
  cancelAnimationFrame(v.raf);
  abortPendingDelegation(v);
  stopCustomVoiceSpeech(v);
  if ($("#voiceSheet")?.classList.contains("on")) closeSheet();
  voiceOrb.el.style.transform = "";
  voiceOrb.set("neutral");
  clearVoiceSpeechLine(v);
  const vfEnd = $("#voiceFree"); if (vfEnd) { vfEnd.textContent = ""; vfEnd.hidden = true; }
  const vctx = $("#voiceContext"); if (vctx) { vctx.textContent = ""; vctx.hidden = true; }
  for (const t of v.stream?.getTracks?.() || []) { try { t.stop(); } catch {} }
  if (v.acStream && v.acStream !== v.stream) {
    for (const t of v.acStream.getTracks?.() || []) { try { t.stop(); } catch {} }
  }
  if (v.audio) { try { v.audio.pause(); v.audio.srcObject = null; v.audio.remove(); } catch {} }
  if (v.customAudio) { try { v.customAudio.pause(); v.customAudio.remove(); } catch {} }
  if (!keepOpen) {
    $("#f-voice").classList.remove("on");
    syncVoiceMiniBar();
    notifyNativeVoiceAudio(false);
    if (!window.webkit?.messageHandlers?.nakataAudio) {
      try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
    }
  }
  if (note) addNote(note, true);
  try { void v.ac?.close?.()?.catch?.(() => {}); } catch {}
  try { void v.ttsAc?.close?.()?.catch?.(() => {}); } catch {}
  try {
    if (v.dc?.readyState === "open") { v.dc.send(JSON.stringify({ type: "session.close" })); await Promise.race([new Promise((res) => { v.closed = res; }), wait(keepOpen ? 800 : 1200)]); }
  } catch {}
  if (v.id) {
    const endReq = api("/voice/end", { method: "POST", body: { sessionId: v.id }, keepalive: true });
    if (keepOpen) await endReq;
  }
  try { v.dc?.close(); v.pc?.close(); } catch {}
}
$("#micBtn").addEventListener("click", startVoice);
$("#voicePick")?.addEventListener("click", openVoiceSheet);
$("#voiceEnd").addEventListener("click", () => endVoice());
$("#voiceClose").addEventListener("click", minimizeVoice);
$("#voiceMiniOpen")?.addEventListener("click", openVoicePage);
$("#voiceMiniEnd")?.addEventListener("click", () => endVoice());
$("#voiceCustomAdd")?.addEventListener("click", () => {
  closeSheet();
  minimizeVoice();
  openSettings();
  const form = $("#cv-form");
  if (form) form.hidden = false;
  setTimeout(() => $("#cv-name")?.focus(), 200);
});
$("#cv-toggle-form")?.addEventListener("click", () => {
  const form = $("#cv-form"); if (!form) return;
  form.hidden = !form.hidden;
  if (!form.hidden) $("#cv-name")?.focus();
});
$("#cv-kind")?.addEventListener("change", () => {
  const isTts = $("#cv-kind")?.value !== "gpt-live";
  if ($("#cv-url-wrap")) $("#cv-url-wrap").hidden = !isTts;
  if ($("#cv-tok-wrap")) $("#cv-tok-wrap").hidden = !isTts;
});
$("#cv-test")?.addEventListener("click", async () => {
  const errEl = $("#cv-err");
  if (errEl) { errEl.hidden = true; errEl.textContent = ""; }
  const kind = $("#cv-kind")?.value === "gpt-live" ? "gpt-live" : "custom-tts";
  const url = ($("#cv-url")?.value || "").trim();
  const ttsVoice = ($("#cv-voice")?.value || "").trim() || "default";
  const tok = ($("#cv-token")?.value || "").trim();
  if (kind !== "custom-tts") {
    if (errEl) { errEl.textContent = tx("Ses çalıştı."); errEl.style.color = "var(--muted)"; errEl.hidden = false; }
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    if (errEl) { errEl.style.color = ""; errEl.textContent = tx("Geçerli bir http/https TTS adresi gir."); errEl.hidden = false; }
    return;
  }
  const btn = $("#cv-test");
  if (btn) { btn.disabled = true; btn.textContent = tx("Test ediliyor…"); }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ model: "custom", input: "Merhaba, ses testi başarılı.", voice: ttsVoice, response_format: "wav" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("audio");
    a.src = blobUrl; a.playsInline = true; a.hidden = true; document.body.append(a);
    a.onended = a.onerror = () => { URL.revokeObjectURL(blobUrl); a.remove(); };
    await a.play();
    if (errEl) { errEl.style.color = "var(--muted)"; errEl.textContent = tx("Ses çalıştı."); errEl.hidden = false; }
  } catch {
    if (errEl) { errEl.style.color = ""; errEl.textContent = tx("Özel ses sunucusuna bağlanılamadı."); errEl.hidden = false; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = tx("Sesi test et"); }
  }
});
$("#cv-save")?.addEventListener("click", () => {
  const errEl = $("#cv-err");
  if (errEl) { errEl.hidden = true; errEl.style.color = ""; errEl.textContent = ""; }
  const label = ($("#cv-name")?.value || "").trim().slice(0, 48);
  const kind = $("#cv-kind")?.value === "gpt-live" ? "gpt-live" : "custom-tts";
  const url = ($("#cv-url")?.value || "").trim();
  const ttsVoice = ($("#cv-voice")?.value || "").trim().slice(0, 80);
  const tok = ($("#cv-token")?.value || "").trim();
  if (!label || !ttsVoice) {
    if (errEl) { errEl.textContent = tx("Geçerli bir ses adı ve ID gir."); errEl.hidden = false; }
    return;
  }
  if (kind === "custom-tts" && !/^https?:\/\//i.test(url)) {
    if (errEl) { errEl.textContent = tx("Geçerli bir http/https TTS adresi gir."); errEl.hidden = false; }
    return;
  }
  const slug = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || String(Date.now());
  const id = kind === "gpt-live" ? ttsVoice : `local:${slug}`;
  const entry = {
    id,
    label,
    hint: kind === "custom-tts" ? "Özel ses" : "OpenAI GPT-Live Özel Ses ID",
    kind,
    local: kind === "custom-tts",
    localOnly: kind === "custom-tts",
    ...(kind === "custom-tts" ? { url, ttsVoice } : { serverVoiceId: ttsVoice }),
  };
  customVoices = [...customVoices.filter((x) => x.id !== id), entry];
  if (tok && kind === "custom-tts") customVoiceTokens[id] = tok;
  else delete customVoiceTokens[id];
  saveCustomVoices();
  $("#cv-name").value = ""; $("#cv-url").value = ""; $("#cv-voice").value = ""; $("#cv-token").value = "";
  if ($("#cv-form")) $("#cv-form").hidden = true;
  paintCustomVoicesUI();
  void setVoiceChoice(id, { restart: true });
  haptic();
});
function resumeVoiceAudio(){
  if (!voice || voice.ending) return;
  try { voice.ac?.resume?.().catch?.(() => {}); } catch {}
  try { voice.ttsAc?.resume?.().catch?.(() => {}); } catch {}
  if (voice.audio?.srcObject && voice.audio.paused) voice.audio.play().catch(() => {});
  if (voice.customAudio?.src && voice.customAudio.paused && voice.ttsPlaySeq) voice.customAudio.play().catch(() => {});
  voice.pingNow?.(false);
}
// Keep active voice calls alive in the background; keep heartbeat fresh & resume audio when returning.
document.addEventListener("visibilitychange", () => {
  if (!voice || voice.ending) return;
  if (document.hidden) { voice.pingNow?.(true); }
  else { resumeVoiceAudio(); }
});
window.addEventListener("nakata:audio-resumed", resumeVoiceAudio);
