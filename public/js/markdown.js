/* ---- markdown (escaped first; only http(s) links) ---- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
function stripEmDashes(raw){
  const urls = [];
  let s = String(raw ?? "").replace(/https?:\/\/(?:[^\s()]+|\([^\s()]*\))+/g, (u) => {
    urls.push(u);
    return "\u0000U" + (urls.length - 1) + "\u0000";
  });
  s = s
    .replace(/(\*\*[^*\n]+\*\*)\s*[—–]\s*/g, "$1: ")
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    .replace(/([,;:!?])\s*—\s*/g, "$1 ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/:\s*,/g, ":");
  return s.replace(/\u0000U(\d+)\u0000/g, (_m, idx) => urls[+idx] || "");
}
function cleanCitations(s){
  return String(s ?? "").replace(/\[(\d{1,2})\](?=\s|$|[.,;:!?])/g, "").replace(/\s+([.,;:!?])/g, "$1");
}
function detectConvLang(userText = "", replyText = ""){
  const sample = (String(userText || "") + " " + String(replyText || "")).trim();
  if (!sample) return LANG;
  if (/[çğıöşüÇĞİÖŞÜ]/.test(sample)) return "tr";
  const trHits = (sample.match(/\b(?:nedir|nasil|neden|hangi|icin|ile|bir|veya|olarak|karsilastir|ozetle|anlat|oner|fiyat|kac|nerede|yap|yaz|ver|degil|ama|gibi|daha|cok|iyi|var|yok|ben|sen|bana|bunu|sunu|hakkinda|merhaba|selam|tamam|evet|hayir|tesekkur|lutfen|tablo|secenek)\b/gi) || []).length;
  const enHits = (sample.match(/\b(?:the|and|for|with|that|this|from|what|which|how|compare|summary|price|best|option|table|explain|write|please|hello|thanks|should|would|between)\b/gi) || []).length;
  if (trHits >= 2 && trHits >= enHits) return "tr";
  if (enHits >= 2 && enHits > trHits) return "en";
  return LANG;
}
function stripMarkdownForSpeech(raw){
  return stripEmDashes(String(raw ?? ""))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*\|?\s*:?-{1,}:?(?:\s*\|\s*:?-{1,}:?)+\s*\|?\s*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/[#*_`>~]/g, " ")
    .replace(/\s*(?:\[\d+\]|\(\d+\))(?=[.,\s]|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function srcMonogram(host){
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const ch = (h.match(/[a-z0-9]/i)?.[0] || "W").toUpperCase();
  return { ch, bg: `hsl(${hue},52%,36%)` };
}
function parseSortableNumber(raw){
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^[^\d+-]*([+-]?\d[\d.,]*)(?:\s*(?:%|tl|try|usd|eur|gbp|gb|tb|mb|kb|ghz|mhz|ms|sn|s|w|hz|gb\/s|km|m|kg|₺|\$|€|£))?$/i);
  if (!m) return null;
  let num = m[1];
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(num)) num = num.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(num)) num = num.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(num)) num = num.replace(",", ".");
  const parsed = Number(num);
  return Number.isFinite(parsed) ? parsed : null;
}
function compareTableCells(a, b){
  const na = parseSortableNumber(a), nb = parseSortableNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}
