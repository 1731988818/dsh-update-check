# dsh-update-check

Startup update check for DeepSeek Harness: one check per launch, one card, one click per update.

[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

A community plugin for DeepSeek Harness. It reads versions and asks for the install — it never upgrades anything on its own, never mutates a profile beyond the package you clicked, and exposes nothing but version numbers over its route.

## What it checks

| Target | Source |
| --- | --- |
| DeepSeek Harness itself | The running build from `resources/app.asar/dsh/package.json`, compared against the official `nightly.yml` feed |
| Every profile bundle | `dependencies` in the running profile's `package.json`, each resolved against the npm registry |
| The `rea-agents` CLI | The global install under `%APPDATA%\npm\node_modules\rea-agents` |

npm lookups fall back from `registry.npmjs.org` to `registry.npmmirror.com` when the first one fails, so a blocked registry degrades one target instead of the whole check.

## What you see

A card in the bottom-right corner, only when something is behind:

- `package  1.2.3 → 1.2.4` per outdated target, with the four newest shown and the rest counted
- **Update** per row for profile plugins, **Update all (N)** at the bottom
- `manual` for the three targets that cannot be updated from inside the running composition (see [Limits](#limits))
- **Check again** and **×**, because the card is a notice, not a nag

Nothing renders when everything is current.

## How it works

1. The Host half registers `GET /dsh-update-check/api/status` and starts one check when the bundle activates.
2. That check runs with six-way concurrency: one feed read, one npm read per bundle, one local version read for the CLI.
3. The Client half polls the route, then renders into the `shell.overlay` slot — a frame-wide layer above every column, so the card does not belong to a session or a panel.
4. A click on **Update** posts `{ "name": "..." }` to `/dsh-update-check/api/install`. The route accepts only names that the current check marked outdated and installable, so it cannot be used as a generic install proxy.
5. The install itself is two steps — `installBundle`, and if the manager answers `already-installed` (DSH 0.2.1 treats `add` on an existing dependency that way, issue #896), `removeBundle` followed by `installBundle` again. That is the same shape the official Plugins page uses, because this manager has no in-place update.
6. When the install settles, the check runs once more and the card reflects the new versions.

## Limits

- **`dshmarket` and other markets cannot update themselves.** Removing the bundle unloads the code that would run the reinstall (issue #900), so those rows stay `manual` with the command to run.
- **DeepSeek Harness itself** is a 289 MB desktop build behind the nightly feed; the card reports the newer version and leaves the download to you.
- **`rea-agents`** is a global npm install, not a profile dependency: `npm i -g rea-agents@latest`.
- A version is only compared, never assumed: a target with no readable current version, or a registry that answers nothing, is reported `unknown` instead of being called up to date.

## Install

```bash
dsh plugin --profile <profile> add github:1731988818/dsh-update-check
```

`pnpm` caches git dependencies by commit hash, so re-run the same command after a push to pick up new code.

Inside a running session the same install is one tool call:

```
plugin_manager install_bundle github:1731988818/dsh-update-check
```

## Route

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dsh-update-check/api/status` | Snapshot of the last check. `?refresh=1` forces a new one. |
| `POST` | `/dsh-update-check/api/install` | Body `{ "name": "package-name" }`. Only accepts an outdated, installable plugin from the current check. |

The route returns version numbers and package names only. It reads no files from the request and installs nothing that the card did not offer.

## Uninstall

```bash
dsh plugin --profile <profile> remove dsh-update-check
```

Nothing is left behind: the plugin writes no files, keeps no state between launches, and its route disappears with the bundle.

## License

[MIT](LICENSE)
