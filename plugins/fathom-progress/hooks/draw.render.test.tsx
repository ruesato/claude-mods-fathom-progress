import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { RunTask, Snapshot, TaskState } from '../types'
import { DARK } from './desktop'
import type { Palette } from './desktop'
import { drawBand } from './draw'

/**
 * Draws `drawBand` through the test kit, on each surface the mod claims, to read the
 * tree it returns: the text of each row. The kit exercises the tree under that
 * surface's element table, never its paint, so colors, the 7/8 block and the icon
 * glyphs still need a look at the live band, in the terminal and in the desktop app.
 *
 * The plugin's own `ui.render` hook reads state atoms, which are empty in the test
 * environment, so it does not answer; the stub beneath it draws `drawBand` with the
 * snapshot the test chooses.
 */

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
}

const TITLES = [
  'Draft the plan doc',
  'Capture the fixtures',
  'Wire the lifecycle hooks',
  'Draw the executing view',
  'Verify in a live session',
]

function runOf(states: TaskState[], reviewed: number[] = []): RunTask[] {
  return states.map((state, i) => ({
    id: `fx-${i + 1}`,
    ref: `SLU-123-${i + 1}`,
    title: TITLES[i] ?? `Task ${i + 1}`,
    state,
    isInReview: reviewed.includes(i),
  }))
}

// The three frames of the design: A1 planned, A2 executing, A3 done.
const PLANNED: Snapshot = { kind: 'executing', ref: 'SLU-123', tasks: runOf(['next', 'waiting', 'waiting', 'waiting', 'waiting']) }
const EXECUTING: Snapshot = {
  kind: 'executing',
  ref: 'SLU-123',
  tasks: runOf(['done', 'done', 'inProgress', 'waiting', 'waiting'], [1]),
}
const DONE: Snapshot = { kind: 'finished', ref: 'SLU-123', tasks: runOf(['done', 'done', 'done', 'done', 'done']) }

type Node = string | { type?: string; props?: Record<string, unknown>; children?: readonly Node[] }

// The text a node draws, nested Text and Box children joined as they are laid out.
function textOf(node: Node): string {
  return typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('')
}

// The kit takes one `on` per test, before the first mount, so the stub is registered
// once and the snapshot it draws is swapped between mounts.
function band($: Engine, on: On) {
  let current: Snapshot = { kind: 'idle' }
  let palette: Palette | null = null
  let isNull = false
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tree = drawBand($.ui.resolve(e), e.props.bodyColumns, current, { surface: e.surface, palette })
    isNull = tree === null
    return tree ?? next(e)
  })

  // Mounts the band on `surface` and reads its rows: the top gap is padding, so the
  // band is the head row and the line beneath.
  return {
    wasNull: () => isNull,
    async show(snapshot: Snapshot, surface: Surface, bodyColumns = 80, withPalette: Palette | null = null) {
      current = snapshot
      palette = withPalette
      const ui = await $.ui.mount({
        plugin: 'fathom-progress',
        surface,
        component: 'AbovePrompt',
        requestId: 'r',
        props: { ...PROPS, bodyColumns },
      })
      const tree = (await ui.drawn()) as unknown as { children?: Node[] } | null
      const row = (i: number) => {
        const node = tree?.children?.[i]
        return node === undefined ? '' : textOf(node)
      }
      return { ui, head: row(0), line: row(1) }
    },
  }
}

test('planned: a grey band with the first task next, 0%, and the next task named beneath', async ($, on) => {
  const { show } = band($, on)

  for (const surface of SURFACES) {
    const { ui, head, line } = await show(PLANNED, surface)

    expect(head.startsWith('●SLU-123 Progress band')).toBe(true)
    expect(head).toContain('0 of 5')
    expect(head.endsWith('  0%')).toBe(true)
    expect(line).toBe('▸ next 1/5  Draft the plan doc')
    await ui.unmount()
  }
})

test('executing: the bar, 40%, and the task in progress named beneath with the reviews open', async ($, on) => {
  const { show } = band($, on)

  for (const surface of SURFACES) {
    const { ui, head, line } = await show(EXECUTING, surface)

    expect(head).toContain('2 of 5')
    expect(head).toContain('◐')
    expect(head).toContain('●')
    expect(head.endsWith(' 40%')).toBe(true)
    expect(line).toBe('▸ now 3/5  Wire the lifecycle hooks  · 1 in review')
    expect(await ui.find({ type: 'Text', text: '▸ now 3/5  Wire the lifecycle hooks  · 1 in review' })).toBeDefined()
    await ui.unmount()
  }
})

test('done: a full green bar, 100%, and the count beneath', async ($, on) => {
  const { show } = band($, on)

  for (const surface of SURFACES) {
    const { ui, head, line } = await show(DONE, surface)

    expect(head).toContain('5 of 5')
    expect(head.endsWith('100%')).toBe(true)
    expect(line).toBe('✓ 5/5 done')
    await ui.unmount()
  }
})

test('the dot is grey until a task starts, the band\'s color while it runs, and green when done', async ($, on) => {
  const { show } = band($, on)
  const colorOfDot = async (snapshot: Snapshot) => {
    const { ui } = await show(snapshot, 'terminal')
    const dot = await ui.find({ type: 'Text', text: '●' })
    await ui.unmount()
    return (dot as unknown as { props?: { color?: string } } | undefined)?.props?.color
  }

  expect(await colorOfDot(PLANNED)).toBe('inactive')
  expect(await colorOfDot(EXECUTING)).toBe('claude')
  expect(await colorOfDot(DONE)).toBe('success')
})

