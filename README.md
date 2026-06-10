# Kernel

A personal dashboard PWA over a private Obsidian vault hosted on GitHub.

This repo contains **only static app code — no data**. At runtime the app fetches
markdown files from a private repository via the GitHub Contents API, using a
fine-grained personal access token (read-only, single repo) that the user pastes
once and that never leaves the device (`localStorage`). Parsed data is cached
locally for offline use.

## Features

- Today: daily tasks (toggle, add, remove — committed back to the vault),
  today's schedule (read from a JSON file a GitHub Action keeps fresh in the
  vault repo), study progress, client summary, savings bar
- Clients, Money, and Articles (research notes rendered as a reader) views
- Auto-hiding top/bottom bars on scroll

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
