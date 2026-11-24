/* ---- sessions (local) ---- */
function allSessions(){ return LS.get("nakata_byok_sessions", {}); }
function saveSessions(s){ LS.set("nakata_byok_sessions", s); }
function renderSessions(filter = ""){
  const list = $("#slist"); list.replaceChildren();
  const f = filter.trim().toLowerCase();
  let items = Object.values(allSessions()).sort((a, b) => b.ts - a.ts);
  if (f) items = items.filter((s) => (s.title || "").toLowerCase().includes(f));
  if (!items.length) { list.append(el("div", "note", f ? "Eşleşme yok" : "Henüz sohbet yok")); return; }
  for (const s of items) {
    const row = el("div", "sitem" + (curId === s.id ? " on" : ""));
    const t = el("button", "st", s.title || "(başlıksız)");
    t.addEventListener("click", () => { closeDrawer(); openConvo(s.id); });
    const x = el("button", "x"); x.setAttribute("aria-label", "Sil"); x.innerHTML = ICON_X;
    x.addEventListener("click", (e) => { e.stopPropagation(); if (token()) chatCloudRequest("/conversations/" + encodeURIComponent(s.id), { method: "DELETE" }).catch(() => {}); const all = allSessions(); delete all[s.id]; saveSessions(all); if (curId === s.id) newChat({ keepDrawer: true }); else renderSessions($("#search").value); });
    row.append(t, x); list.append(row);
  }
}
$("#search").addEventListener("input", (e) => renderSessions(e.target.value));

/* ---- chat ---- */
let convo = [];          // [{role, content}]
let curId = null;
let controller = null, bubble = null, reasonNode = null;

/* ---- mascot: desktop app.js "Nakata mascot" + poke handler, same timings ---- */
const mascot = orb({ size: 92, color: NAKATA_ORB_COLOR, expression: "neutral", follow: true });
$("#mascot").append(mascot.el);
{
  let idle = null, asleep = false;
  const doze = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { mascot.set("sleepy"); idle = setTimeout(() => { mascot.set("sleeping"); asleep = true; }, 30000); }, 45000);
  };
  const wake = () => {
    if (asleep) { asleep = false; mascot.set("surprised"); setTimeout(() => mascot.set("neutral"), 900); }
    else if (mascot.expression === "sleepy") mascot.set("neutral");
    doze();
  };
  window.addEventListener("pointerdown", wake, { passive: true });
  window.addEventListener("pointermove", wake, { passive: true });
  window.addEventListener("keydown", wake);
  // Typing a message: mascot perks up and reacts live across both hero and active chat.
  $("#prompt").addEventListener("input", () => {
    const val = $("#prompt").value.trim();
    const tone = val ? window.__mascotReact?.toneOf?.(val) : null;
    const face = !val ? "neutral" : (tone ? tone.face : (/\?\s*$/.test(val) ? "curious" : "attentive"));
    if (!asleep) mascot.set(face);
    if (replyOrb?.el.isConnected && !controller) {
      if (val) replyOrb.set(face);
      else {
        const lastAssistant = convo.filter((m) => m.role === "assistant").at(-1);
        replyOrb.set(lastAssistant?.content ? turnFace(lastAssistant.content) : "happy");
      }
    }
  });
  // Idle life: now and then a small glance, wink or smile on whichever mascot is on screen.
  const glance = () => setTimeout(() => {
    const picks = ["curious", "wink", "happy", "attentive", "excited"];
    const pick = picks[Math.floor(Math.random() * picks.length)];
    if (!asleep && !$("#hero").hidden && mascot.expression === "neutral") {
      mascot.set(pick);
      setTimeout(() => mascot.expression === pick && mascot.set("neutral"), 1300);
    } else if ($("#hero").hidden && replyOrb?.el.isConnected && !controller && !$("#prompt").value.trim()) {
      const before = replyOrb.expression;
      const alt = pick === before ? "wink" : pick;
      replyOrb.set(alt);
      setTimeout(() => replyOrb?.el.isConnected && replyOrb.expression === alt && replyOrb.set(before), 1100);
    }
    glance();
  }, 9000 + Math.random() * 12000);
  doze(); glance();
}
// Poke an orb: a different reaction each time (never the same twice in a row), a quick storm of pokes -> angry.
const POKE_FACES = ["wink", "happy", "surprised", "curious", "excited", "unsure", "attentive"];
let lastPoke = null;
function pokeFace(current){
  const pool = POKE_FACES.filter((f) => f !== lastPoke && f !== current);
  return (lastPoke = pool[Math.floor(Math.random() * pool.length)]);
}
// React with a face for a moment: `where` is an orb, or an element that holds one.
function react(where, face, ms = 1400){
  const o = where?.set ? where : (typeof where === "string" ? $(where) : where)?.querySelector?.("svg.bot-orb")?._orb;
  if (!o) return;
  const before = o.expression; o.set(face); setTimeout(() => o.expression === face && o.set(before === face ? "neutral" : before), ms);
}
{
  const pokes = [], timers = new Map();
  document.addEventListener("click", (e) => {
    const o = e.target instanceof Element ? e.target.closest("svg.bot-orb")?._orb : null;
    if (!o || e.target.closest("#botSheet")) return;
    const now = Date.now(); pokes.push(now);
    while (pokes.length && now - pokes[0] > 1600) pokes.shift();
    const before = POKE_FACES.includes(o.expression) || o.expression === "angry" ? "neutral" : o.expression;
    o.set(pokes.length >= 4 ? "angry" : pokeFace(o.expression)); haptic();
    clearTimeout(timers.get(o));
    timers.set(o, setTimeout(() => o.set(before), pokes.length >= 4 ? 1800 : 900));
  });
}

