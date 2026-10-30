// Copied from svelka-work apps/desktop/frontend/bot-orb.js (16d80333) with `export`
// dropped so it loads as a plain script; keep the two in step.
// Bot orb: a glossy glass sphere with two eyes — "one look, one expression".
// Pure SVG. Eyes blink naturally, can follow the pointer, and switch between
// 12 expressions; the sphere tints with the bot's color.

const ORB_EXPRESSIONS = [
	["neutral", "Neutral"],
	["attentive", "Attentive"],
	["happy", "Happy"],
	["excited", "Excited"],
	["curious", "Curious"],
	["thinking", "Thinking"],
	["surprised", "Surprised"],
	["sad", "Sad"],
	["angry", "Angry"],
	["unsure", "Unsure"],
	["wink", "Wink"],
	["sleepy", "Sleepy"],
	["sleeping", "Asleep"],
];

const NS = "http://www.w3.org/2000/svg";
const L = 77; // left eye center x
const R = 123; // right eye center x
const Y = 106; // eye center y

const pill = (cx, cy, w, h) => {
	const r = Math.min(w, h) / 2;
	const x = cx - w / 2;
	const y = cy - h / 2;
	return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
};
const arcUp = (cx, cy, w) => `M${cx - w / 2},${cy + 4}Q${cx},${cy - 12} ${cx + w / 2},${cy + 4}`;
const arcDown = (cx, cy, w) => `M${cx - w / 2},${cy - 3}Q${cx},${cy + 9} ${cx + w / 2},${cy - 3}`;

// Each expression: [leftPath, rightPath, stroke?] — stroke paths are drawn as
// lines (happy arcs, closed eyes); the rest are filled shapes.
const SHAPES = {
	neutral: () => [pill(L, Y, 20, 33), pill(R, Y, 20, 33)],
	attentive: () => [pill(L, Y - 2, 23, 38), pill(R, Y - 2, 23, 38)],
	happy: () => [arcUp(L, Y, 24), arcUp(R, Y, 24), true],
	excited: () => [pill(L, Y - 3, 25, 36), pill(R, Y - 3, 25, 36)],
	curious: () => [pill(L, Y + 3, 17, 25), pill(R, Y - 2, 23, 37)],
	thinking: () => [pill(L + 4, Y - 6, 17, 12), pill(R + 4, Y - 7, 17, 24)],
	surprised: () => [pill(L, Y, 27, 27), pill(R, Y, 27, 27)],
	sad: () => [
		`M${L - 9},${Y - 6}L${L + 8},${Y - 12}Q${L + 9},${Y + 14} ${L},${Y + 14}Q${L - 9},${Y + 14} ${L - 9},${Y - 6}Z`,
		`M${R + 9},${Y - 6}L${R - 8},${Y - 12}Q${R - 9},${Y + 14} ${R},${Y + 14}Q${R + 9},${Y + 14} ${R + 9},${Y - 6}Z`,
	],
	angry: () => [
		`M${L - 11},${Y - 12}L${L + 10},${Y - 2}Q${L + 10},${Y + 12} ${L},${Y + 12}Q${L - 11},${Y + 12} ${L - 11},${Y}Z`,
		`M${R + 11},${Y - 12}L${R - 10},${Y - 2}Q${R - 10},${Y + 12} ${R},${Y + 12}Q${R + 11},${Y + 12} ${R + 11},${Y}Z`,
	],
	wink: () => [pill(L, Y, 20, 33), arcUp(R, Y + 2, 24)],
	// Undecided: one eye open, the other squinting a little lower.
	unsure: () => [pill(L, Y - 1, 20, 31), pill(R + 1, Y + 6, 22, 13)],
	sleepy: () => [pill(L, Y + 4, 22, 8), pill(R, Y + 4, 22, 8)],
	sleeping: () => [arcDown(L, Y + 2, 22), arcDown(R, Y + 2, 22), true],
};

let seq = 0;

/**
 * Create an orb. Returns { el, set(expression), setColor(hex), destroy() }.
 * size: CSS px; follow: eyes track the pointer; blink: natural blinking.
 */
