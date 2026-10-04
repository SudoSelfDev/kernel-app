/* Kernel — personal vault dashboard PWA
   M1: read-only dashboard · M1.5: themes + daily-task write-back
   M1.6: task removal, schedule, articles reader, auto-hiding bars */
"use strict";

/* real version: the Android build reports its versionName (1.0.<build>); the web build
   (SudoSelfDev/kernel-app) shows WEB_VERSION — keep it in sync with the CACHE name in its sw.js */
const WEB_VERSION = "68";
const APP_VERSION = "v" + ((window.KernelNative && window.KernelNative.versionName && window.KernelNative.versionName()) || `${WEB_VERSION} (web)`);

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
  masterplan: atob("MTBfUHJvamVjdHMvRGFyU3RyZWFtL21hc3Rlci1wbGFuLm1k"),
  habits: atob("MjBfTGlmZWxvZy9IYWJpdExvZy5tZA=="),
  indrive: atob("MTBfUHJvamVjdHMvSW5Ecml2ZS9pbmRyaXZlLWluY29tZS5tZA=="),
  gym: atob("MTBfUHJvamVjdHMvRml0bmVzcy9neW0tbG9nLm1k"),
};

const LS_TOKEN = "kernel_pat";
const LS_CACHE = "kernel_cache_v3";
const LS_THEME = "kernel_theme"; // "auto" | "dark" | "light"

const state = {
  view: ["today", "habits", "money", "gym", "articles", "indrive"].includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "today",
  clientTab: "active",
  openClient: null,   // "tab:index" of the expanded client row, or null
  scriptsOpen: false, // DM Scripts card collapsed by default
  article: null,      // name of the open article, or null for the list
  articleTag: "",     // Read-tab category chip filter ("" = All)
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
  indriveEditDate: null, // date (YYYY-MM-DD) of the row open in the add/edit sheet, or null for a new entry
  gymEditKey: null, // "date|workout" of the session open in the gym sheet, or null for a new session
  gymWorkoutPick: null, // "A" | "B" | "C" chosen in the currently-open gym sheet (before save)
  gymWeek: 0, // Gym tab week plan: 0 = this week, 1 = next week
  bwEdit: null, // date of the bodyweight row open in the log/edit sheet, or null for a new entry
  tasksAll: false, // show every Today task instead of the first few
  health: null, // Samsung Health / Health Connect snapshot (native Android build only)
  habitPop: null, // name of the habit whose checkbox should play the pop-in animation on this render, or null
  settingsFrom: null, // tab that opened Settings — its back link returns there
  subFrom: null, // view that opened inDrive / Clients — their back links return there
};

/* ---------- confetti ---------- */

function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;z-index:999;pointer-events:none;";
  canvas.width = innerWidth; canvas.height = innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#ff8a3d","#a98bff","#3ddc84","#ff5c7c","#5b9bff","#a7e92f"];
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
const HABIT_RING_SIZE = 128;
const HABIT_RING_STROKE = 12;
const HABIT_RING_R = (HABIT_RING_SIZE - HABIT_RING_STROKE) / 2;
const HABIT_RING_C = 2 * Math.PI * HABIT_RING_R;
const habitRingOffset = (done, total) => (total ? HABIT_RING_C * (1 - done / total) : HABIT_RING_C);

/* ---------- page + tap animations ---------- */

/* left-to-right order of the tab bar — lets a view swap pick a slide
   direction, like flipping through pages rather than just cutting */
const TAB_ORDER = ["today", "habits", "money", "gym", "articles"];

/* Skinny Fat Recomposition Program (100 kg → 85 kg), from assets/gym-plan.webp
   (viewable in-app from the Gym hero). Three sessions done in rotation, not on
   fixed weekdays: A → B → C → A … ; the next one is whatever follows the last
   logged A/B/C session. Hardcoded (not vault-parsed) so the logging form always
   matches the plan; if the plan changes, update this and the plan image together.
   Replaced the Upper Body / Legs Day weekday plan 2026-10-03. */
const GYM_WORKOUTS = {
  A: [
    { name: "Dumbbell Bench Press", target: "3 × 10",
      cues: ["Keep feet flat, back on bench", "Lower to chest, press up", "Control the movement"] },
    { name: "Incline Dumbbell Press", target: "3 × 12",
      cues: ["Bench at 30–45°", "Lower to upper chest", "Press up, don't lock elbows"] },
    { name: "Dumbbell Shoulder Press", target: "3 × 12",
      cues: ["Keep core tight", "Press overhead", "Don't arch your back"] },
    { name: "Cable Lateral Raise", target: "3 × 15",
      cues: ["Slight bend in elbows", "Raise to shoulder height", "Control on the way down"] },
    { name: "Triceps Pushdown (Cable)", target: "3 × 12",
      cues: ["Keep elbows close to body", "Push down fully", "Control the return"] },
    { name: "Overhead Triceps Extension", target: "2 × 15",
      cues: ["Keep elbows in", "Lower behind head", "Extend fully, control"] },
    { name: "Plank", target: "3 × 30 sec", isTimed: true,
      cues: ["Keep body in a straight line", "Engage core, glutes and legs", "Don't let hips sag"] },
  ],
  B: [
    { name: "Lat Pulldown", target: "3 × 10",
      cues: ["Grasp bar wide", "Pull to upper chest", "Squeeze your back"] },
    { name: "Seated Cable Row", target: "3 × 12",
      cues: ["Keep back straight", "Pull to your midsection", "Squeeze shoulder blades"] },
    { name: "Chest-Supported DB Row", target: "3 × 12",
      cues: ["Chest on bench", "Pull towards hips", "Squeeze your back"] },
    { name: "Face Pull (Cable)", target: "3 × 15",
      cues: ["Use rope, pull to face", "Keep elbows high", "Squeeze rear delts"] },
    { name: "EZ Bar Curl", target: "3 × 12",
      cues: ["Keep elbows at your sides", "Full range of motion", "Control the weight"] },
    { name: "Hammer Curl", target: "3 × 12",
      cues: ["Neutral grip (palms in)", "Keep elbows still", "Control the movement"] },
    { name: "Dead Hang", target: "2 × 20–30 sec", isTimed: true,
      cues: ["Full arm extension", "Relax shoulders", "Hold as long as possible"] },
  ],
  C: [
    { name: "Leg Press", target: "3 × 12",
      cues: ["Feet shoulder-width", "Lower with control, press up", "Don't lock your knees"] },
    { name: "Romanian Deadlift", target: "3 × 10",
      cues: ["Slight bend in knees", "Hinge at hips, keep back straight", "Feel the stretch in hamstrings"] },
    { name: "Leg Extension", target: "3 × 15",
      cues: ["Control the movement", "Full knee extension", "Don't swing your legs"] },
    { name: "Seated Leg Curl", target: "3 × 12",
      cues: ["Keep hips on the seat", "Curl fully, control the return", "Feel the hamstrings"] },
    { name: "Calf Raises", target: "3 × 20",
      cues: ["Full range of motion", "Pause at the top", "Keep balance, control"] },
    { name: "Hanging Knee Raise", alt: "Ab Wheel Rollout", target: "3 × 10",
      cues: ["Hang from a bar", "Raise knees to chest", "Avoid swinging"],
      altCues: ["Keep core tight", "Roll forward, don't arch your back", "Control the way back"] },
    { name: "Incline Walk Finisher", target: "5 min", isTimed: true,
      cues: ["Incline 6–10%", "Moderate pace", "5 minutes"] },
  ],
};
const GYM_ROTATION = ["A", "B", "C"];
const GYM_INFO = {
  A: { title: "Upper Push", focus: "Chest · Shoulders · Triceps", warmup: "5 min treadmill easy jog", quote: "Stronger today. Leaner tomorrow." },
  B: { title: "Upper Pull", focus: "Back · Biceps", warmup: "5 min rowing machine or bike", quote: "A stronger back builds a stronger you." },
  C: { title: "Legs + Core", focus: "Football-aware — never the day before a match", warmup: "5 min bike", quote: "Legs today. A stronger tomorrow." },
};
const GYM_SESSION = "45–60 min @ 6:30 am";
const GYM_TIPS = {
  overload: ["Weeks 1–2: form over weight", "Weeks 3+: complete all reps cleanly, then add weight", "Every 4 weeks: deload — same exercises, ~40% less weight"],
  key: ["Caloric deficit is the #1 lever for the belly", "2–3 L water daily · 7–8 h sleep", "Log every session in Kernel", "Weigh in 2–3× a week and track the trend"],
  football: "If football falls on a gym day or the day after, do A or B instead. Never C the day before a match.",
};
/* the previous weekday plan — kept so sessions logged before 2026-10-03 still show and stay editable */
const GYM_LEGACY = {
  UPPER: ["Warm-Up — Treadmill|10 min", "Chest Press Machine|3 x 10 (light)", "Lat Pulldown|3 x 10 (light)", "Shoulder Press Machine|3 x 10 (light)",
    "Biceps Curl|2 x 12", "Triceps Push Down|2 x 12", "Finisher — Bike|25 min"],
  LEGS: ["Warm-Up — Bike|15 min", "Leg Press|3 x 10-12", "Seated Leg Curl|3 x 10-12", "Leg Extension|2 x 12-15",
    "Calf Raises|2 x 12-15", "Finisher — Walking (incline)|30 min, 2% incline"],
};
const workoutExercises = (w) => GYM_WORKOUTS[w]
  || (GYM_LEGACY[w] || []).map((x) => { const [name, target] = x.split("|"); return { name, target }; });
const WORKOUT_LABELS = { A: "Upper Push", B: "Upper Pull", C: "Legs + Core", UPPER: "Upper Body", LEGS: "Legs Day" };
/* the goal from the plan image — used to show weight-loss progress against
   the Bodyweight log the Gym tab already tracks */
const GYM_GOAL = { startKg: 100, targetKg: 85 };

/* where you are in the A → B → C rotation, from the newest logged A/B/C session */
function gymRotation(m) {
  const sessions = ((m && m.gym && m.gym.sessions) || []).filter((s) => GYM_ROTATION.includes(s.workout));
  const last = sessions[0] || null;   // sessions are newest first
  const after = (w) => GYM_ROTATION[(GYM_ROTATION.indexOf(w) + 1) % GYM_ROTATION.length];
  return {
    last,
    doneToday: last && last.date === todayIso() ? last.workout : null,
    next: last ? after(last.workout) : "A",
  };
}

/* ---------- week planner ---------- */

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GYM_DEFAULT_DAYS = [1, 3, 5];            // Mon, Wed, Fri until you change them in the planner
const PLAN_VALUES = ["A", "B", "C", "Rest", "Football"];
const normPlan = (v) => PLAN_VALUES.find((p) => p.toLowerCase() === String(v || "").trim().toLowerCase()) || null;

/* The week, Mon → Sun (offset 0 = this week, 1 = next). Each future day is a pinned choice
   (A/B/C/Rest/Football) or a suggestion: on your gym days the rotation carries on from the
   last logged session, so a skipped or swapped workout shifts the rest of the week. C is
   never suggested the day before or after football (A takes its place and C waits); a C you
   pin there yourself is kept but flagged. Past days show what you logged. */
function weekSchedule(m, offset = 0) {
  const g = (m && m.gym) || { sessions: [], weekPlan: {}, gymDays: GYM_DEFAULT_DAYS };
  const plan = g.weekPlan || {}, gymDays = g.gymDays || GYM_DEFAULT_DAYS;
  const rot = gymRotation(m);
  const after = (w) => GYM_ROTATION[(GYM_ROTATION.indexOf(w) + 1) % GYM_ROTATION.length];
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isFootball = (d) => plan[isoOf(d)] === "Football";
  const nearMatch = (d) => isFootball(addDays(d, 1)) || isFootball(addDays(d, -1));
  const logged = {};
  (g.sessions || []).forEach((s) => { if (!logged[s.date]) logged[s.date] = s.workout; });   // old-plan sessions count as done too

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = isoOf(today);
  const monday0 = addDays(today, -((today.getDay() + 6) % 7));
  const first = addDays(monday0, 7 * offset), last = addDays(first, 6);
  let pointer = rot.next;
  const days = [], notes = [];
  for (let d = new Date(monday0); d <= last; d = addDays(d, 1)) {
    const key = isoOf(d), pin = plan[key] || null, gymDay = gymDays.includes(d.getDay());
    let e;
    if (logged[key] && key <= todayKey) e = { kind: "done", w: logged[key] };
    else if (key < todayKey) {
      const planned = pin ? /^[ABC]$/.test(pin) : gymDay;
      e = { kind: pin === "Football" ? "football" : planned ? "skipped" : "rest" };
    }
    else if (pin === "Rest" || pin === "Football") e = { kind: pin.toLowerCase(), pinned: true };
    else if (pin) {
      e = { kind: "gym", w: pin, pinned: true, warn: pin === "C" && nearMatch(d) };
      pointer = after(pin);
    } else if (gymDay) {
      if (pointer === "C" && nearMatch(d)) {
        e = { kind: "gym", w: "A", moved: true };    // C waits for the next safe gym day
      } else { e = { kind: "gym", w: pointer }; pointer = after(pointer); }
    } else e = { kind: "rest" };
    if (d >= first) {
      days.push({ date: key, d: new Date(d), dow: DOW_SHORT[d.getDay()], today: key === todayKey, past: key < todayKey, ...e });
      if (e.moved) notes.push(`C moved off ${DOW_SHORT[d.getDay()]} — football the day ${isFootball(addDays(d, 1)) ? "after" : "before"}`);
      if (e.warn) notes.push(`${DOW_SHORT[d.getDay()]}: C next to a football day — the plan says A or B`);
    }
  }
  return { days, notes, gymDays, offset };
}

/* today's plan, and the first gym day from today on (looking into next week if needed) */
function gymPlanToday(m) {
  const all = [...weekSchedule(m, 0).days, ...weekSchedule(m, 1).days];
  const today = all.find((x) => x.today);
  const nextGym = all.find((x) => !x.past && x.kind === "gym");
  return { today, nextGym };
}
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

/* fires onLongPress after a sustained press; cancels on release/move-away/scroll
   so it doesn't fire alongside a normal tap or during a scroll gesture */
function bindLongPress(el, onLongPress, delay = 500) {
  let timer = null, fired = false;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    fired = false;
    cancel();
    timer = setTimeout(() => { fired = true; onLongPress(e); }, delay);
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("contextmenu", (e) => { if (fired) e.preventDefault(); });
}

/* ---------- icons (Lucide-style, stroke = currentColor) ---------- */

