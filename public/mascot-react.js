// Nakata mobile: lively mascot reactions across user messages, tool runs, and rich replies.
// Loaded after the main script: uses its globals (orb, orbColor, galleryBot,
// haptic, $). Everything here is decoration; any failure is swallowed.
(() => {
  "use strict";
  const SHOW_MS = 2800;      // how long the mascot stays
  const COOLDOWN_MS = 4500;  // responsive across turns without spamming

  // Tone → orb face + a small badge (the badge is what an image mascot shows).
  // Order matters: frustration before praise ("hiç harika değil"), laughs before thanks.
  const TONES = [
    { id: "upset", face: "sad", badge: "🫶",
      re: /(saçma|berbat|rezalet|olmadı|olmuyor|çalışmıyor|yanlış|hatalı|aptal|salak|sinir|bıktım|nefret|useless|terrible|wrong|doesn'?t work|not working|stupid|\bwtf\b|annoying|\bhate\b)|[😡🤬😤👎]/iu },
    { id: "sad", face: "sad", badge: "🤍",
      re: /(üzgün|üzüldüm|moralim|kötü hissed|ağla|yalnızım|\bsad\b|depressed|lonely|crying)|[😢😭😞💔]/iu },
    { id: "laugh", face: "wink", badge: "😄",
      re: /(haha|hehe|ahah|jsjs|asdf|kahkaha|komik|\blol\b|\blmao\b|\brofl\b|funny)|[😂🤣😆😹]/iu },
    { id: "wow", face: "surprised", badge: "✨",
      re: /(vay|inanılmaz|şaşırdım|\boha\b|hayret|\bwow\b|whoa|\bomg\b|no way|unbelievable)|[😮😲😱🤯]/iu },
    { id: "celebrate", face: "excited", badge: "🎉",
      re: /(başardım|çalıştı|yayınladım|yaptım|kazandım|tamamdır|\bshipped\b|\bdeployed\b|\bfixed\b|\bnailed\b)|[🎉🥳🏆🚀]/iu },
    { id: "love", face: "excited", badge: "🩷",
      re: /(tatlı|seviyorum|canım|bayıldım|\bcute\b|\badorable\b|\blove you\b|\bbestie\b)|[🥰🥹🩷💖]/iu },
    { id: "praise", face: "excited", badge: "🔥",
      re: /(harika|süper|mükemmel|muhteşem|efsane|çok iyi|aferin|bravo|helal|great|awesome|amazing|perfect|brilliant|excellent|love it)|[👏🔥🤩💯🙌]/iu },
    { id: "thanks", face: "happy", badge: "❤️",
      re: /(teşekkür|tesekkur|sağ ?ol|sagol|eyvallah|minnettar|thanks|thank you|\bthx\b|(?:^|\s)ty\b|appreciate)|[🙏❤♥😊🫶]/iu },
    { id: "greeting", face: "happy", badge: "👋",
      re: /(^(?:merhaba|selam|slm|günaydın|iyi akşamlar|iyi geceler|naber|nasılsın|hello|hey|hi)\b)|[👋]/iu },
    { id: "code", face: "curious", badge: "💻",
      re: /(hata|debug|\bbug\b|\bscript\b|\bpython\b|\bswift\b|\btypescript\b|\breact\b|\bsql\b|\bdocker\b|\bkod\b|\bapi\b|terminal)/iu },
    { id: "idea", face: "curious", badge: "💡",
      re: /(fikir|nasıl|neden|tasarla|strateji|brainstorm|anlat|öğret|özetle|karşılaştır|\bexplain\b|\bcompare\b|\bhow\b|\bwhy\b)|[💡🤔]/iu },
  ];

  function toneOf(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 1400) return null;
    const sample = t.length > 480 ? (t.slice(0, 240) + " " + t.slice(-240)) : t;
    for (const tone of TONES) if (tone.re.test(sample)) return tone;
    return null;
  }

  const reduce = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

  const css = document.createElement("style");
  css.textContent = `
.mr-pop{position:fixed;right:max(14px, env(safe-area-inset-right));bottom:calc(env(safe-area-inset-bottom) + 96px);z-index:2147483000;
  pointer-events:auto;cursor:pointer;display:flex;align-items:flex-end;gap:2px;opacity:0;transform:translateY(24px) scale(.6);
  transition:opacity .22s ease, transform .34s cubic-bezier(.2,1.5,.4,1)}
.mr-pop.in{opacity:1;transform:none}
.mr-pop.out{opacity:0;transform:translateY(12px) scale(.85);transition:opacity .25s ease, transform .25s ease}
.mr-pop .mr-face{width:76px;height:76px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}
.mr-pop .mr-face img{width:76px;height:76px;border-radius:50%;object-fit:cover}
.mr-pop[data-tone="wow"].in .mr-face,.mr-pop[data-tone="celebrate"].in .mr-face{animation:mr-bounce .75s cubic-bezier(.25,1.6,.45,1)}
.mr-pop .mr-badge{font-size:22px;line-height:1;margin:0 0 54px -14px;transform:rotate(-8deg);animation:mr-bob .9s ease-in-out infinite alternate;user-select:none}
@keyframes mr-bob{to{transform:translateY(-5px) rotate(6deg)}}
@keyframes mr-bounce{0%{transform:scale(.75)}45%{transform:scale(1.12) translateY(-6px)}100%{transform:none}}
@media (prefers-reduced-motion: reduce){.mr-pop,.mr-pop.in,.mr-pop.out{transition:opacity .2s linear;transform:none}.mr-pop .mr-badge,.mr-pop .mr-face{animation:none}}`;
  document.head.append(css);

  let last = -Infinity, live = null, hideTimer = null, removeTimer = null, holdUserUntil = 0;

  function clearLive() {
    clearTimeout(hideTimer); clearTimeout(removeTimer);
    if (!live) return;
    try { live._destroy?.(); live.remove(); } catch {}
    live = null;
  }

  function face(tone) {
    const box = document.createElement("div");
    box.className = "mr-face";
    const m = typeof galleryBot !== "undefined" && galleryBot ? galleryBot.mascot : null;
    if (m && m.url) { // generated image mascot: the badge carries the reaction
      const img = document.createElement("img");
      img.src = m.thumb || m.url; img.alt = "";
      box.append(img);
      return { box, set() {}, destroy() {} };
    }
    const o = orb({ size: 76, color: typeof orbColor === "function" ? orbColor() : "#5b8cff", expression: "neutral" });
    box.append(o.el);
    requestAnimationFrame(() => o.set(tone.face));
    return { box, set(f) { try { o.set(f); } catch {} }, destroy() { try { o.destroy && o.destroy(); } catch {} } };
  }

  function scheduleOut(node, f, ms = SHOW_MS) {
    clearTimeout(hideTimer); clearTimeout(removeTimer);
    hideTimer = setTimeout(() => {
      node.classList.add("out");
      removeTimer = setTimeout(() => {
        f.destroy(); node.remove();
        if (live === node) live = null;
      }, reduce() ? 220 : 280);
    }, ms);
  }

  /** Show the mascot for a tone. force skips the cooldown and replaces any live pop. */
  function pop(tone, { force = false, ms = SHOW_MS } = {}) {
    try {
      const now = Date.now();
      if (!tone || document.hidden) return false;
      if (!force && (now - last < COOLDOWN_MS || live)) return false;
      if (live) clearLive();
      last = now;
      const f = face(tone);
      const node = document.createElement("div");
      node.className = "mr-pop"; node.setAttribute("aria-hidden", "true"); node.dataset.tone = tone.id;
      const badge = document.createElement("span"); badge.className = "mr-badge"; badge.textContent = tone.badge;
      node.append(f.box, badge);
      node._destroy = f.destroy;
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        try { haptic("MEDIUM"); } catch {}
        f.set(node.dataset.tone === "wow" ? "excited" : "wink");
        badge.textContent = node.dataset.tone === "wow" ? "🤩" : "✨";
        scheduleOut(node, f, 1600);
      });
      document.body.append(node);
      live = node;
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("in")));
      try { haptic("LIGHT"); } catch {}
      scheduleOut(node, f, ms);
      return true;
    } catch { return false; }
  }

  function onTool(toolName) {
    if (Date.now() < holdUserUntil) return false;
    const map = {
      web_search: { id: "tool_search", face: "curious", badge: "🔍" },
      fetch_url: { id: "tool_read", face: "curious", badge: "📖" },
      get_weather: { id: "tool_weather", face: "curious", badge: "🌤️" },
      generate_image: { id: "tool_image", face: "excited", badge: "🎨" },
    };
    const tone = map[toolName];
    return tone ? pop(tone, { ms: 2000 }) : false;
  }

  function onReply({ hasArt = false, hasImage = false, hasCode = false, error = false } = {}) {
    if (error) return pop({ id: "err", face: "unsure", badge: "🩹" }, { force: true, ms: 2400 });
    if (Date.now() < holdUserUntil) return false;
    if (hasImage) return pop({ id: "art_img", face: "excited", badge: "🖼️" }, { force: true, ms: 2600 });
    if (hasArt) return pop({ id: "art_svg", face: "excited", badge: "✨" }, { ms: 2500 });
    if (hasCode) return pop({ id: "reply_code", face: "wink", badge: "⚡" }, { ms: 2200 });
    return false;
  }

  // The user's message, read before the composer clears it.
  const form = document.getElementById("composer");
  if (form) form.addEventListener("submit", () => {
    const box = document.getElementById("prompt");
    const tone = toneOf(box && box.value);
    if (tone) {
      holdUserUntil = Date.now() + 2400;
      setTimeout(() => pop(tone), 160);
    }
  }, true);

  // Liking a gallery bot: the mascot shows up happy. Only right after a tap on the
  // like button, so opening a bot that is already liked does not trigger it.
  const like = document.getElementById("bd-like");
  if (like) {
    let tapped = 0;
    like.addEventListener("click", () => { tapped = Date.now(); }, true);
    new MutationObserver(() => {
      if (like.classList.contains("on") && Date.now() - tapped < 5000) { tapped = 0; pop({ id: "like", face: "excited", badge: "❤" }, { force: true }); }
    }).observe(like, { attributes: true, attributeFilter: ["class"] });
  }

  window.__mascotReact = { toneOf, pop, onTool, onReply, reset() { last = -Infinity; holdUserUntil = 0; clearLive(); } };
})();
