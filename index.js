/**
 * dsh-update-check — Host half.
 *
 * Runs one version check each time Harness starts and exposes the result over
 * same-origin JSON routes so the Client half can show it and act on it.
 *
 * Detection is read-only. Installation only ever happens after the user presses
 * a button, and only for a plugin this check already reported as outdated: the
 * route refuses any name it did not itself observe, so it cannot be turned into
 * an arbitrary `installBundle` proxy.
 *
 * Sources of truth:
 *   - DeepSeek Harness itself: the electron-updater feed this install is
 *     configured against (resources/app-update.yml -> provider generic).
 *   - Profile plugins: the public npm registry for each dependency name in the
 *     profile's package.json, compared against the version actually on disk.
 *   - rea-agents CLI: the public npm registry, compared against the globally
 *     installed copy that `npx rea-agents setup` wires into Harness.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Same-origin JSON route the Client half polls. */
const ROUTE_PATH = '/dsh-update-check/api/status'

/** Same-origin JSON route the Client half posts one install request to. */
const INSTALL_ROUTE_PATH = '/dsh-update-check/api/install'

/** Mirrors the feed configured in D:\deepseek\resources\app-update.yml (channel: nightly). */
const DSH_FEED_URL = 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'

/** Primary registry first, then the CN mirror as a fallback. */
const NPM_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

const FETCH_TIMEOUT_MS = 10_000
const MAX_CONCURRENCY = 6
const MAX_RETRY_POLLS = 60

/** This bundle's own package name; it must not report itself as an update target. */
const SELF_NAME = 'dsh-update-check'

/**
 * The plugin market cannot be reinstalled this way: removing it first drops the
 * market UI from the running composition, and its own docs record the profile
 * being left with the bundle row gone (#900). Left to a manual, app-quit update.
 */
const MARKET_NAMES = new Set(['dshmarket', 'dsh-market'])

const state = {
  checking: false,
  done: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  dsh: null,
  items: [],
}

/** @type {Promise<void> | null} */
let inFlight = null

/** Plugin name whose install is running right now, or null. */
let installingName = null

/**
 * Whether this process has already offered the card. The Client half unmounts
 * on every page load, so its own dismissal state cannot span a reload; this
 * flag lives in the Host, which lasts as long as the running application does.
 * One card per application start, not one per page load.
 */
let announced = false

function now() {
  return new Date().toISOString()
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The profile directory owns package.json + node_modules. Prefer the env var a
 * profile-launched Harness exports, then the argv the desktop host was given
 * (`.../profiles/<name>`), which is present even when the env var is not.
 */
function findProfileDir() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv && existsSync(join(fromEnv, 'package.json'))) return fromEnv

  for (const arg of process.argv) {
    if (typeof arg !== 'string') continue
    if (!/[\\/]profiles[\\/][^\\/]+$/.test(arg)) continue
    if (existsSync(join(arg, 'package.json'))) return arg
  }
  return null
}

/** The DSH checkout that is running: <install>/resources/app.asar/dsh. */
function findDshRoot() {
  const installDir = dirname(process.execPath)
  for (const candidate of [
    join(installDir, 'resources', 'app.asar', 'dsh'),
    join(installDir, 'resources', 'app', 'dsh'),
  ]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

/** The globally installed rea-agents CLI, i.e. what `rea` / `npx rea-agents` runs. */
function findReaRoot() {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'rea-agents') : null,
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'rea-agents'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm', 'node_modules', 'rea-agents') : null,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value ?? '').trim())
  if (!match) return null
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? '',
  }
}

/** Returns 1 when `right` is newer, -1 when `left` is newer, 0 when equal/unparseable. */
function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre < b.pre ? -1 : 1
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function fetchLatestNpmVersion(name) {
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)

  for (const registry of NPM_REGISTRIES) {
    try {
      const body = await fetchJson(`${registry}/${encoded}/latest`)
      if (typeof body?.version === 'string' && body.version.length > 0) return body.version
    } catch {
      // Try the next registry.
    }
  }
  return null
}