const ICONS = {
  plus: "M5 12h14 M12 5v14",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  pencil: "M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z",
  sun: "M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  sliders: "M10 5H3 M12 19H3 M14 3v4 M16 17v4 M21 12h-9 M21 19h-5 M21 5h-3 M8 10v4 M8 12H3",
  chevr: "m9 18 6-6-6-6",
  chevl: "m15 18-6-6 6-6",
  chevd: "m6 9 6 6 6-6",
  back: "m12 19-7-7 7-7 M19 12H5",
  dumbbell: "m6.5 6.5 11 11 M21 21l-1-1 M3 3l1 1 M18 22l4-4 M2 6l4-4 M3 10l7-7 M14 21l7-7",
  book: "M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
  checksq: "m9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  wallet: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
  droplet: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  activity: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  car: "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2 M7 17h10 M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  bus: "M8 6v6 M15 6v6 M2 12h19.6 M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3 M9 18h5 M5 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M14 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  copy: "M8 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  search: "M21 21l-4.34-4.34 M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0",
  ext: "M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  trash: "M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
  bell: "M10.27 21a2 2 0 0 0 3.46 0 M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33",
  refresh: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  cloud: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
  scale: "M12 3v18 M5 21h14 M3 7h18 M6 7l-3 7a3 3 0 0 0 6 0z M18 7l-3 7a3 3 0 0 0 6 0z",
  walk: "M13 4a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M8 21l3-7 M11 14l-3-3 3-4 3 3 3 1 M14 10l1 11",
  ball: "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0 M12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5z M12 7.5V2.5 M16.3 10.6l4.9-1.6 M14.7 15.6l3 4.1 M9.3 15.6l-3 4.1 M7.7 10.6 2.8 9",
};

const icon = (name, size = 20, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.plus}"/></svg>`;

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
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f6f4f1" : "#0e0d0c";
  const btn = $("#btn-theme");
  if (btn) btn.innerHTML = icon(t === "light" ? "moon" : "sun", 20);
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
    keepalive: true, // let an in-flight save survive a tab switch / navigation
  });
  if (res.status === 404 && optional) return null;
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.text();
}

/* whole-repo file tree in one call (Git Trees API) — used to find every
   #Research-tagged article regardless of which folder it lives in, without
   a fetchDir round trip per subfolder */
