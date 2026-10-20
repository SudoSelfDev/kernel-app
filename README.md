# Kernel

A personal dashboard **PWA** for a private Obsidian vault hosted on GitHub.

The vault stays private; this repo holds **only the static app — zero data**. At runtime the app reads markdown straight from the private vault via the GitHub Contents API, using a fine-grained token the user pastes once and that never leaves the device. Everything is parsed and rendered in the browser, then cached locally for offline use.

---

## Features

- **Today**: a daily task list (add, complete, edit, remove; changes are committed back to the vault), a transport-booking card with a quiet link to the booking site, and progress tiles for study and side income.
- **Habits**: daily check-offs with a 7-day strip and streak counters. Habits can be added and removed in-app.
- **Finances**: goal progress with milestones, a monthly tracker and editable debts.
- **Gym**: an A → B → C workout rotation, a week planner (suggested days you can override), per-exercise logging, a bodyweight log, and press-and-hold exercise pictures.
- **Library**: a clean reader for your notes, with live full-text search.
- **Off-bar screens**: a client directory (cards with tap-to-copy fields), a driving-income log and settings.
- **Nice touches**: confetti, dark / light / auto themes, a per-tab accent colour, and centered add dialogs.
- **Offline-first**: the last synced data is cached on the device, and the app installs to the home screen.

The same web code also ships inside a native Android app (a WebView shell with home-screen widgets and reminders), kept in a separate repository. The two copies are kept byte-identical.

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
- **Automation.** Scheduled GitHub Actions in the vault repo create each day's note and send push reminders (via ntfy.sh). No server required.

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
- Every change bumps one version number in three places: `WEB_VERSION` in `app.js`, the `?v=` asset links in `index.html`, and the cache name in `sw.js`
- Hosted on GitHub Pages
