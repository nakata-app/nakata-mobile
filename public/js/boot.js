/* ---- boot ---- */
(async () => {
  await loadCfg();                                                  // the key comes from the Keychain, so read it first
  await loadCustomVoices();
  const isTouch = matchMedia("(pointer:coarse)").matches;
  let fitH = null;
  if (window.visualViewport) {
    fitH = () => {
      const h = Math.round(window.visualViewport.height);
      if (h > 120) document.body.style.height = h + "px";
      if (isTouch) window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener("resize", fitH);
    window.visualViewport.addEventListener("scroll", fitH);
    window.addEventListener("orientationchange", fitH);
    fitH();
    if (isTouch) {
      $("#prompt").addEventListener("focus", () => { setTimeout(fitH, 60); setTimeout(fitH, 350); setTimeout(scrollDown, 120); });
    }
  }
  try {
    NATIVE.Keyboard?.setAccessoryBarVisible({ isVisible: false });   // no web-style "< > Done" bar
    NATIVE.Keyboard?.addListener("keyboardDidShow", () => { fitH?.(); scrollDown(); });
  } catch {}
  $("#st-lang").value = LANG; $("#st-theme").value = LS.get("nakata_theme", "dark");
  paintVoiceControls();
  paintCustomVoicesUI();
  api("/voice/status").then((st) => {
    if (st.ok && Array.isArray(st.j?.voices) && st.j.voices.length) {
      voiceCatalog = st.j.voices;
      if (st.j.defaultVoice) defaultVoiceId = st.j.defaultVoice;
      paintVoiceControls();
      paintCustomVoicesUI();
    }
  }).catch(() => {});
  setModelLabel();
  renderSessions();
  grow();
  paintAccount();
  i18nApply();
  if (token()) { refreshAccount(); syncChatCloud().catch(() => {}); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (token()) { refreshAccount(); syncChatCloud().catch(() => {}); } void refreshAgentTasks(); } });
  window.addEventListener("focus", () => { if (token()) { refreshAccount(); syncChatCloud().catch(() => {}); } });
  paintModelChip(); loadModels().then(paintModelChip);
  loadCats();
  if (!LS.get("nakata_welcomed", false)) showWelcome();
  // No first-run settings: the free model works without a key.
  // A shared bot link (…?bot=<id>) opens that bot's card.
  try { const shared = new URLSearchParams(location.search).get("bot"); if (shared) openBotDetail(shared); } catch {}
})();
