# Kernel

A personal dashboard **PWA** for a private Obsidian vault hosted on GitHub.

The vault stays private; this repo holds **only the static app — zero data**. At runtime the app reads markdown straight from the private vault via the GitHub Contents API, using a fine-grained token the user pastes once and that never leaves the device. Everything is parsed and rendered in the browser, then cached locally for offline use.

---

## Features

- **Today** — a daily view with a task list (add, complete, remove — committed back to the vault) and the day's agenda.
- **Habits** — daily check-offs with a 7-day strip and streak counters; add and remove habits in-app.
- **Finances** — a goal-progress tracker with milestone markers, a monthly tracker, and a weekly review form.
- **Read** — a clean reader for your notes with live full-text search.
- **Directory** — records shown as cards with a tap-to-open detail sheet; fields are tap-to-copy.
- **Add dialogs** — quick centered popups for adding items; new entries appear at the top.
- **Nice touches** — confetti on completion, dark / light / auto themes, color-coded calendar events.
- **Offline-first** — last synced data is cached on the device; installable to the home screen.

## How it works

```
Private vault repo (data)  ──read / write──▶  GitHub Contents API
        ▲                                            │  fine-grained token (on-device)
        │                                            ▼
This repo (public, static app)  ──▶  GitHub Pages  ──▶  PWA
        parses markdown in the browser → renders → caches offline
```

- **Serverless.** No backend, no database — fetch, parse, render, and write-back all happen in the browser.
- **Write-back.** Edits are committed to the vault via the Contents API, debounced so rapid changes produce a single commit.
- **Automation.** Scheduled GitHub Actions in the vault repo keep a calendar feed fresh and send push notifications (via ntfy.sh) — no server required.

## Setup

1. Create a GitHub **fine-grained PAT**: repository access limited to your vault repo; permission **Contents: Read and write** (read-only works for a view-only install).
2. Open the app, paste the token, done. Add to Home Screen for the app feel.

## Privacy

- The token and all fetched data stay on-device (`localStorage`); the only network target is `api.github.com`.
- No analytics, no third-party requests.
- This repo is intentionally data-free.

## Stack

- Vanilla JS (ES2020+), no framework, no build step
- PWA: Web App Manifest + a network-first service worker
- Hosted on GitHub Pages
