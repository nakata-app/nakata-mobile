"""Chat UI checks for public/index.html in WebKit at iPhone 14 size.

usage: python3 -I test/webkit/ui_check.py [public_dir] [shots_dir]
Serves the page and a fake OpenAI-style /v1/chat/completions plus the free
/api/mobile/chat (SSE) from the same origin. Needs: pip playwright +
`python3 -m playwright install webkit`.
"""
import json, os, sys, threading, time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
pub = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "public")
shots = sys.argv[2] if len(sys.argv) > 2 else None
REPLY = [
    {"reasoning": "Kullanıcı kısa bir liste istiyor."},
    {"content": "## Özet\n\nİşte **üç** madde:\n\n"},
    {"content": "- birinci `kod`\n- ikinci [bağlantı](https://nakata.app)\n- üçüncü <img src=x onerror=alert(1)>\n\n"},
    {"content": "```\nprint('merhaba')\n```\n"},
]


class H(SimpleHTTPRequestHandler):
    limit = False
    paylimit = False  # free quota used up: only a request that agreed to pay gets a reply
    models_unavailable = False
    custom_events = None
    served_by = None
    last = path = None
    headers_seen = {}
    gets = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        H.gets.append((self.path, dict(self.headers)))
        if self.path.startswith("/api/mobile/ollama/models"):
            b = json.dumps({"object": "list", "data": [{"id": "gemma4:31b"}, {"id": "glm-5.3"}, {"id": "kimi-k3"}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b); return
        if self.path.startswith("/api/mobile/models"):
            b = json.dumps({
                "models": [
                    {"id": "gemma4", "label": "Gemma 4", "main": True},
                    {"id": "gemini-4-hydrogen", "label": "Gemini 4 Hydrogen", "fallback": True, **({"unavailable": True} if H.models_unavailable else {})},
                    {"id": "deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash"},
                    {"id": "nemotron-3-nano:30b", "label": "Nemotron 3 Nano (en ucuz)"},
                    {"id": "refuseless/glm-5.3-abliterated", "label": "GLM 5.3 Abliterated", "requiresConsent": True, "credits": 1},
                ],
                "default": "gemma4",
                "fallbackModel": "gemini-4-hydrogen",
                "perDay": 30,
            }).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        H.last, H.path, H.headers_seen = body, self.path, dict(self.headers)
        if H.limit or (H.paylimit and body.get("pay") != "credits"):
            out = json.dumps({"error": {"code": "free_limit", "message": "used up"}}).encode()
            self.send_response(429); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out); return
        self.send_response(200); self.send_header("Content-Type", "text/event-stream")
        if H.served_by:
            self.send_header("X-Nakata-Served-By", H.served_by)
        self.end_headers()
        if H.custom_events is not None:
            for ev in H.custom_events:
                self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode()); self.wfile.flush(); time.sleep(0.18)
        else:
            for d in REPLY:
                self.wfile.write(f"data: {json.dumps({'choices': [{'delta': d}]})}\n\n".encode()); self.wfile.flush(); time.sleep(0.15)
        self.wfile.write(b"data: [DONE]\n\n")


srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(H, directory=pub))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{srv.server_address[1]}"
res = []


def check(name, ok, detail=""):
    res.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")


def shot(pg, name):
    if shots: pg.screenshot(path=os.path.join(shots, name))