function createOrb({ size = 40, color = "#5b8cff", expression = "neutral", follow = false, blink = true } = {}) {
	const id = `orb${++seq}`;
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 200 200");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("bot-orb");
	svg.style.setProperty("--orb", color);
	svg.innerHTML = `
		<defs>
			<radialGradient id="${id}b" cx="46%" cy="38%" r="66%">
				<stop class="orb-b0" offset="0" stop-color="#1a2c47"/>
				<stop class="orb-b1" offset="0.5" stop-color="#0a1424"/>
				<stop class="orb-b2" offset="0.8" stop-color="#07101c"/>
				<stop offset="0.94" style="stop-color:color-mix(in srgb, var(--orb) 45%, #07101c)"/>
				<stop offset="1" style="stop-color:color-mix(in srgb, var(--orb) 75%, #ffffff)"/>
			</radialGradient>
			<radialGradient id="${id}g" cx="50%" cy="100%" r="70%">
				<stop offset="0" style="stop-color:var(--orb)" stop-opacity="0.38"/>
				<stop offset="1" style="stop-color:var(--orb)" stop-opacity="0"/>
			</radialGradient>
			<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/>
				<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
			</linearGradient>
			<filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="3.2" result="b"/>
				<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
			</filter>
		</defs>
		<ellipse class="orb-shadow" cx="100" cy="190" rx="48" ry="6" fill="#000" opacity="0.18"/>
		<circle cx="100" cy="98" r="84" fill="url(#${id}b)"/>
		<circle cx="100" cy="98" r="84" fill="url(#${id}g)"/>
		<path d="M52,62 C66,30 132,26 152,58 C132,46 76,44 52,62Z" fill="url(#${id}h)" opacity="0.85"/>
		<ellipse cx="64" cy="64" rx="9" ry="5" fill="#fff" opacity="0.55" transform="rotate(-35 64 64)"/>
		<circle class="orb-rim" cx="100" cy="98" r="83" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="1.5"/>
		<g class="orb-look"><g class="orb-eyes" filter="url(#${id}f)">
			<path class="orb-eye orb-eye-l"/><path class="orb-eye orb-eye-r"/>
		</g></g>
		<g class="orb-z" opacity="0"><text x="140" y="44" font-size="20" font-family="-apple-system,sans-serif" fill="#cfe0ff">z</text><text x="154" y="30" font-size="14" font-family="-apple-system,sans-serif" fill="#cfe0ff">z</text></g>`;
	const look = svg.querySelector(".orb-look");
	const eyes = svg.querySelector(".orb-eyes");
	const left = svg.querySelector(".orb-eye-l");
	const right = svg.querySelector(".orb-eye-r");
	const zz = svg.querySelector(".orb-z");
	let current = null;

	function paint(expr) {
		const [l, r, stroke] = (SHAPES[expr] || SHAPES.neutral)();
		const fill = expr === "angry" ? "#ff5d6c" : "#ffffff";
		for (const [el, d] of [[left, l], [right, r]]) {
			el.setAttribute("d", d);
			if (stroke || (expr === "wink" && el === right)) {
				el.setAttribute("fill", "none");
				el.setAttribute("stroke", fill);
				el.setAttribute("stroke-width", "6");
				el.setAttribute("stroke-linecap", "round");
			} else {
				el.setAttribute("fill", fill);
				el.removeAttribute("stroke");
			}
		}
		zz.setAttribute("opacity", expr === "sleeping" ? "1" : "0");
		svg.dataset.expression = expr;
	}
	function set(expr) {
		if (!SHAPES[expr] || expr === current) return;
		const first = current === null;
		current = expr;
		if (first || !svg.isConnected) return paint(expr);
		// A quick squint hides the shape swap — reads as a deliberate glance.
		eyes.classList.add("orb-squint");
		setTimeout(() => {
			paint(expr);
			eyes.classList.remove("orb-squint");
		}, 110);
	}
	set(expression);

	let blinkTimer = null;
	const scheduleBlink = () => {
		blinkTimer = setTimeout(() => {
			if (svg.isConnected && !["happy", "sleeping", "sleepy", "wink"].includes(current)) {
				eyes.classList.add("orb-blink");
				setTimeout(() => eyes.classList.remove("orb-blink"), 150);
			}
			scheduleBlink();
		}, 2400 + Math.random() * 3600);
	};
	if (blink) scheduleBlink();

	let onMove = null;
	if (follow) {
		onMove = (event) => {
			if (!svg.isConnected || current === "sleeping") return;
			const box = svg.getBoundingClientRect();
			const dx = event.clientX - (box.left + box.width / 2);
			const dy = event.clientY - (box.top + box.height / 2);
			const dist = Math.hypot(dx, dy) || 1;
			const k = Math.min(1, dist / 400);
			look.style.transform = `translate(${((dx / dist) * 11 * k).toFixed(2)}px, ${((dy / dist) * 8 * k).toFixed(2)}px)`;
		};
		window.addEventListener("pointermove", onMove, { passive: true });
	}

	return {
		el: svg,
		set,
		get expression() {
			return current;
		},
		setColor(hex) {
			svg.style.setProperty("--orb", hex);
		},
		destroy() {
			clearTimeout(blinkTimer);
			if (onMove) window.removeEventListener("pointermove", onMove);
			svg.remove();
		},
	};
}

/** A tiny, static eye-pair glyph for the expression picker. */
function expressionGlyph(expr) {
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "50 76 100 56");
	svg.setAttribute("width", "34");
	svg.setAttribute("height", "19");
	svg.setAttribute("aria-hidden", "true");
	const [l, r, stroke] = (SHAPES[expr] || SHAPES.neutral)();
	for (const [d, isRight] of [[l, false], [r, true]]) {
		const p = document.createElementNS(NS, "path");
		p.setAttribute("d", d);
		const color = expr === "angry" ? "#ff5d6c" : "currentColor";
		if (stroke || (expr === "wink" && isRight)) {
			p.setAttribute("fill", "none");
			p.setAttribute("stroke", color);
			p.setAttribute("stroke-width", "6");
			p.setAttribute("stroke-linecap", "round");
		} else p.setAttribute("fill", color);
		svg.append(p);
	}
	return svg;
}
