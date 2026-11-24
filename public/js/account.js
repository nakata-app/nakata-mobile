/* ---- nakata.app account (routes/mobile.js on the server) ---- */
const API = LS.get("nakata_api_base", "https://nakata.app/api/mobile");
let account = LS.get("nakata_account", null);   // { name, credits }
let imageCosts = {};
const token = () => LS.get("nakata_token", "");
let chatCloudBusy = false, chatCloudTimer = null;
async function chatCloudResponse(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const t = token(); if (t) headers.Authorization = "Bearer " + t;
  if (options.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch("https://nakata.app/api/chat" + path, { ...options, headers });
  if (!response.ok) {
    const data = await response.clone().json().catch(() => ({}));
    const err = new Error(data?.error?.message || data?.error || ("HTTP " + response.status));
    err.status = response.status;
    throw err;
  }
  return response;
}
async function chatCloudRequest(path, options = {}) {
  return (await chatCloudResponse(path, options)).json();
}
async function mobileArtifactHash(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function uploadMobileArtifacts(session) {
  if (!token() || !session?.id) return session?.artifacts || [];
  const messages = Array.isArray(session.msgs) ? session.msgs : [];
  const route = "/conversations/" + encodeURIComponent(session.id) + "/artifacts";
  const listed = await chatCloudRequest(route);
  const known = new Map((listed.artifacts || []).map(item => [item.id, item]));
  for (let mi = 0; mi < messages.length; mi++) {
    const message = messages[mi];
    if (message.role !== "assistant" || typeof message.content !== "string") continue;
    let bi = 0;
    for (const match of message.content.matchAll(/```html\s*\n?([\s\S]*?)```/gi)) {
      const source = match[1].replace(/\n$/, "");
      const bytes = new TextEncoder().encode(source);
      if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) { bi++; continue; }
      const seed = String(session.id) + ":" + String(message.id || mi) + ":" + bi++;
      const id = "html_" + (await mobileArtifactHash(new TextEncoder().encode(seed))).slice(0, 32);
      const sha256 = await mobileArtifactHash(bytes);
      if (known.get(id)?.sha256 === sha256) continue;
      const result = await chatCloudRequest(route + "/" + id, {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8", "X-Artifact-Name": "nakata-artifact-" + (mi + 1) + "-" + bi + ".html", "X-Artifact-Hash": sha256 },
        body: bytes,
      });
      if (result.artifact) known.set(id, { ...result.artifact, sha256 });
    }
  }
  return [...known.values()];
}

const mobileArtifactUrls = new WeakMap();
function isMobileImageArtifact(artifact) {
  const mime = String(artifact?.contentType || artifact?.mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(String(artifact?.name || ""));
}
async function renderCloudArtifacts(conversationId) {
  if (!token() || !conversationId || conversationId !== curId) return;
  const result = await chatCloudRequest("/conversations/" + encodeURIComponent(conversationId) + "/artifacts");
  if (conversationId !== curId) return;
  const old = $("#thread .cloud-artifacts");
  if (old) {
    for (const url of mobileArtifactUrls.get(old) || []) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    mobileArtifactUrls.delete(old);
    old.remove();
  }
  if (!(result.artifacts || []).length) return;
  const panel = el("section", "cloud-artifacts");
  const panelUrls = [];
  mobileArtifactUrls.set(panel, panelUrls);
  const heading = el("div", "cloud-artifacts-title"); heading.textContent = tx("PAYLAŞILAN DOSYALAR"); panel.append(heading);
  for (const artifact of result.artifacts) {
    const route = "/conversations/" + encodeURIComponent(conversationId) + "/artifacts/" + encodeURIComponent(artifact.id);
    const button = el("button", "cloud-artifact-download");
    button.type = "button";
    button.textContent = artifact.name + " · " + Math.max(1, Math.round((artifact.size || 0) / 1024)) + " KB";
    let cachedImageUrl = null;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (cachedImageUrl) { openChatImagePreview(cachedImageUrl, artifact.name || ""); return; }
        const response = await chatCloudResponse(route);
        const blob = await response.blob();
        if (isMobileImageArtifact(artifact) || String(blob.type || "").startsWith("image/")) {
          const url = URL.createObjectURL(blob);
          cachedImageUrl = url;
          panelUrls.push(url);
          openChatImagePreview(url, artifact.name || "");
          return;
        }
        triggerBlobDownload(blob, blob.type || "application/octet-stream", artifact.name || "artifact", 15000);
      } catch (error) { button.textContent = error.message || tx("İndirme başarısız"); }
      finally { button.disabled = false; }
    });
    if (!isMobileImageArtifact(artifact)) {
      panel.append(button);
      continue;
    }
    const card = el("div", "cloud-artifact-card");
    card.append(button);
    panel.append(card);
    void (async () => {
      try {
        const response = await chatCloudResponse(route);
        const blob = await response.blob();
        if (conversationId !== curId || !panel.isConnected) return;
        const url = URL.createObjectURL(blob);
        cachedImageUrl = url;
        panelUrls.push(url);
        const img = el("img", "md-chat-image cloud-artifact-image");
        img.src = url;
        img.alt = artifact.name || "";
        img.loading = "lazy";
        card.prepend(img);
      } catch {}
    })();
  }
  $("#thread").append(panel);
}
function scheduleChatCloudSync(){
  if (!token()) return;
  clearTimeout(chatCloudTimer);
  chatCloudTimer = setTimeout(() => syncChatCloud({ uploadOnly: true }).catch(() => {}), 900);
}
async function syncChatCloud({ uploadOnly = false } = {}) {
  if (!token() || chatCloudBusy) return;
  chatCloudBusy = true;
  try {
    const remote = [], deletedIds = new Set();
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await chatCloudRequest("/conversations?limit=100&offset=" + offset);
      remote.push(...(page.conversations || []));
      for (const id of page.deletedIds || []) deletedIds.add(id);
      if (remote.length >= (page.total || 0) || !(page.conversations || []).length) break;
    }
    const local = allSessions();
    for (const id of deletedIds) delete local[id];
    if (deletedIds.size) {
      saveSessions(local);
      if (curId && deletedIds.has(curId)) newChat();
    }
    const byId = new Map(remote.map(c => [c.id, c]));
    for (const session of Object.values(local)) {
      const meta = byId.get(session.id);
      if (!meta || (session.ts || 0) > (meta.updatedAt || 0)) {
        const artifacts = await uploadMobileArtifacts(session).catch(() => session.artifacts || meta?.artifacts || []);
        const localBot = session.bot ? allBots()[session.bot] : null;
        const bot = session.gbot
          ? { kind: "community", id: session.gbot.id || "", name: session.gbot.name || "", bot: session.gbot }
          : localBot ? { kind: "local", id: String(localBot.id || session.bot), name: localBot.name || String(session.bot), bot: localBot }
          : session.bot ? { kind: "local", id: String(session.bot) } : { kind: "default" };
        let cloudMsgs = session.msgs || [];
        let body = JSON.stringify({ id: session.id, title: session.title || "", createdAt: session.ts, updatedAt: session.ts, messages: cloudMsgs, bot, artifacts });
        if (body.length > 1800000) {
          cloudMsgs = cloudMsgs.map((m) => m.images?.length ? { ...m, images: undefined } : m);
          body = JSON.stringify({ id: session.id, title: session.title || "", createdAt: session.ts, updatedAt: session.ts, messages: cloudMsgs, bot, artifacts });
        }
        await chatCloudRequest("/conversations/" + encodeURIComponent(session.id), {
          method: "PUT",
          body,
        });
      }
    }
    if (!uploadOnly) {
      for (const meta of remote) {
        const session = local[meta.id];
        if (session && (session.ts || 0) >= (meta.updatedAt || 0)) continue;
        const detail = await chatCloudRequest("/conversations/" + encodeURIComponent(meta.id));
        const c = detail.conversation;
        if (c.bot?.kind === "local" && c.bot.bot) {
          const bots = allBots();
          bots[c.bot.bot.name || c.bot.id] = c.bot.bot;
          saveBots(bots);
        }
        local[c.id] = {
          id: c.id, title: c.title || "(başlıksız)", ts: c.updatedAt || Date.now(),
          bot: c.bot?.kind === "local" ? (c.bot.bot?.name || c.bot.id) : null,
          gbot: c.bot?.kind === "community" ? (c.bot.bot || { id: c.bot.id, name: c.bot.name }) : null,
          msgs: Array.isArray(c.messages) ? c.messages : [], artifacts: c.artifacts || [],
        };
      }
      saveSessions(local);
      renderSessions($("#search")?.value || "");
      if (curId && local[curId]) openConvo(curId);
    }
  } finally { chatCloudBusy = false; }
}
function signOutLocal(){ if (voice) void endVoice(); clearAgentTasks(); LS.set("nakata_token", ""); LS.set("nakata_account", null); account = null; adultConsent = false; adultFeatureEnabled = false; modelCache = {}; paintAdultConsent(); paintAccount(); }
async function api(path, { method = "GET", body, form, keepalive = false, signal } = {}) {
  const headers = {}, t = token();
  if (t) headers.Authorization = "Bearer " + t;
  let payload = form;
  if (!form && body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(API + path, { method, headers, body: payload, keepalive: !!keepalive, signal }); }
  catch (err) {
    if (err?.name === "AbortError") return { ok: false, status: 0, aborted: true, j: {} };
    return { ok: false, status: 0, j: { error: "Bağlantı yok" } };
  }
  let j = {}; try { j = await res.json(); } catch {}
  if (res.status === 401 && t && path !== "/login") signOutLocal();
  return { ok: res.ok, status: res.status, j };
}
function paintAccount(){
  const on = !!(token() && account);
  const initial = on ? account.name.trim().charAt(0).toLocaleUpperCase("tr") : "N";
  const credits = on && typeof account.credits === "number" ? `${account.credits} kredi` : "";
  $("#acctAv").textContent = initial; $("#acc-av").textContent = initial;
  $("#acctName").textContent = on ? account.name : "Giriş yap";
  $("#acctSub").textContent = on ? credits : "nakata.app hesabı";
  $("#acc-out").hidden = on; $("#acc-in").hidden = !on;
  $("#acc-name").textContent = on ? account.name : ""; $("#acc-credits").textContent = credits;
  $("#img-signin").hidden = on; $("#img-form").hidden = !on;
  $("#img-credits").textContent = credits;
  paintCost();
  updateImageCreditsCta();
  void refreshAgentControl();
}
async function refreshAccount(){
  if (!token()) return paintAccount();
  const r = await api("/credits");
  if (r.ok) { account = { ...(account || { name: "" }), credits: r.j.credits }; imageCosts = r.j.image_credit_costs || {}; LS.set("nakata_account", account); }
  paintAccount();
}
function openAccount(){ closeDrawer(); $("#acc-del-box").hidden = true; showPage("#f-account"); refreshAccount(); void refreshAgentControl(); }
function openAgentPage(){ closeDrawer(); showPage("#f-agent"); if (token()) refreshAccount(); void refreshAgentControl(); }

