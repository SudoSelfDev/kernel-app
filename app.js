/* Kernel — personal vault dashboard PWA
   M1: read-only dashboard · M1.5: themes + daily-task write-back
   M1.6: task removal, schedule, articles reader, auto-hiding bars */
"use strict";

const OWNER = "SudoSelfDev";
const REPO = "kernel-vault";
const BRANCH = "main";

/* Vault paths kept base64-encoded so they aren't casually readable in this public repo */
const PATHS = {
  clients: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL2RhcnN0cmVhbS1jbGllbnRzLm1k"),
  savings: atob("MTBfUHJvamVjdHMvU2F2aW5nc19QbGFuL1NhdmluZ3NfUGxhbi5tZA=="),
  debts: atob("MjBfTGlmZWxvZy9EZWJ0TG9nLm1k"),
  study: atob("MTBfUHJvamVjdHMvQ2xvdWRfRW5naW5lZXJpbmcvUGhhc2VfMS9waGFzZTEtcHJvZ3Jlc3MubWQ="),
  dailyDir: atob("MjBfTGlmZWxvZy8yMV9EYWlseU5vdGVzLw=="),
  schedule: atob("MjBfTGlmZWxvZy9zY2hlZHVsZS5qc29u"),
  research: atob("MzBfTGlicmFyeS9SZXNlYXJjaA=="),
  masterplan: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL21hc3Rlci1wbGFuLm1k"),
};

const LS_TOKEN = "kernel_pat";
const LS_CACHE = "kernel_cache_v3";
const LS_THEME = "kernel_theme"; // "auto" | "dark" | "light"

const state = {
  view: "today",
  clientTab: "active",
  openClient: null,   // "tab:index" of the expanded client row, or null
  scriptsOpen: false, // DM Scripts card collapsed by default
  article: null,      // name of the open article, or null for the list
  files: {},          // clients/savings/debts/study/schedule: raw · daily: {text, sha}|null · articles: [{name, text}]
  lastSync: null,
  error: null,
  busy: false,        // a write is in flight
};

/* ---------- icons (feather-style, stroke = currentColor) ---------- */

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
};

const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------- theme ---------- */

const getThemePref = () => localStorage.getItem(LS_THEME) || "auto";

function effectiveTheme() {
  const pref = getThemePref();
  if (pref !== "auto") return pref;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme() {
  const t = effectiveTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f6f8fa" : "#0d1117";
  const btn = $("#btn-theme");
  if (btn) btn.innerHTML = icon(t === "light" ? "moon" : "sun", 18);
}

function setThemePref(pref) {
  localStorage.setItem(LS_THEME, pref);
  applyTheme();
  if (state.view === "settings") render();
}

matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (getThemePref() === "auto") applyTheme();
});

/* ---------- storage ---------- */

const getToken = () => localStorage.getItem(LS_TOKEN) || "";
const setToken = (t) => localStorage.setItem(LS_TOKEN, t.trim());

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
    if (c && c.files) { state.files = c.files; state.lastSync = c.at; }
  } catch { /* corrupt cache is disposable */ }
}
function saveCache() {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ files: state.files, at: state.lastSync }));
  } catch { /* quota — better to run uncached than to crash */ }
}

/* ---------- github api ---------- */

function contentsUrl(path) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/` +
    path.split("/").map(encodeURIComponent).join("/");
}

const ghHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  "X-GitHub-Api-Version": "2022-11-28",
});

const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const b64decode = (b) =>
  new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function fetchRaw(path, { optional = false } = {}) {
  const res = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw+json" },
  });
  if (res.status === 404 && optional) return null;
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.text();
}

/* directory listing — array of {name, type, ...} */
async function fetchDir(path, { optional = false } = {}) {
  const res = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github+json" },
  });
  if (res.status === 404 && optional) return null;
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.json();
}

/* JSON variant — returns {text, sha} so we can write the file back */
async function fetchWithSha(path, { optional = false } = {}) {
  const res = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github+json" },
  });
  if (res.status === 404 && optional) return null;
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const j = await res.json();
  return { text: b64decode(j.content), sha: j.sha };
}

async function putFile(path, text, message, sha) {
  const body = { message, content: b64encode(text), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(path), {
    method: "PUT",
    headers: { ...ghHeaders(), Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new Error("auth-write");
  if (res.status === 409 || res.status === 422) throw new Error("conflict");
  if (!res.ok) throw new Error(`put ${res.status}`);
  const j = await res.json();
  return j.content.sha;
}

function todayNoteName() {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getDate()).padStart(2, "0");
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${dd} ${d.getFullYear()}.md`;
}
const todayNotePath = () => PATHS.dailyDir + todayNoteName();

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function syncAll() {
  if (!getToken()) return;
  setSyncStatus("Syncing…");
  state.error = null;
  try {
    const [clients, savings, debts, study, daily, schedule, researchDir, masterplan] = await Promise.all([
      fetchRaw(PATHS.clients),
      fetchRaw(PATHS.savings),
      fetchRaw(PATHS.debts),
      fetchRaw(PATHS.study, { optional: true }),
      fetchWithSha(todayNotePath(), { optional: true }),
      fetchRaw(PATHS.schedule, { optional: true }),
      fetchDir(PATHS.research, { optional: true }),
      fetchRaw(PATHS.masterplan, { optional: true }),
    ]);
    let articles = [];
    if (Array.isArray(researchDir)) {
      const mds = researchDir.filter((f) => f.type === "file" && f.name.endsWith(".md"));
      const texts = await Promise.all(mds.map((f) => fetchRaw(`${PATHS.research}/${f.name}`)));
      articles = mds.map((f, i) => ({ name: f.name, text: texts[i] }));
    }
    state.files = { clients, savings, debts, study, daily, schedule, articles, masterplan };
    state.lastSync = Date.now();
    saveCache();
  } catch (e) {
    state.error = e.message === "auth"
      ? "GitHub rejected the token. Check it in Settings (needs Contents permission on the vault repo)."
      : "Sync failed — offline? Showing last cached data.";
  }
  render();
}

