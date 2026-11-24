// Desktop-compatible (~/.nakata/bots/<name>.json & legacy .md) bot store and
// prompt/policy helpers shared between Nakata Konsol HTTP routes and unit tests.
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const LEGACY_MD_NAME_RE = /^[\p{L}\p{N} _-]{1,48}$/u;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FACE_RE = /^[a-z]{1,16}$/;
const MAX_BOT_FILE_BYTES = 1024 * 1024;
const MAX_PERSONA_CHARS = 20_000;
const MAX_LESSON_CHARS = 280;
const MAX_LESSONS = 30;
const CHAT_SAFE_TOOLS = ["WebSearch", "WebFetch", "AskUserQuestion", "ScheduleTask"];

export const defaultBotsDir = (home = process.env.HOME || homedir()) => join(home, ".nakata", "bots");
export const isValidBotName = (name) => typeof name === "string" && NAME_RE.test(name.trim());
export const isSafeLegacyMdName = (name) => typeof name === "string" && LEGACY_MD_NAME_RE.test(name.trim());

/** Read a bounded, non-symlink regular file without following links. */
function readRegularBounded(filePath, maxBytes = MAX_BOT_FILE_BYTES) {
	let fd;
	try {
		fd = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
		const st = fstatSync(fd);
		if (!st.isFile() || st.size > maxBytes) return null;
		const buf = Buffer.alloc(st.size);
		let offset = 0;
		while (offset < buf.length) {
			const n = readSync(fd, buf, offset, buf.length - offset, null);
			if (n === 0) return null;
			offset += n;
		}
		if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) return null;
		return buf.toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

function writePrivateAtomic(filePath, content) {
	const tmp = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
	let fd;
	try {
		fd = openSync(tmp, "wx", 0o600);
		writeFileSync(fd, content, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(tmp, filePath);
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {}
		}
		rmSync(tmp, { force: true });
	}
}

function cleanStringList(items, limit, maxLen) {
	if (!Array.isArray(items)) return [];
	const out = [];
	const seen = new Set();
	for (const raw of items) {
		if (typeof raw !== "string") continue;
		const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLen);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function normalizeRules(rules) {
	const r = rules && typeof rules === "object" && !Array.isArray(rules) ? rules : {};
	return {
		do: cleanStringList(r.do, 24, 60),
		ask: cleanStringList(r.ask, 24, 60),
		never: cleanStringList(r.never, 24, 60),
	};
}

function normalizeLessons(lessons) {
	if (!Array.isArray(lessons)) return [];
	const out = [];
	for (const item of lessons) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const text = typeof item.text === "string" ? item.text.trim().slice(0, MAX_LESSON_CHARS) : "";
		if (!text) continue;
		out.push({
			text,
			source: typeof item.source === "string" ? item.source : "feedback",
			wins: Number.isFinite(item.wins) ? item.wins : 0,
			losses: Number.isFinite(item.losses) ? item.losses : 0,
			createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
			active: item.active !== false,
		});
		if (out.length >= MAX_LESSONS) break;
	}
	return out;
}

/** Parse a Desktop/CLI `~/.nakata/bots/<name>.json` record; returns null for non-bot configs. */
export function parseBotJson(stem, text) {
	if (!isValidBotName(stem)) return null;
	let obj;
	try {
		obj = JSON.parse(text);
	} catch {
		return null;
	}
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
	if (obj.name !== stem) return null;
	const role = typeof obj.role === "string" ? obj.role.trim() : "";
	if (!role) return null;
	const hasStr = (k) => typeof obj[k] === "string" && obj[k].trim().length > 0;
	const scheduled = Boolean(
		hasStr("schedule") ||
			hasStr("at") ||
			(Array.isArray(obj.routines) && obj.routines.some((r) => r && r.enabled !== false)),
	);
	if (scheduled && stem.startsWith("task-")) return null;
	const active = normalizeLessons(obj.lessons).filter((l) => l.active !== false);
	return {
		name: stem,
		description: typeof obj.description === "string" ? obj.description.trim() : "",
		model: typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : null,
		persona: role,
		rules: normalizeRules(obj.rules),
		lessons: active,
		learn: obj.learn !== false,
		starters: cleanStringList(obj.starters, 4, 160),
		color: typeof obj.color === "string" && HEX_COLOR_RE.test(obj.color.trim()) ? obj.color.trim() : null,
		face: typeof obj.face === "string" && FACE_RE.test(obj.face.trim()) ? obj.face.trim() : null,
		cwd: typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : null,
		scheduled,
		format: "json",
	};
}

/** Legacy `.md` fallback reader matching Desktop `parse_bot_md`. */
export function parseBotMd(stem, text) {
	if (!isSafeLegacyMdName(stem)) return null;
	let description = "";
	let model = null;
	let ask = [];
	const trimmed = String(text ?? "").trimStart();
	let persona = trimmed;
	if (trimmed.startsWith("---")) {
		const end = trimmed.indexOf("\n---", 3);
		if (end >= 0) {
			persona = trimmed.slice(end + 4).replace(/^[\r\n]+/, "");
			for (const line of trimmed.slice(3, end).split("\n")) {
				const i = line.indexOf(":");
				if (i < 0) continue;
				const k = line.slice(0, i).trim();
				const v = line.slice(i + 1).trim().replace(/^"|"$/g, "");
				if (k === "description") description = v;
				else if (k === "model" && v) model = v;
				else if (k === "tools" && v) ask = v.split(",").map((t) => t.trim()).filter(Boolean);
			}
		}
	}
	if (!persona.trim()) return null;
	return {
		name: stem.trim(),
		description,
		model,
		persona: persona.trim(),
		rules: { do: [], ask, never: [] },
		lessons: [],
		learn: true,
		starters: [],
		color: null,
		face: null,
		cwd: null,
		scheduled: false,
		format: "md",
	};
}

/** List all chat bots in `dir`, preferring Desktop JSON records over legacy `.md`. */
export function listBotsInDir(dir = defaultBotsDir()) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	const stems = [];
	const seen = new Set();
	for (const file of entries) {
		if (!file.endsWith(".json") && !file.endsWith(".md")) continue;
		const stem = file.endsWith(".json") ? file.slice(0, -5) : file.slice(0, -3);
		if (!seen.has(stem)) {
			seen.add(stem);
			stems.push(stem);
		}
	}
	const out = [];
	for (const stem of stems) {
		const bot = loadBotFromDir(stem, dir);
		if (bot) out.push(bot);
	}
	return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Load one bot by name (`<name>.json` first, then legacy `<name>.md`). */
export function loadBotFromDir(name, dir = defaultBotsDir()) {
	if (typeof name !== "string") return null;
	const stem = name.trim();
	if (isValidBotName(stem)) {
		const jsonText = readRegularBounded(join(dir, `${stem}.json`));
		if (jsonText !== null) {
			const parsed = parseBotJson(stem, jsonText);
			if (parsed) return parsed;
		}
	}
	if (isSafeLegacyMdName(stem)) {
		const mdText = readRegularBounded(join(dir, `${stem}.md`));
		if (mdText !== null) return parseBotMd(stem, mdText);
	}
	return null;
}

/** Save a bot in canonical Desktop `<name>.json` format while preserving CLI-owned fields. */
export function saveBotInDir(payload, dir = defaultBotsDir()) {
	const name = typeof payload?.name === "string" ? payload.name.trim() : "";
	if (!isValidBotName(name)) {
		return { ok: false, status: 400, error: "bot adı 1-40 [A-Za-z0-9_-] olmalı (boşluk yok)" };
	}
	const persona = typeof payload?.persona === "string" ? payload.persona.trim() : "";
	if (!persona) return { ok: false, status: 400, error: "persona (talimat) gerekli" };
	if (persona.length > MAX_PERSONA_CHARS) return { ok: false, status: 400, error: "persona çok uzun" };

	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const jsonPath = join(dir, `${name}.json`);
	try {
		if (lstatSync(jsonPath).isSymbolicLink()) {
			return { ok: false, status: 400, error: "bot dosyası güvenli değil" };
		}
	} catch {}
	let doc = {};
	const existingRaw = readRegularBounded(jsonPath);
	if (existingRaw !== null) {
		try {
			const parsed = JSON.parse(existingRaw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) doc = parsed;
		} catch {}
	}

	const nextDoc = {
		...doc,
		name,
		role: persona,
		rules: doc.rules && !payload.rules ? normalizeRules(doc.rules) : normalizeRules(payload.rules ?? doc.rules),
		lessons: Array.isArray(doc.lessons) ? doc.lessons : [],
		learn: typeof doc.learn === "boolean" ? doc.learn : true,
	};

	const desc = typeof payload.description === "string" ? payload.description.trim().slice(0, 200) : "";
	if (desc) nextDoc.description = desc;
	else if (payload.description !== undefined) delete nextDoc.description;

	const model = typeof payload.model === "string" ? payload.model.trim().slice(0, 120) : "";
	if (model) nextDoc.model = model;
	else if (payload.model !== undefined) delete nextDoc.model;

	if (payload.starters !== undefined) {
		const starters = cleanStringList(payload.starters, 4, 160);
		if (starters.length) nextDoc.starters = starters;
		else delete nextDoc.starters;
	}
	if (typeof payload.color === "string" && HEX_COLOR_RE.test(payload.color.trim())) {
		nextDoc.color = payload.color.trim();
	}
	if (typeof payload.face === "string" && FACE_RE.test(payload.face.trim())) {
		nextDoc.face = payload.face.trim();
	}
	if (typeof payload.cwd === "string") {
		const cleanCwd = payload.cwd.replace(/[\u0000-\u001f\u007f]/g, "").trim();
		if (cleanCwd.length > 512) return { ok: false, status: 400, error: "çalışma klasörü yolu çok uzun" };
		if (cleanCwd) nextDoc.cwd = cleanCwd;
		else delete nextDoc.cwd;
	}

	writePrivateAtomic(jsonPath, `${JSON.stringify(nextDoc, null, 2)}\n`);
	// Clean legacy `.md` counterpart if this bot migrated to `.json`.
	const mdPath = join(dir, `${name}.md`);
	if (readRegularBounded(mdPath) !== null) {
		try {
			unlinkSync(mdPath);
		} catch {}
	}
	return { ok: true, bot: parseBotJson(name, JSON.stringify(nextDoc)) };
}

/** Delete a bot (`<name>.json` and optional legacy `<name>.md`). */
export function deleteBotInDir(name, dir = defaultBotsDir()) {
	if (!isSafeLegacyMdName(name)) return { ok: false, status: 400, error: "ad geçersiz" };
	const stem = name.trim();
	for (const ext of [".json", ".md"]) {
		const target = join(dir, `${stem}${ext}`);
		if (readRegularBounded(target) !== null) {
			try {
				unlinkSync(target);
			} catch {}
		}
	}
	return { ok: true };
}

function parseEditableBotDoc(raw, stem) {
	let doc;
	try {
		doc = JSON.parse(raw);
	} catch {
		return { ok: false, status: 400, error: "bot dosyası okunamadı" };
	}
	if (!doc || typeof doc !== "object" || doc.name !== stem || typeof doc.role !== "string") {
		return { ok: false, status: 404, error: "bot yok" };
	}
	const lessons = Array.isArray(doc.lessons) ? doc.lessons.filter((l) => l && typeof l.text === "string") : [];
	return { ok: true, doc, lessons };
}

/** Persist a new learned rule/lesson onto an existing Desktop JSON bot. */
export function teachBotInDir(name, text, dir = defaultBotsDir(), source = "konsol") {
	if (!isValidBotName(name)) return { ok: false, status: 400, error: "ad geçersiz" };
	const clean = typeof text === "string" ? text.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_LESSON_CHARS) : "";
	if (clean.length < 3) return { ok: false, status: 400, error: "ders metni en az 3 karakter olmalı" };
	const stem = name.trim();
	const jsonPath = join(dir, `${stem}.json`);
	let raw = readRegularBounded(jsonPath);
	if (raw === null) {
		// Migrate legacy `<name>.md` bot cleanly to `<name>.json` so `/teach` works uniformly.
		const mdPath = join(dir, `${stem}.md`);
		const mdText = readRegularBounded(mdPath);
		if (mdText !== null) {
			const parsedMd = parseBotMd(stem, mdText);
			if (parsedMd) {
				const migrated = saveBotInDir(
					{
						name: stem,
						description: parsedMd.description,
						model: parsedMd.model || undefined,
						persona: parsedMd.persona,
						rules: parsedMd.rules,
					},
					dir,
				);
				if (migrated.ok) raw = readRegularBounded(jsonPath);
			}
		}
		if (raw === null) return { ok: false, status: 404, error: "bot yok" };
	}
	const parsed = parseEditableBotDoc(raw, stem);
	if (!parsed.ok) return parsed;
	const { doc, lessons } = parsed;
	const dup = lessons.find((l) => l.active !== false && l.text.trim().toLowerCase() === clean.toLowerCase());
	if (!dup) {
		lessons.push({
			text: clean,
			source,
			wins: 0,
			losses: 0,
			createdAt: new Date().toISOString().slice(0, 10),
			active: true,
		});
	}
	doc.lessons = lessons.slice(-MAX_LESSONS);
	writePrivateAtomic(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
	return { ok: true, added: !dup, bot: parseBotJson(stem, JSON.stringify(doc)) };
}

/** Deactivate a learned rule/lesson on an existing Desktop JSON bot by 1-based index or text match. */
export function forgetBotLessonInDir(name, query, dir = defaultBotsDir()) {
	if (!isValidBotName(name)) return { ok: false, status: 400, error: "ad geçersiz" };
	const needle = typeof query === "number" ? String(query) : typeof query === "string" ? query.trim() : "";
	if (!needle) return { ok: false, status: 400, error: "silinecek kural belirtilmedi" };
	const stem = name.trim();
	const jsonPath = join(dir, `${stem}.json`);
	const raw = readRegularBounded(jsonPath);
	if (raw === null) return { ok: false, status: 404, error: "bot yok" };
	const parsed = parseEditableBotDoc(raw, stem);
	if (!parsed.ok) return parsed;
	const { doc, lessons } = parsed;
	const activeIndices = [];
	for (let i = 0; i < lessons.length; i++) {
		if (lessons[i].active !== false && lessons[i].text.trim()) activeIndices.push(i);
	}
	let matchIdx = -1;
	if (/^\d+$/.test(needle)) {
		const oneBased = Number.parseInt(needle, 10);
		if (oneBased >= 1 && oneBased <= activeIndices.length) matchIdx = activeIndices[oneBased - 1];
	} else {
		const low = needle.toLowerCase();
		matchIdx = activeIndices.find((idx) => lessons[idx].text.trim().toLowerCase() === low) ?? -1;
		if (matchIdx === -1) {
			matchIdx = activeIndices.find((idx) => lessons[idx].text.trim().toLowerCase().includes(low)) ?? -1;
		}
	}
	if (matchIdx === -1) return { ok: false, status: 404, error: "eşleşen kural yok" };
	const forgotten = lessons[matchIdx].text.trim();
	lessons[matchIdx] = { ...lessons[matchIdx], active: false };
	doc.lessons = lessons.slice(-MAX_LESSONS);
	writePrivateAtomic(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
	return { ok: true, forgotten, bot: parseBotJson(stem, JSON.stringify(doc)) };
}

/** Compose the bot system prompt matching Desktop (`persona` + active `lessons` + safety notes). */
export function buildBotSystemPrompt(bot) {
	if (!bot) return "";
	const parts = [`You are ${bot.name}. ${bot.persona || ""}`.trim()];
	const learned = (bot.lessons || []).filter((l) => l && l.active !== false && l.text);
	if (learned.length) {
		parts.push(`Lessons learned from this user's feedback (follow them):\n${learned.map((l) => `- ${l.text}`).join("\n")}`);
	}
	const never = bot.rules?.never || [];
	if (never.length) parts.push(`Tool restrictions — never use: ${never.join(", ")}.`);
	return parts.filter(Boolean).join("\n\n");
}

/** Build CLI arguments for Konsol chat respecting `mode` and the bot's `never` tool rules. */
export function resolveBotChatArgs({ mode = "chat", sessionId = null, model = null, bot = null }) {
	const chat = mode === "chat";
	const neverSet = new Set((bot?.rules?.never || []).map((t) => String(t).trim()).filter(Boolean));
	const args = [
		"--output-format", "stream-json", "--input-format", "stream-json", "--ask-stdin",
		"--permission-mode", chat ? "default" : mode,
	];
	if (chat) {
		const allowed = CHAT_SAFE_TOOLS.filter((tool) => !neverSet.has(tool));
		if (allowed.length > 0) {
			args.push("--only-tools", allowed.join(","));
			if (allowed.includes("ScheduleTask")) args.push("--allowedTools", "ScheduleTask");
		} else {
			args.push("--disallowedTools", CHAT_SAFE_TOOLS.join(","));
		}
	} else if (neverSet.size > 0) {
		args.push("--disallowedTools", [...neverSet].join(","));
	}
	const persona = buildBotSystemPrompt(bot);
	if (persona) args.push("--append-system-prompt", persona);
	if (sessionId) args.push("--resume", sessionId);
	const effectiveModel = model || bot?.model || null;
	if (effectiveModel) args.push("--model", effectiveModel);
	return args;
}
