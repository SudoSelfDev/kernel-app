/* Kernel — personal vault dashboard PWA
   M1: read-only dashboard · M1.5: themes + daily-task write-back
   M1.6: task removal, schedule, articles reader, auto-hiding bars */
"use strict";

/* keep in sync with the CACHE version in sw.js on every release */
const APP_VERSION = "v45";

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
  transport: atob("MjBfTGlmZWxvZy90cmFuc3BvcnQtbG9nLm1k"),
  dailyDir: atob("MjBfTGlmZWxvZy8yMV9EYWlseU5vdGVzLw=="),
  research: atob("MzBfTGlicmFyeS9SZXNlYXJjaA=="),
  masterplan: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL21hc3Rlci1wbGFuLm1k"),
  habits: atob("MjBfTGlmZWxvZy9IYWJpdExvZy5tZA=="),
  indrive: atob("MTBfUHJvamVjdHMvSW5Ecml2ZS9pbmRyaXZlLWluY29tZS5tZA=="),
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
  debtEdit: null,     // person name being edited, "__new__" for the add form, or null
  debtStatusPick: null, // pending status base in the debt form (Pending/Expected/Partial/Paid)
  taskEdit: null,     // absolute line index of the task being edited inline, or null
  studyDoc: false,    // when true, the cloud study plan opens in the in-app reader
  articleReturn: null, // view to return to when leaving an article (e.g. opened from a task)
  transportWeek: null, // 7-day strip on the transport card: null = auto, true/false = user choice
  indriveForm: false, // "Add entry" form on the inDrive tab expanded
  indriveEditDate: null, // date (YYYY-MM-DD) of the row being edited in the form, or null for a new entry
  habitPop: null, // name of the habit whose checkbox should play the pop-in animation on this render, or null
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

/* habits ring geometry — shared between renderHabits (draws it) and the
   click handler (animates it), so the two never drift apart */
const HABIT_RING_R = 34;
const HABIT_RING_C = 2 * Math.PI * HABIT_RING_R;
const habitRingOffset = (done, total) => (total ? HABIT_RING_C * (1 - done / total) : HABIT_RING_C);

/* ---------- page + tap animations ---------- */

/* left-to-right order of the tab bar — lets a view swap pick a slide
   direction, like flipping through pages rather than just cutting */
const TAB_ORDER = ["today", "habits", "money", "articles", "indrive"];
let _lastViewKey = null;

/* #view's whole innerHTML is replaced on every render (no virtual-DOM diff),
   so a plain CSS transition has nothing to interpolate from — same reason
   the habit ring/checkbox needed the Web Animations API instead of CSS.
   Called once per actual page change (render() tracks _lastViewKey so this
   is a no-op on routine re-renders like ticking a task). */
function animateViewChange(fromKey, toKey) {
  const el = $("#view");
  if (!el || fromKey === null || fromKey === toKey) return;
  const inTabs = (k) => TAB_ORDER.includes(k);
  const EASE = "cubic-bezier(.22,1,.36,1)";
  let frames;
  if (inTabs(fromKey) && inTabs(toKey)) {
    /* tab-to-tab: slide in from whichever side that tab lives on */
    const dir = TAB_ORDER.indexOf(toKey) > TAB_ORDER.indexOf(fromKey) ? 1 : -1;
    frames = [
      { opacity: 0, transform: `translate3d(${dir * 26}px, 0, 0) scale(0.98)` },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
    ];
  } else if (inTabs(fromKey) && !inTabs(toKey)) {
    /* drilling into a subview (article, study doc, settings) — rises in */
    frames = [
      { opacity: 0, transform: "translate3d(0, 18px, 0) scale(0.97)" },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
    ];
  } else if (!inTabs(fromKey) && inTabs(toKey)) {
    /* backing out of a subview to a tab — settles back down */
    frames = [{ opacity: 0, transform: "scale(1.02)" }, { opacity: 1, transform: "scale(1)" }];
  } else {
    frames = [{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "scale(1)" }];
  }
  el.animate(frames, { duration: 320, easing: EASE });
}

/* a satisfying squash-and-bounce tap, used on the tab bar + logo */
function bounceIcon(el) {
  if (!el) return;
  el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.72)" },
      { transform: "scale(1.18)" },
      { transform: "scale(0.94)" },
      { transform: "scale(1)" },
    ],
    { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" },
  );
}

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

/* inDrive's real mark — a rounded square in their brand green ("Inch Worm",
   #A7E92F) with an "i" merging into a "D", per their brand guide. Filled/
   colored rather than a stroke=currentColor outline like the rest of the
   set, so it reads as the actual inDrive icon rather than another line glyph. */
const INDRIVE_ICON =
  '<rect x="1" y="1" width="22" height="22" rx="6.5" fill="#A7E92F"/>' +
  '<circle cx="8" cy="6.2" r="1.5" fill="#12210a"/>' +
  '<path d="M8 9.5V18" stroke="#12210a" stroke-width="2.3" stroke-linecap="round"/>' +
  '<path d="M8 9.5c7 0 9.5 2 9.5 4.5S15 18 8 18" fill="none" stroke="#12210a" stroke-width="2.3" stroke-linecap="round"/>';

const icon = (name, size = 20) => {
  if (name === "indrive") return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${INDRIVE_ICON}</svg>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
};

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
    const [clients, savings, debts, study, studyplan, daily, researchDir, masterplan, habits, transport, indrive] = await Promise.all([
      fetchRaw(PATHS.clients),
      fetchRaw(PATHS.savings),
      fetchRaw(PATHS.debts),
      fetchRaw(PATHS.study, { optional: true }),
      fetchRaw(PATHS.studyplan, { optional: true }),
      fetchWithSha(todayNotePath(), { optional: true }),
      fetchDir(PATHS.research, { optional: true }),
      fetchRaw(PATHS.masterplan, { optional: true }),
      fetchWithSha(PATHS.habits, { optional: true }),
      fetchRaw(PATHS.transport, { optional: true }),
      fetchRaw(PATHS.indrive, { optional: true }),
    ]);
    let articles = [];
    if (Array.isArray(researchDir)) {
      const mds = researchDir.filter((f) => f.type === "file" && f.name.endsWith(".md"));
      const texts = await Promise.all(mds.map((f) => fetchRaw(`${PATHS.research}/${f.name}`)));
      articles = mds.map((f, i) => ({ name: f.name, text: texts[i] }));
    }
    state.files = { clients, savings, debts, study, studyplan, daily, articles, masterplan, habits, transport, indrive };
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

