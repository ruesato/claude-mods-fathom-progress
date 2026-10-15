import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, Snapshot } from '../types'
import { readBd } from './bd'
import { NONE, PILL_KEY, cmuxEntries, meterValue } from './cmux'
import type { CmuxEntries } from './cmux'
import { paletteFor } from './desktop'
import { drawBand } from './draw'
import { POLL_MS, planPath, refsOfBranch, refsOfPrompt, startOf, startOfPrompt, touchesRun } from './lifecycle'
import { parsePlan } from './plan'
import { parseEpics, pickRun, toSnapshot } from './state'

const armedAt = atom({ plugin: 'fathom-progress', key: 'armedAt' } as const, null)
const armedRefs = atom({ plugin: 'fathom-progress', key: 'refs' } as const, [])
const snapshot = atom({ plugin: 'fathom-progress', key: 'snapshot' } as const, { kind: 'idle' })
const isHidden = atom({ plugin: 'fathom-progress', key: 'isHidden' } as const, false)

async function bd($: EngineInterface, root: string, args: string[]): Promise<unknown> {
  return readBd(args[0] ?? '', await $.process.run(['bd', ...args], { cwd: root }))
}

// The run's plan document, parsed; null when there is none yet or it cannot be read.
async function readPlan($: EngineInterface, root: string, ref: string): Promise<Plan | null> {
  const path = planPath(root, ref)
  if (path === null) return null
  try {
    return parsePlan(await $.fs.read(path, { as: 'text' }))
  } catch {
    return null
  }
}

// The branch the session's repository is on, or '' when there is none to read. Read with
// each refresh and not when armed: Fathom makes the issue's branch after it starts.
async function branchOf($: EngineInterface, root: string): Promise<string> {
  try {
    const out = await $.process.run(['git', 'branch', '--show-current'], { cwd: root })
    return out.exitCode === 0 ? out.stdout.trim() : ''
  } catch {
    return ''
  }
}

// What the debug log last said the band follows, so it says it once per change.
let lastFollowed = ''

// Reads bd and the plan document and builds what the band shows. Three bd calls, one
// after the other: they are reads, but they share one embedded database. `typed` is
// what the person typed after the command; with none, the branch's ref stands in.
async function build($: EngineInterface, since: number, typed: readonly string[]): Promise<Snapshot> {
  try {
    const root = await $.session.root()
    const epics = parseEpics(await bd($, root, ['list', '--type', 'epic', '--all', '--limit', '0', '--json']))
    if (epics === null) return { kind: 'unavailable', reason: 'bd did not return a JSON list' }

    const branch = typed.length > 0 ? [] : refsOfBranch(await branchOf($, root))
    const epic = pickRun(epics, since, { refs: typed.length > 0 ? typed : branch, isExact: typed.length > 0 })
    const followed = `${epic?.ref ?? 'nothing'} (typed ${typed.join(',') || '-'}, branch ${branch.join(',') || '-'})`
    if (followed !== lastFollowed) {
      lastFollowed = followed
      $.ui.log(`fathom-progress: following ${followed}`, { to: 'debug' })
    }
    if (epic === null) return { kind: 'starting' }

    const ref = epic.ref
    const tasks = await bd($, root, ['list', '-l', ref, '--type', 'task', '--all', '--limit', '0', '--json'])
    const ready = await bd($, root, ['ready', '-l', ref, '--type', 'task', '--limit', '50', '--json'])
    return toSnapshot({ epic, tasks, ready, plan: await readPlan($, root, ref) })
  } catch (error) {
    // Unlike a count, a failure is kept and shown ("unavailable"), never zeros.
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`fathom-progress: refresh failed: ${reason}`, { to: 'debug' })
    return { kind: 'unavailable', reason }
  }
}

// The person's theme, as `/config` holds it, for the desktop bar's colors. Read with each
// refresh and not with each draw, since it rarely changes and a draw must stay quick.
let theme: string | null = null