/* ---------- daily-task writes ---------- */

async function saveDaily(newText, message) {
  const d = state.files.daily;
  const prev = d ? { ...d } : null;
  state.busy = true;
  state.files.daily = { text: newText, sha: d ? d.sha : null };
  render();
  try {
    const sha = await putFile(todayNotePath(), newText, message, d ? d.sha : undefined);
    state.files.daily.sha = sha;
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    state.files.daily = prev;
    if (e.message === "auth-write") {
      state.error = "Write rejected — your token needs Contents: Read and write to edit tasks.";
    } else if (e.message === "conflict") {
      state.error = "The note changed on GitHub since last sync. Refreshing — try again.";
      state.busy = false;
      await syncAll();
      return;
    } else {
      state.error = "Couldn't save — check your connection and try again.";
    }
  }
  state.busy = false;
  render();
}

function toggleTask(lineIdx) {
  const d = state.files.daily;
  if (!d || state.busy) return;
  const lines = d.text.split("\n");
  const l = lines[lineIdx];
  if (!/^- \[[ xX]\]/.test((l || "").trim())) return;
  lines[lineIdx] = /\[[xX]\]/.test(l) ? l.replace(/\[[xX]\]/, "[ ]") : l.replace("[ ]", "[x]");
  saveDaily(lines.join("\n"), "kernel-app: update daily tasks");
}

function removeTask(lineIdx) {
  const d = state.files.daily;
  if (!d || state.busy) return;
  const lines = d.text.split("\n");
  const t = (lines[lineIdx] || "").trim();
  if (!/^- \[[ xX]\]/.test(t)) return;
  const label = t.replace(/^- \[[ xX]\]\s*/, "");
  if (!confirm(`Remove "${label}"?`)) return;
  lines.splice(lineIdx, 1);
  saveDaily(lines.join("\n"), "kernel-app: remove daily task");
}

/* add one or many tasks in a single commit */
function addTasks(texts) {
  const tasks = texts.map((t) => t.trim()).filter(Boolean).map((t) => `- [ ] ${t}`);
  if (state.busy || !tasks.length) return;
  const d = state.files.daily;
  if (!d) {
    /* no note yet — create it with the tasks in one go */
    const text = `---\ndate: "${todayIso()}"\ntags:\n  - daily\n---\n\n## Today\n\n${tasks.join("\n")}\n\n## Log\n\n`;
    state.files.daily = { text: "", sha: null };
    saveDaily(text, "kernel-app: create daily note");
    return;
  }
  const lines = d.text.split("\n");
  const h = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## today"));
  if (h === -1) {
    lines.push("", "## Today", "", ...tasks);
  } else {
    let end = lines.length;
    for (let i = h + 1; i < lines.length; i++) {
      if (/^#+\s/.test(lines[i])) { end = i; break; }
    }
    let insert = -1;
    for (let i = h + 1; i < end; i++) {
      if (/^- \[/.test(lines[i].trim())) insert = i + 1;
    }
    if (insert === -1) {
      insert = h + 1;
      if ((lines[insert] || "").trim() === "") insert++;
    }
    lines.splice(insert, 0, ...tasks);
  }
  saveDaily(lines.join("\n"), tasks.length === 1 ? "kernel-app: add daily task" : `kernel-app: add ${tasks.length} daily tasks`);
}

/* ---------- markdown parsing ---------- */

function section(md, heading) {
  if (!md) return "";
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(heading.toLowerCase()));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) || ["##"])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}