/* Save a balance update: append a dated Balance Log entry, then (optionally)
   update Current savings, Remaining to goal, and the current month's tracker row */
function saveBalance(v) {
  if (state.busy) return;
  const lines = savingsText().split("\n");
  const s = buildModel().savings;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  /* 1) Balance Log entry (newest first) */
  const entry = [
    `### ${dateStr}`,
    `- Balance: ${v.balance != null ? fmtNum(v.balance) + " MAD" : "—"}`,
    `- Notes: ${v.notes || "—"}`,
    "",
  ];
  let logIdx = lines.findIndex((l) => /^##\s+balance log/i.test(l.trim()));
  if (logIdx === -1) {
    lines.push("", "## Balance Log", "");
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
        const cells = lines[curIdx].split("|"); // ["", " Jun 2026 ", salary, exp, saved, total, rate, ""]
        const salary = num(cells[2]);
        cells[1] = ` ${mShort} ${yr} `;
        cells[4] = ` ${fmtNum(saved)} `;
        cells[5] = ` ${fmtNum(v.balance)} `;
        cells[6] = ` ${salary ? Math.round((saved / salary) * 100) + "%" : "—"} `;
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
    study: null, tasks: null, articles: [], review: null, transport: null, indrive: null,
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

    m.savings = {
      target: num(kv["Target"]) || 50000,
      current: num(kv["Current savings"]),
      currentRaw: kv["Current savings"] || "",
      planStart: num(kv["Plan start"]),
      deadline: kv["Deadline"] || "",
      remaining: num(kv["Remaining to goal"]),
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

    /* Balance Log — parse "### <date>" entries with their `- Key: value` fields */
    const logBody = section(fSavings, "## Balance Log");
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
    const thisMonth = entries.find((e) =>
      !isNaN(e.date) && e.date.getMonth() === now.getMonth() && e.date.getFullYear() === now.getFullYear());
    m.review = { entries, thisMonth };
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

  if (f.transport) {
    const t = f.transport;
    const cutoff = ((t.match(/^\*\*Cutoff:\*\*\s*(.+)$/m) || [])[1] || "13:00").trim();
    const site = ((t.match(/^\*\*Booking site:\*\*\s*(.+)$/m) || [])[1] || "https://www.movehkm.com").trim();
    const log = {};
    parseTable(section(t, "## Log")).forEach((r) => {
      const vals = Object.values(r);
      if (vals[0]) log[vals[0].trim()] = (vals[1] || "").trim();
    });
    m.transport = { cutoff, site, log };
  }

  if (f.indrive) {
    const t = f.indrive;
    const price = num(((t.match(/^\*\*Diesel price \(MAD\/L\):\*\*\s*(.+)$/m) || [])[1] || "15").trim());
    const consumption = num(((t.match(/^\*\*Consumption \(L\/100km\):\*\*\s*(.+)$/m) || [])[1] || "6.5").trim());
    const rows = parseTable(section(t, "## Log")).map((r) => {
      const vals = Object.values(r);
      return {
        date: (vals[0] || "").trim(),
        km: num(vals[1]) || 0,
        gross: num(vals[2]) || 0,
        diesel: num(vals[3]) || 0,
        net: num(vals[4]) || 0,
        notes: (vals[5] || "").trim(),
      };
    }).filter((r) => r.date);
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const totalNet = rows.reduce((s, r) => s + r.net, 0);
    const totalGross = rows.reduce((s, r) => s + r.gross, 0);
    const totalKm = rows.reduce((s, r) => s + r.km, 0);
    m.indrive = { price, consumption, rows, totalNet, totalGross, totalKm };
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
      const history = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        history.push(!!(byDate[iso(d)] && (byDate[iso(d)][name] || "").includes("✅")));
      }
      const doneToday = history[13];
      /* streak counts back from today, or from yesterday if today isn't ticked yet */
      let streak = 0;
      for (let i = doneToday ? 0 : 1; ; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if (byDate[iso(d)] && (byDate[iso(d)][name] || "").includes("✅")) streak++;
        else break;
      }
      return { name, doneToday, streak, history };
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

/* match a [[wikilink]] target to a research article: by filename slug or title */
function resolveArticle(target, articles) {
  const t = target.trim().toLowerCase().replace(/\.md$/, "");
  const slug = (a) => a.name.replace(/\.md$/, "").toLowerCase();
  return articles.find((a) => slug(a) === t)
      || articles.find((a) => (a.title || "").toLowerCase() === t)
      || articles.find((a) => slug(a) === t.replace(/\s+/g, "-"));
}

/* render task text, turning [[wikilinks]] into tappable article links (or muted text) */
function linkifyTaskText(text, articles) {
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let out = "", last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    const label = (m[2] || m[1]).trim();
    const art = resolveArticle(m[1], articles);
    out += art
      ? `<span class="task-link" data-article-link="${esc(art.name)}">${esc(label)} ${icon("book", 12)}</span>`
      : `<span class="wikilink">${esc(label)}</span>`;
    last = re.lastIndex;
  }
  out += esc(text.slice(last));
  return out;
}

/* open a research article in the reader, remembering where to return on Back */
function openArticle(name, from) {
  state.view = "articles";
  state.article = name;
  state.articleReturn = from || null;
  showBars();
  render();
  scrollTo(0, 0);
}

/* ---------- office transport (book-tomorrow tracker) ---------- */

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Which day must a ride for `d` be booked on? Sat/Sun/Mon all go on the
   preceding Friday (after that the option disappears); everything else D-1. */
function bookingDayFor(d) {
  const wd = d.getDay();                                  // Sun=0 … Sat=6
  const delta = wd === 6 ? 1 : wd === 0 ? 2 : wd === 1 ? 3 : 1;
  const b = new Date(d); b.setDate(b.getDate() - delta);
  return b;
}

const statusOf = (logged) =>
  /booked|✅/i.test(logged) ? "booked"
  : /off|🚫/i.test(logged) ? "off"
  : /missed|⚠/i.test(logged) ? "missed"
  : "pending";

/* Everything the transport card needs. This log is the ONLY source — no
   calendar. Any day you haven't marked counts as still needing a booking. */
function transportPlan(m) {
  if (!m.transport) return null;
  const t = m.transport;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [ch, cm] = (t.cutoff || "13:00").split(":").map((n) => parseInt(n, 10));
  const pastCutoff = now.getHours() * 60 + now.getMinutes() >= (ch || 13) * 60 + (cm || 0);

  const dayInfo = (d) => ({
    date: isoOf(d),
    status: statusOf(t.log[isoOf(d)] || ""),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }),
    dd: d.getDate(),
    nice: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    short: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  });

  /* bookable today = every upcoming day whose booking day is today */
  const targets = [];
  for (let i = 1; i <= 4; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (isoOf(bookingDayFor(d)) !== isoOf(today)) continue;
    targets.push(dayInfo(d));
  }

  /* the site allows booking 7 days ahead — the strip mirrors that window */
  const week = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const info = dayInfo(d);
    const bookOn = bookingDayFor(d);
    info.bookToday = isoOf(bookOn) === isoOf(today);
    info.windowGone = bookOn < today || (info.bookToday && pastCutoff);
    week.push(info);
  }

  return {
    targets, week, pastCutoff,
    site: t.site, cutoff: t.cutoff || "13:00",
    pending: targets.filter((x) => x.status === "pending" || x.status === "missed"),
    unmarkedWeek: week.filter((d) => d.status === "pending"),
  };
}

