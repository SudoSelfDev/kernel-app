# Kernel

A personal dashboard PWA over a private Obsidian vault hosted on GitHub.

This repo contains **only static app code — no data**. At runtime the app fetches
markdown files from a private repository via the GitHub Contents API, using a
fine-grained personal access token (read-only, single repo) that the user pastes
once and that never leaves the device (`localStorage`). Parsed data is cached
locally for offline use.

## Stack

- Vanilla JS, no build step
- PWA: manifest + service worker (installable, offline shell)
- Hosted on GitHub Pages

## Setup

1. Create a fine-grained PAT: repository access limited to the vault repo,
   permission **Contents: Read-only**.
2. Open the app, paste the token, done.

## Privacy

- The token and all fetched data stay on-device.
- No analytics, no third-party calls — the only network target is `api.github.com`.