function sortTableByColumn(tbl, colIdx){
  if (!tbl || colIdx < 0) return null;
  const tbody = tbl.querySelector("tbody");
  const ths = Array.from(tbl.querySelectorAll("thead th"));
  if (!tbody || !ths[colIdx]) return null;
  const nextDir = ths[colIdx].getAttribute("data-sort-dir") === "asc" ? "desc" : "asc";
  const rows = Array.from(tbody.querySelectorAll("tr"));
  rows.sort((ra, rb) => {
    const ca = ra.querySelectorAll("td")[colIdx]?.textContent || "";
    const cb = rb.querySelectorAll("td")[colIdx]?.textContent || "";
    const cmp = compareTableCells(ca, cb);
    return nextDir === "asc" ? cmp : -cmp;
  });
  for (const r of rows) tbody.append(r);
  ths.forEach((th, idx) => {
    if (idx === colIdx) { th.setAttribute("data-sort-dir", nextDir); th.setAttribute("aria-sort", nextDir === "asc" ? "ascending" : "descending"); }
    else { th.removeAttribute("data-sort-dir"); th.setAttribute("aria-sort", "none"); }
  });
  return nextDir;
}
function tableToText(tbl, format){
  return Array.from(tbl.querySelectorAll("tr")).filter((tr) => !tr.hidden && !tr.closest?.("tfoot")).map((tr) => Array.from(tr.querySelectorAll("th,td")).map((c) => {
    const v = String(c.textContent || "").replace(/\s+/g, " ").trim();
    if (format === "csv") return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    return v;
  }).join(format === "csv" ? "," : "\t")).join("\n");
}
function tableToMarkdown(tbl){
  if (!tbl) return "";
  const ths = Array.from(tbl.querySelectorAll("thead th"));
  if (!ths.length) return "";
  const escCell = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  const headers = ths.map((th) => escCell(th.textContent));
  const aligns = ths.map((th) => {
    const al = String(th.style?.textAlign || "").toLowerCase();
    return al === "right" ? "---:" : al === "center" ? ":---:" : ":---";
  });
  const bodyRows = Array.from(tbl.querySelectorAll("tbody tr")).filter((tr) => !tr.hidden);
  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const tr of bodyRows) {
    const tds = Array.from(tr.querySelectorAll("td"));
    lines.push(`| ${headers.map((_, i) => escCell(tds[i]?.textContent || "")).join(" | ")} |`);
  }
  return lines.join("\n");
}
function parseNumericUnit(raw){
  const val = parseSortableNumber(raw);
  if (val === null) return null;
  const s = String(raw || "").trim();
  const pref = s.match(/^([₺$€£])/);
  const suff = s.match(/\s*(%|tl|try|usd|eur|gbp|gb\/s|gb|tb|mb|kb|ghz|mhz|ms|sn|s|w|hz|km|m|kg|₺|\$|€|£)$/i);
  return { val, prefix: pref ? pref[1] : "", suffix: suff ? suff[1] : "" };
}
function fmtSummaryNum(n){
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r);
}
function computeTableSummary(tbl){
  if (!tbl) return { visibleRows: 0, columns: [] };
  const ths = Array.from(tbl.querySelectorAll("thead th"));
  const allRows = Array.from(tbl.querySelectorAll("tbody tr"));
  const visRows = allRows.filter((tr) => !tr.hidden);
  const columns = [];
  let labeledFirst = false;
  for (let c = 0; c < ths.length; c++) {
    let totalNum = 0;
    for (const r of allRows) if (parseSortableNumber(r.querySelectorAll("td")[c]?.textContent || "") !== null) totalNum++;
    if (totalNum < 2) {
      let label = "";
      if (!labeledFirst) { labeledFirst = true; label = LANG === "en" ? `Summary (${visRows.length})` : `Özet (${visRows.length})`; }
      columns.push({ numeric: false, count: 0, label });
      continue;
    }
    const parsed = [];
    for (const r of visRows) { const p = parseNumericUnit(r.querySelectorAll("td")[c]?.textContent || ""); if (p) parsed.push(p); }
    if (!parsed.length) { columns.push({ numeric: true, count: 0, label: "—" }); continue; }
    const vals = parsed.map((p) => p.val);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals), max = Math.max(...vals);
    const pref = parsed.every((p) => p.prefix === parsed[0].prefix) ? parsed[0].prefix : "";
    const suff = parsed.every((p) => p.suffix.toLowerCase() === parsed[0].suffix.toLowerCase()) ? parsed[0].suffix : "";
    const wrap = (numStr) => (pref ? pref : "") + numStr + (suff ? (suff === "%" ? "%" : " " + suff) : "");
    const label = parsed.length === 1 ? wrap(fmtSummaryNum(avg)) : `Ø ${wrap(fmtSummaryNum(avg))} (${fmtSummaryNum(min)}–${fmtSummaryNum(max)})`;
    columns.push({ numeric: true, count: parsed.length, avg, min, max, label });
  }
  return { visibleRows: visRows.length, columns };
}
function updateTableSummary(tbl){
  if (!tbl) return null;
  const tfoot = tbl.querySelector("tfoot.md-table-summary");
  if (!tfoot) return null;
  const summary = computeTableSummary(tbl);
  const ths = Array.from(tbl.querySelectorAll("thead th"));
  const trEl = tfoot.querySelector("tr");
  if (trEl) {
    trEl.replaceChildren();
    summary.columns.forEach((col, i) => {
      const td = document.createElement("td");
      if (ths[i]?.style?.textAlign) td.style.textAlign = ths[i].style.textAlign;
      td.textContent = col.label;
      trEl.append(td);
    });
  }
  return summary;
}
function toggleTableSummary(tbl, btn = null){
  if (!tbl) return false;
  const existing = tbl.querySelector("tfoot.md-table-summary");
  if (existing) { existing.remove(); if (btn) btn.setAttribute("aria-pressed", "false"); return false; }
  const summary = computeTableSummary(tbl);
  if (!summary.columns.some((c) => c.numeric)) return false;
  const tfoot = document.createElement("tfoot"); tfoot.className = "md-table-summary";
  tfoot.append(document.createElement("tr"));
  tbl.append(tfoot);
  updateTableSummary(tbl);
  if (btn) btn.setAttribute("aria-pressed", "true");
  return true;
}
function filterTableRows(tbl, query, metaEl = null){
  if (!tbl) return { visible: 0, total: 0 };
  const q = String(query || "").trim().toLowerCase();
  const rows = Array.from(tbl.querySelectorAll("tbody tr"));
  const cols = tbl.querySelectorAll("thead th").length;
  let visible = 0;
  for (const r of rows) {
    const hit = !q || String(r.textContent || "").toLowerCase().includes(q);
    r.hidden = !hit;
    if (hit) visible++;
  }
  if (metaEl) {
    const total = rows.length;
    metaEl.textContent = LANG === "en"
      ? (q ? `${visible}/${total} rows · ${cols} cols` : `${total} ${total === 1 ? "row" : "rows"} · ${cols} ${cols === 1 ? "col" : "cols"}`)
      : (q ? `${visible}/${total} satır · ${cols} sütun` : `${total} satır · ${cols} sütun`);
  }
  updateTableSummary(tbl);
  return { visible, total: rows.length };
}
function downloadTableCsv(tbl, badgeText, ord = ""){
  const csv = tableToText(tbl, "csv");
  const slug = slugifyFilename(badgeText || "tablo", "tablo", 40);
  triggerBlobDownload("\uFEFF" + csv, "text/csv;charset=utf-8", "nakata-" + slug + ord + ".csv");
}
function sanitizeSvg(raw){
  let s = raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const m = s.match(/<svg\b[\s\S]*?<\/svg>/i);
  if (m) s = m[0];
  if (!/\bxmlns\s*=/.test(s.slice(0, 120))) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}