let _transportTimer = null;
const transportText = () => state.files.transport || "";

function applyTransportChange(newText) {
  state.files.transport = newText;
  render();
  if (_transportTimer) clearTimeout(_transportTimer);
  _transportTimer = setTimeout(flushTransport, SAVE_DELAY);
}

async function flushTransport() {
  _transportTimer = null;
  const text = transportText();
  if (!text) return;
  state.busy = true;
  render();
  try {
    const serverText = await fetchRaw(PATHS.transport);
    const baseSha = await gitBlobSha(serverText);
    await putFile(PATHS.transport, text, "kernel-app: update transport log", baseSha);
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") state.error = "Write rejected — your token needs Contents: Read and write.";
    else if (e.message === "conflict") { state.error = "Transport log changed on GitHub — refreshing."; state.busy = false; await syncAll(); return; }
    else state.error = "Couldn't save — check your connection and try again.";
  }
  state.busy = false;
  render();
}

/* upsert (or clear, when status is null) one or more date rows in the ## Log
   table — several dates in one pass so a whole Friday batch is a single commit */
function setTransport(dates, status) {
  const list = Array.isArray(dates) ? dates : [dates];
  if (!list.length) return;
  const lines = transportText().split("\n");
  // find the Log table region
  const h = lines.findIndex((l) => /^##\s+log/i.test(l.trim()));
  if (h === -1) return;
  let start = -1, end = -1;
  for (let i = h + 1; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (tr.startsWith("|")) { if (start === -1) start = i; end = i; }
    else if (start !== -1) break;
    else if (/^#+\s/.test(tr)) break;
  }
  if (start === -1) return;

  list.forEach((date) => {
    let rowIdx = -1;
    for (let i = start + 2; i <= end; i++) {
      if ((lines[i].split("|")[1] || "").trim() === date) { rowIdx = i; break; }
    }
    if (status === null) {
      if (rowIdx !== -1) { lines.splice(rowIdx, 1); end--; }
    } else {
      const rowStr = `| ${date} | ${status} |`;
      if (rowIdx !== -1) lines[rowIdx] = rowStr;
      else { lines.splice(end + 1, 0, rowStr); end++; }
    }
  });
  applyTransportChange(lines.join("\n"));
}

/* ---------- inDrive income log ---------- */

let _indriveTimer = null;
const indriveText = () => state.files.indrive || "";

function applyIndriveChange(newText) {
  state.files.indrive = newText;
  render();
  if (_indriveTimer) clearTimeout(_indriveTimer);
  _indriveTimer = setTimeout(flushIndrive, SAVE_DELAY);
}

async function flushIndrive() {
  _indriveTimer = null;
  const text = indriveText();
  if (!text) return;
  state.busy = true;
  render();
  try {
    const serverText = await fetchRaw(PATHS.indrive);
    const baseSha = await gitBlobSha(serverText);
    await putFile(PATHS.indrive, text, "kernel-app: update inDrive log", baseSha);
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") state.error = "Write rejected — your token needs Contents: Read and write.";
    else if (e.message === "conflict") { state.error = "inDrive log changed on GitHub — refreshing."; state.busy = false; await syncAll(); return; }
    else state.error = "Couldn't save — check your connection and try again.";
  }
  state.busy = false;
  render();
}

/* upsert one day's row (one entry per date — re-adding the same date overwrites it) */
function setIndriveEntry(date, km, gross, notes) {
  const m = buildModel();
  const price = m.indrive ? m.indrive.price : 15;
  const consumption = m.indrive ? m.indrive.consumption : 6.5;
  const diesel = Math.round((km / 100) * consumption * price * 100) / 100;
  const net = Math.round((gross - diesel) * 100) / 100;

  const lines = indriveText().split("\n");
  const h = lines.findIndex((l) => /^##\s+log/i.test(l.trim()));
  if (h === -1) return;
  let start = -1, end = -1;
  for (let i = h + 1; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (tr.startsWith("|")) { if (start === -1) start = i; end = i; }
    else if (start !== -1) break;
    else if (/^#+\s/.test(tr)) break;
  }
  if (start === -1) return;

  const rowStr = `| ${date} | ${km} | ${gross} | ${diesel} | ${net} | ${notes || ""} |`;
  let rowIdx = -1;
  for (let i = start + 2; i <= end; i++) {
    if ((lines[i].split("|")[1] || "").trim() === date) { rowIdx = i; break; }
  }
  if (rowIdx !== -1) lines[rowIdx] = rowStr;
  else lines.splice(end + 1, 0, rowStr);
  applyIndriveChange(lines.join("\n"));
}

function removeIndriveEntry(date) {
  const lines = indriveText().split("\n");
  const h = lines.findIndex((l) => /^##\s+log/i.test(l.trim()));
  if (h === -1) return;
  let start = -1, end = -1;
  for (let i = h + 1; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (tr.startsWith("|")) { if (start === -1) start = i; end = i; }
    else if (start !== -1) break;
    else if (/^#+\s/.test(tr)) break;
  }
  if (start === -1) return;
  for (let i = start + 2; i <= end; i++) {
    if ((lines[i].split("|")[1] || "").trim() === date) { lines.splice(i, 1); break; }
  }
  applyIndriveChange(lines.join("\n"));
}

function renderToday(m) {
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const dis = state.busy ? "disabled" : "";

  const open = m.tasks ? m.tasks.filter((t) => !t.done).length : 0;
  const heroSub = m.tasks === null ? "No daily note yet"
    : open === 0 ? "All tasks done" : `${open} task${open === 1 ? "" : "s"} remaining`;

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
                <span class="txt">${linkifyTaskText(t.text, m.articles)}</span>
              </button>
              <button class="task-icon-btn" data-edit-line="${t.line}" title="Edit task" aria-label="Edit task" ${dis}>${icon("pencil", 15)}</button>
              <button class="task-icon-btn del" data-del-line="${t.line}" title="Remove task" aria-label="Remove task" ${dis}>${icon("x", 15)}</button>
            </div>`).join("")}`;

  /* ---- office transport (log-driven booking window, no calendar) ---- */
  const tp = transportPlan(m);
  let transportCard = "";
  const trDis = state.busy ? "disabled" : "";
  if (tp) {
    const pending = tp.pending;                            // due today, still unmarked
    const actioned = tp.targets.filter((x) => x.status === "booked" || x.status === "off");
    const multi = tp.targets.length > 1;                   // the Friday Sat+Sun+Mon window
    const label = (d) => `${esc(d.short)}${d.status === "missed" ? " · ⚠️ marked missed" : ""}`;

    let head, body = "";
    if (pending.length) {
      const late = tp.pastCutoff;
      head = `<h2>🚌 Office transport ${late
        ? `<span class="chip bad">cutoff passed</span>`
        : `<span class="chip warn">by ${esc(tp.cutoff)}</span>`}</h2>`;
      body = `
        <p class="muted review-note">${late
          ? `The ${esc(tp.cutoff)} window has passed. If you still got ${multi ? "them" : "it"} booked, mark ${multi ? "them" : "it"} below.`
          : multi
            ? `Friday window — <b>${pending.length} rides</b> must be booked today before <b>${esc(tp.cutoff)}</b>.`
            : `Book your ride for <b>${esc(pending[0].nice)}</b> before <b>${esc(tp.cutoff)}</b>.`}</p>
        ${pending.map((d) => `
          <div class="row tr-target">
            <div class="r-main">
              <div class="r-title">${label(d)}</div>
              <div class="r-sub">not marked yet — reminders keep coming</div>
            </div>
            <div class="r-end">
              <button class="btn secondary tr-mini" data-tr-book="${esc(d.date)}" ${trDis}>Booked ✓</button>
            </div>
          </div>`).join("")}
        <a class="btn" id="btn-tr-open" href="${esc(tp.site)}" target="_blank" rel="noopener">Open booking site ↗</a>
        ${pending.length > 1
          ? `<div style="height:8px"></div><button class="btn secondary" id="btn-tr-book-all" ${trDis}>Mark all ${pending.length} booked ✓</button>`
          : ""}
        <button class="show-toggle" id="btn-tr-off-all">${pending.length > 1 ? "No rides needed — days off" : "It's a day off — no ride"}</button>`;
    } else if (tp.targets.length) {
      const allBooked = actioned.every((x) => x.status === "booked");
      head = `<h2>🚌 Office transport ${allBooked
        ? `<span class="chip ok">booked ✓</span>`
        : `<span class="chip dim">marked</span>`}</h2>`;
      body = `<p class="muted review-note">${actioned.map((d) =>
        `${esc(d.short)} — ${d.status === "off" ? "day off" : "booked"}`).join("<br>")}</p>
        <button class="show-toggle" id="btn-tr-undo-all" ${trDis}>Undo</button>`;
    } else {
      head = `<h2>🚌 Office transport <span class="chip dim">nothing due today</span></h2>`;
      body = `<p class="muted review-note">Nothing has to be booked today${tp.unmarkedWeek.length
        ? ` — but ${tp.unmarkedWeek.length} day${tp.unmarkedWeek.length > 1 ? "s" : ""} ahead ${tp.unmarkedWeek.length > 1 ? "are" : "is"} still unmarked. Mark ${tp.unmarkedWeek.length > 1 ? "them" : "it"} below to silence the reminders.`
        : ". The whole week ahead is marked."}</p>`;
    }

    /* the 7-day strip mirrors how far ahead the site lets you book —
       tap a day to cycle booked → off → clear */
    const openAhead = state.transportWeek === null
      ? (!tp.targets.length && tp.unmarkedWeek.length > 0)   // nothing due today but days ahead unmarked → open it for them
      : state.transportWeek;
    const strip = `
      <button class="show-toggle" id="btn-tr-week">${openAhead ? "Hide the next 7 days" : `Mark days ahead${tp.unmarkedWeek.length ? ` (${tp.unmarkedWeek.length} unmarked)` : ""}`}</button>
      ${openAhead ? `
      <div class="tr-week">
        ${tp.week.map((d) => {
          const cls = d.status === "booked" ? "ok" : d.status === "off" ? "dim"
            : d.status === "missed" || d.windowGone ? "bad" : "warn";
          const mark = d.status === "booked" ? "✅" : d.status === "off" ? "🚫"
            : d.status === "missed" ? "⚠️" : "•";
          return `<button class="tr-day" data-tr-cycle="${esc(d.date)}" ${trDis}>
            <span class="trd-dow">${esc(d.dow)}</span>
            <span class="trd-mark chip ${cls}">${mark}</span>
            <span class="trd-num">${d.dd}</span>
          </button>`;
        }).join("")}
      </div>
      <p class="muted" style="font-size:0.7rem;padding:2px 4px 0">Tap a day to cycle booked → off → clear. Anything left unmarked keeps nudging you on its booking day.</p>` : ""}`;

    transportCard = `<div class="card transport ${pending.length ? (tp.pastCutoff ? "tr-late" : "tr-due") : "tr-ok"}">
      ${head}${body}${strip}
    </div>`;
  }

  return `
  <div class="hero">
    <div class="hero-date">${esc(dateStr)}</div>
    <div class="hero-sub">${esc(heroSub)}${state.busy ? " · saving…" : ""}</div>
  </div>

  ${transportCard}

  <div class="card">
    <h2>Tasks</h2>
    ${tasksHtml}
  </div>

  <div class="duo">
    ${m.study ? `
    <button class="card duo-tile" id="btn-study-open" title="Open the study plan">
      <h2>Cloud study ${icon("chevronRight", 13)}</h2>
      <div class="duo-val">${m.study.done}/${m.study.total}</div>
      <div class="duo-sub">${esc(m.study.title)} · ${m.study.total ? Math.round((m.study.done / m.study.total) * 100) : 0}%</div>
    </button>` : ""}
    <button class="card duo-tile" id="btn-indrive-open" title="Open inDrive">
      <h2>inDrive net ${icon("chevronRight", 13)}</h2>
      <div class="duo-val ${m.indrive && m.indrive.totalNet > 0 ? "t-indrive" : ""}">${m.indrive ? Math.round(m.indrive.totalNet).toLocaleString() : "—"}</div>
      <div class="duo-sub">${m.indrive && m.indrive.rows.length ? `${m.indrive.rows.length} day${m.indrive.rows.length === 1 ? "" : "s"} logged · MAD` : "no entries yet"}</div>
    </button>
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

function renderIndrive(m) {
  const dis = state.busy ? "disabled" : "";
  const d = m.indrive || { price: 15, consumption: 6.5, rows: [], totalNet: 0, totalGross: 0, totalKm: 0 };

  const totalsCard = `
    <div class="card">
      <h2>🚗 inDrive <span class="chip ok">${d.totalNet.toLocaleString()} MAD net</span></h2>
      <p class="muted review-note">${d.rows.length} day${d.rows.length === 1 ? "" : "s"} logged · ${d.totalKm.toLocaleString()} km · ${d.totalGross.toLocaleString()} MAD gross so far</p>
    </div>`;

  let formCard;
  if (state.indriveForm) {
    const editing = !!state.indriveEditDate;
    const ex = editing ? d.rows.find((r) => r.date === state.indriveEditDate) : null;
    formCard = `
      <div class="card">
        <label class="rv-label">Date</label>
        <input type="date" id="id-date" value="${esc(ex ? ex.date : todayIso())}" ${editing ? "readonly" : ""}>
        <label class="rv-label">Km driven</label>
        <input type="number" inputmode="decimal" id="id-km" placeholder="0" value="${ex ? ex.km : ""}">
        <label class="rv-label">Gross earned (MAD)</label>
        <input type="number" inputmode="decimal" id="id-gross" placeholder="0" value="${ex ? ex.gross : ""}">
        <label class="rv-label">Notes <span class="muted">· optional</span></label>
        <input type="text" id="id-notes" placeholder="" value="${ex ? esc(ex.notes) : ""}">
        <p class="muted" style="font-size:0.72rem;margin-top:4px">Diesel is calculated for you at ${d.consumption} L/100km × ${d.price} MAD/L.</p>
        <div style="height:12px"></div>
        <button class="btn" id="btn-indrive-save" ${dis}>${editing ? "Save changes" : "Add entry"}</button>
        ${editing ? `<button class="show-toggle danger" id="btn-indrive-remove" ${dis}>Remove entry</button>` : ""}
        <button class="show-toggle" id="btn-indrive-cancel">Cancel</button>
      </div>`;
  } else {
    formCard = `<button class="show-toggle" id="btn-indrive-add">+ Add entry</button>`;
  }

  const logCard = `
    <div class="card">
      <h2>Log</h2>
      ${d.rows.length ? d.rows.map((r) => `
        <div class="row" data-indrive-edit="${esc(r.date)}">
          <div class="r-main">
            <div class="r-title">${esc(r.date)}</div>
            <div class="r-sub">${r.km} km · ${r.gross} gross − ${r.diesel} diesel${r.notes ? " · " + esc(r.notes) : ""}</div>
          </div>
          <div class="r-end"><b>${r.net.toLocaleString()}</b> <span class="muted">MAD</span></div>
        </div>`).join("") : `<div class="empty">Nothing logged yet — tap + Add entry</div>`}
    </div>`;

  return totalsCard + formCard + logCard;
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

function renderMoney(m) {
  const s = m.savings;
  const pct = s.current && s.target ? Math.min(100, (s.current / s.target) * 100) : 0;
  const nowM = new Date().toLocaleDateString("en-US", { month: "short" });
  const nowY = String(new Date().getFullYear());
  const remaining = s.remaining !== null && s.remaining !== undefined
    ? s.remaining
    : Math.max(0, (s.target || 0) - (s.current || 0));

  /* milestone markers on the goal bar — ~35% / ~70% / 100% of the target, rounded */
  const target = s.target || 70000;
  const round5k = (n) => Math.round(n / 5000) * 5000;
  const milestones = [...new Set([round5k(target * 0.35), round5k(target * 0.7), target])].filter((v) => v > 0);
  const markers = milestones.map((v) => {
    const left = Math.min(100, (v / target) * 100);
    const hit = (s.current || 0) >= v;
    return `<span class="ms-mark ${hit ? "hit" : ""}" style="left:${left}%" title="${v.toLocaleString()} MAD"></span>`;
  }).join("");

  /* ---- this month ---- */
  const salaryDays = daysUntilSalary(s.salaryDay || 28);
  const rateChip = s.rate === null || s.rate === undefined ? ""
    : `<span class="chip ${s.rate >= 50 ? "ok" : s.rate >= 30 ? "warn" : "bad"}">${s.rate.toFixed(0)}%</span>`;
  const monthCard = `
  <div class="card">
    <h2>This Month <span class="h-extra muted">${nowM} ${nowY}</span></h2>
    <div class="month-grid">
      <div class="mg-cell">
        <div class="mg-val">${salaryDays === 0 ? "Today" : `${salaryDays}d`}</div>
        <div class="mg-lbl">next salary (${s.salaryDay || 28}th)</div>
      </div>
    </div>
    ${s.monthSaved > 0
      ? `<div class="month-saved">
           <div class="ms-row"><span>Saved this month</span><b>${s.monthSaved.toLocaleString()} MAD</b></div>
           ${rateChip ? `<div class="ms-row"><span>Savings rate</span>${rateChip}</div>` : ""}
         </div>`
      : `<div class="bar-sub" style="margin-top:10px"><span>Not logged yet this month</span></div>`}
  </div>`;

  /* ---- balance update (form + latest entry) ---- */
  let balanceCard = "";
  if (m.review) {
    const r = m.review;
    const done = r.thisMonth && !state.reviewEdit;
    const dis = state.busy ? "disabled" : "";

    if (done) {
      const f = r.thisMonth.fields;
      balanceCard = `
      <div class="card">
        <h2>Balance <span class="chip ok">logged ✓</span></h2>
        <p class="muted review-note">Last updated ${esc(r.thisMonth.dateRaw)}.</p>
        <div class="month-saved">
          ${f.balance ? `<div class="ms-row"><span>Balance</span><b>${esc(f.balance)}</b></div>` : ""}
          ${f.notes && f.notes !== "—" ? `<div class="ms-row"><span>Notes</span><span>${esc(f.notes)}</span></div>` : ""}
        </div>
        <button class="show-toggle" id="btn-review-again" ${dis}>Update again</button>
      </div>`;
    } else {
      balanceCard = `
      <div class="card">
        <h2>Update Balance</h2>
        <p class="muted review-note">Log your current savings balance — updates the goal + tracker.</p>
        <label class="rv-label">Savings account balance (MAD)</label>
        <input type="number" inputmode="decimal" id="rv-balance" placeholder="${s.current ? fmtNum(s.current) : "0"}" value="">
        <label class="rv-label">Notes <span class="muted">· optional</span></label>
        <input type="text" id="rv-notes" placeholder="Anything worth remembering…">
        <div style="height:12px"></div>
        <button class="btn" id="btn-review-save" ${dis}>Save balance</button>
        ${r.thisMonth ? `<button class="show-toggle" id="btn-review-cancel">Cancel</button>` : ""}
      </div>`;
    }
  }

  /* ---- monthly tracker (compact, future months behind a toggle) ---- */
  const trackerRows = (s.tracker || []).map((r) => {
    const vals = Object.values(r).map((v) => v.replace(/\*/g, ""));
    const month = vals[0] || "";
    const saved = num(vals[3]);
    const total = num(vals[4]);
    const isCurrent = month.includes(nowM) && month.includes(nowY);
    const isActual = saved !== null;
    const isProj = !isActual && !isCurrent;
    const barPct = total !== null ? Math.min(100, Math.round((total / target) * 100)) : 0;
    const pill = isCurrent && !isActual
      ? `<span class="tr-now">now</span>`
      : isActual
        ? `<span class="muted pill-xs">${total !== null ? Math.round((total / target) * 100) + "%" : ""}</span>`
        : `<span class="muted pill-xs">—</span>`;
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
      ? `<button class="show-toggle" id="btn-tracker-toggle">${state.trackerExpanded ? "Show less" : `+ ${proj.length} more month${proj.length === 1 ? "" : "s"}`}</button>`
      : "";
    return `<div class="card">
      <h2>Monthly Tracker</h2>
      ${visible.map((r) => r.html).join("")}
      ${state.trackerExpanded ? proj.map((r) => r.html).join("") : ""}
      ${toggleBtn}
    </div>`;
  })() : "";

  /* ---- debts owed to Mehdi — add / edit / mark-paid / remove ---- */
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
    <h2>Debts Owed to You ${m.debtTotal ? `<span class="h-extra">${m.debtTotal.toLocaleString()} MAD</span>` : ""}</h2>
    <p class="muted review-note">Not spending money — counts toward the goal when repaid.${m.debtTotal && remaining ? ` Covers ${Math.min(100, Math.round((m.debtTotal / remaining) * 100))}% of the gap to ${target.toLocaleString()}.` : ""}</p>
    ${debtBody}
  </div>`;

  return `
  <div class="card goal-card">
    <div class="goal-head">
      <span class="goal-tag">🎯 GOAL</span>
      <span class="goal-sub">${s.paymentsLeft ? `${s.paymentsLeft} salaries left` : ""}${s.deadline ? ` · ${esc(s.deadline.split("(")[0].trim())}` : ""}</span>
    </div>
    <div class="big-number">${s.current ? s.current.toLocaleString() : "—"} <small>/ ${s.target ? s.target.toLocaleString() : "—"} MAD</small></div>
    <div class="bar ms-bar"><div style="width:${pct}%"></div>${markers}</div>
    <div class="bar-sub"><span>${pct.toFixed(1)}%</span><span>${remaining > 0 ? `${remaining.toLocaleString()} MAD to go` : "goal reached ✓"}</span></div>
  </div>

  ${monthCard}
  ${balanceCard}
  ${trackerCard}
  ${debtCard}`;
}

function renderHabits(m) {
  if (!m.habits) {
    return `<div class="card"><div class="empty">No habit log synced yet — pull to refresh, or check that HabitLog.md exists in the vault</div></div>`;
  }
  const total = m.habits.length;
  const done = m.habits.filter((h) => h.doneToday).length;
  const dis = state.busy ? "disabled" : "";
  const editing = state.habitsEdit;

  const ringOffset = habitRingOffset(done, total);
  const ringMsg = !total ? "" : done === total ? "All done — closed the ring 🎯"
    : `${total - done} more to close the ring`;

  const ringCard = total ? `
  <div class="card ring-card">
    <div class="ring-wrap">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle class="ring-track" cx="42" cy="42" r="${HABIT_RING_R}"/>
        <circle class="ring-fill" cx="42" cy="42" r="${HABIT_RING_R}" stroke-dasharray="${HABIT_RING_C}" stroke-dashoffset="${ringOffset}"/>
      </svg>
      <div class="ring-label"><div class="ring-num">${done}</div><div class="ring-den">of ${total}</div></div>
    </div>
    <div class="ring-text">
      <h2>Today's habits</h2>
      <p>${ringMsg}</p>
    </div>
  </div>` : "";

  const habitRows = m.habits.map((h, i) => {
    const pop = state.habitPop === h.name && h.doneToday;
    return `
    <div class="habit-wrap${editing ? " editing" : ""}">
      ${editing ? `<button class="habit-del" data-del-habit="${esc(h.name)}" aria-label="Remove ${esc(h.name)}">${icon("x", 15)}</button>` : ""}
      <button class="hcard ${h.doneToday ? "done" : ""}" data-habit="${i}" ${dis}>
        <span class="hbox${pop ? " pop" : ""}">${h.doneToday ? "✓" : "—"}</span>
        <span class="hinfo">
          <span class="hname">${esc(h.name)}</span>
          <span class="hstreak ${h.streak > 0 ? "hot" : ""}">${h.streak > 0 ? `${h.streak}🔥 day streak` : "no streak yet"}</span>
        </span>
        <span class="heatmap">${h.history.map((d, j) =>
          `<span class="hm-cell ${d ? "on" : ""} ${j === 13 ? "today" : ""}${pop && j === 13 ? " pop" : ""}"></span>`).join("")}</span>
      </button>
    </div>`;
  }).join("");

  return `
  ${ringCard}
  <div class="card">
    <h2>
      <span>Habits <span class="h-extra muted">14-day history${state.busy ? " · saving…" : ""}</span></span>
      ${total > 0 ? `<button class="text-btn" id="btn-habits-edit">${editing ? "Done" : "Edit"}</button>` : ""}
    </h2>
    ${total === 0 ? `<div class="empty">No habits yet — tap + to add one</div>` : ""}
    ${habitRows}
  </div>`;
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
    <p class="muted" style="font-size:0.8rem;line-height:1.5">Kernel — dashboard over a private vault repo. Data is fetched straight from GitHub on this device and cached locally. Task edits are committed back to the vault as you. Nothing is sent anywhere else.</p>
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
    : v === "indrive" ? renderIndrive(m)
    : v === "money" ? renderMoney(m)
    : v === "articles" ? renderArticles(m)
    : v === "habits" ? renderHabits(m)
    : renderSettings();
  $("#view").innerHTML = html;
  $("#view").dataset.tab = state.studyDoc ? "study" : v;

  const viewKey = state.studyDoc ? "study" : state.article ? `article:${state.article}` : v;
  animateViewChange(_lastViewKey, viewKey);
  _lastViewKey = viewKey;

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
      b.onclick = (e) => {
        const link = e.target.closest("[data-article-link]");
        if (link) { openArticle(link.dataset.articleLink, "today"); return; }
        toggleTask(parseInt(b.dataset.line, 10));
      };
    });
    document.querySelectorAll("[data-del-line]").forEach((b) => {
      b.onclick = () => removeTask(parseInt(b.dataset.delLine, 10));
    });
    document.querySelectorAll("[data-edit-line]").forEach((b) => {
      b.onclick = () => { state.taskEdit = parseInt(b.dataset.editLine, 10); render(); };
    });
    const studyOpen = $("#btn-study-open");
    if (studyOpen) studyOpen.onclick = () => { state.studyDoc = true; showBars(); render(); scrollTo(0, 0); };
    const indriveOpen = $("#btn-indrive-open");
    if (indriveOpen) indriveOpen.onclick = () => goToTab("indrive");

    const tpl = transportPlan(m);
    if (tpl) {
      document.querySelectorAll("[data-tr-book]").forEach((b) => {
        b.onclick = () => setTransport(b.dataset.trBook, "✅ Booked");
      });
      const bookAll = $("#btn-tr-book-all");
      if (bookAll) bookAll.onclick = () => setTransport(tpl.pending.map((d) => d.date), "✅ Booked");
      const offAll = $("#btn-tr-off-all");
      if (offAll) offAll.onclick = () => setTransport(tpl.pending.map((d) => d.date), "🚫 Off");
      const undoAll = $("#btn-tr-undo-all");
      if (undoAll) undoAll.onclick = () => setTransport(tpl.targets.map((d) => d.date), null);
      const wk = $("#btn-tr-week");
      if (wk) wk.onclick = () => {
        const auto = !tpl.targets.length && tpl.unmarkedWeek.length > 0;
        const open = state.transportWeek === null ? auto : state.transportWeek;
        state.transportWeek = !open;
        render();
      };
      /* strip: unmarked/missed → booked → off → clear */
      document.querySelectorAll("[data-tr-cycle]").forEach((b) => {
        b.onclick = () => {
          const date = b.dataset.trCycle;
          const cur = tpl.week.find((d) => d.date === date);
          const st = cur ? cur.status : "pending";
          const next = st === "booked" ? "🚫 Off" : st === "off" ? null : "✅ Booked";
          setTransport(date, next);
        };
      });
    }
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
        if (!h) return;
        const total = m.habits.length;
        const doneBefore = m.habits.filter((x) => x.doneToday).length;
        const doneAfter = h.doneToday ? doneBefore - 1 : doneBefore + 1;
        state.habitPop = h.name;
        toggleHabit(h.name);
        /* the ring is a fresh SVG node every render, so a plain CSS transition
           on stroke-dashoffset has no prior value to animate from — drive it
           with the Web Animations API instead, from the pre-toggle fill to the new one */
        const ring = document.querySelector(".ring-fill");
        if (ring) {
          ring.animate(
            [{ strokeDashoffset: habitRingOffset(doneBefore, total) }, { strokeDashoffset: habitRingOffset(doneAfter, total) }],
            { duration: 500, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "forwards" }
          );
        }
        /* clear the one-shot pop flag once the animation's had time to play,
           so it doesn't replay on the next unrelated render (e.g. the save) */
        setTimeout(() => {
          if (state.habitPop === h.name) { state.habitPop = null; render(); }
        }, 500);
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

    const againBtn = $("#btn-review-again");
    if (againBtn) againBtn.onclick = () => { state.reviewEdit = true; render(); };
    const cancelBtn = $("#btn-review-cancel");
    if (cancelBtn) cancelBtn.onclick = () => { state.reviewEdit = false; render(); };
    const saveBtn = $("#btn-review-save");
    if (saveBtn) saveBtn.onclick = () => {
      const valOf = (id) => { const el = $(id); const n = el && el.value.trim() !== "" ? num(el.value) : null; return n; };
      saveBalance({
        balance: valOf("#rv-balance"),
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
  if (v === "indrive") {
    document.querySelectorAll("[data-indrive-edit]").forEach((el) => {
      el.onclick = () => { state.indriveForm = true; state.indriveEditDate = el.dataset.indriveEdit; render(); };
    });
    const idAdd = $("#btn-indrive-add");
    if (idAdd) idAdd.onclick = () => { state.indriveForm = true; state.indriveEditDate = null; render(); };
    const idCancel = $("#btn-indrive-cancel");
    if (idCancel) idCancel.onclick = () => { state.indriveForm = false; state.indriveEditDate = null; render(); };
    const idSave = $("#btn-indrive-save");
    if (idSave) idSave.onclick = () => {
      const date = ($("#id-date")?.value || "").trim();
      const km = num($("#id-km")?.value);
      const gross = num($("#id-gross")?.value);
      const notes = ($("#id-notes")?.value || "").trim();
      if (!date) { state.error = "Pick a date."; render(); return; }
      if (km == null) { state.error = "Enter km driven."; render(); return; }
      if (gross == null) { state.error = "Enter gross earned."; render(); return; }
      setIndriveEntry(date, km, gross, notes);
      state.indriveForm = false;
      state.indriveEditDate = null;
      render();
    };
    const idRemove = $("#btn-indrive-remove");
    if (idRemove) idRemove.onclick = () => {
      if (!confirm(`Remove the ${state.indriveEditDate} entry? This can't be undone.`)) return;
      removeIndriveEntry(state.indriveEditDate);
      state.indriveForm = false;
      state.indriveEditDate = null;
      render();
    };
  }
  if (v === "articles") {
    document.querySelectorAll("[data-article]").forEach((b) => {
      b.onclick = () => { state.article = b.dataset.article; state.articleReturn = null; showBars(); render(); scrollTo(0, 0); };
    });
    const goBack = () => {
      state.article = null;
      if (state.articleReturn) { state.view = state.articleReturn; state.articleReturn = null; }
      showBars(); render(); scrollTo(0, 0);
    };
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
  buildComposerArticles();
  $("#composer-text").focus();
}
function closeComposer() {
  $("#composer").classList.add("hidden");
  $("#composer-text").value = "";
  const box = $("#composer-articles");
  if (box) box.classList.add("hidden");
}

/* fill the composer's article picker — tapping a chip inserts a [[wikilink]] */
function buildComposerArticles() {
  const box = $("#composer-articles");
  if (!box) return;
  box.classList.add("hidden");
  const arts = buildModel().articles || [];
  box.innerHTML = arts.length
    ? arts.map((a) => `<button type="button" class="art-chip" data-insert="[[${esc(a.name.replace(/\.md$/, ""))}|${esc(a.title)}]]">${esc(a.title)}</button>`).join("")
    : `<div class="muted" style="font-size:0.8rem;padding:4px 0">No research articles synced yet.</div>`;
}

/* insert text at the textarea's cursor, with a separating space if needed */
function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const sep = before && !/[\s\n]$/.test(before) ? " " : "";
  ta.value = before + sep + text + ta.value.slice(end);
  const pos = (before + sep + text).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
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

/* switch tabs from anywhere (tab bar, or a shortcut tile like the inDrive stat) */
function goToTab(view) {
  state.view = view;
  state.article = null;
  state.articleReturn = null;
  state.habitsEdit = false;
  state.taskEdit = null;
  state.studyDoc = false;
  state.indriveForm = false;
  state.indriveEditDate = null;
  showBars();
  render();
  scrollTo(0, 0);
}

document.querySelectorAll(".tab").forEach((b) => {
  b.querySelector(".ticon").innerHTML = icon(b.dataset.icon);
  b.onclick = () => {
    bounceIcon(b.querySelector(".ticon"));
    goToTab(b.dataset.view);
  };
});
$("#btn-home").onclick = () => {
  bounceIcon($("#btn-home"));
  goToTab("today");
};
$("#btn-settings").innerHTML = icon("gear", 17);
$("#btn-settings").onclick = () => {
  bounceIcon($("#btn-settings"));
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
$("#fab").onclick = () => {
  if (state.view === "habits") return openHabitModal();
  if (state.view === "indrive") { state.indriveForm = true; state.indriveEditDate = null; showBars(); return render(); }
  return openComposer();
};
$("#composer-cancel").onclick = closeComposer;
$("#composer").onclick = (e) => { if (e.target.id === "composer") closeComposer(); };
$("#composer-link-toggle").onclick = () => $("#composer-articles").classList.toggle("hidden");
$("#composer-articles").onclick = (e) => {
  const chip = e.target.closest("[data-insert]");
  if (chip) insertAtCursor($("#composer-text"), chip.dataset.insert);
};
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

/* Service worker with auto-update: when a new version activates it takes control
   and we reload once so the freshest code shows without a manual hard-refresh. */
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return; // skip the first-install claim
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update();                                   // check for a new version on every open
    setInterval(() => reg.update(), 60 * 1000);     // and every minute while the app is open
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (sw) sw.addEventListener("statechange", () => {
        // a new worker has installed alongside an existing one → activate it now
        if (sw.state === "installed" && navigator.serviceWorker.controller) sw.postMessage("skip-waiting");
      });
    });
  });
}

applyTheme();
loadCache();
render();
if (getToken()) syncAll();
