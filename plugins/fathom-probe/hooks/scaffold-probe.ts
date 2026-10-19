import type { EngineInterface, Register } from 'claude-code'

// A throwaway stub for claude-mods-fathom-fbf.1.2. It logs what a mod sees during a
// /fathom:scaffold run, so the scaffold phases are written against facts: whether
// `tool.call` fires for the tracker's MCP tools, what they are called, whether the
// first call (preflight) can be told from a create, and whether a turn-end event
// exists to clear the band on. It draws nothing and changes nothing: every hook logs
// and passes the event on unchanged.
const LOG =
  '/private/tmp/claude-501/-Users-ryanuesato-code-claude-mods-fathom/50e198ce-2208-4763-9234-10878fb6c8fd/scratchpad/scaffold-probe.log'
const MAX_LINES = 600

// Each write replaces the whole file, like the first probe, so the log can be read back
// without the transcript.
const lines: string[] = []
let startedAt = 0

async function note($: EngineInterface, text: string) {
  const elapsed = startedAt === 0 ? 0 : Math.round(((await $.clock.now()) - startedAt) / 100) / 10
  lines.push(`+${elapsed}s ${text}`)
  if (lines.length > MAX_LINES) lines.shift()
  // A log that cannot be written must not fail the tool call or the prompt it rides on.
  try {
    await $.fs.write(LOG, `${lines.join('\n')}\n`)
  } catch {}
}

function cut(value: unknown, max: number): string {
  try {
    return JSON.stringify(value)?.slice(0, max) ?? String(value)
  } catch {
    return typeof value
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    startedAt = await $.clock.now()
    await note($, 'session.start')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await note($, `session.end reason=${e.reason}`)
    return next(e)
  })

  // The three ways a Fathom skill starts. Only the head of a prompt is kept.
  on('prompt.submit', async ($, e, next) => {
    await note($, `prompt.submit head=${cut(e.text.slice(0, 80), 100)}`)
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await note($, `skill.prompt skill=${cut(e.skill, 60)}`)
    return next(e)
  })

  // Every tool, with no matcher. Built-in tools are named and nothing else; an MCP tool
  // (`mcp__<server>__<tool>`) also gets the keys and the start of its arguments, and
  // whether it came back as an error. The result is awaited and returned as it came.
  on('tool.call', async ($, e, next) => {
    const { tool, tool_use_id: _id, ...args } = e as unknown as Record<string, unknown> & { tool: string }
    const isMcp = tool.startsWith('mcp__')
    await note($, `tool.call ${tool}${isMcp ? ` keys=${cut(Object.keys(args), 200)} args=${cut(args, 300)}` : ''}`)
    const result = await next(e)
    if (isMcp) {
      const r = result as { isError?: boolean; deny?: string; text?: string }
      await note($, `tool.result ${tool} isError=${r.isError === true} deny=${r.deny ?? '-'} text=${cut((r.text ?? '').slice(0, 160), 200)}`)
    }
    return result
  })

  // (d) Is there a turn-end event, and does it say why. A turn is the model's work for
  // one prompt, so for a scaffold waiting on an approval it ends at every question.
  on('turn.start', async ($, e, next) => {
    await note($, `turn.start agent=${(e as { agentId?: string }).agentId ?? '-'}`)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId, reason } = e as { agentId?: string; reason?: unknown }
    await note($, `turn.complete agent=${agentId ?? '-'} reason=${cut(reason, 60)}`)
    return next(e)
  })
}
