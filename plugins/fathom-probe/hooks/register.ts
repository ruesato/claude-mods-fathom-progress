import type { EngineInterface, Register } from 'claude-code'

// A throwaway stub that observes the engine, to answer the questions of
// claude-mods-fathom-5l2.2 before the real hooks are written. It draws nothing and
// changes nothing: every hook logs what it saw and passes the event on unchanged.
//
// The log is a file in the scratchpad of the session that wrote this, so it can be
// read back without the transcript. Each write replaces the whole file.
const LOG =
  '/private/tmp/claude-501/-Users-ryanuesato-code-claude-mods-fathom/3eb8b027-953f-4a14-90a9-8ab32eed4e3e/scratchpad/fathom-probe.log'
const MAX_LINES = 400

// (e) These live in the module, not in engine state: if the module is reloaded on
// /clear, `ticks` starts over and `session.start` fires again; if it survives, the
// ticks keep counting through the /clear.
const lines: string[] = []
let ticks = 0
let starts = 0
let lastRender = ''

async function note($: EngineInterface, text: string) {
  const stamp = new Date(await $.clock.now()).toISOString()
  lines.push(`${stamp} ${text}`)
  if (lines.length > MAX_LINES) lines.shift()
  await $.fs.write(LOG, `${lines.join('\n')}\n`)
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  try {
    return `${typeof value} ${JSON.stringify(value).slice(0, 200)}`
  } catch {
    return typeof value
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    starts += 1
    await note($, `session.start #${starts} (module ticks so far: ${ticks})`)
    // (e) A timer started here runs on its own; does it outlive /clear?
    $.clock.every(15_000, async () => {
      ticks += 1
      if (ticks <= 40) await note($, `tick ${ticks} (starts ${starts})`)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await note($, `session.end reason=${e.reason} (ticks ${ticks}, starts ${starts})`)
    return next(e)
  })

  // (a) Which name does the engine report for a Fathom skill, typed as a slash
  // command and called through the Skill tool, and does its text carry the issue ref.
  on('skill.prompt', async ($, e, next) => {
    const refs = (e.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []).slice(0, 5)
    const urls = (e.text.match(/https?:\/\/\S+/g) ?? []).slice(0, 3)
    await note(
      $,
      `skill.prompt skill=${JSON.stringify(e.skill)} len=${e.text.length} refs=${JSON.stringify(refs)} urls=${JSON.stringify(urls)} head=${JSON.stringify(e.text.slice(0, 240))}`,
    )
    return next(e)
  })

  // (b) Does a tool.call on the Skill tool carry its arguments.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await note($, `tool.call Skill keys=${JSON.stringify(Object.keys(e))} e=${JSON.stringify(e).slice(0, 600)}`)
    return next(e)
  })

  // (c) and (d) With another mod loaded, does this one see AbovePrompt at all, and what
  // does `next` resolve to when it asks for what is beneath: nothing, or the other
  // mod's tree. Logged when the answer changes, so the log is not a line per frame.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const result = await next(e)
    const seen = `survey=${e.props.hasSurvey} beneath=${describe(result)}`
    if (seen !== lastRender) {
      lastRender = seen
      await note($, `ui.render AbovePrompt ${seen}`)
    }
    return result
  })
}