async function fetchTree() {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`,
    { headers: { ...ghHeaders(), Accept: "application/vnd.github+json" } },
  );
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.tree) ? j.tree : [];
}

/* JSON variant — returns {text, sha} so we can write the file back */
async function fetchWithSha(path, { optional = false } = {}) {
  const res = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github+json" },
    keepalive: true,
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
    keepalive: true, // the write itself must survive a tab switch / navigation, not just the read before it
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

/* forces every debounced save that's still waiting out its timer to write
   right now instead — called before syncAll() overwrites state.files (so a
   pending edit is never silently clobbered by the pre-edit server copy),
   and on visibilitychange/pagehide (so backgrounding or refreshing the tab
   doesn't just kill the timer and lose the edit outright) */
async function flushAllPending() {
  const jobs = [];
  if (_dailyTimer) { clearTimeout(_dailyTimer); _dailyTimer = null; jobs.push(flushDaily()); }
  if (_habitTimer) { clearTimeout(_habitTimer); _habitTimer = null; jobs.push(flushHabits()); }
  if (_savingsTimer) { clearTimeout(_savingsTimer); _savingsTimer = null; jobs.push(flushSavings()); }
  if (_debtTimer) { clearTimeout(_debtTimer); _debtTimer = null; jobs.push(flushDebts()); }
  if (_transportTimer) { clearTimeout(_transportTimer); _transportTimer = null; jobs.push(flushTransport()); }
  if (_indriveTimer) { clearTimeout(_indriveTimer); _indriveTimer = null; jobs.push(flushIndrive()); }
  if (_gymTimer) { clearTimeout(_gymTimer); _gymTimer = null; jobs.push(flushGym()); }
  await Promise.all(jobs);
}

async function syncAll() {
  if (!getToken()) return;
  /* write any pending edit before fetching "fresh" data, or that edit gets
     silently overwritten by the pre-edit server copy we're about to pull in */
  await flushAllPending();
  setSyncStatus("Syncing…");
  state.error = null;
  try {
    const [clients, savings, debts, study, studyplan, daily, tree, masterplan, habits, transport, indrive, gym] = await Promise.all([
      fetchRaw(PATHS.clients),
      fetchRaw(PATHS.savings),
      fetchRaw(PATHS.debts),
      fetchRaw(PATHS.study, { optional: true }),
      fetchRaw(PATHS.studyplan, { optional: true }),
      fetchWithSha(todayNotePath(), { optional: true }),
      fetchTree().catch(() => []),
      fetchRaw(PATHS.masterplan, { optional: true }),
      fetchWithSha(PATHS.habits, { optional: true }),
      fetchRaw(PATHS.transport, { optional: true }),
      fetchRaw(PATHS.indrive, { optional: true }),
      fetchRaw(PATHS.gym, { optional: true }),
    ]);
    /* #Research articles can live anywhere under Projects/Library/top-level
       Lifelog now — fetch every candidate and keep only the tagged ones */
    let articles = [];
    const candidates = tree.filter((t) => t.type === "blob" && isResearchCandidate(t.path));
    const texts = await Promise.all(candidates.map((f) => fetchRaw(f.path, { optional: true })));
    candidates.forEach((f, i) => {
      const text = texts[i];
      if (text && hasResearchTag(text)) {
        articles.push({ name: f.path.split("/").pop(), path: f.path, text });
      }
    });
    state.files = { clients, savings, debts, study, studyplan, daily, articles, masterplan, habits, transport, indrive, gym };
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

async function removeTask(lineIdx) {
  const d = state.files.daily;
  if (!d || state.busy) return;
  const t = (d.text.split("\n")[lineIdx] || "").trim();
  if (!/^- \[[ xX]\]/.test(t)) return;
  const label = t.replace(/^- \[[ xX]\]\s*/, "").replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a);
  if (!(await confirmBox("Remove task?", `"${label}" is deleted from today's note.`))) return;
  /* re-read after the prompt — a sync may have landed while it was open */
  const cur = state.files.daily;
  if (!cur || state.busy) return;
  const lines = cur.text.split("\n");
  if ((lines[lineIdx] || "").trim() !== t) return;
  lines.splice(lineIdx, 1);
  state.taskEdit = null;
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

/* frontmatter() only reads single-line "key: value" pairs, so tags need
   their own parser — Obsidian writes them either inline (`tags: [A, B]`)
   or as a YAML list (`tags:` then indented `- A` lines). */
function frontmatterTags(md) {
  const fm = (md || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const block = fm[1];
  const line = block.match(/^tags:[ \t]*(.*)$/m);
  if (!line) return [];
  const inline = line[1].trim();
  if (inline.startsWith("[")) {
    return inline.replace(/^\[|\]$/g, "").split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const after = block.slice(block.indexOf(line[0]) + line[0].length).split("\n");
  const items = [];
  for (const l of after) {
    const li = l.match(/^\s+-\s*(.+)$/);
    if (li) items.push(li[1].trim().replace(/^["']|["']$/g, ""));
    else if (l.trim() !== "") break; // first non-list, non-blank line ends the tags block
  }
  return items;
}
const hasResearchTag = (md) => frontmatterTags(md).some((t) => t.toLowerCase() === "research");

/* folders worth scanning for #Research-tagged articles — deliberately
   excludes 21_DailyNotes, _Daemon, 90_Archive, .trash, 00_Inbox: real content
   lives in Projects/Library, not internal ops or daily task logs */
function isResearchCandidate(path) {
  if (!path.endsWith(".md")) return false;
  if (path.startsWith("10_Projects/")) return true;
  if (path.startsWith("30_Library/")) return true;
  if (path.startsWith("20_Lifelog/") && !path.slice("20_Lifelog/".length).includes("/")) return true;
  return false;
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
    study: null, tasks: null, articles: [], review: null, transport: null, indrive: null, gym: null,
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

  if (f.gym) {
    const t = f.gym;
    const bodyweights = parseTable(section(t, "## Bodyweight Log")).map((r) => {
      const vals = Object.values(r);
      return { date: (vals[0] || "").trim(), weight: num(vals[1]), notes: (vals[2] || "").trim() };
    }).filter((r) => r.date && r.weight != null);
    bodyweights.sort((a, b) => b.date.localeCompare(a.date));

    const exRows = parseTable(section(t, "## Workout Log")).map((r) => {
      const vals = Object.values(r);
      return {
        date: (vals[0] || "").trim(),
        workout: (vals[1] || "").trim().toUpperCase(),
        exercise: (vals[2] || "").trim(),
        weight: num(vals[3]),
        reps: (vals[4] || "").trim(),
      };
    }).filter((r) => r.date && r.workout && r.exercise);

    const sessionMap = new Map();
    exRows.forEach((r) => {
      const key = `${r.date}|${r.workout}`;
      if (!sessionMap.has(key)) sessionMap.set(key, { date: r.date, workout: r.workout, exercises: [] });
      sessionMap.get(key).exercises.push(r);
    });
    const sessions = [...sessionMap.values()].sort((a, b) => b.date.localeCompare(a.date));
    const lastSession = sessions[0] || null;

    /* week planner: "## Week Plan" holds the usual gym days and the days you pinned by hand */
    const planBody = section(t, "## Week Plan");
    const weekPlan = {};
    parseTable(planBody).forEach((r) => {
      const vals = Object.values(r);
      const date = (vals[0] || "").trim(), val = normPlan(vals[1]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && val) weekPlan[date] = val;
    });
    const daysLine = (planBody.match(/^\*\*Gym days:\*\*\s*(.+)$/m) || [])[1];
    const gymDays = daysLine
      ? DOW_SHORT.map((d, i) => (new RegExp(`\\b${d}`, "i").test(daysLine) ? i : -1)).filter((i) => i >= 0)
      : GYM_DEFAULT_DAYS;

    m.gym = { bodyweights, sessions, lastSession, lastBodyweight: bodyweights[0] || null, weekPlan, gymDays };
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
        path: a.path,
        title,
        created: String(fm.created || "").replace(/^[:\s]+/, ""),
        topic: fm.topic || "",
        author: fm.author || "",
        tags: frontmatterTags(a.text).filter((t) => t.toLowerCase() !== "research"),
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
  if (days === null) return `<span class="chip dim">No date</span>`;
  if (days < 0) return `<span class="chip bad">Expired ${-days} d ago</span>`;
  if (days <= 7) return `<span class="chip bad">Expires in ${days} d</span>`;
  if (days <= 30) return `<span class="chip warn">Expires in ${days} d</span>`;
  return `<span class="chip ok">Expires in ${days} d</span>`;
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
    <span class="cd-ic">${icon("copy", 16)}</span>
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
      ? `<span class="task-link" data-article-link="${esc(art.path)}">${esc(label)}</span>`
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


/* ---------- Samsung Health via Health Connect (native Android build only) ---------- */

const HAS_HEALTH = typeof window.KernelNative !== "undefined" && typeof window.KernelNative.healthSync === "function";
const LS_HEALTH = "kernel_health";
try { state.health = JSON.parse(localStorage.getItem(LS_HEALTH) || "null"); } catch { state.health = null; }
const HEALTH_MSG = {
  unavailable: "Health Connect isn't available on this phone.",
  install: "Install or update Health Connect from the Play Store, then try again.",
  denied: "Permission denied. Open Health Connect → App permissions → Kernel and allow Steps, Weight and Exercise.",
};

function healthSyncNow() {
  if (!HAS_HEALTH) return;
  state.health = { ...(state.health || {}), busy: true, msg: null };
  render();
  window.KernelNative.healthSync();
}

/* insert ✅ for one habit on several dates, never un-ticking anything */
function tickHabitDates(name, isos) {
  const h = state.files.habits;
  if (!h || !isos.length) return 0;
  const lines = h.text.split("\n");
  const logIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith("## log"));
  if (logIdx === -1) return 0;
  let head = -1;
  for (let i = logIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("|")) { head = i; break; }
    if (/^#+\s/.test(lines[i])) return 0;
  }
  if (head === -1) return 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  let cols = cells(lines[head]);
  if (!cols.includes(name)) {
    cols = [...cols, name];
    lines[head] = `| ${cols.join(" | ")} |`;
    lines[head + 1] = `|${cols.map(() => "---").join("|")}|`;
    for (let i = head + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
      lines[i] = `| ${[...cells(lines[i]), "—"].slice(0, cols.length).join(" | ")} |`;
    }
  }
  const col = cols.indexOf(name);
  let changed = 0;
  for (const iso of isos) {
    let rowIdx = -1, insertAt = -1, end = head + 2;
    for (let i = head + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
      end = i + 1;
      const d = cells(lines[i])[0];
      if (d === iso) { rowIdx = i; break; }
      if (insertAt === -1 && d < iso) insertAt = i;   // table is newest-first
    }
    if (rowIdx === -1) {
      const row = cols.map((_, i) => (i === 0 ? iso : i === col ? "✅" : "—"));
      lines.splice(insertAt === -1 ? end : insertAt, 0, `| ${row.join(" | ")} |`);
      changed++;
    } else {
      const row = cells(lines[rowIdx]);
      while (row.length < cols.length) row.push("—");
      if (!row[col].includes("✅")) { row[col] = "✅"; lines[rowIdx] = `| ${row.join(" | ")} |`; changed++; }
    }
  }
  if (changed) applyHabitChange(lines.join("\n"));
  return changed;
}

/* add bodyweight rows for dates that have none — manual entries are never overwritten */
function importWeights(list) {
  if (!state.files.gym) return 0;
  const lines = gymText().split("\n");
  const range = gymTableRange(lines, /^##\s+bodyweight log/i);
  if (!range) return 0;
  const have = new Set();
  for (let i = range.start + 2; i <= range.end; i++) have.add((lines[i].split("|")[1] || "").trim());
  let added = 0, at = range.end + 1;
  for (const w of list) {
    if (have.has(w.date)) continue;
    lines.splice(at++, 0, `| ${w.date} | ${w.kg} | Samsung Health |`);
    added++;
  }
  if (added) applyGymChange(lines.join("\n"));
  return added;
}

/* called by native code with the JSON result of KernelNative.healthSync() */
window.__kernelHealth = (json) => {
  let r; try { r = JSON.parse(json); } catch { return; }
  if (r.status !== "ok") {
    state.health = { ...(state.health || {}), busy: false, msg: HEALTH_MSG[r.status] || "Health sync failed." };
    render(); return;
  }
  const notes = [];
  const stepHabit = ((buildModel().habits) || []).find((h) => /steps/i.test(h.name));
  if (stepHabit) {
    const days = (r.steps || []).filter((d) => d.steps >= 10000).map((d) => d.date);
    const n = tickHabitDates(stepHabit.name, days);
    if (n) notes.push(`${n} step day${n > 1 ? "s" : ""} ticked`);
  }
  const w = importWeights(r.weights || []);
  if (w) notes.push(`${w} weigh-in${w > 1 ? "s" : ""} added`);
  state.health = { busy: false, at: Date.now(), steps: r.steps || [], workouts: r.workouts || [],
    msg: notes.length ? notes.join(" · ") : "Up to date" };
  try { localStorage.setItem(LS_HEALTH, JSON.stringify({ ...state.health, msg: null })); } catch {}
  render();
};

function healthCard() {
  if (!HAS_HEALTH) return "";
  const h = state.health || {};
  const today = (h.steps || []).find((d) => d.date === todayIso());
  const sessions = (h.workouts || []).slice(0, 6);
  const note = h.busy ? "Syncing…" : h.msg || (h.at ? `Synced ${timeAgo(h.at)} · last 7 days` : "Pulls steps, weight and workouts from Health Connect.");
  return `
    <div class="card">
      <h2>Samsung Health ${today ? `<span class="chip ok num">${today.steps.toLocaleString("en-US")} steps</span>` : ""}</h2>
      <p class="card-note">${esc(note)}</p>
      ${sessions.map((s) => `
        <div class="split health-row"><span>${esc(s.type)} · ${esc(dowOnly(s.date))}</span><b>${s.minutes} min</b></div>`).join("")}
      <button class="btn outline health-sync" id="btn-health-sync" ${h.busy ? "disabled" : ""}>Sync from Samsung Health${icon("refresh", 16)}</button>
    </div>`;
}

/* ---------- gym log (bodyweight + workout sessions) ---------- */

let _gymTimer = null;
const gymText = () => state.files.gym || "";

function applyGymChange(newText) {
  state.files.gym = newText;
  render();
  if (_gymTimer) clearTimeout(_gymTimer);
  _gymTimer = setTimeout(flushGym, SAVE_DELAY);
}

async function flushGym() {
  _gymTimer = null;
  const text = gymText();
  if (!text) return;
  state.busy = true;
  render();
  try {
    const serverText = await fetchRaw(PATHS.gym);
    const baseSha = await gitBlobSha(serverText);
    await putFile(PATHS.gym, text, "kernel-app: update gym log", baseSha);
    state.lastSync = Date.now();
    saveCache();
    state.error = null;
  } catch (e) {
    if (e.message === "auth-write") state.error = "Write rejected — your token needs Contents: Read and write.";
    else if (e.message === "conflict") { state.error = "Gym log changed on GitHub — refreshing."; state.busy = false; await syncAll(); return; }
    else state.error = "Couldn't save — check your connection and try again.";
  }
  state.busy = false;
  render();
}

/* [start,end] line-index range of the table rows under a "## Heading" match */
function gymTableRange(lines, headingRegex) {
  const h = lines.findIndex((l) => headingRegex.test(l.trim()));
  if (h === -1) return null;
  let start = -1, end = -1;
  for (let i = h + 1; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (tr.startsWith("|")) { if (start === -1) start = i; end = i; }
    else if (start !== -1) break;
    else if (/^#+\s/.test(tr)) break;
  }
  return start === -1 ? null : { start, end };
}

function setBodyweight(date, weight, notes) {
  const lines = gymText().split("\n");
  const range = gymTableRange(lines, /^##\s+bodyweight log/i);
  if (!range) return;
  const rowStr = `| ${date} | ${weight} | ${notes || ""} |`;
  let rowIdx = -1;
  for (let i = range.start + 2; i <= range.end; i++) {
    if ((lines[i].split("|")[1] || "").trim() === date) { rowIdx = i; break; }
  }
  if (rowIdx !== -1) lines[rowIdx] = rowStr;
  else lines.splice(range.end + 1, 0, rowStr);
  applyGymChange(lines.join("\n"));
}

function removeBodyweight(date) {
  const lines = gymText().split("\n");
  const range = gymTableRange(lines, /^##\s+bodyweight log/i);
  if (!range) return;
  for (let i = range.start + 2; i <= range.end; i++) {
    if ((lines[i].split("|")[1] || "").trim() === date) { lines.splice(i, 1); break; }
  }
  applyGymChange(lines.join("\n"));
}

/* replace (or insert) all exercise rows for one date+workout session */
function setGymSession(date, workout, entries) {
  let lines = gymText().split("\n");
  let range = gymTableRange(lines, /^##\s+workout log/i);
  if (!range) return;
  for (let i = range.end; i >= range.start + 2; i--) {
    const cells = lines[i].split("|");
    if ((cells[1] || "").trim() === date && (cells[2] || "").trim().toUpperCase() === workout) lines.splice(i, 1);
  }
  range = gymTableRange(lines, /^##\s+workout log/i);
  const insertAt = range ? range.end + 1 : lines.length;
  const rows = entries.map((e) => `| ${date} | ${workout} | ${e.exercise} | ${e.weight ?? ""} | ${e.reps} |`);
  lines.splice(insertAt, 0, ...rows);
  applyGymChange(lines.join("\n"));
}

function removeGymSession(date, workout) {
  const lines = gymText().split("\n");
  const range = gymTableRange(lines, /^##\s+workout log/i);
  if (!range) return;
  for (let i = range.end; i >= range.start + 2; i--) {
    const cells = lines[i].split("|");
    if ((cells[1] || "").trim() === date && (cells[2] || "").trim().toUpperCase() === workout) lines.splice(i, 1);
  }
  applyGymChange(lines.join("\n"));
}

/* make sure the gym log has a "## Week Plan" section (gym-days line + Date | Plan table) */
function ensureWeekPlan(lines) {
  let h = lines.findIndex((l) => /^##\s+week plan/i.test(l.trim()));
  if (h === -1) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "## Week Plan", "", `**Gym days:** ${GYM_DEFAULT_DAYS.map((i) => DOW_SHORT[i]).join(", ")}`, "", "| Date | Plan |", "|---|---|", "");
    return lines;
  }
  if (!gymTableRange(lines, /^##\s+week plan/i)) {
    let at = h + 1;
    while (at < lines.length && !/^#+\s/.test(lines[at].trim()) && lines[at].trim() !== "" ) at++;
    lines.splice(at, 0, "", "| Date | Plan |", "|---|---|");
  }
  return lines;
}

/* pin a day to A / B / C / Rest / Football, or clear it (value null) so the planner suggests it again */
function setWeekPlan(date, value) {
  const lines = ensureWeekPlan(gymText().split("\n"));
  const range = gymTableRange(lines, /^##\s+week plan/i);
  if (!range) return;
  let rowIdx = -1;
  for (let i = range.start + 2; i <= range.end; i++) {
    if ((lines[i].split("|")[1] || "").trim() === date) { rowIdx = i; break; }
  }
  if (value && rowIdx !== -1) lines[rowIdx] = `| ${date} | ${value} |`;
  else if (value) {
    /* keep the table in date order */
    let at = range.end + 1;
    for (let i = range.start + 2; i <= range.end; i++) {
      if ((lines[i].split("|")[1] || "").trim() > date) { at = i; break; }
    }
    lines.splice(at, 0, `| ${date} | ${value} |`);
  } else if (rowIdx !== -1) lines.splice(rowIdx, 1);
  applyGymChange(lines.join("\n"));
}

function setGymDays(days) {
  const lines = ensureWeekPlan(gymText().split("\n"));
  const text = `**Gym days:** ${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => DOW_SHORT[i]).join(", ")}`;
  const h = lines.findIndex((l) => /^##\s+week plan/i.test(l.trim()));
  let found = -1;
  for (let i = h + 1; i < lines.length && !/^#+\s/.test(lines[i].trim()); i++) {
    if (/^\*\*Gym days:\*\*/.test(lines[i].trim())) { found = i; break; }
  }
  if (found !== -1) lines[found] = text;
  else lines.splice(h + 1, 0, "", text);
  applyGymChange(lines.join("\n"));
}

/* ---------- shared render helpers ---------- */

const pad2 = (n) => String(n).padStart(2, "0");
const fmt0 = (n) => Math.round(n || 0).toLocaleString("en-US");
/* 24500 → "24.5k", 49000 → "49k" */
const fmtK = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));
const isoDate = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`);
const isIso = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ""));
/* "2026-09-29" → "Sep 29" · "Tue, Sep 29" · "Tue" (non-ISO strings pass through) */
const shortDate = (iso) => (isIso(iso) ? isoDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(iso || ""));
const dowDate = (iso) => (isIso(iso) ? isoDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : String(iso || ""));
const dowOnly = (iso) => (isIso(iso) ? isoDate(iso).toLocaleDateString("en-US", { weekday: "short" }) : String(iso || ""));
/* vault statuses carry emoji ("⏳ Pending") — the UI shows plain words in outlined chips */
const plainStatus = (s) => String(s || "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();

/* a progress ring; the fill is an SVG stroke so it can animate */
function ringSvg(size, stroke, pct, extraCls = "") {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-fill ${extraCls}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(100, pct)) / 100)}"/>
  </svg>`;
}

const backLink = (id, label) => `<button class="back-link" id="${id}">${icon("back", 20)}${esc(label)}</button>`;

/* ---------- Today ---------- */

function renderToday(m) {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dis = state.busy ? "disabled" : "";
  const rot = gymRotation(m);

  const TASK_LIMIT = 6;
  const allTasks = m.tasks || [];
  const shownTasks = state.tasksAll ? allTasks : allTasks.filter((t, i) => i < TASK_LIMIT || state.taskEdit === t.line);
  const hiddenCount = allTasks.length - shownTasks.length;
  const tasksHtml = m.tasks === null
    ? `<div class="empty">No daily note yet today — tap + to start one</div>`
    : `${m.tasks.length === 0 ? `<div class="empty">Nothing on the list — tap + to add tasks</div>` : ""}
       ${shownTasks.map((t) => state.taskEdit === t.line
         ? `<div class="task-row task-edit">
              <input type="text" class="task-edit-input" id="task-edit-input" value="${esc(t.text)}" autocomplete="off">
              <button class="task-icon-btn save" data-edit-save="${t.line}" title="Save" aria-label="Save">${icon("check", 18)}</button>
              <button class="task-icon-btn del" data-del-line="${t.line}" title="Remove task" aria-label="Remove task">${icon("trash", 16)}</button>
              <button class="task-icon-btn" id="btn-task-edit-cancel" title="Cancel" aria-label="Cancel">${icon("x", 16)}</button>
            </div>`
         : `<div class="task-row">
              <button class="task ${t.done ? "done" : ""}" data-line="${t.line}" ${dis}>
                <span class="box">${t.done ? icon("check", 16, 3) : ""}</span>
                <span class="txt">${linkifyTaskText(t.text, m.articles)}</span>
              </button>
              <button class="task-icon-btn" data-edit-line="${t.line}" title="Edit task" aria-label="Edit task" ${dis}>${icon("pencil", 16)}</button>
            </div>`).join("")}
       ${hiddenCount > 0 ? `<button class="ghost" id="btn-tasks-more">+ ${hiddenCount} more</button>`
         : state.tasksAll && allTasks.length > TASK_LIMIT ? `<button class="ghost" id="btn-tasks-more">Show less</button>` : ""}`;

  /* ---- office transport (log-driven booking window, no calendar) ---- */
  const tp = transportPlan(m);
  let transportCard = "";
  const trDis = state.busy ? "disabled" : "";
  if (tp) {
    const pending = tp.pending;                            // due today, still unmarked
    const actioned = tp.targets.filter((x) => x.status === "booked" || x.status === "off");
    const multi = pending.length > 1;                      // the Friday Sat+Sun+Mon window

    let chip, sub, loud = false, actions = "";
    if (pending.length) {
      chip = tp.pastCutoff ? `<span class="chip bad">Cutoff passed</span>` : `<span class="chip warn">Needs booking</span>`;
      loud = !tp.pastCutoff;
      sub = tp.pastCutoff
        ? `The ${esc(tp.cutoff)} window has passed — if you still booked ${multi ? "them" : "it"}, mark ${multi ? "them" : "it"} below.`
        : multi
          ? `Friday window: ${pending.length} rides to book before ${esc(tp.cutoff)}`
          : `Next booking: ${esc(pending[0].short)} · ${esc(tp.cutoff)}`;
      actions = `
        <div class="tr-actions">
          <button class="btn" id="btn-tr-book-all" ${trDis}>${multi ? `Mark ${pending.length} booked` : "Mark booked"}</button>
        </div>
        <button class="ghost sm tr-foot" id="btn-tr-off-all" ${trDis}>${multi ? "Days off" : "Day off"} →</button>`;
    } else if (tp.targets.length) {
      const allBooked = actioned.every((x) => x.status === "booked");
      chip = allBooked ? `<span class="chip ok">Booked</span>` : `<span class="chip dim">Marked</span>`;
      sub = actioned.map((d) => `${esc(d.short)} — ${d.status === "off" ? "day off" : "booked"}`).join(" · ");
      actions = `<button class="ghost sm tr-foot" id="btn-tr-undo-all" ${trDis}>Undo</button>`;
    } else {
      chip = `<span class="chip dim">All clear</span>`;
      sub = tp.unmarkedWeek.length
        ? `Nothing due today — ${tp.unmarkedWeek.length} day${tp.unmarkedWeek.length > 1 ? "s" : ""} ahead still unmarked. Tap a day to mark it.`
        : "The whole week ahead is marked.";
    }

    /* 7-day strip mirrors how far ahead the site lets you book —
       tap a day to cycle booked → off → clear */
    const strip = `
      <div class="tr-week">
        ${tp.week.map((d) => {
          const st = d.status === "booked" ? "ok" : d.status === "off" ? "off"
            : d.status === "missed" || d.windowGone ? "bad" : d.bookToday ? "next" : "";
          const inner = d.status === "booked" ? icon("check", 18, 3) : d.status === "off" ? icon("x", 18, 3)
            : d.status === "missed" ? icon("alert", 18, 3) : `<span>${d.dd}</span>`;
          return `<button class="tr-day" data-tr-cycle="${esc(d.date)}" ${trDis}>
            <span class="trd-dot ${st}">${inner}</span>
            <span>${esc(d.dow)}</span>
          </button>`;
        }).join("")}
      </div>`;

    transportCard = `<div class="card transport">
      <div class="tr-head">${icon("bus", 16)}<span class="kicker">Office transport</span><span style="margin-left:auto">${chip}</span>
        <a class="tr-site" id="btn-tr-open" href="${esc(tp.site)}" target="_blank" rel="noopener" title="Open booking site" aria-label="Open booking site">${icon("ext", 16)}</a></div>
      <p class="tr-line${loud ? "" : " quiet"}">${sub}</p>
      ${strip}
      ${actions}
    </div>`;
  }

  /* greeting + today's progress ring */
  const hr = now.getHours();
  const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const total = allTasks.length, doneN = allTasks.filter((t) => t.done).length;
  const pct = total ? Math.round((doneN / total) * 100) : 0;
  const mood = m.tasks === null ? "No daily note yet — tap + to start today."
    : total === 0 ? "A clear day. Add something when you're ready."
    : doneN === total ? "All done — nice work."
    : pct >= 50 ? "You're on track. Keep going." : "Let's get moving.";

  const studyPct = m.study && m.study.total ? Math.round((m.study.done / m.study.total) * 100) : 0;
  const idRows = m.indrive ? m.indrive.rows.length : 0;

  return `
  <div class="hero">
    <div class="hero-main">
      <div class="hero-kicker">${esc(weekday)}</div>
      <div class="hero-date">${esc(dateStr)}</div>
      <div class="hero-greet">${greet}, Mehdi</div>
      <div class="hero-sub">${esc(mood)}${state.busy ? " · saving…" : ""}</div>
    </div>
    <div class="ring ring-sm" style="width:84px;height:84px">
      ${ringSvg(84, 9, pct)}
      <div class="ring-label"><span class="display">${doneN}/${total}</span><small>TASKS</small></div>
    </div>
  </div>

  ${transportCard}

  <div class="card list">
    <h2>Tasks ${total ? `<span class="h-extra">${doneN} / ${total}</span>` : ""}</h2>
    ${tasksHtml}
  </div>

  <button class="fill-tile" id="btn-gym-open" data-acc="gym" title="Open Gym">
    ${icon("dumbbell", 28)}
    <span class="ft-main">
      <span class="ft-kicker">${rot.doneToday ? `Gym · done today · next ${rot.next}` : `Gym · next · workout ${rot.next}`}</span>
      <span class="ft-title">${esc(GYM_INFO[rot.doneToday || rot.next].title)}</span>
    </span>
    ${icon("chevr", 22)}
  </button>

  <div class="duo">
    ${m.study ? `
    <button class="card duo-tile" id="btn-study-open" data-acc="read" title="Open the study plan">
      <span class="duo-head">${icon("book", 16)}<span>Cloud study</span></span>
      <span class="duo-val">${m.study.done}<small>/${m.study.total}</small></span>
      <span class="bar thin"><span style="width:${studyPct}%"></span></span>
      <span class="duo-sub">${studyPct}% · ${esc(m.study.title)}</span>
    </button>` : ""}
    <button class="card duo-tile" id="btn-indrive-open" data-acc="indrive" title="Open inDrive">
      <span class="duo-head">${icon("car", 16)}<span>inDrive net</span></span>
      <span class="duo-val">${m.indrive ? fmt0(m.indrive.totalNet) : "—"}</span>
      <span class="duo-sub">MAD · ${idRows ? `${idRows} day${idRows === 1 ? "" : "s"} logged` : "no entries yet"}</span>
    </button>
  </div>`;
}

/* ---------- Clients ---------- */

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

function clientBadge(c, kind) {
  return kind === "active"
    ? [cval(c.App), planLabel(cval(c.Plan))].filter(Boolean).join(" · ")
    : cval(c.App);
}

function clientCard(c, kind, key) {
  const [cls, label] = statusChip(c.Status);

  /* status chips only as exceptions — ✅ Active / 🔴 Churned are the tab's norm */
  const isNorm = kind === "active" ? (c.Status || "").includes("✅")
    : kind === "churned" ? true : false;
  const chip = isNorm ? "" : `<span class="chip sm ${cls}">${esc(plainStatus(label))}</span>`;
  const badgeTxt = clientBadge(c, kind);
  const badge = badgeTxt ? `<span class="pill">${esc(badgeTxt)}</span>` : "";

  let right = "", bar = "";
  if (kind === "active") {
    const d = c.days;
    const tone = d === null ? "dim" : d <= 7 ? "bad" : d <= 30 ? "warn" : "ok";
    right = `<div class="cc-days t-${tone}">${d === null ? "—" : Math.abs(d)}</div>
      <div class="cc-unit t-${tone}">${d === null ? "NO DATE" : d < 0 ? "DAYS AGO" : "DAYS LEFT"}</div>`;
    const total = planDays(c.Plan);
    if (total && d !== null) {
      const used = Math.min(100, Math.max(2, (1 - d / total) * 100));
      bar = `<div class="bar hair"><div class="t-${tone}" style="width:${used.toFixed(0)}%"></div></div>`;
    }
  } else if (kind === "churned") {
    right = `<div class="cc-date">${esc(cval(c.Date))}</div>`;
  }

  return `
  <button class="client-card" data-client="${esc(key)}">
    <div class="cc-main">
      <div class="cc-name">${esc(cval(c.Name) || "—")}</div>
      <div class="cc-sub">${esc(cval(c.Phone) || "—")}</div>
      ${badge || chip ? `<div class="cc-tags">${badge}${chip}</div>` : ""}
      ${bar}
    </div>
    ${right ? `<div class="cc-right">${right}</div>` : ""}
  </button>`;
}

/* bottom sheet with the full client record — fields are tap-to-copy */
function clientSheetHtml(c, kind) {
  const [cls, label] = statusChip(c.Status);
  const phone = (c.Phone || "").replace(/[^+\d]/g, "");
  const hasLogin = !!cval(c.Username) && (!!cval(c.DNS) || !!cval(c.Password));
  const badgeTxt = clientBadge(c, kind);
  const meta = (badgeTxt ? `<span class="pill">${esc(badgeTxt)}</span>` : "")
    + (kind === "active" ? expiryChip(c.days) : `<span class="chip ${cls}">${esc(plainStatus(label))}</span>`);
  return `
  <div class="sheet client-sheet">
    <div class="cs-head">
      <div>
        <div class="cs-name">${esc(cval(c.Name) || "—")}</div>
        <div class="cs-meta">${meta}</div>
      </div>
      <button class="cs-close" id="cs-close" aria-label="Close">${icon("x", 22)}</button>
    </div>
    <div class="cs-fields">
      ${cdField("Phone", c.Phone, true)}
      ${cdField("App", c.App)}
      ${kind !== "churned" ? cdField("Expiry", c.Expiry) : ""}
      ${kind === "active" ? cdField("Plan", [planLabel(cval(c.Plan)), cval(c.Price)].filter(Boolean).join(" · ")) : ""}
      ${cdField("DNS", c.DNS, true)}
      ${cdField("Username", c.Username, true)}
      ${cdField("Password", c.Password, true)}
      ${cdField("MAC", c["MAC Address"], true)}
      ${kind === "churned" ? cdField("Date", c.Date) : ""}
      ${kind === "churned" ? cdField("Reason", c.Reason) : ""}
      ${kind === "leads" ? cdField("Trial", c["Trial Start"]) : ""}
      ${cdField("Notes", c.Notes)}
    </div>
    ${phone || hasLogin ? `<div class="btn-row">
      ${phone ? `<a class="btn secondary lg" href="tel:${phone}">Call${icon("phone", 16)}</a>` : ""}
      ${hasLogin ? `<button class="btn ink lg" data-login="${b64encode(buildLoginMsg(c))}">Copy login${icon("copy", 16)}</button>` : ""}
    </div>` : ""}
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
  const close = el.querySelector("#cs-close");
  if (close) close.onclick = () => { state.openClient = null; render(); };
  el.querySelectorAll(".cd-row[data-copy]").forEach((r) => {
    r.onclick = () => copySwap(r.querySelector(".cd-ic"), 16, r.dataset.copy);
  });
  el.querySelectorAll("[data-login]").forEach((b) => {
    b.onclick = () => {
      copyToClipboard(b64decode(b.dataset.login)).then((ok) => {
        if (!ok) return;
        const orig = b.innerHTML;
        b.innerHTML = `Copied${icon("check", 16)}`;
        setTimeout(() => { if (document.body.contains(b)) b.innerHTML = orig; }, 1300);
      });
    };
  });
}

function scriptsCard(m) {
  const open = state.scriptsOpen;
  return `
  <div class="card scripts${open ? " open" : ""}">
    <button class="card-head" id="scripts-toggle" aria-expanded="${open}">
      <span class="kicker">DM scripts · ${m.scripts.length}</span>
      <span class="caret">${icon("chevd", 18)}</span>
    </button>
    ${open ? m.scripts.map((s, i) => `
      <button class="script-row" data-script="${i}">
        <div class="r-main">
          <div class="r-title">${esc(s.name)}</div>
          <div class="script-preview">${esc(s.text)}</div>
        </div>
        <span class="script-copy">${icon("copy", 16)}</span>
      </button>`).join("") : ""}
  </div>`;
}

/* where the back link on a drilled-in screen returns to */
const subBackLabel = () => (state.subFrom === "settings" || !state.subFrom ? "Settings" : state.subFrom === "today" ? "Today" : "Back");

function renderClients(m) {
  const tab = state.clientTab;
  const sorted = clientsSorted(m, tab);
  return `
  ${backLink("btn-sub-back", subBackLabel())}
  <div class="seg">
    <button data-ctab="active" class="${tab === "active" ? "active" : ""}">Active (${m.active.length})</button>
    <button data-ctab="leads" class="${tab === "leads" ? "active" : ""}">Leads (${m.leads.length})</button>
    <button data-ctab="churned" class="${tab === "churned" ? "active" : ""}">Churned (${m.churned.length})</button>
  </div>
  ${sorted.length
    ? `<div class="client-list">${sorted.map((c, i) => clientCard(c, tab, `${tab}:${i}`)).join("")}</div>`
    : `<div class="empty">Nothing here</div>`}

  ${m.scripts.length ? scriptsCard(m) : ""}`;
}

/* ---------- inDrive ---------- */

function renderIndrive(m) {
  const d = m.indrive || { price: 15, consumption: 6.5, rows: [], totalNet: 0, totalGross: 0, totalKm: 0 };
  const n = d.rows.length;

  const totalsCard = `
    <div class="hero-fill">
      <div class="id-brand">${icon("car", 20)}inDrive</div>
      <div class="hf-kicker id-kicker">Total net (MAD)</div>
      <div class="display id-net">${fmt0(d.totalNet)}</div>
      <div class="hf-stats two hf-rule">
        <div><div class="hf-kicker">Total km</div><b class="display">${fmt0(d.totalKm)}</b></div>
        <div><div class="hf-kicker">Total gross</div><b class="display">${fmt0(d.totalGross)}</b></div>
      </div>
    </div>`;

  const logCard = `
    <div class="card list">
      <h2>Log · ${n} day${n === 1 ? "" : "s"}</h2>
      ${n ? `
      <div class="ilog">
        <div class="ilog-row head"><span>Date</span><span>Km</span><span>Gross</span><span>Diesel</span><span>Net</span></div>
        ${d.rows.map((r) => `
        <div class="ilog-row" data-indrive-edit="${esc(r.date)}">
          <span>${esc(shortDate(r.date))}</span><span>${fmt0(r.km)}</span><span>${fmt0(r.gross)}</span><span class="dz">${fmt0(r.diesel)}</span><b>${fmt0(r.net)}</b>
        </div>`).join("")}
      </div>` : `<div class="empty">Nothing logged yet — tap + to add a day</div>`}
    </div>`;

  return backLink("btn-sub-back", subBackLabel()) + totalsCard + logCard;
}

/* ---------- Gym ---------- */

function renderGym(m) {
  const g = m.gym || { bodyweights: [], sessions: [], lastBodyweight: null };
  const rot = gymRotation(m);
  const { nextGym } = gymPlanToday(m);
  const shown = rot.doneToday || (nextGym ? nextGym.w : rot.next);
  const info = GYM_INFO[shown];
  const nextW = nextGym ? nextGym.w : rot.next;

  /* weight-loss goal progress (100kg → 85kg), driven by the Bodyweight log
     that's already tracked here — no separate goal-entry UI needed */
  const cur = g.lastBodyweight ? g.lastBodyweight.weight : GYM_GOAL.startKg;
  const span = GYM_GOAL.startKg - GYM_GOAL.targetKg;
  const goalPct = Math.max(0, Math.min(100, ((GYM_GOAL.startKg - cur) / span) * 100));
  const lostKg = g.lastBodyweight ? Math.round((GYM_GOAL.startKg - cur) * 10) / 10 : 0;

  const heroCard = `
    <div class="hero-fill">
      <div class="hf-kicker">${rot.doneToday ? `Done today · Workout ${shown}`
        : nextGym && nextGym.today ? `Today · Workout ${shown}`
        : `Next up · Workout ${shown}${nextGym ? ` · ${nextGym.dow}` : ""}`}</div>
      <div class="display gym-title">${esc(info.title)}</div>
      <div class="gym-sub">${rot.doneToday
        ? `Next: ${nextGym ? `${nextGym.dow} · ` : ""}Workout ${nextW} — ${esc(GYM_INFO[nextW].title)}`
        : `${esc(GYM_SESSION)} · ${GYM_WORKOUTS[shown].length} exercises · warm-up ${esc(info.warmup)}`}</div>
      <div class="hf-rule gym-goal"><b>${GYM_GOAL.startKg} kg → ${GYM_GOAL.targetKg} kg</b><span>${lostKg > 0 ? `${lostKg} kg lost` : "no weigh-in yet"}</span></div>
      <div class="hf-bar gym"><div style="width:${goalPct}%"></div></div>
      <div class="gym-now">${cur} kg now · ${goalPct.toFixed(0)}% to goal</div>
      <button class="btn on-fill" id="btn-gym-plan">View full plan${icon("ext", 16)}</button>
    </div>`;

  /* the planned week: suggestions from the rotation, days you pinned, what you logged */
  const wk = weekSchedule(m, state.gymWeek || 0);
  const short = { A: "Push", B: "Pull", C: "Legs" };
  const dayLabel = (x) => x.kind === "done" ? "Done" : x.kind === "gym" ? short[x.w]
    : x.kind === "football" ? "Match" : x.kind === "skipped" ? "Skipped" : "Rest";
  const dayInner = (x) => x.kind === "done" && !GYM_ROTATION.includes(x.w) ? icon("check", 18, 3)
    : x.kind === "done" || x.kind === "gym" ? `<b>${x.w}</b>`
    : x.kind === "football" ? icon("ball", 18) : x.kind === "skipped" ? "—" : icon("moon", 16);
  const todayX = wk.offset === 0 ? wk.days.find((x) => x.today) : null;
  const nextLine = nextGym && !nextGym.today ? ` · next: ${nextGym.dow} · ${nextGym.w} ${esc(GYM_INFO[nextGym.w].title)}` : "";
  const nGym = wk.days.filter((x) => x.kind === "gym" || x.kind === "done").length;
  const summary = !todayX ? `${nGym} gym session${nGym === 1 ? "" : "s"} planned`
    : todayX.kind === "done" ? `Today: Workout ${todayX.w} done${nextLine}`
    : todayX.kind === "gym" ? `Today: Workout ${todayX.w} — ${esc(GYM_INFO[todayX.w].title)}`
    : `Today: ${todayX.kind === "football" ? "football" : "rest"}${nextLine}`;
  const weekCard = `
    <div class="card">
      <h2>Week plan
        <span class="wk-toggle"><button data-wk="0" class="${wk.offset === 0 ? "active" : ""}">This week</button><button data-wk="1" class="${wk.offset === 1 ? "active" : ""}">Next</button></span></h2>
      <div class="wk-strip">
        ${wk.days.map((x) => `
          <button class="wk-day ${x.kind}${x.today ? " today" : ""}${x.pinned ? " pinned" : ""}${x.warn || x.moved ? " warn" : ""}"
            data-plan-day="${x.date}" ${x.past ? "disabled" : ""} aria-label="${esc(`${x.dow} ${x.d.getDate()}: ${dayLabel(x)}`)}">
            <span class="wk-dow">${x.dow} ${x.d.getDate()}</span>
            <span class="wk-tile">${dayInner(x)}</span>
            <span class="wk-label">${dayLabel(x)}</span>
          </button>`).join("")}
      </div>
      <p class="wk-summary">${summary}</p>
      ${wk.notes.map((n) => `<p class="wk-note">${esc(n)}</p>`).join("")}
      <div class="split wk-foot"><span>Gym days: ${wk.gymDays.length ? [...wk.gymDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => DOW_SHORT[i]).join(" · ") : "none"}</span>
        <button class="link-btn" id="btn-gym-days">Change</button></div>
      <p class="card-note gw-note">Tap a day to set A, B, C, rest or football. ${esc(GYM_TIPS.football)}</p>
    </div>`;

  const bwCard = `
    <div class="card list">
      <h2>Bodyweight ${g.lastBodyweight ? `<span class="chip fill">${g.lastBodyweight.weight} kg</span>` : ""}</h2>
      <p class="card-note">${g.lastBodyweight ? `Last weighed ${esc(dowDate(g.lastBodyweight.date))}` : "Weigh in 2-3x a week — track the trend, not day-to-day noise. Tap the scale button to log."}</p>
      ${g.bodyweights.length ? g.bodyweights.slice(0, 5).map((b) => `
        <div class="row" data-bw-edit="${esc(b.date)}">
          <div class="r-main">${esc(shortDate(b.date))}${b.notes ? ` · ${esc(b.notes)}` : ""}</div>
          <div class="r-end"><b>${b.weight} kg</b></div>
        </div>`).join("") : ""}
    </div>`;

  const sessionsCard = `
    <div class="card list">
      <h2>Workout log</h2>
      ${g.sessions.length ? g.sessions.slice(0, 8).map((s) => `
        <div class="log-entry" data-gym-edit="${esc(s.date)}|${esc(s.workout)}">
          <div class="split"><span>${GYM_ROTATION.includes(s.workout) ? `${s.workout} · ` : ""}${esc(WORKOUT_LABELS[s.workout] || s.workout)}</span><span>${esc(dowDate(s.date))}</span></div>
          <div class="r-sub">${s.exercises.map((e) => {
            const parts = [e.weight != null ? String(e.weight) : "", e.reps ? esc(e.reps) : ""].filter(Boolean);
            return `${esc(e.exercise)}${parts.length ? " " + parts.join("×") : ""}`;
          }).join(" · ")}</div>
        </div>`).join("") : `<div class="empty">Nothing logged yet — tap + to log a session</div>`}
    </div>`;

  const workoutRef = (w) => `
    <div class="card list">
      <h2 class="acc">${w} · ${esc(GYM_INFO[w].title)} <span class="h-hint">Hold for how-to</span></h2>
      <p class="card-note">${esc(GYM_INFO[w].focus)} · warm-up ${esc(GYM_INFO[w].warmup)}</p>
      ${GYM_WORKOUTS[w].map((e, i) => `
        <div class="row ex-row" data-gym-how="${w}:${i}">
          <span class="ex-n">${pad2(i + 1)}</span>
          <div class="r-main"><div class="r-title">${esc(e.name)}</div>${e.alt ? `<div class="r-sub">or ${esc(e.alt)}</div>` : ""}</div>
          <div class="r-end">${esc(e.target)}</div>
        </div>`).join("")}
    </div>`;

  const tipList = (items) => items.map((t, i) => `<div><span>${pad2(i + 1)}</span>${esc(t)}</div>`).join("");
  const tipsCard = `
    <div class="card">
      <h2>Progressive overload</h2>
      <div class="tips">${tipList(GYM_TIPS.overload)}</div>
      <h2 class="tips-h">Key tips</h2>
      <div class="tips">${tipList(GYM_TIPS.key)}</div>
    </div>`;

  /* the session to do (or done) first, then the rest of the rotation in order */
  const i0 = GYM_ROTATION.indexOf(shown);
  const order = [0, 1, 2].map((k) => GYM_ROTATION[(i0 + k) % 3]);
  return heroCard + weekCard + healthCard() + workoutRef(order[0]) + sessionsCard + bwCard
    + workoutRef(order[1]) + workoutRef(order[2]) + tipsCard;
}

/* ---------- Finances ---------- */

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

/* debt avatars take a section hue, picked from the name so they stay stable */
const AVATAR_HUES = ["#ff8a3d", "#a98bff", "#5b9bff", "#3ddc84", "#ff5c7c", "#a7e92f"];

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
  const msPos = (v) => Math.min(100, (v / target) * 100);
  const markers = milestones.map((v) => `<span class="ms-mark${msPos(v) >= 100 ? " end" : ""}" style="left:${msPos(v)}%" title="${v.toLocaleString()} MAD"></span>`).join("");
  const msLabels = milestones.map((v) => msPos(v) >= 100
    ? `<span class="end">${fmtK(v)}</span>`
    : `<span style="left:${msPos(v)}%">${fmtK(v)}</span>`).join("");

  const dlDate = s.deadline ? Date.parse(String(s.deadline).split("(")[0].trim()) : NaN;
  const daysLeft = isNaN(dlDate) ? null : Math.max(0, Math.ceil((dlDate - Date.now()) / 86400000));
  const deadlineTxt = s.deadline ? String(s.deadline).split("(")[0].trim() : "";

  const goalCard = `
  <div class="hero-fill">
    <div class="goal-top">
      <div>
        <div class="hf-kicker">Goal${deadlineTxt ? ` · by ${esc(deadlineTxt)}` : ""}</div>
        <div class="display goal-amt">${s.target ? s.target.toLocaleString("en-US") : "—"}</div>
        <div class="goal-unit">MAD</div>
      </div>
      <div class="ring goal-ring" style="width:76px;height:76px">
        ${ringSvg(76, 9, pct)}
        <div class="ring-label">${Math.round(pct)}%</div>
      </div>
    </div>
    <div class="ms-wrap"><div class="hf-bar"><div style="width:${pct}%"></div></div>${markers}</div>
    <div class="ms-labels">${msLabels}</div>
    <div class="hf-stats hf-rule">
      <div><div class="hf-kicker">Saved</div><b>${s.current ? s.current.toLocaleString("en-US") : "—"}</b></div>
      <div><div class="hf-kicker">Remaining</div><b>${remaining > 0 ? remaining.toLocaleString("en-US") : "Reached"}</b></div>
      ${daysLeft !== null ? `<div><div class="hf-kicker">Days left</div><b>${daysLeft}</b></div>` : ""}
    </div>
  </div>`;

  /* ---- this month ---- */
  const salaryDays = daysUntilSalary(s.salaryDay || 28);
  const salaryOn = new Date(); salaryOn.setDate(salaryOn.getDate() + salaryDays);
  const reviewDone = !!(m.review && m.review.thisMonth && !state.reviewEdit);
  const monthCard = `
  <div class="card">
    <h2>This month <span class="h-hint">${nowM} ${nowY}</span></h2>
    <div class="month-pair">
      <div>
        <div class="big-num">${salaryDays === 0 ? "Today" : salaryDays}</div>
        <div class="big-sub">${salaryDays === 0 ? "salary day" : `days to salary · ${esc(salaryOn.toLocaleDateString("en-US", { month: "short", day: "numeric" }))}`}</div>
      </div>
      <div>
        <div class="big-num">${s.rate === null || s.rate === undefined ? "—" : `${s.rate.toFixed(0)}<small>%</small>`}</div>
        <div class="big-sub">savings rate</div>
      </div>
    </div>
    ${s.monthSaved > 0 ? `<div class="split month-saved"><span>Saved this month</span><b>+${s.monthSaved.toLocaleString("en-US")} MAD</b></div>` : ""}
    ${reviewDone ? `<button class="btn outline" id="btn-review-again" ${state.busy ? "disabled" : ""}>Update balance${icon("refresh", 16)}</button>` : ""}
  </div>`;

  /* ---- balance update (form + latest entry) ---- */
  let balanceCard = "";
  if (m.review) {
    const r = m.review;
    const done = r.thisMonth && !state.reviewEdit;
    const dis = state.busy ? "disabled" : "";
    if (!done) {
      balanceCard = `
      <div class="card">
        <h2>Update balance</h2>
        <p class="form-note">Log your current savings balance — it updates the goal and the tracker.</p>
        <div class="form-stack">
          <div><label class="flabel" for="rv-balance">Savings balance · MAD</label>
            <input type="number" inputmode="decimal" id="rv-balance" placeholder="${s.current ? fmtNum(s.current) : "0"}" value=""></div>
          <div><label class="flabel" for="rv-notes">Notes · optional</label>
            <input type="text" id="rv-notes" placeholder="Anything worth remembering…"></div>
          <div class="btn-row">
            ${r.thisMonth ? `<button class="btn secondary" id="btn-review-cancel">Cancel</button>` : ""}
            <button class="btn" id="btn-review-save" ${dis}>Save balance</button>
          </div>
        </div>
      </div>`;
    }
  }

  /* ---- monthly tracker (compact, future months behind a toggle) ---- */
  const trackerRows = (s.tracker || []).map((r) => {
    const vals = Object.values(r).map((v) => v.replace(/\*/g, ""));
    const month = (vals[0] || "").replace(/←.*$/, "").trim();
    const saved = num(vals[3]);
    const total = num(vals[4]);
    const isCurrent = (vals[0] || "").includes(nowM) && (vals[0] || "").includes(nowY);
    const isActual = saved !== null;
    const isProj = !isActual && !isCurrent;
    const pctTxt = isActual && total !== null ? Math.round((total / target) * 100) + "%" : "—";
    return {
      isProj,
      html: `<div class="trk-row${isProj ? " proj" : ""}">
        <span class="box${isActual ? " on" : ""}">${isActual ? icon("check", 14, 3) : ""}</span>
        <span class="trk-month">${esc(month)}</span>
        <span>${isActual ? `+${saved.toLocaleString("en-US")}` : isCurrent ? "in progress" : "—"}</span>
        <span class="trk-pct">${pctTxt}</span>
      </div>`,
    };
  });

  const trackerCard = trackerRows.length ? (() => {
    const visible = trackerRows.filter((r) => !r.isProj);
    const proj = trackerRows.filter((r) => r.isProj);
    const toggleBtn = proj.length
      ? `<button class="ghost" id="btn-tracker-toggle">${state.trackerExpanded ? "Show less" : `+ ${proj.length} more month${proj.length === 1 ? "" : "s"}`}</button>`
      : "";
    return `<div class="card list">
      <h2>Monthly tracker</h2>
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
      <div class="form-stack">
        <div><label class="flabel" for="db-name">Person</label>
          <input type="text" id="db-name" placeholder="Who owes you" value="${editing ? esc(ex.name) : ""}" ${editing ? "readonly" : ""}></div>
        <div><label class="flabel" for="db-amount">Amount · MAD</label>
          <input type="number" inputmode="decimal" id="db-amount" placeholder="0" value="${ex && ex.amount != null ? ex.amount : ""}"></div>
        <div><label class="flabel">Status</label>
          <div class="seg acc">
            ${DEBT_STATUS.map((o) => `<button type="button" data-debt-status="${o.key}" class="${basePick === o.key ? "active" : ""}">${o.key}</button>`).join("")}
          </div></div>
        <div><label class="flabel" for="db-extra">Status detail · optional, e.g. ~Jul 2026</label>
          <input type="text" id="db-extra" placeholder="timeline or note" value="${editing ? esc(ps.extra) : ""}"></div>
        <div class="btn-row">
          <button class="btn secondary" id="btn-debt-cancel">Cancel</button>
          <button class="btn" id="btn-debt-save" ${dbusy}>${editing ? "Save changes" : "Add debt"}</button>
        </div>
      </div>
      ${editing ? `<button class="ghost" id="btn-debt-paid" ${dbusy}>${icon("check", 16)}Mark paid</button>
                   <button class="ghost danger" id="btn-debt-remove" ${dbusy}>${icon("trash", 16)}Remove debt</button>` : ""}`;
  } else {
    debtBody = `
      ${m.debts.map((d) => {
        const [cls, label] = statusChip(d.status);
        const hue = AVATAR_HUES[[...d.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % AVATAR_HUES.length];
        const ini = d.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
        return `<div class="row debt-row" data-debt-edit="${esc(d.name)}">
          <span class="avatar" style="background:${hue}">${esc(ini)}</span>
          <div class="r-main"><div class="r-title">${esc(d.name)}</div><span class="chip sm ${cls}">${esc(plainStatus(label))}</span></div>
          <div class="debt-amt">${d.amount ? d.amount.toLocaleString("en-US") : "—"}<small>MAD</small></div>
        </div>`;
      }).join("") || `<div class="empty">No debts tracked</div>`}
      ${m.debtTotal ? `<div class="split debt-total"><span>Total outstanding</span><b>${m.debtTotal.toLocaleString("en-US")} MAD</b></div>` : ""}`;
  }
  const debtCard = `
  <div class="card">
    <h2>${state.debtEdit === "__new__" ? "Add debt" : state.debtEdit ? "Edit debt" : "Debts owed to you"}
      ${state.debtEdit ? "" : `<button class="link-btn" id="btn-debt-add">+ Add</button>`}</h2>
    ${debtBody}
  </div>`;

  return goalCard + monthCard + balanceCard + trackerCard + debtCard;
}

/* ---------- Habits ---------- */

const habitIcon = (n) => /sugar/i.test(n) ? "lock" : /water|drink/i.test(n) ? "droplet" : /walk|step/i.test(n) ? "activity"
  : /cloud|study/i.test(n) ? "cloud" : /read|book/i.test(n) ? "book" : "flame";

function renderHabits(m) {
  if (!m.habits) {
    return `<div class="card"><div class="empty">No habit log synced yet — pull to refresh, or check that HabitLog.md exists in the vault</div></div>`;
  }
  const total = m.habits.length;
  const done = m.habits.filter((h) => h.doneToday).length;
  const dis = state.busy ? "disabled" : "";
  const editing = state.habitsEdit;
  const best = m.habits.reduce((mx, h) => Math.max(mx, h.streak || 0), 0);

  const ringMsg = done === total ? "All done. Ring closed." : `${total - done} more to close the ring.`;
  const ringCard = total ? `
  <div class="habit-hero">
    <div class="ring" style="width:${HABIT_RING_SIZE}px;height:${HABIT_RING_SIZE}px">
      <svg width="${HABIT_RING_SIZE}" height="${HABIT_RING_SIZE}" viewBox="0 0 ${HABIT_RING_SIZE} ${HABIT_RING_SIZE}">
        <circle class="ring-track" cx="${HABIT_RING_SIZE / 2}" cy="${HABIT_RING_SIZE / 2}" r="${HABIT_RING_R}" stroke-width="${HABIT_RING_STROKE}"/>
        <circle class="ring-fill" id="habit-ring" cx="${HABIT_RING_SIZE / 2}" cy="${HABIT_RING_SIZE / 2}" r="${HABIT_RING_R}" stroke-width="${HABIT_RING_STROKE}"
          stroke-dasharray="${HABIT_RING_C}" stroke-dashoffset="${habitRingOffset(done, total)}"/>
      </svg>
      <div class="ring-label"><span class="display">${done}<small>/${total}</small></span><small>TODAY</small></div>
    </div>
    <div>
      <div class="habit-hero-msg">${ringMsg}</div>
      <div class="habit-hero-sub">${best > 0 ? `Best streak ${best} day${best === 1 ? "" : "s"}` : "Start a streak today"}</div>
    </div>
  </div>` : "";

  const habitRows = m.habits.map((h, i) => {
    const pop = state.habitPop === h.name && h.doneToday;
    return `
    <div class="habit-wrap${editing ? " editing" : ""}">
      ${editing ? `<button class="habit-del" data-del-habit="${esc(h.name)}" aria-label="Remove ${esc(h.name)}">${icon("trash", 18)}</button>` : ""}
      <button class="hcard ${h.doneToday ? "done" : ""}" data-habit="${i}" ${dis}>
        <span class="box${pop ? " pop" : ""}">${h.doneToday ? icon("check", 20, 3) : ""}</span>
        <span class="hinfo">
          <span class="hname">${icon(habitIcon(h.name), 14)}<span>${esc(h.name)}</span></span>
          <span class="hstreak">${h.streak > 0 ? `${h.streak} day streak` : "no streak yet"}</span>
        </span>
        <span class="heatmap">${h.history.map((d, j) =>
          `<span class="hm-cell${d ? " on" : ""}${j === 13 ? " today" : ""}${pop && j === 13 ? " pop" : ""}"></span>`).join("")}</span>
      </button>
    </div>`;
  }).join("");

  return `
  ${ringCard}
  <div class="card list">
    <h2>
      <span>Habits · 14-day history${state.busy ? " · saving…" : ""}</span>
      ${total > 0 ? `<button class="link-btn" id="btn-habits-edit">${editing ? "Done" : "Edit"}</button>` : ""}
    </h2>
    ${total === 0 ? `<div class="empty">No habits yet — tap + to add one</div>` : ""}
    ${habitRows}
  </div>`;
}

/* ---------- Library ---------- */

function renderArticles(m) {
  if (state.article) {
    const a = m.articles.find((x) => x.path === state.article);
    if (a) {
      const meta = [a.author, `${a.minutes} min read`, a.created].filter(Boolean).join(" · ");
      const kicker = (a.tags || []).slice(0, 2).join(" · ");
      return `
      ${backLink("btn-art-back", state.articleReturn === "today" ? "Today" : "Library")}
      <article class="article">
        ${kicker ? `<div class="art-kicker">${esc(kicker)}</div>` : ""}
        <h1>${esc(a.title)}</h1>
        <div class="art-meta muted">${esc(meta)}</div>
        ${mdToHtml(a.body.replace(/^#\s+.+\n/, ""))}
      </article>
      <button class="art-float-back" id="btn-art-float-back" aria-label="Back to articles">${icon("back", 22)}</button>`;
    }
    state.article = null;
  }
  if (!m.articles.length) return `<div class="empty">No research articles in the vault yet</div>`;

  const q = state.articleQuery.trim().toLowerCase();
  const tagCounts = {};
  m.articles.forEach((a) => (a.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const topTags = Object.keys(tagCounts).sort((x, y) => tagCounts[y] - tagCounts[x]).slice(0, 8);
  if (state.articleTag && !topTags.includes(state.articleTag)) state.articleTag = "";
  const matches = m.articles.filter((a) =>
    (!state.articleTag || (a.tags || []).includes(state.articleTag)) &&
    (!q || [a.title, a.excerpt, a.topic, a.author, a.body, (a.tags || []).join(" ")].some((f) => (f || "").toLowerCase().includes(q))));

  const search = `
    <div class="search-bar">
      ${icon("search", 18)}
      <input type="search" id="art-search" placeholder="Search ${m.articles.length} note${m.articles.length === 1 ? "" : "s"}" value="${esc(state.articleQuery)}" autocomplete="off">
      ${q ? `<button class="search-clear" id="art-search-clear" aria-label="Clear search">${icon("x", 16)}</button>` : ""}
    </div>
    ${topTags.length ? `<div class="chip-scroll">
      <button class="fchip ${state.articleTag ? "" : "active"}" data-art-tag="">All</button>
      ${topTags.map((t) => `<button class="fchip ${state.articleTag === t ? "active" : ""}" data-art-tag="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>` : ""}`;

  const list = matches.length
    ? `<div class="art-list">${matches.map((a, i) => {
        const meta = [a.author, `${a.minutes} min read`, a.created].filter(Boolean).join(" · ");
        return `
      <button class="art-card" data-article="${esc(a.path)}">
        <span class="art-thumb${i % 2 ? " ink" : ""}">${esc((a.title.trim()[0] || "•").toUpperCase())}</span>
        <span class="art-body">
          <span class="art-title">${esc(a.title)}</span>
          <span class="art-meta">${esc(meta)}</span>
          ${(a.tags || []).length ? `<span class="art-tags">${a.tags.slice(0, 2).map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</span>` : ""}
        </span>
      </button>`;
      }).join("")}</div>`
    : `<div class="empty">No articles match${q ? ` "${esc(state.articleQuery)}"` : ""}</div>`;

  return search + list;
}

/* in-app reader for the cloud study plan — reuses the article styling + floating back */
function renderStudyDoc() {
  const md = state.files.studyplan;
  if (!md) {
    return `${backLink("btn-study-back", "Today")}
      <div class="empty">Study plan not synced yet — pull to refresh.</div>`;
  }
  return `
    ${backLink("btn-study-back", "Today")}
    <article class="article">
      ${mdToHtml(stripFrontmatter(md))}
    </article>
    <button class="art-float-back" id="btn-study-float-back" aria-label="Back">${icon("back", 22)}</button>`;
}

/* ---------- reminders (native Android notifications) ---------- */

const HAS_NOTIF = typeof window.KernelNative !== "undefined" && typeof window.KernelNative.getReminders === "function";
const REMINDER_ROWS = [
  ["tasks", "Tasks", "Daily · only if something is left"],
  ["habits", "Habits", "Daily · only if not all ticked"],
  ["transport", "Transport", "Mon–Fri · unbooked ride + last call"],
];
function getReminders() { try { return JSON.parse(window.KernelNative.getReminders()); } catch { return {}; } }
function saveReminders() {
  const out = {};
  REMINDER_ROWS.forEach(([k]) => {
    const on = document.querySelector(`[data-rem-on="${k}"]`), t = document.querySelector(`[data-rem-time="${k}"]`);
    if (on && t) out[k] = { on: on.checked, time: t.value || "09:00" };
  });
  window.KernelNative.setReminders(JSON.stringify(out));
  if (Object.values(out).some((r) => r.on) && !window.KernelNative.notificationsEnabled()) window.KernelNative.requestNotifications();
}
window.__kernelNotif = () => { if (state.view === "settings") render(); };

function remindersCard() {
  if (!HAS_NOTIF) return "";
  const cfg = getReminders();
  const blocked = Object.values(cfg).some((r) => r.on) && !window.KernelNative.notificationsEnabled();
  return `
  <div class="card list">
    <div class="set-head">${icon("bell", 18)}<span class="kicker">Reminders</span></div>
    ${REMINDER_ROWS.map(([k, title, sub]) => {
      const r = cfg[k] || { on: false, time: "09:00" };
      return `<div class="rem-row">
        <div class="rem-main"><b>${title}</b><span>${sub}</span></div>
        <input type="time" class="rem-time" data-rem-time="${k}" value="${esc(r.time)}" aria-label="${title} reminder time">
        <label class="switch"><input type="checkbox" data-rem-on="${k}" ${r.on ? "checked" : ""} aria-label="${title} reminder"><span></span></label>
      </div>`;
    }).join("")}
    ${blocked ? `<p class="set-note warn">Notifications are blocked for Kernel — allow them in Android Settings → Apps → Kernel → Notifications.</p>` : ""}
    <button class="ghost" id="btn-rem-test">Send a test notification</button>
  </div>`;
}

/* ---------- Settings ---------- */

function renderSettings() {
  const pref = getThemePref();
  const tok = getToken();
  return `
  ${backLink("btn-settings-back", "Back")}
  <h1 class="page-title">Settings</h1>

  <div class="card">
    <div class="set-head">${icon("lock", 18)}<span class="kicker">GitHub token</span>
      <span class="set-status" style="color:var(${tok ? "--ok" : "--wn"})">${tok ? "CONNECTED" : "NOT SET"}</span></div>
    <div class="set-line">${tok ? `••••••••${esc(tok.slice(-4))}` : "No token"} · ${OWNER}/${REPO}</div>
    <div class="set-inline">
      <input type="password" id="inp-token" placeholder="${tok ? "Paste new token" : "github_pat_…"}" aria-label="GitHub token">
      <button class="btn" id="btn-save-token">Save</button>
    </div>
    <p class="set-note">Needs Contents: Read &amp; write on the vault repo only.</p>
  </div>

  <div class="card">
    <div class="set-head">${icon("refresh", 18)}<span class="kicker">Sync</span></div>
    <div class="set-row"><span>Last synced ${state.lastSync ? timeAgo(state.lastSync) : "never"}</span><button class="link-btn lg" id="btn-sync-now">Sync now</button></div>
    <div class="set-row"><span>Clear cache</span><button class="link-btn lg" id="btn-clear-cache">Clear</button></div>
  </div>

  ${remindersCard()}

  <div class="card">
    <div class="kicker">Theme</div>
    <div class="seg">
      <button data-theme-pref="auto" class="${pref === "auto" ? "active" : ""}">Auto</button>
      <button data-theme-pref="dark" class="${pref === "dark" ? "active" : ""}">Dark</button>
      <button data-theme-pref="light" class="${pref === "light" ? "active" : ""}">Light</button>
    </div>
  </div>

  <div class="card nav-card">
    <button class="nav-row" id="btn-open-indrive">${icon("car", 18)}<span>inDrive</span>${icon("chevr", 18)}</button>
    <button class="nav-row" id="btn-open-clients">${icon("phone", 18)}<span>Clients</span>${icon("chevr", 18)}</button>
  </div>

  <div class="set-footer">Kernel ${esc(APP_VERSION)} · Data moves only between this phone and your GitHub repo.</div>

  <button class="btn danger-outline" id="btn-logout">${icon("trash", 18)}Forget token &amp; data</button>`;
}

function renderSetup() {
  $("#view").innerHTML = `
  <div class="setup">
    <div class="setup-logo"></div>
    <div class="setup-title">Kernel</div>
    <div class="setup-tag">Your life. In sync.</div>
    <div class="setup-steps">
      <div><b>1</b><span>On GitHub, go to Settings → Developer settings and create a fine-grained token.</span></div>
      <div><b>2</b><span>Give it access to <code>${OWNER}/${REPO}</code> only, with Contents: Read &amp; write.</span></div>
      <div><b>3</b><span>Paste it below. It never leaves this phone.</span></div>
    </div>
    <input type="password" id="inp-token" placeholder="github_pat_…" aria-label="GitHub token">
    <button class="btn xl" id="btn-save-token">Connect${icon("chevr", 20)}</button>
  </div>`;
  $("#btn-save-token").onclick = () => {
    const v = $("#inp-token").value.trim();
    if (!v) return;
    setToken(v);
    syncAll();
  };
}

/* which section accent a view wears, and which views drop the top bar / tab bar */
const VIEW_ACC = { today: "today", habits: "habits", money: "money", gym: "gym", articles: "read", indrive: "indrive", clients: "neutral", settings: "neutral" };
const OFF_BAR = ["settings", "indrive", "clients"];

function setChrome(acc, noBar, noTabs) {
  document.body.dataset.acc = acc;
  document.body.classList.toggle("no-bar", noBar);
  document.body.classList.toggle("no-tabs", noTabs);
}

function render() {
  setSyncStatus();
  applyTheme();
  if (!getToken()) {
    $("#fab").classList.add("hidden"); $("#fab-secondary").classList.add("hidden");
    setChrome("today", true, true);
    renderSetup(); return;
  }

  const m = buildModel();
  const v = state.view;
  let html = state.error
    ? `<div class="banner err"><span class="b-ico">${icon("alert", 16)}</span><div class="b-txt"><b>Sync error</b><span>${esc(state.error)}</span></div><button class="b-btn" id="btn-banner-retry">Retry</button></div>`
    : "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    html += `<div class="banner off"><span class="b-ico">${icon("cloud", 16)}</span><div class="b-txt"><span>You're offline. Changes will sync later.</span></div></div>`;
  }
  if (state.studyDoc) html += renderStudyDoc();
  else if (!state.files.clients && !state.error) html += `<div class="empty">Loading vault…</div>`;
  else html += v === "today" ? renderToday(m)
    : v === "clients" ? renderClients(m)
    : v === "indrive" ? renderIndrive(m)
    : v === "money" ? renderMoney(m)
    : v === "articles" ? renderArticles(m)
    : v === "habits" ? renderHabits(m)
    : v === "gym" ? renderGym(m)
    : renderSettings();
  $("#view").innerHTML = html;
  const retryBtn = $("#btn-banner-retry");
  if (retryBtn) retryBtn.onclick = () => syncAll();
  $("#view").dataset.tab = state.studyDoc ? "study" : v;
  const reading = state.studyDoc || (v === "articles" && !!state.article);
  setChrome(state.studyDoc ? "read" : VIEW_ACC[v] || "today", reading || OFF_BAR.includes(v), OFF_BAR.includes(v));

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
  $("#fab").classList.toggle("hidden", state.studyDoc || (v !== "today" && v !== "habits" && v !== "indrive" && v !== "gym"));
  $("#fab").dataset.tab = v;
  $("#fab").disabled = state.busy;

  /* smaller secondary FAB (log weight) sits above the main one, gym tab only */
  $("#fab-secondary").classList.toggle("hidden", state.studyDoc || v !== "gym");
  $("#fab-secondary").dataset.tab = v;
  $("#fab-secondary").disabled = state.busy;

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
    const gymOpen = $("#btn-gym-open");
    if (gymOpen) gymOpen.onclick = () => goToTab("gym");
    const moreT = $("#btn-tasks-more");
    if (moreT) moreT.onclick = () => { state.tasksAll = !state.tasksAll; render(); };

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
        const ring = $("#habit-ring");
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
      b.onclick = async () => {
        const name = b.dataset.delHabit;
        if (await confirmBox("Remove habit?", `"${name}" leaves the list. Past log entries are kept.`)) removeHabit(name);
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
    if (debtRemove) debtRemove.onclick = async () => {
      const name = state.debtEdit;
      const d = m.debts.find((x) => x.name === name);
      const amt = d && d.amount ? ` · ${d.amount.toLocaleString("en-US")} MAD` : "";
      if (!(await confirmBox("Remove debt?", `${name}${amt} leaves the tracker. The detail section stays as history.`))) return;
      removeDebt(name);
    };
  }
  const subBack = $("#btn-sub-back");
  if (subBack) subBack.onclick = () => goToTab(state.subFrom || "settings");
  if (v === "indrive") {
    document.querySelectorAll("[data-indrive-edit]").forEach((el) => {
      el.onclick = () => openIndriveSheet(el.dataset.indriveEdit);
    });
  }
  if (v === "gym") {
    document.querySelectorAll("[data-gym-edit]").forEach((el) => {
      el.onclick = () => openGymSheet(el.dataset.gymEdit);
    });
    document.querySelectorAll("[data-gym-how]").forEach((el) => {
      const [letter, i] = el.dataset.gymHow.split(":");
      bindLongPress(el, () => { bounceIcon(el); openHowTo(letter, Number(i)); });
    });
    document.querySelectorAll("[data-bw-edit]").forEach((el) => {
      el.onclick = () => openBwSheet(el.dataset.bwEdit);
    });
    document.querySelectorAll("[data-plan-day]").forEach((b) => { b.onclick = () => openPlanDay(b.dataset.planDay); });
    document.querySelectorAll("[data-wk]").forEach((b) => { b.onclick = () => { state.gymWeek = Number(b.dataset.wk); render(); }; });
    const gd = $("#btn-gym-days");
    if (gd) gd.onclick = openGymDays;
    const planOpen = $("#btn-gym-plan");
    if (planOpen) planOpen.onclick = openPlanImage;
    const hs = $("#btn-health-sync");
    if (hs) hs.onclick = healthSyncNow;
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
    document.querySelectorAll("[data-art-tag]").forEach((b) => { b.onclick = () => { state.articleTag = b.dataset.artTag; render(); }; });
    const clr = $("#art-search-clear");
    if (clr) clr.onclick = () => { state.articleQuery = ""; render(); const s = $("#art-search"); if (s) s.focus(); };
  }
  if (v === "settings") {
    $("#btn-settings-back").onclick = () => goToTab(state.settingsFrom || "today");
    $("#btn-open-indrive").onclick = () => goToTab("indrive");
    document.querySelectorAll("[data-rem-on],[data-rem-time]").forEach((el) => { el.onchange = () => { saveReminders(); render(); }; });
    const remTest = $("#btn-rem-test");
    if (remTest) remTest.onclick = () => { if (!window.KernelNative.notificationsEnabled()) window.KernelNative.requestNotifications(); window.KernelNative.testNotification(); };
    $("#btn-open-clients").onclick = () => goToTab("clients");
    document.querySelectorAll("[data-theme-pref]").forEach((b) => {
      b.onclick = () => setThemePref(b.dataset.themePref);
    });
    $("#btn-save-token").onclick = () => {
      const t = $("#inp-token").value.trim();
      if (t) { setToken(t); syncAll(); }
    };
    $("#btn-sync-now").onclick = () => syncAll();
    $("#btn-clear-cache").onclick = () => { localStorage.removeItem(LS_CACHE); state.files = {}; state.lastSync = null; syncAll(); };
    $("#btn-logout").onclick = async () => {
      if (!(await confirmBox("Forget token and data?", "The token and every cached file are wiped from this phone. Your vault on GitHub is untouched.", "Forget"))) return;
      localStorage.clear(); state.files = {}; state.lastSync = null; render();
    };
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

/* ---------- confirm popup (replaces the browser's confirm()) ---------- */

let _confirmResolve = null;
function confirmBox(title, body, okLabel = "Remove") {
  if (_confirmResolve) _confirmResolve(false);
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm-ok").textContent = okLabel;
  $("#confirm-sheet").classList.remove("hidden");
  return new Promise((resolve) => { _confirmResolve = resolve; });
}
function closeConfirm(result) {
  $("#confirm-sheet").classList.add("hidden");
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(result);
}

/* ---------- task composer ---------- */

function updateComposerCount() {
  const n = $("#composer-text").value.split("\n").filter((l) => l.trim()).length;
  $("#composer-add").textContent = n > 1 ? `Add ${n} tasks` : "Add";
}
function openComposer() {
  if (state.busy) return;
  $("#composer").classList.remove("hidden");
  buildComposerArticles();
  updateComposerCount();
  $("#composer-text").focus();
}
function closeComposer() {
  $("#composer").classList.add("hidden");
  $("#composer-text").value = "";
  const box = $("#composer-articles");
  if (box) box.classList.add("hidden");
}

/* "/" in the composer opens a live article picker — picking one replaces the "/query" with a [[wikilink]] */
function composerSlashQuery(ta) {
  const pos = ta.selectionStart ?? ta.value.length;
  const m = ta.value.slice(0, pos).match(/(^|\s)\/([^\s/]*)$/);
  return m ? { q: m[2].toLowerCase(), start: pos - m[2].length - 1, end: pos } : null;
}
function updateComposerSlash() {
  const box = $("#composer-articles"), ta = $("#composer-text");
  if (!box || !ta) return;
  const sl = composerSlashQuery(ta);
  if (!sl) { box.classList.add("hidden"); return; }
  const arts = (buildModel().articles || []).filter((a) => !sl.q || a.title.toLowerCase().includes(sl.q) || a.name.toLowerCase().includes(sl.q)).slice(0, 6);
  box.innerHTML = `<div class="slash-head">Articles${sl.q ? ` · "${esc(sl.q)}"` : ""}</div>` + (arts.length
    ? arts.map((a) => `<button type="button" class="slash-item" data-insert="[[${esc(a.name.replace(/\.md$/, ""))}|${esc(a.title)}]]">${esc(a.title)}</button>`).join("")
    : `<div class="slash-empty">No articles match.</div>`);
  box.classList.remove("hidden");
}
function buildComposerArticles() { const box = $("#composer-articles"); if (box) box.classList.add("hidden"); }

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
  $("#habit-count").textContent = `${$("#habit-name").value.length}/60`;
  $("#habit-modal").classList.remove("hidden");
  $("#habit-name").focus();
}
function closeHabitModal() {
  $("#habit-modal").classList.add("hidden");
  $("#habit-name").value = "";
  $("#habit-count").textContent = "0/60";
}

/* ---------- inDrive add/edit sheet ---------- */

function openIndriveSheet(editDate) {
  if (state.busy) return;
  state.indriveEditDate = editDate || null;
  const editing = !!editDate;
  const d = (buildModel().indrive) || { price: 15, consumption: 6.5, rows: [] };
  const ex = editing ? d.rows.find((r) => r.date === editDate) : null;
  $("#id-sheet-title").textContent = editing ? "Edit entry" : "Add entry";
  $("#id-date-label").textContent = editing ? "Date · locked" : "Date";
  $("#id-date").value = ex ? ex.date : todayIso();
  $("#id-date").readOnly = editing;
  $("#id-km").value = ex ? ex.km : "";
  $("#id-gross").value = ex ? ex.gross : "";
  $("#id-notes").value = ex ? ex.notes : "";
  const calc = () => {
    const km = parseFloat($("#id-km").value) || 0, gross = parseFloat($("#id-gross").value) || 0;
    const diesel = Math.round((km / 100) * d.consumption * d.price * 100) / 100;
    const net = Math.round((gross - diesel) * 100) / 100;
    $("#id-sheet-hint").innerHTML = `<div class="split"><span>Diesel</span><b>${diesel.toLocaleString("en-US")} MAD</b></div>
      <div class="split calc-net"><span>Net</span><span>${net.toLocaleString("en-US")} MAD</span></div>
      <div class="calc-note">${d.consumption} L/100 km · ${d.price} MAD/L</div>`;
  };
  $("#id-km").oninput = calc; $("#id-gross").oninput = calc;
  calc();
  $("#btn-indrive-save").textContent = editing ? "Save changes" : "Add entry";
  $("#btn-indrive-remove").innerHTML = `${icon("trash", 16)}Remove entry`;
  $("#btn-indrive-remove").classList.toggle("hidden", !editing);
  $("#indrive-sheet").classList.remove("hidden");
  $("#id-km").focus();
}
function closeIndriveSheet() {
  $("#indrive-sheet").classList.add("hidden");
  state.indriveEditDate = null;
}

/* ---------- gym workout sheet ---------- */

function buildGymExerciseRows(letter, prefill) {
  const box = $("#gym-exercise-rows");
  if (!box) return;
  box.innerHTML = workoutExercises(letter).map((e) => {
    const p = prefill ? prefill.find((x) => x.exercise === e.name) : null;
    return `
    <div class="gym-grid gym-ex-row" data-gym-ex="${esc(e.name)}">
      <div class="gym-ex-name"><b>${esc(e.name)}</b><span>${esc(e.target)}</span></div>
      <input type="number" inputmode="decimal" class="gym-ex-weight" placeholder="kg" aria-label="${esc(e.name)} kg" value="${p && p.weight != null ? esc(String(p.weight)) : ""}">
      <input type="text" inputmode="numeric" class="gym-ex-reps" placeholder="reps" aria-label="${esc(e.name)} reps" value="${p ? esc(p.reps) : ""}">
    </div>`;
  }).join("");
}

function pickGymWorkout(letter, prefill) {
  state.gymWorkoutPick = letter;
  document.querySelectorAll("#gym-workout-pick [data-gym-pick]").forEach((b) => {
    b.classList.toggle("active", b.dataset.gymPick === letter);
  });
  buildGymExerciseRows(letter, prefill);
}

function openGymSheet(editKey) {
  if (state.busy) return;
  state.gymEditKey = editKey || null;
  const editing = !!editKey;
  /* a new session defaults to the next workout in the rotation (or the one already logged today) */
  const model = buildModel();
  const rot = gymRotation(model);
  const planned = gymPlanToday(model).today;
  let date = todayIso(), letter = rot.doneToday || (planned && planned.kind === "gym" ? planned.w : rot.next), prefill = null;
  if (editing) {
    const [d, w] = editKey.split("|");
    date = d; letter = w;
    const m = buildModel();
    const session = m.gym && m.gym.sessions.find((s) => s.date === d && s.workout === w);
    prefill = session ? session.exercises : null;
  }
  $("#gym-sheet-title").textContent = editing ? "Edit session" : "Log workout";
  $("#gym-date").value = date;
  $("#gym-date").readOnly = editing;
  $("#btn-gym-save").textContent = editing ? "Save changes" : "Save session";
  $("#btn-gym-remove").innerHTML = `${icon("trash", 16)}Remove session`;
  $("#btn-gym-remove").classList.toggle("hidden", !editing);
  pickGymWorkout(letter, prefill);
  $("#gym-sheet").classList.remove("hidden");
}
function closeGymSheet() {
  $("#gym-sheet").classList.add("hidden");
  state.gymEditKey = null;
  state.gymWorkoutPick = null;
}

/* ---------- gym "how to" popup (long-press an exercise) ---------- */

function openHowTo(letter, i) {
  const e = GYM_WORKOUTS[letter] && GYM_WORKOUTS[letter][i];
  if (!e) return;
  $("#howto-num").textContent = pad2(i + 1);
  $("#howto-title").textContent = e.name;
  const rows = (cues) => cues.map((t, n) => `<div><b>${n + 1}</b><span>${esc(t)}</span></div>`).join("");
  $("#howto-body").innerHTML = rows(e.cues || ["No form notes for this one yet."])
    + (e.alt && e.altCues ? `<div class="howto-alt"><span>Or: ${esc(e.alt)}</span></div>${rows(e.altCues)}` : "");
  $("#howto-sheet").classList.remove("hidden");
}
function closeHowTo() {
  $("#howto-sheet").classList.add("hidden");
}

/* ---------- plan lightbox — the A/B/C rotation drawn from GYM_WORKOUTS, tap anywhere to close ---------- */

function openPlanImage() {
  const rot = gymRotation(buildModel());
  const sub = (w) => GYM_WORKOUTS[w].map((e) => e.name.replace(/ \(Cable\)$/, "")).slice(0, 3).join(" · ") + ` · +${GYM_WORKOUTS[w].length - 3}`;
  $("#plan-lightbox").innerHTML = `
    <div class="plan-inner">
      <div class="sheet-kicker" style="margin-bottom:0">Skinny fat recomposition · ${GYM_GOAL.startKg} → ${GYM_GOAL.targetKg} kg</div>
      ${GYM_ROTATION.map((w) => `
        <div class="plan-row${w === rot.next ? " today" : ""}">
          <span class="plan-day">${w}</span>
          <div class="pr-main"><b>${esc(GYM_INFO[w].title)}</b><span>${esc(sub(w))}</span></div>
          ${icon(w === rot.doneToday ? "check" : "dumbbell", 22)}
        </div>`).join("")}
      <div class="plan-facts">
        <div><b>Session</b>${esc(GYM_SESSION)} · A → B → C → A …</div>
        <div><b>Football</b>${esc(GYM_TIPS.football)}</div>
      </div>
      <div class="plan-foot">Tap anywhere to close ·<button type="button" id="btn-plan-img">Original plan</button></div>
      <img class="plan-img hidden" id="plan-img" src="assets/gym-plan.webp" alt="Skinny fat recomposition program: workouts A, B and C">
    </div>`;
  $("#btn-plan-img").onclick = (e) => {
    e.stopPropagation();
    $("#plan-img").classList.remove("hidden");
    $("#plan-img").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#plan-lightbox").classList.remove("hidden");
}
function closePlanImage() {
  $("#plan-lightbox").classList.add("hidden");
}

/* ---------- week plan: pick a day's session, and the usual gym days ---------- */

function openPlanDay(date) {
  if (state.busy) return;
  const m = buildModel();
  const all = [...weekSchedule(m, 0).days, ...weekSchedule(m, 1).days];
  const x = all.find((d) => d.date === date);
  if (!x || x.past) return;
  const pin = ((m.gym && m.gym.weekPlan) || {})[date] || null;
  /* what the planner would put here without a pin: clear the pin and recompute */
  const unpinned = { ...m, gym: { ...m.gym, weekPlan: { ...((m.gym && m.gym.weekPlan) || {}) } } };
  delete unpinned.gym.weekPlan[date];
  const sug = [...weekSchedule(unpinned, 0).days, ...weekSchedule(unpinned, 1).days].find((d) => d.date === date);
  const sugText = sug.kind === "gym" ? `${sug.w} · ${GYM_INFO[sug.w].title}` : sug.kind === "football" ? "Football" : "Rest";
  const plan = (m.gym && m.gym.weekPlan) || {};
  const addDays = (n) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); return isoOf(d); };
  const before = plan[addDays(1)] === "Football", afterMatch = plan[addDays(-1)] === "Football";
  $("#plan-day-title").textContent = x.d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const warn = $("#plan-day-warn");
  warn.textContent = before ? "Football the next day — the plan says A or B here, not C."
    : afterMatch ? "Football the day before — the plan says A or B here, not C." : "";
  warn.classList.toggle("hidden", !before && !afterMatch);
  const opt = (val, title, sub, ic) => `<button type="button" class="plan-opt${(pin || "auto") === val ? " active" : ""}" data-plan-set="${val}">
      <span class="po-ic">${ic}</span><span class="po-main"><b>${title}</b><span>${sub}</span></span></button>`;
  $("#plan-day-opts").innerHTML =
    opt("auto", "Suggested", esc(sugText), icon("refresh", 18))
    + GYM_ROTATION.map((w) => opt(w, `${w} · ${esc(GYM_INFO[w].title)}`, w === "C" && (before || afterMatch) ? "Not advised next to football" : esc(GYM_INFO[w].focus.split(" — ")[0]), `<b>${w}</b>`)).join("")
    + opt("Rest", "Rest", "No gym this day", icon("moon", 18))
    + opt("Football", "Football", "Match or training — C stays away from it", icon("ball", 18));
  $("#plan-day-opts").onclick = (e) => {
    const b = e.target.closest("[data-plan-set]");
    if (!b) return;
    closePlanDay();
    setWeekPlan(date, b.dataset.planSet === "auto" ? null : b.dataset.planSet);
  };
  $("#plan-day-sheet").classList.remove("hidden");
}
function closePlanDay() { $("#plan-day-sheet").classList.add("hidden"); }

function openGymDays() {
  if (state.busy) return;
  const m = buildModel();
  const sel = new Set((m.gym && m.gym.gymDays) || GYM_DEFAULT_DAYS);
  const box = $("#gym-days-chips");
  box.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((i) => `<button type="button" class="fchip${sel.has(i) ? " active" : ""}" data-gd="${i}">${DOW_SHORT[i]}</button>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("[data-gd]");
    if (b) b.classList.toggle("active");
  };
  $("#gym-days-sheet").classList.remove("hidden");
}
function closeGymDays() { $("#gym-days-sheet").classList.add("hidden"); }

/* ---------- bodyweight sheet ---------- */

function openBwSheet(editDate) {
  if (state.busy) return;
  state.bwEdit = editDate || null;
  const editing = !!editDate;
  const m = buildModel();
  const ex = editing && m.gym ? m.gym.bodyweights.find((b) => b.date === editDate) : null;
  $("#bw-sheet-title").textContent = editing ? "Edit weigh-in" : "Log bodyweight";
  $("#bw-date").value = ex ? ex.date : todayIso();
  $("#bw-date").readOnly = editing;
  $("#bw-weight").value = ex ? String(ex.weight) : "";
  $("#bw-notes").value = ex ? ex.notes : "";
  $("#btn-bw-save").textContent = editing ? "Save changes" : "Save";
  $("#btn-bw-remove").innerHTML = `${icon("trash", 16)}Remove weigh-in`;
  $("#btn-bw-remove").classList.toggle("hidden", !editing);
  $("#bw-sheet").classList.remove("hidden");
  $("#bw-weight").focus();
}
function closeBwSheet() {
  $("#bw-sheet").classList.add("hidden");
  state.bwEdit = null;
}

/* ---------- boot ---------- */

/* switch tabs from anywhere (tab bar, or a shortcut tile like the inDrive stat) */
function goToTab(view) {
  /* remember where drilled-in screens were opened from, for their back links */
  if (view === "settings" && !OFF_BAR.includes(state.view)) state.settingsFrom = state.view;
  if ((view === "indrive" || view === "clients") && state.view !== view) state.subFrom = state.view;
  state.view = view;
  state.article = null;
  state.articleReturn = null;
  state.habitsEdit = false;
  state.taskEdit = null;
  state.studyDoc = false;
  closeIndriveSheet();
  closeGymSheet();
  closeHowTo();
  closeBwSheet();
  closePlanImage();
  closePlanDay();
  closeGymDays();
  closeConfirm(false);
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
$("#btn-settings").innerHTML = icon("sliders", 20);
$("#btn-settings").onclick = () => {
  bounceIcon($("#btn-settings"));
  goToTab("settings");
};
$("#btn-theme").onclick = () => {
  setThemePref(effectiveTheme() === "light" ? "dark" : "light");
};

$("#fab").innerHTML = icon("plus", 30, 3);
$("#fab").onclick = () => {
  bounceIcon($("#fab"));
  if (state.view === "habits") return openHabitModal();
  if (state.view === "indrive") return openIndriveSheet(null);
  if (state.view === "gym") return openGymSheet(null);
  return openComposer();
};
$("#fab-secondary").innerHTML = icon("scale", 22);
$("#fab-secondary").onclick = () => {
  bounceIcon($("#fab-secondary"));
  if (state.view === "gym") openBwSheet(null);
};
$("#composer-cancel").onclick = closeComposer;
$("#composer").onclick = (e) => { if (e.target.id === "composer") closeComposer(); };
$("#composer-text").addEventListener("input", updateComposerSlash);
$("#composer-text").addEventListener("input", updateComposerCount);
$("#composer-text").addEventListener("keyup", updateComposerSlash);
$("#composer-articles").onclick = (e) => {
  const chip = e.target.closest("[data-insert]");
  if (chip) {
    const ta = $("#composer-text"), sl = composerSlashQuery(ta);
    if (sl) {
      ta.value = ta.value.slice(0, sl.start) + chip.dataset.insert + " " + ta.value.slice(sl.end);
      const pos = sl.start + chip.dataset.insert.length + 1;
      ta.focus(); ta.setSelectionRange(pos, pos);
    } else insertAtCursor(ta, chip.dataset.insert);
    $("#composer-articles").classList.add("hidden");
  }
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
$("#habit-name").oninput = () => { $("#habit-count").textContent = `${$("#habit-name").value.length}/60`; };
$("#habit-name").onkeydown = (e) => {
  if (e.key === "Enter") $("#habit-add").click();
  if (e.key === "Escape") closeHabitModal();
};
$("#indrive-sheet").onclick = (e) => { if (e.target.id === "indrive-sheet") closeIndriveSheet(); };
$("#btn-indrive-cancel").onclick = closeIndriveSheet;
$("#btn-indrive-save").onclick = () => {
  const date = ($("#id-date").value || "").trim();
  const km = num($("#id-km").value);
  const gross = num($("#id-gross").value);
  const notes = ($("#id-notes").value || "").trim();
  if (!date) { state.error = "Pick a date."; return render(); }
  if (km == null) { state.error = "Enter km driven."; return render(); }
  if (gross == null) { state.error = "Enter gross earned."; return render(); }
  setIndriveEntry(date, km, gross, notes);
  closeIndriveSheet();
  render();
};
$("#btn-indrive-remove").onclick = async () => {
  const date = state.indriveEditDate;
  if (!date || !(await confirmBox("Remove entry?", `The ${shortDate(date)} inDrive entry is deleted. This can't be undone.`))) return;
  removeIndriveEntry(date);
  closeIndriveSheet();
  render();
};

$("#gym-sheet").onclick = (e) => { if (e.target.id === "gym-sheet") closeGymSheet(); };
$("#btn-gym-cancel").onclick = closeGymSheet;
document.querySelectorAll("#gym-workout-pick [data-gym-pick]").forEach((b) => {
  b.onclick = () => {
    if (state.gymEditKey) return; // workout choice is locked while editing an existing session
    pickGymWorkout(b.dataset.gymPick, null);
  };
});
$("#btn-gym-save").onclick = () => {
  const date = ($("#gym-date").value || "").trim();
  const workout = state.gymWorkoutPick;
  if (!date) { state.error = "Pick a date."; return render(); }
  if (!workout) { state.error = "Pick workout A, B or C."; return render(); }
  const entries = [...document.querySelectorAll(".gym-ex-row")].map((row) => ({
    exercise: row.dataset.gymEx,
    weight: num(row.querySelector(".gym-ex-weight").value),
    reps: row.querySelector(".gym-ex-reps").value.trim(),
  })).filter((e) => e.weight !== null || e.reps !== "");
  if (!entries.length) { state.error = "Log at least one exercise."; return render(); }
  setGymSession(date, workout, entries);
  closeGymSheet();
  render();
};
$("#btn-gym-remove").onclick = async () => {
  if (!state.gymEditKey) return;
  const [d, w] = state.gymEditKey.split("|");
  if (!(await confirmBox("Remove session?", `The ${dowDate(d)} ${WORKOUT_LABELS[w] || w} session is deleted. This can't be undone.`))) return;
  removeGymSession(d, w);
  closeGymSheet();
  render();
};

$("#howto-sheet").onclick = (e) => { if (e.target.id === "howto-sheet") closeHowTo(); };
$("#btn-howto-close").onclick = closeHowTo;

$("#plan-lightbox").onclick = closePlanImage;

$("#plan-day-sheet").onclick = (e) => { if (e.target.id === "plan-day-sheet") closePlanDay(); };
$("#plan-day-cancel").onclick = closePlanDay;
$("#gym-days-sheet").onclick = (e) => { if (e.target.id === "gym-days-sheet") closeGymDays(); };
$("#gym-days-cancel").onclick = closeGymDays;
$("#gym-days-save").onclick = () => {
  const days = [...document.querySelectorAll("#gym-days-chips .active")].map((b) => Number(b.dataset.gd));
  closeGymDays();
  setGymDays(days);
};
$("#confirm-sheet").onclick = (e) => { if (e.target.id === "confirm-sheet") closeConfirm(false); };
$("#confirm-cancel").onclick = () => closeConfirm(false);
$("#confirm-ok").onclick = () => closeConfirm(true);

$("#bw-sheet").onclick = (e) => { if (e.target.id === "bw-sheet") closeBwSheet(); };
$("#btn-bw-cancel").onclick = closeBwSheet;
$("#btn-bw-save").onclick = () => {
  const date = ($("#bw-date").value || "").trim();
  const weight = num($("#bw-weight").value);
  const notes = ($("#bw-notes").value || "").trim();
  if (!date) { state.error = "Pick a date."; return render(); }
  if (weight == null) { state.error = "Enter your weight."; return render(); }
  setBodyweight(date, weight, notes);
  closeBwSheet();
  render();
};
$("#btn-bw-remove").onclick = async () => {
  const date = state.bwEdit;
  if (!date || !(await confirmBox("Remove weigh-in?", `The ${shortDate(date)} weigh-in is deleted. This can't be undone.`))) return;
  removeBodyweight(date);
  closeBwSheet();
  render();
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

window.addEventListener("online", () => { syncAll(); });
window.addEventListener("offline", () => { render(); });

/* backgrounding, switching tabs, or refreshing kills any in-flight setTimeout
   debounce outright — fire pending saves now (with keepalive: true on the
   fetch calls) so the edit actually reaches GitHub instead of vanishing.
   visibilitychange fires reliably on mobile (unlike beforeunload); pagehide
   as a second net for desktop tab-close/navigation. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAllPending();
});
window.addEventListener("pagehide", () => flushAllPending());

/* Android Back: step back one level inside the app. Returns true when handled; false lets the
   system leave the app (only from Today with nothing open). Called by MainActivity. */
window.kernelBack = function () {
  const open = (id) => !$(id).classList.contains("hidden");
  const sheets = [["#confirm-sheet", () => closeConfirm(false)], ["#plan-lightbox", closePlanImage],
    ["#howto-sheet", closeHowTo], ["#composer", closeComposer], ["#habit-modal", closeHabitModal],
    ["#indrive-sheet", closeIndriveSheet], ["#gym-sheet", closeGymSheet], ["#bw-sheet", closeBwSheet],
    ["#plan-day-sheet", closePlanDay], ["#gym-days-sheet", closeGymDays]];
  for (const [id, close] of sheets) if (open(id)) { close(); return true; }
  if (!getToken()) return false;
  if (state.openClient) { state.openClient = null; render(); return true; }
  if (state.taskEdit !== null) { state.taskEdit = null; render(); return true; }
  if (state.debtEdit) { state.debtEdit = null; state.debtStatusPick = null; render(); return true; }
  if (state.habitsEdit) { state.habitsEdit = false; render(); return true; }
  if (state.studyDoc) { state.studyDoc = false; showBars(); render(); scrollTo(0, 0); return true; }
  if (state.view === "articles" && state.article) { $("#btn-art-back").click(); return true; }
  if (state.view === "settings") { goToTab(state.settingsFrom || "today"); return true; }
  if (state.view === "indrive" || state.view === "clients") { goToTab(state.subFrom || "settings"); return true; }
  if (state.view !== "today") { goToTab("today"); return true; }
  return false;
};

/* Web build: route the browser / installed-PWA Back button through kernelBack too. One extra
   history entry sits on top; each Back pops it, steps back in the app and re-pushes it. When
   kernelBack has nothing left to do, Back really leaves. (The Android build handles Back natively.) */
if (!window.KernelNative) {
  history.replaceState({ kernel: "root" }, "");
  history.pushState({ kernel: "app" }, "");
  addEventListener("popstate", () => {
    if (window.kernelBack()) history.pushState({ kernel: "app" }, "");
    else history.back();
  });
}

applyTheme();
loadCache();
render();
/* first paint done — let the native splash fade out */
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
  if (window.KernelNative && typeof window.KernelNative.appReady === "function") window.KernelNative.appReady();
});
if (getToken()) syncAll();
