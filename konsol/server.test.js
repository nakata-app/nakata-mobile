import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildBotSystemPrompt,
	deleteBotInDir,
	listBotsInDir,
	loadBotFromDir,
	parseBotJson,
	resolveBotChatArgs,
	saveBotInDir,
	teachBotInDir,
} from "./bots.js";
import { createKonsolHandler } from "./server.js";

const dirs = [];
const mkTemp = () => {
	const d = mkdtempSync(join(tmpdir(), "konsol-bots-test-"));
	dirs.push(d);
	return d;
};

afterEach(() => {
	while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("konsol desktop-compatible bots store", () => {
	it("loads Desktop JSON bots, ignores scheduler/notify/task-* records, and blocks symlinks", () => {
		const dir = mkTemp();
		writeFileSync(
			join(dir, "Scout.json"),
			JSON.stringify({
				name: "Scout",
				role: "Code reviewer.",
				description: "Reviews diffs cleanly",
				model: "anthropic/claude-sonnet-4",
				color: "#38bdf8",
				face: "thinking",
				starters: ["Review my diff", "Find race conditions"],
				lessons: [
					{ text: "Keep answers short.", active: true, wins: 2, losses: 0 },
					{ text: "Retired lesson", active: false, wins: 0, losses: 3 },
				],
				rules: { do: ["Read"], ask: ["Bash"], never: ["WebSearch", "Edit"] },
			}),
		);
		// Non-bot files that live inside ~/.nakata/bots/ must never appear as bots.
		writeFileSync(join(dir, "scheduler.json"), JSON.stringify({ "task-1/once": { at: "2026-11-18T00:00:00Z" } }));
		writeFileSync(join(dir, "notify.json"), JSON.stringify({ whatsapp: { recipient: "123" } }));
		// Scheduled one-off task-* automations match Desktop is_chat_bot exclusion.
		writeFileSync(
			join(dir, "task-flight-watch.json"),
			JSON.stringify({ name: "task-flight-watch", role: "Check flights", at: "2026-12-01T10:00:00Z", task: "watch" }),
		);
		// Forged name mismatch and symlink must fail closed.
		writeFileSync(join(dir, "WrongName.json"), JSON.stringify({ name: "Other", role: "Evil" }));
		const outside = join(mkTemp(), "secret.json");
		writeFileSync(outside, JSON.stringify({ name: "SymlinkBot", role: "Leaked secret" }));
		symlinkSync(outside, join(dir, "SymlinkBot.json"));

		const list = listBotsInDir(dir);
		expect(list.map((b) => b.name)).toEqual(["Scout"]);
		const scout = list[0];
		expect(scout.persona).toBe("Code reviewer.");
		expect(scout.description).toBe("Reviews diffs cleanly");
		expect(scout.starters).toEqual(["Review my diff", "Find race conditions"]);
		expect(scout.lessons).toHaveLength(1);
		expect(scout.lessons[0].text).toBe("Keep answers short.");
		expect(parseBotJson("Scout", "{bad json")).toBeNull();
	});

	it("preserves CLI-owned fields when saving via Konsol and refuses symlinks", () => {
		const dir = mkTemp();
		writeFileSync(
			join(dir, "Reel.json"),
			JSON.stringify({
				name: "Reel",
				role: "Old role",
				routines: [{ id: "r1", cron: "0 9 * * *", prompt: "Check renders", enabled: true }],
				talksTo: ["Scout"],
				cwd: "/Users/macmini/Movies",
				rules: { do: ["Bash", "Read"], ask: [], never: ["Edit", "WebSearch"] },
				lessons: [{ text: "Keep originals intact", active: true }],
			}),
		);
		writeFileSync(join(dir, "Reel.md"), "---\nname: Reel\n---\nLegacy");

		const saved = saveBotInDir(
			{
				name: "Reel",
				description: "Video cutter",
				persona: "Cut and resize videos cleanly.",
				starters: ["Make 9:16 clip"],
			},
			dir,
		);
		expect(saved.ok).toBe(true);
		const disk = JSON.parse(readFileSync(join(dir, "Reel.json"), "utf8"));
		expect(disk.role).toBe("Cut and resize videos cleanly.");
		expect(disk.routines).toEqual([{ id: "r1", cron: "0 9 * * *", prompt: "Check renders", enabled: true }]);
		expect(disk.talksTo).toEqual(["Scout"]);
		expect(disk.cwd).toBe("/Users/macmini/Movies");
		expect(disk.rules.never).toEqual(["Edit", "WebSearch"]);
		expect(disk.lessons).toEqual([{ text: "Keep originals intact", active: true }]);

		// Invalid bot names fail before touching disk.
		expect(saveBotInDir({ name: "Bad Name", persona: "x" }, dir).ok).toBe(false);
		expect(saveBotInDir({ name: "../escape", persona: "x" }, dir).ok).toBe(false);

		// Symlink overwrite is refused.
		const target = join(mkTemp(), "target.json");
		writeFileSync(target, "untouched");
		symlinkSync(target, join(dir, "SymTarget.json"));
		const symAttempt = saveBotInDir({ name: "SymTarget", persona: "Do not overwrite" }, dir);
		expect(symAttempt.ok).toBe(false);
		expect(readFileSync(target, "utf8")).toBe("untouched");
	});

	it("builds prompts with active lessons and respects never-tool restrictions in chat mode", () => {
		const bot = {
			name: "Reel",
			persona: "Video editor",
			model: "qwen3-coder",
			lessons: [{ text: "Never overwrite source file.", active: true }],
			rules: { do: ["Bash"], ask: [], never: ["WebSearch", "Edit"] },
		};
		const prompt = buildBotSystemPrompt(bot);
		expect(prompt).toContain("You are Reel. Video editor");
		expect(prompt).toContain("Never overwrite source file.");
		expect(prompt).toContain("never use: WebSearch, Edit");

		const args = resolveBotChatArgs({ mode: "chat", bot });
		const onlyIdx = args.indexOf("--only-tools");
		expect(onlyIdx).toBeGreaterThan(-1);
		expect(args[onlyIdx + 1]).toBe("WebFetch,AskUserQuestion,ScheduleTask");
		expect(args).toContain("--model");
		expect(args).toContain("qwen3-coder");
	});

	it("teaches a rule persistently without duplicating", () => {
		const dir = mkTemp();
		saveBotInDir({ name: "Lex", persona: "Legal assistant" }, dir);
		const first = teachBotInDir("Lex", "Always cite article numbers.", dir);
		expect(first.ok).toBe(true);
		expect(first.added).toBe(true);
		const dup = teachBotInDir("Lex", "always cite article numbers.", dir);
		expect(dup.ok).toBe(true);
		expect(dup.added).toBe(false);
		const reloaded = loadBotFromDir("Lex", dir);
		expect(reloaded?.lessons).toHaveLength(1);
		expect(reloaded?.lessons[0].text).toBe("Always cite article numbers.");

		// Legacy `.md` bots seamlessly migrate to `.json` when taught a rule.
		writeFileSync(join(dir, "OldBot.md"), "---\nname: OldBot\ndescription: Legacy helper\n---\n\nBe direct.");
		const mdTeach = teachBotInDir("OldBot", "Use numbered steps.", dir);
		expect(mdTeach.ok).toBe(true);
		expect(mdTeach.added).toBe(true);
		const migrated = loadBotFromDir("OldBot", dir);
		expect(migrated?.format).toBe("json");
		expect(migrated?.lessons.map((l) => l.text)).toEqual(["Use numbered steps."]);
	});
});

describe("konsol HTTP API end-to-end", () => {
	it("enforces Tailscale owner header, CRUDs JSON bots, and passes bot flags to nakata CLI", async () => {
		const botsDir = mkTemp();
		const workDir = mkTemp();
		const captureFile = join(workDir, "cli-capture.json");
		const fakeCli = join(workDir, "fake-nakata.sh");
		writeFileSync(
			fakeCli,
			`#!/usr/bin/env python3
import json, sys
stdin_line = sys.stdin.readline().strip()
with open(${JSON.stringify(captureFile)}, "w") as f:
    json.dump({"argv": sys.argv[1:], "stdin": stdin_line}, f)
print(json.dumps({"type": "text", "content": "Scout yaniti."}), flush=True)
print(json.dumps({"type": "result", "session_id": "sess-12345678"}), flush=True)
`,
		);
		chmodSync(fakeCli, 0o755);

		const handle = createKonsolHandler({ owner: "owner@example.com", botsDir, nakataBin: fakeCli });
		const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle });
		const base = `http://127.0.0.1:${srv.port}`;
		const headers = { "Content-Type": "application/json", "tailscale-user-login": "owner@example.com" };

		try {
			const unauth = await fetch(`${base}/api/bots`);
			expect(unauth.status).toBe(403);

			const createRes = await fetch(`${base}/api/bot`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					name: "Scout",
					description: "Code audit",
					model: "deepseek-r1",
					persona: "Audit carefully.",
					starters: ["Check races"],
				}),
			});
			expect(createRes.status).toBe(200);

			const teachRes = await fetch(`${base}/api/bot/teach`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: "Scout", text: "Always list file and line." }),
			});
			expect((await teachRes.json()).added).toBe(true);

			const listRes = await fetch(`${base}/api/bots`, { headers });
			const list = await listRes.json();
			expect(list).toHaveLength(1);
			expect(list[0].lessons).toHaveLength(1);
			expect(list[0].starters).toEqual(["Check races"]);

			const chatRes = await fetch(`${base}/api/chat`, {
				method: "POST",
				headers,
				body: JSON.stringify({ prompt: "Selam", bot: "Scout", mode: "chat" }),
			});
			expect(chatRes.status).toBe(200);
			const sse = await chatRes.text();
			expect(sse).toContain("Scout yaniti.");

			const captured = JSON.parse(readFileSync(captureFile, "utf8"));
			expect(captured.argv).toContain("--model");
			expect(captured.argv).toContain("deepseek-r1");
			const sysIdx = captured.argv.indexOf("--append-system-prompt");
			expect(sysIdx).toBeGreaterThan(-1);
			expect(captured.argv[sysIdx + 1]).toContain("Always list file and line.");
			expect(JSON.parse(captured.stdin)).toEqual({ type: "user", content: "Selam" });

			const delRes = await fetch(`${base}/api/bot/delete`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: "Scout" }),
			});
			expect(delRes.status).toBe(200);
			expect(await (await fetch(`${base}/api/bots`, { headers })).json()).toEqual([]);
		} finally {
			srv.stop(true);
		}
	});
});
