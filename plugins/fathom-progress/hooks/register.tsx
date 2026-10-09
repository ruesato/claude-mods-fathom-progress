import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, Snapshot } from '../types'
import { readBd } from './bd'
import { paletteFor } from './desktop'
import { drawBand } from './draw'
import { POLL_MS, planPath, startOf, touchesRun } from './lifecycle'
import { parsePlan } from './plan'
import { parseEpics, pickRun, toSnapshot } from './state'

const armedAt = atom({ plugin: 'fathom-progress', key: 'armedAt' } as const, null)
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

// Reads bd and the plan document and builds what the band shows. Three bd calls, one
// after the other: they are reads, but they share one embedded database.
async function build($: EngineInterface, since: number): Promise<Snapshot> {
  try {
    const root = await $.session.root()
    const epics = parseEpics(await bd($, root, ['list', '--type', 'epic', '--all', '--limit', '0', '--json']))
    if (epics === null) return { kind: 'unavailable', reason: 'bd did not return a JSON list' }

    const epic = pickRun(epics, since)
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
      const fresh = await build($, since)
      // A new invocation, or the session ending, during the fetch makes it stale.
      if ((await read($, armedAt)) === since) await update($, snapshot, () => fresh)
    } while (isStale)
  } finally {
    isRefreshing = false
  }
}

// A Fathom skill started. Execute arms the band: it shows `starting` until the epic
// exists, then follows the run. Scaffold writes no beads, so there is no run to follow:
// it shows `starting` and disarms, which also stops the poll.
async function arm($: EngineInterface, skill: string) {
  const start = startOf(skill)
  if (start === null) return
  const now = await $.clock.now()
  await update($, armedAt, () => (start === 'execute' ? now : null))
  await update($, snapshot, () => ({ kind: 'starting' }))
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
      await $.command.register({ name: 'fathom-band', description: 'Toggle the Fathom progress band.' })
    } catch {}

    return next(e)
  })

  // The module and its timer survive /clear (probed, claude-mods-fathom-5l2.2), and
  // session.start does not fire again, so the reset is here, for every reason.
  on('session.end', async ($, e, next) => {
    await update($, armedAt, () => null)
    await update($, snapshot, () => ({ kind: 'idle' }))
    return next(e)
  })

  // The signal that Fathom started: the engine reports the skill's own text, typed as a
  // command or called through the Skill tool. A new invocation re-arms and re-picks.
  on('skill.prompt', async ($, e, next) => {
    await arm($, e.skill)
    return next(e)
  })

  // A bd call or a commit may have moved the run: catch up now, not at the next poll.
  // Not awaited, so Claude gets the tool's result at once.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (typeof e.command === 'string' && touchesRun(e.command)) void refresh($)
    return result
  })

  on('command.run', { command: 'fathom-band' }, async $ => {
    const current = await read($, isHidden)
    await update($, isHidden, () => !current)
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