const MATH_SYMBOLS = {
  alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",varepsilon:"ε",zeta:"ζ",eta:"η",theta:"θ",vartheta:"ϑ",
  iota:"ι",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",pi:"π",varpi:"ϖ",rho:"ρ",sigma:"σ",varsigma:"ς",tau:"τ",
  upsilon:"υ",phi:"φ",varphi:"ϕ",chi:"χ",psi:"ψ",omega:"ω",Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",
  Pi:"Π",Sigma:"Σ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",infty:"∞",partial:"∂",nabla:"∇",sum:"∑",prod:"∏",int:"∫",oint:"∮",
  times:"×",cdot:"·",div:"÷",pm:"±",mp:"∓",le:"≤",leq:"≤",ge:"≥",geq:"≥",neq:"≠",approx:"≈",equiv:"≡",sim:"∼",
  to:"→",rightarrow:"→",leftarrow:"←",Rightarrow:"⇒",Leftarrow:"⇐",leftrightarrow:"↔",iff:"⟺",in:"∈",notin:"∉",
  subset:"⊂",subseteq:"⊆",cup:"∪",cap:"∩",land:"∧",lor:"∨",forall:"∀",exists:"∃",neg:"¬",emptyset:"∅",
  ldots:"…",cdots:"⋯",vert:"|",Vert:"‖",angle:"∠",degree:"°",
};
function readMathArg(st){
  while (st.i < st.s.length && /\s/.test(st.s[st.i])) st.i++;
  if (st.s[st.i] === "{") { st.i++; return "<mrow>" + readMathSeq(st, true) + "</mrow>"; }
  return readMathAtom(st);
}
function readMathTextArg(st){
  while (st.i < st.s.length && /\s/.test(st.s[st.i])) st.i++;
  if (st.s[st.i] !== "{") return "";
  st.i++; const start = st.i; let depth = 1;
  while (st.i < st.s.length && depth) { const c = st.s[st.i++]; if (c === "{") depth++; else if (c === "}") depth--; }
  return st.s.slice(start, Math.max(start, st.i - 1));
}
function readMathCmd(st){
  st.i++; if (st.i >= st.s.length) return "<mo>\\</mo>";
  if (!/[A-Za-z]/.test(st.s[st.i])) {
    const ch = st.s[st.i++];
    const map = { ",":'<mspace width="0.167em"/>', ";":'<mspace width="0.278em"/>', ":":'<mspace width="0.222em"/>', "!":'<mspace width="-0.167em"/>', " ":'<mspace width="0.333em"/>', "%":"<mo>%</mo>", "$":"<mo>$</mo>", "{":"<mo>{</mo>", "}":"<mo>}</mo>" };
    return map[ch] || "<mo>" + esc(ch) + "</mo>";
  }
  const start = st.i; while (st.i < st.s.length && /[A-Za-z]/.test(st.s[st.i])) st.i++;
  const cmd = st.s.slice(start, st.i);
  if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") return "<mfrac>" + readMathArg(st) + readMathArg(st) + "</mfrac>";
  if (cmd === "sqrt") {
    while (/\s/.test(st.s[st.i] || "")) st.i++;
    let idx = "";
    if (st.s[st.i] === "[") { st.i++; const b = st.i; while (st.i < st.s.length && st.s[st.i] !== "]") st.i++; idx = st.s.slice(b, st.i); if (st.s[st.i] === "]") st.i++; }
    const rad = readMathArg(st);
    return idx ? "<mroot>" + rad + "<mn>" + esc(idx) + "</mn></mroot>" : "<msqrt>" + rad + "</msqrt>";
  }
  if (cmd === "text" || cmd === "textrm" || cmd === "textnormal") return "<mtext>" + esc(readMathTextArg(st)).replace(/\s+/g, " ") + "</mtext>";
  if (cmd === "mathrm" || cmd === "mathbf" || cmd === "mathit" || cmd === "mathsf" || cmd === "mathtt") {
    const v = { mathrm:"normal", mathbf:"bold", mathit:"italic", mathsf:"sans-serif", mathtt:"monospace" }[cmd];
    return '<mstyle mathvariant="' + v + '">' + readMathArg(st) + "</mstyle>";
  }
  if (/^(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|exp|lim|max|min|sup|inf|det|Pr)$/.test(cmd)) return '<mi mathvariant="normal">' + esc(cmd) + "</mi>";
  if (cmd === "quad") return '<mspace width="1em"/>';
  if (cmd === "qquad") return '<mspace width="2em"/>';
  if (cmd === "left" || cmd === "right" || cmd === "displaystyle" || cmd === "limits" || cmd === "nolimits") return "";
  if (Object.prototype.hasOwnProperty.call(MATH_SYMBOLS, cmd)) {
    const sym = MATH_SYMBOLS[cmd];
    return /^(?:sum|prod|int|oint)$/.test(cmd) ? "<mo>" + sym + "</mo>" : "<mi>" + sym + "</mi>";
  }
  return "<mi>" + esc("\\" + cmd) + "</mi>";
}
function readMathAtom(st){
  const c = st.s[st.i]; if (c === undefined) return "";
  if (c === "{") { st.i++; return "<mrow>" + readMathSeq(st, true) + "</mrow>"; }
  if (c === "\\") return readMathCmd(st);
  if (c === "}") return "";
  if (/[0-9]/.test(c)) { const b = st.i++; while (st.i < st.s.length && /[0-9.]/.test(st.s[st.i])) st.i++; return "<mn>" + esc(st.s.slice(b, st.i)) + "</mn>"; }
  if (/[A-Za-z]/.test(c)) { st.i++; return "<mi>" + esc(c) + "</mi>"; }
  st.i++;
  if (c === " ") return '<mspace width="0.25em"/>';
  return "<mo>" + esc(c) + "</mo>";
}
function readMathSeq(st, stopAtBrace = false){
  const items = [];
  while (st.i < st.s.length) {
    const c = st.s[st.i];
    if (c === "}") { if (stopAtBrace) st.i++; break; }
    if (c === "^" || c === "_") { items.push("<mo>" + esc(st.s[st.i++]) + "</mo>"); continue; }
    let base = readMathAtom(st); if (!base) { st.i++; continue; }
    let sub = null, sup = null;
    while (st.i < st.s.length && (st.s[st.i] === "_" || st.s[st.i] === "^")) {
      const mk = st.s[st.i++], val = readMathArg(st);
      if (mk === "_") sub = val; else sup = val;
    }
    if (sub !== null && sup !== null) base = "<msubsup>" + base + sub + sup + "</msubsup>";
    else if (sub !== null) base = "<msub>" + base + sub + "</msub>";
    else if (sup !== null) base = "<msup>" + base + sup + "</msup>";
    items.push(base);
  }
  return items.length > 1 ? "<mrow>" + items.join("") + "</mrow>" : (items[0] || "");
}
function texToHtml(raw, display = false){
  const input = String(raw || "").trim().slice(0, 2000);
  if (!input) return "";
  return '<math xmlns="http://www.w3.org/1998/Math/MathML"' + (display ? ' display="block"' : "") + ">" + readMathSeq({ s: input, i: 0 }, false) + "</math>";
}
const CODE_KW = new Set(["function","const","let","var","return","if","else","for","while","do","switch","case","break","continue","class","extends","new","this","super","import","export","from","default","async","await","try","catch","finally","throw","typeof","instanceof","in","of","yield","static","interface","type","enum","public","private","protected","readonly","fn","impl","struct","trait","pub","mut","use","mod","match","loop","def","elif","None","True","False","self","lambda","with","pass","raise","except","true","false","null","undefined","SELECT","FROM","WHERE","JOIN","INSERT","UPDATE","DELETE"]);
function highlightCodeHtml(code, lang){
  const raw = String(code || "");
  const l = String(lang || "").toLowerCase();
  if (!l || l === "text" || l === "plain" || l === "txt" || raw.length > 40000) return esc(raw);
  const hashCmt = /^(?:python|py|bash|sh|zsh|yaml|yml|toml|ruby|rb)$/.test(l);
  const rx = /("(?:[^"\\\n]|\\.)*")|('(?:[^'\\\n]|\\.)*')|(`(?:[^`\\\n]|\\.)*`)|(\/\/[^\n]*)|(#[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let out = "", last = 0, m;
  while ((m = rx.exec(raw)) !== null) {
    if (m.index > last) out += esc(raw.slice(last, m.index));
    const [full, dq, sq, bq, lc, hc, num, w] = m;
    if (dq || sq || bq) out += '<span class="tok-str">' + esc(full) + "</span>";
    else if (lc || (hc && hashCmt)) out += '<span class="tok-comment">' + esc(full) + "</span>";
    else if (num) out += '<span class="tok-num">' + esc(full) + "</span>";
    else if (w && CODE_KW.has(w)) out += '<span class="tok-kw">' + esc(full) + "</span>";
    else out += esc(full);
    last = m.index + full.length;
  }
  if (last < raw.length) out += esc(raw.slice(last));
  return out;
}
const CODE_EXT_MAP = {
  js:"js",javascript:"js",mjs:"mjs",cjs:"cjs",jsx:"jsx",ts:"ts",typescript:"ts",tsx:"tsx",
  py:"py",python:"py",rs:"rs",rust:"rs",go:"go",sh:"sh",bash:"sh",zsh:"sh",shell:"sh",
  json:"json",yaml:"yml",yml:"yml",toml:"toml",sql:"sql",html:"html",htm:"html",css:"css",
  md:"md",markdown:"md",xml:"xml",svg:"svg",c:"c",cpp:"cpp",java:"java",kt:"kt",swift:"swift",rb:"rb",php:"php",
};
function codeFileExt(lang){ return CODE_EXT_MAP[String(lang || "").trim().toLowerCase()] || "txt"; }
function normalizeQOpts(raw){
  return (Array.isArray(raw) ? raw : [])
    .map((o) => typeof o === "string" ? { label: o.trim(), description: "" } : (o && typeof o.label === "string" ? { label: o.label.trim(), description: String(o.description || "").trim() } : null))
    .filter((o) => o && o.label).slice(0, 10);
}
function renderQuestionCardHtml(raw){
  let spec;
  try { spec = JSON.parse(String(raw || "").trim()); } catch { return null; }
  if (!spec || typeof spec !== "object") return null;
  if (Array.isArray(spec.questions) && spec.questions.length) {
    const steps = spec.questions
      .map((q) => {
        if (!q || typeof q !== "object") return null;
        const options = normalizeQOpts(q.options);
        if (!options.length) return null;
        return {
          header: String(q.header || q.title || "").trim(),
          question: String(q.question || q.title || q.header || "").trim(),
          multi: q.multi === true || q.multiSelect === true,
          placeholder: String(q.placeholder || tx("Özel yanıt (isteğe bağlı)…")),
          options,
        };
      })
      .filter(Boolean).slice(0, 6);
    if (!steps.length) return null;
    const badge = esc(String(spec.title || tx("SORU TABLOSU")).toUpperCase());
    const prog = esc(LANG === "en" ? `0/${steps.length} answered` : `0/${steps.length} yanıtlandı`);
    return `<div class="md-question-card md-question-wizard" data-question-card data-question-wizard="1" data-total-steps="${steps.length}" data-question="${esc(String(spec.title || ""))}"><div class="md-question-head"><span class="md-question-badge">${badge}</span><span class="md-question-progress" data-question-progress>${prog}</span></div><div class="md-question-steps">${steps.map((st, sIdx) => `<div class="md-question-step" data-question-step="${sIdx}" data-step-multi="${st.multi ? "1" : "0"}" data-step-title="${esc(st.header || st.question)}"><div class="md-question-step-head"><span class="md-question-step-idx">${sIdx + 1}/${steps.length}</span><span class="md-question-prompt">${esc(st.question)}</span>${st.multi ? `<span class="md-question-hint">${esc(tx("Çoklu"))}</span>` : ""}</div><div class="md-question-opts">${st.options.map((opt, idx) => `<button type="button" class="md-question-opt" data-question-opt="${idx}" data-opt-label="${esc(opt.label)}" aria-pressed="false"><span class="md-question-opt-num">${idx + 1}</span><span class="md-question-opt-body"><strong>${esc(opt.label)}</strong>${opt.description ? `<small>${esc(opt.description)}</small>` : ""}</span></button>`).join("")}</div><input type="text" class="md-question-custom" placeholder="${esc(st.placeholder)}" aria-label="${esc(st.placeholder)}"></div>`).join("")}</div><div class="md-question-foot"><button type="button" class="md-question-submit" data-question-submit>${esc(tx("Tüm Yanıtları Gönder"))}</button></div></div>`;
  }
  const opts = normalizeQOpts(spec.options);
  if (!opts.length) return null;
  const q = String(spec.question || spec.title || "").trim();
  const multi = spec.multi === true || spec.multiSelect === true;
  const badge = esc(String(spec.title || tx("SORU & SEÇİM")).toUpperCase());
  const ph = esc(String(spec.placeholder || tx("Kendi yanıtını yaz (isteğe bağlı)…")));
  return `<div class="md-question-card" data-question-card data-multi="${multi ? "1" : "0"}" data-question="${esc(q)}"><div class="md-question-head"><span class="md-question-badge">${badge}</span>${multi ? `<span class="md-question-hint">${esc(tx("Çoklu seçim"))}</span>` : ""}</div>${q ? `<div class="md-question-prompt">${esc(q)}</div>` : ""}<div class="md-question-opts">${opts.map((opt, idx) => `<button type="button" class="md-question-opt" data-question-opt="${idx}" data-opt-label="${esc(opt.label)}" aria-pressed="false"><span class="md-question-opt-num">${idx + 1}</span><span class="md-question-opt-body"><strong>${esc(opt.label)}</strong>${opt.description ? `<small>${esc(opt.description)}</small>` : ""}</span></button>`).join("")}</div><div class="md-question-foot"><input type="text" class="md-question-custom" placeholder="${ph}" aria-label="${ph}"><button type="button" class="md-question-submit" data-question-submit>${esc(tx("Seçimi Gönder"))}</button></div></div>`;
}
function normalizeCiteUrl(raw){
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    for (const k of [...u.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid)$/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return { href: u.href.replace(/\/+$/, ""), host: u.hostname.toLowerCase().replace(/^www\./, "") };
  } catch { return null; }
}
function hydrateInlineCitations(rootEl, sources = []){
  if (!rootEl || !Array.isArray(sources) || !sources.length) return 0;
  const byUrl = new Map(), byHost = new Map();
  sources.forEach((s, idx) => {
    const norm = normalizeCiteUrl(s?.url); if (!norm) return;
    const entry = { idx: idx + 1, title: String(s.title || norm.host), host: s.host || norm.host, snippet: String(s.snippet || "").trim() };
    if (!byUrl.has(norm.href)) byUrl.set(norm.href, entry);
    if (!byHost.has(norm.host)) byHost.set(norm.host, entry);
  });
  if (!byUrl.size) return 0;
  let count = 0;
  for (const a of Array.from(rootEl.querySelectorAll("a[href]"))) {
    if (a.dataset.citeHydrated === "1" || a.closest(".srcs, .art, .chat-gen-card, .chat-cta, pre, code")) continue;
    const norm = normalizeCiteUrl(a.getAttribute("href") || a.href); if (!norm) continue;
    const lbl = String(a.textContent || "").trim().toLowerCase().replace(/^www\./, "");
    const hit = byUrl.get(norm.href) || (lbl === norm.host ? byHost.get(norm.host) : null);
    if (!hit) continue;
    a.classList.add("cite-pill");
    a.dataset.citeHydrated = "1";
    a.dataset.citeHost = hit.host;
    a.dataset.citeTitle = hit.title;
    a.dataset.citeSnippet = hit.snippet || "";
    a.dataset.citeIndex = String(hit.idx);
    a.title = `[${hit.idx}] ${hit.title}` + (hit.snippet ? ` · ${hit.snippet}` : "");
    const m = srcMonogram(hit.host);
    const dot = el("i", "cite-dot"); dot.style.background = m.bg; dot.setAttribute("aria-hidden", "true");
    a.replaceChildren(dot, el("span", "", hit.host));
    count++;
  }
  return count;
}
function inline(s){
  return s.split(/(`[^`\n]+`)/g).map((part, k) => k % 2
    ? "<code>" + esc(part.slice(1, -1)) + "</code>"
    : esc(stripEmDashes(part))
        .replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" class="md-chat-image" style="display:block;width:auto;max-width:min(100%,420px);max-height:280px;height:auto;object-fit:contain;border-radius:12px;margin:10px 0;cursor:zoom-in">')
        .replace(/(\$(?!\s)([^$\n]{1,120}?)(?<!\s)\$)/g, (m, _all, inner) => (/[A-Za-z\\^_+=<>*/]/.test(inner) && !/^\d[\d.,]*$/.test(inner)) ? `<span class="math-inline">${texToHtml(inner)}</span>` : m)
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
        .replace(/(^|[\s(])[*_](?!\s)(.+?)[*_](?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()]+|\([^\s()]*\))+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  ).join("");
}
function svgArtHtml(raw){
  const clean = sanitizeSvg(raw);
  const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(clean);
  return `<div class="art"><div class="art-head"><span class="art-badge">SVG</span><button type="button" class="art-toggle" data-art-src aria-pressed="false">${esc(tx("Kaynak"))}</button></div><img class="art-frame art-svg md-chat-image" alt="${esc(tx("Diyagram"))}" src="${esc(uri)}"><pre class="art-source" hidden><code>${esc(raw)}</code></pre></div>`;
}
function artHtml(badge, srcdoc, raw, sandbox){
  return `<div class="art"><div class="art-head"><span class="art-badge">${esc(badge)}</span><button type="button" class="art-toggle" data-art-src aria-pressed="false">${esc(tx("Kaynak"))}</button></div><iframe class="art-frame" sandbox="${sandbox}" referrerpolicy="no-referrer" loading="lazy" srcdoc="${esc(srcdoc)}"></iframe><pre class="art-source" hidden><code>${esc(raw)}</code></pre></div>`;
}
function md(src, { streaming = false } = {}){
  const out = [], lines = String(src ?? "").replace(/\r/g, "").split("\n");
  let para = [], list = null, quote = [];
  const endPara = () => {
    if (!para.length) return;
    const chunks = [[]];
    for (const ln of para) {
      const isBoldLead = /^\s*\*\*[^*\n]{2,80}(?:[:：]\*\*|\*\*\s*[:：-])/.test(ln);
      if (isBoldLead && chunks[chunks.length - 1].length) chunks.push([ln]);
      else chunks[chunks.length - 1].push(ln);
    }
    for (const ch of chunks) out.push("<p>" + ch.map(inline).join("<br>") + "</p>");
    para = [];
  };
  const endList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const CALLOUT_LABELS = { note: "Not", tip: "İpucu", important: "Önemli", warning: "Uyarı", caution: "Dikkat" };
  const endQuote = () => {
    if (!quote.length) return;
    const cm = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(quote[0] || "");
    if (cm) {
      const kind = cm[1].toLowerCase();
      const bodyTxt = quote.slice(1).join("\n").trim();
      out.push(`<blockquote class="md-callout md-callout-${kind}"><div class="md-callout-title">${esc(tx(CALLOUT_LABELS[kind] || kind.toUpperCase()))}</div>${bodyTxt ? md(bodyTxt) : ""}</blockquote>`);
    } else {
      out.push("<blockquote><p>" + quote.map(inline).join("<br>") + "</p></blockquote>");
    }
    quote = [];
  };
  const parseCells = (row) => {
    let t = row.trim();
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
    const cells = []; let cur = "", inCode = false;
    for (let k = 0; k < t.length; k++) {
      const ch = t[k];
      if (ch === "\\" && t[k + 1] === "|" && !inCode) { cur += "|"; k++; continue; }
      if (ch === "`") { inCode = !inCode; cur += ch; continue; }
      if (ch === "|" && !inCode) { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fence = ln.match(/^\s*```(\S*)/);
    if (fence) {
      endPara(); endList(); endQuote();
      const lang = (fence[1] || "").toLowerCase();
      const code = [];
      let closed = false;
      while (++i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) { closed = true; break; }
        code.push(lines[i]);
      }
      const raw = code.join("\n");
      if (streaming && !closed && (lang === "svg" || lang === "html")) {
        out.push(`<div class="art"><div class="art-head"><span class="art-badge">${esc(lang.toUpperCase())}</span></div><div class="art-streaming">${esc(tx(lang === "svg" ? "SVG hazırlanıyor…" : "HTML önizleme hazırlanıyor…"))}</div></div>`);
        continue;
      }
      if (lang === "svg" && raw.length <= 250000 && /<svg\b/i.test(raw) && /<\/svg>/i.test(raw)) {
        out.push(svgArtHtml(raw));
        continue;
      }
      if (lang === "html" && raw.length <= 250000 && /<(?:html|body|div|canvas|svg|table|section|main|style|script)\b/i.test(raw)) {
        out.push(artHtml("HTML", raw, raw, "allow-scripts"));
        continue;
      }
      if ((lang === "question" || lang === "questions") && !streaming) {
        const qCard = renderQuestionCardHtml(raw);
        if (qCard) { out.push(qCard); continue; }
      }
      out.push(`<pre><div class="ph"><span>${esc(lang || "text")}</span><div class="ph-acts"><button type="button" data-wrap-code aria-pressed="false">${esc(tx("Kaydır"))}</button><button type="button" data-dl-code data-code-ext="${esc(codeFileExt(lang))}">${esc(tx("İndir"))}</button><button type="button" data-copy-code>${esc(tx("Kopyala"))}</button></div></div><code>${highlightCodeHtml(raw, lang)}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$\s*$/.test(ln)) {
      endPara(); endList(); endQuote();
      const mlines = [];
      while (++i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) mlines.push(lines[i]);
      out.push(`<div class="math-block">${texToHtml(mlines.join(" "), true)}</div>`);
      continue;
    }
    const singleMath = ln.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (singleMath) { endPara(); endList(); endQuote(); out.push(`<div class="math-block">${texToHtml(singleMath[1], true)}</div>`); continue; }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(ln)) {
      endPara(); endList(); endQuote(); out.push("<hr>"); continue;
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { endPara(); endList(); endQuote(); const n = h[1].length <= 2 ? 3 : 4; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const bq = ln.match(/^\s*>\s?(.*)$/);
    if (bq) { endPara(); endList(); quote.push(bq[1]); continue; }
    endQuote();
    if (ln.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}:?(?:\s*\|\s*:?-{1,}:?)+\s*\|?\s*$/.test(lines[i + 1])) {
      endPara(); endList();
      const head = parseCells(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(parseCells(lines[i])); i++; }
      i--;
      const isDecision = head.some((h) => /(?:kriter|seçenek|öneri|karar|soru|avantaj|dezavantaj|fiyat|plan|özellik|option|criteria|pros|cons|price|choice|recommendation)/i.test(h));
      const badge = esc(tx(isDecision ? "KARŞILAŞTIRMA & KARAR TABLOSU" : "TABLO"));
      const metaTxt = esc(LANG === "en" ? `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${head.length} ${head.length === 1 ? "col" : "cols"}` : `${rows.length} satır · ${head.length} sütun`);
      const filterBar = rows.length >= 4
        ? `<div class="md-table-filter-bar"><input type="search" class="md-table-filter" data-filter-table placeholder="${esc(tx("Tabloda filtrele…"))}" aria-label="${esc(tx("Tabloda filtrele"))}"></div>`
        : "";
      const hasNumCol = rows.length >= 2 && head.some((_, ci) => {
        let hits = 0;
        for (const r of rows) { if (parseSortableNumber(r[ci] || "") !== null) hits++; if (hits >= 2) return true; }
        return false;
      });
      const sumBtn = hasNumCol ? `<button type="button" class="md-table-btn" data-sum-table aria-pressed="false">${esc(LANG === "en" ? "Σ Summary" : "Σ Özet")}</button>` : "";
      let tbl = `<div class="md-table-card"><div class="md-table-head"><div class="md-table-title"><span class="md-table-badge">${badge}</span><span class="md-table-meta" data-table-meta>${metaTxt}</span></div><div class="md-table-acts">${sumBtn}<button type="button" class="md-table-btn" data-copy-table>${esc(tx("Kopyala"))}</button><button type="button" class="md-table-btn" data-md-table>MD</button><button type="button" class="md-table-btn" data-csv-table>CSV</button><button type="button" class="md-table-btn" data-expand-table>${esc(tx("Büyüt"))}</button></div></div>${filterBar}<div class="md-table-scroll"><table><thead><tr>` + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead>";
      const formatCell = (rawC) => {
        const tc = String(rawC || "").trim();
        if (/^(?:✓|✔|✅|yes|evet)$/i.test(tc)) return `<span class="md-cell-badge is-yes">${inline(tc)}</span>`;
        if (/^(?:✗|✘|✕|❌|no|hayır)$/i.test(tc)) return `<span class="md-cell-badge is-no">${inline(tc)}</span>`;
        if (/^(?:★.*|⭐.*|önerilen|en iyi|kazanan|recommended|best pick|winner)$/i.test(tc)) return `<span class="md-cell-badge is-best">${inline(tc)}</span>`;
        return inline(rawC || "");
      };
      if (rows.length) tbl += "<tbody>" + rows.map((r) => "<tr>" + head.map((_, k) => `<td>${formatCell(r[k] || "")}</td>`).join("") + "</tr>").join("") + "</tbody>";
      out.push(tbl + "</table></div></div>");
      continue;
    }
    const task = ln.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      endPara();
      if (list !== "ul") { endList(); out.push("<ul>"); list = "ul"; }
      const chk = task[1].toLowerCase() === "x" ? " checked" : "";
      out.push(`<li class="md-task-item"><input type="checkbox" disabled${chk}><span>${inline(task[2])}</span></li>`);
      continue;
    }
    const li = ln.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      endPara();
      const type = /\d/.test(li[1]) ? "ol" : "ul";
      if (list !== type) { endList(); out.push(`<${type}>`); list = type; }
      out.push("<li>" + inline(li[2]) + "</li>");
      continue;
    }
    if (!ln.trim()) { endPara(); endList(); continue; }
    endList(); para.push(ln);
  }
  endPara(); endList(); endQuote();
  return out.join("");
}
