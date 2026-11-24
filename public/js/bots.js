/* ---- bots (local personas) ---- */
// Ready-made bots (Atakan: sample bots in onboarding and the picker).
const BOT_TEMPLATES = [
  { name: "Video Editor", desc: "Cuts, pacing, captions, shot lists", starters: ["Make a 30s Reels cut plan", "Write punchy captions for this clip", "Fix pacing in my script"], persona: "You are a senior video editor. Help the user turn raw footage or an idea into a tight video: propose the structure, a shot list, cut points and pacing, caption and sound choices, and the exact edit steps in their tool (CapCut, Premiere, DaVinci, Final Cut). Ask what the platform and length are if unknown. Be concrete: timestamps, durations, transitions. Answer in the user's language." },
  { name: "Coding Agent", desc: "Writes, reviews and debugs code", starters: ["Debug this error step by step", "Review this function for bugs", "Refactor cleanly with tests"], persona: "You are an experienced software engineer. Give short, correct answers. Always put code in working code blocks. When debugging, name the likely cause first, then show the fix. Point out security and edge-case risks you notice. Answer in the user's language." },
  { name: "Startup Co-founder", desc: "Pressure-tests ideas, plans and pitches", starters: ["Stress-test my startup idea", "Draft a 1-week validation plan", "Sharpen my 3-sentence pitch"], persona: "You are a pragmatic startup co-founder. Challenge the user's idea like an investor would: who pays, why now, how it grows, what could kill it. Then help turn it into a one-page plan with a first week of concrete actions. Be direct, no hype. Answer in the user's language." },
  { name: "Image Prompt Artist", desc: "Turns ideas into image prompts", starters: ["3 lighting variants for my concept", "Minimalist product studio shot prompt", "Cinematic portrait prompt"], persona: "You write prompts for AI image models. From the user's idea, produce three prompt variants (clean, cinematic, stylized) that state subject, setting, lighting, lens or medium, mood and aspect ratio. Keep each prompt under 80 words. Ask one question if the idea is too vague. Answer in the user's language." },
  { name: "Product Designer", desc: "UX flows, screens and critique", starters: ["Critique this onboarding flow", "Fix hierarchy and empty states", "Simplify this form layout"], persona: "You are a senior product designer. Critique screens and flows for clarity, hierarchy and friction, and propose concrete fixes: layout, copy, states and empty states. Prefer simple, measurable improvements. Answer in the user's language." },
  { name: "Research Analyst", desc: "Structured research and summaries", starters: ["Compare options with pros and cons", "Summarize key evidence first", "List what is verified vs unsure"], persona: "You are a careful research analyst. Break a question into sub-questions, give a structured answer with the strongest evidence first, and state clearly what is uncertain or unverified. Never invent sources or numbers. Answer in the user's language." },
  { name: "Social Media Manager", desc: "Posts, hooks and content calendars", starters: ["Write 3 viral opening hooks", "Turn this update into an X + IG post", "Plan a 5-day content schedule"], persona: "You are a social media manager. Write platform-native posts (Instagram, TikTok, X, LinkedIn) with a strong first line, a clear call to action and a posting schedule. Offer 3 hook options per idea. Answer in the user's language." },
  { name: "Travel Assistant", desc: "Trip planning, budgets, itineraries and travel support", starters: ["Plan a 3-day budget city trip", "Compare neighborhoods to stay in", "Check entry rules & airport transit"], persona: "You are Nakata Travel, a premium travel researcher and itinerary designer. Always answer in the traveller's language. Be specific, practical, visually descriptive and candid. Never give a generic list when the user asks for a trip plan.\n\nDISCOVERY: Reuse everything already in the conversation. Never stall with a questionnaire before providing value. If dates, budget, or group size are missing for a flight, hotel, or booking request, briefly note in ONE sentence that you cannot complete checkout or reservations on their behalf, and IMMEDIATELY invoke live search/research tools with sensible transparent defaults (e.g., upcoming 3 nights, 2 adults, central stay) so the first reply delivers real current hotel/flight options and price ranges; ask briefly at the end for exact dates/origin to tailor. Establish departure city, destination, exact dates/year, group size, total budget/currency and travel style without repeating already stated details. Clarify a missing year when ambiguous.\n\nRESEARCH: Use the supplied research extracts and available web tools before recommending places. Verify that every named attraction, neighbourhood, restaurant, bar, club and transport operator exists in the stated city. Prefer official attraction, transport, airport and venue pages. Check dates. Do NOT append a source list, citations or bare URL dump at the end of your reply. If supplied research is background-only, do not describe it as live verification or use it to assert current opening hours, prices, schedules, events, availability, weather or entry rules. If no live sources are available, say so and label current details unverified. Never invent places, sources, prices or timetables.\n\nITINERARY: Give an overall recommendation and route overview, then one section for each calendar day. Use morning, lunch, afternoon, dinner and evening blocks. Group nearby stops together; provide visit duration and realistic transfer time. Explain why each stop is worth visiting. Include named food and nightlife choices, not just generic streets. Keep each day realistic with breaks, 3-5 main stops maximum, and a lighter arrival/departure day. Include indoor alternatives for winter or rain. Preserve original local place names when useful.\n\nVISUALS: Use supplied real image references to enrich the trip and retain their captions, credits and licence details. Never invent image links or claim a photo depicts a specific venue unless verified.\n\nBUDGET: Break down accommodation, intercity transport, local transit, meals, activities, connectivity, insurance and contingency. Separate checked prices from estimates, state currency, search date and assumptions. Do not present estimates as quotes. Compare transport and hotels by time, location, total cost, taxes and cancellation terms. For entry rules, verify official sources and clarify nationality and transit details when relevant. Consider solo safety, late arrivals, accessibility and dietary needs without exaggeration.\n\nOUTPUT: Quick trip read; neighbourhood route overview; detailed day-by-day schedule; food and nightlife shortlist; getting around; itemised estimated budget; reservations and practical tips. Use local time and exact dates. Mark each detail CONFIRMED, ESTIMATED or TO VERIFY. Maintain a compact trip summary across follow-ups and update only what changed." },
  { name: "Writing Editor", desc: "Sharpens text and keeps your voice", starters: ["Tighten this email cleanly", "Fix grammar while keeping my tone", "Shorten by 40% without losing meaning"], persona: "You are a meticulous editor. Fix spelling, grammar and clarity, tighten the text and keep the author's voice. Give the corrected text first, then the few most important changes as short bullets. Answer in the user's language." },
  { name: "Lex", desc: "Reads contracts & explains applicable law", starters: ["Review this contract for risky clauses", "Explain notice periods in plain words", "What clauses are missing here?"], persona: "You research legal questions and read legal documents. Reply in the user's language. You are not a lawyer: say so in one line when the user asks about their own situation, and suggest a lawyer when real money or rights are at stake. Cite exact laws, articles or official sources when known, and never invent article numbers. For a contract: list risky clauses, missing clauses and a plain-language summary." },
];
function useTemplate(t){
  const bots = allBots();
  bots[t.name] = { persona: t.persona, description: t.desc, starters: Array.isArray(t.starters) ? t.starters.slice(0, 4) : [] };
  saveBots(bots);
  galleryBot = null; activeBot = t.name; setModelLabel(); haptic();
}
function allBots(){ return LS.get("nakata_byok_bots", {}); }
function saveBots(b){ LS.set("nakata_byok_bots", b); }
function activeBotLessons(bot){
  if (!bot || bot.learn === false || !Array.isArray(bot.lessons)) return [];
  return bot.lessons.filter((l) => l && l.active !== false && typeof l.text === "string" && l.text.trim()).slice(-8);
}
function findLocalOrTemplateBotName(raw){
  if (!raw) return null;
  const low = String(raw).trim().toLowerCase();
  const saved = Object.keys(allBots()).find((n) => n.toLowerCase() === low);
  if (saved) return saved;
  const tpl = BOT_TEMPLATES.find((t) => t.name.toLowerCase() === low);
  return tpl ? tpl.name : null;
}
function ensureEditableBot(name){
  const bots = allBots();
  if (bots[name]) return { bots, key: name, bot: bots[name] };
  const tpl = BOT_TEMPLATES.find((t) => t.name === name);
  if (!tpl) return null;
  bots[tpl.name] = { persona: tpl.persona, description: tpl.desc, starters: Array.isArray(tpl.starters) ? tpl.starters.slice(0, 4) : [] };
  saveBots(bots);
  return { bots, key: tpl.name, bot: bots[tpl.name] };
}
function teachMobileBot(name, text){
  const clean = String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 280);
  if (clean.length < 3) return { ok: false, error: tx("Kural en az 3 karakter olmalı.") };
  const found = ensureEditableBot(name);
  if (!found) return { ok: false, error: tx("Bot bulunamadı.") };
  const { bots, key, bot } = found;
  const list = Array.isArray(bot.lessons) ? bot.lessons.filter((l) => l && typeof l.text === "string") : [];
  const dup = list.find((l) => l.active !== false && l.text.trim().toLowerCase() === clean.toLowerCase());
  if (!dup) list.push({ text: clean, source: "mobile", wins: 0, losses: 0, createdAt: new Date().toISOString().slice(0, 10), active: true });
  bots[key] = { ...bot, lessons: list.slice(-30) };
  saveBots(bots);
  paintHero();
  return { ok: true, added: !dup, key, text: clean };
}
function forgetMobileBotLesson(name, query){
  const needle = String(query ?? "").trim();
  const bots = allBots(), bot = bots[name];
  if (!bot || !needle) return { ok: false, error: tx("Eşleşen kural bulunamadı.") };
  const list = Array.isArray(bot.lessons) ? bot.lessons.filter((l) => l && typeof l.text === "string") : [];
  const activeIdx = [];
  for (let i = 0; i < list.length; i++) if (list[i].active !== false && list[i].text.trim()) activeIdx.push(i);
  let match = -1;
  if (/^\d+$/.test(needle)) {
    const n = parseInt(needle, 10);
    if (n >= 1 && n <= activeIdx.length) match = activeIdx[n - 1];
  } else {
    const low = needle.toLowerCase();
    match = activeIdx.find((i) => list[i].text.trim().toLowerCase() === low) ?? -1;
    if (match === -1) match = activeIdx.find((i) => list[i].text.trim().toLowerCase().includes(low)) ?? -1;
  }
  if (match === -1) return { ok: false, error: tx("Eşleşen kural bulunamadı.") };
  const forgotten = list[match].text.trim();
  list[match] = { ...list[match], active: false };
  bots[name] = { ...bot, lessons: list.slice(-30) };
  saveBots(bots);
  paintHero();
  return { ok: true, key: name, forgotten };
}
let activeBot = null;
let galleryBot = null;   // a published bot opened from Keşfet: { id, name, persona, mascot }
let payBots = false;     // agreed this session to pay credits for gallery-bot messages past the free quota
function paintHero(){
  const titleEl = $("#heroTitle"), descEl = $("#heroDesc"), stEl = $("#heroStarters");
  if (!titleEl || !descEl || !stEl) return;
  const gb = galleryBot;
  const bot = !gb && activeBot ? allBots()[activeBot] : null;
  const tpl = !gb && activeBot ? BOT_TEMPLATES.find((t) => t.name === activeBot) : null;
  if (!gb && !activeBot) {
    titleEl.textContent = tx("Nasıl yardımcı olabilirim?");
    descEl.textContent = ""; descEl.hidden = true;
    stEl.replaceChildren(); stEl.hidden = true;
    return;
  }
  const name = gb ? gb.name : activeBot;
  const lessonCount = !gb ? activeBotLessons(bot).length : 0;
  const rawDesc = gb ? (gb.tagline || gb.description || "") : (bot?.description || bot?.tagline || tpl?.desc || "");
  const desc = [rawDesc, lessonCount ? `${lessonCount} ${tx("kural")}` : ""].filter(Boolean).join(" · ");
  const starters = (gb ? gb.starters : (bot?.starters?.length ? bot.starters : tpl?.starters)) || [];
  titleEl.textContent = name;
  descEl.textContent = desc; descEl.hidden = !desc;
  stEl.replaceChildren();
  for (const s of starters.slice(0, 4)) {
    const b = el("button", "hero-starter", s);
    b.type = "button";
    b.addEventListener("click", () => { void submitMobilePrompt(s); });
    stEl.append(b);
  }
  stEl.hidden = stEl.children.length === 0;
}
function setModelLabel(){ $("#modelName").textContent = galleryBot ? galleryBot.name : (activeBot || "Nakata"); mascot?.setColor(orbColor()); paintModelChip(); paintHero(); }
function openBotSheet(){
  $("#drawer").classList.remove("on");
  $("#scrim").classList.add("on"); $("#botSheet").classList.add("on");
  const list = $("#botList");
  for (const o of list.querySelectorAll(".bot-orb")) o._orb?.destroy();
  list.replaceChildren();
  const mk = (name, desc, on, isBot, tint) => {
    const row = el("div", "botopt" + (on ? " on" : ""));
    const main = el("button", "botmain");
    const meta = el("div", "meta"); meta.append(el("div", "nm", name)); if (desc) meta.append(el("div", "ds", desc));
    const chk = el("span"); chk.innerHTML = ICON_CHECK; chk.firstChild.classList.add("chk");
    const face = orb({ size: 34, color: isBot || tint ? botColor(name) : NAKATA_ORB_COLOR, expression: on ? "happy" : "neutral" });
    face.el.classList.add("small-orb");
    main.append(face.el, meta, chk.firstChild);
    main.addEventListener("click", () => { galleryBot = null; activeBot = isBot ? name : null; setModelLabel(); closeSheet(); haptic(); });
    row.append(main);
    if (isBot) {
      const edit = el("button", "edit"); edit.setAttribute("aria-label", "Düzenle"); edit.innerHTML = ICON_EDIT;
      edit.addEventListener("click", (e) => { e.stopPropagation(); openBotForm(name); });
      row.append(edit);
    }
    return row;
  };
  list.append(mk("Nakata", "Varsayılan", !activeBot, false));
  for (const [name, bot] of Object.entries(allBots())) {
    const rules = activeBotLessons(bot).length;
    const sub = [bot.description || bot.model || "", rules ? `${rules} ${tx("kural")}` : ""].filter(Boolean).join(" · ");
    list.append(mk(name, sub, activeBot === name, true));
  }
  const missing = BOT_TEMPLATES.filter((t) => !allBots()[t.name]);
  if (missing.length) {
    list.append(el("div", "sheet-sec", "Örnek botlar"));
    for (const t of missing) {
      const row = mk(t.name, t.desc, false, false, true);
      row.querySelector(".botmain").onclick = () => { useTemplate(t); closeSheet(); };
      list.append(row);
    }
  }
  list.classList.toggle("scrolls", list.scrollHeight > list.clientHeight);
}
$("#modelBtn").addEventListener("click", openBotSheet);
$("#botsRow").addEventListener("click", openBotSheet);