let activeAgentPairId = null, agentPairingBusy = false, agentCommandBusy = false;
let agentTaskSelection = null, agentTaskPair = null, agentTaskAccount = null, agentTaskTimer = null;
let agentTaskGeneration = 0, agentTaskNoticeId = null, agentPendingIds = new Set();
let agentPairedBots = [], lastSelectedAgentPrompt = "";
const AGENT_PRESET_PREFIXES = ["@Araştır ", "@Denetle ", "@Raporla ", "@Kodu incele "];
function renderAgentBotStarters(bot){
  const box = $("#agentBotStarters"); if (!box) return;
  box.replaceChildren();
  const starters = Array.isArray(bot?.starters) ? bot.starters.slice(0, 4) : [];
  for (const s of starters) {
    const b = el("button", "chip", s);
    b.type = "button";
    b.addEventListener("click", () => {
      const promptBox = $("#agentCommandPrompt");
      promptBox.value = `@${bot.name} ${s}`;
      promptBox.focus(); haptic();
    });
    box.append(b);
  }
  box.hidden = starters.length === 0;
}
function syncAgentBotStartersFromPrompt(){
  const val = String($("#agentCommandPrompt")?.value || "");
  const m = val.match(/^@([\p{L}\p{N}_-]{1,40})(?:\s|$)/u);
  const matched = m ? agentPairedBots.find((b) => b.name.toLowerCase() === m[1].toLowerCase()) : null;
  renderAgentBotStarters(matched || null);
}
function renderAgentBotChips(bots){
  agentPairedBots = Array.isArray(bots) ? bots.filter((b) => b && typeof b.name === "string" && b.name.trim()) : [];
  const host = $("#agentBotChips"); if (!host) return;
  host.replaceChildren();
  for (const b of agentPairedBots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip agent-bot-chip";
    btn.dataset.agentPrefix = `@${b.name} `;
    btn.dataset.agentBot = b.name;
    if (b.description) btn.title = b.description;
    const dot = el("span", "agent-bot-dot");
    if (b.color) dot.style.setProperty("--dot", b.color);
    btn.append(dot, document.createTextNode(`@${b.name}`));
    host.append(btn);
  }
  const taken = new Set(agentPairedBots.map((b) => `@${b.name.toLowerCase()} `));
  for (const prefix of AGENT_PRESET_PREFIXES) {
    if (taken.has(prefix.toLowerCase())) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.agentPrefix = prefix;
    btn.textContent = prefix.trim();
    host.append(btn);
  }
  syncAgentBotStartersFromPrompt();
}
const agentAcct = () => (token() && account?.name) ? String(account.name).trim().toLowerCase() : (token() ? "_signed_in" : "");
const agentPairKey = () => "nk_agent_pair:" + agentAcct();
const agentPageOpen = () => $("#f-agent").classList.contains("on");
function agentTaskLabel(status){
  return ({
    queued: tx("Sırada · Mac bekleniyor"),
    running: tx("Mac’te · onay bekliyor olabilir"),
    completed: tx("Görev tamamlandı"),
    error: tx("Görev başarısız"),
    denied: tx("Mac’te reddedildi"),
  })[status] || tx("Durum bilinmiyor");
}
function clearAgentTasks(){
  agentTaskGeneration++; clearTimeout(agentTaskTimer); agentTaskTimer = null;
  agentTaskAccount = null; agentTaskPair = null; agentTaskSelection = null; agentTaskNoticeId = null;
  agentPendingIds.clear(); lastSelectedAgentPrompt = "";
  $("#agentTaskNotice").hidden = true;
  $("#agentTasks").replaceChildren();
  $("#agentTaskHistoryState").textContent = "";
  $("#agentCommandStatus").textContent = "";
  $("#agentCommandResult").textContent = "";
  $("#agentCommandResult").hidden = true;
  if ($("#agentCommandResultHead")) $("#agentCommandResultHead").hidden = true;
  if ($("#agentRetryResult")) $("#agentRetryResult").hidden = true;
}
async function refreshAgentTasks(){
  clearTimeout(agentTaskTimer);
  const acct = agentAcct();
  if (!acct || !agentTaskPair || document.hidden || (!agentPageOpen() && !agentPendingIds.size)) return;
  const pair = agentTaskPair, generation = ++agentTaskGeneration;
  const current = () => generation === agentTaskGeneration && acct === agentAcct() && pair === agentTaskPair;
  const suffix = "?pairId=" + encodeURIComponent(pair);
  try {
    const { commands = [] } = await chatCloudRequest("/agent/task-history" + suffix);
    if (!current()) return;
    for (const command of commands) {
      if (!agentPendingIds.has(command.id) || !["completed", "error", "denied"].includes(command.status)) continue;
      if (agentPageOpen()) continue;
      agentTaskNoticeId = command.id;
      $("#agentTaskNotice").textContent = agentTaskLabel(command.status);
      $("#agentTaskNotice").hidden = false;
      break;
    }
    agentPendingIds = new Set(commands.filter((c) => ["queued", "running"].includes(c.status)).map((c) => c.id));
    if (!agentPageOpen()) return;
    const list = $("#agentTasks");
    const focus = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    list.replaceChildren(...commands.map((command) => {
      const item = document.createElement("li");
      const button = document.createElement("button"); button.type = "button"; button.dataset.id = command.id;
      if (command.id === agentTaskSelection) button.setAttribute("aria-current", "true");
      const title = document.createElement("span"); title.textContent = command.title || "";
      const detail = document.createElement("small"); detail.textContent = agentTaskLabel(command.status) + " · " + new Date(command.createdAt).toLocaleString();
      button.append(title, detail);
      button.addEventListener("click", () => { agentTaskSelection = command.id; $("#agentCommandResult").hidden = true; if ($("#agentCommandResultHead")) $("#agentCommandResultHead").hidden = true; void refreshAgentTasks(); });
      item.append(button);
      return item;
    }));
    if (focus) [...list.querySelectorAll("button")].find((b) => b.dataset.id === focus)?.focus({ preventScroll: true });
    $("#agentTaskHistoryState").textContent = commands.length ? "" : tx("Henüz görev yok.");
    if (agentTaskSelection) {
      const { command } = await chatCloudRequest("/agent/commands/" + encodeURIComponent(agentTaskSelection) + suffix);
      if (!current()) return;
      $("#agentCommandStatus").textContent = agentTaskLabel(command?.status);
      lastSelectedAgentPrompt = typeof command?.prompt === "string" ? command.prompt : "";
      const out = command?.result || command?.error || "";
      $("#agentCommandResult").textContent = out;
      $("#agentCommandResult").hidden = !out;
      if ($("#agentCommandResultHead")) $("#agentCommandResultHead").hidden = !out;
      if ($("#agentRetryResult")) $("#agentRetryResult").hidden = !lastSelectedAgentPrompt;
    }
  } catch {
    if (current()) $("#agentTaskHistoryState").textContent = tx("Görevler güncellenemedi. Yeniden deneniyor…");
  } finally {
    if (current() && !document.hidden && (agentPageOpen() || agentPendingIds.size)) {
      agentTaskTimer = setTimeout(refreshAgentTasks, agentPendingIds.size ? 2500 : 12000);
    }
  }
}
$("#agentTaskNotice").addEventListener("click", () => {
  if (!agentTaskNoticeId) return;
  agentTaskSelection = agentTaskNoticeId; agentTaskNoticeId = null;
  $("#agentTaskNotice").hidden = true;
  $("#agentTaskHistory").open = true;
  openAgentPage();
});
function setAgentPairUi(connected, status, state = ""){
  $("#agentPairStatus").textContent = status;
  const pill = $("#agentPairPill");
  if (pill) {
    pill.textContent = connected ? (state === "offline" ? tx("Çevrimdışı") : tx("Bağlı")) : state === "pending" ? tx("Onay bekleniyor") : tx("Bağlı değil");
    pill.className = "agent-pill" + (connected && state !== "offline" ? " on" : state === "pending" ? " pending" : "");
  }
  $("#agentPairEntry").hidden = connected;
  $("#agentPairButton").hidden = connected;
  $("#agentCommandArea").hidden = !connected;
  if (!connected || agentTaskAccount !== agentAcct() || agentTaskPair !== activeAgentPairId) clearAgentTasks();
  if (connected) { agentTaskAccount = agentAcct(); agentTaskPair = activeAgentPairId; void refreshAgentTasks(); }
}
async function refreshAgentControl(){
  const panel = $("#agentControl"), signedOut = $("#agentSignedOut"); if (!panel) return;
  const acct = agentAcct();
  panel.hidden = !acct;
  if (signedOut) signedOut.hidden = !!acct;
  if (!acct) { activeAgentPairId = null; clearAgentTasks(); return; }
  const pairId = LS.get(agentPairKey(), null);
  activeAgentPairId = pairId;
  if (agentTaskAccount !== acct || agentTaskPair !== pairId) clearAgentTasks();
  if (!pairId) { setAgentPairUi(false, tx("Nakata Desktop’ta görünen kodu gir.")); return; }
  try {
    const result = await chatCloudRequest("/agent/pairs/" + encodeURIComponent(pairId));
    if (acct !== agentAcct() || pairId !== activeAgentPairId) return;
    if (!result.pair || ["revoked", "denied", "expired"].includes(result.pair.status)) throw Object.assign(new Error("pair_not_active"), { status: 403 });
    if (result.pair.status === "pending") { renderAgentBotChips([]); setAgentPairUi(false, tx("Mac üzerindeki yerel onay bekleniyor…"), "pending"); return; }
    renderAgentBotChips(result.pair.bots || []);
    setAgentPairUi(true, result.pair.online ? tx("Mac çevrimiçi ve eşleştirilmiş.") : tx("Eşleştirme kayıtlı; Mac şu anda çevrimdışı."), result.pair.online ? "online" : "offline");
  } catch (err) {
    if (acct !== agentAcct() || pairId !== activeAgentPairId) return;
    const msg = String(err?.message || "");
    if (err?.status === 404 || err?.status === 403 || msg.includes("pair_not_active")) {
      activeAgentPairId = null; LS.set(agentPairKey(), null);
      renderAgentBotChips([]);
      setAgentPairUi(false, tx("Eşleştirme sona erdi veya bağlantı kesildi."));
    } else {
      setAgentPairUi(false, tx("Mac bağlantısı kontrol edilemedi. Tekrar deneyin."));
    }
  }
}
$("#agentPairCode").addEventListener("input", (e) => {
  const v = String(e.target.value || "").toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 16);
  e.target.value = v.match(/.{1,4}/g)?.join("-") || "";
});
$("#agentPairButton").addEventListener("click", async () => {
  if (!agentAcct() || agentPairingBusy) return;
  const code = String($("#agentPairCode").value || "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(code)) { setAgentPairUi(false, tx("Nakata Desktop’tan aldığın 16 karakterli kodu gir.")); $("#agentPairCode").focus(); return; }
  agentPairingBusy = true; $("#agentPairButton").disabled = true;
  setAgentPairUi(false, tx("Kod doğrulanıyor; Mac onayı bekleniyor…"));
  try {
    const claimed = await chatCloudRequest("/agent/pair-codes/claim", { method: "POST", body: JSON.stringify({ code, clientName: "Nakata iOS" }) });
    const pairId = claimed.pair?.id;
    if (!pairId) throw new Error(tx("Eşleştirme kodu kullanılamadı."));
    activeAgentPairId = pairId; LS.set(agentPairKey(), pairId); $("#agentPairCode").value = "";
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await wait(1800);
      if (!agentAcct() || activeAgentPairId !== pairId) return;
      const status = await chatCloudRequest("/agent/pairs/" + encodeURIComponent(pairId));
      const pair = status.pair;
      if (pair?.status === "active") { renderAgentBotChips(pair.bots || []); setAgentPairUi(true, tx("Nakata Desktop bağlantısı kuruldu.")); haptic(); return; }
      if (["denied", "expired", "revoked"].includes(pair?.status)) throw new Error(tx("Eşleştirme Mac üzerinde reddedildi veya zaman aşımına uğradı."));
    }
    throw new Error(tx("Eşleştirme isteği zaman aşımına uğradı. Mac’te yeni kod üret."));
  } catch (err) {
    activeAgentPairId = null; LS.set(agentPairKey(), null);
    setAgentPairUi(false, String(err?.message || err));
  } finally { agentPairingBusy = false; $("#agentPairButton").disabled = false; }
});
$("#agentUnpair").addEventListener("click", async () => {
  if (!activeAgentPairId) return;
  $("#agentUnpair").disabled = true;
  try {
    await chatCloudRequest("/agent/unpair", { method: "POST", body: JSON.stringify({ pairId: activeAgentPairId }) });
    activeAgentPairId = null; LS.set(agentPairKey(), null);
    renderAgentBotChips([]);
    setAgentPairUi(false, tx("Mac bağlantısı kesildi.")); haptic();
  } catch (err) { $("#agentCommandStatus").textContent = String(err?.message || err); }
  finally { $("#agentUnpair").disabled = false; }
});
$("#agentCommandSend").addEventListener("click", async () => {
  const prompt = $("#agentCommandPrompt").value.trim();
  if (!activeAgentPairId || !prompt || agentCommandBusy || prompt.length > 12000) return;
  agentCommandBusy = true; $("#agentCommandSend").disabled = true; $("#agentCommandResult").hidden = true; if ($("#agentCommandResultHead")) $("#agentCommandResultHead").hidden = true;
  $("#agentCommandStatus").textContent = tx("Görev Mac’inize gönderiliyor…");
  const commandId = crypto.randomUUID().replace(/-/g, "");
  const pair = activeAgentPairId, acct = agentAcct();
  try {
    const res = await chatCloudRequest("/agent/commands", { method: "POST", body: JSON.stringify({ pairId: pair, commandId, prompt }) });
    if (acct !== agentAcct() || pair !== activeAgentPairId) return;
    $("#agentCommandPrompt").value = "";
    agentTaskSelection = res.command?.id || commandId;
    agentPendingIds.add(agentTaskSelection);
    $("#agentTaskHistory").open = true;
    $("#agentCommandStatus").textContent = agentTaskLabel("queued");
    haptic();
    void refreshAgentTasks();
  } catch (err) { $("#agentCommandStatus").textContent = String(err?.message || err); }
  finally { agentCommandBusy = false; $("#agentCommandSend").disabled = false; }
});
$("#agentRow")?.addEventListener("click", openAgentPage);
$("#acc-agent-btn")?.addEventListener("click", openAgentPage);
$("#agentSignInBtn")?.addEventListener("click", openAccount);
$("#agentRefreshBtn")?.addEventListener("click", () => { void refreshAgentControl(); void refreshAgentTasks(); });
$("#agentBotChips")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-agent-prefix]");
  if (!btn) return;
  const box = $("#agentCommandPrompt"), prefix = btn.dataset.agentPrefix || "";
  const cur = String(box.value || "").replace(/^@(?:Kodu\s+incele|\S+)\s*/i, "");
  box.value = prefix + cur;
  const matched = btn.dataset.agentBot ? agentPairedBots.find((b) => b.name === btn.dataset.agentBot) : null;
  renderAgentBotStarters(matched || null);
  box.focus();
  haptic();
});
$("#agentCommandPrompt")?.addEventListener("input", syncAgentBotStartersFromPrompt);
$("#agentRetryResult")?.addEventListener("click", () => {
  if (!lastSelectedAgentPrompt) return;
  const box = $("#agentCommandPrompt");
  box.value = lastSelectedAgentPrompt;
  box.focus();
  haptic();
});
$("#agentCopyResult")?.addEventListener("click", () => {
  const out = $("#agentCommandResult").textContent || "";
  if (out) void copyWithFeedback(out, $("#agentCopyResult"), tx("Kopyala"));
});
$("#accountRow").addEventListener("click", openAccount);
$("#img-login").addEventListener("click", openAccount);
$("#img-plans-out")?.addEventListener("click", openPlansPage);
$("#img-buy-btn")?.addEventListener("click", openPlansPage);
$("#acc-plans-btn")?.addEventListener("click", openPlansPage);
$("#acc-login").addEventListener("click", async () => {
  const email = $("#acc-email").value.trim(), password = $("#acc-pass").value;
  if (!email) return $("#acc-email").focus();
  if (!password) return $("#acc-pass").focus();
  showErr("#acc-err", ""); $("#acc-login").disabled = true;
  const r = await api("/login", { method: "POST", body: { email, password } });
  $("#acc-login").disabled = false;
  if (!r.ok || !r.j.token) { hapticError(); return showErr("#acc-err", r.j.error || "Giriş yapılamadı"); }
  LS.set("nakata_token", r.j.token);
  account = { name: r.j.username || r.j.user || email, credits: typeof r.j.credits === "number" ? r.j.credits : undefined };
  LS.set("nakata_account", account); $("#acc-pass").value = ""; haptic();
  await refreshAccount();
  await syncChatCloud().catch(() => {});
  if ($("#f-image").classList.contains("on")) { $("#f-account").classList.remove("on"); loadGallery(); }
  else if ($("#f-agent").classList.contains("on")) { $("#f-account").classList.remove("on"); void refreshAgentControl(); }
});
$("#acc-logout").addEventListener("click", async () => { await api("/logout", { method: "POST", body: {} }); signOutLocal(); haptic(); });
$("#acc-delete").addEventListener("click", () => { $("#acc-del-box").hidden = false; showErr("#acc-del-err", ""); $("#acc-del-pass").focus(); });
$("#acc-del-go").addEventListener("click", async () => {
  const password = $("#acc-del-pass").value;
  if (!password) return $("#acc-del-pass").focus();
  const r = await api("/account/delete", { method: "POST", body: { password } });
  if (!r.ok) { hapticError(); return showErr("#acc-del-err", r.status === 403 ? "Şifre yanlış" : (r.j.error?.message || r.j.error || "Silinemedi")); }
  $("#acc-del-pass").value = ""; signOutLocal(); $("#f-account").classList.remove("on");
  addNote("Hesabın kapatıldı; verilerin en geç 8 gün içinde silinecek. Fikrini değiştirirsen 7 gün içinde support@nakata.app'e yaz.");
});

