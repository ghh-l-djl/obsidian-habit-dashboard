# Habit Dashboard

Obsidian community plugin for managing daily events, data logs, task boxes, check-ins, moments, monthly plans, quick links, and a standalone timer from one dashboard. It supports desktop and Obsidian Mobile.

## Commands

```bash
npm test       # Run the Node.js unit suite
npm run build  # Bundle src/main.js and lib/** into root main.js
```

## Source of truth

- `src/main.js` is the source entry point; feature modules live in `lib/` and section renderers in `lib/sections/`.
- Root `main.js` is generated and shipped. Rebuild it after any JavaScript source change and commit the resulting bundle.
- Root `styles.css` is shipped directly and is not part of the JavaScript bundle.
- `manifest.json`, `versions.json`, and `package.json` versions should stay aligned for releases.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css`.

## Architecture guardrails

- Keep Obsidian Vault file operations and event-note/task-note synchronization in `lib/note-manager.js`; renderers should call that module instead of duplicating Vault logic.
- Persisted settings must be normalized in `lib/store.js`, with backward-compatible defaults and unit coverage for new fields.
- Preserve both desktop and mobile behavior. Desktop composition is in `src/main.js`; mobile composition is in `lib/mobile-dashboard.js`.
- Keep user-facing strings in both language blocks in `lib/i18n.js` and cover new paired keys in tests.
- Treat `docs/superpowers/plans/` as historical execution records, not an active backlog. Current behavior is defined by code, tests, and README; specs record design intent and may describe an earlier architecture.

## Documentation

- `README.md` is the user-facing feature, installation, usage, and development guide.
- `publish-process.md` is the release runbook.
- `docs/superpowers/specs/` contains feature design records; `docs/superpowers/plans/` contains historical implementation plans.
- `.impeccable.md` records the persistent UI design context.