with sync_playwright() as p:
    b = p.webkit.launch(); dev = p.devices["iPhone 14"]; errs = []

    # a fresh install speaks English (the strings below are Turkish, so later contexts pin tr)
    ctx = b.new_context(**dev); pg = ctx.new_page(); pg.goto(BASE + "/index.html"); pg.wait_for_timeout(400)
    check("default language is English", pg.evaluate("document.documentElement.lang") == "en")
    ctx.close()

    # first launch: straight into chat on the free model
    ctx = b.new_context(**dev); ctx.add_init_script("localStorage.setItem('nakata_lang', JSON.stringify('tr'));"); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(600)
    check("first launch shows the welcome with ready bots", pg.evaluate("document.getElementById('f-welcome').classList.contains('on')") and pg.locator("#welcomeTpls .tpl").count() == 4)
    pg.click("#welcomeTpls .tpl >> nth=0"); pg.wait_for_timeout(300)
    check("picking a ready bot starts with it", pg.inner_text("#modelName") == "Video Editor" and not pg.evaluate("document.getElementById('f-welcome').classList.contains('on')"))
    prov = pg.evaluate("getCfg().provider + ' ' + getCfg().base")
    check("first launch: chat on the free model", not pg.evaluate("document.getElementById('f-settings').classList.contains('on')") and prov == "nakata https://nakata.app/api/mobile", prov)
    pg.evaluate("openSettings()"); pg.wait_for_timeout(300)
    check("settings: free provider hides key fields", pg.evaluate("[document.getElementById('st-byok').hidden, document.getElementById('st-freehint').hidden]") == [True, False])
    pg.evaluate(f"localStorage.setItem('nakata_byok_cfg', JSON.stringify({{provider:'nakata', base:'{BASE}/api/mobile', model:'x', key:''}})); localStorage.setItem('nakata_profile', JSON.stringify({{name:'Atakan', style:'kısa'}}))")
    pg.reload(); pg.wait_for_timeout(700)
    check("model chip shows the free default", pg.inner_text("#modelChipName") == "Gemma 4", pg.inner_text("#modelChipName"))
    pg.click("#modelChip"); pg.wait_for_timeout(400)
    free_sheet_nms = pg.evaluate("[...document.querySelectorAll('#modelList .nm')].map(n => n.textContent)")
    check("model sheet shows Main + Fallback + Free + Abliterated even signed out", "Gemma 4" in free_sheet_nms and "DeepSeek V4.1 Flash" in free_sheet_nms and "Gemini 4 Hydrogen" in free_sheet_nms and "GLM 5.3 Abliterated" in free_sheet_nms and pg.locator("#modelList .model-tag", has_text="Main").count() == 1 and pg.locator("#modelList .model-tag", has_text="Yedek").count() == 1, str(free_sheet_nms))
    pg.locator("#modelList .botmain", has_text="Nemotron").click(); pg.wait_for_timeout(300)
    check("picking a free model updates the chip", pg.inner_text("#modelChipName").startswith("Nemotron"))
    pg.fill("#prompt", "selam"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => document.querySelector('.md') && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=8000)
    hs = {k.lower(): v for k, v in H.headers_seen.items()}
    check("free request: /chat, device id, no key", H.path == "/api/mobile/chat" and len(hs.get("x-nakata-device", "")) >= 16 and "authorization" not in hs, H.path)
    check("free request carries the picked model", H.last.get("model") == "nemotron-3-nano:30b", str(H.last.get("model")))
    sysmsg = (H.last.get("messages") or [{}])[0]
    check("personalization reaches the model", sysmsg.get("role") == "system" and "Atakan" in sysmsg.get("content", "") and "kısa" in sysmsg.get("content", ""), sysmsg.get("content", "")[:80])
    H.limit = True
    pg.fill("#prompt", "bir daha"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_selector(".note.err", timeout=8000)
    check("used-up free day explained in Turkish", pg.inner_text(".note.err").startswith("Bugünkü ücretsiz mesajların bitti"))
    H.limit = False
    H.models_unavailable = False

    # a gallery bot past the free quota: a signed-in user is asked, and on yes the
    # same message goes again with pay=credits (and later ones too, without asking)
    H.paylimit = True; asked = []
    pg.evaluate("localStorage.setItem('nakata_token', JSON.stringify('tok')); galleryBot = { id: 'b_0123456789abcdef', name: 'Scout' }")
    pg.once("dialog", lambda d: (asked.append(d.message), d.accept()))
    pg.fill("#prompt", "devam"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => [...document.querySelectorAll('.row.user .bubble')].filter(b => b.textContent === 'devam').length === 1 && document.querySelectorAll('.md').length >= 2 && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=8000)
    check("past the quota a bot chat asks before charging", len(asked) == 1 and "1 krediyle" in asked[0], str(asked))
    check("on yes the message goes again, paid, shown once", H.path == "/api/mobile/bots/b_0123456789abcdef/chat" and H.last.get("pay") == "credits" and H.last["messages"][-1]["content"] == "devam", f"{H.path} {H.last.get('pay')}")
    pg.fill("#prompt", "sonra"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => document.querySelectorAll('.md').length >= 3 && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=8000)
    check("later messages pay without asking again", len(asked) == 1 and H.last.get("pay") == "credits")
    H.paylimit = False; ctx.close()

    # Ollama Cloud with the user's own key: the app keeps the key out of localStorage
    # and talks through the nakata.app relay, which carries both the list and the chat.
    ctx = b.new_context(**dev)
    ctx.add_init_script("localStorage.setItem('nakata_lang', JSON.stringify('tr')); localStorage.setItem('nakata_welcomed','true');")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(600)
    pg.evaluate("openSettings()"); pg.wait_for_timeout(200)
    pg.select_option("#st-provider", "ollama"); pg.wait_for_timeout(200)
    ui = pg.evaluate("({ base: document.getElementById('st-base').value, ro: document.getElementById('st-base').readOnly, byok: document.getElementById('st-byok').hidden, hint: document.getElementById('st-modelhint').textContent })")
    check("ollama: relay base is locked and the key field appears", ui["base"] == "https://nakata.app/api/mobile/ollama" and ui["ro"] and not ui["byok"] and "gemma4:31b" in ui["hint"], str(ui))
    pg.fill("#st-key", "sk-own-key"); pg.fill("#st-model", "gemma4:31b"); pg.click("#st-save"); pg.wait_for_timeout(400)
    raw = pg.evaluate("localStorage.getItem('nakata_byok_cfg') || ''")
    check("ollama: without a Keychain the browser keeps the key in its own store", "ollama" in raw and "gemma4:31b" in raw, raw[:90])
    check("ollama: the key never shows up in the page text", "sk-own-key" not in pg.inner_text("#f-settings") and pg.evaluate("document.getElementById('st-key').type") == "password")

    pg.evaluate(f"(() => {{ const c = JSON.parse(localStorage.getItem('nakata_byok_cfg')); c.base = '{BASE}/api/mobile/ollama'; localStorage.setItem('nakata_byok_cfg', JSON.stringify(c)); }})()")
    H.gets.clear(); pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("openModelSheet()")
    pg.wait_for_function("() => document.querySelectorAll('#modelList .botmain').length >= 3", timeout=6000)
    ids = pg.evaluate("[...document.querySelectorAll('#modelList .nm')].map(n => n.textContent)")
    get = [g for g in H.gets if g[0].startswith("/api/mobile/ollama/models")]
    check("ollama: the model list comes from the relay with the key and keeps Free + Abliterated visible", bool(get) and "Bearer sk-own-key" in get[0][1].get("Authorization", "") and ids[:3] == ["gemma4:31b", "glm-5.3", "kimi-k3"] and "Gemini 4 Hydrogen" in ids and "GLM 5.3 Abliterated" in ids, f"{ids} {get[:1]}")
    pg.evaluate("document.getElementById('modelSheet').classList.remove('on'); document.getElementById('scrim').classList.remove('on'); document.getElementById('f-settings').classList.remove('on')")
    pg.fill("#prompt", "selam"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => document.querySelector('.md') && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=10000)
    hs = {k.lower(): v for k, v in H.headers_seen.items()}
    check("ollama: the chat goes to the relay with the user's key", H.path == "/api/mobile/ollama/chat/completions" and hs.get("authorization") == "Bearer sk-own-key" and H.last.get("model") == "gemma4:31b" and H.last.get("stream") is True, f"{H.path} {hs.get('authorization')} {H.last.get('model')}")
    ctx.close()

    # BYOK setup with sessions and a bot
    ctx = b.new_context(**dev)
    ctx.add_init_script(f"""localStorage.setItem('nakata_lang', JSON.stringify('tr')); localStorage.setItem('nakata_welcomed','true'); localStorage.setItem('nakata_byok_cfg', JSON.stringify({{provider:'custom', base:'{BASE}/v1', model:'test-model', key:'k'}}));
      localStorage.setItem('nakata_byok_sessions', JSON.stringify({{a:{{id:'a',title:'Dünkü fikir',ts:2,msgs:[{{role:'user',content:'x'}},{{role:'assistant',content:'**y**'}}]}}, b:{{id:'b',title:'Gezi planı',ts:1,msgs:[]}}}}));
      localStorage.setItem('nakata_byok_bots', JSON.stringify({{Scout:{{persona:'Kısa cevap ver.',model:'m2'}}}}));""")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(800)
    sizes = pg.evaluate("Object.fromEntries(['menuBtn','newBtn','sendBtn'].map(id => { const r = document.querySelector('#' + id + ' svg').getBoundingClientRect(); return [id, Math.round(r.width) + 'x' + Math.round(r.height)]; }))")
    check("header and send icons have a size in WebKit", all(v != "0x0" for v in sizes.values()), str(sizes))
    m = pg.evaluate("(() => { const o = document.querySelector('#mascot svg.bot-orb'); return Math.round(o.getBoundingClientRect().width); })()")
    check("desktop mascot greets the empty chat", m == 92, f"w={m}")
    pg.click("#mascot svg"); pg.wait_for_timeout(120)
    first = pg.evaluate("document.querySelector('#mascot svg').dataset.expression")
    check("poking the mascot reacts with a face", first in ("wink", "happy", "surprised", "curious", "excited", "unsure", "attentive"), str(first))
    pg.click("#mascot svg"); pg.wait_for_timeout(120)
    check("a second poke picks another face", pg.evaluate("document.querySelector('#mascot svg').dataset.expression") not in (first, "neutral"))
    check("desktop chat heading, no starters", pg.inner_text(".hero h1") == "Nasıl yardımcı olabilirim?" and pg.locator(".starter").count() == 0)
    shot(pg, "empty.png")

    pg.click("#menuBtn"); pg.wait_for_timeout(400)
    check("drawer lists sessions", pg.locator(".sitem .st").all_inner_texts() == ["Dünkü fikir", "Gezi planı"])
    pg.click("#scrim", position={"x": 370, "y": 400}); pg.wait_for_timeout(300)
    pg.click("#modelBtn"); pg.wait_for_timeout(400)
    colors = pg.evaluate("[...document.querySelectorAll('.botopt svg.bot-orb')].map(o => o.style.getPropertyValue('--orb'))")
    check("bots and sample bots wear their own orb colours", len(colors) >= 2 and colors[0] == "#5b8cff" and all(c != "#5b8cff" for c in colors[1:]), str(colors))
    check("sample bots offered in the picker", pg.locator("#botList .sheet-sec").count() == 1 and pg.locator("#botList .botmain", has_text="Video Editor").count() == 1)
    pg.locator(".botmain", has_text="Nakata").click(); pg.wait_for_timeout(300)

    pg.fill("#prompt", "üç madde yaz"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_selector(".pending svg.bot-orb[data-expression='thinking']", timeout=5000)
    check("a thinking orb shows while the turn runs", True)
    pg.wait_for_function("() => document.querySelector('.md') && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=10000)
    pg.wait_for_timeout(200)
    after = pg.evaluate("({ pending: !!document.querySelector('.pending'), face: document.querySelector('#thread .msg-actions .reply-orb')?.dataset.expression, copy: !!document.querySelector('#thread .msg-actions .copy'), report: !!document.querySelector('#thread .msg-actions .report'), bars: document.querySelectorAll('#thread .msg-actions').length })")
    check("last answer carries the mascot, Copy and Report", not after["pending"] and after["face"] == "happy" and after["copy"] and after["report"] and after["bars"] >= 1, str(after))
    md = pg.evaluate("(() => { const m = document.querySelector('.md'); return { strong: !!m.querySelector('strong'), li: m.querySelectorAll('li').length, pre: !!m.querySelector('pre code'), link: (m.querySelector('a') || {}).href || null, img: m.querySelectorAll('img').length, text: m.innerText }; })()")
    check("markdown renders (bold, list, code, link)", md["strong"] and md["li"] == 3 and md["pre"] and md["link"] == "https://nakata.app/")
    check("raw HTML from the model stays text", md["img"] == 0 and "<img src=x" in md["text"])
    preview = pg.evaluate("""(() => {
      const box = document.createElement('div');
      box.innerHTML = md('![Belgrade skyline](https://thumb.wikimedia.org/wikipedia/commons/thumb/a/bc/travel.jpg/420px-travel.jpg)');
      const img = box.querySelector('.md-chat-image');
      const result = { maxWidth: img.style.maxWidth, maxHeight: img.style.maxHeight, cursor: img.style.cursor };
      document.querySelector('#thread .md').append(img);
      return result;
    })()""")
    check("chat images use compact inline previews", preview == {"maxWidth": "min(100%, 420px)", "maxHeight": "280px", "cursor": "zoom-in"}, str(preview))
    pg.evaluate("document.querySelector('.md-chat-image').click()"); pg.wait_for_selector(".md-chat-image-lightbox:not([hidden])", timeout=2000)
    check("clicking an image opens an in-chat full-size preview", pg.locator(".md-chat-image-lightbox img").get_attribute("alt") == "Belgrade skyline")
    pg.evaluate("document.querySelector('.md-chat-image-lightbox img').click()")
    check("tapping the enlarged image does not close it", pg.locator(".md-chat-image-lightbox:not([hidden])").count() == 1)
    pg.locator(".md-chat-image-lightbox .md-chat-lightbox-close").click(force=True)
    check("image preview can be closed", pg.locator(".md-chat-image-lightbox[hidden]").count() == 1)
    check("reasoning shown", pg.locator(".reason").count() == 1)
    check("request carries model and history", H.last.get("model") == "test-model" and H.last["messages"][-1]["content"] == "üç madde yaz" and H.last.get("stream") is True)
    check("conversation saved", pg.evaluate("Object.values(JSON.parse(localStorage.getItem('nakata_byok_sessions'))).length") == 3)

    # New vNext mobile capabilities: Hex-C mascot, attachments, SSE tool_call/sources, SVG/table markdown, copy, retry
    pg.click("#newBtn"); pg.wait_for_timeout(150)
    orb_state = pg.evaluate("({ paths: document.querySelectorAll('#mascot svg path').length, oldCircle: document.querySelectorAll('#mascot svg circle').length })")
    check("hero mascot uses Hex-C geometry", orb_state["paths"] >= 3 and orb_state["oldCircle"] == 0, str(orb_state))

    import base64
    png_1x1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    pg.set_input_files("#chatFile", [
        {"name": "shot.png", "mimeType": "image/png", "buffer": png_1x1},
        {"name": "note.txt", "mimeType": "text/plain", "buffer": b"galata spec"},
    ])
    pg.wait_for_selector("#attachBar:not([hidden]) .attach-thumb", timeout=5000)
    check("composer attaches image and text file preview", pg.locator("#attachBar .attach-thumb").count() == 1 and pg.locator("#attachBar .attach-fchip").count() == 1)

    H.served_by = "gemma4"
    H.custom_events = [
        {"type": "tool_call", "tool": "web_search", "args": {"query": "galata"}},
        {"type": "tool_result", "tool": "web_search", "sources": [{"title": "Galata Wiki", "url": "https://en.wikipedia.org/wiki/Galata_Tower"}], "images": []},
        {"choices": [{"delta": {"content": "| Metric | Value |\n| --- | --- |\n| Height | 67m |\n\n> Built 1348\n\n---\n\n```svg\n<svg viewBox=\"0 0 120 40\"><rect width=\"120\" height=\"40\"/><script>window.__xss=1</script></svg>\n```\n\n```py\nprint(1)\n```"}}]},
    ]
    pg.fill("#prompt", "Galata info"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("(document.querySelector('.pending')?.textContent || '').includes('Web') || (document.querySelector('.pending')?.textContent || '').includes('Searching')", timeout=5000)
    pend_txt = pg.inner_text(".pending")
    check("SSE tool_call shows search status while pending", "Web" in pend_txt or "Searching" in pend_txt, pend_txt)
    pg.wait_for_selector(".art-frame", timeout=8000)
    check("multimodal attachment + file sent to API", isinstance(H.last["messages"][-1]["content"], list) and H.last["messages"][-1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg") and "galata spec" in H.last["messages"][-1]["content"][0]["text"])
    check("user bubble shows thumbnail and file chip", pg.locator(".row.user .msg-shots img").count() == 1 and pg.locator(".row.user .msg-file").count() == 1)
    check("markdown renders table, blockquote and divider", pg.locator(".md table th").count() == 2 and pg.inner_text(".md blockquote").strip() == "Built 1348" and pg.locator(".md hr").count() == 1)
    svg_src = pg.get_attribute(".art-svg", "src") or ""
    svg_loaded = pg.evaluate("(() => { const img = document.querySelector('.art-svg'); return !!img && img.complete && img.naturalWidth > 0; })()")
    check("SVG diagram rendered safely without scripts", svg_src.startswith("data:image/svg+xml") and "%3Crect" in svg_src and "script" not in svg_src.lower() and svg_loaded, svg_src[:90])
    pg.click(".art-toggle")
    check("artifact Source toggle shows code", pg.get_attribute(".art-toggle", "aria-pressed") == "true" and pg.locator(".art-source:not([hidden])").count() == 1)
    check("sources and X-Nakata-Served-By badge rendered", pg.inner_text(".srcs a em") == "Galata Wiki" and pg.inner_text(".servedby") == "Yedek: Gemma 4", pg.inner_text(".servedby"))

    H.last = None
    pg.click(".msg-actions .retry")
    pg.wait_for_function("document.querySelectorAll('#thread .row.user').length === 1 && !document.querySelector('.pending')", timeout=8000)
    check("retry button re-runs the turn", H.last is not None and isinstance(H.last["messages"][-1]["content"], list))

    # ChatGPT-style two-row composer geometry & alignment check (iPhone 14 width 390px)
    comp = pg.evaluate("""(() => {
      const box = document.getElementById('composer').getBoundingClientRect();
      const ta = document.getElementById('prompt').getBoundingClientRect();
      const plus = document.getElementById('attachBtn').getBoundingClientRect();
      const chip = document.getElementById('modelChip').getBoundingClientRect();
      const mic = document.getElementById('micBtn').getBoundingClientRect();
      const send = document.getElementById('sendBtn').getBoundingClientRect();
      const cy = (r) => r.top + r.height / 2;
      const centers = [cy(plus), cy(chip), cy(mic), cy(send)];
      return {
        taW: ta.width, boxW: box.width,
        taAbove: ta.bottom <= chip.top + 2,
        spread: Math.max(...centers) - Math.min(...centers),
        noOverlap: plus.right <= chip.left + 1 && chip.right <= mic.left + 1 && mic.right <= send.left + 1,
      };
    })()""")
    check("composer textarea is wide and toolbar items align symmetrically", comp["taW"] >= comp["boxW"] * 0.85 and comp["taW"] >= 300 and comp["taAbove"] and comp["spread"] <= 2 and comp["noOverlap"], str(comp))

    # In-chat image generation CTA (signed out -> membership/login prompt) and inline generated image
    H.served_by = None
    H.custom_events = [
        {"type": "tool_call", "tool": "generate_image", "args": {"prompt": "cat", "aspect": "3:4"}},
        {"type": "tool_result", "tool": "generate_image", "sources": [], "images": [], "action": {"type": "image_membership", "reason": "auth_required", "plansUrl": "https://nakata.app/plans?from=ios"}},
        {"choices": [{"delta": {"content": "Görsel üretmek için giriş yapmalısın."}}]},
    ]
    pg.evaluate("localStorage.setItem('nakata_byok_cfg', JSON.stringify({provider:'nakata', base:'" + BASE + "/api/mobile', model:'gemini-4-hydrogen', key:''})); loadCfg();")
    pg.fill("#prompt", "Bir kedi görseli üret"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_selector(".chat-cta", timeout=8000)
    cta_txt = pg.inner_text(".chat-cta")
    check("in-chat image request without auth shows login & membership CTAs", "Giriş yap" in cta_txt and "Üyelik / Kredi al" in cta_txt, cta_txt)

    H.custom_events = [
        {"type": "tool_call", "tool": "generate_image", "args": {"prompt": "cat", "aspect": "3:4"}},
        {"type": "tool_result", "tool": "generate_image", "sources": [], "images": [], "imageTask": {"imageUrl": "/mark.svg", "prompt": "cat", "aspect": "3:4"}},
        {"choices": [{"delta": {"content": "İşte görsel:"}}]},
    ]
    pg.fill("#prompt", "Kedi çiz"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_selector(".chat-gen-card img", timeout=8000)
    check("in-chat image generation renders generated image inline", pg.locator(".chat-gen-card img.md-chat-image").count() == 1)

    H.custom_events = [
        {"type": "tool_call", "tool": "generate_image", "args": {"prompt": "cat", "aspect": "3:4"}},
        {"type": "tool_result", "tool": "generate_image", "sources": [], "images": [], "imageTask": {"imageUrl": "/mark.svg", "prompt": "cat", "aspect": "3:4"}},
    ]
    pg.fill("#prompt", "Sadece görsel üret"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("document.querySelectorAll('.chat-gen-card img.md-chat-image').length === 2", timeout=8000)
    pg.evaluate("const id = curId; newChat(); openConvo(id);")
    pg.wait_for_function("document.querySelectorAll('.chat-gen-card img.md-chat-image').length === 2", timeout=5000)
    check("reopening session keeps tool-only generated images visible", pg.locator(".chat-gen-card img.md-chat-image").count() == 2)
    pg.click(".chat-gen-card img.md-chat-image >> nth=0")
    pg.wait_for_selector(".md-chat-image-lightbox:not([hidden])", timeout=5000)
    save_txt = pg.inner_text(".md-chat-lightbox-save")
    check("image lightbox displays share/save control alongside close", save_txt in ("Paylaş / Kaydet", "Share / Save") and pg.locator(".md-chat-lightbox-close").count() == 1, save_txt)
    pg.click(".md-chat-lightbox-close")
    check("image lightbox closes on close button click", pg.locator(".md-chat-image-lightbox:not([hidden])").count() == 0)

    def handle_cloud_route(route):
        url = route.request.url
        if url.endswith("/api/chat/conversations/art_test_chat/artifacts"):
            route.fulfill(status=200, content_type="application/json", body=json.dumps({
                "ok": True,
                "artifacts": [{"id": "art_png", "name": "desktop-render.png", "size": 256, "contentType": "image/svg+xml"}],
            }))
            return
        if url.endswith("/api/chat/conversations/art_test_chat/artifacts/art_png"):
            route.fulfill(
                status=200,
                content_type="image/svg+xml",
                body='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3a86ff"/></svg>',
            )
            return
        route.abort()

    pg.route("https://nakata.app/api/chat/conversations/art_test_chat/**", handle_cloud_route)
    pg.evaluate("""(() => {
      const s = allSessions();
      s['art_test_chat'] = { id: 'art_test_chat', title: 'Art Chat', createdAt: 1, updatedAt: 2, msgs: [{role:'user', content:'draw'}, {role:'assistant', content:'Done'}] };
      saveSessions(s);
      localStorage.setItem('nakata_token', JSON.stringify('tok_test'));
      curId = 'art_test_chat';
      renderConvo('art_test_chat');
    })()""")
    pg.wait_for_selector(".cloud-artifacts img.cloud-artifact-image", timeout=5000)
    check("synced image artifact renders inline thumbnail in thread", pg.locator(".cloud-artifacts img.cloud-artifact-image").count() == 1 and pg.locator(".cloud-artifact-download").count() == 1)
    pg.click(".cloud-artifact-download")
    pg.wait_for_selector(".md-chat-image-lightbox:not([hidden])", timeout=5000)
    check("clicking synced image artifact opens lightbox preview", pg.locator(".md-chat-image-lightbox:not([hidden])").count() == 1)
    pg.click(".md-chat-lightbox-close")
    pg.evaluate("localStorage.removeItem('nakata_token');")
    pg.unroute("https://nakata.app/api/chat/conversations/art_test_chat/**")
    H.custom_events = None; H.served_by = None

    # Bug fixes & UX upgrades verification:
    # 1. Deleting active session keeps drawer open and keeps X visible on remaining chats
    pg.evaluate("openConvo(Object.keys(allSessions())[0])"); pg.wait_for_timeout(150)
    pg.click("#menuBtn"); pg.wait_for_timeout(300)
    before_count = pg.locator(".sitem").count()
    pg.locator(".sitem.on .x").click(); pg.wait_for_timeout(250)
    x_vis = pg.evaluate("(() => { const xs = [...document.querySelectorAll('.sitem .x')]; return { drawerOpen: document.getElementById('drawer').classList.contains('on'), count: xs.length, minOpacity: xs.length ? Math.min(...xs.map(x => parseFloat(getComputedStyle(x).opacity))) : 1, widths: xs.map(x => Math.round(x.getBoundingClientRect().width)) }; })()")
    check("deleting active session keeps drawer open and X buttons visible", x_vis["drawerOpen"] and x_vis["count"] == before_count - 1 and x_vis["minOpacity"] >= 0.6 and all(w >= 34 for w in x_vis["widths"]), str(x_vis))
    pg.locator(".sitem .x").first.click(); pg.wait_for_timeout(200)
    check("remaining chat can be deleted via its visible X button", pg.locator(".sitem").count() == before_count - 2)
    pg.click("#scrim", position={"x": 370, "y": 400}); pg.wait_for_timeout(250)

    # 2. Live hero mascot reaction + wow popup + math rendering + followups + report picker
    pg.click("#newBtn"); pg.wait_for_timeout(200)
    pg.fill("#prompt", "wow harika"); pg.dispatch_event("#prompt", "input"); pg.wait_for_timeout(180)
    check("typing wow updates hero mascot expression to surprised", pg.evaluate("document.querySelector('#mascot svg').dataset.expression") == "surprised")
    H.served_by = "google/gemma-4-31b-it:free"
    long_reply = "İşte formül: $E = mc^2$ ve blok:\n\n$$\n\\alpha + \\beta = \\gamma\n$$\n\n" + ("Detaylı açıklama metni. " * 14)
    H.custom_events = [
        {"type": "tool_call", "tool": "fetch_url", "args": {"url": "https://example.com"}},
        {"type": "tool_result", "tool": "fetch_url", "sources": [{"title": "Example Guide", "url": "https://example.com/guide"}], "images": []},
        {"choices": [{"delta": {"content": long_reply}}]},
    ]
    pg.evaluate("window.__mascotReact?.reset()")
    pg.click("#sendBtn")
    pg.wait_for_selector(".mr-pop[data-tone='wow'].in", timeout=4000)
    check("submitting wow pops the reactive mascot with sparkle badge", pg.inner_text(".mr-pop .mr-badge") == "✨")
    pg.locator(".mr-pop").click()
    check("tapping reactive wow mascot turns badge to excited", pg.inner_text(".mr-pop .mr-badge") == "🤩")
    pg.wait_for_function("() => document.querySelector('.followups .followup-chip') && document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder'", timeout=8000)
    check("offline math renders inline and block formulas", pg.locator(".math-inline").count() == 1 and pg.locator(".math-block").count() == 1 and "α + β = γ" in pg.inner_text(".math-block"))
    check("fallback OpenRouter model uses clean human label", pg.inner_text(".servedby") == "Yedek: Gemma 4 31B", pg.inner_text(".servedby"))
    check("substantive reply shows follow-up chips and edit button on user message", pg.locator(".followups .followup-chip").count() == 3 and pg.locator(".row.user .edit-msg").count() == 1)
    rep_geo = pg.evaluate("""(() => {
      const bars = document.querySelectorAll('#thread .msg-actions');
      const bar = bars[bars.length - 1]?.getBoundingClientRect();
      const copy = document.querySelector('#thread .msg-actions .copy')?.getBoundingClientRect();
      const rep = document.querySelector('#thread .msg-actions .report')?.getBoundingClientRect();
      const bd = [...document.querySelectorAll('.bd-actions button')].map(b => ({ id: b.id, r: b.getBoundingClientRect() }));
      return { bars: bars.length, standalone: document.querySelectorAll('#thread .msg-actions.report-actions').length, bar, copy, rep, bdIds: bd.map(x => x.id) };
    })()""")
    check("report button sits unobtrusively at right end of single action bar", rep_geo["standalone"] == 0 and rep_geo["copy"] and rep_geo["rep"] and abs(rep_geo["rep"]["top"] - rep_geo["copy"]["top"]) <= 6 and rep_geo["rep"]["left"] > rep_geo["copy"]["right"] and rep_geo["rep"]["right"] >= rep_geo["bar"]["right"] - 4 and rep_geo["bdIds"] == ["bd-like", "bd-block", "bd-report"], str(rep_geo))
    pg.evaluate("localStorage.setItem('nakata_token', JSON.stringify('tok_test'));")
    pg.click(".msg-actions .report"); pg.wait_for_selector(".report-picker", timeout=2000)
    check("tapping Report opens category picker", pg.locator(".report-picker button").count() == 4)
    pg.evaluate("localStorage.removeItem('nakata_token');")

    # 3. Unavailable primary model shows 'Yedek aktif' tag instead of misleading 'Geçici yedek'
    H.models_unavailable = True
    pg.evaluate("modelCacheTs.nakata = 0; openModelSheet();")
    pg.wait_for_selector("#modelList .model-tag.warn", timeout=4000)
    check("unavailable model shows Yedek aktif tag", pg.inner_text("#modelList .model-tag.warn") == "Yedek aktif")
    H.models_unavailable = False; H.custom_events = None; H.served_by = None

    shot(pg, "chat.png")
    # The default free base is the real nakata.app; from a localhost test page WebKit
    # blocks that cross-origin call (on the device the origin is capacitor://localhost).
    errs = [e for e in errs if "access control checks" not in e]
    check("no page errors", not errs, "; ".join(errs[:3]))
    b.close()

srv.shutdown()
print(f"SUMMARY {sum(res)}/{len(res)} pass")
sys.exit(0 if all(res) else 1)
