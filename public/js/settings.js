/* ---- provider presets ---- */
const PROVIDERS = {
  // Keyless, served by nakata.app on our key behind daily limits (routes/mobile.js).
  nakata:{ base:"https://nakata.app/api/mobile", model:"gemma4", free:true, keyUrl:"", hint:"" },
  openrouter:{ base:"https://openrouter.ai/api/v1", model:"openai/gpt-4o-mini",
               keyUrl:"https://openrouter.ai/keys", hint:"Örnek: openai/gpt-4o-mini, anthropic/claude-sonnet-4, google/gemini-2.5-flash" },
  openai:{ base:"https://api.openai.com/v1", model:"gpt-4o-mini",
           keyUrl:"https://platform.openai.com/api-keys", hint:"Örnek: gpt-4o-mini, gpt-4o, o4-mini" },
  groq:{ base:"https://api.groq.com/openai/v1", model:"llama-3.3-70b-versatile",
         keyUrl:"https://console.groq.com/keys", hint:"Örnek: llama-3.3-70b-versatile, moonshotai/kimi-k2-instruct" },
  deepseek:{ base:"https://api.deepseek.com/v1", model:"deepseek-chat",
             keyUrl:"https://platform.deepseek.com/api_keys", hint:"Örnek: deepseek-chat, deepseek-reasoner" },
  gemini:{ base:"https://generativelanguage.googleapis.com/v1beta/openai", model:"gemini-4-hydrogen",
           keyUrl:"https://aistudio.google.com/apikey", hint:"Örnek: gemini-4-hydrogen, gemini-3.8-flash, gemini-4-argon, gemini-2.5-pro" },
  // ollama.com sends no CORS headers, so the app reaches it through a fixed-URL relay on nakata.app; the key is not stored there.
  ollama:{ base:"https://nakata.app/api/mobile/ollama", model:"gemma4:31b",
           keyUrl:"https://ollama.com/settings/keys", hint:"Anahtarın nakata.app üzerinden doğrudan Ollama'ya gider, orada saklanmaz. Örnek: gemma4:31b, glm-5.3, kimi-k3" },
  custom:{ base:"", model:"", keyUrl:"", hint:"OpenAI uyumlu herhangi bir adres (…/v1)" },
};
const FREE_CFG = { provider:"nakata", base:PROVIDERS.nakata.base, model:PROVIDERS.nakata.model, key:"" };
const DEFAULT_NAKATA_MODELS = [
  { id:"gemma4", label:"Gemma 4", free:true, main:true },
  { id:"gemini-4-hydrogen", label:"Gemini 4 Hydrogen", free:true, fallback:true },
  { id:"deepseek-v4.1-flash", label:"DeepSeek V4.1 Flash", free:true },
  { id:"minimax-m2.7", label:"MiniMax M2.7", free:true },
  { id:"refuseless/glm-5.3-abliterated", label:"GLM 5.3 Abliterated", requiresConsent:true, free:false, credits:1 },
  { id:"refuseless/glm-5.3-flash-abliterated", label:"GLM 5.3 Flash Abliterated", requiresConsent:true, free:false, credits:1 },
  { id:"refuseless/deepseek-v4.1-flash-abliterated", label:"DeepSeek V4.1 Flash Abliterated", requiresConsent:true, free:false, credits:1 },
];
/* BYOK settings. The API key belongs in the iOS Keychain, not in localStorage: the key is
   read once at boot into cfgCache so the rest of the app keeps working synchronously. */
