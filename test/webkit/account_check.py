"""Account + image studio checks for public/index.html (WebKit, iPhone 14).

usage: python3 -I test/webkit/account_check.py [public_dir]
A mock serves the page and fakes /api/mobile/* (routes/mobile.js contract).
"""
import json, os, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
pub = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "public")
S = {"calls": [], "token_ok": True, "credits": 120, "force_402": False}


class H(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, status, obj):
        b = json.dumps(obj).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)

    def authed(self):
        return S["token_ok"] and self.headers.get("Authorization") == "Bearer pst_test"

    def do_GET(self):
        p = self.path
        if not p.startswith("/api/mobile/"):
            return super().do_GET()
        S["calls"].append(("GET", p.split("?")[0], self.headers.get("Authorization")))
        if not self.authed():
            return self.reply(401, {"error": "Unauthorized"})
        if p.startswith("/api/mobile/models"):
            return self.reply(200, {"default": "deepseek-v4.1-flash", "fallbackModel": "gemini-4-hydrogen", "models": [{"id": "deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash"}]})
        if p.startswith("/api/mobile/uncensored-consent"):
            return self.reply(200, {"ok": True, "enabled": False, "adult": False})
        if p.startswith("/api/mobile/credits"):
            return self.reply(200, {"credits": S["credits"], "image_credit_costs": {"gpt-image-2-5-flare-text-to-image": {"2K": 13, "4K": 21}, "gpt-image-2-5-flare-image-to-image": {"2K": 13, "4K": 21}, "nano-banana-2-1": {"2K": 14, "4K": 20}, "nano-banana-pro": {"2K": 24, "4K": 32}}})
        if p.startswith("/api/mobile/gallery"):
            return self.reply(200, {"items": [{"url": "/mark.svg"}, {"url": "/clip.mp4"}], "total": 2})
        self.reply(404, {"error": "nf"})

    def do_POST(self):
        p = self.path
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        ctype = self.headers.get("Content-Type") or ""
        body = json.loads(raw) if "json" in ctype and raw else {}
        S["calls"].append(("POST", p, body if body else ctype.split(";")[0]))
        if p == "/api/mobile/login":
            if body.get("password") != "dogru":
                return self.reply(401, {"error": "Kullanıcı adı veya şifre hatalı"})
            return self.reply(200, {"token": "pst_test", "username": "ayse", "credits": 120})
        if not self.authed():
            return self.reply(401, {"error": "Unauthorized"})
        if p == "/api/mobile/upload":
            return self.reply(200, {"data": {"url": "https://refs.nakata.app/pst/r.jpg"}})
        if p == "/api/mobile/generate":
            if S["force_402"]:
                return self.reply(402, {"error": "Yetersiz kredi", "code": "insufficient_credits", "cost": 20})
            return self.reply(200, {"data": {"taskId": "t1"}})
        if p == "/api/mobile/task":
            return self.reply(200, {"status": "completed", "imageUrl": "/mark.svg"})
        if p == "/api/mobile/gallery":
            return self.reply(200, {"ok": True})
        if p == "/api/mobile/chat":
            sse = (b'data: {"choices":[{"delta":{"content":"Tamam, not aldim."}}]}\n\n'
                   b'data: [DONE]\n\n')
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(sse)
            return
        if p == "/api/mobile/logout":
            return self.reply(200, {"ok": True})
        if p == "/api/mobile/account/delete":
            if body.get("password") != "dogru":
                return self.reply(403, {"error": {"code": "wrong_password"}})
            S["token_ok"] = False
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "nf"})


srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(H, directory=pub))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{srv.server_address[1]}"
res = []


def check(name, ok, detail=""):
    res.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")


def calls(method, path):
    return [c for c in S["calls"] if c[0] == method and c[1] == path]