/* ---- image studio: the site's models and their reference limits, always 4K ---- */
const ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const IMG_MODELS = [
  { id: "nano", label: "Nano Banana 2.1", refs: 10, key: () => "nano-banana-2-1" },
  { id: "pro", label: "Nano Banana Pro", refs: 8, key: () => "nano-banana-pro" },
  { id: "gpt", label: "GPT", refs: 16, key: () => (refFiles.length ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image") },
];
let aspect = "3:4", refFiles = [], genBusy = false, imgModel = IMG_MODELS[0];
for (const m of IMG_MODELS) {
  const c = el("button", "chip" + (m === imgModel ? " on" : ""), m.label);
  c.addEventListener("click", () => {
    imgModel = m; refFiles = refFiles.slice(0, m.refs);
    for (const x of document.querySelectorAll("#img-model .chip")) x.classList.toggle("on", x === c);
    paintRefs(); haptic();
  });
  $("#img-model").append(c);
}
for (const a of ASPECTS) {
  const c = el("button", "chip" + (a === aspect ? " on" : ""), a);
  c.addEventListener("click", () => { aspect = a; for (const x of document.querySelectorAll("#img-aspect .chip")) x.classList.toggle("on", x === c); haptic(); });
  $("#img-aspect").append(c);
}
function modelCost(){ return imageCosts[imgModel.key()]?.["4K"]; }
function updateImageCreditsCta(forceShow = false, neededCost = null){
  const box = $("#img-credits-cta"), txt = $("#img-credits-cta-text");
  if (!box || !txt) return;
  if (!token() || !account) { box.hidden = true; return; }
  const cost = neededCost || modelCost() || 20;
  const hasNum = typeof account.credits === "number";
  if (!forceShow && (!hasNum || account.credits >= cost)) { box.hidden = true; return; }
  txt.textContent = hasNum
    ? tx(`Mevcut bakiyen: ${account.credits} kredi. Görsel üretimi için en az ${cost} kredi gerekir.`)
    : tx("Görsel üretimi için kredi paketi veya üyelik gerekiyor.");
  box.hidden = false;
}
function paintCost(){ const c = modelCost(); $("#img-go").textContent = genBusy ? "Üretiliyor…" : (c ? `Üret · ${c} kredi` : "Üret"); updateImageCreditsCta(); }
function paintRefs(){
  const box = $("#img-refs"); box.replaceChildren();
  refFiles.forEach((f, i) => {
    const r = el("div", "ref"), im = el("img"); im.src = URL.createObjectURL(f); im.alt = "";
    const x = el("button", "", "×"); x.setAttribute("aria-label", "Kaldır");
    x.addEventListener("click", () => { refFiles.splice(i, 1); paintRefs(); });
    r.append(im, x); box.append(r);
  });
  if (refFiles.length < imgModel.refs) { const add = el("button", "ref add"); add.setAttribute("aria-label", "Referans ekle"); add.innerHTML = ICON_PLUS; add.addEventListener("click", () => $("#img-file").click()); box.append(add); }
  paintCost();
}
$("#img-file").addEventListener("change", (e) => { refFiles = [...refFiles, ...e.target.files].slice(0, imgModel.refs); e.target.value = ""; paintRefs(); });
function addGen(url, front = true){
  const tile = el("div", "gen"), im = el("img"); im.src = url; im.alt = ""; im.loading = "lazy"; im.className = "md-chat-image"; tile.append(im);
  if (front) $("#img-results").prepend(tile); else $("#img-results").append(tile);
}
async function loadGallery(){
  const r = await api("/gallery?limit=30");
  const items = (r.j.items || r.j.data?.items || r.j.gallery || []).filter((it) => it && typeof it.url === "string" && !/\.mp4(\?|$)/i.test(it.url));
  $("#img-results").replaceChildren(); for (const it of items) addGen(it.url, false);
}
function openImages(){ closeDrawer(); showPage("#f-image"); $("#img-status").textContent = ""; paintRefs(); refreshAccount().then(() => token() && loadGallery()); }
$("#imagesRow").addEventListener("click", openImages);
$("#img-go").addEventListener("click", async () => {
  if (genBusy) return;
  if (!token()) { openAccount(); return; }
  const prompt = $("#img-prompt").value.trim();
  if (!prompt) return $("#img-prompt").focus();
  const say = (t) => { $("#img-status").textContent = t; };
  genBusy = true; paintCost(); haptic();
  try {
    const urls = [];
    for (const f of refFiles) {
      say("Referanslar yükleniyor…");
      const fd = new FormData(); fd.append("file", f, f.name || "ref.jpg");
      const up = await api("/upload", { method: "POST", form: fd });
      const u = up.j.data?.url || up.j.url;
      if (!up.ok || !u) throw new Error(up.j.error || "Referans yüklenemedi");
      urls.push(u);
    }
    say("Üretiliyor…");
    const g = await api("/generate", { method: "POST", body: { operation_id: "ios_" + crypto.randomUUID().replace(/-/g, ""), prompt, imageUrls: urls, aspect, model: imgModel.id } });
    if (g.status === 402 || /insufficient|yetersiz|kredi/i.test(String(g.j.error || ""))) {
      updateImageCreditsCta(true, Number(g.j?.cost) || modelCost() || 20);
      throw new Error("Kredin yetmiyor. Üyelik veya kredi paketi al.");
    }
    if (!g.ok) throw new Error(g.j.error || "Üretim başlamadı");
    let url = g.j.imageUrl || g.j.data?.imageUrl;
    const taskId = g.j.data?.taskId || g.j.taskId;
    let pollErrs = 0;
    for (let i = 0; !url && taskId && i < 90; i++) {
      await wait(i < 5 ? 2000 : 3000);
      const t = await api("/task", { method: "POST", body: { taskId } });
      if (!t.ok) {
        if (++pollErrs >= 5) throw new Error(t.j?.error || "Üretim durumu alınamadı.");
        continue;
      }
      pollErrs = 0;
      if (t.j.status === "failed" || t.j.state === "fail") throw new Error(t.j.failMsg || "Üretim başarısız");
      url = t.j.imageUrl || t.j.resultImageUrl || t.j.data?.imageUrl;
    }
    if (!url) throw new Error("Sonuç gelmedi, biraz sonra galeriye bak.");
    addGen(url); say(""); haptic("MEDIUM");
    api("/gallery", { method: "POST", body: { item: { url, prompt, ts: Date.now() } } });
    $("#img-prompt").value = ""; refFiles = []; paintRefs();
  } catch (e) {
    hapticError(); say(e.message);
  } finally {
    genBusy = false; paintCost(); refreshAccount();
  }
});
