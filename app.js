/* Kernel — personal vault dashboard PWA
   M1: read-only dashboard · M1.5: themes + daily-task write-back */
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
};

const LS_TOKEN = "kernel_pat";
const LS_CACHE = "kernel_cache_v2";
const LS_THEME = "kernel_theme"; // "auto" | "dark" | "light"

const state = {
  view: "today",
  clientTab: "active",
  files: {},          // clients/savings/debts/study: raw md · daily: {text, sha}|null
  lastSync: null,
  error: null,
  busy: false,        // a write is in flight
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
  if (btn) btn.textContent = t === "light" ? "☾" : "☀";
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
  localStorage.setItem(LS_CACHE, JSON.stringify({ files: state.files, at: state.lastSync }));
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

async function syncAll() {
  if (!getToken()) return;
  setSyncStatus("syncing…");
  state.error = null;
  try {
    const [clients, savings, debts, study, daily] = await Promise.all([
      fetchRaw(PATHS.clients),
      fetchRaw(PATHS.savings),
      fetchRaw(PATHS.debts),
      fetchRaw(PATHS.study, { optional: true }),
      fetchWithSha(todayNotePath(), { optional: true }),
    ]);
    state.files = { clients, savings, debts, study, daily };
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

function addTask(text) {
  const d = state.files.daily;
  if (!d || state.busy || !text.trim()) return;
  const task = `- [ ] ${text.trim()}`;
  const lines = d.text.split("\n");
  const h = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## today"));
  if (h === -1) {
    lines.push("", "## Today", "", task);
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
    lines.splice(insert, 0, task);
  }
  saveDaily(lines.join("\n"), "kernel-app: add daily task");
}

function createTodayNote() {
  if (state.busy) return;
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const text = `---\ndate: "${iso}"\ntags:\n  - daily\n---\n\n## Today\n\n\n\n## Log\n\n`;
  state.files.daily = { text: "", sha: null };
  saveDaily(text, "kernel-app: create daily note");
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

/* ---------- model ---------- */

function buildModel() {
  const f = state.files;
  const m = { active: [], leads: [], churned: [], savings: {}, debts: [], debtTotal: null, study: null, tasks: null };

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

  return m;
}

/* ---------- rendering ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setSyncStatus(txt) {
  $("#sync-status").textContent = txt ?? (state.lastSync ? `synced ${timeAgo(state.lastSync)}` : "");
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function expiryChip(days) {
  if (days === null) return `<span class="chip dim">no date</span>`;
  if (days < 0) return `<span class="chip bad">expired ${-days}d ago</span>`;
  if (days <= 7) return `<span class="chip bad">${days}d left</span>`;
  if (days <= 30) return `<span class="chip warn">${days}d left</span>`;
  return `<span class="chip ok">${days}d left</span>`;
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
    ? `<div class="empty">No daily note yet today</div>
       <button class="btn secondary" id="btn-create-note" ${dis}>Create today's note</button>`
    : `${m.tasks.length === 0 ? `<div class="empty">Nothing on the list — add one below</div>` : ""}
       ${m.tasks.map((t) => `
         <button class="task ${t.done ? "done" : ""}" data-line="${t.line}" ${dis}>
           <span class="box">${t.done ? "✓" : ""}</span>
           <span class="txt">${esc(t.text)}</span>
         </button>`).join("")}
       <div class="add-task">
         <input type="text" id="inp-new-task" placeholder="Add a task…" ${dis}>
         <button id="btn-add-task" ${dis}>+</button>
       </div>`;

  return `
  <div class="card">
    <h2>${esc(dateStr)} ${state.busy ? `<span class="h-extra muted">saving…</span>` : ""}</h2>
    ${tasksHtml}
  </div>

  <div class="card">
    <h2>Savings <span class="h-extra muted">target ${s.target ? s.target.toLocaleString() : "—"} MAD</span></h2>
    <div class="big-number">${s.current ? s.current.toLocaleString() : "—"} <small>MAD</small></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="bar-sub"><span>${pct.toFixed(0)}%</span><span>monthly target: ${s.monthly ? s.monthly.toLocaleString() : "—"} MAD</span></div>
  </div>

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

  ${m.study ? `
  <div class="card">
    <h2>Cloud Study</h2>
    <div class="row">
      <div class="r-main"><div class="r-title">${esc(m.study.title)}</div>
      <div class="r-sub">${m.study.done}/${m.study.total} checklist items done</div></div>
      <div class="r-end"><span class="chip ${m.study.done > 0 ? "ok" : "dim"}">${m.study.total ? Math.round((m.study.done / m.study.total) * 100) : 0}%</span></div>
    </div>
  </div>` : ""}`;
}

function clientCard(c, kind) {
  const [cls, label] = statusChip(c.Status);
  const phone = (c.Phone || "").replace(/[^+\d]/g, "");
  const sub = kind === "churned"
    ? `${esc(c.Date || "")} · ${esc(c.Reason || "")}`
    : kind === "leads"
      ? `${esc(c.App || "—")} · trial: ${esc(c["Trial Start"] || "—")}`
      : `${esc(c.App || "—")} · ${esc(c.Plan || "")} ${esc(c.Price || "")} · exp ${esc(c.Expiry || "—")}`;
  return `
  <div class="row">
    <div class="r-main">
      <div class="r-title">${esc(c.Name || "—")}</div>
      <div class="r-sub">${phone ? `<a class="tel" href="tel:${phone}">${esc(c.Phone)}</a> · ` : ""}${sub}</div>
      ${c.Username ? `<div class="r-sub">user: ${esc(c.Username)}${c.Notes && c.Notes !== "—" ? ` · ${esc(c.Notes)}` : ""}</div>` : ""}
    </div>
    <div class="r-end">
      <span class="chip ${cls}">${esc(label)}</span>
      ${kind === "active" ? `<div style="margin-top:5px">${expiryChip(c.days)}</div>` : ""}
    </div>
  </div>`;
}

function renderClients(m) {
  const tab = state.clientTab;
  const list = tab === "active" ? m.active : tab === "leads" ? m.leads : m.churned;
  const sorted = tab === "active" ? [...list].sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)) : list;
  return `
  <div class="seg">
    <button data-ctab="active" class="${tab === "active" ? "active" : ""}">Active (${m.active.length})</button>
    <button data-ctab="leads" class="${tab === "leads" ? "active" : ""}">Leads (${m.leads.length})</button>
    <button data-ctab="churned" class="${tab === "churned" ? "active" : ""}">Churned (${m.churned.length})</button>
  </div>
  <div class="card">
    ${sorted.length ? sorted.map((c) => clientCard(c, tab)).join("") : `<div class="empty">Nothing here</div>`}
  </div>`;
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
    <p class="muted" style="font-size:0.8rem;line-height:1.5">Kernel — dashboard over a private vault repo. Data is fetched straight from GitHub on this device and cached locally. Task edits are committed back to the vault as you. Nothing is sent anywhere else.</p>
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
  if (!getToken()) { renderSetup(); return; }

  const m = buildModel();
  const v = state.view;
  let html = state.error ? `<div class="error-banner">${esc(state.error)}</div>` : "";
  if (!state.files.clients && !state.error) html += `<div class="empty">Loading vault…</div>`;
  else html += v === "today" ? renderToday(m) : v === "clients" ? renderClients(m) : v === "money" ? renderMoney(m) : renderSettings();
  $("#view").innerHTML = html;

  if (v === "today") {
    document.querySelectorAll(".task[data-line]").forEach((b) => {
      b.onclick = () => toggleTask(parseInt(b.dataset.line, 10));
    });
    const addBtn = $("#btn-add-task");
    const addInp = $("#inp-new-task");
    if (addBtn && addInp) {
      const submit = () => { addTask(addInp.value); addInp.value = ""; };
      addBtn.onclick = submit;
      addInp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    }
    const createBtn = $("#btn-create-note");
    if (createBtn) createBtn.onclick = createTodayNote;
  }
  if (v === "clients") {
    document.querySelectorAll("[data-ctab]").forEach((b) => {
      b.onclick = () => { state.clientTab = b.dataset.ctab; render(); };
    });
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

/* ---------- boot ---------- */

document.querySelectorAll(".tab").forEach((b) => {
  b.onclick = () => {
    state.view = b.dataset.view;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === b));
    render();
  };
});
$("#btn-refresh").onclick = () => syncAll();
$("#btn-theme").onclick = () => {
  setThemePref(effectiveTheme() === "light" ? "dark" : "light");
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

applyTheme();
loadCache();
render();
if (getToken()) syncAll();