async function fetchDshFeedVersion() {
  try {
    const response = await fetch(DSH_FEED_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    const text = await response.text()
    const match = /^version:\s*['"]?([^\s'"]+)/m.exec(text)
    return match ? match[1] : null
  } catch {
    return null
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const width = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: width }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

async function collectTargets() {
  const targets = []
  const profileDir = findProfileDir()

  if (profileDir) {
    const profilePkg = await readJson(join(profileDir, 'package.json'))
    const dependencies = profilePkg?.dependencies ?? {}
    for (const name of Object.keys(dependencies)) {
      if (!name || name === SELF_NAME) continue
      const installed = await readJson(join(profileDir, 'node_modules', name, 'package.json'))
      targets.push({
        kind: 'plugin',
        name,
        current: typeof installed?.version === 'string' ? installed.version : null,
        // Whether the one-click path may touch this plugin at all.
        installable: !MARKET_NAMES.has(name),
      })
    }
  }

  const reaRoot = findReaRoot()
  if (reaRoot) {
    const reaPkg = await readJson(join(reaRoot, 'package.json'))
    targets.push({
      kind: 'cli',
      name: 'rea-agents',
      current: typeof reaPkg?.version === 'string' ? reaPkg.version : null,
    })
  }

  return targets
}

function statusOf(current, latest) {
  if (!current || !latest) return 'unknown'
  return compareVersions(latest, current) > 0 ? 'outdated' : 'current'
}

async function performCheck() {
  state.checking = true
  state.error = null
  state.startedAt = now()

  try {
    const dshRoot = findDshRoot()
    const dshPkg = dshRoot ? await readJson(join(dshRoot, 'package.json')) : null
    const [feedVersion, targets] = await Promise.all([fetchDshFeedVersion(), collectTargets()])

    const checked = await mapLimit(targets, MAX_CONCURRENCY, async (target) => {
      const latest = await fetchLatestNpmVersion(target.name)
      return { ...target, latest, status: statusOf(target.current, latest) }
    })

    const dshCurrent = typeof dshPkg?.version === 'string' ? dshPkg.version : null
    state.dsh = {
      name: typeof dshPkg?.name === 'string' ? dshPkg.name : '@deepseek-ai/dsh-desktop-runtime',
      current: dshCurrent,
      latest: feedVersion,
      status: statusOf(dshCurrent, feedVersion),
    }
    state.items = checked
    state.done = true
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.checking = false
    state.finishedAt = now()
  }
}

function startCheck(force = false) {
  if (inFlight) return inFlight
  if (state.done && !force) return Promise.resolve()

  inFlight = performCheck().finally(() => {
    inFlight = null
  })
  return inFlight
}

function snapshot() {
  const outdatedItems = state.items.filter((item) => item.status === 'outdated')
  const dshOutdated = state.dsh?.status === 'outdated'
  const unknownItems = state.items.filter((item) => item.status === 'unknown')
  const outdatedCount = outdatedItems.length + (dshOutdated ? 1 : 0)

  return {
    schema: 'dsh-update-check/v1',
    checking: state.checking,
    done: state.done,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    dsh: state.dsh,
    items: state.items,
    summary: {
      checked: state.items.length + (state.dsh ? 1 : 0),
      outdated: outdatedItems.length + (dshOutdated ? 1 : 0),
      unknown: unknownItems.length + (state.dsh && state.dsh.status === 'unknown' ? 1 : 0),
      installable: outdatedItems.filter((item) => item.kind === 'plugin' && item.installable !== false).length,
    },
    installing: installingName,
    // Read once per process by the Client half; a reload must not raise the card again.
    notify: state.done && outdatedCount > 0 && !announced,
    pollAfterMs: state.done ? null : 2000,
    maxRetryPolls: MAX_RETRY_POLLS,
  }
}

/** The manager's own refusal code, whether it was returned or thrown. */
function managementCode(error) {
  const code = error?.code
  return typeof code === 'string' ? code : undefined
}

/** `dsh-pet@0.3.8` -> `dsh-pet`; a scoped name keeps its leading `@`. */
function registryNameOf(spec) {
  const at = spec.indexOf('@', 1)
  const name = at === -1 ? spec : spec.slice(0, at)
  return /^(@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(name) ? name : undefined
}

/**
 * Install a spec, and when the manager refuses it because that package is
 * already declared in the profile, remove the installed copy first and install
 * again.
 *
 * dsh 0.2.1's plugin manager has no in-place update: `add` on an existing
 * dependency answers `already-installed` outright (#896), and an update is
 * exactly that shape. The market's desktop bridge updates a bundle the same two
 * steps. Removing unloads the bundle from the running composition first, so a
 * failed reinstall leaves that plugin missing; the caller reports that rather
 * than pretending it worked.
 */
async function installOrReinstall(manager, spec) {
  const install = () => manager.installBundle(spec)

  let first
  try {
    first = await install()
  } catch (error) {
    if (managementCode(error) !== 'already-installed') throw error
    first = { application: 'failed', error }
  }

  if (first?.application !== 'failed' || managementCode(first?.error) !== 'already-installed') return first

  const name = registryNameOf(spec)
  if (name === undefined) return first
  if (name === SELF_NAME) {
    return {
      application: 'failed',
      error: {
        code: 'self-update',
        diagnostic: 'dsh-update-check cannot reinstall itself: removing the bundle unloads the code that would install it',
      },
    }
  }

  const removed = await manager.removeBundle(name)
  if (removed?.application === 'failed' || removed?.application === 'cancelled') return removed
  return install()
}

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function handleRequest(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, {
      'content-type': 'application/json; charset=utf-8',
      allow: 'GET',
    })
    response.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }

  const url = new URL(request.url ?? ROUTE_PATH, 'http://127.0.0.1')
  if (url.searchParams.get('refresh') === '1') void startCheck(true)

  const body = snapshot()
  if (body.notify) announced = true

  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/**
 * Install the newest release of one plugin the last check flagged as outdated.
 * The name is matched against this instance's own snapshot, so the route can
 * only ever install something it already told the user about.
 */
async function handleInstall(request, response, ctx) {
  if (request.method !== 'POST') {
    jsonResponse(response, 405, { error: 'method-not-allowed' })
    return
  }

  const body = await readBody(request)
  const name = typeof body?.name === 'string' ? body.name : null
  if (!name) {
    jsonResponse(response, 400, { schema: 'dsh-update-check/install/v1', ok: false, error: { code: 'invalid-request' } })
    return
  }

  const target = state.items.find((item) => item.name === name && item.status === 'outdated')
  if (!target) {
    jsonResponse(response, 409, {
      schema: 'dsh-update-check/install/v1',
      ok: false,
      name,
      error: { code: 'not-outdated', diagnostic: 'this plugin is not reported as outdated by the current check' },
    })
    return
  }
  if (target.kind !== 'plugin') {
    jsonResponse(response, 400, {
      schema: 'dsh-update-check/install/v1',
      ok: false,
      name,
      error: { code: 'not-a-plugin', diagnostic: `kind "${target.kind}" must be updated outside the profile` },
    })
    return
  }
  if (target.installable === false) {
    jsonResponse(response, 400, {
      schema: 'dsh-update-check/install/v1',
      ok: false,
      name,
      error: {
        code: 'manual-update',
        diagnostic: 'removing this bundle first would unload it from the running composition; update it with DSH quit',
      },
    })
    return
  }
  if (installingName) {
    jsonResponse(response, 409, {
      schema: 'dsh-update-check/install/v1',
      ok: false,
      name,
      error: { code: 'busy', diagnostic: `already installing ${installingName}` },
    })
    return
  }

  installingName = name
  const spec = `${name}@${target.latest}`
  try {
    // dsh 0.2.1 has no in-place update, so an installed plugin needs the
    // remove-then-install shape; installOrReinstall owns that fallback.
    const result = await installOrReinstall(ctx.pluginManager, spec)
    const application = result?.application ?? null
    const ok = application === 'applied' || application === 'restart-required' || application === 'overridden'
    jsonResponse(response, 200, {
      schema: 'dsh-update-check/install/v1',
      ok,
      name,
      spec,
      application,
      restartReason: result?.restartReason ?? null,
      version: result?.version ?? null,
      error: result?.error ? { code: result.error.code, diagnostic: result.error.diagnostic ?? null } : null,
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      logPath: result?.packageResult?.logPath ?? null,
    })
  } catch (error) {
    jsonResponse(response, 200, {
      schema: 'dsh-update-check/install/v1',
      ok: false,
      name,
      spec,
      application: null,
      error: {
        code: 'operation-error',
        diagnostic: error instanceof Error ? error.message : String(error),
      },
      warnings: [],
      logPath: null,
    })
  } finally {
    installingName = null
    // Reflect the new on-disk versions right away.
    void startCheck(true)
  }
}

export const inject = ['webServer', 'pluginManager']

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: handleRequest,
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: INSTALL_ROUTE_PATH,
      handler: (request, response) => handleInstall(request, response, ctx),
    }),
  )

  // Kick off right away so the answer is usually ready by the time the UI mounts.
  void startCheck()
}
