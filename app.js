/* Kernel — personal vault dashboard PWA
   M1: read-only dashboard · M1.5: themes + daily-task write-back
   M1.6: task removal, schedule, articles reader, auto-hiding bars */
"use strict";

/* keep in sync with the CACHE version in sw.js on every release */
const APP_VERSION = "v29";

const OWNER = "SudoSelfDev";
const REPO = "kernel-vault";
const BRANCH = "main";

/* Vault paths kept base64-encoded so they aren't casually readable in this public repo */
const PATHS = {
  clients: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL2RhcnN0cmVhbS1jbGllbnRzLm1k"),
  savings: atob("MTBfUHJvamVjdHMvU2F2aW5nc19QbGFuL1NhdmluZ3NfUGxhbi5tZA=="),
  debts: atob("MjBfTGlmZWxvZy9EZWJ0TG9nLm1k"),
  study: atob("MTBfUHJvamVjdHMvQ2xvdWRfRW5naW5lZXJpbmcvUGhhc2VfMS9waGFzZTEtcHJvZ3Jlc3MubWQ="),
  studyplan: atob("MTBfUHJvamVjdHMvQ2xvdWRfRW5naW5lZXJpbmcvY2xvdWQtc3R1ZHktcGxhbi5tZA=="),
  dailyDir: atob("MjBfTGlmZWxvZy8yMV9EYWlseU5vdGVzLw=="),
  schedule: atob("MjBfTGlmZWxvZy9zY2hlZHVsZS5qc29u"),
  research: atob("MzBfTGlicmFyeS9SZXNlYXJjaA=="),
  masterplan: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL21hc3Rlci1wbGFuLm1k"),
  habits: atob("MjBfTGlmZWxvZy9IYWJpdExvZy5tZA=="),
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
  articleQuery: "",   // Read-tab search filter
  files: {},          // clients/savings/debts/study/schedule: raw · daily: {text, sha}|null · articles: [{name, text}]
  lastSync: null,
  error: null,
  busy: false,        // a write is in flight
  habitsEdit: false,  // edit mode for habit list
  trackerExpanded: false, // show projected months in finances
  reviewEdit: false,  // force-show the Sunday review form even if done this week
  reviewMonk: null,   // pending monk-mode pick in the review form
  debtEdit: null,     // person name being edited, "__new__" for the add form, or null
  debtStatusPick: null, // pending status base in the debt form (Pending/Expected/Partial/Paid)
  taskEdit: null,     // absolute line index of the task being edited inline, or null
  studyDoc: false,    // when true, the cloud study plan opens in the in-app reader
};

/* ---------- confetti ---------- */

function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;z-index:999;pointer-events:none;";
  canvas.width = innerWidth; canvas.height = innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#4ade80","#fbbf24","#60a5fa","#f87171","#a78bfa","#fb923c","#34d399"];
  const W = canvas.width, H = canvas.height;
  const pieces = [];
  /* two poppers fire up from the bottom corners and fan toward the middle */
  const cannon = (originX, dir) => {
    for (let i = 0; i < 45; i++) {
      const angle = -Math.PI / 2 + dir * (0.05 + Math.random() * 0.6); // up, fanned inward
      const speed = 9 + Math.random() * 8;
      pieces.push({
        x: originX, y: H + 8,
        r: 4 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed, // negative = upward
        angle: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3,
        aspect: 0.35 + Math.random() * 0.5,
      });
    }
  };
  cannon(W * 0.12, 1);   // bottom-left → fan right
  cannon(W * 0.88, -1);  // bottom-right → fan left
  const start = Date.now();
  (function draw() {
    ctx.clearRect(0, 0, W, H);
    pieces.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.vx *= 0.99; p.angle += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r, -p.r * p.aspect, p.r * 2, p.r * 2 * p.aspect);
      ctx.restore();
    });
    if (Date.now() - start < 2800) requestAnimationFrame(draw); else canvas.remove();
  })();
}

let _dailyTimer = null;
let _habitTimer = null;
let _savingsTimer = null;
const SAVE_DELAY = 2000;

/* ---------- icons (feather-style, stroke = currentColor) ---------- */

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.27"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
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

/* git blob SHA-1 of text, computed locally: sha1("blob <bytelen>\0" + content).
   Lets us write a file using only the raw read (no contents-JSON call). */