function showHero(on){ $("#hero").hidden = !on; $("#thread").hidden = on; updateScrollBtn(); }
let chatImageLightbox;
async function saveOrShareChatImage(src, alt, btn) {
  if (!src) return;
  const orig = btn.textContent;
  btn.disabled = true;
  try {
    let file = null;
    try {
      const resp = await fetch(src);
      if (resp.ok) {
        const blob = await resp.blob();
        const ext = (blob.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
        const name = (alt && /\.[a-z0-9]{2,5}$/i.test(alt)) ? alt : ("nakata-image." + ext);
        file = new File([blob], name, { type: blob.type || "image/png" });
      }
    } catch {}
    if (file && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: alt || "Nakata" });
      return;
    }
    if (/^https?:\/\//i.test(src) && navigator.share) {
      await navigator.share({ url: src, title: alt || "Nakata" });
      return;
    }
    if (/^https?:\/\//i.test(src) && NATIVE.Browser) {
      await NATIVE.Browser.open({ url: src, presentationStyle: "popover" });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = file ? URL.createObjectURL(file) : src;
    anchor.download = file ? file.name : "nakata-image.png";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (file) setTimeout(() => URL.revokeObjectURL(anchor.href), 15000);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    if (/^https?:\/\//i.test(src) && NATIVE.Browser) {
      NATIVE.Browser.open({ url: src, presentationStyle: "popover" }).catch(() => {});
    }
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}
function openChatImagePreview(src, alt) {
  if (!chatImageLightbox) {
    const overlay = document.createElement("div");
    overlay.className = "md-chat-image-lightbox";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image preview");
    const image = document.createElement("img");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "md-chat-lightbox-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close image");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "md-chat-lightbox-save";
    const hide = () => { overlay.hidden = true; };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) hide(); });
    image.addEventListener("click", (event) => event.stopPropagation());
    close.addEventListener("click", hide);
    save.addEventListener("click", (event) => {
      event.stopPropagation();
      void saveOrShareChatImage(image.src, image.alt, save);
    });
    overlay.append(image, close, save);
    document.body.append(overlay);
    chatImageLightbox = overlay;
  }
  const image = chatImageLightbox.querySelector("img");
  image.src = src;
  image.alt = alt || "";
  const save = chatImageLightbox.querySelector(".md-chat-lightbox-save");
  if (save) save.textContent = tx("Paylaş / Kaydet");
  chatImageLightbox.hidden = false;
}
document.addEventListener("click", async (event) => {
  const image = event.target.closest?.(".md-chat-image");
  if (image) { openChatImagePreview(image.src, image.alt); return; }
  const art = event.target.closest?.("[data-art-src]");
  if (art) {
    const box = art.closest(".art");
    const src = box?.querySelector(".art-source"), frame = box?.querySelector(".art-frame");
    const showSrc = art.getAttribute("aria-pressed") !== "true";
    art.setAttribute("aria-pressed", showSrc ? "true" : "false");
    if (src) src.hidden = !showSrc;
    if (frame) frame.style.display = showSrc ? "none" : "block";
    return;
  }
  const cp = event.target.closest?.("[data-copy-code]");
  if (cp) {
    const code = cp.closest("pre")?.querySelector("code")?.textContent || "";
    void copyWithFeedback(code, cp, tx("Kopyala"));
    return;
  }
  const sumTbl = event.target.closest?.("[data-sum-table]");
  if (sumTbl) {
    const tbl = sumTbl.closest(".md-table-card")?.querySelector("table");
    if (tbl) { toggleTableSummary(tbl, sumTbl); haptic(); }
    return;
  }
  const mdTbl = event.target.closest?.("[data-md-table]");
  if (mdTbl) {
    const tbl = mdTbl.closest(".md-table-card")?.querySelector("table");
    if (tbl) void copyWithFeedback(tableToMarkdown(tbl), mdTbl, "MD");
    return;
  }
  const cpTbl = event.target.closest?.("[data-copy-table]");
  if (cpTbl) {
    const tbl = cpTbl.closest(".md-table-card")?.querySelector("table");
    if (tbl) void copyWithFeedback(tableToText(tbl, "tsv"), cpTbl, tx("Kopyala"));
    return;
  }
  const csvTbl = event.target.closest?.("[data-csv-table]");
  if (csvTbl) {
    const card = csvTbl.closest(".md-table-card");
    const tbl = card?.querySelector("table");
    if (tbl) {
      try {
        const group = card?.parentElement?.querySelectorAll(".md-table-card") || [];
        const ord = group.length > 1 ? "-" + (Array.from(group).indexOf(card) + 1) : "";
        downloadTableCsv(tbl, card?.querySelector(".md-table-badge")?.textContent || "tablo", ord);
        haptic();
        csvTbl.textContent = tx("CSV indi");
        setTimeout(() => { csvTbl.textContent = "CSV"; }, 1400);
      } catch {}
    }
    return;
  }
  const expTbl = event.target.closest?.("[data-expand-table]");
  if (expTbl) {
    const card = expTbl.closest(".md-table-card");
    const tbl = card?.querySelector("table");
    const modal = $("#tableModal"), body = $("#tableModalBody"), badge = $("#tableModalBadge"), meta = $("#tableModalMeta"), flt = $("#tableModalFilter");
    if (tbl && modal && body) {
      if (badge) badge.textContent = card.querySelector(".md-table-badge")?.textContent || tx("TABLO");
      if (meta) meta.textContent = card.querySelector("[data-table-meta]")?.textContent || "";
      const clone = tbl.cloneNode(true);
      body.replaceChildren(clone);
      const sumModalBtn = $("#tableModalSum");
      if (sumModalBtn) {
        const hasSum = !!card.querySelector("[data-sum-table]") || computeTableSummary(clone).columns.some((c) => c.numeric);
        sumModalBtn.hidden = !hasSum;
        sumModalBtn.textContent = LANG === "en" ? "Σ Summary" : "Σ Özet";
        sumModalBtn.setAttribute("aria-pressed", clone.querySelector("tfoot.md-table-summary") ? "true" : "false");
      }
      if (flt) {
        flt.value = card.querySelector("[data-filter-table]")?.value || "";
        if (flt.value) filterTableRows(clone, flt.value, meta);
      }
      modal.hidden = false;
      haptic();
    }
    return;
  }
  const sortTh = event.target.closest?.(".md-table-card thead th, #tableModalBody thead th");
  if (sortTh) {
    const tbl = sortTh.closest("table");
    const tr = sortTh.parentElement;
    if (tbl && tr) {
      const colIdx = Array.from(tr.children).indexOf(sortTh);
      sortTableByColumn(tbl, colIdx);
      haptic();
    }
    return;
  }
  const wrapCode = event.target.closest?.("[data-wrap-code]");
  if (wrapCode) {
    const pre = wrapCode.closest("pre");
    if (pre) {
      const wrapped = pre.classList.toggle("code-wrap");
      wrapCode.setAttribute("aria-pressed", wrapped ? "true" : "false");
      haptic();
    }
    return;
  }
  const dlCode = event.target.closest?.("[data-dl-code]");
  if (dlCode) {
    const code = dlCode.closest("pre")?.querySelector("code")?.textContent || "";
    if (code) {
      const ext = dlCode.getAttribute("data-code-ext") || "txt";
      triggerBlobDownload(code, "text/plain;charset=utf-8", "nakata-snippet." + ext);
      haptic();
    }
    return;
  }
  const qOpt = event.target.closest?.("[data-question-opt]");
  if (qOpt) {
    const card = qOpt.closest("[data-question-card]");
    if (!card || card.classList.contains("submitted")) return;
    const step = qOpt.closest("[data-question-step]");
    const scope = step || card;
    const multi = (step ? step.getAttribute("data-step-multi") : card.getAttribute("data-multi")) === "1";
    if (multi) {
      qOpt.setAttribute("aria-pressed", qOpt.getAttribute("aria-pressed") === "true" ? "false" : "true");
    } else {
      scope.querySelectorAll("[data-question-opt]").forEach((b) => b.setAttribute("aria-pressed", b === qOpt ? "true" : "false"));
    }
    if (card.getAttribute("data-question-wizard") === "1") {
      const steps = Array.from(card.querySelectorAll("[data-question-step]"));
      const answered = steps.filter((st) => st.querySelector('[data-question-opt][aria-pressed="true"]') || String(st.querySelector(".md-question-custom")?.value || "").trim()).length;
      const prog = card.querySelector("[data-question-progress]");
      if (prog) prog.textContent = LANG === "en" ? `${answered}/${steps.length} answered` : `${answered}/${steps.length} yanıtlandı`;
    }
    haptic();
    return;
  }
  const qSub = event.target.closest?.("[data-question-submit]");
  if (qSub) {
    const card = qSub.closest("[data-question-card]");
    if (!card || card.classList.contains("submitted") || controller) return;
    if (card.getAttribute("data-question-wizard") === "1") {
      const lines = [];
      for (const st of card.querySelectorAll("[data-question-step]")) {
        const picked = Array.from(st.querySelectorAll('[data-question-opt][aria-pressed="true"]')).map((b) => b.getAttribute("data-opt-label")).filter(Boolean);
        const custom = String(st.querySelector(".md-question-custom")?.value || "").trim();
        if (custom) picked.push(custom);
        if (picked.length) lines.push(`- ${st.getAttribute("data-step-title") || ""}: ${picked.join(", ")}`);
      }
      if (!lines.length) return;
      const title = card.getAttribute("data-question") || "";
      card.classList.add("submitted");
      qSub.disabled = true;
      send((title ? title + "\n" : "") + lines.join("\n"));
      return;
    }
    const picked = Array.from(card.querySelectorAll('[data-question-opt][aria-pressed="true"]'))
      .map((b) => b.getAttribute("data-opt-label"))
      .filter(Boolean);
    const custom = String(card.querySelector(".md-question-custom")?.value || "").trim();
    if (custom) picked.push(custom);
    if (!picked.length) return;
    const qText = card.getAttribute("data-question") || "";
    card.classList.add("submitted");
    qSub.disabled = true;
    const isTrQ = detectConvLang(qText, picked.join(" ")) === "tr";
    const prefix = isTrQ ? "Seçimim: " : "My choice: ";
    send(qText ? `${qText}\n${prefix}${picked.join(", ")}` : picked.join(", "));
    return;
  }
  const openSrc = event.target.closest?.("[data-open-sources]");
  if (openSrc) {
    const srcsEl = openSrc.closest(".srcs");
    if (srcsEl?.__sources?.length) openSourcesSheet(srcsEl.__sources, srcsEl.__queries || []);
    return;
  }
});
document.addEventListener("input", (event) => {
  const flt = event.target.closest?.("[data-filter-table]");
  if (!flt) return;
  const card = flt.closest(".md-table-card");
  filterTableRows(card?.querySelector("table"), flt.value, card?.querySelector("[data-table-meta]"));
});
$("#tableModalFilter")?.addEventListener("input", (e) => {
  filterTableRows($("#tableModalBody")?.querySelector("table"), e.target.value, $("#tableModalMeta"));
});
$("#tableModalBest")?.addEventListener("click", () => {
  if (controller) return;
  $("#tableModal").hidden = true;
  send(LANG === "en"
    ? "Pick the single best-value recommendation from this table and explain why in 3 concise bullets."
    : "Bu tablodaki seçenekler arasından fiyat/performans açısından en mantıklı tek öneriyi seç ve nedenini 3 kısa maddede açıkla.");
});
$("#tableModalClose")?.addEventListener("click", () => { $("#tableModal").hidden = true; });
$("#tableModal")?.addEventListener("click", (e) => { if (e.target === $("#tableModal")) $("#tableModal").hidden = true; });
$("#tableModalCopy")?.addEventListener("click", () => {
  const tbl = $("#tableModalBody")?.querySelector("table"), btn = $("#tableModalCopy");
  if (tbl && btn) void copyWithFeedback(tableToText(tbl, "tsv"), btn, tx("Kopyala"));
});
$("#tableModalMd")?.addEventListener("click", () => {
  const tbl = $("#tableModalBody")?.querySelector("table"), btn = $("#tableModalMd");
  if (tbl && btn) void copyWithFeedback(tableToMarkdown(tbl), btn, "MD");
});
$("#tableModalSum")?.addEventListener("click", () => {
  const tbl = $("#tableModalBody")?.querySelector("table"), btn = $("#tableModalSum");
  if (tbl) { toggleTableSummary(tbl, btn); haptic(); }
});
$("#tableModalCsv")?.addEventListener("click", () => {
  const tbl = $("#tableModalBody")?.querySelector("table"), btn = $("#tableModalCsv");
  if (!tbl || !btn) return;
  try { downloadTableCsv(tbl, $("#tableModalBadge")?.textContent || "tablo"); haptic(); btn.textContent = tx("CSV indi"); setTimeout(() => { btn.textContent = "CSV"; }, 1400); } catch {}
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if ($("#tableModal") && !$("#tableModal").hidden) { $("#tableModal").hidden = true; return; }
    if ($("#sourcesSheet")?.classList.contains("on")) { closeSheet(); return; }
    if (chatImageLightbox && !chatImageLightbox.hidden) chatImageLightbox.hidden = true;
  }
});

let pendingAttachments = [];
function renderAttachBar(){
  const bar = $("#attachBar"); if (!bar) return;
  bar.replaceChildren();
  bar.hidden = !pendingAttachments.length;
  pendingAttachments.forEach((item, idx) => {
    const wrap = el("div", item.kind === "image" ? "attach-thumb" : "attach-fchip");
    if (item.kind === "image") {
      const img = document.createElement("img"); img.src = item.dataUrl; img.alt = item.name || ""; wrap.append(img);
    } else {
      wrap.append(el("b", "", item.name), el("span", "", Math.max(1, Math.round(item.size / 1024)) + " KB"));
    }
    const rm = el("button", "attach-rm", "×"); rm.type = "button"; rm.setAttribute("aria-label", tx("Kapat"));
    rm.addEventListener("click", () => { pendingAttachments.splice(idx, 1); renderAttachBar(); updateSendBtn(); });
    wrap.append(rm);
    bar.append(wrap);
  });
}
function resizeChatImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const encode = (maxEdge, q) => {
          const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL("image/jpeg", q);
        };
        let dataUrl = encode(1400, 0.82);
        if (dataUrl.length > 850000) dataUrl = encode(1000, 0.68);
        if (dataUrl.length > 880000) dataUrl = encode(760, 0.56);
        resolve(dataUrl);
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img_load")); };
    img.src = url;
  });
}
function updateSendBtn(){ const b = $("#sendBtn"); if (b && !controller) b.disabled = !$("#prompt").value.trim() && !pendingAttachments.length; }

