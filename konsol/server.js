// Nakata Konsol: PC'deki tmux pencerelerini telefondan izle ve yönet.
// Yalnız 127.0.0.1'e bağlanır; tailnet'e `tailscale serve` ile açılır. Kimlik, serve'ün eklediği
// Tailscale-User-Login başlığından okunur; sahibi değilse 403.
const PORT = Number(process.env.KONSOL_PORT || 7788);
const OWNER = process.env.KONSOL_OWNER || "ataknakbaba@gmail.com";
const TMUX = Bun.which("tmux") || "/opt/homebrew/bin/tmux";
const TARGET_RE = /^[A-Za-z0-9_.-]+:\d+$/;
const KEYS = new Set(["Enter", "Escape", "C-c", "Up", "Down", "Tab", "BSpace"]);
const DIR = import.meta.dir;

async function tmux(...args) {
  const p = Bun.spawn([TMUX, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(err.trim() || `tmux ${args[0]} çıkış kodu ${code}`);
  return out;
}

async function listWindows() {
  // Ayraç yazdırılabilir olmalı: launchd altında (tty yok) tmux çıktıdaki \t gibi kontrol
  // karakterlerini '_' yapıyor. '@@@' pencere adı/komutta geçmez, tmux ona dokunmaz.
  const out = await tmux(
    "list-windows", "-a", "-F",
    "#{session_name}:#{window_index}@@@#{window_name}@@@#{pane_current_command}@@@#{window_activity}",
  );
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [target, name, cmd, activity] = line.split("@@@");
    return { target, name, cmd, activity: Number(activity) };
  });
}

// Hedef hem biçim olarak geçerli hem de şu an var olan bir pencere olmalı.
async function checkTarget(t) {
  if (typeof t !== "string" || !TARGET_RE.test(t)) return false;
  return (await listWindows()).some((w) => w.target === t);
}

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req) {
  if (req.headers.get("tailscale-user-login") !== OWNER) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") return new Response(Bun.file(`${DIR}/panel.html`));
  if (req.method === "GET" && url.pathname === "/manifest.json") return new Response(Bun.file(`${DIR}/manifest.json`));
  if (req.method === "GET" && /^\/icon-(192|512)\.png$/.test(url.pathname)) return new Response(Bun.file(`${DIR}${url.pathname}`));

  if (req.method === "GET" && url.pathname === "/api/windows") return json(await listWindows());

  if (req.method === "GET" && url.pathname === "/api/pane") {
    const t = url.searchParams.get("t");
    if (!(await checkTarget(t))) return json({ error: "pencere yok" }, 404);
    const text = await tmux("capture-pane", "-p", "-J", "-t", t, "-S", "-300");
    return json({ text: text.replace(/\s+$/, "") });
  }

  if (req.method === "POST" && (url.pathname === "/api/send" || url.pathname === "/api/key")) {
    const body = await req.json().catch(() => null);
    if (!body || !(await checkTarget(body.t))) return json({ error: "pencere yok" }, 404);
    if (url.pathname === "/api/key") {
      if (!KEYS.has(body.key)) return json({ error: "tuş izinli değil" }, 400);
      await tmux("send-keys", "-t", body.t, body.key);
    } else {
      if (typeof body.text !== "string" || body.text.length > 8000) return json({ error: "metin geçersiz" }, 400);
      if (body.text) await tmux("send-keys", "-t", body.t, "-l", body.text);
      if (body.enter) await tmux("send-keys", "-t", body.t, "Enter");
    }
    return json({ ok: true });
  }

  return new Response("not found", { status: 404 });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    try {
      return await handle(req);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
});
console.log(`konsol 127.0.0.1:${PORT}`);
