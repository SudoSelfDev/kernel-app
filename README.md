# Kernel

A personal dashboard PWA that reads a private Obsidian vault hosted on GitHub.

The vault repo stays private and untouched — this repo contains **only static app code, zero data**. At runtime, the app fetches markdown files directly from the vault via the GitHub Contents API using a fine-grained PAT that the user pastes once and that never leaves the device.

---

## Features

### Today
- **Hero header** with the current date and open task count
- **Savings coach card** — shows how much is left to save this month to hit the monthly target, with overall goal progress
- **Tasks** — toggle done/undone, add new tasks, remove tasks; all changes committed back to the vault's daily note
- **Schedule** — today's calendar events from a JSON file kept fresh by a GitHub Action in the vault repo
- **Study + Renewal tiles** — Phase 1 cloud engineering checklist progress and next client renewal countdown

### Habits
- Per-habit checkbox for today, 7-day dot strip, and streak counter
- **Edit mode** — tap Edit to reveal a × button on each habit; removing a habit drops it from the list but keeps past log data intact
- **Add habit** — floating + button opens a centered popup; new habits appear immediately and are written back to `HabitLog.md`
- All toggles and edits are **debounced** — rapid changes batch into a single GitHub commit rather than one per tap

### Finances
- Savings goal progress bar and current balance
- Ring-fenced emergency fund (read-only display)
- Debts owed tracker
- Monthly progress table — projection rows are faded; actuals (marked ✓ in the vault) are highlighted; current month gets a "now" pill

### Read
- Research notes from the vault rendered as a clean article reader
- Article list with excerpt, topic tag, and estimated read time

### Clients
- Active, Leads, and Churned segments
- Each active client card shows: name, phone, app · plan badge (e.g. "Smarters · 1 Year"), subscription-used progress bar, and days-remaining countdown (color-coded green/amber/red)
- Tap a card for the full detail sheet: all fields are tap-to-copy; **Copy login** puts a ready-to-send credentials block on the clipboard (URL, username, password, derived Samsung/LG DNS, M3U link)
- DM Scripts card with tap-to-copy templates

---

## Architecture

```
kernel-app (this repo, public)       kernel-vault (private)
─────────────────────────────        ──────────────────────
Static PWA on GitHub Pages    ←PAT→  Markdown files (Obsidian)
Vanilla JS, no build step            daily notes, habit log,
Service worker (offline shell)       clients, savings, schedule
localStorage (token + cache)
```

- **Auth:** fine-grained PAT scoped to the vault repo only — stored in `localStorage`, never sent anywhere else
- **Writes:** task toggles, habit toggles, and habit list edits are committed directly to the vault via the Contents API; writes are debounced (2 s) so rapid interactions produce a single commit
- **Schedule:** a GitHub Action in the vault repo pulls the Google Calendar iCal feed every 2 hours and writes `schedule.json`
- **Alerts:** a daily GitHub Action fires ntfy.sh push notifications for renewals expiring in 7 days or today, trial follow-ups, and salary-day savings prompts

---

## Setup

1. **Fine-grained PAT** — GitHub → Settings → Developer settings → Fine-grained tokens
   - Repository access: your vault repo only
   - Permissions → Contents: **Read and write** (write enables task and habit editing; pick Read-only for view-only)
2. Open the app → paste the token → done.

The app is installable as a PWA on iOS and Android.

---

## Privacy

- The PAT and all fetched vault data stay on-device (`localStorage`)
- No analytics, no third-party requests — the only outbound target is `api.github.com`
- This repo is intentionally zero-data: vault paths are base64-encoded so they are not casually readable in the source

---

## Stack

- Vanilla JS (ES2020+), no framework, no build step
- PWA: Web App Manifest + network-first service worker
- Hosted on GitHub Pages