async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode(`blob ${body.length}`);
  const data = new Uint8Array(prefix.length + 1 + body.length);
  data.set(prefix, 0);
  data[prefix.length] = 0; // NUL separator
  data.set(body, prefix.length + 1);
  const h = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  if (_dailyTimer) { clearTimeout(_dailyTimer); _dailyTimer = null; }
  if (_habitTimer) { clearTimeout(_habitTimer); _habitTimer = null; }
  if (_savingsTimer) { clearTimeout(_savingsTimer); _savingsTimer = null; }
  setSyncStatus("Syncing…");
  state.error = null;
  try {
    const [clients, savings, debts, study, studyplan, daily, schedule, researchDir, masterplan, habits] = await Promise.all([
      fetchRaw(PATHS.clients),
      fetchRaw(PATHS.savings),
      fetchRaw(PATHS.debts),
      fetchRaw(PATHS.study, { optional: true }),
      fetchRaw(PATHS.studyplan, { optional: true }),
      fetchWithSha(todayNotePath(), { optional: true }),
      fetchRaw(PATHS.schedule, { optional: true }),
      fetchDir(PATHS.research, { optional: true }),
      fetchRaw(PATHS.masterplan, { optional: true }),
      fetchWithSha(PATHS.habits, { optional: true }),
    ]);
    let articles = [];
    if (Array.isArray(researchDir)) {
      const mds = researchDir.filter((f) => f.type === "file" && f.name.endsWith(".md"));
      const texts = await Promise.all(mds.map((f) => fetchRaw(`${PATHS.research}/${f.name}`)));
      articles = mds.map((f, i) => ({ name: f.name, text: texts[i] }));
    }
    state.files = { clients, savings, debts, study, studyplan, daily, schedule, articles, masterplan, habits };
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

function applyDailyChange(newText) {
  state.files.daily = { text: newText, sha: state.files.daily?.sha ?? null };
  render();
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = setTimeout(flushDaily, SAVE_DELAY);
}

async function flushDaily() {
  _dailyTimer = null;
  const d = state.files.daily;
  if (!d) return;
  state.busy = true;
  render();
  try {
    const sha = await putFile(todayNotePath(), d.text, "kernel-app: update daily tasks", d.sha ?? undefined);
    state.files.daily.sha = sha;
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
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
  const completing = !/\[[xX]\]/.test(l);
  lines[lineIdx] = completing ? l.replace("[ ]", "[x]") : l.replace(/\[[xX]\]/, "[ ]");
  if (completing) launchConfetti();
  applyDailyChange(lines.join("\n"));
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
  applyDailyChange(lines.join("\n"));
}

/* rewrite a task's text in place, preserving indentation + checkbox state */
function editTask(lineIdx, newText) {
  const d = state.files.daily;
  if (!d || state.busy) return;
  const txt = newText.trim();
  const lines = d.text.split("\n");
  const prefix = (lines[lineIdx] || "").match(/^(\s*- \[[ xX]\]\s*)/);
  if (!prefix || !txt) { state.taskEdit = null; render(); return; }
  lines[lineIdx] = prefix[1] + txt;
  state.taskEdit = null;
  applyDailyChange(lines.join("\n"));
}

/* add one or many tasks in a single commit */
function addTasks(texts) {
  const tasks = texts.map((t) => t.trim()).filter(Boolean).map((t) => `- [ ] ${t}`);
  if (state.busy || !tasks.length) return;
  const d = state.files.daily;
  if (!d) {
    /* no note yet — create it with the tasks in one go */
    const text = `---\ndate: "${todayIso()}"\ntags:\n  - daily\n---\n\n## Today\n\n${tasks.join("\n")}\n\n## Log\n\n`;
    applyDailyChange(text);
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
    /* insert at the top of the list — before the first existing task */
    let insert = -1;
    for (let i = h + 1; i < end; i++) {
      if (/^- \[/.test(lines[i].trim())) { insert = i; break; }
    }
    if (insert === -1) {
      insert = h + 1;
      if ((lines[insert] || "").trim() === "") insert++;
    }
    lines.splice(insert, 0, ...tasks);
  }
  applyDailyChange(lines.join("\n"));
}

/* ---------- habit writes ---------- */

function applyHabitChange(newText) {
  state.files.habits = { text: newText, sha: state.files.habits?.sha ?? null };
  render();
  if (_habitTimer) clearTimeout(_habitTimer);
  _habitTimer = setTimeout(flushHabits, SAVE_DELAY);
}

async function flushHabits() {
  _habitTimer = null;
  const h = state.files.habits;
  if (!h) return;
  state.busy = true;
  render();
  try {
    const sha = await putFile(PATHS.habits, h.text, "kernel-app: update habits", h.sha ?? undefined);
    state.files.habits.sha = sha;
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") {
      state.error = "Write rejected — your token needs Contents: Read and write to track habits.";
    } else if (e.message === "conflict") {
      state.error = "The habit log changed on GitHub since last sync. Refreshing — try again.";
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

/* flip one habit's ✅ for today in the Log table; creates today's row (and any
   missing habit columns) as needed */
function toggleHabit(name) {
  const h = state.files.habits;
  if (!h || state.busy) return;
  const lines = h.text.split("\n");

  const logIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## log"));
  if (logIdx === -1) return;
  let head = -1;
  for (let i = logIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("|")) { head = i; break; }
    if (/^#+\s/.test(lines[i])) return;
  }
  if (head === -1) return;

  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  let cols = cells(lines[head]);

  /* habits added to the list since the table was made get a new column */
  if (!cols.includes(name)) {
    cols = [...cols, name];
    lines[head] = `| ${cols.join(" | ")} |`;
    lines[head + 1] = `|${cols.map(() => "---").join("|")}|`;
    for (let i = head + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
      lines[i] = `| ${[...cells(lines[i]), "—"].slice(0, cols.length).join(" | ")} |`;
    }
  }
  const col = cols.indexOf(name);

  const iso = todayIso();
  let rowIdx = -1;
  for (let i = head + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    if (cells(lines[i])[0] === iso) { rowIdx = i; break; }
  }

  let completing = false;
  if (rowIdx === -1) {
    completing = true;
    const row = cols.map((_, i) => (i === 0 ? iso : i === col ? "✅" : "—"));
    /* insert right after the header so the newest day reads first */
    lines.splice(head + 2, 0, `| ${row.join(" | ")} |`);
  } else {
    const row = cells(lines[rowIdx]);
    while (row.length < cols.length) row.push("—");
    completing = !row[col].includes("✅");
    row[col] = completing ? "✅" : "—";
    lines[rowIdx] = `| ${row.join(" | ")} |`;
  }
  if (completing) launchConfetti();
  applyHabitChange(lines.join("\n"));
}

function addHabit(name) {
  const h = state.files.habits;
  if (!h) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const lines = h.text.split("\n");
  const habIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## habits"));
  if (habIdx === -1) return;
  let end = lines.length;
  for (let i = habIdx + 1; i < lines.length; i++) {
    if (/^#+\s/.test(lines[i])) { end = i; break; }
  }
  const existing = lines.slice(habIdx + 1, end)
    .filter((l) => /^[-*]\s+\S/.test(l.trim()))
    .map((l) => l.trim().replace(/^[-*]\s+/, ""));
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
  let lastItem = habIdx;
  for (let i = habIdx + 1; i < end; i++) {
    if (/^[-*]\s+/.test(lines[i].trim())) lastItem = i;
  }
  lines.splice(lastItem + 1, 0, `- ${trimmed}`);
  applyHabitChange(lines.join("\n"));
}

function removeHabit(name) {
  const h = state.files.habits;
  if (!h) return;
  const lines = h.text.split("\n");
  const habIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## habits"));
  if (habIdx === -1) return;
  let end = lines.length;
  for (let i = habIdx + 1; i < lines.length; i++) {
    if (/^#+\s/.test(lines[i])) { end = i; break; }
  }
  const idx = lines.findIndex((l, i) => {
    if (i <= habIdx || i >= end) return false;
    const c = l.trim();
    return /^[-*]\s+/.test(c) && c.replace(/^[-*]\s+/, "") === name;
  });
  if (idx === -1) return;
  lines.splice(idx, 1);
  applyHabitChange(lines.join("\n"));
}

/* ---------- savings writes (Sunday Review) ---------- */

function applySavingsChange(newText) {
  /* savings is read as raw text in syncAll; keep it as a string here so the
     model reads it the same way, and fetch a fresh sha at write time */
  state.files.savings = newText;
  render();
  if (_savingsTimer) clearTimeout(_savingsTimer);
  _savingsTimer = setTimeout(flushSavings, SAVE_DELAY);
}

async function flushSavings() {
  _savingsTimer = null;
  const text = savingsText();
  if (!text) return;
  state.busy = true;
  render();
  try {
    /* read the current file with the raw endpoint (reliable everywhere) and
       derive its blob sha locally — avoids the contents-JSON call that fails
       in some environments */
    const serverText = await fetchRaw(PATHS.savings);
    const baseSha = await gitBlobSha(serverText);
    await putFile(PATHS.savings, text, "kernel-app: update Sunday review", baseSha);
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") {
      state.error = "Write rejected — your token needs Contents: Read and write to save the review.";
    } else if (e.message === "conflict") {
      state.error = "The savings plan changed on GitHub since last sync. Refreshing — try again.";
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

/* ---------- debt writes (add / edit / mark-paid / remove on DebtLog ## Summary) ---------- */

let _debtTimer = null;

const debtsText = () => {
  const d = state.files.debts;
  return d ? (typeof d === "string" ? d : d.text) : "";
};

/* status presets — emoji+word are stored, an optional free-text "extra" (e.g. "~Jul 2026") trails */
const DEBT_STATUS = [
  { key: "Pending",  str: "⏳ Pending" },
  { key: "Expected", str: "🟡 Expected" },
  { key: "Partial",  str: "🔁 Partial" },
  { key: "Paid",     str: "✅ Paid" },
];

/* "🟡 Expected ~Jul 2026" → { base: "Expected", extra: "~Jul 2026" } */
function parseDebtStatus(s) {
  const clean = (s || "").replace(/[⏳🟡🔁✅]/g, "").trim();
  for (const o of DEBT_STATUS) {
    const re = new RegExp(`\\b${o.key}\\b`, "i");
    if (re.test(clean)) return { base: o.key, extra: clean.replace(re, "").trim() };
  }
  return { base: "Pending", extra: clean };
}

function buildDebtStatus(base, extra) {
  const o = DEBT_STATUS.find((x) => x.key === base) || DEBT_STATUS[0];
  return extra ? `${o.str} ${extra}` : o.str;
}

function applyDebtsChange(newText) {
  state.files.debts = newText;
  state.debtEdit = null;
  state.debtStatusPick = null;
  render();
  if (_debtTimer) clearTimeout(_debtTimer);
  _debtTimer = setTimeout(flushDebts, SAVE_DELAY);
}

async function flushDebts() {
  _debtTimer = null;
  const text = debtsText();
  if (!text) return;
  state.busy = true;
  render();
  try {
    /* fresh raw read → local blob sha → conflict-safe write (same as savings) */
    const serverText = await fetchRaw(PATHS.debts);
    const baseSha = await gitBlobSha(serverText);
    await putFile(PATHS.debts, text, "kernel-app: update debt tracker", baseSha);
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") {
      state.error = "Write rejected — your token needs Contents: Read and write to save debts.";
    } else if (e.message === "conflict") {
      state.error = "The debt log changed on GitHub since last sync. Refreshing — try again.";
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

/* inclusive line range {start,end} of the ## Summary table (header → last row incl. TOTAL) */
function summaryRegion(lines) {
  const h = lines.findIndex((l) => /^##\s+summary/i.test(l.trim()));
  if (h === -1) return null;
  let start = -1, end = -1;
  for (let i = h + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("|")) { if (start === -1) start = i; end = i; }
    else if (start !== -1) break;     // table ended
    else if (/^#+\s/.test(t)) break;  // next heading before any table
  }
  return start === -1 ? null : { start, end };
}

/* TOTAL = sum of outstanding (non-paid) debts; rewrites the **TOTAL** row in place */
function recomputeTotal(lines) {
  const region = summaryRegion(lines);
  if (!region) return;
  let sum = 0, totalRow = -1;
  for (let i = region.start + 2; i <= region.end; i++) {  // +2 skips header + separator
    const cells = lines[i].split("|");
    if (cells.length < 4) continue;
    const name = cells[1].replace(/\*/g, "").trim();
    if (/^total$/i.test(name)) { totalRow = i; continue; }
    if (/✅|paid/i.test(cells[3] || "")) continue;        // paid debts no longer back the goal
    const amt = num(cells[2]);
    if (amt != null) sum += amt;
  }
  if (totalRow !== -1) {
    const cells = lines[totalRow].split("|");
    cells[2] = ` **${fmtNum(sum)}** `;
    lines[totalRow] = cells.join("|");
  }
}

/* append a minimal per-person detail section just before ## Legend (additive, never deletes) */
function addDetailStub(lines, v) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const block = [
    "",
    `## ${v.name}`,
    "",
    "| # | Amount | Date | Notes |",
    "|---|---|---|---|",
    `| 1 | ${fmtNum(v.amount)} DH | ${dateStr} | ${v.extra || "—"} |`,
    `| **Total** | **${fmtNum(v.amount)} DH** | | |`,
    "",
    `**Status:** ${v.status}`,
    "",
    "---",
  ];
  const legendIdx = lines.findIndex((l) => /^##\s+legend/i.test(l.trim()));
  if (legendIdx !== -1) lines.splice(legendIdx, 0, ...block, "");
  else lines.push(...block);
}

/* create or update a Summary row by person name; recompute TOTAL; commit */
function upsertDebt(v) {
  const lines = debtsText().split("\n");
  const region = summaryRegion(lines);
  if (!region) { state.error = "Couldn't find the ## Summary table in DebtLog."; render(); return; }
  const match = (v.originalName || v.name).trim().toLowerCase();
  let rowIdx = -1, totalIdx = -1;
  for (let i = region.start + 2; i <= region.end; i++) {
    const cells = lines[i].split("|");
    if (cells.length < 4) continue;
    const nm = cells[1].replace(/\*/g, "").trim();
    if (/^total$/i.test(nm)) { totalIdx = i; continue; }
    if (nm.toLowerCase() === match) rowIdx = i;
  }
  const rowStr = `| ${v.name} | ${fmtNum(v.amount)} | ${v.status} |`;
  if (rowIdx !== -1) {
    lines[rowIdx] = rowStr;
  } else {
    lines.splice(totalIdx !== -1 ? totalIdx : region.end + 1, 0, rowStr);
    addDetailStub(lines, v);  // give the new person a home in the file
  }
  recomputeTotal(lines);
  applyDebtsChange(lines.join("\n"));
}

/* delete a person's Summary row (detail section left intact as history); recompute TOTAL */
function removeDebt(name) {
  const lines = debtsText().split("\n");
  const region = summaryRegion(lines);
  if (!region) return;
  const target = name.trim().toLowerCase();
  for (let i = region.start + 2; i <= region.end; i++) {
    const cells = lines[i].split("|");
    if (cells.length < 4) continue;
    if (cells[1].replace(/\*/g, "").trim().toLowerCase() === target) { lines.splice(i, 1); break; }
  }
  recomputeTotal(lines);
  applyDebtsChange(lines.join("\n"));
}

/* Monday (ISO) of the week containing date d, as YYYY-MM-DD */
function mondayOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
const weekOfMonday = () => mondayOf(new Date());

function savingsText() {
  const s = state.files.savings;
  return s ? (typeof s === "string" ? s : s.text) : "";
}

const fmtNum = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/* replace a "| **Key** | value |" row's value inside the ## Goal table */
function setGoalField(lines, key, value) {
  const gStart = lines.findIndex((l) => /^##\s+goal/i.test(l.trim()));
  if (gStart === -1) return;
  for (let i = gStart + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const cells = lines[i].split("|");
    if (cells.length >= 3 && cells[1].replace(/\*/g, "").trim().toLowerCase() === key.toLowerCase()) {
      cells[2] = ` ${value} `;
      lines[i] = cells.join("|");
      return;
    }
  }
}

/* Save a weekly review: append a dated Review Log entry, then (optionally)
   update Current savings, Remaining to goal, and the current month's tracker row */
function saveReview(v) {
  if (state.busy) return;
  const lines = savingsText().split("\n");
  const s = buildModel().savings;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dow = now.toLocaleDateString("en-US", { weekday: "short" });

  /* 1) Review Log entry (newest first) */
  const entry = [
    `### ${dateStr} (${dow})`,
    `- Balance: ${v.balance != null ? fmtNum(v.balance) + " MAD" : "—"}`,
    `- Spent this week: ${v.spent != null ? fmtNum(v.spent) + " MAD" : "—"}`,
    `- Discretionary: ${v.disc != null ? fmtNum(v.disc) + " MAD" : "—"}`,
    `- Monk mode: ${v.monk || "—"}`,
    `- Notes: ${v.notes || "—"}`,
    "",
  ];
  let logIdx = lines.findIndex((l) => /^##\s+review log/i.test(l.trim()));
  if (logIdx === -1) {
    lines.push("", "## Review Log", "");
    logIdx = lines.length - 2;
  }
  /* skip the heading + any intro prose/blank, insert before the first existing entry */
  let insertAt = logIdx + 1;
  while (insertAt < lines.length && !/^###\s/.test(lines[insertAt]) && !/^##\s/.test(lines[insertAt])) insertAt++;
  lines.splice(insertAt, 0, ...entry);

  /* 2) live updates from the balance */
  if (v.balance != null) {
    const dateNice = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setGoalField(lines, "Current savings", `${fmtNum(v.balance)} MAD (${dateNice})`);
    if (s.target) setGoalField(lines, "Remaining to goal", `${fmtNum(Math.max(0, s.target - v.balance))} MAD`);

    /* tracker: current month row → Saved, Total Saved, Rate, On Track? */
    const tStart = lines.findIndex((l) => /^##\s+progress tracker/i.test(l.trim()));
    if (tStart !== -1) {
      const mShort = now.toLocaleDateString("en-US", { month: "short" });
      const yr = String(now.getFullYear());
      let tEnd = lines.length;
      for (let i = tStart + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { tEnd = i; break; } }
      const dataRows = [];
      for (let i = tStart + 1; i < tEnd; i++) {
        if (lines[i].trim().startsWith("|") && !/^\|[\s\-:|]+\|$/.test(lines[i].trim()) && !/Month/i.test(lines[i])) dataRows.push(i);
      }
      const curIdx = dataRows.find((i) => lines[i].includes(mShort) && lines[i].includes(yr));
      /* baseline = last prior month's Total Saved, else plan start */
      let baseline = s.planStart || 0;
      for (const i of dataRows) {
        if (i === curIdx) break;
        const t = num(lines[i].split("|")[5]); // Total Saved col
        if (t != null) baseline = t;
      }
      if (curIdx != null) {
        const saved = v.balance - baseline;
        const cells = lines[curIdx].split("|"); // ["", " Jun 2026 ", salary, exp, saved, total, rate, ontrack, ""]
        const salary = num(cells[2]);
        cells[1] = ` ${mShort} ${yr} `;
        cells[4] = ` ${fmtNum(saved)} `;
        cells[5] = ` ${fmtNum(v.balance)} `;
        cells[6] = ` ${salary ? Math.round((saved / salary) * 100) + "%" : "—"} `;
        cells[7] = ` ${saved >= (s.monthlyFloor || 0) ? "✓" : "✗"} `;
        lines[curIdx] = cells.join("|");
      }
    }
  }

  state.reviewEdit = false;
  applySavingsChange(lines.join("\n"));
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
  if (s.includes("🔁")) return ["info", s];
  return ["dim", s];
}

/* stable color per calendar name — hashes into a fixed palette */
const CAL_PALETTE = ["#60a5fa", "#4ade80", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#34d399", "#f472b6"];
function calColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAL_PALETTE[h % CAL_PALETTE.length];
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
    study: null, tasks: null, schedule: null, articles: [], review: null,
  };

  if (f.clients) {
    m.leads = parseTable(section(f.clients, "## Leads"));
    m.active = parseTable(section(f.clients, "## Active Customers")).map((c) => ({
      ...c, days: daysUntil(c.Expiry),
    }));
    m.churned = parseTable(section(f.clients, "## Churned"));
  }

  const fSavings = f.savings ? (typeof f.savings === "string" ? f.savings : f.savings.text) : null;
  if (fSavings) {
    const goal = parseTable(section(fSavings, "## Goal"));
    const kv = {};
    goal.forEach((r) => {
      const vals = Object.values(r);
      if (vals.length >= 2) kv[vals[0].replace(/\*/g, "")] = vals[1].replace(/\*/g, "");
    });

    /* monthly target range — the "Savings out (first)" rows in the budget section
       (floor = low-salary month, stretch = high-salary month) */
    const budget = section(fSavings, "## Monk Mode Monthly Budget");
    const outs = (budget.match(/savings out[^|]*\|\s*\**\s*([\d,]+)/gi) || [])
      .map((x) => num(x)).filter((n) => n);
    const monthlyFloor = outs.length ? Math.min(...outs) : (num(kv["Strict mode monthly target"]) || 5500);
    const monthlyStretch = outs.length ? Math.max(...outs) : monthlyFloor;

    m.savings = {
      target: num(kv["Target"]) || 50000,
      current: num(kv["Current savings"]),
      currentRaw: kv["Current savings"] || "",
      planStart: num(kv["Plan start"]),
      monthly: monthlyStretch,
      monthlyFloor,
      monthlyStretch,
      discCeiling: 383,
      deadline: kv["Deadline"] || "",
      remaining: num(kv["Remaining to goal"]),
      spending: num(kv["Spending account"]),
      paymentsLeft: num(kv["Salary payments left"]),
      salaryDay: num(kv["Salary day"]) || 28,
      tracker: parseTable(section(fSavings, "## Progress Tracker")),
    };

    /* this month's actual — a tracker row with a numeric Saved cell counts as logged */
    const now = new Date();
    const mShort = now.toLocaleDateString("en-US", { month: "short" });
    const row = m.savings.tracker.find((r) => {
      const v = Object.values(r)[0] || "";
      return v.includes(mShort) && v.includes(String(now.getFullYear()));
    });
    const vals = row ? Object.values(row) : [];
    const savedCell = vals[3] || "";          // Saved (MAD)
    const salaryCell = vals[1] || "";          // Salary (MAD)
    m.savings.monthSaved = num(savedCell) || 0;
    m.savings.monthSalary = num(salaryCell) || 0;
    m.savings.rate = m.savings.monthSalary > 0 ? (m.savings.monthSaved / m.savings.monthSalary) * 100 : null;

    /* Review Log — parse "### <date>" entries with their `- Key: value` fields */
    const logBody = section(fSavings, "## Review Log");
    const entries = [];
    let cur = null;
    logBody.split("\n").forEach((ln) => {
      const h = ln.trim().match(/^###\s+(.+)$/);
      if (h) {
        cur = { dateRaw: h[1].trim(), date: new Date(h[1].replace(/\(.*\)/, "").trim()), fields: {} };
        entries.push(cur);
        return;
      }
      const fm = ln.trim().match(/^[-*]\s*([^:]+):\s*(.*)$/);
      if (cur && fm) cur.fields[fm[1].trim().toLowerCase()] = fm[2].trim();
    });
    const thisMon = weekOfMonday();
    const thisWeek = entries.find((e) => !isNaN(e.date) && mondayOf(e.date) === thisMon);
    m.review = { entries, thisWeek, thisMon };
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

  m.habits = null;
  if (f.habits && typeof f.habits.text === "string") {
    const names = section(f.habits.text, "## Habits")
      .split("\n").map((l) => l.trim())
      .filter((l) => /^[-*]\s+\S/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, ""));
    const rows = parseTable(section(f.habits.text, "## Log"));
    const byDate = {};
    rows.forEach((r) => { if (r.Date) byDate[r.Date] = r; });
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    m.habits = names.map((name) => {
      const week = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        week.push(!!(byDate[iso(d)] && (byDate[iso(d)][name] || "").includes("✅")));
      }
      const doneToday = week[6];
      /* streak counts back from today, or from yesterday if today isn't ticked yet */
      let streak = 0;
      for (let i = doneToday ? 0 : 1; ; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if (byDate[iso(d)] && (byDate[iso(d)][name] || "").includes("✅")) streak++;
        else break;
      }
      return { name, doneToday, streak, week };
    });
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
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const dis = state.busy ? "disabled" : "";

  const open = m.tasks ? m.tasks.filter((t) => !t.done).length : 0;
  const heroSub = m.tasks === null ? "No daily note yet"
    : open === 0 ? "All tasks done" : `${open} task${open === 1 ? "" : "s"} remaining`;

  /* coach card — the accountability line up top */
  const monthly = s.monthly || 5500;
  const remaining = Math.max(0, monthly - (s.monthSaved || 0));
  const coachMsg = remaining === 0
    ? `Monthly target hit — ${monthly.toLocaleString()} MAD saved. Keep going.`
    : `Save ${remaining.toLocaleString()} MAD${s.monthSaved ? " more" : ""} this month to stay on track`;

  const tasksHtml = m.tasks === null
    ? `<div class="empty">No daily note yet today — tap + to start one</div>`
    : `${m.tasks.length === 0 ? `<div class="empty">Nothing on the list — tap + to add tasks</div>` : ""}
       ${m.tasks.map((t) => state.taskEdit === t.line
         ? `<div class="task-row task-edit">
              <input type="text" class="task-edit-input" id="task-edit-input" value="${esc(t.text)}" autocomplete="off">
              <button class="task-icon-btn save" data-edit-save="${t.line}" title="Save" aria-label="Save">${icon("check", 16)}</button>
              <button class="task-icon-btn" id="btn-task-edit-cancel" title="Cancel" aria-label="Cancel">${icon("x", 16)}</button>
            </div>`
         : `<div class="task-row">
              <button class="task ${t.done ? "done" : ""}" data-line="${t.line}" ${dis}>
                <span class="box">${t.done ? "✓" : ""}</span>
                <span class="txt">${esc(t.text)}</span>
              </button>
              <button class="task-icon-btn" data-edit-line="${t.line}" title="Edit task" aria-label="Edit task" ${dis}>${icon("pencil", 15)}</button>
              <button class="task-icon-btn del" data-del-line="${t.line}" title="Remove task" aria-label="Remove task" ${dis}>${icon("x", 15)}</button>
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
      const dot = e.cal ? `<span class="cal-dot" style="background:${calColor(e.cal)}" title="${esc(e.cal)}"></span>` : "";
      const calTag = e.cal ? `<span class="cal-tag">${esc(e.cal)}</span>` : "";
      return `<div class="row">
        <div class="r-main"><div class="r-title">${dot}${esc(e.title || "Busy")}</div>
        <div class="r-sub">${e.allDay ? "All day" : `${esc(e.start || "?")} – ${esc(e.end || "?")}`}${calTag}</div></div>
        <div class="r-end">${live ? `<span class="chip ok">now</span>` : ""}</div>
      </div>`;
    }).join("");
  }

  const nextTone = !next ? "dim" : next.days <= 7 ? "bad" : next.days <= 30 ? "warn" : "ok";

  return `
  <div class="hero">
    <div class="hero-date">${esc(dateStr)}</div>
    <div class="hero-sub">${esc(heroSub)}${state.busy ? " · saving…" : ""}</div>
  </div>

  <div class="coach">
    <div class="coach-text">${esc(coachMsg)}</div>
    <div class="coach-val">${pct.toFixed(0)}%<small>of ${s.target ? Math.round(s.target / 1000) : 50}K goal</small></div>
  </div>

  <div class="card">
    <h2>Tasks</h2>
    ${tasksHtml}
  </div>

  <div class="card">
    <h2>Schedule ${m.schedule && m.schedule.updated ? `<span class="h-extra muted">synced ${esc(m.schedule.updated.slice(0, 16).replace("T", " "))}</span>` : ""}</h2>
    ${scheduleHtml}
  </div>

  <div class="duo">
    ${m.study ? `
    <button class="card duo-tile" id="btn-study-open" title="Open the study plan">
      <h2>Cloud study ${icon("chevronRight", 13)}</h2>
      <div class="duo-val">${m.study.done}/${m.study.total}</div>
      <div class="duo-sub">${esc(m.study.title)} · ${m.study.total ? Math.round((m.study.done / m.study.total) * 100) : 0}%</div>
    </button>` : ""}
    <div class="card duo-tile">
      <h2>Next renewal</h2>
      <div class="duo-val t-${nextTone}">${next ? (next.days < 0 ? `${-next.days}d ago` : `${next.days}d`) : "—"}</div>
      <div class="duo-sub">${next ? `${esc((next.Name || "").split(" ").pop())} · ${esc(next.Expiry || "")}` : "no expiry dates"}</div>
    </div>
  </div>`;
}

/* the order the cards render in — the sheet looks clients up by index in this list */
function clientsSorted(m, tab) {
  const list = tab === "active" ? m.active : tab === "leads" ? m.leads : m.churned;
  return tab === "active" ? [...list].sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)) : list;
}

/* "1M" / "6M" / "1Y" → human label for the client badge */
function planLabel(plan) {
  const m = String(plan || "").match(/(\d+)\s*([MY])/i);
  if (!m) return plan || "";
  const n = parseInt(m[1], 10);
  const unit = m[2].toUpperCase() === "Y"
    ? (n === 1 ? "Year" : "Years")
    : (n === 1 ? "Month" : "Months");
  return `${n} ${unit}`;
}

/* "1M" / "6M" / "1Y" → plan length in days, for the time-used bar */
function planDays(plan) {
  const m = String(plan || "").match(/(\d+)\s*([MY])/i);
  if (!m) return null;
  return parseInt(m[1], 10) * (m[2].toUpperCase() === "Y" ? 365 : 30);
}

function clientCard(c, kind, key) {
  const [cls, label] = statusChip(c.Status);

  /* status chips only as exceptions — ✅ Active / 🔴 Churned are the tab's norm */
  const isNorm = kind === "active" ? (c.Status || "").includes("✅")
    : kind === "churned" ? true : false;
  const chip = isNorm ? "" : `<span class="chip ${cls}">${esc(label)}</span>`;

  const badgeTxt = kind === "active"
    ? [cval(c.App), planLabel(cval(c.Plan))].filter(Boolean).join(" · ")
    : cval(c.App);
  const badge = badgeTxt ? `<span class="cc-badge">${esc(badgeTxt)}</span>` : "";

  let right, bar = "";
  if (kind === "active") {
    const d = c.days;
    const tone = d === null ? "dim" : d <= 7 ? "bad" : d <= 30 ? "warn" : "ok";
    right = `${badge}${chip}<span class="cc-days t-${tone}">${d === null ? "—" : d < 0 ? `${-d}d ago` : `${d}d`}</span>`;
    const total = planDays(c.Plan);
    if (total && d !== null) {
      const used = Math.min(100, Math.max(2, (1 - d / total) * 100));
      bar = `<div class="sub-bar"><div class="sub-bar-fill t-${tone}" style="width:${used.toFixed(0)}%"></div></div>`;
    }
  } else if (kind === "leads") {
    right = `${badge}${chip}`;
  } else {
    right = `${badge}<span class="cc-date">${esc(cval(c.Date))}</span>`;
  }

  return `
  <button class="card client-card" data-client="${esc(key)}">
    <div class="cc-row">
      <div class="cc-main">
        <div class="cc-name">${esc(cval(c.Name) || "—")}</div>
        <div class="cc-sub">${esc(cval(c.Phone) || "—")}</div>
      </div>
      <div class="cc-right">${right}</div>
    </div>
    ${bar}
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

/* days until the next salary day (the Nth of a month) */
function daysUntilSalary(day) {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), day);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    next = new Date(now.getFullYear(), now.getMonth() + 1, day);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((next - today) / 86400000);
}

/* monthly savings-rate band, per the monk-mode article */
function rateBand(rate) {
  if (rate === null) return ["dim", "—"];
  if (rate >= 65) return ["ok", "Deep monk mode"];
  if (rate >= 55) return ["ok", "Monk mode"];
  if (rate >= 40) return ["warn", "Slipping"];
  return ["bad", "Off monk mode"];
}

function renderMoney(m) {
  const s = m.savings;
  const pct = s.current && s.target ? Math.min(100, (s.current / s.target) * 100) : 0;
  const nowM = new Date().toLocaleDateString("en-US", { month: "short" });
  const nowY = String(new Date().getFullYear());
  const floor = s.monthlyFloor || s.monthly || 4883;
  const stretch = s.monthlyStretch || s.monthly || 5500;
  const remaining = s.remaining !== null && s.remaining !== undefined
    ? s.remaining
    : Math.max(0, (s.target || 0) - (s.current || 0));
  const dueThisMonth = Math.max(0, floor - (s.monthSaved || 0));

  /* milestone markers on the goal bar */
  const milestones = [20000, 35000, 50000].filter((v) => v < (s.target || 50000) || v === 50000);
  const markers = milestones.map((v) => {
    const left = Math.min(100, (v / (s.target || 50000)) * 100);
    const hit = (s.current || 0) >= v;
    return `<span class="ms-mark ${hit ? "hit" : ""}" style="left:${left}%" title="${v.toLocaleString()} MAD"></span>`;
  }).join("");

  /* ---- this month ---- */
  const salaryDays = daysUntilSalary(s.salaryDay || 28);
  const [bandCls, bandLabel] = rateBand(s.rate ?? null);
  const monthCard = `
  <div class="card">
    <h2>This Month <span class="h-extra muted">${nowM} ${nowY}</span></h2>
    <div class="month-grid">
      <div class="mg-cell">
        <div class="mg-val">${salaryDays === 0 ? "Today" : `${salaryDays}d`}</div>
        <div class="mg-lbl">next salary (${s.salaryDay || 28}th) — transfer first</div>
      </div>
      <div class="mg-cell">
        <div class="mg-val">${floor.toLocaleString()}<span class="mg-arrow">→</span>${stretch.toLocaleString()}</div>
        <div class="mg-lbl">monthly target (floor → stretch)</div>
      </div>
    </div>
    ${s.monthSaved > 0
      ? `<div class="month-saved">
           <div class="ms-row"><span>Saved this month</span><b>${s.monthSaved.toLocaleString()} MAD</b></div>
           ${s.rate !== null ? `<div class="ms-row"><span>Savings rate</span><span class="chip ${bandCls}">${s.rate.toFixed(0)}% · ${bandLabel}</span></div>` : ""}
         </div>`
      : `<div class="bar-sub" style="margin-top:10px"><span>Not logged yet this month</span><span>${dueThisMonth.toLocaleString()} MAD to floor</span></div>`}
  </div>`;

  /* ---- Sunday review (form + history) ---- */
  let reviewCard = "";
  if (m.review) {
    const r = m.review;
    const isSunday = new Date().getDay() === 0;
    const done = r.thisWeek && !state.reviewEdit;
    const dis = state.busy ? "disabled" : "";
    const badge = done
      ? `<span class="chip ok">done ✓</span>`
      : `<span class="chip ${isSunday ? "warn" : "info"}">${isSunday ? "due today" : "due this week"}</span>`;

    if (done) {
      const f = r.thisWeek.fields;
      reviewCard = `
      <div class="card">
        <h2>Sunday Review ${badge}</h2>
        <p class="muted review-note">Reviewed ${esc(r.thisWeek.dateRaw)}.</p>
        <div class="month-saved">
          ${f.balance ? `<div class="ms-row"><span>Balance</span><b>${esc(f.balance)}</b></div>` : ""}
          ${f["spent this week"] ? `<div class="ms-row"><span>Spent this week</span><span>${esc(f["spent this week"])}</span></div>` : ""}
          ${f.discretionary ? `<div class="ms-row"><span>Discretionary</span><span>${esc(f.discretionary)}</span></div>` : ""}
          ${f["monk mode"] ? `<div class="ms-row"><span>Monk mode</span><span>${esc(f["monk mode"])}</span></div>` : ""}
        </div>
        <button class="show-toggle" id="btn-review-again" ${dis}>Review again</button>
      </div>`;
    } else {
      const monkOpts = ["Yes", "Mostly", "No"];
      const pick = state.reviewMonk;
      reviewCard = `
      <div class="card">
        <h2>Sunday Review ${badge}</h2>
        <p class="muted review-note">Fill this in, tap Save — it logs a dated entry and updates your savings + tracker.</p>
        <label class="rv-label">Savings account balance (MAD)</label>
        <input type="number" inputmode="decimal" id="rv-balance" placeholder="${s.current ? fmtNum(s.current) : "0"}" value="">
        <label class="rv-label">Total spent this week (MAD)</label>
        <input type="number" inputmode="decimal" id="rv-spent" placeholder="0">
        <label class="rv-label">Discretionary this week (MAD) <span class="muted">· ceiling ${s.discCeiling || 383}</span></label>
        <input type="number" inputmode="decimal" id="rv-disc" placeholder="0">
        <label class="rv-label">In monk mode this week?</label>
        <div class="seg rv-seg">
          ${monkOpts.map((o) => `<button type="button" data-monk="${o}" class="${pick === o ? "active" : ""}">${o}</button>`).join("")}
        </div>
        <label class="rv-label">Notes / near-misses <span class="muted">· optional</span></label>
        <input type="text" id="rv-notes" placeholder="Anything worth remembering…">
        <div style="height:12px"></div>
        <button class="btn" id="btn-review-save" ${dis}>Save review</button>
        ${r.thisWeek ? `<button class="show-toggle" id="btn-review-cancel">Cancel</button>` : ""}
      </div>`;
    }
  }

  /* ---- monthly tracker (compact, projections behind a toggle) ---- */
  const trackerRows = (s.tracker || []).map((r) => {
    const vals = Object.values(r).map((v) => v.replace(/\*/g, ""));
    const month = vals[0] || "";
    const saved = num(vals[3]);
    const total = num(vals[4]);
    const isCurrent = month.includes(nowM) && month.includes(nowY);
    const isActual = saved !== null;
    const isProj = !isActual && !isCurrent;
    const onTrack = /✓|yes/i.test(vals[6] || "");
    const offTrack = /✗|no/i.test(vals[6] || "");
    const barPct = saved !== null ? Math.min(100, Math.round((saved / stretch) * 100)) : 0;
    const pill = isCurrent && !isActual
      ? `<span class="tr-now">now</span>`
      : isActual
        ? (onTrack ? `<span class="chip ok pill-xs">✓</span>` : offTrack ? `<span class="chip bad pill-xs">✗</span>` : "")
        : `<span class="muted pill-xs">projected</span>`;
    const sub = isActual
      ? `${saved.toLocaleString()} MAD saved${total !== null ? ` · ${total.toLocaleString()} total` : ""}`
      : isCurrent ? "in progress" : "—";
    return {
      isProj,
      html: `<div class="tracker-row${isCurrent ? " tr-cur" : ""}${isProj ? " tr-proj" : ""}">
        <div class="tr-head"><span class="tr-month">${esc(month.replace(/←.*$/, "").trim())}</span>${pill}</div>
        <div class="tr-bar"><div class="tr-bar-fill" style="width:${barPct}%"></div></div>
        <div class="tr-amount">${sub}</div>
      </div>`,
    };
  });

  const trackerCard = trackerRows.length ? (() => {
    const visible = trackerRows.filter((r) => !r.isProj);
    const proj = trackerRows.filter((r) => r.isProj);
    const toggleBtn = proj.length
      ? `<button class="show-toggle" id="btn-tracker-toggle">${state.trackerExpanded ? "Show less" : `+ ${proj.length} projected month${proj.length === 1 ? "" : "s"}`}</button>`
      : "";
    return `<div class="card">
      <h2>Monthly Tracker</h2>
      ${visible.map((r) => r.html).join("")}
      ${state.trackerExpanded ? proj.map((r) => r.html).join("") : ""}
      ${toggleBtn}
    </div>`;
  })() : "";

  /* ---- windfall insurance (debts) — add / edit / mark-paid / remove ---- */
  const dbusy = state.busy ? "disabled" : "";
  let debtBody;
  if (state.debtEdit) {
    const editing = state.debtEdit !== "__new__";
    const ex = editing ? m.debts.find((d) => d.name === state.debtEdit) : null;
    const ps = parseDebtStatus(ex ? ex.status : "");
    const basePick = state.debtStatusPick || ps.base;
    debtBody = `
      <label class="rv-label">Person</label>
      <input type="text" id="db-name" placeholder="Who owes you" value="${editing ? esc(ex.name) : ""}" ${editing ? "readonly" : ""}>
      <label class="rv-label">Amount (MAD)</label>
      <input type="number" inputmode="decimal" id="db-amount" placeholder="0" value="${ex && ex.amount != null ? ex.amount : ""}">
      <label class="rv-label">Status</label>
      <div class="seg rv-seg">
        ${DEBT_STATUS.map((o) => `<button type="button" data-debt-status="${o.key}" class="${basePick === o.key ? "active" : ""}">${o.key}</button>`).join("")}
      </div>
      <label class="rv-label">Status detail <span class="muted">· optional, e.g. ~Jul 2026</span></label>
      <input type="text" id="db-extra" placeholder="timeline or note" value="${editing ? esc(ps.extra) : ""}">
      <div style="height:12px"></div>
      <button class="btn" id="btn-debt-save" ${dbusy}>${editing ? "Save changes" : "Add debt"}</button>
      ${editing ? `<button class="show-toggle" id="btn-debt-paid" ${dbusy}>Mark paid ✅</button>
                   <button class="show-toggle danger" id="btn-debt-remove" ${dbusy}>Remove debt</button>` : ""}
      <button class="show-toggle" id="btn-debt-cancel">Cancel</button>`;
  } else {
    debtBody = `
      ${m.debts.map((d) => {
        const [cls, label] = statusChip(d.status);
        return `<div class="row debt-row" data-debt-edit="${esc(d.name)}">
          <div class="r-main"><div class="r-title">${esc(d.name)}</div></div>
          <div class="r-end"><b>${d.amount ? d.amount.toLocaleString() : "—"}</b> <span class="muted">MAD</span>
          <span class="chip ${cls}" style="margin-left:6px">${esc(label)}</span>
          <span class="debt-edit-ic">✏️</span></div>
        </div>`;
      }).join("") || `<div class="empty">No debts tracked</div>`}
      <button class="show-toggle" id="btn-debt-add">+ Add debt</button>`;
  }
  const debtCard = `
  <div class="card">
    <h2>Windfall Insurance ${m.debtTotal ? `<span class="h-extra">${m.debtTotal.toLocaleString()} MAD</span>` : ""}</h2>
    <p class="muted review-note">Debts owed to you — insurance for the goal, not spending money. ${m.debtTotal && remaining ? `Covers ${Math.min(100, Math.round((m.debtTotal / remaining) * 100))}% of the gap to 50K.` : ""}</p>
    ${debtBody}
  </div>`;

  return `
  <div class="card monk-goal">
    <div class="monk-head">
      <span class="monk-tag">⚡ MONK MODE</span>
      <span class="monk-sub">${s.paymentsLeft ? `${s.paymentsLeft} salaries left` : ""}${s.deadline ? ` · ${esc(s.deadline.split("(")[0].trim())}` : ""}</span>
    </div>
    <div class="big-number">${s.current ? s.current.toLocaleString() : "—"} <small>/ ${s.target ? s.target.toLocaleString() : "—"} MAD</small></div>
    <div class="bar ms-bar"><div style="width:${pct}%"></div>${markers}</div>
    <div class="bar-sub"><span>${pct.toFixed(1)}%</span><span>${remaining > 0 ? `${remaining.toLocaleString()} MAD to go` : "goal reached ✓"}</span></div>
  </div>

  ${monthCard}
  ${reviewCard}
  ${trackerCard}
  ${debtCard}

  <div class="card locked">
    <h2>Emergency Fund</h2>
    <div class="row"><div class="r-main"><div class="r-title">9,450 MAD</div>
    <div class="r-sub">The wall — ring-fenced, not available money</div></div>
    <div class="r-end"><span class="chip dim">🔒 locked</span></div></div>
  </div>`;
}

function renderHabits(m) {
  if (!m.habits) {
    return `<div class="card"><div class="empty">No habit log synced yet — pull to refresh, or check that HabitLog.md exists in the vault</div></div>`;
  }
  const done = m.habits.filter((h) => h.doneToday).length;
  const dis = state.busy ? "disabled" : "";
  const editing = state.habitsEdit;

  const habitRows = m.habits.map((h, i) => `
    <div class="habit-wrap${editing ? " editing" : ""}">
      ${editing ? `<button class="habit-del" data-del-habit="${esc(h.name)}" aria-label="Remove ${esc(h.name)}">${icon("x", 15)}</button>` : ""}
      <button class="habit ${h.doneToday ? "done" : ""}" data-habit="${i}" ${dis}>
        <span class="box">${h.doneToday ? "✓" : ""}</span>
        <span class="hb-main">
          <span class="hb-name">${esc(h.name)}</span>
          <span class="hb-week">${h.week.map((d, j) => `<span class="hb-dot ${d ? "on" : ""} ${j === 6 ? "today" : ""}"></span>`).join("")}</span>
        </span>
        <span class="hb-streak ${h.streak > 0 ? "hot" : ""}">${h.streak > 0 ? `${h.streak}🔥` : "—"}</span>
      </button>
    </div>`).join("");

  return `
  <div class="card">
    <h2>
      <span>Today <span class="h-extra muted">${done}/${m.habits.length} done${state.busy ? " · saving…" : ""}</span></span>
      ${m.habits.length > 0 ? `<button class="text-btn" id="btn-habits-edit">${editing ? "Done" : "Edit"}</button>` : ""}
    </h2>
    ${m.habits.length === 0 ? `<div class="empty">No habits yet — tap + to add one</div>` : ""}
    ${habitRows}
  </div>
  <p class="muted" style="font-size:0.75rem;padding:0 4px;">Dots show the last 7 days. Edits sync automatically.</p>`;
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
      </article>
      <button class="art-float-back" id="btn-art-float-back" aria-label="Back to articles">${icon("chevronLeft", 22)}</button>`;
    }
    state.article = null;
  }
  if (!m.articles.length) return `<div class="empty">No research articles in the vault yet</div>`;

  const q = state.articleQuery.trim().toLowerCase();
  const matches = q
    ? m.articles.filter((a) =>
        [a.title, a.excerpt, a.topic, a.author, a.body].some((f) => (f || "").toLowerCase().includes(q)))
    : m.articles;

  const search = `
    <div class="search-bar">
      ${icon("search", 17)}
      <input type="search" id="art-search" placeholder="Search articles…" value="${esc(state.articleQuery)}" autocomplete="off">
      ${q ? `<button class="search-clear" id="art-search-clear" aria-label="Clear search">${icon("x", 16)}</button>` : ""}
    </div>`;

  const list = matches.length
    ? matches.map((a) => `
      <button class="card art-card" data-article="${esc(a.name)}">
        <div class="art-title">${esc(a.title)}</div>
        ${a.excerpt ? `<div class="art-excerpt">${esc(a.excerpt)}</div>` : ""}
        <div class="art-meta">${esc(a.created)}${a.topic ? ` · ${esc(a.topic)}` : ""} · ${a.minutes} min read</div>
      </button>`).join("")
    : `<div class="empty">No articles match "${esc(state.articleQuery)}"</div>`;

  return search + list;
}

/* in-app reader for the cloud study plan — reuses the article styling + floating back */
function renderStudyDoc() {
  const md = state.files.studyplan;
  if (!md) {
    return `<button class="back-btn" id="btn-study-back">${icon("chevronLeft", 17)} Back</button>
      <div class="empty">Study plan not synced yet — pull to refresh.</div>`;
  }
  return `
    <button class="back-btn" id="btn-study-back">${icon("chevronLeft", 17)} Back</button>
    <article class="article">
      ${mdToHtml(stripFrontmatter(md))}
    </article>
    <button class="art-float-back" id="btn-study-float-back" aria-label="Back">${icon("chevronLeft", 22)}</button>`;
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
    <button class="btn" id="btn-sync-now">Sync now</button>
    <div style="height:8px"></div>
    <button class="btn secondary" id="btn-clear-cache">Clear cached data</button>
    <div style="height:8px"></div>
    <button class="btn danger" id="btn-logout">Forget token &amp; data</button>
  </div>
  <div class="card">
    <h2>About <span class="h-extra">${APP_VERSION}</span></h2>
    <p class="muted" style="font-size:0.8rem;line-height:1.5">Kernel — dashboard over a private vault repo. Data is fetched straight from GitHub on this device and cached locally. Task edits are committed back to the vault as you. The Today schedule reads a file kept fresh by a GitHub Action in the vault repo. Nothing is sent anywhere else.</p>
    <p class="muted" style="font-size:0.72rem;margin-top:8px">Build ${APP_VERSION} · if this looks behind after a deploy, fully close and reopen the app.</p>
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
  if (state.studyDoc) html += renderStudyDoc();
  else if (!state.files.clients && !state.error) html += `<div class="empty">Loading vault…</div>`;
  else html += v === "today" ? renderToday(m)
    : v === "clients" ? renderClients(m)
    : v === "money" ? renderMoney(m)
    : v === "articles" ? renderArticles(m)
    : v === "habits" ? renderHabits(m)
    : renderSettings();
  $("#view").innerHTML = html;

  if (state.studyDoc) {
    const close = () => { state.studyDoc = false; showBars(); render(); scrollTo(0, 0); };
    const sb = $("#btn-study-back"); if (sb) sb.onclick = close;
    const sfb = $("#btn-study-float-back"); if (sfb) sfb.onclick = close;
  }

  /* settings has no tab — opening it via the gear clears the bar */
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));

  /* the floating add button adds tasks on Today, habits on Habits (never over the reader) */
  $("#fab").classList.toggle("hidden", state.studyDoc || (v !== "today" && v !== "habits"));
  $("#fab").disabled = state.busy;

  if (v === "today" && !state.studyDoc) {
    document.querySelectorAll(".task[data-line]").forEach((b) => {
      b.onclick = () => toggleTask(parseInt(b.dataset.line, 10));
    });
    document.querySelectorAll("[data-del-line]").forEach((b) => {
      b.onclick = () => removeTask(parseInt(b.dataset.delLine, 10));
    });
    document.querySelectorAll("[data-edit-line]").forEach((b) => {
      b.onclick = () => { state.taskEdit = parseInt(b.dataset.editLine, 10); render(); };
    });
    const studyOpen = $("#btn-study-open");
    if (studyOpen) studyOpen.onclick = () => { state.studyDoc = true; showBars(); render(); scrollTo(0, 0); };
    const editInput = $("#task-edit-input");
    if (editInput) {
      editInput.focus();
      editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      editInput.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); editTask(state.taskEdit, editInput.value); }
        else if (e.key === "Escape") { state.taskEdit = null; render(); }
      };
    }
    document.querySelectorAll("[data-edit-save]").forEach((b) => {
      b.onclick = () => editTask(parseInt(b.dataset.editSave, 10), $("#task-edit-input").value);
    });
    const editCancel = $("#btn-task-edit-cancel");
    if (editCancel) editCancel.onclick = () => { state.taskEdit = null; render(); };
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
  if (v === "habits" && m.habits) {
    document.querySelectorAll("[data-habit]").forEach((b) => {
      b.onclick = () => {
        if (state.habitsEdit) return;
        const h = m.habits[parseInt(b.dataset.habit, 10)];
        if (h) toggleHabit(h.name);
      };
    });
    document.querySelectorAll("[data-del-habit]").forEach((b) => {
      b.onclick = () => {
        if (confirm(`Remove "${b.dataset.delHabit}" from habits? Past log entries are kept.`)) removeHabit(b.dataset.delHabit);
      };
    });
    const editBtn = $("#btn-habits-edit");
    if (editBtn) editBtn.onclick = () => { state.habitsEdit = !state.habitsEdit; render(); };
  }
  if (v === "money") {
    const tt = $("#btn-tracker-toggle");
    if (tt) tt.onclick = () => { state.trackerExpanded = !state.trackerExpanded; render(); };

    /* monk-mode segmented pick — toggle locally, no full re-render (keeps inputs) */
    document.querySelectorAll("[data-monk]").forEach((b) => {
      b.onclick = () => {
        state.reviewMonk = b.dataset.monk;
        document.querySelectorAll("[data-monk]").forEach((x) => x.classList.toggle("active", x === b));
      };
    });
    const againBtn = $("#btn-review-again");
    if (againBtn) againBtn.onclick = () => { state.reviewEdit = true; state.reviewMonk = null; render(); };
    const cancelBtn = $("#btn-review-cancel");
    if (cancelBtn) cancelBtn.onclick = () => { state.reviewEdit = false; state.reviewMonk = null; render(); };
    const saveBtn = $("#btn-review-save");
    if (saveBtn) saveBtn.onclick = () => {
      const valOf = (id) => { const el = $(id); const n = el && el.value.trim() !== "" ? num(el.value) : null; return n; };
      saveReview({
        balance: valOf("#rv-balance"),
        spent: valOf("#rv-spent"),
        disc: valOf("#rv-disc"),
        monk: state.reviewMonk,
        notes: ($("#rv-notes")?.value || "").trim(),
      });
    };

    /* ---- debt editor ---- */
    document.querySelectorAll("[data-debt-edit]").forEach((el) => {
      el.onclick = () => { state.debtEdit = el.dataset.debtEdit; state.debtStatusPick = null; render(); };
    });
    const debtAdd = $("#btn-debt-add");
    if (debtAdd) debtAdd.onclick = () => { state.debtEdit = "__new__"; state.debtStatusPick = null; render(); };
    const debtCancel = $("#btn-debt-cancel");
    if (debtCancel) debtCancel.onclick = () => { state.debtEdit = null; state.debtStatusPick = null; render(); };
    document.querySelectorAll("[data-debt-status]").forEach((b) => {
      b.onclick = () => {
        state.debtStatusPick = b.dataset.debtStatus;
        document.querySelectorAll("[data-debt-status]").forEach((x) => x.classList.toggle("active", x === b));
      };
    });
    const debtSave = $("#btn-debt-save");
    if (debtSave) debtSave.onclick = () => {
      const editing = state.debtEdit !== "__new__";
      const name = ($("#db-name")?.value || "").trim();
      const amount = num($("#db-amount")?.value);
      if (!name) { state.error = "Enter who owes you."; render(); return; }
      if (amount == null) { state.error = "Enter an amount."; render(); return; }
      const ex = editing ? m.debts.find((d) => d.name === state.debtEdit) : null;
      const base = state.debtStatusPick || (ex ? parseDebtStatus(ex.status).base : "Pending");
      const extra = ($("#db-extra")?.value || "").trim();
      upsertDebt({ name, amount, extra, status: buildDebtStatus(base, extra), originalName: editing ? state.debtEdit : null });
    };
    const debtPaid = $("#btn-debt-paid");
    if (debtPaid) debtPaid.onclick = () => {
      const ex = m.debts.find((d) => d.name === state.debtEdit);
      const amount = ex && ex.amount != null ? ex.amount : num($("#db-amount")?.value);
      if (amount == null) { state.error = "Enter an amount before marking paid."; render(); return; }
      upsertDebt({ name: state.debtEdit, amount, status: "✅ Paid", originalName: state.debtEdit });
    };
    const debtRemove = $("#btn-debt-remove");
    if (debtRemove) debtRemove.onclick = () => {
      if (!confirm(`Remove ${state.debtEdit} from the debt tracker? This deletes the summary row (the detail section stays as history).`)) return;
      removeDebt(state.debtEdit);
    };
  }
  if (v === "articles") {
    document.querySelectorAll("[data-article]").forEach((b) => {
      b.onclick = () => { state.article = b.dataset.article; showBars(); render(); scrollTo(0, 0); };
    });
    const goBack = () => { state.article = null; showBars(); render(); scrollTo(0, 0); };
    const back = $("#btn-art-back");
    if (back) back.onclick = goBack;
    const floatBack = $("#btn-art-float-back");
    if (floatBack) floatBack.onclick = goBack;
    const search = $("#art-search");
    if (search) {
      search.oninput = () => {
        state.articleQuery = search.value;
        const pos = search.selectionStart;
        render();
        const again = $("#art-search");
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      };
    }
    const clr = $("#art-search-clear");
    if (clr) clr.onclick = () => { state.articleQuery = ""; render(); const s = $("#art-search"); if (s) s.focus(); };
  }
  if (v === "settings") {
    document.querySelectorAll("[data-theme-pref]").forEach((b) => {
      b.onclick = () => setThemePref(b.dataset.themePref);
    });
    $("#btn-save-token").onclick = () => {
      const t = $("#inp-token").value.trim();
      if (t) { setToken(t); syncAll(); }
    };
    $("#btn-sync-now").onclick = () => syncAll();
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
  /* in an article or the study reader, surface the floating back button once scrolled */
  document.querySelectorAll(".art-float-back").forEach((fb) => fb.classList.toggle("show", y > 220));
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

/* ---------- habit modal ---------- */

function openHabitModal() {
  if (state.busy) return;
  $("#habit-modal").classList.remove("hidden");
  $("#habit-name").focus();
}
function closeHabitModal() {
  $("#habit-modal").classList.add("hidden");
  $("#habit-name").value = "";
}

/* ---------- boot ---------- */

document.querySelectorAll(".tab").forEach((b) => {
  b.querySelector(".ticon").innerHTML = icon(b.dataset.icon);
  b.onclick = () => {
    state.view = b.dataset.view;
    state.article = null;
    state.habitsEdit = false;
    state.taskEdit = null;
    state.studyDoc = false;
    showBars();
    render();
    scrollTo(0, 0);
  };
});
$("#btn-settings").innerHTML = icon("gear", 17);
$("#btn-settings").onclick = () => {
  state.view = "settings";
  state.article = null;
  state.studyDoc = false;
  showBars();
  render();
  scrollTo(0, 0);
};
$("#btn-theme").onclick = () => {
  setThemePref(effectiveTheme() === "light" ? "dark" : "light");
};

$("#fab").innerHTML = icon("plus", 24);
$("#fab").onclick = () => (state.view === "habits" ? openHabitModal() : openComposer());
$("#composer-cancel").onclick = closeComposer;
$("#composer").onclick = (e) => { if (e.target.id === "composer") closeComposer(); };
$("#composer-add").onclick = () => {
  const texts = $("#composer-text").value.split("\n");
  closeComposer();
  addTasks(texts);
};
$("#habit-cancel").onclick = closeHabitModal;
$("#habit-modal").onclick = (e) => { if (e.target.id === "habit-modal") closeHabitModal(); };
$("#habit-add").onclick = () => {
  const name = $("#habit-name").value.trim();
  closeHabitModal();
  if (name) addHabit(name);
};
$("#habit-name").onkeydown = (e) => {
  if (e.key === "Enter") $("#habit-add").click();
  if (e.key === "Escape") closeHabitModal();
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

applyTheme();
loadCache();
render();
if (getToken()) syncAll();