function parseTable(md) {
  if (!md) return [];
  const lines = md.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const cells = (l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const header = cells(lines[0]);
  return lines
    .slice(1)
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
    .map((l) => {
      const row = {};
      cells(l).forEach((c, i) => { row[header[i] || `col${i}`] = c; });
      return row;
    });
}

function frontmatter(md) {
  const m = (md || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (m) {
    m[1].split("\n").forEach((l) => {
      const i = l.indexOf(":");
      if (i > 0 && !/^\s/.test(l)) {
        out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    });
  }
  return out;
}
const stripFrontmatter = (md) => (md || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

const num = (s) => {
  const m = String(s || "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

function statusChip(s) {
  if (!s) return ["dim", "—"];
  if (s.includes("✅")) return ["ok", s];
  if (s.includes("⚠")) return ["warn", s];
  if (s.includes("❌") || s.includes("🔴") || s.includes("⛔")) return ["bad", s];
  if (s.includes("🔵")) return ["info", s];
  if (s.includes("🟡") || s.includes("⏳")) return ["warn", s];
  return ["dim", s];
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/* ---------- article markdown renderer ---------- */

function mdInline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, alias) => `<span class="wikilink">${alias || t}</span>`);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let para = [], list = null, quote = [], i = 0;

  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((x) => `<li>${x}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(mdInline).join("<br>")}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  while (i < lines.length) {
    const raw = lines[i];
    const l = raw.trim();

    if (l.startsWith("```")) {
      flushAll();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { code.push(lines[i]); i++; }
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    if (l.startsWith("|") && i + 1 < lines.length && /^\|[\s\-:|]+\|?$/.test(lines[i + 1].trim())) {
      flushAll();
      const cells = (s) => s.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i].trim())); i++; }
      out.push(`<table><thead><tr>${head.map((h) => `<th>${mdInline(h)}</th>`).join("")}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`);
      continue;
    }

    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { flushAll(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { flushAll(); out.push("<hr>"); i++; continue; }

    if (l.startsWith(">")) { flushPara(); flushList(); quote.push(l.replace(/^>\s?/, "")); i++; continue; }

    const li = l.match(/^([-*]|\d+\.)\s+(.*)/);
    if (li) {
      flushPara(); flushQuote();
      const tag = /^\d+\.$/.test(li[1]) ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      const box = li[2].match(/^\[([ xX])\]\s*(.*)/);
      list.items.push(box
        ? `<span class="md-box ${box[1] !== " " ? "checked" : ""}">${box[1] !== " " ? "✓" : ""}</span> ${mdInline(box[2])}`
        : mdInline(li[2]));
      i++;
      continue;
    }

    if (l === "") { flushAll(); i++; continue; }

    flushList(); flushQuote();
    para.push(l);
    i++;
  }
  flushAll();
  return out.join("\n");
}

/* ---------- model ---------- */

function buildModel() {
  const f = state.files;
  const m = {
    active: [], leads: [], churned: [], savings: {}, debts: [], debtTotal: null,
    study: null, tasks: null, schedule: null, articles: [],
  };

  if (f.clients) {
    m.leads = parseTable(section(f.clients, "## Leads"));
    m.active = parseTable(section(f.clients, "## Active Customers")).map((c) => ({
      ...c, days: daysUntil(c.Expiry),
    }));
    m.churned = parseTable(section(f.clients, "## Churned"));
  }

  if (f.savings) {
    const goal = parseTable(section(f.savings, "## Goal"));
    const kv = {};
    goal.forEach((r) => {
      const vals = Object.values(r);
      if (vals.length >= 2) kv[vals[0].replace(/\*/g, "")] = vals[1].replace(/\*/g, "");
    });
    m.savings = {
      target: num(kv["Target"]) || 50000,
      current: num(kv["Current savings"]),
      currentRaw: kv["Current savings"] || "",
      monthly: num(kv["Strict mode monthly target"]),
      deadline: kv["Deadline"] || "",
      tracker: parseTable(section(f.savings, "## Progress Tracker")),
    };
  }

  if (f.debts) {
    const rows = parseTable(section(f.debts, "## Summary"));
    rows.forEach((r) => {
      const vals = Object.values(r);
      const name = (vals[0] || "").replace(/\*/g, "");
      if (/^total$/i.test(name)) m.debtTotal = num(vals[1]);
      else m.debts.push({ name, amount: num(vals[1]), status: vals[2] || "" });
    });
  }

  if (f.study) {
    const title = (f.study.match(/^#\s+(.+)$/m) || [])[1] || "Study";
    const boxes = f.study.match(/^- \[[ xX]\]/gm) || [];
    const done = f.study.match(/^- \[[xX]\]/gm) || [];
    m.study = { title: title.replace(/:.*$/, ""), total: boxes.length, done: done.length };
  }

  if (f.daily && typeof f.daily.text === "string") {
    /* tasks carry their absolute line index so toggles edit the exact line */
    const lines = f.daily.text.split("\n");
    const h = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## today"));
    m.tasks = [];
    if (h !== -1) {
      let end = lines.length;
      for (let i = h + 1; i < lines.length; i++) {
        if (/^#+\s/.test(lines[i])) { end = i; break; }
      }
      for (let i = h + 1; i < end; i++) {
        const t = lines[i].trim();
        if (/^- \[[ xX]\]/.test(t)) {
          m.tasks.push({ done: /\[[xX]\]/.test(t), text: t.replace(/^- \[[ xX]\]\s*/, ""), line: i });
        }
      }
    }
  }

  if (f.schedule) {
    try {
      const sch = JSON.parse(f.schedule);
      const iso = todayIso();
      m.schedule = {
        updated: sch.updated || null,
        events: (sch.events || [])
          .filter((e) => e.date === iso)
          .sort((a, b) => `${a.allDay ? 0 : 1}${a.start || ""}`.localeCompare(`${b.allDay ? 0 : 1}${b.start || ""}`)),
      };
    } catch { /* malformed schedule.json — treat as absent */ }
  }

  m.scripts = [];
  if (f.masterplan) {
    /* "## DM Scripts" → one entry per "### Name" + its blockquote */
    const body = section(f.masterplan, "## DM Scripts");
    const parts = body.split(/^###\s+/m).slice(1);
    m.scripts = parts.map((p) => {
      const lines = p.split("\n");
      const text = lines.filter((l) => l.trim().startsWith(">"))
        .map((l) => l.replace(/^>\s?/, "").replace(/^"|"$/g, "")).join("\n");
      return { name: lines[0].trim(), text };
    }).filter((s) => s.text);
  }

  if (Array.isArray(f.articles)) {
    m.articles = f.articles.map((a) => {
      const fm = frontmatter(a.text);
      const body = stripFrontmatter(a.text);
      const title = fm.title
        || (a.text.match(/^#\s+(.+)$/m) || [])[1]
        || a.name.replace(/\.md$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      const para = body.split("\n").find((l) => l.trim() && !/^[#\-*>|!\[`]/.test(l.trim()));
      const words = body.split(/\s+/).filter(Boolean).length;
      return {
        name: a.name,
        title,
        created: fm.created || "",
        topic: fm.topic || "",
        author: fm.author || "",
        minutes: Math.max(1, Math.round(words / 200)),
        excerpt: para ? (para.length > 160 ? para.slice(0, 160).trimEnd() + "…" : para) : "",
        body,
      };
    }).sort((x, y) => (y.created || "").localeCompare(x.created || ""));
  }

  return m;
}

/* ---------- rendering ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setSyncStatus(txt) {
  $("#sync-status").textContent = txt ?? (state.lastSync ? `Synced ${timeAgo(state.lastSync)}` : "");
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function copyToClipboard(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; }
  catch { state.error = "Couldn't copy — clipboard blocked"; render(); return false; }
}
/* copy + flash a check mark in the given icon slot, then restore */
function copySwap(iconEl, size, text) {
  if (!iconEl) return;
  copyToClipboard(text).then((ok) => {
    if (!ok) return;
    iconEl.innerHTML = icon("check", size);
    setTimeout(() => { if (document.body.contains(iconEl)) iconEl.innerHTML = icon("copy", size); }, 1200);
  });
}

function expiryChip(days) {
  if (days === null) return `<span class="chip dim">no date</span>`;
  if (days < 0) return `<span class="chip bad">expired ${-days}d ago</span>`;
  if (days <= 7) return `<span class="chip bad">${days}d left</span>`;
  if (days <= 30) return `<span class="chip warn">${days}d left</span>`;
  return `<span class="chip ok">${days}d left</span>`;
}

/* treat em-dash / blank as "no value" */
const cval = (x) => { const s = String(x ?? "").trim(); return (!s || s === "—") ? "" : s; };

/* the panel's Samsung/LG (smart-tv.xyz) host shares the DNS subdomain — derive it */
function smartTvDns(dns) {
  try { const u = new URL(dns); return `${u.protocol}//${u.hostname.split(".")[0]}.smart-tv.xyz`; }
  catch { return ""; }
}
/* M3U playlist link is fully determined by DNS + credentials */
function m3uLink(dns, user, pass) {
  if (!dns || !user || !pass) return "";
  return `${dns.replace(/\/+$/, "")}/get.php?username=${encodeURIComponent(user)}` +
    `&password=${encodeURIComponent(pass)}&type=m3u_plus&output=mpegts`;
}
/* the ready-to-send credentials block — what Copy login puts on the clipboard */
function buildLoginMsg(c) {
  const dns = cval(c.DNS), user = cval(c.Username), pass = cval(c.Password);
  const L = ["📺 DarStream — Your login", ""];
  if (dns) L.push(`🔗 URL: ${dns}`);
  if (user) L.push(`👤 Username: ${user}`);
  if (pass) L.push(`🔑 Password: ${pass}`);
  const smart = dns ? smartTvDns(dns) : "";
  if (smart) L.push("", "📱 Samsung / LG (IPTV Smarters):", smart);
  const m3u = m3uLink(dns, user, pass);
  if (m3u) L.push("", "📦 M3U link (VLC, etc.):", m3u);
  return L.join("\n");
}

/* a copyable key/value row inside an expanded client */
function cdField(label, value, mono) {
  const v = cval(value);
  if (!v) return "";
  return `<button class="cd-row" data-copy="${esc(v)}">
    <span class="cd-k">${esc(label)}</span>
    <span class="cd-v${mono ? " mono" : ""}">${esc(v)}</span>
    <span class="cd-ic">${icon("copy", 14)}</span>
  </button>`;
}

function renderToday(m) {
  const s = m.savings;
  const pct = s.current && s.target ? Math.min(100, (s.current / s.target) * 100) : 0;
  const renewals = [...m.active].filter((c) => c.days !== null).sort((a, b) => a.days - b.days);
  const next = renewals[0];
  const unpaid = m.active.filter((c) => (c.Status || "").includes("⚠")).length;
  const trials = m.leads.filter((c) => (c.Status || "").includes("🔵")).length;
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const dis = state.busy ? "disabled" : "";

  const tasksHtml = m.tasks === null
    ? `<div class="empty">No daily note yet today — tap + to start one</div>`
    : `${m.tasks.length === 0 ? `<div class="empty">Nothing on the list — tap + to add tasks</div>` : ""}
       ${m.tasks.map((t) => `
         <div class="task-row">
           <button class="task ${t.done ? "done" : ""}" data-line="${t.line}" ${dis}>
             <span class="box">${t.done ? "✓" : ""}</span>
             <span class="txt">${esc(t.text)}</span>
           </button>
           <button class="task-del" data-del-line="${t.line}" title="Remove task" aria-label="Remove task" ${dis}>${icon("x", 15)}</button>
         </div>`).join("")}`;

  let scheduleHtml;
  if (!m.schedule) {
    scheduleHtml = `<div class="empty">No schedule synced yet — calendar sync runs from the vault repo</div>`;
  } else if (m.schedule.events.length === 0) {
    scheduleHtml = `<div class="empty">Nothing scheduled today</div>`;
  } else {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    scheduleHtml = m.schedule.events.map((e) => {
      const live = !e.allDay && e.start && e.end && hm >= e.start && hm < e.end;
      return `<div class="row">
        <div class="r-main"><div class="r-title">${esc(e.title || "Busy")}</div>
        <div class="r-sub">${e.allDay ? "All day" : `${esc(e.start || "?")} – ${esc(e.end || "?")}`}</div></div>
        <div class="r-end">${live ? `<span class="chip ok">now</span>` : ""}</div>
      </div>`;
    }).join("");
  }

  return `
  <div class="card">
    <h2>${esc(dateStr)} ${state.busy ? `<span class="h-extra muted">saving…</span>` : ""}</h2>
    ${tasksHtml}
  </div>

  <div class="card">
    <h2>Schedule ${m.schedule && m.schedule.updated ? `<span class="h-extra muted">synced ${esc(m.schedule.updated.slice(0, 16).replace("T", " "))}</span>` : ""}</h2>
    ${scheduleHtml}
  </div>

  ${m.study ? `
  <div class="card">
    <h2>Cloud Study</h2>
    <div class="row">
      <div class="r-main"><div class="r-title">${esc(m.study.title)}</div>
      <div class="r-sub">${m.study.done}/${m.study.total} checklist items done</div></div>
      <div class="r-end"><span class="chip ${m.study.done > 0 ? "ok" : "dim"}">${m.study.total ? Math.round((m.study.done / m.study.total) * 100) : 0}%</span></div>
    </div>
  </div>` : ""}

  <div class="card">
    <h2>Clients</h2>
    <div class="row">
      <div class="r-main"><div class="r-title">${m.active.length} active</div>
      <div class="r-sub">${unpaid} unpaid · ${trials} on trial</div></div>
      <div class="r-end">${next ? expiryChip(next.days) : ""}</div>
    </div>
    ${next ? `<div class="row"><div class="r-main"><div class="r-title">Next renewal: ${esc(next.Name)}</div>
      <div class="r-sub">${esc(next.Expiry)} · ${esc(next.Plan || "")} · ${esc(next.Price || "")}</div></div></div>` : ""}
  </div>

  <div class="card">
    <h2>Savings <span class="h-extra muted">target ${s.target ? s.target.toLocaleString() : "—"} MAD</span></h2>
    <div class="big-number">${s.current ? s.current.toLocaleString() : "—"} <small>MAD</small></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="bar-sub"><span>${pct.toFixed(0)}%</span><span>monthly target: ${s.monthly ? s.monthly.toLocaleString() : "—"} MAD</span></div>
  </div>`;
}

/* the order the cards render in — the sheet looks clients up by index in this list */
function clientsSorted(m, tab) {
  const list = tab === "active" ? m.active : tab === "leads" ? m.leads : m.churned;
  return tab === "active" ? [...list].sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)) : list;
}

function clientCard(c, kind, key) {
  const [cls, label] = statusChip(c.Status);

  /* status chips only as exceptions — ✅ Active / 🔴 Churned are the tab's norm */
  const isNorm = kind === "active" ? (c.Status || "").includes("✅")
    : kind === "churned" ? true : false;
  const chip = isNorm ? "" : `<span class="chip ${cls}">${esc(label)}</span>`;

  /* active cards lead with the countdown: big day number + traffic-light dot */
  let end = chip;
  if (kind === "active") {
    const d = c.days;
    const tone = d === null ? "dim" : d <= 7 ? "bad" : d <= 30 ? "warn" : "ok";
    end = `${chip}<span class="cc-days t-${tone}">${d === null ? "—" : d < 0 ? `${-d}d ago` : `${d}d`}<span class="dot"></span></span>`;
  }

  return `
  <button class="card client-card" data-client="${esc(key)}">
    <div class="cc-main">
      <div class="cc-name">${esc(cval(c.Name) || "—")}</div>
      <div class="cc-sub">${esc(cval(c.Phone) || "—")}</div>
    </div>
    <div class="cc-end">${end}</div>
  </button>`;
}

/* bottom sheet with the full client record — fields are tap-to-copy */
function clientSheetHtml(c, kind) {
  const [cls, label] = statusChip(c.Status);
  const phone = (c.Phone || "").replace(/[^+\d]/g, "");
  const hasLogin = !!cval(c.Username) && (!!cval(c.DNS) || !!cval(c.Password));
  const meta = kind === "active"
    ? `<span class="chip ${cls}">${esc(label)}</span>${expiryChip(c.days)}`
    : `<span class="chip ${cls}">${esc(label)}</span>`;
  return `
  <div class="sheet client-sheet">
    <div class="cs-head">
      <h3>${esc(cval(c.Name) || "—")}</h3>
      <div class="cs-meta">${meta}</div>
    </div>
    <div class="cs-fields">
      ${cdField("Phone", c.Phone, true)}
      ${cdField("App", c.App)}
      ${kind !== "churned" ? cdField("Expiry", c.Expiry) : ""}
      ${kind === "active" ? cdField("Plan", [cval(c.Plan), cval(c.Price)].filter(Boolean).join(" · ")) : ""}
      ${cdField("DNS", c.DNS, true)}
      ${cdField("Username", c.Username, true)}
      ${cdField("Password", c.Password, true)}
      ${cdField("MAC", c["MAC Address"], true)}
      ${kind === "churned" ? cdField("Date", c.Date) : ""}
      ${kind === "churned" ? cdField("Reason", c.Reason) : ""}
      ${kind === "leads" ? cdField("Trial start", c["Trial Start"]) : ""}
      ${cdField("Notes", c.Notes)}
    </div>
    <div class="sheet-actions">
      ${phone ? `<a class="btn secondary cs-call" href="tel:${phone}">${icon("phone", 15)} Call</a>` : ""}
      ${hasLogin ? `<button class="btn copy-login" data-login="${b64encode(buildLoginMsg(c))}">${icon("copy", 15)} Copy login</button>` : ""}
    </div>
  </div>`;
}

function updateClientSheet(m) {
  const el = $("#client-sheet");
  const key = state.view === "clients" ? state.openClient : null;
  if (!key) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const i = key.lastIndexOf(":");
  const c = clientsSorted(m, key.slice(0, i))[parseInt(key.slice(i + 1), 10)];
  if (!c) { state.openClient = null; el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.innerHTML = clientSheetHtml(c, key.slice(0, i));
  el.classList.remove("hidden");
  el.onclick = (e) => { if (e.target === el) { state.openClient = null; render(); } };
  el.querySelectorAll(".cd-row[data-copy]").forEach((r) => {
    r.onclick = () => copySwap(r.querySelector(".cd-ic"), 14, r.dataset.copy);
  });
  el.querySelectorAll("[data-login]").forEach((b) => {
    b.onclick = () => {
      copyToClipboard(b64decode(b.dataset.login)).then((ok) => {
        if (!ok) return;
        const orig = b.innerHTML;
        b.innerHTML = `${icon("check", 15)} Copied`;
        setTimeout(() => { if (document.body.contains(b)) b.innerHTML = orig; }, 1300);
      });
    };
  });
}

function scriptsCard(m) {
  const open = state.scriptsOpen;
  return `
  <div class="card scripts${open ? " open" : ""}">
    <button class="card-head" id="scripts-toggle">
      <h2>DM Scripts <span class="h-extra muted">${m.scripts.length} · tap to ${open ? "hide" : "show"}</span></h2>
      <span class="caret">${icon("chevronDown", 16)}</span>
    </button>
    ${open ? m.scripts.map((s, i) => `
      <button class="script-row" data-script="${i}">
        <div class="r-main">
          <div class="r-title">${esc(s.name)}</div>
          <div class="r-sub script-preview">${esc(s.text)}</div>
        </div>
        <span class="script-copy">${icon("copy", 16)}</span>
      </button>`).join("") : ""}
  </div>`;
}

function renderClients(m) {
  const tab = state.clientTab;
  const sorted = clientsSorted(m, tab);
  return `
  <div class="seg">
    <button data-ctab="active" class="${tab === "active" ? "active" : ""}">Active (${m.active.length})</button>
    <button data-ctab="leads" class="${tab === "leads" ? "active" : ""}">Leads (${m.leads.length})</button>
    <button data-ctab="churned" class="${tab === "churned" ? "active" : ""}">Churned (${m.churned.length})</button>
  </div>
  ${sorted.length
    ? sorted.map((c, i) => clientCard(c, tab, `${tab}:${i}`)).join("")
    : `<div class="card"><div class="empty">Nothing here</div></div>`}

  ${m.scripts.length ? scriptsCard(m) : ""}`;
}

function renderMoney(m) {
  const s = m.savings;
  const pct = s.current && s.target ? Math.min(100, (s.current / s.target) * 100) : 0;
  const tracker = (s.tracker || []).map((r) => {
    const vals = Object.values(r).map((v) => v.replace(/\*/g, ""));
    return `<tr><td>${esc(vals[0])}</td><td class="right">${esc(vals[3] || "")}</td><td class="right">${esc(vals[4] || "")}</td><td class="right">${esc(vals[5] || "")}</td></tr>`;
  }).join("");

  return `
  <div class="card">
    <h2>Savings Goal <span class="h-extra muted">${esc(s.deadline.split("(")[0] || "")}</span></h2>
    <div class="big-number">${s.current ? s.current.toLocaleString() : "—"} <small>/ ${s.target ? s.target.toLocaleString() : "—"} MAD</small></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="bar-sub"><span>${pct.toFixed(1)}%</span><span>${esc(s.currentRaw.replace(/^[\d,\s]+MAD\s*/, ""))}</span></div>
  </div>

  <div class="card locked">
    <h2>Emergency Fund</h2>
    <div class="row"><div class="r-main"><div class="r-title">9,450 MAD</div>
    <div class="r-sub">Ring-fenced — not part of the goal</div></div>
    <div class="r-end"><span class="chip dim">🔒 locked</span></div></div>
  </div>

  <div class="card">
    <h2>Owed to me ${m.debtTotal ? `<span class="h-extra">${m.debtTotal.toLocaleString()} MAD</span>` : ""}</h2>
    ${m.debts.map((d) => {
      const [cls, label] = statusChip(d.status);
      return `<div class="row">
        <div class="r-main"><div class="r-title">${esc(d.name)}</div></div>
        <div class="r-end"><b>${d.amount ? d.amount.toLocaleString() : "—"}</b> <span class="muted">MAD</span><br>
        <span class="chip ${cls}" style="margin-top:4px">${esc(label)}</span></div>
      </div>`;
    }).join("") || `<div class="empty">No debts tracked</div>`}
  </div>

  ${tracker ? `
  <div class="card">
    <h2>Monthly Tracker</h2>
    <table class="mini-table">
      <tr><th>Month</th><th class="right">Saved</th><th class="right">Total</th><th class="right">OK?</th></tr>
      ${tracker}
    </table>
  </div>` : ""}`;
}

function renderArticles(m) {
  if (state.article) {
    const a = m.articles.find((x) => x.name === state.article);
    if (a) {
      return `
      <button class="back-btn" id="btn-art-back">${icon("chevronLeft", 17)} All articles</button>
      <article class="article">
        <h1>${esc(a.title)}</h1>
        <div class="art-meta">${esc(a.created)}${a.author ? ` · ${esc(a.author)}` : ""} · ${a.minutes} min read</div>
        ${mdToHtml(a.body.replace(/^#\s+.+\n/, ""))}
      </article>`;
    }
    state.article = null;
  }
  if (!m.articles.length) return `<div class="empty">No research articles in the vault yet</div>`;
  return m.articles.map((a) => `
    <button class="card art-card" data-article="${esc(a.name)}">
      <div class="art-title">${esc(a.title)}</div>
      ${a.excerpt ? `<div class="art-excerpt">${esc(a.excerpt)}</div>` : ""}
      <div class="art-meta">${esc(a.created)}${a.topic ? ` · ${esc(a.topic)}` : ""} · ${a.minutes} min read</div>
    </button>`).join("");
}

function renderSettings() {
  const pref = getThemePref();
  return `
  <div class="card">
    <h2>Theme</h2>
    <div class="seg">
      <button data-theme-pref="auto" class="${pref === "auto" ? "active" : ""}">Auto</button>
      <button data-theme-pref="dark" class="${pref === "dark" ? "active" : ""}">Dark</button>
      <button data-theme-pref="light" class="${pref === "light" ? "active" : ""}">Light</button>
    </div>
    <p class="muted" style="font-size:0.75rem;margin-top:8px">Auto follows your system setting. The ☀/☾ button up top is a quick switch.</p>
  </div>
  <div class="card">
    <h2>GitHub Token</h2>
    <p class="muted" style="font-size:0.8rem;margin-bottom:10px">Fine-grained PAT · repo: <code>${OWNER}/${REPO}</code> · permission: Contents — <b>Read and write</b> (write is what lets you edit tasks)</p>
    <input type="password" id="inp-token" placeholder="${getToken() ? "•••••••• (saved)" : "github_pat_…"}">
    <div style="height:10px"></div>
    <button class="btn" id="btn-save-token">Save token</button>
  </div>
  <div class="card">
    <h2>Data</h2>
    <div class="row"><div class="r-main"><div class="r-title">Last sync</div></div>
    <div class="r-end muted">${state.lastSync ? timeAgo(state.lastSync) : "never"}</div></div>
    <div style="height:10px"></div>
    <button class="btn secondary" id="btn-clear-cache">Clear cached data</button>
    <div style="height:8px"></div>
    <button class="btn danger" id="btn-logout">Forget token &amp; data</button>
  </div>
  <div class="card">
    <h2>About</h2>
    <p class="muted" style="font-size:0.8rem;line-height:1.5">Kernel — dashboard over a private vault repo. Data is fetched straight from GitHub on this device and cached locally. Task edits are committed back to the vault as you. The Today schedule reads a file kept fresh by a GitHub Action in the vault repo. Nothing is sent anywhere else.</p>
  </div>`;
}

function renderSetup() {
  $("#view").innerHTML = `
  <div class="setup">
    <h1>⌘ Kernel</h1>
    <p>Your vault, in your pocket. To connect, this app needs a GitHub fine-grained personal access token scoped to your vault repo.</p>
    <ol>
      <li>GitHub → Settings → Developer settings → <b>Fine-grained tokens</b></li>
      <li>Repository access: <b>only</b> <code>${OWNER}/${REPO}</code></li>
      <li>Permissions → Repository → <b>Contents: Read and write</b> (write enables task editing — pick Read-only if you want view-only)</li>
      <li>Generate, copy, paste below. It never leaves this device.</li>
    </ol>
    <input type="password" id="inp-token" placeholder="github_pat_…">
    <button class="btn" id="btn-save-token">Connect</button>
  </div>`;
  $("#btn-save-token").onclick = () => {
    const v = $("#inp-token").value.trim();
    if (!v) return;
    setToken(v);
    syncAll();
  };
}

function render() {
  setSyncStatus();
  applyTheme();
  if (!getToken()) { $("#fab").classList.add("hidden"); renderSetup(); return; }

  const m = buildModel();
  const v = state.view;
  let html = state.error ? `<div class="error-banner">${esc(state.error)}</div>` : "";
  if (!state.files.clients && !state.error) html += `<div class="empty">Loading vault…</div>`;
  else html += v === "today" ? renderToday(m)
    : v === "clients" ? renderClients(m)
    : v === "money" ? renderMoney(m)
    : v === "articles" ? renderArticles(m)
    : renderSettings();
  $("#view").innerHTML = html;

  /* the floating add button only makes sense on Today */
  $("#fab").classList.toggle("hidden", v !== "today");
  $("#fab").disabled = state.busy;

  if (v === "today") {
    document.querySelectorAll(".task[data-line]").forEach((b) => {
      b.onclick = () => toggleTask(parseInt(b.dataset.line, 10));
    });
    document.querySelectorAll("[data-del-line]").forEach((b) => {
      b.onclick = () => removeTask(parseInt(b.dataset.delLine, 10));
    });
  }
  if (v === "clients") {
    document.querySelectorAll("[data-ctab]").forEach((b) => {
      b.onclick = () => { state.clientTab = b.dataset.ctab; state.openClient = null; render(); };
    });
    document.querySelectorAll("[data-client]").forEach((b) => {
      b.onclick = () => { state.openClient = b.dataset.client; render(); };
    });
    const st = $("#scripts-toggle");
    if (st) st.onclick = () => { state.scriptsOpen = !state.scriptsOpen; render(); };
    document.querySelectorAll("[data-script]").forEach((b) => {
      b.onclick = () => copySwap(b.querySelector(".script-copy"), 16, m.scripts[parseInt(b.dataset.script, 10)]?.text);
    });
  }
  updateClientSheet(m);
  if (v === "articles") {
    document.querySelectorAll("[data-article]").forEach((b) => {
      b.onclick = () => { state.article = b.dataset.article; showBars(); render(); scrollTo(0, 0); };
    });
    const back = $("#btn-art-back");
    if (back) back.onclick = () => { state.article = null; showBars(); render(); scrollTo(0, 0); };
  }
  if (v === "settings") {
    document.querySelectorAll("[data-theme-pref]").forEach((b) => {
      b.onclick = () => setThemePref(b.dataset.themePref);
    });
    $("#btn-save-token").onclick = () => {
      const t = $("#inp-token").value.trim();
      if (t) { setToken(t); syncAll(); }
    };
    $("#btn-clear-cache").onclick = () => { localStorage.removeItem(LS_CACHE); state.files = {}; state.lastSync = null; syncAll(); };
    $("#btn-logout").onclick = () => { localStorage.clear(); state.files = {}; state.lastSync = null; render(); };
  }
}

/* ---------- auto-hiding bars ---------- */

const showBars = () => document.body.classList.remove("bars-hidden");

let lastY = 0;
addEventListener("scroll", () => {
  const y = scrollY;
  if (y < 40) {
    showBars();
  } else if (y > lastY + 8) {
    document.body.classList.add("bars-hidden");
  } else if (y < lastY - 8) {
    showBars();
  }
  lastY = y;
}, { passive: true });

/* ---------- task composer ---------- */

function openComposer() {
  if (state.busy) return;
  $("#composer").classList.remove("hidden");
  $("#composer-text").focus();
}
function closeComposer() {
  $("#composer").classList.add("hidden");
  $("#composer-text").value = "";
}

/* ---------- boot ---------- */

document.querySelectorAll(".tab").forEach((b) => {
  b.querySelector(".ticon").innerHTML = icon(b.dataset.icon);
  b.onclick = () => {
    state.view = b.dataset.view;
    state.article = null;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === b));
    showBars();
    render();
    scrollTo(0, 0);
  };
});
$("#btn-refresh").innerHTML = icon("refresh", 17);
$("#btn-refresh").onclick = () => syncAll();
$("#btn-theme").onclick = () => {
  setThemePref(effectiveTheme() === "light" ? "dark" : "light");
};

$("#fab").innerHTML = icon("plus", 24);
$("#fab").onclick = openComposer;
$("#composer-cancel").onclick = closeComposer;
$("#composer").onclick = (e) => { if (e.target.id === "composer") closeComposer(); };
$("#composer-add").onclick = () => {
  const texts = $("#composer-text").value.split("\n");
  closeComposer();
  addTasks(texts);
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

applyTheme();
loadCache();
render();
if (getToken()) syncAll();
