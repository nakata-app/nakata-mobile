"""App-feel checks for public/index.html in WebKit at iPhone 14 size.

usage: python3 -I test/webkit/native_check.py [public_dir]
Fakes the Capacitor plugins (Haptics, Browser, Keyboard) and records calls;
the mouse drives the pointer-event swipes.
"""
import json, os, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
pub = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "public")


class H(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': 'Bkz. [kaynak](https://nakata.app/terms)'}}]})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(H, directory=pub))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{srv.server_address[1]}"
res = []


def check(name, ok, detail=""):
    res.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")


FAKE = """window.__calls = [];
window.Capacitor = { Plugins: {
  Haptics: { impact: (o) => __calls.push('impact:' + o.style), notification: (o) => __calls.push('notify:' + o.type) },
  Browser: { open: (o) => __calls.push('browser:' + o.url) },
  Keyboard: { setAccessoryBarVisible: (o) => __calls.push('accessory:' + o.isVisible), addListener: (n) => __calls.push('listen:' + n) },
} };"""


def swipe(pg, x0, x1, y=420):
    pg.mouse.move(x0, y); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(x0 + (x1 - x0) * i / 10, y + i * 0.5)
    pg.mouse.up(); pg.wait_for_timeout(350)


def drag_down(pg, y0, y1, x=200):
    pg.mouse.move(x, y0); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(x + i * 0.3, y0 + (y1 - y0) * i / 10)
    pg.mouse.up(); pg.wait_for_timeout(350)


with sync_playwright() as p:
    b = p.webkit.launch()
    dev = dict(p.devices["iPhone 14"]); dev["has_touch"] = False; dev["is_mobile"] = False
    ctx = b.new_context(**dev)
    ctx.add_init_script(FAKE + "localStorage.setItem('nakata_welcomed','true');" + f"""localStorage.setItem('nakata_byok_cfg', JSON.stringify({{provider:'custom', base:'{BASE}/v1', model:'m', key:'k'}}));
      localStorage.setItem('nakata_byok_sessions', JSON.stringify({{a:{{id:'a',title:'Eski sohbet',ts:1,msgs:[{{role:'user',content:'x'}}]}}}}));""")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(700)
    calls = lambda: pg.evaluate("window.__calls")

    check("keyboard accessory bar hidden at boot", "accessory:false" in calls() and "listen:keyboardDidShow" in calls(), str(calls()))
    vp = pg.evaluate("document.querySelector('meta[name=viewport]').content")
    check("pinch / double-tap zoom off", "user-scalable=no" in vp and "maximum-scale=1" in vp)
    small = pg.evaluate("[...document.querySelectorAll('input:not([type=file]),textarea,select')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id)")
    check("no field below 16px (iOS focus zoom)", not small, str(small))
    sel = pg.evaluate("[getComputedStyle(document.querySelector('header')).webkitUserSelect, getComputedStyle(document.querySelector('#prompt')).webkitUserSelect]")
    check("chrome not selectable, composer is", sel == ["none", "text"], str(sel))

    swipe(pg, 4, 260)
    check("left-edge swipe opens the menu", pg.evaluate("document.getElementById('drawer').classList.contains('on')"))
    swipe(pg, 250, 30)
    check("swipe left closes the menu, taps nothing under it", not pg.evaluate("document.getElementById('drawer').classList.contains('on')") and pg.evaluate("document.querySelector('.sitem.on')") is None)
    swipe(pg, 200, 380)
    check("swipe in the middle does not open the menu", not pg.evaluate("document.getElementById('drawer').classList.contains('on')"))
    pg.evaluate("showPage('#f-settings')"); pg.wait_for_timeout(300)
    swipe(pg, 4, 300)
    check("left-edge swipe closes a page", not pg.evaluate("document.getElementById('f-settings').classList.contains('on')"))

    sheet_on = "document.getElementById('botSheet').classList.contains('on')"
    for start, sel_ in (("grip", "#botSheet .grip"), ("list", "#botSheet .botopt")):
        pg.click("#modelBtn"); pg.wait_for_timeout(350)
        box = pg.locator(sel_).first.bounding_box()
        drag_down(pg, box["y"] + box["height"] / 2, box["y"] + 200)
        check(f"bot sheet closes when dragged down from the {start}", not pg.evaluate(sheet_on))
    pg.click("#modelBtn"); pg.wait_for_timeout(350)
    box = pg.locator("#botSheet .grip").bounding_box(); drag_down(pg, box["y"] + 2, box["y"] + 30)
    check("a short drag leaves the sheet open", pg.evaluate(sheet_on))
    pg.click("#scrim", position={"x": 200, "y": 100}); pg.wait_for_timeout(300)

    pg.evaluate("__calls.length = 0")
    pg.fill("#prompt", "link ver"); pg.dispatch_event("#prompt", "input"); pg.click("#sendBtn")
    pg.wait_for_selector(".md a", timeout=8000); pg.wait_for_timeout(300)
    check("send gives a haptic tap", "impact:LIGHT" in calls(), str(calls()))
    url_before = pg.url
    pg.click(".md a"); pg.wait_for_timeout(300)
    check("link opens in the in-app browser, app stays", "browser:https://nakata.app/terms" in calls() and pg.url == url_before)
    check("no page errors", not errs, "; ".join(errs[:3]))
    b.close()

srv.shutdown()
print(f"SUMMARY {sum(res)}/{len(res)} pass")
sys.exit(0 if all(res) else 1)