const BYOK_KEY = "nakata_byok_cfg";
const BYOK_SAVED_KEY = "nakata_byok_saved";
let cfgCache = null;
let byokSavedCache = null;
const keychain = () => NATIVE.SecureStorage || null;
function getCfg(){ const c = cfgCache; return c && (c.provider === "nakata" || c.key) ? c : { ...FREE_CFG }; }
function getByokCfg(){ const c = getCfg(); if (c.provider !== "nakata" && c.key) return c; return byokSavedCache && byokSavedCache.provider !== "nakata" && byokSavedCache.key ? byokSavedCache : null; }
function saveCfg(c){
  cfgCache = c;
  const kc = keychain();
  if (kc) kc.set({ key: BYOK_KEY, value: JSON.stringify(c) }).catch(() => {});
  else LS.set(BYOK_KEY, c);
  if (c && c.provider !== "nakata" && c.key) {
    byokSavedCache = { provider: c.provider, base: c.base, model: c.model, key: c.key };
    if (kc) kc.set({ key: BYOK_SAVED_KEY, value: JSON.stringify(byokSavedCache) }).catch(() => {});
    else LS.set(BYOK_SAVED_KEY, byokSavedCache);
  }
}
async function loadCfg(){
  const kc = keychain();
  if (!kc) {
    cfgCache = LS.get(BYOK_KEY, null);
    byokSavedCache = LS.get(BYOK_SAVED_KEY, null);
    if (!byokSavedCache && cfgCache && cfgCache.provider !== "nakata" && cfgCache.key) byokSavedCache = { ...cfgCache };
    return;
  }
  let raw = null, rawSaved = null;
  try { raw = (await kc.get({ key: BYOK_KEY })).value || null; } catch {}
  try { rawSaved = (await kc.get({ key: BYOK_SAVED_KEY })).value || null; } catch {}
  const legacy = LS.get(BYOK_KEY, null);
  if (legacy) {                              // a key saved by a build that still used plaintext storage
    if (!raw) { raw = JSON.stringify(legacy); try { await kc.set({ key: BYOK_KEY, value: raw }); } catch {} }
    LS.del(BYOK_KEY);
  }
  const legacySaved = LS.get(BYOK_SAVED_KEY, null);
  if (legacySaved) {
    if (!rawSaved) { rawSaved = JSON.stringify(legacySaved); try { await kc.set({ key: BYOK_SAVED_KEY, value: rawSaved }); } catch {} }
    LS.del(BYOK_SAVED_KEY);
  }
  try { cfgCache = raw ? JSON.parse(raw) : null; } catch { cfgCache = null; }
  try { byokSavedCache = rawSaved ? JSON.parse(rawSaved) : null; } catch { byokSavedCache = null; }
  if (!byokSavedCache && cfgCache && cfgCache.provider !== "nakata" && cfgCache.key) byokSavedCache = { ...cfgCache };
}

