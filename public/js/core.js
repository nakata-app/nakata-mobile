/* ---- core DOM, theme, Capacitor native shell & navigation ---- */
const $ = (s) => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
// The desktop mascot (bot-orb.js): Nakata is the blue orb, each bot its own colour.
const NAKATA_ORB_COLOR = "#5b8cff";
const BOT_COLORS = ["#d97757", "#38bdf8", "#a78bfa", "#34d399", "#f472b6", "#fbbf24"];
const botColor = (name) => BOT_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % BOT_COLORS.length];
const orbColor = () => (galleryBot ? (galleryBot.mascot?.color || NAKATA_ORB_COLOR) : activeBot ? botColor(activeBot) : NAKATA_ORB_COLOR);
const orb = (opts) => { const o = createOrb(opts); o.el._orb = o; return o; };
const ICON_COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_EDIT = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_X = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const SEND_UP = '<path d="M12 19V5M5 12l7-7 7 7"/>';
const SEND_STOP = '<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>';

/* ---- native shell (Capacitor plugins; every call is a no-op in a browser) ---- */
const NATIVE = (window.Capacitor && window.Capacitor.Plugins) || {};
const haptic = (style = "LIGHT") => { try { NATIVE.Haptics?.impact({ style }); } catch {} };
const hapticError = () => { try { NATIVE.Haptics?.notification({ type: "ERROR" }); } catch {} };
// Links open in the in-app Safari sheet instead of navigating the app away.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href^='http']"); if (!a || !NATIVE.Browser) return;
  e.preventDefault(); NATIVE.Browser.open({ url: a.href, presentationStyle: "popover" });
});
const ICON_PLUS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

/* ---- storage (device-only) ---- */
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem(k); }catch{} },
};
function deviceId(){ let d = LS.get("nakata_device", ""); if (!d) { d = crypto.randomUUID(); LS.set("nakata_device", d); } return d; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function showErr(id, msg){ const n = $(id); n.textContent = msg || ""; n.hidden = !msg; }

function copyWithFeedback(text, btn, resetLabel, labelEl = btn, onCopied = null){
  if (!btn) return Promise.resolve(false);
  return navigator.clipboard.writeText(String(text || "")).then(() => {
    haptic();
    if (onCopied) onCopied();
    if (labelEl) labelEl.textContent = tx("Kopyalandı");
    setTimeout(() => { if (labelEl) labelEl.textContent = resetLabel; }, 1400);
    return true;
  }).catch(() => false);
}
function triggerBlobDownload(contentOrParts, mimeType, filename, revokeMs = 10000){
  const blob = contentOrParts instanceof Blob ? contentOrParts : new Blob(Array.isArray(contentOrParts) ? contentOrParts : [contentOrParts], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeMs);
}
function slugifyFilename(raw, fallback = "nakata", maxLen = 40){
  return String(raw || fallback)
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i").replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLen) || fallback;
}

const THEMES = { dark: "#151515", light: "#faf9f5", grey: "#262624" };
function applyTheme(t){
  const theme = THEMES[t] ? t : "dark";
  document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme]);
  LS.set("nakata_theme", theme);
}
applyTheme(LS.get("nakata_theme", "dark"));

const PLANS_URL = "https://nakata.app/plans?from=ios";
function openExternalUrl(url){
  if (NATIVE.Browser) { NATIVE.Browser.open({ url, presentationStyle: "popover" }); return; }
  window.open(url, "_blank", "noopener");
}
function openPlansPage(){ openExternalUrl(PLANS_URL); }

/* ---- drawer, sheet, pages ---- */
function openDrawer(){ renderSessions($("#search").value); $("#drawer").classList.add("on"); $("#scrim").classList.add("on"); }
function closeDrawer(){ $("#drawer").classList.remove("on"); if (!document.querySelector(".sheet.on")) { $("#scrim").style.zIndex = ""; $("#scrim").classList.remove("on"); } }
function closeSheet(){ for (const sh of document.querySelectorAll(".sheet.on")) { sh.classList.remove("on"); sh.style.zIndex = ""; } $("#scrim").style.zIndex = ""; if (!$("#drawer").classList.contains("on")) $("#scrim").classList.remove("on"); }
$("#menuBtn").addEventListener("click", openDrawer);
$("#scrim").addEventListener("click", () => { $("#drawer").classList.remove("on"); closeSheet(); });
for (const b of document.querySelectorAll(".fclose")) b.addEventListener("click", () => b.closest(".page").classList.remove("on"));
// Pages stack: the one opened last is drawn on top (they share one z-index otherwise
// and DOM order decided, so Account opened from Images hid underneath it).
let pageZ = 70;
function showPage(sel){ const pg = $(sel); pg.style.zIndex = String(++pageZ); pg.classList.add("on"); }
function topPage(){ let top = null; for (const pg of document.querySelectorAll(".page.on")) if (!top || Number(pg.style.zIndex || 70) >= Number(top.style.zIndex || 70)) top = pg; return top; }

/* ---- swipes: left edge opens the menu, a drag closes it, left edge closes a page,
        the bot sheet drags down to close ---- */
const EDGE = 28;
let drag = null, swallowClick = false;
document.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return;
  const drawer = $("#drawer"), page = topPage();
  let kind = null;
  const sheet = document.querySelector(".sheet.on");
  if (sheet) { const list = e.target.closest(".sheet-list"); if (e.target.closest(".sheet") === sheet && !(list && list.scrollTop > 0) && !e.target.closest("input")) kind = "sheet"; }
  else if (page) { if (e.clientX <= EDGE) kind = "page"; }
  else if (drawer.classList.contains("on")) { if (e.target.closest("#drawer,#scrim")) kind = "close"; }
  else if (e.clientX <= EDGE) kind = "open";
  if (kind) drag = { kind, el: kind === "page" ? page : kind === "sheet" ? sheet : drawer, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, live: false, id: e.pointerId };
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.live) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    const vertical = Math.abs(dy) > Math.abs(dx);
    if (drag.kind === "sheet" ? !vertical || dy < 0 : vertical) { drag = null; return; }   // a scroll, not this swipe
    drag.live = true; drag.w = drag.el.offsetWidth; drag.el.style.transition = "none";
    if (drag.kind === "open") { renderSessions($("#search").value); $("#scrim").classList.add("on"); }
  }
  drag.dx = dx; drag.dy = dy;
  if (drag.kind === "sheet") { drag.el.style.transform = `translateY(${Math.max(0, dy)}px)`; return; }
  const x = drag.kind === "page" ? Math.max(0, dx) : drag.kind === "open" ? Math.min(0, Math.max(0, dx) - drag.w) : Math.min(0, dx);
  drag.el.style.transform = `translateX(${x}px)`;
});
function endDrag(e){
  if (!drag || e.pointerId !== drag.id) return;
  const { kind, el, dx, dy, live } = drag; drag = null;
  if (!live) return;
  // The finger lifting after a swipe must not also tap whatever is under it.
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
  el.style.transition = ""; el.style.transform = "";
  const far = Math.abs(dx) > 70;
  if (kind === "sheet") { if (dy > 70) { closeSheet(); haptic(); } }
  else if (kind === "page") { if (far && dx > 0) { if (el.id === "f-voice") minimizeVoice(); else el.classList.remove("on"); haptic(); } }
  else if (kind === "open") { if (far && dx > 0) { openDrawer(); haptic(); } else closeDrawer(); }
  else if (far && dx < 0) closeDrawer();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#f-voice")?.classList.contains("on") && !document.querySelector(".sheet.on")) {
    minimizeVoice();
  }
});
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener("click", (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