let editingBot = null;
function setPubStatus(status){
  const dot = $("#bf-status");
  $("#bf-unpub").hidden = !status; $("#bf-mascot").hidden = !status; $("#bf-mascot-hint").hidden = !status;
  if (!status) { dot.hidden = true; $("#bf-pub").textContent = "Galeride yayınla"; return; }
  dot.hidden = false; dot.className = "statusdot " + status; dot.textContent = statusLabel(status);
  $("#bf-pub").textContent = status === "rejected" ? "Tekrar gönder" : "Güncelle ve yayınla";
}
function paintMobileBotLessons(name){
  const wrap = $("#bf-lessons-wrap"), box = $("#bf-lessons");
  if (!wrap || !box) return;
  box.replaceChildren();
  const bot = name ? allBots()[name] : null;
  const lessons = activeBotLessons(bot);
  if (!name || !lessons.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  lessons.forEach((l, idx) => {
    const row = el("div", "lesson-row");
    row.append(el("span", "", `${idx + 1}. ${l.text.trim()}`));
    const rm = el("button", "lesson-del", "×");
    rm.type = "button";
    rm.setAttribute("aria-label", `Kuralı sil: ${l.text.trim()}`);
    rm.addEventListener("click", () => {
      forgetMobileBotLesson(name, l.text);
      paintMobileBotLessons(name);
    });
    row.append(rm);
    box.append(row);
  });
}
function openBotForm(name){
  const bot = name ? allBots()[name] : null;
  editingBot = name || null;
  fillCatSelect();
  $("#botFormTitle").textContent = bot ? "Botu düzenle" : "Yeni bot";
  $("#bf-name").value = name || ""; $("#bf-name").readOnly = !!bot;
  $("#bf-tagline").value = bot?.tagline || bot?.description || "";
  $("#bf-category").value = bot?.category || "Diğer";
  $("#bf-model").value = bot?.model || ""; $("#bf-persona").value = bot?.persona || "";
  if ($("#bf-starters")) $("#bf-starters").value = (bot?.starters || []).join("\n");
  paintMobileBotLessons(name);
  $("#bf-del").hidden = !bot;
  showErr("#bf-puberr", ""); setPubStatus(bot?.publishedStatus || "");
  closeSheet(); showPage("#f-botform");
  if (!bot) $("#bf-name").focus();
}
$("#botNew").addEventListener("click", () => openBotForm(null));
$("#botSave").addEventListener("click", () => {
  const name = $("#bf-name").value.trim();
  const persona = $("#bf-persona").value;
  if (!name) return $("#bf-name").focus();
  if (!persona.trim()) return $("#bf-persona").focus();
  const bots = allBots();
  const key = editingBot || name;
  const starters = ($("#bf-starters")?.value || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  bots[key] = { ...(bots[key] || {}), persona, model: $("#bf-model").value.trim() || undefined,
    tagline: $("#bf-tagline").value.trim() || undefined, description: $("#bf-tagline").value.trim() || undefined,
    category: $("#bf-category").value, starters };
  saveBots(bots);
  if (activeBot === key) setModelLabel();
  $("#f-botform").classList.remove("on"); openBotSheet();
});
$("#bf-pub").addEventListener("click", async () => {
  const name = $("#bf-name").value.trim(), persona = $("#bf-persona").value.trim();
  const tagline = $("#bf-tagline").value.trim(), category = $("#bf-category").value, model = $("#bf-model").value.trim();
  showErr("#bf-puberr", "");
  if (name.length < 2) return $("#bf-name").focus();
  if (persona.length < 10) { showErr("#bf-puberr", "Talimat en az 10 karakter olmalı."); return $("#bf-persona").focus(); }
  if (!token()) { showErr("#bf-puberr", "Yayınlamak için önce giriş yap."); return openAccount(); }
  const key = editingBot || name;
  const bots = allBots(); const local = bots[key] || {};
  const pubId = local.publishedId;
  $("#bf-pub").disabled = true;
  const body = { name, tagline, persona, category, model };
  const r = pubId ? await api(`/bots/${pubId}`, { method: "POST", body }) : await api("/bots", { method: "POST", body });
  $("#bf-pub").disabled = false;
  if (!r.ok) { hapticError(); return showErr("#bf-puberr", r.j?.error?.message || "Yayınlanamadı"); }
  const id = r.j.id || pubId, status = r.j.status || "pending";
  bots[key] = { ...local, persona, model: model || undefined, tagline: tagline || undefined, description: tagline || undefined, category, publishedId: id, publishedStatus: status };
  saveBots(bots);
  setPubStatus(status); haptic("MEDIUM");
  addNote(status === "pending" ? "Botun incelemeye gönderildi. Onaylanınca galeride görünür." : "Botun galeride güncellendi.");
  $("#f-botform").classList.remove("on");
});
$("#bf-mascot").addEventListener("click", async () => {
  const key = editingBot || $("#bf-name").value.trim();
  const bots = allBots(); const local = bots[key];
  if (!local?.publishedId) return;
  if (!confirm("Maskot üretimi kredi harcayabilir (ilk üretim ücretsiz). Devam edilsin mi?")) return;
  const btn = $("#bf-mascot"); btn.disabled = true; showErr("#bf-puberr", "");
  try {
    for (let i = 0; i < 60; i++) {
      const r = await api(`/bots/${local.publishedId}/mascot`, { method: "POST", body: { mode: "ai" } });
      if (r.status === 402) return showErr("#bf-puberr", "Kredin yetmiyor.");
      if (!r.ok || r.j?.failed) { hapticError(); return showErr("#bf-puberr", r.j?.error?.message || "Maskot üretilemedi"); }
      if (r.j?.mascot) { haptic("MEDIUM"); addNote("Maskot hazır."); return; }
      btn.textContent = "Maskot hazırlanıyor…";
      await wait(i < 5 ? 2000 : 3000);
    }
    showErr("#bf-puberr", "Maskot henüz hazır değil, biraz sonra tekrar dene.");
  } finally { btn.disabled = false; btn.textContent = "AI maskot üret"; }
});
$("#bf-unpub").addEventListener("click", async () => {
  const key = editingBot || $("#bf-name").value.trim();
  const bots = allBots(); const local = bots[key];
  if (!local?.publishedId) return;
  if (!confirm("Bot galeriden kaldırılsın mı? Sayaçları sıfırlanır.")) return;
  const r = await api(`/bots/${local.publishedId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) { hapticError(); return showErr("#bf-puberr", r.j?.error?.message || "Kaldırılamadı"); }
  delete local.publishedId; delete local.publishedStatus;
  bots[key] = local; saveBots(bots);
  setPubStatus(""); haptic();
  addNote("Bot galeriden kaldırıldı; cihazındaki kopyası duruyor.");
});
$("#bd-block").addEventListener("click", async () => {
  if (!detailBot) return;
  if (!token()) return openAccount();
  if (!confirm("Bu yapımcının botları sana artık gösterilmesin mi?")) return;
  const r = await api("/bots/block", { method: "POST", body: { botId: detailBot.id } });
  if (!r.ok) { hapticError(); return addNote(r.j?.error?.message || "Engellenemedi", true); }
  closeGalleryPages(); haptic();
  addNote("Engellendi. Bu yapımcının botları artık galeride görünmeyecek.");
});
$("#bf-del").addEventListener("click", () => {
  if (!editingBot) return;
  const bots = allBots(); delete bots[editingBot]; saveBots(bots);
  if (activeBot === editingBot) { activeBot = null; setModelLabel(); }
  $("#f-botform").classList.remove("on"); openBotSheet();
});

/* ---- welcome: first launch only ---- */
function showWelcome(){
  const box = $("#welcomeTpls"); box.replaceChildren();
  for (const t of BOT_TEMPLATES.slice(0, 4)) {
    const b = el("button", "tpl"); const face = orb({ size: 30, color: botColor(t.name), expression: "happy" }); face.el.classList.add("small-orb");
    const meta = el("div"); meta.append(el("div", "nm", t.name), el("div", "ds", t.desc));
    b.append(face.el, meta);
    b.onclick = () => { useTemplate(t); finishWelcome(); };
    box.append(b);
  }
  if (!$("#welcomeOrb").firstChild) $("#welcomeOrb").append(orb({ size: 72, color: NAKATA_ORB_COLOR, expression: "happy" }).el);
  showPage("#f-welcome");
}
function finishWelcome(){ LS.set("nakata_welcomed", true); $("#f-welcome").classList.remove("on"); }
$("#welcomeGo").addEventListener("click", finishWelcome);

/* ---- bot gallery (Keşfet): publish, discover, chat, like, earnings, review ---- */
// A bot's mascot: the generated image when it has one, otherwise the tinted orb.
function mascotEl(m, size){
  if (m && m.kind === "image" && typeof m.url === "string" && m.url.startsWith("https://")) {
    const el = document.createElement("img"); el.src = m.url; el.alt = ""; el.width = size; el.height = size; el.className = "mascot-img"; el.loading = "lazy";
    return { el };
  }
  return orb({ size, color: m?.color || NAKATA_ORB_COLOR, expression: m?.face || "happy" });
}
const RARITY_TR = { rare: "Nadir", epic: "Epik", legendary: "Efsane" };
const DEFAULT_CATS = ["Yazı", "Kod", "Eğitim", "Çeviri", "Günlük", "Eğlence", "İş", "Sağlık", "Oyun", "Diğer"];
let botCats = DEFAULT_CATS.slice();
let detailBot = null;
let discSort = "top", discCat = "", discQ = "", discTimer = 0;

async function loadCats(){
  try { const r = await api("/bots/categories"); if (Array.isArray(r.j?.categories) && r.j.categories.length) botCats = r.j.categories; } catch {}
}
function fillCatSelect(){
  const sel = $("#bf-category"); if (!sel || sel.children.length) return;
  for (const c of botCats) { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.append(o); }
}

// one card: a tinted mascot orb inside a rarity frame
function botCard(c){
  const card = el("div", "card " + (c.rarity || "common"));
  if (RARITY_TR[c.rarity]) card.append(el("div", "crarity", RARITY_TR[c.rarity]));
  const face = mascotEl(c.mascot, 58);
  face.el.classList.add("small-orb", "face");
  card.append(face.el, el("div", "cname", c.name), el("div", "ccat", c.category || "Diğer"), el("div", "ctag", c.tagline || ""));
  const st = el("div", "cstats");
  st.append(Object.assign(el("span"), { innerHTML: `<b>${c.chats || 0}</b> sohbet` }), Object.assign(el("span"), { innerHTML: `<b>${c.likes || 0}</b> ♥` }));
  card.append(st);
  card.addEventListener("click", () => { haptic(); openBotDetail(c.id); });
  return card;
}

function destroyOrbs(root){ for (const o of root.querySelectorAll(".bot-orb")) o._orb?.destroy(); }

// Deck: the cards of bots you opened a chat with or liked, kept on this device.
const deckGet = () => LS.get("nakata_deck", []);
function deckAdd(b){
  const card = { id: b.id, name: b.name, category: b.category, tagline: b.tagline, mascot: b.mascot, rarity: b.rarity, chats: b.chats, likes: b.likes, ts: Date.now() };
  LS.set("nakata_deck", [card, ...deckGet().filter((x) => x.id !== b.id)].slice(0, 200));
}
function deckRefresh(b){ if (deckGet().some((x) => x.id === b.id)) deckAdd(b); }
async function loadDiscover(){
  const cards = $("#disc-cards");
  if (discSort === "deck") {
    destroyOrbs(cards); cards.replaceChildren();
    const q = discQ.toLowerCase();
    const mine = deckGet().filter((c) => (!discCat || c.category === discCat) && (!q || (c.name + " " + (c.tagline || "")).toLowerCase().includes(q)));
    if (!mine.length) { cards.append(el("div", "note", discQ || discCat ? "Eşleşme yok" : "Destende henüz kart yok. Bir bota girince ya da beğenince buraya eklenir.")); return; }
    for (const c of mine) cards.append(botCard(c));
    return;
  }
  const params = new URLSearchParams({ sort: discSort, limit: "40" });
  if (discCat) params.set("category", discCat);
  if (discQ) params.set("q", discQ);
  let r; try { r = await api("/bots?" + params.toString()); } catch { r = { ok: false }; }
  destroyOrbs(cards); cards.replaceChildren();
  const items = r.j?.items || [];
  if (!items.length) { cards.append(el("div", "note", discQ ? "Eşleşme yok" : "Henüz bot yok")); return; }
  for (const c of items) cards.append(botCard(c));
}
function buildCatChips(){
  const box = $("#disc-cats"); box.replaceChildren();
  const mk = (label, val) => { const c = el("button", "chip" + (discCat === val ? " on" : ""), label); c.onclick = () => { discCat = val; for (const x of box.children) x.classList.toggle("on", x === c); loadDiscover(); haptic(); }; return c; };
  box.append(mk("Tümü", ""));
  for (const cat of botCats) box.append(mk(cat, cat));
}
function openDiscover(){ closeDrawer(); fillCatSelect(); buildCatChips(); showPage("#f-discover"); loadDiscover(); }
$("#discoverRow").addEventListener("click", openDiscover);
$("#disc-q").addEventListener("input", (e) => { discQ = e.target.value.trim(); clearTimeout(discTimer); discTimer = setTimeout(loadDiscover, 280); });
for (const t of document.querySelectorAll(".disc-tab")) t.addEventListener("click", () => {
  discSort = t.dataset.sort; for (const x of document.querySelectorAll(".disc-tab")) x.classList.toggle("on", x === t); loadDiscover(); haptic();
});

// bot detail
async function openBotDetail(id){
  let r; try { r = await api(`/bots/${id}`); } catch { r = { ok: false }; }
  if (!r.ok || !r.j?.bot) { hapticError(); return; }
  const b = r.j.bot; detailBot = b;
  destroyOrbs($("#bd-orb")); $("#bd-orb").replaceChildren(mascotEl(b.mascot, 86).el);
  $("#bd-cat").textContent = b.category || "Diğer";
  $("#bd-name").textContent = b.name;
  $("#bd-tag").textContent = b.tagline || "";
  $("#bd-chats").textContent = b.chats || 0;
  $("#bd-likes").textContent = b.likes || 0;
  $("#bd-rarity").textContent = RARITY_TR[b.rarity] || "";
  $("#bd-by").textContent = b.ownerName ? `@${b.ownerName}` : "";
  $("#bd-like").classList.toggle("on", !!r.j.liked);
  deckRefresh(b);
  showPage("#f-botdetail");
}
function closeGalleryPages(){ for (const id of ["#f-botdetail", "#f-discover", "#f-mybots"]) $(id).classList.remove("on"); }
$("#bd-open").addEventListener("click", () => {
  if (!detailBot) return;
  deckAdd(detailBot);
  galleryBot = { id: detailBot.id, name: detailBot.name, persona: detailBot.persona, mascot: detailBot.mascot };
  activeBot = null;
  closeGalleryPages(); closeDrawer();
  if (controller) controller.abort();
  convo = []; curId = null; $("#thread").replaceChildren();
  if (detailBot.welcome) { convo.push({ role: "assistant", content: detailBot.welcome }); showHero(false); renderConvo(); }
  else showHero(true);
  setModelLabel(); haptic();
});
$("#bd-like").addEventListener("click", async () => {
  if (!detailBot || !token()) { if (!token()) openAccount(); return; }
  const r = await api(`/bots/${detailBot.id}/like`, { method: "POST", body: {} });
  if (r.ok) { $("#bd-like").classList.toggle("on", r.j.liked); $("#bd-likes").textContent = r.j.likes; if (r.j.liked) react("#bd-orb", "excited"); if (r.j.liked) deckAdd({ ...detailBot, likes: r.j.likes }); haptic(); }
});
$("#bd-report").addEventListener("click", async () => {
  if (!detailBot || !token()) { if (!token()) openAccount(); return; }
  const reason = prompt("Neden bildiriyorsun?") || "";
  const r = await api(`/bots/${detailBot.id}/report`, { method: "POST", body: { reason } });
  if (r.ok) { addNote("Bildirimin alındı, teşekkürler."); haptic(); }
});
$("#bd-share").addEventListener("click", async () => {
  if (!detailBot) return;
  const url = `https://nakata.app/b/${detailBot.id}`;
  try { if (NATIVE.Share) await NATIVE.Share.share({ title: detailBot.name, url }); else { await navigator.clipboard.writeText(url); addNote("Bağlantı kopyalandı."); } }
  catch {}
  haptic();
});

// my bots + earnings + (admin) review queue
function statusLabel(s){ return s === "live" ? "Yayında" : s === "pending" ? "İncelemede" : s === "flagged" ? "Bildirildi" : s === "rejected" ? "Reddedildi" : s; }
async function openMyBots(){
  closeDrawer();
  const list = $("#mb-list"); destroyOrbs(list); list.replaceChildren();
  showPage("#f-mybots");
  if (!token()) { $("#mb-empty").hidden = false; $("#mb-empty").textContent = "Botlarını görmek için giriş yap."; $("#mb-earn").textContent = "0 kredi"; $("#mb-adminwrap").hidden = true; return; }
  let r; try { r = await api("/bots/mine"); } catch { r = { ok: false }; }
  const bots = r.j?.bots || [];
  $("#mb-earn").textContent = `${r.j?.earnedCredits || 0} kredi`;
  $("#mb-empty").hidden = bots.length > 0; $("#mb-empty").textContent = "Henüz bot yayınlamadın.";
  for (const b of bots) {
    const row = el("div", "botopt on"); row.style.padding = "10px 6px";
    const face = mascotEl(b.mascot, 36); face.el.classList.add("small-orb");
    const meta = el("div", "meta"); meta.append(el("div", "nm", b.name), el("div", "ds", `${statusLabel(b.status)} · ${b.chats} sohbet · ${b.likes} ♥${RARITY_TR[b.rarity] ? " · " + RARITY_TR[b.rarity] : ""}`));
    row.append(face.el, meta); list.append(row);
  }
  await loadAdminQueue();
}
$("#disc-mine").addEventListener("click", openMyBots);

async function loadAdminQueue(){
  // probe: only an admin account gets 200 here
  let r; try { r = await api("/bots/admin/queue"); } catch { r = { ok: false, status: 0 }; }
  const wrap = $("#mb-adminwrap"), q = $("#mb-queue");
  if (!r.ok) { wrap.hidden = true; return; }
  wrap.hidden = false; destroyOrbs(q); q.replaceChildren();
  const items = r.j?.items || [];
  $("#mb-queue-empty").hidden = items.length > 0;
  for (const b of items) {
    const row = el("div", "botopt"); row.style.cssText = "flex-wrap:wrap;padding:10px 6px;gap:8px";
    const face = mascotEl(b.mascot, 34); face.el.classList.add("small-orb");
    const meta = el("div", "meta"); meta.append(el("div", "nm", `${b.name} · @${b.ownerName || ""}`), el("div", "ds", `${b.tagline || ""}${b.reports ? " · ⚑" + b.reports : ""}`));
    const acts = el("div"); acts.style.cssText = "display:flex;gap:6px;width:100%;margin-top:2px";
    const mk = (label, action, cls) => { const x = el("button", "", label); x.style.cssText = `flex:1;padding:8px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid var(--line);${cls}`; x.onclick = async () => { const a = await api(`/bots/admin/${b.id}/${action}`, { method: "POST", body: {} }); if (a.ok) { loadAdminQueue(); haptic(); } }; return x; };
    acts.append(mk("Onayla", "approve", "color:#6ee7b7;border-color:#10b98155"), mk("Reddet", "reject", "color:var(--muted)"), mk("Kaldır", "remove", "color:var(--err);border-color:#e5736b55"));
    row.append(face.el, meta, acts); q.append(row);
  }
}
