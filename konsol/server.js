// Nakata Konsol: PC'deki tmux pencerelerini telefondan izle ve yönet.
// Yalnız 127.0.0.1'e bağlanır; tailnet'e `tailscale serve` ile açılır. Kimlik, serve'ün eklediği
// Tailscale-User-Login başlığından okunur; sahibi değilse 403.
const PORT = Number(process.env.KONSOL_PORT || 7788);
const OWNER = process.env.KONSOL_OWNER || "ataknakbaba@gmail.com";
const TMUX = Bun.which("tmux") || "/opt/homebrew/bin/tmux";
const TARGET_RE = /^[A-Za-z0-9_.-]+:\d+$/;
const KEYS = new Set(["Enter", "Escape", "C-c", "Up", "Down", "Tab", "BSpace"]);
const DIR = import.meta.dir;

// ---- Sohbet: PC'deki nakata'nın kendisi (desktop ile aynı session'lar) ----
import { readdir, realpath, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
const HOME = process.env.HOME || "";
const NAKATA = Bun.which("nakata") || `${HOME}/.local/bin/nakata`;
// Ağdan yalnız session transcript'leri okunabilir: kökler realpath ile sabitlenir.
const SESSION_ROOTS = await Promise.all(
  [`${HOME}/.nakata/projects`, `${HOME}/.svelka/projects`].map((r) => realpath(r).catch(() => r)),
);
const MODES = new Set(["chat", "default", "acceptEdits", "plan", "bypassPermissions"]);
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const runs = new Map(); // runId -> canlı turn'ün nakata süreci

// Sohbet HOME altındaki bir klasörde koşar (session listesi klasör başınadır).
async function workspace(cwd) {
  const dir = await realpath(cwd || HOME).catch(() => null);
  if (!dir || (dir !== HOME && !dir.startsWith(`${HOME}/`))) return null;
  const s = await stat(dir).catch(() => null);
  return s?.isDirectory() ? dir : null;
}

// Listeyi CLI'ı çalıştırmadan, aynı dosyalardan okur: `nakata -p /sessions` HOME
// projesinin sıra kilidini alıyordu ve launchd altında kilidi tutarak askıda kalıp
// PC'deki diğer nakata oturumlarını da kilitledi. Klasör adı CLI'ın encodeCwd'si
// (base64url); arşiv durumu yanındaki <id>.meta.json'da.
async function firstUserLine(path) {
  const head = await Bun.file(path).slice(0, 16384).text().catch(() => "");
  for (const line of head.split("\n")) {
    try {
      const d = JSON.parse(line);
      if (d.type === "user") return String(d.content ?? "").split("\n")[0].slice(0, 120);
    } catch {}
  }
  return "";
}

async function listSessions(dir) {
  const enc = Buffer.from(dir, "utf8").toString("base64url");
  const byId = new Map();
  for (const root of SESSION_ROOTS) {
    const pdir = `${root}/${enc}`;
    const names = await readdir(pdir).catch(() => []);
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = `${pdir}/${name}`;
      const st = await stat(path).catch(() => null);
      if (!st) continue;
      const id = name.slice(0, -".jsonl".length);
      const prev = byId.get(id);
      if (!prev || st.mtimeMs > prev.mtimeMs) byId.set(id, { id, path, mtimeMs: st.mtimeMs, meta: `${pdir}/${id}.meta.json` });
    }
  }
  const out = [];
  for (const s of [...byId.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (out.length >= 100) break;
    const meta = await Bun.file(s.meta).json().catch(() => null);
    if (meta?.archivedAt) continue;
    out.push({ id: s.id, path: s.path, title: await firstUserLine(s.path), mtimeMs: s.mtimeMs });
  }
  return out;
}

// Desktop'ın capture_shell_env'i gibi: launchd'nin çıplak ortamı yerine kullanıcının
// login shell ortamı (PATH, MCP sunucularının ihtiyaçları). Bir kez yakalanır.
let shellEnvCache = null;
async function shellEnv() {
  if (shellEnvCache) return shellEnvCache;
  const env = {};
  try {
    const p = Bun.spawn(["/bin/zsh", "-lic", "env"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 10000);
    const out = await new Response(p.stdout).text();
    clearTimeout(timer);
    for (const line of out.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch {}
  shellEnvCache = env.PATH ? env : { ...process.env };
  return shellEnvCache;
}

async function readSession(path) {
  const real = await realpath(String(path || "")).catch(() => null);
  if (!real || !real.endsWith(".jsonl") || !SESSION_ROOTS.some((r) => real.startsWith(`${r}/`))) return null;
  if ((await stat(real)).size > MAX_SESSION_BYTES) throw new Error("session çok büyük");
  const out = [];
  for (const line of (await Bun.file(real).text()).split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type === "user" || d.type === "assistant") out.push({ role: d.type, text: String(d.content ?? "") });
    else if (d.type === "tool_result") {
      out.push({ role: "tool", tool: d.toolName || "", isError: !!d.isError, text: String(d.content ?? "").slice(0, 2000) });
    }
  }
  return out;
}

// ---- Botlar: desktop ile AYNI ~/.nakata/bots/<ad>.md dosyaları (model/tools
// frontmatter + persona gövdesi). Telefonda botu seçince model+persona uygulanır;
// araçlar, telefonda onay arayüzü olmadığı için chat'in güvenli setinde kalır. ----
const BOTS_DIR = `${HOME}/.nakata/bots`;
function parseBot(name, text) {
  let description = "", model = null, persona = text.trimStart();
  const t = text.trimStart();
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end >= 0) {
      persona = t.slice(end + 4).replace(/^[\r\n]+/, "");
      for (const line of t.slice(3, end).split("\n")) {
        const i = line.indexOf(":");
        if (i < 0) continue;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim().replace(/^"|"$/g, "");
        if (k === "description") description = v;
        else if (k === "model" && v) model = v;
      }
    }
  }
  return { name, description, model, persona: persona.trim() };
}
async function listBots() {
  const names = await readdir(BOTS_DIR).catch(() => []);
  const out = [];
  for (const f of names) {
    if (!f.endsWith(".md")) continue;
    const text = await Bun.file(`${BOTS_DIR}/${f}`).text().catch(() => "");
    if (text) out.push(parseBot(f.slice(0, -3), text));
  }
  return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
async function loadBot(name) {
  if (!validBotName(name)) return null;
  const n = name.trim();
  const text = await Bun.file(`${BOTS_DIR}/${n}.md`).text().catch(() => "");
  return text ? parseBot(n, text) : null;
}
// Desktop'ın is_alphanumeric'iyle aynı (Unicode harf/rakam) + boşluk/-/_. Yol
// ayracı (/ . \) hariç olduğu için dosya adı olarak güvenli; traversal imkânsız.
const validBotName = (n) => typeof n === "string" && /^[\p{L}\p{N} _-]{1,48}$/u.test(n.trim());
function botToMd(b) {
  let out = `---\nname: ${b.name.trim()}\n`;
  if (b.description?.trim()) out += `description: ${b.description.trim()}\n`;
  if (b.model?.trim()) out += `model: ${b.model.trim()}\n`;
  if (b.tools?.trim()) out += `tools: ${b.tools.trim()}\n`;
  return `${out}---\n\n${(b.persona || "").trim()}\n`;
}
async function saveBot(b) {
  if (!validBotName(b?.name)) return json({ error: "ad geçersiz" }, 400);
  if (typeof b.persona !== "string" || !b.persona.trim()) return json({ error: "persona (talimat) gerekli" }, 400);
  if (b.persona.length > 20000) return json({ error: "persona çok uzun" }, 400);
  await Bun.$`mkdir -p ${BOTS_DIR}`.quiet().catch(() => {});
  await Bun.write(`${BOTS_DIR}/${b.name.trim()}.md`, botToMd(b));
  return json({ ok: true });
}
async function deleteBot(name) {
  if (!validBotName(name)) return json({ error: "ad geçersiz" }, 400);
  await unlink(`${BOTS_DIR}/${name.trim()}.md`).catch(() => {});
  return json({ ok: true });
}

// Desktop'ın command_args'ıyla aynı: chat modu kısıtlı araç seti, --resume aynı
// sohbeti sürdürür, bot persona'sı ekstra sistem promptu olarak biner.
function chatArgs(mode, sessionId, model, persona) {
  const chat = mode === "chat";
  const args = [
    "--output-format", "stream-json", "--input-format", "stream-json", "--ask-stdin",
    "--permission-mode", chat ? "default" : mode,
  ];
  if (chat) args.push("--only-tools", "WebSearch,WebFetch,AskUserQuestion,ScheduleTask", "--allowedTools", "ScheduleTask");
  if (persona && persona.trim()) args.push("--append-system-prompt", persona.trim());
  if (sessionId) args.push("--resume", sessionId);
  if (model) args.push("--model", model);
  return args;
}

async function chat(body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim() || prompt.length > 20000) return json({ error: "mesaj geçersiz" }, 400);
  const mode = MODES.has(body.mode) ? body.mode : "chat";
  const sessionId = typeof body.sessionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.sessionId) ? body.sessionId : null;
  let model = typeof body.model === "string" && /^[A-Za-z0-9._:/-]{1,80}$/.test(body.model) ? body.model : null;
  const dir = await workspace(body.cwd);
  if (!dir) return json({ error: "klasör geçersiz" }, 400);

  // Bot seçiliyse model + persona'sını uygula (desktop ile aynı bot tanımı).
  let persona = null;
  if (body.bot) {
    const bot = await loadBot(body.bot);
    if (!bot) return json({ error: "bot yok" }, 404);
    persona = bot.persona;
    if (bot.model && !model) model = bot.model;
  }

  const runId = crypto.randomUUID();
  const proc = Bun.spawn([NAKATA, ...chatArgs(mode, sessionId, model, persona)], {
    cwd: dir, env: await shellEnv(), stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  runs.set(runId, proc);
  proc.stdin.write(`${JSON.stringify({ type: "user", content: prompt })}\n`);
  proc.stdin.flush();

  const enc = new TextEncoder();
  let ping;
  const stream = new ReadableStream({
    async start(controller) {
      const push = (s) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      const send = (ev) => push(`data: ${JSON.stringify(ev)}\n\n`);
      // Uzun model beklemesinde proxy/istemci bağlantıyı düşürmesin.
      ping = setInterval(() => push(": ping\n\n"), 15000);
      send({ type: "run", runId });
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of proc.stdout) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          send(ev);
          // Sonuçta stdin'i kapat: CLI bu turn'den sonra çıkar.
          if (ev.type === "result") { try { proc.stdin.end(); } catch {} }
        }
      }
      await proc.exited;
      clearInterval(ping);
      runs.delete(runId);
      send({ type: "end" });
      try { controller.close(); } catch {}
    },
    cancel() {
      clearInterval(ping);
      proc.kill();
      runs.delete(runId);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

// Müzik tanıma: telefonun kaydettiği klip, desktop'ın kullandığı Shazam yardımcısıyla
// (shazamio, API anahtarı yok) PC'de tanınır. ffmpeg'i bulsun diye shell ortamıyla koşar.
const MUSIC_PY = `${HOME}/.nakata/music-venv/bin/python`;
const MUSIC_SCRIPT = `${HOME}/.nakata/music/identify.py`;
async function identifyMusic(body) {
  const b64 = typeof body?.audioB64 === "string" ? body.audioB64 : "";
  if (!b64 || b64.length > 8 * 1024 * 1024) return json({ error: "ses verisi geçersiz" }, 400);
  if (!(await Bun.file(MUSIC_PY).exists()) || !(await Bun.file(MUSIC_SCRIPT).exists())) {
    return json({ error: "müzik tanıma bu PC'de kurulu değil" }, 503);
  }
  const ext = body.ext === "webm" ? "webm" : "mp4";
  const tmp = `${tmpdir()}/konsol-music-${crypto.randomUUID()}.${ext}`;
  await Bun.write(tmp, Buffer.from(b64, "base64"));
  try {
    const p = Bun.spawn([MUSIC_PY, MUSIC_SCRIPT, tmp], { env: await shellEnv(), stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 60000);
    const out = await new Response(p.stdout).text();
    clearTimeout(timer);
    const line = out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
    return json(line ? JSON.parse(line) : { ok: false, error: "sonuç yok" });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// Canlı turn'e yazılan tek satır: soru cevabı, araya mesaj (steer) ya da durdurma.
function runControl(path, body) {
  const proc = runs.get(body?.runId);
  if (!proc) return json({ error: "aktif çalışma yok" }, 404);
  if (path === "/api/stop") {
    proc.kill();
    return json({ ok: true });
  }
  let line;
  if (path === "/api/answer") {
    if (typeof body.id !== "string" || body.id.length > 200) return json({ error: "soru kimliği geçersiz" }, 400);
    line = body.dismissed
      ? { type: "ask_answer", id: body.id, dismissed: true }
      : { type: "ask_answer", id: body.id, answers: (Array.isArray(body.answers) ? body.answers : []).map(String).slice(0, 20) };
  } else {
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 20000) return json({ error: "metin geçersiz" }, 400);
    line = { type: "user", content: body.text };
  }
  try {
    proc.stdin.write(`${JSON.stringify(line)}\n`);
    proc.stdin.flush();
  } catch {
    return json({ error: "çalışma girdisi kapalı" }, 409);
  }
  return json({ ok: true });
}

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

  // HTML sayfaları önbelleğe alınmasın: UI güncellemesi telefonda anında görünsün.
  const page = (file) => new Response(Bun.file(`${DIR}/${file}`), { headers: { "Cache-Control": "no-store" } });
  if (req.method === "GET" && url.pathname === "/") return page("app.html");
  if (req.method === "GET" && url.pathname === "/konsol") return page("panel.html");
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

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    const dir = await workspace(url.searchParams.get("cwd"));
    if (!dir) return json({ error: "klasör geçersiz" }, 400);
    return json({ cwd: dir, sessions: await listSessions(dir) });
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const messages = await readSession(url.searchParams.get("path"));
    if (!messages) return json({ error: "session yok" }, 404);
    return json(messages);
  }

  if (req.method === "GET" && url.pathname === "/api/bots") return json(await listBots());
  if (req.method === "POST" && url.pathname === "/api/bot") return saveBot(await req.json().catch(() => null));
  if (req.method === "POST" && url.pathname === "/api/bot/delete") return deleteBot((await req.json().catch(() => ({})))?.name);
  if (req.method === "POST" && url.pathname === "/api/chat") return chat(await req.json().catch(() => null));
  if (req.method === "POST" && url.pathname === "/api/music") return identifyMusic(await req.json().catch(() => null));

  if (req.method === "POST" && ["/api/answer", "/api/steer", "/api/stop"].includes(url.pathname)) {
    return runControl(url.pathname, await req.json().catch(() => null));
  }

  return new Response("not found", { status: 404 });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  // Varsayılan 10 sn: model yanıtı beklerken SSE akışını keserdi. 255 = Bun üst sınırı;
  // aradaki 15 sn'lik ping zaten bağlantıyı canlı tutar.
  idleTimeout: 255,
  async fetch(req) {
    try {
      return await handle(req);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
});
console.log(`konsol 127.0.0.1:${PORT}`);