/* ---- settings ---- */
function fillProviderUI(p){
  const pr = PROVIDERS[p] || PROVIDERS.custom;
  $("#st-byok").hidden = !!pr.free; $("#st-freehint").hidden = !pr.free;
  $("#st-adult-section").hidden = false;
  $("#st-base").value = pr.base; $("#st-base").readOnly = (p !== "custom");
  $("#st-model").placeholder = pr.model || "model-adı";
  $("#st-modelhint").textContent = pr.hint || "";
  $("#st-getkey").innerHTML = pr.keyUrl ? `Almak için: <a href="${pr.keyUrl}" target="_blank" rel="noopener">${pr.keyUrl.replace(/^https?:\/\//,"")}</a>` : "";
}
let adultConsent = false;
let adultFeatureEnabled = false;
let adultConsentBusy = false;
function paintAdultConsent(){
  const select = $("#st-adult"), hint = $("#st-adult-hint");
  select.value = adultConsent ? "on" : "off";
  select.disabled = !adultFeatureEnabled || !token() || adultConsentBusy;
  hint.textContent = !adultFeatureEnabled ? tx("Yaş doğrulama yöntemi hukuki açıdan onaylanana kadar 18+ modeller kapalı.")
    : !token() ? tx("Bu özellik için hesabına giriş yapmalısın.")
    : adultConsent ? tx("18+ onayı açık. Yetişkinler arasındaki açık cinsel içerik desteklenir; 18 yaş altı kişileri içeren cinsel içerik ve diğer güvenlik sınırları kapalı kalır.")
    : tx("Sansürsüz modelleri görmek için 18+ onayını aç.");
}
async function refreshAdultConsent(){
  if (!token()) { adultConsent = false; adultFeatureEnabled = false; paintAdultConsent(); return false; }
  adultConsentBusy = true; paintAdultConsent();
  const r = await api("/uncensored-consent");
  const previous = adultConsent, wasEnabled = adultFeatureEnabled;
  adultFeatureEnabled = !!(r.ok && r.j?.enabled === true);
  adultConsent = adultFeatureEnabled && r.j?.adult === true;
  if (adultConsent !== previous || adultFeatureEnabled !== wasEnabled) modelCache = {};
  adultConsentBusy = false; paintAdultConsent();
  return adultConsent;
}
function isMemoryEnabled(){ return LS.get("nakata_memory_off", false) !== true; }
function paintMemorySetting(){
  const sel = $("#st-memory"), hint = $("#st-memory-hint"), clearBtn = $("#st-memory-clear");
  if (!sel || !hint) return;
  const on = isMemoryEnabled();
  sel.value = on ? "on" : "off";
  sel.disabled = !token();
  if (clearBtn) clearBtn.hidden = !token();
  hint.textContent = !token()
    ? tx("Bu özellik için hesabına giriş yapmalısın.")
    : on
      ? tx("Hafıza açık. Yalnız kendi hesabına ait güvenli notlar saklanır; silinen sohbetler ve temizle butonu anında siler.")
      : tx("Bu özellik kapalı. Açtığında giriş yapılı sohbetler arası hatırlama çalışır.");
}
function openSettings(){
  const c = getCfg();
  $("#st-provider").value = c.provider; fillProviderUI(c.provider);
  $("#st-base").value = c.base || (PROVIDERS[c.provider]||{}).base || "";
  $("#st-key").value = c.key || ""; $("#st-model").value = c.model || "";
  const pf = LS.get("nakata_profile", {}); $("#pf-name").value = pf.name || ""; $("#pf-about").value = pf.about || ""; $("#pf-style").value = pf.style || "";
  paintVoiceControls();
  paintMemorySetting();
  closeDrawer(); showPage("#f-settings");
  void refreshAdultConsent();
}
$("#settingsRow").addEventListener("click", openSettings);
$("#st-voice")?.addEventListener("change", (e) => { setVoiceChoice(e.target.value); haptic(); });
$("#st-memory")?.addEventListener("change", (e) => {
  LS.set("nakata_memory_off", e.target.value !== "on");
  paintMemorySetting();
  haptic();
});
$("#st-memory-clear")?.addEventListener("click", async () => {
  if (!token()) { openAccount(); return; }
  if (!confirm(tx("Kayıtlı tüm sohbet hafızan silinsin mi? Bu işlem geri alınamaz."))) return;
  const btn = $("#st-memory-clear"), hint = $("#st-memory-hint");
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = tx("Kayıtlı hafıza temizleniyor…");
  try {
    await chatCloudRequest("/memory", { method: "DELETE" });
    if (hint) hint.textContent = tx("Kayıtlı hafıza temizlendi.");
    haptic();
  } catch {
    if (hint) hint.textContent = tx("Hafıza temizlenemedi. Tekrar dene.");
    hapticError();
  } finally {
    if (btn) btn.disabled = false;
  }
});
$("#st-adult").addEventListener("change", async (e) => {
  const on = e.target.value === "on";
  if (!token()) { e.target.value = "off"; openAccount(); return; }
  if (on && !confirm(tx("Bu mod yalnızca 18 yaş ve üzeri yetişkinler içindir. 18 yaşından küçükleri içeren cinsel içerik, gerçek kişilere yönelik cinsel içerik veya zarar, kitle imha silahları ve zararlı yazılım kesinlikle yasaktır. Devam ederek 18 yaşından büyük olduğunu ve koşulları kabul ettiğini onaylıyor musun?"))) {
    e.target.value = adultConsent ? "on" : "off"; return;
  }
  adultConsentBusy = true; paintAdultConsent();
  const r = await api("/uncensored-consent", { method: "POST", body: { on } });
  adultConsentBusy = false;
  if (!r.ok) { paintAdultConsent(); $("#st-adult-hint").textContent = tx("18+ onayı kaydedilemedi. Tekrar dene."); return; }
  adultConsent = on; modelCache = {};
  if (!on && String(LS.get("nakata_free_model", "")).startsWith("refuseless/")) { LS.del("nakata_free_model"); LS.del("nakata_free_label"); }
  paintAdultConsent();
  haptic();
});
$("#st-provider").addEventListener("change", (e) => {
  const p = e.target.value, pr = PROVIDERS[p] || PROVIDERS.custom;
  fillProviderUI(p);
  // A model name belongs to its provider: switching providers must not keep the
  // previous one (e.g. "openai/gpt-4o-mini" sent to Gemini fails every request).
  if (byokSavedCache && byokSavedCache.provider === p) {
    $("#st-base").value = byokSavedCache.base || pr.base;
    $("#st-key").value = byokSavedCache.key || "";
    $("#st-model").value = byokSavedCache.model || pr.model;
  } else {
    if (p !== "custom") { $("#st-base").value = pr.base; $("#st-model").value = pr.model; }
    if (pr.free) $("#st-key").value = "";
  }
});
$("#st-eye").addEventListener("click", () => { const f = $("#st-key"); f.type = f.type === "password" ? "text" : "password"; });
$("#st-save").addEventListener("click", () => {
  const provider = $("#st-provider").value;
  if ($("#st-voice")?.value) void setVoiceChoice($("#st-voice").value, { restart: true });
  LS.set("nakata_profile", { name: $("#pf-name").value.trim(), about: $("#pf-about").value.trim(), style: $("#pf-style").value.trim() });
  modelCache = {};
  if (PROVIDERS[provider]?.free) { saveCfg({ ...FREE_CFG }); setModelLabel(); $("#f-settings").classList.remove("on"); return; }
  const base = $("#st-base").value.trim().replace(/\/+$/,"");
  const key = $("#st-key").value.trim();
  const model = $("#st-model").value.trim() || (PROVIDERS[provider]||{}).model || "";
  if (!base) return $("#st-base").focus();
  if (!key) return $("#st-key").focus();
  if (!model) return $("#st-model").focus();
  saveCfg({ provider, base, model, key });
  setModelLabel();
  $("#f-settings").classList.remove("on");
});

