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
S = {"calls": [], "token_ok": True}


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
        if p.startswith("/api/mobile/credits"):
            return self.reply(200, {"credits": 120, "image_credit_costs": {"gpt-image-2-5-flare-text-to-image": {"2K": 13, "4K": 21}, "gpt-image-2-5-flare-image-to-image": {"2K": 13, "4K": 21}, "nano-banana-2-1": {"2K": 14, "4K": 20}, "nano-banana-pro": {"2K": 24, "4K": 32}}})
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
            return self.reply(200, {"data": {"taskId": "t1"}})
        if p == "/api/mobile/task":
            return self.reply(200, {"status": "completed", "imageUrl": "/mark.svg"})
        if p == "/api/mobile/gallery":
            return self.reply(200, {"ok": True})
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

    # drawer shows the signed-out account row like the desktop sidebar
    pg.click("#menuBtn"); pg.wait_for_timeout(350)
    check("drawer: signed-out account row", pg.inner_text("#acctName") == "Giriş yap")
    pg.click("#imagesRow"); pg.wait_for_timeout(350)
    check("images ask to sign in first", pg.is_visible("#img-signin") and not pg.is_visible("#img-form"))
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

    # delete account
    pg.click("#menuBtn"); pg.wait_for_timeout(350); pg.click("#accountRow"); pg.wait_for_timeout(500)
    check("agent control visible when signed in", not pg.locator("#agentControl").get_attribute("hidden") and pg.is_visible("#agentPairCode"))
    pg.fill("#agentPairCode", "ab12cd34ef567890")
    check("pair code formats as 4-char groups", pg.input_value("#agentPairCode") == "AB12-CD34-EF56-7890")
    pg.click("#agentPairButton")
    pg.wait_for_selector("#agentCommandArea:not([hidden])", timeout=8000)
    check("Mac pairing authenticates with Bearer token", agent_state["auth"] == "Bearer pst_test" and pg.is_visible("#agentCommandSend"))
    pg.fill("#agentCommandPrompt", "check disk usage"); pg.click("#agentCommandSend")
    pg.wait_for_selector("#agentTasks li button", timeout=5000)
    check("Mac task appears in Recent tasks", "check disk usage" in pg.inner_text("#agentTasks"))
    pg.click("#f-account .fclose"); pg.wait_for_timeout(300)
    agent_state["status"] = "completed"
    pg.wait_for_selector("#agentTaskNotice:not([hidden])", timeout=8000)
    pg.click("#agentTaskNotice")
    pg.wait_for_function("document.getElementById('agentCommandResult').textContent.includes('OK 42% used')", timeout=6000)
    check("tapping completion badge opens Mac task result", "OK 42% used" in pg.inner_text("#agentCommandResult"))
    pg.click("#agentUnpair")
    pg.wait_for_selector("#agentCommandArea", state="hidden", timeout=5000)
    check("disconnect hides Mac command area", not pg.is_visible("#agentCommandArea"))

    pg.click("#acc-delete"); pg.fill("#acc-del-pass", "yanlis"); pg.click("#acc-del-go")
    # the refusal arrives after a network round trip; wait for it rather than a fixed delay
    try: pg.wait_for_function("document.getElementById('acc-del-err').textContent.trim() !== ''", timeout=5000)
    except Exception: pass
    check("delete with a wrong password is refused", pg.inner_text("#acc-del-err") == "Şifre yanlış" and pg.evaluate("JSON.parse(localStorage.getItem('nakata_token'))") == "pst_test")
    pg.fill("#acc-del-pass", "dogru"); pg.click("#acc-del-go"); pg.wait_for_timeout(500)
    after = pg.evaluate("({ tok: JSON.parse(localStorage.getItem('nakata_token')), page: document.getElementById('f-account').classList.contains('on'), note: document.querySelector('.note')?.textContent || '' })")
    check("delete signs out and says when data goes", after["tok"] == "" and not after["page"] and "8 gün" in after["note"] and "7 gün" in after["note"], str(after)[:120])
    errs = [e for e in errs if "access control checks" not in e]   # real nakata.app from a localhost page
    check("no page errors", not errs, "; ".join(errs[:3]))
    b.close()

srv.shutdown()
print(f"SUMMARY {sum(res)}/{len(res)} pass")
sys.exit(0 if all(res) else 1)
