# Repository Guidelines

## Project Structure & Module Organization
Coding-Tool is a Node-based CLI whose public entry point is `bin/ct.js`, and `src/index.js` orchestrates menu routing plus command handlers. CLI actions live under `src/commands`, shared helpers sit in `src/utils`, and configuration schemas stay in `src/config`. The Express proxy/websocket backend resides in `src/server` (api, services, proxy-server). The Vue 3 dashboard lives under `src/web` with composables/components/views; install and script inside that folder separately. Docs and marketing assets stay in `docs/`. User-level data lives at `%USERPROFILE%\.claude\cc-tool` and must remain untracked.

## Build, Test, and Development Commands
- `npm start` - runs the CLI exactly as `ct`.
- `npm run dev:server` - nodemon hot-reloads the proxy/REST server on file changes.
- `npm run dev:web` - run inside `src/web` to boot Vite for the dashboard; use `npm install` in that folder first.
- `npm run build:web` - build the Vue bundle into `src/web/dist`, which is then served by the proxy.
- `ct ui`, `ct proxy start|stop|status` - manual verification commands; run them before shipping.

## Coding Style & Naming Conventions
Use 2-space indentation, single quotes, and CommonJS modules in the CLI/server (`require`, `module.exports`). Prefer `const` + `async/await` over callbacks. Vue components stay in PascalCase filenames (`HeaderButton.vue`), composables in `useSomething.ts/js`, and route/view files in TitleCase. Keep command names and scripts in kebab-case. Update CLI chalk strings and Vue locales together whenever wording changes.

## Testing Guidelines
`npm test` is currently a placeholder, so accompany critical changes with targeted scripts or harnesses. Add integration tests for command handlers (e.g., spawn `bin/ct.js` with fixtures) and component tests beside Vue files named `Component.spec.ts`. Manual smoke tests should cover `ct ui`, proxy lifecycle, and multi-channel switching; capture console output in PRs until automated coverage exists.

## Commit & Pull Request Guidelines
Follow the conventional commit style shown in `git log` (`feat: add session log`, `fix: docs`). PRs must describe the motivation, list CLI/Web changes, mention affected configs in `.claude`, and link related issues. Attach before/after screenshots for UI tweaks and include sample command output for CLI changes.

## Security & Configuration Tips
Secrets and API tokens belong in `%USERPROFILE%\.claude\cc-tool\config.json`; never inline them in commits. When adding channels or proxy options, thread the config through `src/config` loaders and document defaults in `README.md`. Validate user paths and HTTP targets inside `src/server/services` to avoid shell injection, and run `publish.sh` only after confirming no private data lands in `dist/` or npm artifacts.