test('creating shows the tasks made so far with no total and no percent', async ($, on) => {
  const { show } = band($, on)

  for (const surface of SURFACES) {
    const { ui, head, line } = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, surface)

    expect(head.startsWith('●SLU-123 Progress band')).toBe(true)
    expect(head).not.toContain('%')
    expect(line).toBe('▸ planning  3 tasks so far')
    await ui.unmount()
  }

  const { ui, line } = await show({ kind: 'creating', ref: 'SLU-123', created: 0 }, 'terminal')
  expect(line).toBe('▸ planning  no tasks yet')
  await ui.unmount()
})

test('starting and unavailable say so in one dim line', async ($, on) => {
  const { show } = band($, on)

  const starting = await show({ kind: 'starting' }, 'terminal')
  expect(await starting.ui.find({ type: 'Text', text: '[fathom] starting…' })).toBeDefined()
  await starting.ui.unmount()

  const down = await show({ kind: 'unavailable', reason: 'bd list exited 1: Error: no beads database found' }, 'desktop')
  expect(await down.ui.find({ type: 'Text', text: /^\[fathom\] unavailable: bd list exited 1/ })).toBeDefined()
  await down.ui.unmount()
})

test('idle draws nothing, so the event passes on and beads-status can draw', async ($, on) => {
  const { show, wasNull } = band($, on)

  // With nothing beneath this mod to answer, the kit refuses to mount: the band yielded.
  await expect(show({ kind: 'idle' }, 'terminal')).rejects.toThrow(/no implementation for ui\.render/)
  expect(wasNull()).toBe(true)
})

test('a row too narrow for a bar shows the count instead, and more tasks than cells does too', async ($, on) => {
  const { show } = band($, on)

  const narrow = await show(EXECUTING, 'terminal', 30)
  expect(narrow.head).toContain('2 of 5')
  expect(narrow.head).not.toContain('▉')
  await narrow.ui.unmount()

  const many: Snapshot = { kind: 'executing', ref: 'SLU-123', tasks: runOf(Array.from({ length: 60 }, () => 'waiting' as const)) }
  const crowded = await show(many, 'terminal', 80)
  expect(crowded.head).toContain('0 of 60')
  expect(crowded.head).not.toContain('▉')
  await crowded.ui.unmount()
})

test('nine tasks, the over-seven case, still draw a bar with every task in it', async ($, on) => {
  const { show } = band($, on)
  const nine: Snapshot = {
    kind: 'executing',
    ref: 'SLU-123',
    tasks: runOf(['done', 'done', 'done', 'inProgress', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']),
  }
  const { ui, head } = await show(nine, 'desktop')

  expect(head).toContain('3 of 9')
  expect([...head].filter(c => c === '▉').length).toBeGreaterThanOrEqual(7)
  await ui.unmount()
})

test('on the desktop, with a palette for the theme, the bar is one Svg with the head pill, and the step text is not drawn beside it', async ($, on) => {
  const { show } = band($, on)
  const { ui, head, line } = await show(EXECUTING, 'desktop', 80, DARK)

  const svg = (await ui.find({ type: 'Svg' })) as unknown as { props?: { alt?: string; width?: number; height?: number; source?: string } } | undefined
  expect(svg).toBeDefined()
  expect(svg?.props?.alt).toBe('2 of 5 tasks done, 1 in review, task 3 in progress')
  // 80 cells at 7.9px, less the dot, three gaps, the label's 21 characters and the percent's box.
  expect([svg?.props?.width, svg?.props?.height]).toEqual([412, 16])
  expect(svg?.props?.source).toContain('>2/5</text>')
  // The label, percent and line stay Text, so they follow the theme.
  expect(head.startsWith('●SLU-123 Progress band')).toBe(true)
  expect(head.endsWith(' 40%')).toBe(true)
  expect(head).not.toContain('▉')
  expect(line).toBe('▸ now 3/5  Wire the lifecycle hooks  · 1 in review')
  await ui.unmount()
})

test('on the desktop with no palette for the theme, and on the terminal with one, the bar stays the cell bar', async ($, on) => {
  const { show } = band($, on)

  const unknownTheme = await show(EXECUTING, 'desktop', 80, null)
  expect(await unknownTheme.ui.find({ type: 'Svg' })).toBeUndefined()
  expect(unknownTheme.head).toContain('2 of 5')
  await unknownTheme.ui.unmount()

  const terminal = await show(EXECUTING, 'terminal', 80, DARK)
  expect(terminal.head).toContain('2 of 5')
  expect(terminal.head).toContain('▉')
  await terminal.ui.unmount()
})

test('the desktop Svg bar draws for planned and finished runs too, and while the tasks are made it is a growing track with no pill', async ($, on) => {
  const { show } = band($, on)

  for (const snapshot of [PLANNED, DONE]) {
    const { ui } = await show(snapshot, 'desktop', 80, DARK)
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
  const creating = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, 'desktop', 80, DARK)
  const svg = (await creating.ui.find({ type: 'Svg' })) as unknown as { props?: { alt?: string; width?: number; source?: string } } | undefined
  expect(svg?.props?.alt).toBe('3 tasks made so far')
  expect(svg?.props?.width).toBe(108)
  expect(svg?.props?.source).not.toContain('class="pill"')
  expect(creating.head).not.toContain('▉')
  await creating.ui.unmount()

  // With no palette for the theme the desktop keeps the cell bar here too.
  const plain = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, 'desktop', 80, null)
  expect(await plain.ui.find({ type: 'Svg' })).toBeUndefined()
  await plain.ui.unmount()
})