$("#st-lang").addEventListener("change", (e) => { LANG = e.target.value === "tr" ? "tr" : "en"; LS.set("nakata_lang", LANG); i18nApply(); paintVoiceControls(); haptic(); });
$("#st-theme").addEventListener("change", (e) => { applyTheme(e.target.value); haptic(); });

/* ---- model picker: always shows Free (Gemini 4 Hydrogen main), Abliterated (18+), and any configured BYOK provider ---- */
let modelCache = {};   // provider -> [{ id, label, ... }]
let modelCacheTs = {};
let nakataDefaultModel = PROVIDERS.nakata.model;
const MODEL_LABELS = {
  "gemma-4-31b": "Gemma 4",
  "qwen3-vl-30b": "Qwen 3 VL",
  "qwen3.8-flash-next": "Qwen 3.8 Flash",
  "google/gemma-4-31b-it:free": "Gemma 4 31B",
  "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B",
  "google/gemini-4-hydrogen": "Gemini 4 Hydrogen",
};
function modelDisplayName(id){
  const list = modelCache.nakata || DEFAULT_NAKATA_MODELS;
  const hit = list.find((m) => m.id === id);
  return hit ? hit.label : (MODEL_LABELS[id] || id);
}
function currentModel(){
  const cfg = getCfg();
  if (cfg.provider === "nakata") {
    const id = LS.get("nakata_free_model", "") || nakataDefaultModel;
    const m = (modelCache.nakata || DEFAULT_NAKATA_MODELS).find((x) => x.id === id);
    return { id, label: m ? m.label : (LS.get("nakata_free_label", "") || modelDisplayName(id)) };
  }
  return { id: cfg.model, label: (cfg.model || "").split("/").pop() };
}
function paintModelChip(){ $("#modelChipName").textContent = currentModel().label || "Gemini 4 Hydrogen"; }
async function loadModels(force = false){
  const cfg = getCfg(), byokCfg = getByokCfg();
  const nakataBase = (cfg.provider === "nakata" && cfg.base ? cfg.base : PROVIDERS.nakata.base).replace(/\/+$/, "");
  if (token()) await refreshAdultConsent();
  const stale = force || !modelCache.nakata || !modelCache.nakata.length || (Date.now() - (modelCacheTs.nakata || 0) > 45000);
  if (stale) {
    try {
      const r = await fetch(nakataBase + "/models", { headers: { "X-Nakata-Device": deviceId() } });
      const j = await r.json();
      const raw = Array.isArray(j.models) ? j.models : [];
      const defId = j.default || PROVIDERS.nakata.model;
      nakataDefaultModel = defId;
      const byId = new Map();
      for (const m of DEFAULT_NAKATA_MODELS) byId.set(m.id, { ...m, main: m.id === defId });
      for (const m of raw) {
        if (!m || !m.id) continue;
        byId.set(m.id, { ...(byId.get(m.id) || {}), ...m, main: m.id === defId });
      }
      modelCache.nakata = [...byId.values()];
      modelCacheTs.nakata = Date.now();
      const def = modelCache.nakata.find((m) => m.id === defId) || modelCache.nakata[0];
      if (!LS.get("nakata_free_model", "") && def) LS.set("nakata_free_label", def.label || "Gemini 4 Hydrogen");
    } catch {
      if (!modelCache.nakata || !modelCache.nakata.length) modelCache.nakata = DEFAULT_NAKATA_MODELS.map((m) => ({ ...m }));
    }
  }
  if (byokCfg && byokCfg.key && !modelCache[byokCfg.provider]) {
    try {
      const r = await fetch(byokCfg.base.replace(/\/+$/, "") + "/models", { headers: { Authorization: "Bearer " + byokCfg.key } });
      const j = await r.json();
      modelCache[byokCfg.provider] = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name })).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
    } catch { modelCache[byokCfg.provider] = []; }
  }
  return cfg.provider === "nakata" ? modelCache.nakata : (modelCache[cfg.provider] || modelCache.nakata);
}
async function openModelSheet(){
  closeDrawer(); $("#scrim").classList.add("on"); $("#modelSheet").classList.add("on");
  const list = $("#modelList"); list.replaceChildren(el("div", "note", "Yükleniyor…"));
  await loadModels();
  const cfg = getCfg(), byokCfg = getByokCfg();
  const nakataModels = modelCache.nakata || DEFAULT_NAKATA_MODELS;
  const freeModels = nakataModels.filter((m) => !m.requiresConsent);
  const adultModels = nakataModels.filter((m) => m.requiresConsent);
  const byokModels = (byokCfg && Array.isArray(modelCache[byokCfg.provider])) ? modelCache[byokCfg.provider] : [];
  $("#modelSheetTitle").textContent = tx("Model seç");
  $("#modelSearchRow").hidden = (freeModels.length + adultModels.length + byokModels.length) < 10;
  $("#modelSearch").value = "";

  const makeRow = (m, isCurrent, onPick) => {
    const row = el("div", "botopt" + (isCurrent ? " on" : ""));
    const main = el("button", "botmain"); const meta = el("div", "meta");
    const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
    head.append(el("div", "nm", m.label));
    if (m.main) head.append(el("span", "model-tag", tx("Main")));
    else if (m.requiresConsent) head.append(el("span", "model-tag adult", "18+"));
    else if (m.unavailable) head.append(el("span", "model-tag warn", tx("Yedek aktif")));
    else if (m.fallback) head.append(el("span", "model-tag", tx("Yedek")));
    meta.append(head);
    if (m.unavailable) meta.append(el("div", "hint", tx("Ana model geçici olarak devre dışı; seçilirse otomatik yedek modele geçer.")));
    if (m.requiresConsent) {
      const stateHint = !token() ? tx("Giriş gerekir")
        : !adultFeatureEnabled ? tx("Sistem onayı bekleniyor")
        : adultConsent ? tx("18+ aktif")
        : tx("Dokunarak onayla");
      meta.append(el("div", "hint", tx(`18+ · ${m.credits || 1} kredi/mesaj`) + " · " + stateHint));
    }
    const chk = el("span"); chk.innerHTML = ICON_CHECK; chk.firstChild.classList.add("chk");
    main.append(meta, chk.firstChild);
    main.onclick = onPick;
    row.append(main);
    return row;
  };

  const pickNakataModel = async (m) => {
    if (m.requiresConsent) {
      if (!token()) { closeSheet(); openAccount(); return; }
      if (!adultConsent) {
        await refreshAdultConsent();
        if (!adultFeatureEnabled) { closeSheet(); addNote(tx("Sansürsüz modeller şu anda kapalı."), true); return; }
        if (!adultConsent) {
          if (!confirm(tx("Bu mod yalnızca 18 yaş ve üzeri yetişkinler içindir. 18 yaşından küçükleri içeren cinsel içerik, gerçek kişilere yönelik cinsel içerik veya zarar, kitle imha silahları ve zararlı yazılım kesinlikle yasaktır. Devam ederek 18 yaşından büyük olduğunu ve koşulları kabul ettiğini onaylıyor musun?"))) return;
          const r = await api("/uncensored-consent", { method: "POST", body: { on: true } });
          if (!r.ok) { addNote(tx("18+ onayı kaydedilemedi. Tekrar dene."), true); return; }
          adultConsent = true; paintAdultConsent();
        }
      }
    }
    if (getCfg().provider !== "nakata") saveCfg({ ...FREE_CFG });
    if (m.main || m.id === nakataDefaultModel) {
      LS.del("nakata_free_model");
      LS.del("nakata_free_label");
    } else {
      LS.set("nakata_free_model", m.id);
      LS.set("nakata_free_label", m.label);
    }
    paintModelChip(); closeSheet(); haptic();
  };

  const paint = (q = "") => {
    list.replaceChildren();
    const curCfg = getCfg(), curId = currentModel().id;
    const ql = q.toLowerCase();
    const matches = (m) => !ql || String(m.label || m.id).toLowerCase().includes(ql) || String(m.id).toLowerCase().includes(ql);
    const showByok = byokModels.filter(matches).slice(0, 150);
    const showFree = freeModels.filter(matches);
    const showAdult = adultModels.filter(matches);

    if (!showByok.length && !showFree.length && !showAdult.length) {
      list.append(el("div", "note", tx("Eşleşme yok")));
      return;
    }
    if (showByok.length && byokCfg) {
      list.append(el("div", "sheet-sec", byokCfg.provider.toUpperCase()));
      for (const m of showByok) {
        list.append(makeRow(m, curCfg.provider !== "nakata" && m.id === curId, () => {
          saveCfg({ ...byokCfg, model: m.id });
          paintModelChip(); closeSheet(); haptic();
        }));
      }
    }
    if (showFree.length) {
      list.append(el("div", "sheet-sec", tx("Ücretsiz Modeller · Nakata")));
      for (const m of showFree) {
        list.append(makeRow(m, curCfg.provider === "nakata" && m.id === curId, () => { void pickNakataModel(m); }));
      }
    }
    if (showAdult.length) {
      list.append(el("div", "sheet-sec", tx("Abliterated · 18+")));
      for (const m of showAdult) {
        list.append(makeRow(m, curCfg.provider === "nakata" && m.id === curId, () => { void pickNakataModel(m); }));
      }
    }
  };
  paint();
  $("#modelSearch").oninput = (e) => paint(e.target.value);
}
$("#modelChip").addEventListener("click", openModelSheet);

/* ---- personalization (like ChatGPT's "customize"): added to every chat ---- */
function profileText(){
  const p = LS.get("nakata_profile", {}), parts = [];
  if (p.name) parts.push(tx(`Kullanıcıya "${p.name}" diye hitap et.`));
  if (p.about) parts.push(tx(`Kullanıcı hakkında: ${p.about}`));
  if (p.style) parts.push(tx(`Cevap biçimi: ${p.style}`));
  return parts.join("\n");
}