with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(**p.devices["iPhone 14"])
    ctx.add_init_script("localStorage.setItem('nakata_lang', JSON.stringify('tr')); localStorage.setItem('nakata_welcomed','true');"); ctx.add_init_script(f"localStorage.setItem('nakata_api_base', JSON.stringify('{BASE}/api/mobile'))")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(500)

    # drawer shows the signed-out account row + Mac Agent prompts sign-in cleanly
    pg.click("#menuBtn"); pg.wait_for_timeout(350)
    check("drawer: signed-out account row", pg.inner_text("#acctName") == "Giriş yap")
    pg.click("#agentRow"); pg.wait_for_timeout(350)
    check("Mac Agent shows sign-in prompt when signed out", pg.evaluate("document.getElementById('f-agent').classList.contains('on')") and pg.is_visible("#agentSignedOut") and not pg.is_visible("#agentControl"))
    pg.click("#f-agent .fclose"); pg.wait_for_timeout(250)
    pg.click("#menuBtn"); pg.wait_for_timeout(300)
    pg.click("#imagesRow"); pg.wait_for_timeout(350)
    check("images ask to sign in first and show membership button", pg.is_visible("#img-signin") and pg.is_visible("#img-plans-out") and not pg.is_visible("#img-form"))
    pg.click("#img-login"); pg.wait_for_timeout(350)

    pg.fill("#acc-email", "ayse"); pg.fill("#acc-pass", "yanlis"); pg.click("#acc-login"); pg.wait_for_timeout(400)
    check("wrong password shows the server message", pg.inner_text("#acc-err") == "Kullanıcı adı veya şifre hatalı")
    pg.fill("#acc-pass", "dogru"); pg.click("#acc-login"); pg.wait_for_timeout(600)
    acct = pg.evaluate("({ tok: JSON.parse(localStorage.getItem('nakata_token')), name: document.getElementById('acc-name').textContent, cr: document.getElementById('acc-credits').textContent })")
    check("signs in: token stored, name and credits shown", acct == {"tok": "pst_test", "name": "ayse", "cr": "120 kredi"}, str(acct))
    # image studio: signing in from it returns straight to it, on top
    pg.wait_for_timeout(500)
    back = pg.evaluate("(() => { const i = document.getElementById('f-image'), a = document.getElementById('f-account'); return i.classList.contains('on') && !a.classList.contains('on') && document.elementFromPoint(195, 300).closest('#f-image') !== null; })()")
    check("signing in from Images returns to Images, on top", back)
    check("studio: form, credits, text-to-image price", pg.is_visible("#img-form") and pg.inner_text("#img-credits") == "120 kredi" and pg.inner_text("#img-go") == "Üret · 20 kredi", pg.inner_text("#img-go"))
    pg.click("#img-model .chip >> text=Nano Banana Pro"); pg.wait_for_timeout(150)
    check("Nano Banana Pro shows its price and an 8-reference limit", pg.inner_text("#img-go") == "Üret · 32 kredi" and pg.evaluate("imgModel.refs") == 8, pg.inner_text("#img-go"))
    pg.click("#img-model .chip >> text=GPT"); pg.wait_for_timeout(150)
    gal = pg.locator("#img-results .gen img").count()
    check("gallery loads images, skips videos", gal == 1, f"tiles={gal}")
    pg.set_input_files("#img-file", files=[{"name": "r.png", "mimeType": "image/png", "buffer": open(pub + "/../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", "rb").read()}])
    pg.wait_for_timeout(300)
    check("GPT with a reference uses its image-to-image price", pg.inner_text("#img-go") == "Üret · 21 kredi" and pg.locator("#img-refs .ref img").count() == 1, pg.inner_text("#img-go"))
    pg.click("#img-aspect .chip >> text=9:16")
    pg.fill("#img-prompt", "deniz kenarında kedi"); pg.click("#img-go")
    pg.wait_for_function("() => document.querySelectorAll('#img-results .gen img').length === 2", timeout=15000)
    gen = calls("POST", "/api/mobile/generate")[-1][2]
    check("generate sends prompt, uploaded ref, aspect and model", gen.get("prompt") == "deniz kenarında kedi" and gen.get("imageUrls") == ["https://refs.nakata.app/pst/r.jpg"] and gen.get("aspect") == "9:16" and gen.get("model") == "gpt" and gen.get("operation_id", "").startswith("ios_"), str(gen)[:140])
    check("upload went as multipart", calls("POST", "/api/mobile/upload") and calls("POST", "/api/mobile/upload")[-1][2] == "multipart/form-data")
    pg.wait_for_timeout(300)
    check("result saved to gallery, form reset", calls("POST", "/api/mobile/gallery") and pg.input_value("#img-prompt") == "" and pg.locator("#img-refs .ref img").count() == 0)
    # desktop WebKit has no -webkit-touch-callout; check the tap target and the rule instead
    pe = pg.evaluate("getComputedStyle(document.querySelector('#img-results .gen img')).pointerEvents")
    rule = pg.evaluate("/\\.gen img\\{[^}]*-webkit-touch-callout:default/.test(document.querySelector('style').textContent)")
    check("generated image can be long-pressed to save", pe == "auto" and rule, f"{pe} {rule}")
    S["credits"] = 0; S["force_402"] = True
    pg.evaluate("refreshAccount()")
    pg.wait_for_selector("#img-credits-cta:not([hidden])", timeout=4000)
    check("zero credits shows membership/credits CTA in Image Studio", pg.is_visible("#img-buy-btn") and "0 kredi" in pg.inner_text("#img-credits-cta-text"), pg.inner_text("#img-credits-cta-text"))
    pg.fill("#img-prompt", "test"); pg.click("#img-go")
    pg.wait_for_function("() => document.getElementById('img-status').textContent.includes('Üyelik')", timeout=4000)
    check("402 on generate reveals membership CTA and message", pg.is_visible("#img-credits-cta") and "Üyelik" in pg.inner_text("#img-status"))
    S["credits"] = 120; S["force_402"] = False
    pg.evaluate("document.getElementById('f-image').classList.remove('on')")

    # Mac remote control (agent_bridge): pair, send task, background notice, inspect result, disconnect
    agent_state = {"paired": False, "cmd": None, "status": "queued", "auth": ""}
    def handle_agent(route):
        req = route.request
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        agent_state["auth"] = req.headers.get("authorization", "")
        u = req.url.split("?")[0]
        def j(status, obj):
            return route.fulfill(status=status, content_type="application/json", headers=cors, body=json.dumps(obj))
        if u.endswith("/agent/pair-codes/claim"):
            agent_state["paired"] = True
            return j(200, {"ok": True, "pair": {"id": "pair_test_1", "status": "pending"}})
        if u.endswith("/agent/pairs/pair_test_1"):
            if not agent_state["paired"]:
                return j(404, {"error": "pair_not_active"})
            return j(200, {"ok": True, "pair": {"id": "pair_test_1", "status": "active", "online": True}})
        if u.endswith("/agent/commands") and req.method == "POST":
            b = json.loads(req.post_data or "{}")
            agent_state["cmd"] = {"id": b["commandId"], "prompt": b["prompt"], "createdAt": 1700000000000}
            agent_state["status"] = "queued"
            return j(200, {"ok": True, "command": {"id": b["commandId"], "status": "queued"}})
        if "/agent/task-history" in u:
            cmds = [{"id": agent_state["cmd"]["id"], "status": agent_state["status"], "title": agent_state["cmd"]["prompt"], "createdAt": agent_state["cmd"]["createdAt"]}] if agent_state["cmd"] else []
            return j(200, {"ok": True, "commands": cmds})
        if "/agent/commands/" in u and agent_state["cmd"]:
            return j(200, {"ok": True, "command": {"id": agent_state["cmd"]["id"], "status": agent_state["status"], "result": "OK 42% used" if agent_state["status"] == "completed" else ""}})
        if u.endswith("/agent/unpair"):
            agent_state["paired"] = False; agent_state["cmd"] = None
            return j(200, {"ok": True})
        return j(404, {"error": "nf"})
    pg.route("https://nakata.app/api/chat/agent/**", handle_agent)

    # dedicated Mac Agent screen from drawer and account shortcut
    pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.click("#agentRow"); pg.wait_for_timeout(500)
    check("agent control visible on Mac Agent page when signed in", pg.evaluate("document.getElementById('f-agent').classList.contains('on')") and not pg.locator("#agentControl").get_attribute("hidden") and not pg.is_visible("#agentSignedOut") and pg.is_visible("#agentPairCode"))
    pg.fill("#agentPairCode", "ab12cd34ef567890")
    check("pair code formats as 4-char groups", pg.input_value("#agentPairCode") == "AB12-CD34-EF56-7890")
    pg.click("#agentPairButton")
    pg.wait_for_selector("#agentCommandArea:not([hidden])", timeout=8000)
    check("Mac pairing authenticates with Bearer token", agent_state["auth"] == "Bearer pst_test" and pg.is_visible("#agentCommandSend"))
    pg.click("#agentBotChips [data-agent-prefix='@Araştır ']"); pg.wait_for_timeout(150)
    check("bot chip inserts @Araştır prefix", pg.input_value("#agentCommandPrompt") == "@Araştır ")
    pg.fill("#agentCommandPrompt", "check disk usage"); pg.click("#agentCommandSend")
    pg.wait_for_selector("#agentTasks li button", timeout=5000)
    check("Mac task appears in Recent tasks", "check disk usage" in pg.inner_text("#agentTasks"))
    pg.click("#f-agent .fclose"); pg.wait_for_timeout(300)
    agent_state["status"] = "completed"
    pg.wait_for_selector("#agentTaskNotice:not([hidden])", timeout=8000)
    pg.click("#agentTaskNotice")
    pg.wait_for_function("document.getElementById('agentCommandResult').textContent.includes('OK 42% used')", timeout=6000)
    check("tapping completion badge opens Mac Agent task result", pg.evaluate("document.getElementById('f-agent').classList.contains('on')") and "OK 42% used" in pg.inner_text("#agentCommandResult") and pg.is_visible("#agentCopyResult"))
    pg.click("#agentUnpair")
    pg.wait_for_selector("#agentCommandArea", state="hidden", timeout=5000)
    check("disconnect hides Mac command area", not pg.is_visible("#agentCommandArea"))
    pg.click("#f-agent .fclose"); pg.wait_for_timeout(250)

    # Mnemonics memory settings + clear + conversationId & memory flag in /api/mobile/chat
    mem_deleted = {"auth": "", "count": 0}
    chat_posts = []
    def handle_memory(route):
        req = route.request
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        if req.method == "DELETE" and req.url.split("?")[0].endswith("/api/chat/memory"):
            mem_deleted["auth"] = req.headers.get("authorization", "")
            mem_deleted["count"] += 1
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({"ok": True, "cleared": True}))
        return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({"ok": True, "conversations": [], "deletedIds": [], "total": 0}))
    def handle_mobile_chat(route):
        req = route.request
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nakata-Device", "Access-Control-Allow-Methods": "POST, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        chat_posts.append({"auth": req.headers.get("authorization", ""), "body": json.loads(req.post_data or "{}")})
        return route.fulfill(status=200, content_type="text/event-stream", headers=cors, body='data: {"choices":[{"delta":{"content":"Tamam, not aldim."}}]}\n\ndata: [DONE]\n\n')
    pg.route("https://nakata.app/api/chat/memory*", handle_memory)
    pg.route("https://nakata.app/api/chat/conversations*", handle_memory)
    pg.route("https://nakata.app/api/mobile/chat", handle_mobile_chat)
    pg.click("#menuBtn"); pg.wait_for_timeout(250); pg.click("#settingsRow"); pg.wait_for_timeout(300)
    check("Settings shows memory toggle on and clear button when signed in", pg.input_value("#st-memory") == "on" and pg.is_visible("#st-memory-clear"))
    pg.once("dialog", lambda d: d.accept())
    pg.click("#st-memory-clear")
    pg.wait_for_function("() => document.getElementById('st-memory-hint').textContent.includes('temizlendi')", timeout=4000)
    check("clear memory calls DELETE /api/chat/memory with Bearer token", mem_deleted["count"] == 1 and mem_deleted["auth"] == "Bearer pst_test", str(mem_deleted))
    pg.select_option("#st-memory", "off"); pg.click("#st-save"); pg.wait_for_timeout(200)
    pg.fill("#prompt", "Bunu hatirlama"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder' && document.querySelectorAll('#thread .row:not(.user)').length === 1", timeout=5000)
    c1 = chat_posts[-1]["body"] if chat_posts else {}
    check("signed-in first turn sends Bearer token, conversationId and memory:false opt-out", chat_posts and chat_posts[-1]["auth"] == "Bearer pst_test" and isinstance(c1.get("conversationId"), str) and len(c1["conversationId"]) >= 8 and c1.get("memory") is False, str(chat_posts[-1:]))
    pg.click("#menuBtn"); pg.wait_for_timeout(250); pg.click("#settingsRow"); pg.wait_for_timeout(250)
    pg.select_option("#st-memory", "on"); pg.click("#st-save"); pg.wait_for_timeout(200)
    pg.fill("#prompt", "Simdi hatirla"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_function("() => document.querySelector('#sendBtn').getAttribute('aria-label') === 'Gönder' && document.querySelectorAll('#thread .row:not(.user)').length === 2", timeout=5000)
    c2 = chat_posts[-1]["body"] if len(chat_posts) > 1 else {}
    check("re-enabling memory sends memory:true with same conversationId", c2.get("conversationId") == c1.get("conversationId") and c2.get("memory") is True, str(c2))

    # voice selection + background continuity + minimize-to-chat + hot voice switch + custom trained voices
    import struct
    SILENT_WAV = (
        b"RIFF" + struct.pack("<I", 36 + 64) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)
        + b"data" + struct.pack("<I", 64) + (b"\x00" * 64)
    )
    voice_calls = {"sessions": [], "switches": [], "tts": [], "local_tts": [], "delegations": [], "pings": 0, "ends": 0, "ended_ids": []}
    def handle_local_tts(route):
        req = route.request
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        body = json.loads(req.post_data or "{}") if req.post_data else {}
        voice_calls["local_tts"].append({"auth": req.headers.get("authorization", ""), "body": body})
        return route.fulfill(status=200, content_type="audio/wav", headers=cors, body=SILENT_WAV)
    pg.route("http://127.0.0.1:18765/**", handle_local_tts)

    def handle_voice(route):
        req = route.request
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        path = req.url.split("?")[0]
        body = json.loads(req.post_data or "{}") if req.method == "POST" and req.post_data else {}
        if path.endswith("/voice/status"):
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({
                "enabled": True, "signedIn": True, "freeLeftSec": 900, "creditsPerMin": 13, "defaultVoice": "marin", "customTtsAvailable": False,
                "voices": [
                    {"id": "marin", "label": "Marin", "hint": "Doğal ve dengeli (varsayılan)", "kind": "gpt-live"},
                    {"id": "cedar", "label": "Cedar", "hint": "Sıcak ve net", "kind": "gpt-live"},
                    {"id": "coral", "label": "Coral", "hint": "Canlı ve samimi", "kind": "gpt-live"},
                    {"id": "ballad", "label": "Ballad", "hint": "Akıcı ve sıcak", "kind": "gpt-live"},
                    {"id": "sage", "label": "Sage", "hint": "Yumuşak ve bilge", "kind": "gpt-live"},
                    {"id": "shimmer", "label": "Shimmer", "hint": "Hafif ve berrak", "kind": "gpt-live"},
                    {"id": "verse", "label": "Verse", "hint": "İfadeli ve doğal", "kind": "gpt-live"},
                    {"id": "vesper", "label": "Vesper", "hint": "İngiliz vurgulu", "kind": "gpt-live"},
                    {"id": "ash", "label": "Ash", "hint": "Sakin ve derin", "kind": "gpt-live"},
                ],
            }))
        if path.endswith("/voice/session"):
            voice_calls["sessions"].append(body)
            req_voice = body.get("voice", "marin")
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({
                "sessionId": f"vs_{len(voice_calls['sessions'])}", "sdp": "v=0\r\n", "freeLeftSec": 885, "pingEverySec": 20, "maxSessionSec": 600, "creditsPerMin": 13,
                "voice": req_voice, "transportVoice": req_voice, "voiceKind": "gpt-live",
            }))
        if path.endswith("/voice/switch"):
            voice_calls["switches"].append(body)
            req_voice = body.get("voice", "vesper")
            if not body.get("sdp"):
                return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({
                    "ok": True, "hot": True, "sessionId": body.get("sessionId"),
                    "transportVoice": "cedar", "voice": req_voice,
                    "voiceKind": "gpt-live", "freeLeftSec": 882,
                }))
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({
                "ok": True, "hot": True, "sessionId": f"vs_sw_{len(voice_calls['switches'])}",
                "sdp": "v=0\r\n", "transportVoice": req_voice, "voice": req_voice, "voiceKind": "gpt-live", "freeLeftSec": 882,
            }))
        if path.endswith("/voice/tts"):
            voice_calls["tts"].append(body)
            return route.fulfill(status=200, content_type="audio/wav", headers=cors, body=SILENT_WAV)
        if path.endswith("/voice/delegation"):
            voice_calls["delegations"].append(body)
            dispatched = [{"id": "cmd_voice_1", "prompt": "@Scout testleri calistir", "status": "queued", "bot": "Scout"}]
            agent_state["cmd"] = {"id": "cmd_voice_1", "prompt": "@Scout testleri calistir", "createdAt": 1700000001000}
            agent_state["status"] = "queued"
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({
                "ok": True,
                "answer": "Görevi Mac'e gönderdim, bitince haber verecegim.",
                "toolsUsed": ["dispatch_mac_task", "web_search"],
                "sources": [{"title": "GitHub Runs", "url": "https://github.com/nakata/runs"}],
                "dispatchedTasks": dispatched,
            }))
        if path.endswith("/voice/ping"):
            voice_calls["pings"] += 1
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({"ok": True, "stop": False, "freeLeftSec": 880}))
        if path.endswith("/voice/end"):
            voice_calls["ends"] += 1
            if body.get("sessionId"):
                voice_calls["ended_ids"].append(body["sessionId"])
            return route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps({"ok": True, "stop": True}))
        return route.fulfill(status=404, content_type="application/json", headers=cors, body="{}")
    pg.route("**/api/mobile/voice/*", handle_voice)
    pg.evaluate("""(() => {
      window.__nativeAudio = [];
      window.webkit = { messageHandlers: { nakataAudio: { postMessage: (m) => window.__nativeAudio.push(m) } } };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop(){} }] }) },
      });
      window.RTCPeerConnection = function(){
        const pc = {
          iceGatheringState: "complete", connectionState: "connected",
          localDescription: { sdp: "v=0\\r\\no=- 1 1 IN IP4 127.0.0.1\\r\\n" },
          addTrack(){}, close(){ this._closed = true; },
          createDataChannel(){
            window.__voiceDcSent = window.__voiceDcSent || [];
            const dc = {
              readyState: "open",
              send(raw){
                try {
                  const msg = JSON.parse(raw);
                  window.__voiceDcSent.push(msg);
                  if (msg.type === "session.close") setTimeout(() => dc.onmessage && dc.onmessage({ data: JSON.stringify({ type: "session.closed" }) }), 10);
                } catch {}
              },
              close(){},
            };
            window.__voiceDc = dc;
            setTimeout(() => dc.onmessage && dc.onmessage({ data: JSON.stringify({ type: "session.started" }) }), 20);
            return dc;
          },
          async createOffer(){ return { type: "offer", sdp: this.localDescription.sdp }; },
          async setLocalDescription(d){ this.localDescription = d; },
          async setRemoteDescription(){},
        };
        return pc;
      };
    })()""")
    pg.click("#menuBtn"); pg.wait_for_timeout(200); pg.click("#settingsRow"); pg.wait_for_timeout(200)
    pg.fill("#pf-name", "Atakan"); pg.fill("#pf-about", "Nakata geliştiricisi"); pg.select_option("#st-voice", "cedar"); pg.click("#st-save"); pg.wait_for_timeout(200)
    check("Settings persists chosen assistant voice", pg.evaluate("JSON.parse(localStorage.getItem('nakata_voice'))") == "cedar")
    pg.click("#micBtn")
    pg.wait_for_function("document.getElementById('f-voice').classList.contains('on') && document.getElementById('voiceState').textContent !== 'Bağlanıyor…'", timeout=5000)
    sess0 = voice_calls["sessions"][0] if voice_calls["sessions"] else {}
    native_audio = pg.evaluate("window.__nativeAudio")
    check("voice call sends profile name, memory flag, voice choice and activates native audio", len(voice_calls["sessions"]) == 1 and sess0.get("voice") == "cedar" and sess0.get("memory") is True and sess0.get("profile", {}).get("name") == "Atakan" and any(x.get("active") is True for x in native_audio) and "Cedar" in pg.inner_text("#voicePick"), str((sess0, native_audio)))
    pg.evaluate("""window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: 'Harika, hoş geldin Atakan!' }) })""")
    try: pg.wait_for_function("document.querySelector('#voiceOrb svg.bot-orb')?.dataset.expression === 'excited'", timeout=1500)
    except Exception: pass
    v_face = pg.evaluate("document.querySelector('#voiceOrb svg.bot-orb')?.dataset.expression")
    check("voice orb expression reacts dynamically to spoken transcript tone", v_face == "excited", str(v_face))
    # Voice screen must show only live sentence-by-sentence caption (ChatGPT style) while full transcript lands directly in chat,
    # and counter must be a clean minimal timer/quota without confusing "11 free ... After that 13 credits/min" prose.
    free_txt = pg.inner_text("#voiceFree").strip()
    check("voice counter shows clean minimal remaining timer instead of confusing dual-number billing text", (":") in free_txt and ("ücretsiz" in free_txt or "free" in free_txt) and ("Sonrası" not in free_txt) and ("After that" not in free_txt) and ("13" not in free_txt), str(free_txt))
    pg.evaluate("""(() => {
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: ' İhtiyacın olan bir şey varsa söyle, hemen yardımcı olurum.' }) });
    })()""")
    pg.wait_for_timeout(80)
    live_cap = pg.inner_text("#voiceTranscript").strip()
    pg.evaluate("""(() => {
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Evde rahatlamak için ne önerirsin?' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.created' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: 'Anlıyorum. Evdeyken rahatlamak için kısa bir yürüyüş ya da çay molası iyi gelir.' }) });
    })()""")
    pg.wait_for_timeout(80)
    live_cap2 = pg.inner_text("#voiceTranscript").strip()
    pg.evaluate("""window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })""")
    pg.wait_for_timeout(80)
    cap_hidden_after_done = pg.evaluate("document.getElementById('voiceTranscript').hidden === true")
    thread_after_live = pg.inner_text("#thread")
    check("voice screen shows only current live sentence while full multi-turn transcript goes directly to chat", live_cap == "İhtiyacın olan bir şey varsa söyle, hemen yardımcı olurum." and ("Harika" not in live_cap) and live_cap2 == "Evdeyken rahatlamak için kısa bir yürüyüş ya da çay molası iyi gelir." and ("Anlıyorum" not in live_cap2) and cap_hidden_after_done and ("Harika, hoş geldin Atakan!" in thread_after_live) and ("Evde rahatlamak için ne önerirsin?" in thread_after_live) and ("kısa bir yürüyüş ya da çay molası" in thread_after_live), str((live_cap, live_cap2, cap_hidden_after_done)))
    pg.evaluate("""(() => {
      let h = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
      h = false;
      window.dispatchEvent(new CustomEvent('nakata:audio-resumed'));
    })()""")
    pg.wait_for_timeout(250)
    check("backgrounding app keeps active voice call alive and sends heartbeat", pg.evaluate("document.getElementById('f-voice').classList.contains('on')") and voice_calls["ends"] == 0 and voice_calls["pings"] >= 1, str(voice_calls))
    pg.evaluate("delete document.hidden")

    # Returning to chat keeps the active voice call running with a persistent live mini-bar
    pg.click("#voiceClose"); pg.wait_for_timeout(200)
    mini_visible = pg.is_visible("#voiceMiniBar")
    mic_live = pg.evaluate("document.getElementById('micBtn').classList.contains('live')")
    pg.evaluate("""window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: 'Sohbette de konuşmaya devam ediyorum.' }) })""")
    pg.wait_for_timeout(150)
    mini_state = pg.inner_text("#voiceMiniState")
    mini_voice = pg.inner_text("#voiceMiniVoice")
    check("returning to chat keeps voice call alive with mini-bar", (not pg.evaluate("document.getElementById('f-voice').classList.contains('on')")) and mini_visible and mic_live and voice_calls["ends"] == 0 and "Cedar" in mini_voice and mini_state == "Konuşuyor…", str((mini_visible, mic_live, mini_state, mini_voice, voice_calls["ends"])))
    pg.click("#voiceMiniOpen"); pg.wait_for_timeout(150)
    check("tapping live mini-bar returns to full voice call without reconnecting", pg.evaluate("document.getElementById('f-voice').classList.contains('on')") and len(voice_calls["sessions"]) == 1 and voice_calls["ends"] == 0, str(voice_calls))

    # Hot switching GPT-Live voice (make-before-break) without tearing down or calling /voice/session again
    pg.click("#voicePick")
    pg.wait_for_selector("#voiceSheet.on", timeout=3000)
    z_ok = pg.evaluate("Number(getComputedStyle(document.getElementById('voiceSheet')).zIndex) > Number(getComputedStyle(document.getElementById('f-voice')).zIndex)")
    pg.locator("#voiceList .botmain", has_text="Vesper").click()
    pg.wait_for_function("document.getElementById('voicePick').textContent.includes('Vesper') && document.getElementById('voiceState').textContent === 'Dinliyorum'", timeout=5000)
    check("voice picker hot-switches GPT-Live voice without /voice/session restart", z_ok and len(voice_calls["sessions"]) == 1 and len(voice_calls["switches"]) == 1 and voice_calls["switches"][-1].get("voice") == "vesper" and voice_calls["switches"][-1].get("sessionId") == "vs_1", str(voice_calls))

    # Clean 9-voice sheet (Sonji removed) + instant ChatGPT-style barge-in on GPT-Live input_transcript.delta
    pg.click("#voicePick"); pg.wait_for_selector("#voiceSheet.on", timeout=3000)
    sheet_check = pg.evaluate("""(() => {
      const opts = document.querySelectorAll('#voiceList .botopt').length;
      const secs = document.querySelectorAll('#voiceList .sheet-sec').length;
      const txt = document.getElementById('voiceList')?.innerText || '';
      return { opts, secs, hasSonji: /sonji/i.test(txt), hasMarin: txt.includes('Marin') };
    })()""")
    pg.click("#scrim"); pg.wait_for_timeout(120)
    pg.evaluate("""(() => {
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Uzun bir cevap anlatıyorum şimdi...' }) });
    })()""")
    pg.wait_for_timeout(60)
    barge_result = pg.evaluate("""(() => {
      const beforeState = document.getElementById('voiceState').textContent;
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Dur bekle' }) });
      const afterState = document.getElementById('voiceState').textContent;
      const capHidden = document.getElementById('voiceTranscript').hidden === true;
      const mutedOnBarge = Array.from(document.querySelectorAll('audio')).some((a) => a.muted === true);
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.created' }) });
      const unmutedAfterNew = Array.from(document.querySelectorAll('audio')).every((a) => a.muted === false);
      return { beforeState, afterState, capHidden, mutedOnBarge, unmutedAfterNew };
    })()""")
    check("voice sheet has 9 clean voices without Sonji and barge-in immediately silences/resets assistant speech", sheet_check.get("opts") == 9 and sheet_check.get("secs") == 0 and (not sheet_check.get("hasSonji")) and sheet_check.get("hasMarin") and barge_result.get("beforeState") == "Konuşuyor…" and barge_result.get("afterState") == "Dinliyorum" and barge_result.get("capHidden") and barge_result.get("mutedOnBarge") and barge_result.get("unmutedAfterNew"), str((sheet_check, barge_result)))

    # Ending from minimized mini-bar properly terminates call and native audio
    pg.click("#voiceClose"); pg.wait_for_timeout(150)
    pg.click("#voiceMiniEnd"); pg.wait_for_timeout(300)
    native_audio_end = pg.evaluate("window.__nativeAudio")
    check("ending call from chat mini-bar closes call and deactivates native audio", (not pg.evaluate("document.getElementById('f-voice').classList.contains('on')")) and pg.evaluate("document.getElementById('voiceMiniBar').hidden === true") and (not pg.evaluate("document.getElementById('micBtn').classList.contains('live')")) and voice_calls["ends"] >= 2 and native_audio_end[-1].get("active") is False, str(native_audio_end))

    # Adding user's own local trained custom voice in Settings + "Oku" read-aloud
    pg.click("#menuBtn"); pg.wait_for_timeout(200); pg.click("#settingsRow"); pg.wait_for_selector("#cv-toggle-form", timeout=3000)
    pg.click("#cv-toggle-form"); pg.wait_for_selector("#cv-form:not([hidden])", timeout=3000)
    pg.fill("#cv-name", "Özel Studio")
    pg.select_option("#cv-kind", "custom-tts")
    pg.fill("#cv-url", "http://127.0.0.1:18765/v1/audio/speech")
    pg.fill("#cv-voice", "studio-v2")
    pg.fill("#cv-token", "local-tok")
    pg.click("#cv-test")
    pg.wait_for_function("document.getElementById('cv-err')?.textContent.includes('Ses çalıştı.')", timeout=3000)
    pg.click("#cv-save"); pg.wait_for_timeout(200)
    cv_added = "Özel Studio" in pg.inner_text("#cv-list")
    pg.click("#f-settings .fclose"); pg.wait_for_timeout(200)
    pg.locator("#thread .msg-actions .speak").first.click()
    pg.wait_for_timeout(250)
    check("custom trained TTS server can be added/tested in Settings and used for chat read-aloud", cv_added and len(voice_calls["local_tts"]) >= 2 and voice_calls["local_tts"][-1]["body"].get("voice") == "studio-v2" and voice_calls["local_tts"][-1].get("auth") == "Bearer local-tok", str((cv_added, voice_calls["local_tts"])))

    # Switch back to GPT-Live Cedar before testing Scout custom bot delegation
    pg.click("#menuBtn"); pg.wait_for_timeout(150); pg.click("#settingsRow"); pg.wait_for_timeout(150)
    pg.select_option("#st-voice", "cedar"); pg.click("#st-save"); pg.wait_for_timeout(150)

    # voice call with custom bot + lessons + paired Mac delegation -> background task tracking
    pg.click("#modelBtn"); pg.wait_for_selector("#botNew", timeout=3000)
    pg.click("#botNew"); pg.wait_for_selector("#bf-name", timeout=3000)
    pg.fill("#bf-name", "Scout"); pg.fill("#bf-persona", "Kısa ve net konuş."); pg.click("#botSave")
    pg.locator("#botList .botmain", has_text="Scout").wait_for(state="visible", timeout=3000)
    pg.locator("#botList .botmain", has_text="Scout").click()
    pg.wait_for_selector("#botSheet:not(.on)", timeout=3000)
    pg.fill("#prompt", "/teach Kural 1: Türkçe cevap ver"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_timeout(200)
    pg.click("#menuBtn"); pg.wait_for_timeout(250); pg.click("#agentRow"); pg.wait_for_selector("#agentPairCode", timeout=3000)
    pg.fill("#agentPairCode", "AB12CD34EF567890"); pg.click("#agentPairButton")
    pg.wait_for_selector("#agentCommandArea:not([hidden])", timeout=8000)
    pg.click("#f-agent .fclose"); pg.wait_for_timeout(250)
    pg.evaluate("window.__voiceDcSent = []")
    del_before = len(voice_calls["delegations"])
    sent_before = pg.inner_text("#thread").count("Mac'e gönderdim")
    pg.click("#micBtn")
    pg.wait_for_function("document.getElementById('f-voice').classList.contains('on') && document.getElementById('voiceState').textContent !== 'Bağlanıyor…'", timeout=5000)
    v_custom = voice_calls["sessions"][-1]
    v_ctx = pg.inner_text("#voiceContext") if pg.is_visible("#voiceContext") else ""
    check("voice call forwards customBot persona, lessons, and active pairId", v_custom.get("pairId") == "pair_test_1" and v_custom.get("customBot", {}).get("name") == "Scout" and v_custom.get("customBot", {}).get("lessons") == ["Kural 1: Türkçe cevap ver"] and "Scout" in v_ctx and "Mac bağlı" in v_ctx, str((v_custom, v_ctx)))
    pg.evaluate("""(() => {
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Testleri Scout ile çalıştır' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'del_1' } }) });
    })()""")
    pg.wait_for_function("() => (window.__voiceDcSent || []).some((m) => m.type === 'session.commentary.append' && m.delegation_id === 'del_1')", timeout=5000)
    dc_sent = pg.evaluate("window.__voiceDcSent")
    commentary = next((m for m in dc_sent if m.get("type") == "session.commentary.append" and m.get("delegation_id") == "del_1"), {})
    check("voice delegation sends transcript, forwards commentary answer, and queues Mac poll", len(voice_calls["delegations"]) == del_before + 1 and voice_calls["delegations"][-1].get("text") == "Testleri Scout ile çalıştır" and commentary.get("delegation_id") == "del_1" and "Mac'e gönderdim" in commentary.get("content", ""), str((voice_calls["delegations"], commentary)))
    pg.evaluate("""(() => {
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.created' }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: "Mac'e gönderdim, şimdi başlıyor." }) });
      window.__voiceDc?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) });
    })()""")
    pg.wait_for_timeout(80)
    pg.click("#voiceEnd"); pg.wait_for_timeout(250)
    src_href = pg.evaluate("document.querySelector('#thread .srcs a')?.href || ''")
    scout_thread = pg.inner_text("#thread")
    check("voice turn and web sources persist into active chat thread after call without duplicating delegated reply", "Testleri Scout ile çalıştır" in scout_thread and scout_thread.count("Mac'e gönderdim") == sent_before + 1 and src_href == "https://github.com/nakata/runs", str((src_href, sent_before, scout_thread.count("Mac'e gönderdim"))))
    agent_state["status"] = "completed"
    pg.wait_for_selector("#agentTaskNotice:not([hidden])", timeout=8000)
    pg.click("#agentTaskNotice")
    pg.wait_for_function("document.getElementById('agentCommandResult').textContent.includes('OK 42% used')", timeout=6000)
    check("voice-dispatched Mac task surfaces completion notice and output", "OK 42% used" in pg.inner_text("#agentCommandResult"))
    pg.click("#agentUnpair"); pg.wait_for_selector("#agentCommandArea", state="hidden", timeout=5000)
    pg.click("#f-agent .fclose"); pg.wait_for_timeout(200)

    # account page shortcut + delete account
    pg.click("#menuBtn"); pg.wait_for_timeout(300); pg.click("#accountRow"); pg.wait_for_timeout(350)
    check("account page links to Mac Agent", pg.is_visible("#acc-agent-btn"))
    pg.click("#acc-delete"); pg.fill("#acc-del-pass", "yanlis"); pg.click("#acc-del-go")
    # the refusal arrives after a network round trip; wait for it rather than a fixed delay
    try: pg.wait_for_function("document.getElementById('acc-del-err').textContent.trim() !== ''", timeout=5000)
    except Exception: pass
    check("delete with a wrong password is refused", pg.inner_text("#acc-del-err") == "Şifre yanlış" and pg.evaluate("JSON.parse(localStorage.getItem('nakata_token'))") == "pst_test")
    pg.fill("#acc-del-pass", "dogru"); pg.click("#acc-del-go"); pg.wait_for_timeout(500)
    after = pg.evaluate("({ tok: JSON.parse(localStorage.getItem('nakata_token')), page: document.getElementById('f-account').classList.contains('on'), note: Array.from(document.querySelectorAll('#thread .note')).pop()?.textContent || '' })")
    check("delete signs out and says when data goes", after["tok"] == "" and not after["page"] and "8 gün" in after["note"] and "7 gün" in after["note"], str(after)[:120])
    errs = [e for e in errs if "access control checks" not in e]   # real nakata.app from a localhost page
    check("no page errors", not errs, "; ".join(errs[:3]))
    b.close()

srv.shutdown()
print(f"SUMMARY {sum(res)}/{len(res)} pass")
sys.exit(0 if all(res) else 1)