let autoFollow = true;
function updateScrollBtn(){
  const c = $("#chatScroll"), btn = $("#scrollBottomBtn");
  if (!c || !btn) return;
  const far = c.scrollHeight - c.scrollTop - c.clientHeight > 72;
  btn.hidden = $("#thread").hidden || !far || c.scrollHeight <= c.clientHeight + 40;
}
$("#chatScroll").addEventListener("scroll", () => {
  const c = $("#chatScroll");
  autoFollow = (c.scrollHeight - c.scrollTop - c.clientHeight) < 72;
  updateScrollBtn();
}, { passive: true });
$("#scrollBottomBtn").addEventListener("click", () => {
  autoFollow = true;
  const c = $("#chatScroll");
  c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
  $("#scrollBottomBtn").hidden = true;
  haptic();
});
function scrollDown(force = false){
  const c = $("#chatScroll");
  if (force || autoFollow) { c.scrollTop = c.scrollHeight; autoFollow = true; }
  updateScrollBtn();
}
function addUser(text, images = [], files = []){
  const r = el("div", "row user");
  if (images.length) {
    const shots = el("div", "msg-shots");
    for (const url of images) {
      const img = document.createElement("img"); img.src = url; img.alt = ""; img.className = "md-chat-image"; shots.append(img);
    }
    r.append(shots);
  }
  if (files.length) {
    const box = el("div", "msg-files");
    for (const f of files) box.append(el("span", "msg-file", f.name));
    r.append(box);
  }
  if (text || (!images.length && !files.length)) r.append(el("div", "bubble", text || ""));
  $("#thread").append(r); scrollDown();
}
// Turn output goes above the "thinking" row while a turn runs.
function put(node){ if (pendingRow) $("#thread").insertBefore(node, pendingRow); else $("#thread").append(node); scrollDown(); }
function addAsst(){
  const r = el("div", "row"); const w = el("div", "asst");
  const text = el("div", "md"); w.append(text); r.append(w); put(r);
  return text;
}
function addNote(text, err, retryTurn){
  put(el("div", "note" + (err ? " err" : ""), text));
  if (err && retryTurn) {
    const act = el("div", "msg-actions");
    const btn = el("button", "retry"); btn.type = "button";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg><span>' + esc(tx("Yeniden dene")) + '</span>';
    btn.addEventListener("click", () => {
      if (controller) return;
      act.remove();
      const rows = $("#thread").querySelectorAll(".row.user");
      rows[rows.length - 1]?.remove();
      send(retryTurn.text, { images: retryTurn.images || [], files: retryTurn.files || [] });
    });
    act.append(btn); put(act);
  }
  if (err) { hapticError(); flashReply(/bitti|yoğun|kapalı|kredi|yetmiyor|limit/i.test(text) ? "sad" : "surprised"); }
}
function openSourcesSheet(sources, queries = []){
  const list = $("#sourcesSheetList"), sheet = $("#sourcesSheet"), scrim = $("#scrim"), title = $("#sourcesSheetTitle"), qWrap = $("#sourcesSheetQueries");
  if (!list || !sheet || !scrim) return;
  list.replaceChildren();
  if (title) title.textContent = `${tx("Kaynaklar")} · ${sources.length}`;
  if (qWrap) {
    const cleanQ = [...new Set((Array.isArray(queries) ? queries : []).map((q) => String(q || "").trim()).filter(Boolean))].slice(0, 6);
    qWrap.replaceChildren();
    qWrap.hidden = !cleanQ.length;
    for (const q of cleanQ) qWrap.append(el("span", "src-sheet-qchip", `${tx("Aranan")}: ${q}`));
  }
  sources.forEach((s, idx) => {
    const a = document.createElement("a");
    a.className = "src-sheet-item"; a.href = s.url; a.target = "_blank"; a.rel = "noopener";
    const m = srcMonogram(s.host);
    const top = el("div", "src-sheet-top");
    const mono = el("i", "src-mono", m.ch); mono.style.background = m.bg; mono.setAttribute("aria-hidden", "true");
    top.append(mono, el("span", "", `${idx + 1}. ${s.host || s.url}`));
    a.append(top, el("div", "src-sheet-title", s.title || s.url));
    if (s.snippet) a.append(el("div", "src-sheet-snippet", s.snippet));
    a.append(el("div", "src-sheet-url", s.url));
    list.append(a);
  });
  scrim.classList.add("on");
  sheet.classList.add("on");
  list.scrollTop = 0;
  list.classList.toggle("scrolls", list.scrollHeight > list.clientHeight + 2);
  haptic();
}
function filterCleanSources(sources){
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    const u = String(s?.url || "");
    if (!/^https?:\/\//i.test(u)) continue;
    if (s?.type === "weather" || /(?:duckduckgo\.com|bing\.com\/aclick|\/rdclks\/|search\.yahoo\.com|wttr\.in|open-meteo\.com|ad_domain=|ad_provider=)/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    let host = "";
    try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
    const snippet = String(s.snippet || s.excerpt || s.content || "").replace(/\s+/g, " ").trim().slice(0, 220);
    out.push({ title: String(s.title || u), url: u, host, ...(snippet ? { snippet } : {}) });
  }
  return out;
}
function renderSources(row, sources, queries = []){
  if (!row || !Array.isArray(sources) || !sources.length) return;
  const asst = row.querySelector(".asst");
  if (!asst || asst.querySelector(".srcs")) return;
  const clean = filterCleanSources(sources);
  if (!clean.length) return;
  const box = el("div", "srcs");
  box.__sources = clean;
  box.__queries = Array.isArray(queries) ? queries.slice(0, 6) : [];
  const bar = el("div", "srcs-bar");
  const pill = document.createElement("button");
  pill.type = "button"; pill.className = "srcs-pill"; pill.dataset.openSources = "1"; pill.dataset.noI18n = "1";
  const stack = el("span", "srcs-stack");
  clean.slice(0, 4).forEach((s) => {
    const m = srcMonogram(s.host);
    const mono = el("i", "src-mono", m.ch); mono.style.background = m.bg; mono.setAttribute("aria-hidden", "true");
    stack.append(mono);
  });
  const lastUser = convo.filter((m) => m.role === "user").at(-1)?.content || "";
  const convIsTr = detectConvLang(lastUser, "") === "tr";
  const pillLabel = convIsTr ? `${clean.length} site incelendi` : `Searched ${clean.length} ${clean.length === 1 ? "site" : "sites"}`;
  pill.append(stack, el("strong", "", pillLabel));
  bar.append(pill);
  box.append(bar);
  clean.slice(0, 8).forEach((s, idx) => {
    const a = document.createElement("a"); a.href = s.url; a.target = "_blank"; a.rel = "noopener";
    const m = srcMonogram(s.host);
    const mono = el("i", "src-mono", m.ch); mono.style.background = m.bg; mono.setAttribute("aria-hidden", "true");
    a.append(mono, el("span", "", String(idx + 1)), el("em", "", s.title || s.url));
    if (s.host) a.append(el("small", "src-host", s.host));
    box.append(a);
  });
  if (box.children.length > 1) asst.append(box);
}

// ChatGPT-style live activity indicator: calm status text + live searched-sites badge (never a bare "15 sn" timer).
let pendingRow = null, pendingOrb = null, pendingStatusEl = null, pendingPillEl = null, pendingConvTr = true;
function setPendingStatus(status){
  if (!pendingStatusEl) return;
  const label = status ? (pendingConvTr ? status : tx(status)) : (pendingConvTr ? "Düşünüyor…" : "Thinking…");
  pendingStatusEl.textContent = label;
}
function updatePendingSearch(sources, statusText = ""){
  if (!pendingRow) return;
  const clean = filterCleanSources(sources);
  if (statusText) setPendingStatus(statusText);
  else if (clean.length && pendingStatusEl) pendingStatusEl.textContent = "";
  if (!clean.length) return;
  if (!pendingPillEl) {
    pendingPillEl = el("span", "pending-pill");
    pendingPillEl.dataset.noI18n = "1";
    pendingRow.append(pendingPillEl);
  }
  pendingPillEl.replaceChildren();
  const stack = el("span", "srcs-stack");
  const seenHosts = [];
  for (const s of clean) {
    if (s.host && !seenHosts.includes(s.host)) seenHosts.push(s.host);
  }
  seenHosts.slice(0, 4).forEach((h) => {
    const m = srcMonogram(h);
    const mono = el("i", "src-mono", m.ch); mono.style.background = m.bg; mono.setAttribute("aria-hidden", "true");
    stack.append(mono);
  });
  const countTxt = pendingConvTr
    ? `${clean.length} site incelendi`
    : `Searched ${clean.length} ${clean.length === 1 ? "site" : "sites"}`;
  pendingPillEl.append(stack, el("span", "", countTxt));
  scrollDown();
}
function showPending(userText = ""){
  pendingOrb ??= orb({ size: 22, color: orbColor(), expression: "thinking" });
  pendingOrb.setColor(orbColor()); pendingOrb.set("thinking"); pendingOrb.el.classList.add("small-orb");
  pendingConvTr = detectConvLang(userText, "") === "tr";
  pendingStatusEl = el("span", "");
  pendingStatusEl.dataset.noI18n = "1";
  pendingPillEl = null;
  setPendingStatus("");
  pendingRow = el("div", "pending"); pendingRow.append(pendingOrb.el, pendingStatusEl);
  $("#thread").append(pendingRow); scrollDown();
}
function hidePending(){ pendingRow?.remove(); pendingRow = null; pendingStatusEl = null; pendingPillEl = null; }

// Desktop turnFace: the last answer carries the mascot, its face reading the turn.
let replyOrb = null;
function turnFace(text){
  const t = String(text || "").trim();
  if (/\?\s*$/.test(t) || /\b(hangisini|hangisi|ister misin|which one|should i|do you want)\b/i.test(t.slice(-240))) return "unsure";
  const tone = window.__mascotReact?.toneOf?.(t);
  if (tone && ["sad", "wink", "surprised", "excited"].includes(tone.face)) return tone.face;
  return "happy";
}
function reportModel(){
  if (galleryBot?.id) return `gallery:${galleryBot.id}`;
  const bot = activeBot ? allBots()[activeBot] : null;
  return bot?.model || getCfg().model || "unknown";
}
function addReportAction(row, text, targetBar = null){
  if (!row) return;
  const existing = row.querySelector(".report");
  if (existing) {
    if (targetBar && existing.parentElement !== targetBar) {
      const oldBar = existing.parentElement;
      targetBar.append(existing);
      if (oldBar?.classList.contains("report-actions") && !oldBar.children.length) oldBar.remove();
    }
    return;
  }
  const button = el("button", "report");
  button.type = "button";
  button.setAttribute("aria-label", "Bildir");
  button.setAttribute("title", "Bildir");
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5m0 0c5-4 10 4 16 0v11c-6 4-11-4-16 0"/></svg><span class="rep-lbl"></span>';
  const lbl = button.querySelector(".rep-lbl");
  const setMsg = (m) => { lbl.textContent = m ? tx(m) : ""; button.classList.toggle("has-msg", !!m); };
  const hostBar = targetBar || el("div", "msg-actions");
  if (!targetBar) { hostBar.classList.add("report-actions"); row.append(hostBar); }
  hostBar.append(button);
  let picker = null;
  const submitReport = async (reason) => {
    picker?.remove(); picker = null;
    button.disabled = true; setMsg("Gönderiliyor…");
    const result = await api("/safety-report", { method: "POST", body: { content: String(text || "").slice(0, 12000), model: reportModel(), reason } });
    if (result.ok) {
      setMsg(result.j?.evidenceEncrypted ? "Bildirildi · inceleme kuyruğuna alındı" : "Kaydedildi · metin şifrelenmedi");
      haptic();
    } else {
      button.disabled = false;
      setMsg(result.j?.error?.message || (result.status === 401 ? "Giriş gerekli" : "Tekrar dene"));
      if (result.status === 401) setTimeout(() => { if (button.isConnected && !button.disabled) setMsg(""); }, 2200);
    }
  };
  button.addEventListener("click", () => {
    if (!token()) {
      setMsg("Giriş gerekli");
      setTimeout(() => { if (button.isConnected && !button.disabled) setMsg(""); }, 2200);
      return;
    }
    if (picker) { picker.remove(); picker = null; return; }
    picker = el("div", "report-picker");
    for (const [label, code] of [["Yanlış bilgi", "inaccurate"], ["Zararlı içerik", "unsafe_content"], ["Diğer", "other"]]) {
      const b = el("button", "", tx(label)); b.type = "button";
      b.addEventListener("click", () => { void submitReport(code); });
      picker.append(b);
    }
    const cancel = el("button", "", tx("Vazgeç")); cancel.type = "button";
    cancel.addEventListener("click", () => { picker?.remove(); picker = null; });
    picker.append(cancel);
    (button.closest(".msg-actions") || button.parentElement || row).after(picker);
  });
}
function editLastTurn(){
  if (controller) return;
  let ui = -1;
  for (let i = convo.length - 1; i >= 0; i--) if (convo[i].role === "user") { ui = i; break; }
  if (ui < 0) return;
  const lastUser = convo[ui];
  convo = convo.slice(0, ui);
  renderConvo();
  const box = $("#prompt");
  box.value = lastUser.content || "";
  grow(); updateSendBtn(); box.focus();
  haptic();
}
function retryLastTurn(){
  if (controller) return;
  let ui = -1;
  for (let i = convo.length - 1; i >= 0; i--) if (convo[i].role === "user") { ui = i; break; }
  if (ui < 0) return;
  const lastUser = convo[ui];
  convo = convo.slice(0, ui);
  renderConvo();
  send(lastUser.content, { images: lastUser.images || [], files: lastUser.files || [] });
}
let activeUtterance = null;
let activeSpeakAudio = null;
let activeSpeakAbort = null;
function stopSpeak(){
  try { window.speechSynthesis?.cancel(); } catch {}
  try { activeSpeakAbort?.abort(); } catch {}
  activeSpeakAbort = null;
  if (activeSpeakAudio) {
    try { activeSpeakAudio.pause(); activeSpeakAudio.src = ""; activeSpeakAudio.remove(); } catch {}
    activeSpeakAudio = null;
  }
  activeUtterance = null;
  for (const b of document.querySelectorAll(".msg-actions .speak")) b.textContent = tx("Oku");
}
function markLastReply(){
  stopSpeak();
  const rows = document.querySelectorAll("#thread .row:not(.user)");
  const last = rows[rows.length - 1];
  for (const oldBar of document.querySelectorAll("#thread .msg-actions:not(.report-actions)")) {
    const row = oldBar.parentElement;
    const rep = oldBar.querySelector(".report");
    if (rep && row && row !== last) {
      const wrap = el("div", "msg-actions"); wrap.classList.add("report-actions"); wrap.append(rep);
      oldBar.replaceWith(wrap);
    } else oldBar.remove();
  }
  for (const x of document.querySelectorAll("#thread .followups, #thread .edit-msg, #thread .servedby, #thread .report-picker, #thread .refine-bar")) x.remove();
  const userRows = document.querySelectorAll("#thread .row.user");
  const lastUserRow = userRows[userRows.length - 1];
  const lastUserMsg = convo.filter((m) => m.role === "user").at(-1);
  if (lastUserRow && lastUserMsg?.content) {
    const ed = el("button", "edit-msg", tx("Düzenle")); ed.type = "button";
    ed.addEventListener("click", editLastTurn);
    lastUserRow.append(ed);
  }
  const lastMsg = convo.filter((m) => m.role === "assistant").at(-1);
  const text = lastMsg?.content;
  if (!last || !text) return;
  replyOrb ??= orb({ size: 28, color: orbColor(), expression: "neutral" });
  replyOrb.setColor(orbColor()); replyOrb.el.classList.add("reply-orb", "small-orb");
  const copy = el("button", "copy"); copy.innerHTML = ICON_COPY + "<span>" + esc(tx("Kopyala")) + "</span>";
  copy.addEventListener("click", () => {
    void copyWithFeedback(text, copy, tx("Kopyala"), copy.lastChild, () => flashReply("wink"));
  });
  const redo = el("button", "retry"); redo.type = "button";
  redo.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg><span>' + esc(tx("Yeniden dene")) + '</span>';
  redo.addEventListener("click", retryLastTurn);
  const bar = el("div", "msg-actions"); bar.append(replyOrb.el, copy, redo);
  const canServerSpeak = !!token() || voiceMeta(selectedVoice())?.kind === "custom-tts";
  if ((canServerSpeak || ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined")) && text.trim()) {
    const spk = el("button", "speak", tx("Oku")); spk.type = "button";
    spk.addEventListener("click", async () => {
      if (activeUtterance || activeSpeakAudio || activeSpeakAbort) { stopSpeak(); return; }
      const plainText = stripMarkdownForSpeech(text).slice(0, 4000);
      if (!plainText) return;
      const vm = voiceMeta(selectedVoice());
      const useServerTts = vm?.kind === "custom-tts" || !!token();
      if (useServerTts) {
        const ctrl = activeSpeakAbort = new AbortController();
        const audio = activeSpeakAudio = document.createElement("audio");
        audio.playsInline = true; audio.hidden = true; document.body.append(audio);
        spk.textContent = tx("Dur");
        haptic();
        try {
          const blobUrl = await fetchCustomTtsBlobUrl(plainText.slice(0, 1450), vm, { format: "mp3", signal: ctrl.signal });
          if (activeSpeakAudio !== audio || ctrl.signal.aborted) { URL.revokeObjectURL(blobUrl); return; }
          audio.src = blobUrl;
          audio.onended = audio.onerror = () => {
            try { URL.revokeObjectURL(blobUrl); } catch {}
            if (activeSpeakAudio === audio) stopSpeak();
          };
          await audio.play();
          return;
        } catch {
          if (activeSpeakAudio === audio) stopSpeak();
          if (ctrl.signal.aborted || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
        }
      }
      const speechLang = detectConvLang(lastUserMsg?.content || "", plainText) === "tr" ? "tr-TR" : "en-US";
      const u = new SpeechSynthesisUtterance(plainText);
      u.lang = speechLang;
      try {
        const voices = window.speechSynthesis.getVoices?.() || [];
        const prefix = speechLang.slice(0, 2).toLowerCase();
        const matching = voices.filter((v) => String(v.lang || "").toLowerCase().startsWith(prefix));
        const preferred = matching.find((v) => /enhanced|premium|siri|yelda|cem|samantha|ava/i.test(v.name || "")) || matching[0];
        if (preferred) u.voice = preferred;
      } catch {}
      u.onend = u.onerror = () => { if (activeUtterance === u) stopSpeak(); };
      activeUtterance = u;
      spk.textContent = tx("Dur");
      window.speechSynthesis.speak(u);
      haptic();
    });
    bar.append(spk);
  }
  const fbUp = el("button", "fb-btn", "👍"); fbUp.type = "button"; fbUp.dataset.feedback = "up"; fbUp.setAttribute("aria-pressed", "false");
  const fbDn = el("button", "fb-btn", "👎"); fbDn.type = "button"; fbDn.dataset.feedback = "down"; fbDn.setAttribute("aria-pressed", "false");
  const refBtn = el("button", "refine-btn", tx("İyileştir ▾")); refBtn.type = "button"; refBtn.dataset.refineToggle = "1"; refBtn.setAttribute("aria-expanded", "false");
  const toggleRef = (forceOpen) => {
    const existing = last.querySelector(".refine-bar");
    if (existing && !forceOpen) { existing.remove(); refBtn.setAttribute("aria-expanded", "false"); return; }
    if (existing) return;
    const isTrConv = detectConvLang(lastUserMsg?.content || "", text) === "tr";
    const opts = isTrConv
      ? [
          { id: "shorter", label: "Daha kısa", prompt: "Bir önceki yanıtını yarı uzunlukta, en kritik maddelerle özetle." },
          { id: "deeper", label: "Daha detaylı", prompt: "Bir önceki yanıtını daha derin, somut örnekler ve sayılarla genişlet." },
          { id: "table", label: "Tabloya çevir", prompt: "Bir önceki yanıtındaki bilgileri temiz bir karşılaştırma tablosuna dönüştür." },
          { id: "verify", label: "Web'de doğrula", prompt: "Bir önceki yanıtındaki güncel bilgileri canlı web aramasıyla doğrula ve eksikleri güncelle." },
        ]
      : [
          { id: "shorter", label: "Shorter", prompt: "Condense your previous answer to half the length with only the key takeaways." },
          { id: "deeper", label: "More detailed", prompt: "Expand your previous answer with deeper analysis, concrete examples, and numbers." },
          { id: "table", label: "Turn into table", prompt: "Turn the key points from your previous answer into a clean comparison table." },
          { id: "verify", label: "Verify on web", prompt: "Verify the latest facts from your previous answer via live web search and update anything outdated." },
        ];
    const rbar = el("div", "refine-bar"); rbar.dataset.noI18n = "1";
    for (const item of opts) {
      const chip = el("button", "refine-chip", item.label); chip.type = "button"; chip.dataset.refineAction = item.id; chip.dataset.noI18n = "1";
      chip.addEventListener("click", () => { if (!controller) send(item.prompt, { forceWeb: item.id === "verify" }); });
      rbar.append(chip);
    }
    bar.after(rbar);
    refBtn.setAttribute("aria-expanded", "true");
  };
  const setFb = (which) => {
    const upOn = which === "up" && fbUp.getAttribute("aria-pressed") !== "true";
    const dnOn = which === "down" && fbDn.getAttribute("aria-pressed") !== "true";
    fbUp.setAttribute("aria-pressed", upOn ? "true" : "false"); fbUp.classList.toggle("on", upOn);
    fbDn.setAttribute("aria-pressed", dnOn ? "true" : "false"); fbDn.classList.toggle("on", dnOn);
    haptic();
    if (dnOn) toggleRef(true);
  };
  fbUp.addEventListener("click", () => setFb("up"));
  fbDn.addEventListener("click", () => setFb("down"));
  refBtn.addEventListener("click", () => toggleRef(false));
  const expMdBtn = el("button", "refine-btn", ".md"); expMdBtn.type = "button"; expMdBtn.dataset.exportMd = "1"; expMdBtn.setAttribute("aria-label", tx("Markdown indir"));
  expMdBtn.addEventListener("click", () => { exportMobileConvoMarkdown(); haptic(); });
  bar.append(fbUp, fbDn, refBtn, expMdBtn);
  last.append(bar);
  addReportAction(last, text, bar);
  if (lastMsg?.servedBy) last.append(el("div", "servedby", tx("Yedek: " + modelDisplayName(lastMsg.servedBy))));
  if (text.trim().length >= 180 && !lastMsg?.cta && !lastMsg?.generatedImages?.length && !galleryBot) {
    const fup = el("div", "followups");
    fup.dataset.noI18n = "1";
    const convIsTr = detectConvLang(lastUserMsg?.content || "", text) === "tr";
    const hasTable = /\|[^\n]+\|\n\s*\|?\s*:?-{2,}/.test(text);
    const hasCode = /```[a-z0-9_+-]+/i.test(text);
    const followLabels = hasTable
      ? (convIsTr
          ? ["Tablodaki en iyi F/P seçeneği hangisi?", "Artı/eksi karar matrisini çıkar", "Tek bir öneri seç"]
          : ["Which option in the table is the best value?", "Build a pros & cons decision matrix", "Pick a single recommendation"])
      : hasCode
        ? (convIsTr
            ? ["Test ve örnek kullanım yaz", "Adım adım tablo ile özetle", "Edge-case hatalarını incele"]
            : ["Write tests and usage examples", "Summarize step by step in a table", "Explain edge cases"])
        : (convIsTr
            ? ["Karşılaştırma tablosu hazırla", "Daha detaylı anlat", "Örnekle açıkla"]
            : ["Prepare a comparison table", "Explain in detail", "Show an example"]);
    for (const label of followLabels) {
      const chip = el("button", "followup-chip", label); chip.type = "button"; chip.dataset.noI18n = "1";
      chip.addEventListener("click", () => { if (!controller) send(label); });
      fup.append(chip);
    }
    last.append(fup);
  }
  replyOrb.set("neutral"); requestAnimationFrame(() => replyOrb.set(turnFace(text)));
}
function flashReply(face){
  if (!replyOrb?.el.isConnected) return;
  const before = replyOrb.expression; replyOrb.set(face);
  setTimeout(() => replyOrb.expression === face && replyOrb.set(before), 1400);
}

const IMG_INTENT_RE = /(?:görsel|resim|fotoğraf|illüstrasyon|kapak|poster|logo|duvar\s*kağıdı|wallpaper|image|picture|photo|illustration).{0,28}(?:üret|yap|oluştur|çiz|tasarla|create|generate|draw|make)|(?:üret|yap|oluştur|çiz|create|generate|draw|make).{0,24}(?:görsel|resim|fotoğraf|illüstrasyon|image|picture|photo|illustration)/i;
function renderChatCta(row, cta){
  if (!row || !cta) return;
  const asst = row.querySelector(".asst");
  if (!asst || asst.querySelector(".chat-cta")) return;
  const card = el("div", "chat-cta");
  const msg = cta.reason === "auth_required"
    ? tx("Görsel üretmek için nakata.app hesabınla giriş yap veya kredi paketi al.")
    : cta.reason === "insufficient_credits"
      ? tx(`Görsel üretimi için kredin yetersiz (gerekli: ${cta.cost || 20} kredi).`)
      : tx("Görsel Stüdyo'da kredi kullanarak yüksek çözünürlüklü görsel üretebilirsin.");
  card.append(el("div", "chat-cta-txt", msg));
  const btns = el("div", "chat-cta-btns");
  const mkBtn = (label, pri, fn) => {
    const b = el("button", "chat-cta-btn" + (pri ? " pri" : ""), tx(label));
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  if (cta.reason === "auth_required") {
    btns.append(
      mkBtn("Giriş yap", true, openAccount),
      mkBtn("Üyelik / Kredi al", false, openPlansPage),
      mkBtn("Görsel Stüdyo", false, openImages),
    );
  } else if (cta.reason === "insufficient_credits") {
    btns.append(
      mkBtn("Üyelik / Kredi al", true, openPlansPage),
      mkBtn("Görsel Stüdyo", false, openImages),
    );
  } else {
    btns.append(mkBtn("Görsel Stüdyoyu aç", true, openImages));
  }
  card.append(btns);
  asst.append(card);
}
function buildMobileGeneratedImageCard(url, promptText = ""){
  const card = el("div", "chat-gen-card");
  const im = document.createElement("img");
  im.src = url; im.alt = promptText || ""; im.className = "md-chat-image";
  im.style.cssText = "display:block;width:100%;height:auto;max-height:360px;object-fit:contain;cursor:zoom-in";
  const bar = el("div", "chat-gen-toolbar");
  const zoomBtn = el("button", "chat-gen-btn", tx("Büyüt")); zoomBtn.type = "button";
  zoomBtn.addEventListener("click", () => openChatImagePreview(url, im.alt));
  const saveBtn = el("button", "chat-gen-btn", tx("Paylaş / Kaydet")); saveBtn.type = "button";
  saveBtn.addEventListener("click", () => { void saveOrShareChatImage(url, im.alt, saveBtn); });
  bar.append(zoomBtn, saveBtn);
  if (promptText) {
    const cpBtn = el("button", "chat-gen-btn", "Prompt"); cpBtn.type = "button";
    cpBtn.addEventListener("click", () => { void copyWithFeedback(promptText, cpBtn, "Prompt"); });
    const regenBtn = el("button", "chat-gen-btn", tx("Yeniden üret")); regenBtn.type = "button";
    regenBtn.addEventListener("click", () => {
      if (controller) return;
      const p = LANG === "en" ? `Generate a fresh variation of this image: ${promptText}` : `Aynı konunun yeni bir varyasyonunu görsel olarak üret: ${promptText}`;
      send(p, { forceImage: true });
    });
    const editBtn = el("button", "chat-gen-btn", tx("Düzenle")); editBtn.type = "button";
    editBtn.addEventListener("click", () => {
      if (controller) return;
      if (!mobileImageModeOn) { mobileImageModeOn = true; syncMobileComposerModes(); }
      const box = $("#prompt");
      box.value = LANG === "en" ? `Edit this image (${promptText.slice(0, 120)}): ` : `Bu görseli şöyle düzenle (${promptText.slice(0, 120)}): `;
      grow(); updateSendBtn(); box.focus();
      haptic();
    });
    bar.append(cpBtn, regenBtn, editBtn);
  }
  card.append(im, bar);
  return card;
}
function renderChatGeneratedImages(row, urls, promptText = ""){
  if (!row || !Array.isArray(urls) || !urls.length) return;
  const asst = row.querySelector(".asst");
  if (!asst) return;
  for (const url of urls) {
    if (!url) continue;
    asst.append(buildMobileGeneratedImageCard(url, promptText));
  }
}
async function runChatImageTask(row, task, msgObj){
  if (!row || !task) return;
  const asst = row.querySelector(".asst");
  if (!asst) return;
  if (task.imageUrl) {
    msgObj.generatedImages = [task.imageUrl];
    if (task.prompt) msgObj.generatedImagePrompt = task.prompt;
    persist();
    renderChatGeneratedImages(row, msgObj.generatedImages, task.prompt || "");
    return;
  }
  if (!task.taskId) return;
  const card = el("div", "chat-gen-card");
  const shimmer = el("div", "chat-gen-shimmer");
  const st = el("div", "chat-gen-status", tx("Görsel hazırlanıyor…"));
  shimmer.append(st);
  card.append(shimmer);
  asst.append(card);
  scrollDown();
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    st.textContent = `${tx("Görsel hazırlanıyor…")} · ${secs} ${tx("sn")}`;
  }, 1000);
  let url = null, pollErrs = 0;
  try {
    for (let i = 0; !url && i < 90; i++) {
      await wait(i < 5 ? 2000 : 3000);
      const t = await api("/task", { method: "POST", body: { taskId: task.taskId } });
      if (!t.ok) {
        if (++pollErrs >= 5) { shimmer.className = ""; st.textContent = t.j?.error || tx("Üretim durumu alınamadı."); return; }
        continue;
      }
      pollErrs = 0;
      if (t.j.status === "failed" || t.j.state === "fail") {
        shimmer.className = "";
        st.textContent = t.j.failMsg || tx("Üretim başarısız");
        return;
      }
      url = t.j.imageUrl || t.j.resultImageUrl || t.j.data?.imageUrl;
    }
    if (!url) { shimmer.className = ""; st.textContent = tx("Sonuç gelmedi, biraz sonra galeriye bak."); return; }
    card.replaceWith(buildMobileGeneratedImageCard(url, task.prompt || ""));
    msgObj.generatedImages = [url];
    if (task.prompt) msgObj.generatedImagePrompt = task.prompt;
    persist();
    api("/gallery", { method: "POST", body: { item: { url, prompt: task.prompt || "", ts: Date.now() } } });
    refreshAccount();
    scrollDown();
  } finally {
    clearInterval(timer);
  }
}

function newChat(opts = {}){
  if (controller) controller.abort();
  stopSpeak();
  pendingAttachments = []; renderAttachBar(); updateSendBtn();
  convo = []; curId = null; autoFollow = true; showHero(true); $("#thread").replaceChildren(); updateScrollBtn(); paintHero();
  if (!opts?.keepDrawer) closeDrawer();
  renderSessions($("#search").value);
}
$("#newBtn").addEventListener("click", () => newChat());
$("#newBtn2").addEventListener("click", () => newChat());

function renderConvo(){
  $("#thread").replaceChildren();
  for (const m of convo) {
    if (m.role === "user") addUser(m.content, m.images || [], m.files || []);
    else if (m.role === "assistant" && (m.content?.trim() || m.generatedImages?.length || m.cta || m.sources?.length)) {
      const node = addAsst();
      if (m.content?.trim()) node.innerHTML = md(m.content);
      if (m.sources?.length) hydrateInlineCitations(node, m.sources);
      const row = node.parentElement?.parentElement;
      renderSources(row, m.sources, m.searchQueries);
      renderChatGeneratedImages(row, m.generatedImages, m.generatedImagePrompt || "");
      renderChatCta(row, m.cta);
      addReportAction(row, m.content || "");
    }
  }
  markLastReply();
  if (token() && curId) renderCloudArtifacts(curId).catch(() => {});
}
function openConvo(id){
  const s = allSessions()[id]; if (!s) return;
  if (controller) controller.abort();
  curId = id; convo = s.msgs.slice(); activeBot = s.bot || null; galleryBot = s.gbot || null; autoFollow = true; setModelLabel();
  showHero(convo.length === 0); renderConvo(); scrollDown(true);
}

function persist(){
  if (!convo.length) return;
  if (!curId) curId = "c" + Date.now() + Math.random().toString(36).slice(2, 6);
  const firstUser = convo.find((m) => m.role === "user");
  const title = (firstUser?.content || firstUser?.files?.[0]?.name || (firstUser?.images?.length ? tx("Görsel") : "") || "Sohbet").split("\n")[0].slice(0, 60);
  const all = allSessions();
  all[curId] = { id: curId, title, ts: Date.now(), bot: activeBot || null, gbot: galleryBot || null, msgs: convo };
  saveSessions(all);
  scheduleChatCloudSync();
}

function setBusy(on){
  const b = $("#sendBtn");
  b.disabled = !on && !$("#prompt").value.trim() && !pendingAttachments.length;
  b.setAttribute("aria-label", on ? "Durdur" : "Gönder");
  b.querySelector("svg").innerHTML = on ? SEND_STOP : SEND_UP;
}

const FREE_ERRORS = {
  free_limit: "Bugünkü ücretsiz mesajların bitti. Yarın yenilenir; beklemek istemezsen Ayarlar'dan kendi anahtarını ekleyebilirsin.",
  slow_down: "Biraz hızlı gidiyoruz. Birkaç saniye bekleyip tekrar gönder.",
  free_busy: "Ücretsiz sohbet şu an çok yoğun. Biraz sonra tekrar dene.",
  free_closed: "Ücretsiz sohbet şu an kapalı. Ayarlar'dan kendi anahtarınla devam edebilirsin.",
  consent_required: "Sansürsüz modeller 18+ onayı gerektiriyor. Uygulamada Ayarlar → Sansürsüz mod (18+) bölümünden açabilirsin.\nUncensored models need the 18+ consent: turn it on in the app under Settings → Uncensored mode (18+).",
  hard_floor: "Bu istek güvenlik sınırları nedeniyle engellendi.",
  provider_budget: "Refuseless sağlayıcı bakiyesi yetersiz; model geçici olarak kullanılamıyor.",
  uncensored_closed: "Sansürsüz modeller şu anda kapalı.",
  upstream: "Model cevap vermedi. Tekrar dene.",
  no_credits: "Kredin yetmiyor.",
};
function toApiContent(m){
  const fileText = (m.files || []).map((f) => `\n\n[${f.name}]\n\`\`\`\n${f.text}\n\`\`\``).join("");
  const combined = (m.content || "") + fileText;
  if (!m.images?.length) return combined;
  const parts = [{ type: "text", text: combined || tx("Bu görseli incele.") }];
  for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}
async function send(text, opts = {}){
  if ($("#slashMenu")) $("#slashMenu").hidden = true;
  const slashM = /^\/(web|ara|search|gorsel|görsel|image|tablo|table)(?:\s+([\s\S]+))?$/i.exec(String(text || "").trim());
  if (slashM) {
    const cmd = slashM[1].toLowerCase(), rest = String(slashM[2] || "").trim();
    if (cmd === "web" || cmd === "ara" || cmd === "search") {
      opts = { ...opts, forceWeb: true };
      if (!mobileWebModeOn) { mobileWebModeOn = true; syncMobileComposerModes(); }
      text = rest;
    } else if (cmd === "gorsel" || cmd === "görsel" || cmd === "image") {
      opts = { ...opts, forceImage: true };
      if (!mobileImageModeOn) { mobileImageModeOn = true; syncMobileComposerModes(); }
      text = rest;
    } else if (cmd === "tablo" || cmd === "table") {
      text = rest ? ((LANG === "en" ? "Build a comparison table for: " : "Karşılaştırma tablosu hazırla: ") + rest) : "";
    }
  }
  const images = (opts.images || []).slice(0, 2);
  const files = opts.files || [];
  if (!text && !images.length && !files.length) return;
  const cfg = getCfg();
  // A gallery bot always runs on the free tier: the server injects the bot's
  // persona and meters the cost, so no client key or system prompt is needed.
  const gb = galleryBot;
  const free = gb ? true : cfg.provider === "nakata";
  if (!gb && !free && !cfg.key) { openSettings(); return; }
  stopSpeak();
  for (const oldFup of document.querySelectorAll("#thread .followups, #thread .edit-msg")) oldFup.remove();
  autoFollow = true;
  haptic(); showHero(false); addUser(text, images, files); bubble = null; reasonNode = null; setBusy(true); showPending(text); scrollDown(true);
  const userTurn = { role: "user", content: text };
  if (images.length) userTurn.images = images;
  if (files.length) userTurn.files = files;
  convo.push(userTurn);

  const bot = !gb && activeBot ? allBots()[activeBot] : null;
  const model = (bot && bot.model) || cfg.model;
  const travelAssistant = !gb && window.NakataTravelResearch?.isTravelAssistant({ id: activeBot === "Travel Assistant" ? "travel-assistant" : "", name: activeBot });
  // Hosted Nakata chats already have server-side live web_search/fetch_url/get_weather tools;
  // only run client pre-flight travel research for BYOK mode or explicit visual requests.
  const needPreTravelSearch = travelAssistant && (!free || window.NakataTravelResearch?.wantsImages?.(convo));
  const travelResearch = needPreTravelSearch ? await window.NakataTravelResearch.search({
    history: convo,
    deviceId: deviceId(),
    endpoint: "https://nakata.app/api/mobile/travel-research"
  }) : null;
  let byokWebResearch = null;
  if (mobileWebModeOn && !free && !gb && !travelResearch && (text || "").trim().length >= 2) {
    setPendingStatus("Web'de aranıyor…");
    try {
      const wr = await fetch("https://nakata.app/api/mobile/websearch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Nakata-Device": deviceId() },
        body: JSON.stringify({
          query: text.trim().slice(0, 300),
          includeImages: /görsel|fotoğraf|resim|photo|image|picture/i.test(text),
        }),
      });
      if (wr.ok) byokWebResearch = await wr.json();
    } catch {}
    if (byokWebResearch?.sources?.length) updatePendingSearch(byokWebResearch.sources, "");
  } else if (mobileWebModeOn && free) {
    setPendingStatus("Web'de aranıyor…");
  }
  const messages = [];
  if (!gb) {
    const prof = profileText();
    const learned = activeBotLessons(bot);
    const lessonBlock = learned.length
      ? `Lessons learned from this user's feedback (follow them):\n${learned.map((l) => `- ${l.text.trim()}`).join("\n")}`
      : "";
    const baseSystem = "You are Nakata, the assistant in the Nakata app. Talk like a sharp, warm, deeply knowledgeable partner, never like a stiff customer-support bot. Reply in the language the user writes in. In Turkish be natural and informal (sen), never stiff or translated-sounding. Calibrate length and depth to the user's intent. Start with the answer. When comparing options, products, plans, technologies, hotels, prices, pros/cons or trade-offs, or when preparing a decision/question matrix, build a clean, scannable Markdown table with concrete numbers, prices, specs, or dates (never vague labels like 'standard' or 'higher' when specifics are known) and a clear winner per user profile. Never use em-dashes (—) or en-dashes (–) in prose; use commas, colons, periods, or parentheses instead. Give your writing clean ChatGPT-style breathing room: keep paragraphs short (2-3 sentences), always separate paragraphs, headings, lists, and tables with blank lines, and never stack dense lines back-to-back without blank lines. Use live tools proactively (web_search, fetch_url, get_weather, generate_image). Never write citation or footnote numbers like [1] or (1) in your text.";
    let system = [bot && bot.persona ? `${baseSystem}\n\nFor this conversation you play this character:\n${bot.persona}` : ((prof || lessonBlock || travelResearch || byokWebResearch) ? baseSystem : ""), lessonBlock, prof].filter(Boolean).join("\n\n");
    if (travelResearch) system += "\n\n" + window.NakataTravelResearch.context(travelResearch);
    if (byokWebResearch?.sources?.length) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const summary = byokWebResearch.sources.map((s, idx) => `[${idx + 1}] ${s.title || s.url} (${s.url})\n${String(s.content || "").slice(0, 500)}`).join("\n\n");
      system += `\n\nLIVE WEB SEARCH RESULTS (verified today ${todayIso}):\n${summary}\nUse these live facts directly in your answer and build a clean comparison table when comparing options. Never write inline [1] or (1) citation markers.`;
    }
    if (system) messages.push({ role: "system", content: system });
  }
  for (const m of convo) if (m.role === "user" || m.role === "assistant") messages.push({ role: m.role, content: m.role === "user" ? toApiContent(m) : m.content });

  if ((free || gb) && !curId) curId = "c" + Date.now() + Math.random().toString(36).slice(2, 6);
  controller = new AbortController();
  let acc = "", shownLen = 0, frame = 0, retry = null, servedBy = "", msgAction = null, msgImageTask = null;
  const msgSources = [], seenSrc = new Set(), msgImages = [], seenImg = new Set(), msgQueries = [];
  const explicitWeb = Boolean(opts?.forceWeb || mobileWebModeOn);
  const explicitImage = Boolean(opts?.forceImage || mobileImageModeOn);
  if (byokWebResearch?.query) msgQueries.push(String(byokWebResearch.query).trim());
  if (byokWebResearch?.sources?.length) {
    for (const s of byokWebResearch.sources) {
      if (s?.url && !seenSrc.has(s.url)) {
        seenSrc.add(s.url);
        const snippet = String(s.snippet || s.content || "").replace(/\s+/g, " ").trim().slice(0, 220);
        msgSources.push({ title: String(s.title || s.url), url: String(s.url), ...(snippet ? { snippet } : {}) });
      }
    }
  }
  if (byokWebResearch?.images?.length) {
    for (const im of byokWebResearch.images) {
      const u = String(im?.url || "");
      if (/^https:\/\//i.test(u) && !seenImg.has(u)) { seenImg.add(u); msgImages.push({ title: String(im.title || ""), url: u }); }
    }
  }
  const streamCache = { prefixLen: 0, prefixHtml: "" };
  const mdStream = (visible, cache) => {
    const sep = visible.lastIndexOf("\n\n");
    if (sep > cache.prefixLen) {
      let fenceOpen = false, mathOpen = false;
      for (const ln of visible.slice(cache.prefixLen, sep).split("\n")) {
        if (/^\s*```/.test(ln)) fenceOpen = !fenceOpen;
        else if (!fenceOpen && /^\s*\$\$\s*$/.test(ln)) mathOpen = !mathOpen;
      }
      if (!fenceOpen && !mathOpen) {
        const nextLen = sep + 2;
        cache.prefixHtml += md(visible.slice(cache.prefixLen, nextLen), { streaming: true });
        cache.prefixLen = nextLen;
      }
    }
    return cache.prefixHtml + md(visible.slice(cache.prefixLen), { streaming: true });
  };
  const renderShown = (len) => {
    if (!bubble) return;
    const partial = len >= acc.length ? acc : acc.slice(0, len);
    bubble.innerHTML = mdStream(partial, streamCache);
    scrollDown();
  };
  const paintStep = () => {
    frame = 0;
    if (!bubble || shownLen >= acc.length) return;
    const backlog = acc.length - shownLen;
    const step = backlog <= 4 ? backlog : backlog <= 64 ? Math.max(3, Math.ceil(backlog * 0.35)) : Math.max(12, Math.ceil(backlog * 0.48));
    shownLen = Math.min(acc.length, shownLen + step);
    const code = acc.charCodeAt(shownLen - 1);
    if (code >= 0xD800 && code <= 0xDBFF && shownLen < acc.length) shownLen++;
    renderShown(shownLen);
    if (shownLen < acc.length) frame = requestAnimationFrame(paintStep);
  };
  const flushPaint = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (bubble && shownLen < acc.length) { shownLen = acc.length; renderShown(shownLen); }
  };
  const turnRetry = { text, images, files };
  const selectedFreeModel = free
    ? (() => {
        const wanted = bot?.model?.trim();
        const catalog = modelCache.nakata || DEFAULT_NAKATA_MODELS;
        const hit = wanted ? catalog.find((m) => m.id === wanted && !m.unavailable && (!m.requiresConsent || adultConsent)) : null;
        return hit ? hit.id : (LS.get("nakata_free_model", "") || nakataDefaultModel);
      })()
    : model;
  const isTransientNetErr = (err) => {
    if (!err || err.name === "AbortError") return false;
    const m = String(err.message || err).toLowerCase();
    return err.name === "TypeError" || /load failed|failed to fetch|network|connection|reset|timeout|stream_interrupted/i.test(m);
  };
  const sleepAbortable = (ms) => new Promise((resolve) => {
    if (controller?.signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    controller?.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
  let streamFailed = false;
  let lastErr = null;
  try {
    const base = cfg.base.replace(/\/+$/, "");
    const endpoint = gb ? `${base}/bots/${gb.id}/chat` : base + (free ? "/chat" : "/chat/completions");
    const reqInit = {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(free ? { "X-Nakata-Device": deviceId(), ...(token() ? { "Authorization": "Bearer " + token() } : {}) } : { "Authorization": "Bearer " + cfg.key }),
        // OpenRouter's attribution headers only: Gemini rejects the CORS
        // preflight (403) when they are present, which fails every request.
        ...(!gb && /openrouter\.ai/.test(cfg.base) ? { "HTTP-Referer": "https://nakata.app", "X-Title": "Nakata" } : {}),
      },
      body: JSON.stringify({
        model: gb ? undefined : selectedFreeModel,
        stream: true,
        messages,
        ...((free || gb) ? { conversationId: curId, memory: isMemoryEnabled() } : {}),
        ...(free && explicitWeb ? { webSearch: true } : {}),
        ...(free && explicitImage ? { imageMode: true, imageAspect: mobileImageAspect } : {}),
        ...(free && activeAgentPairId ? { pairId: activeAgentPairId } : {}),
        ...(gb && payBots ? { pay: "credits" } : {}),
      }),
    };
    const MAX_NET_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_NET_RETRIES; attempt++) {
      try {
        const res = await fetch(endpoint, reqInit);
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          const code = j.error && j.error.code;
          if (res.status >= 502 && res.status <= 504 && attempt < MAX_NET_RETRIES && !acc) {
            setPendingStatus("Yeniden bağlanıyor…");
            await sleepAbortable(600 * (attempt + 1));
            if (controller?.signal?.aborted) return;
            continue;
          }
          // Past the free quota a signed-in user may go on with a gallery bot for credits.
          if (code === "free_limit" && gb && token() && !payBots
              && confirm("Bugünkü ücretsiz mesajların bitti. Bu botla mesaj başı 1 krediyle devam edilsin mi?")) { payBots = true; retry = turnRetry; return; }
          if (["consent_required", "hard_floor", "provider_budget", "uncensored_closed"].includes(code)) {
            addNote(tx(j.error?.message || FREE_ERRORS[code]), true); return;
          }
          if (FREE_ERRORS[code]) { addNote(FREE_ERRORS[code], true, ["upstream", "free_busy", "slow_down"].includes(code) ? turnRetry : null); return; }
          throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${res.status}`);
        }
        servedBy = res.headers.get("x-nakata-served-by") || "";
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
        let retryStream = false;
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const raw = buf.slice(0, i); buf = buf.slice(i + 1);
            const line = raw.trim(); if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
            let ev; try { ev = JSON.parse(payload); } catch { continue; }
            if (ev.error) {
              if (ev.error.code === "stream_interrupted" && !acc && !msgImageTask && !msgAction && attempt < MAX_NET_RETRIES) {
                retryStream = true;
                break;
              }
              addNote("Hata: " + (ev.error.message || ev.error), true, turnRetry);
              continue;
            }
            const d = (ev.choices && ev.choices[0] && ev.choices[0].delta) || {};
            const tc = ev.type === "tool_call" ? { name: ev.tool, args: ev.args } : d.tool_call;
            if (tc?.name) {
              if (!pendingRow) showPending(text);
              if (tc.name === "web_search") {
                const rawQ = String(tc.args?.query || "").trim();
                if (rawQ && !msgQueries.includes(rawQ)) msgQueries.push(rawQ);
                const qHint = rawQ.slice(0, 38);
                const lbl = qHint
                  ? (pendingConvTr ? `Web'de aranıyor: "${qHint}"…` : `Searching: "${qHint}"…`)
                  : (pendingConvTr ? "Web'de aranıyor…" : "Searching the web…");
                if (msgSources.length) updatePendingSearch(msgSources, lbl);
                else setPendingStatus(lbl);
              } else if (tc.name === "fetch_url") {
                let host = "";
                try { host = new URL(tc.args?.url || "").hostname.replace(/^www\./, ""); } catch {}
                const lbl = host
                  ? (pendingConvTr ? `${host} inceleniyor…` : `Reading ${host}…`)
                  : (pendingConvTr ? "Sayfa okunuyor…" : "Reading page…");
                if (msgSources.length) updatePendingSearch(msgSources, lbl);
                else setPendingStatus(lbl);
              }
              else if (tc.name === "get_weather") setPendingStatus("Hava durumu alınıyor…");
              else if (tc.name === "generate_image") setPendingStatus("Görsel hazırlanıyor…");
              else if (tc.name === "dispatch_mac_task") setPendingStatus("Mac’e görev gönderiliyor…");
              else if (tc.name === "check_mac_task") setPendingStatus("Mac görevi kontrol ediliyor…");
              else setPendingStatus("Araç çalıştırılıyor…");
              pendingOrb?.set(tc.name === "generate_image" ? "excited" : "curious");
              window.__mascotReact?.onTool?.(tc.name, tc.args);
            }
            const qRes = ev.type === "tool_result" ? ev.query : d.query;
            if (typeof qRes === "string" && qRes.trim() && !msgQueries.includes(qRes.trim())) msgQueries.push(qRes.trim());
            const srcs = ev.type === "tool_result" ? ev.sources : d.sources;
            if (Array.isArray(srcs)) {
              for (const s of srcs) {
                if (s?.url && !seenSrc.has(s.url)) {
                  seenSrc.add(s.url);
                  const snippet = String(s.snippet || s.excerpt || s.content || "").replace(/\s+/g, " ").trim().slice(0, 220);
                  msgSources.push({ title: String(s.title || s.url), url: String(s.url), ...(snippet ? { snippet } : {}), ...(s.type ? { type: s.type } : {}) });
                }
              }
              if (msgSources.length) updatePendingSearch(msgSources, "");
            }
            const imgs = ev.type === "tool_result" ? ev.images : d.images;
            if (Array.isArray(imgs)) {
              for (const im of imgs) {
                const u = String(im?.url || "");
                if (/^https:\/\//i.test(u) && !seenImg.has(u)) { seenImg.add(u); msgImages.push({ title: String(im.title || ""), url: u }); }
              }
            }
            const act = ev.type === "tool_result" ? ev.action : d.action;
            if (act && typeof act === "object") msgAction = act;
            const itk = ev.type === "tool_result" ? ev.imageTask : d.imageTask;
            if (itk && typeof itk === "object") msgImageTask = itk;
            const dtk = ev.type === "tool_result" ? ev.dispatchedTask : d.dispatchedTask;
            if (dtk?.id && activeAgentPairId) {
              agentTaskAccount = agentAcct();
              agentTaskPair = activeAgentPairId;
              agentPendingIds.add(dtk.id);
              void refreshAgentTasks();
            }
            if (!free && d.reasoning) { if (!reasonNode) { reasonNode = el("div", "reason"); put(reasonNode); } reasonNode.textContent += d.reasoning; scrollDown(); }
            if (d.content) { if (!bubble) bubble = addAsst(); if (pendingRow) hidePending(); acc += d.content; if (!frame) frame = requestAnimationFrame(paintStep); }
          }
          if (retryStream) break;
        }
        if (retryStream) {
          reader.cancel().catch(() => {});
          setPendingStatus("Yeniden bağlanıyor…");
          await sleepAbortable(600 * (attempt + 1));
          if (controller?.signal?.aborted) return;
          continue;
        }
        lastErr = null;
        break;
      } catch (e) {
        if (e.name === "AbortError" || controller?.signal?.aborted) throw e;
        if (attempt < MAX_NET_RETRIES && !acc && !msgImageTask && !msgAction && isTransientNetErr(e)) {
          setPendingStatus("Yeniden bağlanıyor…");
          await sleepAbortable(600 * (attempt + 1));
          if (controller?.signal?.aborted) return;
          continue;
        }
        lastErr = e;
        streamFailed = true;
        break;
      }
    }
    flushPaint();
    if (streamFailed && lastErr) {
      if (acc) {
        if (bubble) bubble.innerHTML = md(cleanCitations(acc));
        addNote(tx("Bağlantı kesildi. Yanıt yarım kalmış olabilir."), true, turnRetry);
        window.__mascotReact?.onReply?.({ error: true });
        return;
      }
      throw lastErr;
    }
    if (!acc && !reasonNode && !msgImageTask && !msgAction) addNote("Boş yanıt geldi. Modeli ve anahtarı kontrol et.", true, turnRetry);
    if (!acc && (msgImageTask || msgAction)) { if (!bubble) bubble = addAsst(); acc = " "; }
    if (acc) {
      acc = cleanCitations(acc);
      if (travelResearch) acc = window.NakataTravelResearch.enrich(acc, travelResearch);
      const wantsPic = !travelResearch && msgImages.length && !/!\[[^\]]*\]\(https:\/\//.test(acc) && (window.NakataTravelResearch?.wantsImages?.(text) || /fotoğraf|görsel|resim|nerede|nasıl görün|göster|photo|image|picture|show me/i.test(text));
      if (wantsPic) {
        const pics = msgImages.slice(0, 2).map((im) => `![${String(im.title || "").replace(/[[\]\n\r]/g, "")}](${im.url})`).join("\n\n");
        if (pics) acc += "\n\n" + pics;
      }
      if (bubble) bubble.innerHTML = md(acc);
      if (bubble && msgSources.length) hydrateInlineCitations(bubble, msgSources);
      const row = bubble?.parentElement?.parentElement;
      if (msgSources.length && !travelAssistant) renderSources(row, msgSources, msgQueries);
      scrollDown();
      window.__mascotReact?.onReply?.({
        text: acc,
        hasArt: !!row?.querySelector(".art"),
        hasImage: !!msgImageTask || !!row?.querySelector(".md-chat-image"),
        hasCode: /```[a-z]/i.test(acc),
      });
    }
  } catch (e) {
    flushPaint();
    if (e.name !== "AbortError") {
      const msgText = isTransientNetErr(e) ? tx("Bağlantı kesildi. Tekrar dene.") : ("Bağlantı: " + e.message);
      addNote(msgText, true, turnRetry);
      window.__mascotReact?.onReply?.({ error: true });
    }
  } finally {
    hidePending();
    let msg = null;
    if (acc) {
      msg = { role: "assistant", content: acc };
      if (msgSources.length) msg.sources = msgSources;
      if (msgQueries.length) msg.searchQueries = msgQueries.slice(0, 6);
      if (servedBy) msg.servedBy = servedBy;
      let cta = null;
      if (msgAction?.type === "image_membership") cta = msgAction;
      else if (!msgImageTask && (explicitImage || IMG_INTENT_RE.test(text || ""))) {
        if (!token()) cta = { reason: "auth_required" };
        else if (typeof account?.credits === "number" && account.credits < (modelCost() || 20)) cta = { reason: "insufficient_credits", cost: modelCost() || 20 };
        else cta = { reason: "ready" };
      }
      if (cta) msg.cta = cta;
      convo.push(msg);
    } else convo.pop(); // a failed turn does not keep the user message
    persist();
    controller = null; setBusy(false);
    if (acc) {
      const rows = document.querySelectorAll("#thread .row:not(.user)");
      const lastRow = rows[rows.length - 1];
      if (msg?.cta) renderChatCta(lastRow, msg.cta);
      if (msgImageTask) void runChatImageTask(lastRow, msgImageTask, msg);
      markLastReply();
    }
    if (acc && gb && payBots) refreshAccount();
    // agreed to pay: send the same message again (its first bubble goes, the retry adds it back)
    if (retry) { const rows = $("#thread").querySelectorAll(".row.user"); rows[rows.length - 1]?.remove(); send(retry.text, { images: retry.images || [], files: retry.files || [] }); }
  }
}

let mobileWebModeOn = false;
let mobileImageModeOn = false;
const MOBILE_IMAGE_ASPECTS = ["3:4", "1:1", "16:9", "9:16"];
let mobileImageAspect = "3:4";
function syncMobileComposerModes(){
  const webC = $("#webChip"), imgC = $("#imgChip");
  const bar = $("#composerModes"), webPill = $("#webModeChip"), imgPill = $("#imgModeChip");
  const aspectBtn = $("#imgAspectBtn"), box = $("#prompt");
  if (webC) webC.setAttribute("aria-pressed", mobileWebModeOn ? "true" : "false");
  if (imgC) imgC.setAttribute("aria-pressed", mobileImageModeOn ? "true" : "false");
  if (aspectBtn) aspectBtn.textContent = mobileImageAspect;
  if ($("#webModeLbl")) $("#webModeLbl").textContent = LANG === "en" ? "Web search" : "Web araması";
  if ($("#imgModeLbl")) $("#imgModeLbl").textContent = LANG === "en" ? "Create image" : "Görsel üretimi";
  if (webPill) webPill.hidden = !mobileWebModeOn;
  if (imgPill) imgPill.hidden = !mobileImageModeOn;
  if (bar) bar.hidden = !mobileWebModeOn && !mobileImageModeOn;
  if (box) {
    if (mobileImageModeOn || mobileWebModeOn) {
      if (!box.dataset.basePh) box.dataset.basePh = box.placeholder || "";
      box.placeholder = mobileImageModeOn
        ? (LANG === "en" ? `Describe the image to create (${mobileImageAspect})…` : `Oluşturmak istediğin görseli tarif et (${mobileImageAspect})…`)
        : (LANG === "en" ? "Search the web…" : "Web'de ara ve sor…");
    } else if (box.dataset.basePh != null) {
      box.placeholder = box.dataset.basePh;
      delete box.dataset.basePh;
    }
  }
}
$("#webChip")?.addEventListener("click", () => {
  mobileWebModeOn = !mobileWebModeOn;
  syncMobileComposerModes();
  haptic();
});
$("#imgChip")?.addEventListener("click", () => {
  mobileImageModeOn = !mobileImageModeOn;
  syncMobileComposerModes();
  haptic();
});
$("#imgAspectBtn")?.addEventListener("click", () => {
  const idx = MOBILE_IMAGE_ASPECTS.indexOf(mobileImageAspect);
  mobileImageAspect = MOBILE_IMAGE_ASPECTS[(idx + 1) % MOBILE_IMAGE_ASPECTS.length];
  syncMobileComposerModes();
  haptic();
});
$("#webModeOff")?.addEventListener("click", () => { mobileWebModeOn = false; syncMobileComposerModes(); haptic(); });
$("#imgModeOff")?.addEventListener("click", () => { mobileImageModeOn = false; syncMobileComposerModes(); haptic(); });
function syncMobileSlashMenu(){
  const menu = $("#slashMenu"); if (!menu) return;
  const val = $("#prompt")?.value || "";
  if (!/^\/[a-zA-Zçğıöşü]*$/.test(val)) { menu.hidden = true; return; }
  const q = val.toLowerCase();
  const cmds = [
    { cmd: "/web", desc: LANG === "en" ? "Search the live web" : "Canlı web araması" },
    { cmd: LANG === "en" ? "/image" : "/gorsel", desc: LANG === "en" ? "Enable image generation" : "Görsel üretim modu" },
    { cmd: LANG === "en" ? "/table" : "/tablo", desc: LANG === "en" ? "Comparison table" : "Karşılaştırma tablosu" },
  ].filter((c) => c.cmd.toLowerCase().startsWith(q));
  if (!cmds.length) { menu.hidden = true; return; }
  menu.replaceChildren();
  for (const c of cmds) {
    const b = el("button", "slash-item"); b.type = "button"; b.dataset.slashCmd = c.cmd; b.dataset.noI18n = "1";
    b.append(el("code", "", c.cmd), el("span", "", c.desc));
    b.addEventListener("click", () => {
      const box = $("#prompt");
      if (c.cmd === "/web") { if (!mobileWebModeOn) { mobileWebModeOn = true; syncMobileComposerModes(); } box.value = ""; }
      else if (c.cmd === "/gorsel" || c.cmd === "/image") { if (!mobileImageModeOn) { mobileImageModeOn = true; syncMobileComposerModes(); } box.value = ""; }
      else { box.value = LANG === "en" ? "Build a comparison table for: " : "Karşılaştırma tablosu hazırla: "; }
      menu.hidden = true; grow(); updateSendBtn(); box.focus(); haptic();
    });
    menu.append(b);
  }
  menu.hidden = false;
}
$("#prompt")?.addEventListener("input", syncMobileSlashMenu);
function exportMobileConvoMarkdown(){
  if (!convo.length) return;
  const title = (convo.find((m) => m.role === "user")?.content || "Nakata Chat").split("\n")[0].slice(0, 60);
  const parts = ["# " + title];
  for (const m of convo) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const body = String(m.content || "").trim();
    const srcs = Array.isArray(m.sources) ? m.sources.filter((s) => s?.url) : [];
    if (!body && !srcs.length) continue;
    let sec = `## ${m.role === "user" ? (LANG === "en" ? "You" : "Sen") : "Nakata"}\n\n${body}`;
    if (srcs.length) sec += `\n\n### ${LANG === "en" ? "Sources" : "Kaynaklar"}\n` + srcs.map((s) => `- [${String(s.title || s.url).replace(/[\[\]]/g, "")}](${s.url})`).join("\n");
    parts.push(sec.trim());
  }
  const mdText = parts.join("\n\n---\n\n") + "\n";
  const slug = slugifyFilename(title, "nakata-chat", 44);
  triggerBlobDownload(mdText, "text/markdown;charset=utf-8", slug + ".md");
}
const mobileCitePopover = el("div", "cite-popover");
mobileCitePopover.id = "citePopover"; mobileCitePopover.setAttribute("role", "tooltip"); mobileCitePopover.hidden = true;
document.body.append(mobileCitePopover);
function hideMobileCitePop(){ mobileCitePopover.hidden = true; }
function showMobileCitePop(anchor){
  const host = anchor?.dataset?.citeHost || "", title = anchor?.dataset?.citeTitle || host, snippet = anchor?.dataset?.citeSnippet || "", idx = anchor?.dataset?.citeIndex || "";
  if (!host && !title) return;
  const m = srcMonogram(host);
  mobileCitePopover.replaceChildren();
  const top = el("div", "cite-popover-top");
  const mono = el("i", "src-mono", m.ch); mono.style.background = m.bg; mono.setAttribute("aria-hidden", "true");
  top.append(mono, el("span", "", (idx ? `[${idx}] ` : "") + host));
  mobileCitePopover.append(top, el("div", "cite-popover-title", title));
  if (snippet) mobileCitePopover.append(el("div", "cite-popover-snippet", snippet));
  mobileCitePopover.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = mobileCitePopover.offsetWidth || 280, ph = mobileCitePopover.offsetHeight || 86;
  mobileCitePopover.style.left = Math.round(Math.max(12, Math.min(window.innerWidth - pw - 12, r.left))) + "px";
  mobileCitePopover.style.top = Math.round(r.top > ph + 16 ? (r.top - ph - 8) : (r.bottom + 8)) + "px";
}
$("#thread")?.addEventListener("mouseover", (e) => { const p = e.target.closest?.("a.cite-pill"); if (p) showMobileCitePop(p); });
$("#thread")?.addEventListener("mouseout", (e) => { const p = e.target.closest?.("a.cite-pill"); if (p && !p.contains(e.relatedTarget)) hideMobileCitePop(); });
$("#chatScroll")?.addEventListener("scroll", hideMobileCitePop, { passive: true });
$("#attachBtn").addEventListener("click", () => $("#chatFile").click());
$("#chatFile").addEventListener("change", async (e) => {
  const picked = Array.from(e.target.files || []);
  e.target.value = "";
  for (const file of picked) {
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name)) {
      if (pendingAttachments.filter((x) => x.kind === "image").length >= 2) { addNote(tx("En fazla 2 görsel eklenebilir."), true); break; }
      try { const dataUrl = await resizeChatImage(file); pendingAttachments.push({ kind: "image", name: file.name, dataUrl }); }
      catch { addNote(tx("Görsel yüklenemedi."), true); }
    } else if (file.size <= 512000) {
      try { const raw = (await file.text()).slice(0, 24000); pendingAttachments.push({ kind: "file", name: file.name, size: file.size || raw.length, text: raw }); }
      catch { addNote(tx("Dosya okunamadı."), true); }
    }
  }
  renderAttachBar(); updateSendBtn();
});
function handleMobileRuleCommand(kind, rawArg){
  showHero(false);
  if (galleryBot) { addNote(tx("Galeri botları düzenlenemez; önce kendi botuna kaydet veya yeni bot oluştur.")); return; }
  let targetName = activeBot;
  let arg = String(rawArg || "").trim();
  const tagged = arg.match(/^@([\p{L}\p{N}_-]{1,40})\s+([\s\S]+)$/u);
  if (tagged) {
    const resolved = findLocalOrTemplateBotName(tagged[1]);
    if (!resolved) { addNote(`${tx("Bot bulunamadı")}: @${tagged[1]}`); return; }
    if (!allBots()[resolved]) ensureEditableBot(resolved);
    targetName = resolved; activeBot = resolved; setModelLabel();
    arg = tagged[2].trim();
  }
  if (!targetName) {
    addNote(kind === "teach" ? tx("Kural eklemek için önce bir bot seçin ya da `/teach @BotAdı kural` yazın.") : tx("Kural silmek için önce bir bot seçin ya da `/forget @BotAdı kural` yazın."));
    return;
  }
  if (kind === "teach") {
    const r = teachMobileBot(targetName, arg);
    addNote(r.ok ? (r.added ? `✓ ${r.key} yeni kural öğrendi: ${r.text}` : `${r.key} bu kuralı zaten biliyor.`) : r.error, !r.ok);
  } else {
    const r = forgetMobileBotLesson(targetName, arg);
    addNote(r.ok ? `✓ ${r.key} kuralı unuttu: ${r.forgotten}` : r.error, !r.ok);
  }
}
async function submitMobilePrompt(rawText, opts = {}){
  let text = String(rawText || "");
  if (text && !galleryBot) {
    const mention = text.match(/^@([\p{L}\p{N}_-]{1,40})\s+([\s\S]+)$/u);
    if (mention) {
      const resolved = findLocalOrTemplateBotName(mention[1]);
      if (resolved) {
        if (!allBots()[resolved]) ensureEditableBot(resolved);
        activeBot = resolved; setModelLabel(); text = mention[2].trim();
      }
    }
    const teach = text.match(/^\/(teach|öğret|ogret)\s+([\s\S]+)$/i);
    if (teach) { handleMobileRuleCommand("teach", teach[2]); return; }
    const forget = text.match(/^\/(forget|unut)\s+([\s\S]+)$/i);
    if (forget) { handleMobileRuleCommand("forget", forget[2]); return; }
  }
  await send(text, opts);
}
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (controller) { controller.abort(); return; }
  const text = $("#prompt").value.trim();
  const imgs = pendingAttachments.filter((x) => x.kind === "image").map((x) => x.dataUrl);
  const docFiles = pendingAttachments.filter((x) => x.kind === "file").map(({ name, size, text: ft }) => ({ name, size, text: ft }));
  if (!text && !imgs.length && !docFiles.length) return;
  $("#prompt").value = ""; pendingAttachments = []; renderAttachBar(); grow(); setBusy(false);
  void submitMobilePrompt(text, { images: imgs, files: docFiles });
});
function grow(){ const t = $("#prompt"); t.style.height = "auto"; t.style.height = `${Math.min(Math.max(t.scrollHeight, 26), 150)}px`; }
$("#prompt").addEventListener("input", () => { grow(); updateSendBtn(); });
$("#prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); } });
