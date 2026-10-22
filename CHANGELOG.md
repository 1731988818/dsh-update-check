# Changelog

Versions follow the git history of this repository. Every release is a tag on `master`.

## 1.5.2

- README rewritten in both languages around what the plugin refuses to do as much as what it does.
- Added `assets/card-preview.svg`, a drawing of the card that is kept in sync with `client.js` rather than a screenshot that goes stale.
- Documented that `dsh plugin add` also registers the bundle in `dsh.profile.bundles`, and that `dsh plugin remove` unregisters it.
- Added this changelog.

## 1.5.1

- The card is offered once per application start instead of once per page load. The Host hands the offer out a single time and the first page to read it spends it, so dismissing, navigating or reloading no longer brings it back.

## 1.5.0

- Package metadata aligned with the `awesome-dsh-plugin` listing format: `repository`, `bugs`, `homepage`, `keywords`, `license` and `author`.
- README split into `README.md` (English) and `README.zh.md` (Chinese), both with the same sections.
- Added `LICENSE` (MIT).

## 1.4.0

- Plugin markets (`dshmarket`, `dsh-market`) are reported as manual instead of attempted: removing the bundle would unload the code that runs the reinstall (upstream issue #900). The install route refuses those rows with `manual-update`.

## 1.3.0

- Fixed updates failing with `already-installed`: the install is now `installBundle`, then `removeBundle` followed by `installBundle` when the manager answers that way (upstream issue #896).
- The plugin refuses to reinstall itself, for the same reason markets do.

## 1.2.0

- Added the install route and the per-row **更新** button, **全部更新**, and per-row outcomes (`✓ 已更新`, `✓ 待重启`, `重试`).
- The install route accepts only names the current check marked outdated and installable.

## 1.0.0

- First release: one startup check of the app, the profile plugins and the `rea-agents` CLI, shown as a dismissible card in the `shell.overlay` slot.
