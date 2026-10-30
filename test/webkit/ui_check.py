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
    last = path = None
    headers_seen = {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/api/mobile/models"):
            b = json.dumps({"models": [{"id": "gemma4", "label": "Gemma 4"}, {"id": "nemotron-3-nano:30b", "label": "Nemotron 3 Nano (en ucuz)"}], "default": "gemma4", "perDay": 30}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        H.last, H.path, H.headers_seen = body, self.path, dict(self.headers)
        if H.limit or (H.paylimit and body.get("pay") != "credits"):
            out = json.dumps({"error": {"code": "free_limit", "message": "used up"}}).encode()
            self.send_response(429); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out); return
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
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
    after = pg.evaluate("({ pending: !!document.querySelector('.pending'), face: document.querySelector('#thread .msg-actions .reply-orb')?.dataset.expression, copy: !!document.querySelector('#thread .msg-actions .copy'), bars: document.querySelectorAll('#thread .msg-actions').length })")
    check("last answer carries the mascot and Copy", not after["pending"] and after["face"] == "happy" and after["copy"] and after["bars"] == 1, str(after))
    md = pg.evaluate("(() => { const m = document.querySelector('.md'); return { strong: !!m.querySelector('strong'), li: m.querySelectorAll('li').length, pre: !!m.querySelector('pre code'), link: (m.querySelector('a') || {}).href || null, img: m.querySelectorAll('img').length, text: m.innerText }; })()")
    check("markdown renders (bold, list, code, link)", md["strong"] and md["li"] == 3 and md["pre"] and md["link"] == "https://nakata.app/")
    check("raw HTML from the model stays text", md["img"] == 0 and "<img src=x" in md["text"])
    check("reasoning shown", pg.locator(".reason").count() == 1)
    check("request carries model and history", H.last.get("model") == "test-model" and H.last["messages"][-1]["content"] == "üç madde yaz" and H.last.get("stream") is True)
    check("conversation saved", pg.evaluate("Object.values(JSON.parse(localStorage.getItem('nakata_byok_sessions'))).length") == 3)
    shot(pg, "chat.png")
    # The default free base is the real nakata.app; from a localhost test page WebKit
    # blocks that cross-origin call (on the device the origin is capacitor://localhost).
    errs = [e for e in errs if "access control checks" not in e]
    check("no page errors", not errs, "; ".join(errs[:3]))
    b.close()

srv.shutdown()
print(f"SUMMARY {sum(res)}/{len(res)} pass")
sys.exit(0 if all(res) else 1)