async function readTheme($: EngineInterface) {
  try {
    const row = (await $.config.list()).find(r => r.key === 'theme')
    theme = typeof row?.value === 'string' ? row.value : null
  } catch {
    theme = null
  }
}

// The cmux sidebar row. Inside cmux the snapshot the band draws also goes onto the
// workspace's row, as a status pill and a progress bar, through cmux's own command line.
// Outside cmux (the desktop app, any other terminal) there is no CMUX_WORKSPACE_ID and
// nothing happens. All of it is best effort: a cmux that is missing, stopped or slow must
// never touch the band.
const CMUX_TIMEOUT_MS = 3000

// What the row last got, as the text it was made from, so an unchanged snapshot (every
// poll) sends nothing; and whether a bar of ours is on it. cmux has one bar per workspace,
// so ours is cleared only when ours was set, never someone else's.
let sentToCmux: string | null = null
let hasMeterOnRow = false

async function cmux($: EngineInterface, args: string[]): Promise<void> {
  try {
    const out = await $.process.run(['cmux', ...args], { timeoutMs: CMUX_TIMEOUT_MS })
    if (out.exitCode !== 0) {
      $.ui.log(`fathom-progress: cmux ${args[0]} exited ${out.exitCode}: ${out.stderr.trim().split('\n')[0] ?? ''}`, { to: 'debug' })
    }
  } catch (error) {
    $.ui.log(`fathom-progress: cmux ${args[0]} failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

// Puts `entries` on the row, or takes ours off when there are none. `isForced` sends
// even when nothing changed: session.start uses it to remove a pill that a session which
// ended badly left behind.
async function syncCmux($: EngineInterface, entries: CmuxEntries, isForced: boolean): Promise<void> {
  if ((await $.env.get('CMUX_WORKSPACE_ID')) === undefined) return
  const key = JSON.stringify(entries)
  if (!isForced && key === sentToCmux) return
  sentToCmux = key

  const { pill, meter } = entries
  if (pill) await cmux($, ['set-status', PILL_KEY, pill.text, '--icon', pill.icon, '--color', pill.color])
  else await cmux($, ['clear-status', PILL_KEY])

  if (meter) {
    hasMeterOnRow = true
    await cmux($, ['set-progress', meterValue(meter.value), '--label', meter.label])
  } else if (hasMeterOnRow) {
    hasMeterOnRow = false
    await cmux($, ['clear-progress'])
  }
}

// One send at a time, in the order asked: two overlapping ones could leave the older
// pill on the row. Each reads the snapshot when its turn comes, so the last one wins.
let cmuxQueue: Promise<void> = Promise.resolve()

// The row follows the band: what the band shows, and nothing while it is hidden or idle.
function publish($: EngineInterface, isForced = false): Promise<void> {
  cmuxQueue = cmuxQueue.then(async () => {
    try {
      const entries = (await read($, isHidden)) ? NONE : cmuxEntries(await read($, snapshot))
      await syncCmux($, entries, isForced)
    } catch (error) {
      $.ui.log(`fathom-progress: cmux sync failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }
  })
  return cmuxQueue
}

// One refresh at a time. A call that arrives during one asks for another straight
// after it, so the last change is never missed and the calls never pile up.
let isRefreshing = false
let isStale = false

async function refresh($: EngineInterface) {
  if (isRefreshing) {
    isStale = true
    return
  }
  isRefreshing = true
  try {
    do {
      isStale = false
      const since = await read($, armedAt)
      // Not armed: nothing to show and nothing to poll.
      if (since === null) return
      await readTheme($)
      const fresh = await build($, since, await read($, armedRefs))
      // A new invocation, or the session ending, during the fetch makes it stale.
      if ((await read($, armedAt)) === since) {
        await update($, snapshot, () => fresh)
        void publish($)
      }
    } while (isStale)
  } finally {
    isRefreshing = false
  }
}

// One start reaches arm by more than one signal within about this long.
const SAME_START_MS = 3000

