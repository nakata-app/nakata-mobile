"""End-to-end headless browser checks for Nakata Mobile bots, starters,
paired Mac Agent bot sync, and Nakata Konsol Desktop-JSON bot parity.

Usage: /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 test/webkit/bot_features_check.py
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

CHROME_BIN = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB_DIR = os.path.join(ROOT, "public")
KONSOL_DIR = os.path.join(ROOT, "konsol")

passed = 0
failed = []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"PASS: {name}")
    else:
        failed.append(f"{name}: {detail}")
        print(f"FAIL: {name} -- {detail}")


class MobileHandler(SimpleHTTPRequestHandler):
    chat_posts = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/api/mobile/models"):
            body = json.dumps({
                "models": [
                    {"id": "gemma4", "label": "Gemma 4", "main": True},
                    {"id": "gemini-4-hydrogen", "label": "Gemini 4 Hydrogen", "fallback": True},
                    {"id": "deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash"},
                ],
                "default": "gemma4",
                "perDay": 30,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        MobileHandler.chat_posts.append({"path": self.path, "body": body})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b'data: {"choices":[{"delta":{"content":"Bot yaniti hazir."}}]}\n\ndata: [DONE]\n\n')
        self.wfile.flush()


def test_mobile(p):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(MobileHandler, directory=PUB_DIR))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://localhost:{srv.server_address[1]}"
    browser = p.chromium.launch(executable_path=CHROME_BIN, headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    page_errs = []

    pair_bots = [
        {"name": "Scout", "description": "Diff reviewer", "color": "#38bdf8", "face": "thinking", "starters": ["Audit latest commit", "Find races"]},
        {"name": "Lex", "description": "Legal reader", "color": "#94a3b8", "face": "thinking", "starters": ["Check NDA risks"]},
    ]
    agent_state = {"paired": True, "cmd": None, "status": "completed", "prompt": "@Scout Audit latest commit"}

    def handle_agent(route):
        req = route.request
        u = req.url.split("?")[0]
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        j = lambda s, b: route.fulfill(status=s, content_type="application/json", headers=cors, body=json.dumps(b))
        if u.endswith("/agent/pairs/" + "a" * 32):
            return j(200, {"ok": True, "pair": {"id": "a" * 32, "status": "active", "online": True, "bots": pair_bots}})
        if u.endswith("/agent/task-history"):
            cmds = [{"id": agent_state["cmd"]["id"], "status": agent_state["status"], "title": agent_state["cmd"]["prompt"][:160], "createdAt": int(time.time() * 1000)}] if agent_state["cmd"] else []
            return j(200, {"ok": True, "commands": cmds})
        if u.endswith("/agent/commands") and req.method == "POST":
            body = json.loads(req.post_data or "{}")
            agent_state["cmd"] = {"id": body["commandId"], "prompt": body["prompt"]}
            return j(200, {"ok": True, "command": {"id": body["commandId"], "status": "queued"}})
        if "/agent/commands/" in u and agent_state["cmd"]:
            return j(200, {"ok": True, "command": {"id": agent_state["cmd"]["id"], "prompt": agent_state["cmd"]["prompt"], "status": "completed", "result": "Scout audit complete."}})
        return j(404, {"error": "nf"})

    def handle_mobile(route):
        req = route.request
        cors = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nakata-Device",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        }
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        u = req.url.split("?")[0]
        if u.endswith("/api/mobile/models"):
            return route.fulfill(
                status=200,
                content_type="application/json",
                headers=cors,
                body=json.dumps({
                    "models": [
                        {"id": "gemma4", "label": "Gemma 4", "main": True},
                        {"id": "gemini-4-hydrogen", "label": "Gemini 4 Hydrogen", "fallback": True},
                        {"id": "deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash"},
                    ],
                    "default": "gemma4",
                    "perDay": 30,
                }),
            )
        if u.endswith("/api/mobile/chat") and req.method == "POST":
            body = json.loads(req.post_data or "{}")
            MobileHandler.chat_posts.append({"path": "/api/mobile/chat", "body": body})
            return route.fulfill(
                status=200,
                content_type="text/event-stream",
                headers=cors,
                body='data: {"choices":[{"delta":{"content":"Bot yaniti hazir."}}]}\n\ndata: [DONE]\n\n',
            )
        return route.fulfill(status=404, headers=cors, body="{}")

    try:
        ctx.add_init_script("""
            localStorage.setItem('nakata_lang', JSON.stringify('tr'));
            localStorage.setItem('nakata_welcomed', 'true');
            localStorage.setItem('nakata_token', JSON.stringify('pst_test'));
            localStorage.setItem('nakata_account', JSON.stringify({name: 'atakan', credits: 10}));
            localStorage.setItem('nk_agent_pair:atakan', JSON.stringify('%s'));
        """ % ("a" * 32))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: page_errs.append(str(e)))
        pg.route("https://nakata.app/api/chat/agent/**", handle_agent)
        pg.route("https://nakata.app/api/chat/conversations*", lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body='{"ok":true,"conversations":[],"deletedIds":[]}'))
        pg.route("https://nakata.app/api/mobile/**", handle_mobile)
        pg.goto(base + "/index.html")
        pg.wait_for_timeout(600)

        check(
            "mobile default hero keeps heading and zero legacy .starter buttons",
            pg.inner_text("#heroTitle") == "Nasıl yardımcı olabilirim?" and pg.locator(".starter").count() == 0,
            pg.inner_text("#heroTitle"),
        )

        # Pick template bot -> renders description + clickable starters on hero
        pg.click("#modelBtn")
        pg.wait_for_timeout(250)
        pg.locator("#botList .botmain", has_text="Video Editor").click()
        pg.wait_for_timeout(250)
        starters = pg.locator("#heroStarters .hero-starter")
        check(
            "selecting Video Editor shows bot hero description and starters",
            pg.inner_text("#heroTitle") == "Video Editor" and starters.count() == 3,
            f"title={pg.inner_text('#heroTitle')} count={starters.count()}",
        )
        starters.first.click()
        pg.wait_for_selector("#thread .md", timeout=6000)
        check(
            "tapping hero starter immediately sends prompt with bot persona",
            len(MobileHandler.chat_posts) >= 1 and "Make a 30s Reels cut plan" in str(MobileHandler.chat_posts[-1]["body"]["messages"]),
        )

        # Create custom bot with free model override & custom starters
        pg.click("#newBtn")
        pg.wait_for_timeout(200)
        pg.click("#modelBtn")
        pg.wait_for_timeout(200)
        pg.click("#botNew")
        pg.wait_for_timeout(200)
        pg.fill("#bf-name", "HizliKod")
        pg.fill("#bf-tagline", "Turbo kod asistani")
        pg.fill("#bf-model", "deepseek-v4.1-flash")
        pg.fill("#bf-persona", "Kisa ve net kod yaz.")
        pg.fill("#bf-starters", "Bug bul\nTest yaz")
        pg.click("#botSave")
        pg.wait_for_timeout(250)
        pg.locator("#botList .botmain", has_text="HizliKod").click()
        pg.wait_for_timeout(250)
        check(
            "custom bot saves starters and free-tier model selection works",
            pg.locator("#heroStarters .hero-starter").count() == 2 and pg.inner_text("#heroDesc") == "Turbo kod asistani",
        )
        pg.locator("#heroStarters .hero-starter").first.click()
        pg.wait_for_timeout(500)
        check(
            "custom bot free model id is forwarded when valid in free catalog",
            MobileHandler.chat_posts[-1]["body"].get("model") == "deepseek-v4.1-flash",
            str(MobileHandler.chat_posts[-1]["body"].get("model")),
        )

        # Mac Agent synced bots + starters + prefix cleanup + Retry button
        pg.click("#menuBtn")
        pg.wait_for_timeout(250)
        pg.click("#agentRow")
        pg.wait_for_selector("#agentBotChips .agent-bot-chip", timeout=5000)
        check(
            "Mac Agent renders real paired Mac bots (@Scout, @Lex) and preserves preset",
            pg.locator("#agentBotChips .agent-bot-chip").count() == 2 and pg.locator("#agentBotChips [data-agent-prefix='@Araştır ']").count() == 1,
        )
        pg.click("#agentBotChips [data-agent-prefix='@Kodu incele ']")
        pg.click("#agentBotChips [data-agent-prefix='@Scout ']")
        pg.wait_for_timeout(150)
        check(
            "switching from @Kodu incele to @Scout leaves clean prefix and renders Scout starters",
            pg.input_value("#agentCommandPrompt") == "@Scout " and pg.locator("#agentBotStarters .chip").count() == 2,
            pg.input_value("#agentCommandPrompt"),
        )
        pg.locator("#agentBotStarters .chip", has_text="Audit latest commit").click()
        check(
            "tapping paired Mac bot starter fills prompt cleanly",
            pg.input_value("#agentCommandPrompt") == "@Scout Audit latest commit",
        )
        pg.click("#agentCommandSend")
        pg.wait_for_selector("#agentCommandResult:not([hidden])", timeout=5000)
        check(
            "Mac Agent result shows Retry button which restores full original command prompt",
            pg.is_visible("#agentRetryResult"),
        )
        pg.click("#agentRetryResult")
        check(
            "Retry restores @Scout prompt into input for editing or re-sending",
            pg.input_value("#agentCommandPrompt") == "@Scout Audit latest commit",
            pg.input_value("#agentCommandPrompt"),
        )
        check("mobile browser checks had zero uncaught page errors", len(page_errs) == 0, str(page_errs))
    finally:
        ctx.close()
        browser.close()
        srv.shutdown()


def test_konsol(p):
    with tempfile.TemporaryDirectory(prefix="konsol-ui-bots-") as bdir:
        with open(os.path.join(bdir, "Scout.json"), "w") as f:
            json.dump({
                "name": "Scout",
                "role": "Review diffs carefully.",
                "description": "Code reviewer",
                "color": "#38bdf8",
                "starters": ["Review last commit", "Check security"],
                "lessons": [{"text": "Cite file and line", "active": True}],
                "rules": {"do": ["Read"], "ask": [], "never": ["WebSearch"]},
            }, f)

        runner = os.path.join(bdir, "serve.ts")
        port_file = os.path.join(bdir, "port")
        with open(runner, "w") as f:
            f.write(f"""
