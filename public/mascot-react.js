// Nakata mobile: the mascot reacts to the user now and then.
// When a message carries a clear tone (thanks, praise, a laugh, frustration,
// surprise, sadness) or the user likes a gallery bot, the current bot's mascot
// pops up above the composer for a few seconds with a matching face, then
// leaves. Plain messages get no pop, and there is a cooldown, so it stays rare.
// Loaded after the main script: uses its globals (orb, orbColor, galleryBot,
// haptic, $). Everything here is decoration; any failure is swallowed.
(() => {
  "use strict";
  const SHOW_MS = 2600;      // how long the mascot stays
  const COOLDOWN_MS = 25000; // at most one pop in this window

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
    { id: "praise", face: "excited", badge: "🔥",
      re: /(harika|süper|mükemmel|muhteşem|efsane|bayıldım|çok iyi|aferin|bravo|helal|great|awesome|amazing|perfect|brilliant|excellent|love it|nailed)|[👏🔥🤩💯🙌]/iu },
    { id: "thanks", face: "happy", badge: "❤️",
      re: /(teşekkür|tesekkur|sağ ?ol|sagol|eyvallah|minnettar|thanks|thank you|\bthx\b|(?:^|\s)ty\b|appreciate)|[🙏❤♥😊🥰🫶]/iu },
  ];

  function toneOf(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 400) return null; // long prompts are work, not a reaction
    for (const tone of TONES) if (tone.re.test(t)) return tone;
    return null;
  }

  const reduce = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

  const css = document.createElement("style");
  css.textContent = `
.mr-pop{position:fixed;right:max(14px, env(safe-area-inset-right));bottom:calc(env(safe-area-inset-bottom) + 96px);z-index:2147483000;
  pointer-events:none;display:flex;align-items:flex-end;gap:2px;opacity:0;transform:translateY(24px) scale(.6);
  transition:opacity .22s ease, transform .32s cubic-bezier(.2,1.5,.4,1)}
.mr-pop.in{opacity:1;transform:none}
.mr-pop.out{opacity:0;transform:translateY(12px) scale(.85);transition:opacity .25s ease, transform .25s ease}
.mr-pop .mr-face{width:76px;height:76px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}
.mr-pop .mr-face img{width:76px;height:76px;border-radius:50%;object-fit:cover}
.mr-pop .mr-badge{font-size:22px;line-height:1;margin:0 0 54px -14px;transform:rotate(-8deg);animation:mr-bob .9s ease-in-out infinite alternate}
@keyframes mr-bob{to{transform:translateY(-5px) rotate(6deg)}}
@media (prefers-reduced-motion: reduce){.mr-pop,.mr-pop.in,.mr-pop.out{transition:opacity .2s linear;transform:none}.mr-pop .mr-badge{animation:none}}`;
  document.head.append(css);

  let last = -Infinity, live = null;

  function face(tone) {
    const box = document.createElement("div");
    box.className = "mr-face";
    const m = typeof galleryBot !== "undefined" && galleryBot ? galleryBot.mascot : null;
    if (m && m.url) { // generated image mascot: the badge carries the reaction
      const img = document.createElement("img");
      img.src = m.thumb || m.url; img.alt = "";
      box.append(img);
      return { box, destroy() {} };
    }
    const o = orb({ size: 76, color: typeof orbColor === "function" ? orbColor() : "#5b8cff", expression: "neutral" });
    box.append(o.el);
    requestAnimationFrame(() => o.set(tone.face));
    return { box, destroy() { try { o.destroy && o.destroy(); } catch {} } };
  }

  /** Show the mascot for a tone. force skips the cooldown (used for likes). */
  function pop(tone, { force = false } = {}) {
    try {
      const now = Date.now();
      if (!tone || (!force && now - last < COOLDOWN_MS) || live || document.hidden) return false;
      last = now;
      const f = face(tone);
      const node = document.createElement("div");
      node.className = "mr-pop"; node.setAttribute("aria-hidden", "true"); node.dataset.tone = tone.id;
      const badge = document.createElement("span"); badge.className = "mr-badge"; badge.textContent = tone.badge;
      node.append(f.box, badge);
      document.body.append(node);
      live = node;
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("in")));
      try { haptic("LIGHT"); } catch {}
      setTimeout(() => {
        node.classList.add("out");
        setTimeout(() => { f.destroy(); node.remove(); if (live === node) live = null; }, reduce() ? 220 : 280);
      }, SHOW_MS);
      return true;
    } catch { return false; }
  }

  // The user's message, read before the composer clears it.
  const form = document.getElementById("composer");
  if (form) form.addEventListener("submit", () => {
    const box = document.getElementById("prompt");
    const tone = toneOf(box && box.value);
    if (tone) setTimeout(() => pop(tone), 650); // after the bubble lands
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

  window.__mascotReact = { toneOf, pop, reset() { last = -Infinity; } };
})();