// A Fathom skill started. Execute arms the band: it shows `starting` until the epic
// exists, then follows the run. Scaffold writes no beads, so there is no run to follow:
// it shows `starting` and disarms, which also stops the poll.
async function arm($: EngineInterface, start: 'execute' | 'scaffold' | null, via: string, refs: readonly string[] = []) {
  if (start === null) return
  const now = await $.clock.now()
  // One start can reach here by more than one signal (a typed command is a `skill.prompt`
  // and a `prompt.submit`): the later ones, moments after the first, add nothing, except
  // the refs, which only the typed command carries and which may come second.
  const last = await read($, armedAt)
  if (start === 'execute' && last !== null && now - last < SAME_START_MS) {
    if (refs.length > 0) {
      await update($, armedRefs, () => [...refs])
      void refresh($)
    }
    return
  }
  await update($, armedAt, () => (start === 'execute' ? now : null))
  await update($, armedRefs, () => [...refs])
  await update($, snapshot, () => ({ kind: 'starting' }))
  void publish($)
  $.ui.log(`fathom-progress: armed (${start}) by ${via}, typed refs ${refs.join(',') || '-'}`, { to: 'debug' })
  if (start === 'execute') void refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The timer runs all session and does nothing until armed. A finished run does not
    // change, so it is not polled; the next invocation refreshes it.
    $.clock.every(POLL_MS, async () => {
      if ((await read($, snapshot)).kind !== 'finished') await refresh($)
    })

    // A taken name throws, and a hook that throws is skipped; register last.
    try {
      await $.command.register({ name: 'fathom-progress', description: 'Toggle the Fathom progress band.' })
    } catch {}

    // Forced, to take off the row a pill that a session which ended badly left there, and to
    // put the run back after /reload-plugins, which makes this module new and leaves the
    // band's state as it was.
    void publish($, true)

    return next(e)
  })

  // The module and its timer survive /clear (probed, claude-mods-fathom-5l2.2), and
  // session.start does not fire again, so the reset is here, for every reason.
  on('session.end', async ($, e, next) => {
    await update($, armedAt, () => null)
    await update($, armedRefs, () => [])
    await update($, snapshot, () => ({ kind: 'idle' }))
    // Awaited: the session may be gone straight after, and the row must not keep the run.
    await publish($)
    return next(e)
  })

  // The signal that Fathom started: the engine reports the skill's own text, typed as a
  // command or called through the Skill tool. A new invocation re-arms and re-picks.
  on('skill.prompt', async ($, e, next) => {
    await arm($, startOf(e.skill), 'skill.prompt')
    return next(e)
  })

  // The same two signals where `skill.prompt` is skipped (a Team organization's built-in
  // security plugin answers it first): a typed command, and the Skill tool's call. Both
  // only read; a failure here must never hold up the prompt or the tool.
  on('prompt.submit', async ($, e, next) => {
    try {
      await arm($, startOfPrompt(e.text), 'prompt.submit', refsOfPrompt(e.text))
    } catch {}
    return next(e)
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    try {
      if (typeof e.skill === 'string') await arm($, startOf(e.skill), 'tool.call')
    } catch {}
    return next(e)
  })

  // A bd call or a commit may have moved the run: catch up now, not at the next poll.
  // Not awaited, so Claude gets the tool's result at once.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (typeof e.command === 'string' && touchesRun(e.command)) void refresh($)
    return result
  })

  on('command.run', { command: 'fathom-progress' }, async $ => {
    const current = await read($, isHidden)
    await update($, isHidden, () => !current)
    void publish($)
    return { text: current ? 'Fathom band shown.' : 'Fathom band hidden.' }
  })

  // The band answers AbovePrompt only while it has something to show; otherwise it
  // passes the event on, so beads-status can draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, snapshot)
    if (e.props.hasSurvey || current.kind === 'idle' || (await read($, isHidden))) return next(e)
    return drawBand($.ui.resolve(e), e.props.bodyColumns, current, { surface: e.surface, palette: paletteFor(theme) }) ?? next(e)
  })
}