import {{ createKonsolHandler }} from {json.dumps(os.path.join(KONSOL_DIR, "server.js"))};
const rawHandle = createKonsolHandler({{ owner: "owner@test", botsDir: {json.dumps(bdir)} }});
const srv = Bun.serve({{
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {{
    const headers = new Headers(req.headers);
    headers.set("tailscale-user-login", "owner@test");
    return rawHandle(new Request(req.url, {{ method: req.method, headers, body: req.body }}));
  }},
}});
await Bun.write({json.dumps(port_file)}, String(srv.port));
""")
        proc = subprocess.Popen(["/Users/macmini/.bun/bin/bun", "run", runner], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(50):
            if os.path.exists(port_file):
                break
            time.sleep(0.1)
        port = int(open(port_file).read().strip())
        browser = p.chromium.launch(executable_path=CHROME_BIN, headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        errs = []
        try:
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"http://127.0.0.1:{port}/")
            pg.wait_for_timeout(400)
            pg.click("#modelBtn")
            pg.locator("#botList .botmain", has_text="Scout").wait_for(timeout=4000)
            check(
                "Konsol bot picker loads Desktop Scout.json with rule count",
                "Scout" in pg.inner_text("#botList") and "1 kural" in pg.inner_text("#botList"),
                pg.inner_text("#botList"),
            )
            pg.locator("#botList .botmain", has_text="Scout").click()
            pg.wait_for_timeout(200)
            check(
                "Konsol hero shows selected bot name, description, and clickable starters",
                pg.inner_text("#heroTitle") == "Scout" and pg.locator("#heroStarters .starter").count() == 2,
                f"title={pg.inner_text('#heroTitle')} starters={pg.locator('#heroStarters .starter').count()}",
            )

            pg.fill("#prompt", "/teach Her zaman Türkçe özet ver")
            pg.dispatch_event("#prompt", "input")
            pg.click("#sendBtn")
            pg.wait_for_function("document.getElementById('thread').innerText.includes('öğrendi')", timeout=4000)
            scout_disk = json.load(open(os.path.join(bdir, "Scout.json")))
            check(
                "Konsol /teach persists lesson directly into Desktop Scout.json",
                any(l.get("text") == "Her zaman Türkçe özet ver" for l in scout_disk.get("lessons", [])),
                str(scout_disk.get("lessons")),
            )

            # Create a new bot via Konsol form and verify Desktop .json schema on disk
            pg.click("#modelBtn")
            pg.wait_for_timeout(200)
            pg.click("#botNew")
            pg.wait_for_timeout(200)
            pg.fill("#bf-name", "Lex")
            pg.fill("#bf-desc", "Hukuk asistanı")
            pg.fill("#bf-persona", "Sözleşmeleri dikkatli incele.")
            pg.fill("#bf-starters", "Riskleri listele")
            pg.click("#botSave")
            pg.wait_for_timeout(400)
            lex_path = os.path.join(bdir, "Lex.json")
            lex_disk = json.load(open(lex_path)) if os.path.exists(lex_path) else {}
            check(
                "Konsol bot form saves Desktop-compatible Lex.json with starters",
                lex_disk.get("name") == "Lex" and lex_disk.get("role") == "Sözleşmeleri dikkatli incele." and lex_disk.get("starters") == ["Riskleri listele"],
                str(lex_disk),
            )
            pg.locator("#botList .botmain", has_text="Nakata").click()
            pg.wait_for_timeout(150)
            pg.fill("#prompt", "/teach @Lex Yanıtta madde numarası ver")
            pg.dispatch_event("#prompt", "input")
            pg.click("#sendBtn")
            pg.wait_for_function("document.getElementById('thread').innerText.includes('Lex yeni kural')", timeout=4000)
            lex_after = json.load(open(lex_path))
            check(
                "Konsol /teach @Bot works even when no bot was pre-selected",
                any(l.get("text") == "Yanıtta madde numarası ver" for l in lex_after.get("lessons", [])),
                str(lex_after.get("lessons")),
            )
            check("Konsol UI checks had zero uncaught page errors", len(errs) == 0, str(errs))
        finally:
            ctx.close()
            browser.close()
            proc.terminate()
            proc.wait(timeout=5)


if __name__ == "__main__":
    with sync_playwright() as p:
        test_mobile(p)
        test_konsol(p)
    print(f"Summary: {passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)
