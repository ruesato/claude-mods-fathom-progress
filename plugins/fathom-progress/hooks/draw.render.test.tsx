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
 * surface's element table, never its paint, so colors, the heavy line and the icon
 * glyphs still need a look at the live band, in the terminal and in the desktop app.
 *
 * The plugin's own `ui.render` hook reads state atoms, which are empty in the test
 * environment, so it does not answer; the stub beneath it draws `drawBand` with the
 * snapshot the test chooses.
 */

type Surface = 'terminal' | 'desktop'

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

// The frames of the design: planned, executing, done and creating.
const PLANNED: Snapshot = { kind: 'executing', ref: 'SLU-123', tasks: runOf(['next', 'waiting', 'waiting', 'waiting', 'waiting']) }
const EXECUTING: Snapshot = {
  kind: 'executing',
  ref: 'SLU-123',
  title: 'Add the progress band',
  tasks: runOf(['done', 'done', 'inProgress', 'waiting', 'waiting'], [1]),
}
const DONE: Snapshot = { kind: 'finished', ref: 'SLU-123', title: 'Add the progress band', tasks: runOf(['done', 'done', 'done', 'done', 'done']) }

// The terminal's bar: heavy lines, each segment but the last ending in a heavy half line,
// which is the gap. At 80 columns the bar has 74 cells, of which 70 divide among five tasks:
// fourteen wide each. Three made so far fill three of five slots of fourteen.
const seg = (n: number, hasNext = true) => '━'.repeat(hasNext ? n - 1 : n) + (hasNext ? '╸' : '')
const BAR_OF_FIVE = seg(14).repeat(4) + seg(14, false)
const BAR_OF_THREE_SLOTS = seg(14) + seg(14) + seg(14, false)

type Node = string | { type?: string; props?: Record<string, unknown>; children?: readonly Node[] }

// The text a node draws, nested Text and Box children joined as they are laid out.
function textOf(node: Node): string {
  return typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('')
}

// The Boxes under a node that have a background, in drawing order: a segment of the
// desktop's theme-following bar is one.
function filledBoxes(node: unknown): { color: unknown; width: unknown }[] {
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
  if (!n || typeof n === 'string') return []
  const own = n.type === 'Box' && n.props?.backgroundColor ? [{ color: n.props.backgroundColor, width: n.props.width }] : []
  return [...own, ...(n.children ?? []).flatMap(filledBoxes)]
}

// The runs of the terminal's bar under a node, in drawing order: each colored Text of
// heavy lines and the color it is drawn in. Neighboring segments of one color are one run,
// since nothing separates them. The Text that wraps the whole bar has no color of its own,
// so a bar of one unbroken run is not counted twice.
function barRuns(node: unknown): { text: string; color: unknown }[] {
  const n = node as { type?: string; props?: Record<string, unknown>; children?: Node[] } | string | null | undefined
  if (!n || typeof n === 'string') return []
  const own = n.type === 'Text' && n.props?.color !== undefined && /^[━╸]+$/.test(textOf(n)) ? [{ text: textOf(n), color: n.props.color }] : []
  return [...own, ...(n.children ?? []).flatMap(barRuns)]
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

  // Mounts the band on `surface` and reads its rows. The terminal's are the bar with the
  // percent, the title row, and the line beneath; the desktop's are the head row, which
  // holds the title, and the line beneath it. `title` is empty on the desktop.
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
      const tree = (await ui.drawn()) as unknown as { props?: Record<string, unknown>; children?: Node[] } | null
      const row = (i: number) => {
        const node = tree?.children?.[i]
        return node === undefined ? '' : textOf(node)
      }
      const isTerminal = surface === 'terminal'
      return { ui, head: row(0), title: isTerminal ? row(1) : '', line: row(isTerminal ? 2 : 1), tree }
    },
  }
}

test('terminal planned: five grey segments, 0% at the end of the bar row, the dot and label, and the next task named beneath', async ($, on) => {
  const { show } = band($, on)
  const { ui, head, title, line, tree } = await show(PLANNED, 'terminal')

  expect(head).toBe(`${BAR_OF_FIVE}0%`)
  // The plan names no title here, so the ref stands alone.
  expect(title).toBe('●SLU-123')
  expect(line).toBe('▸ next 1/5  Draft the plan doc')
  // Five grey segments are one run: nothing separates neighbors of a color.
  expect(barRuns(tree)).toEqual([{ text: BAR_OF_FIVE, color: 'subtle' }])
  // The bar row is the band's first row: there is no row of padding above it.
  expect(tree?.props?.paddingTop).toBeUndefined()
  await ui.unmount()
})

test('terminal executing: the bar in each state\'s color, 40%, the reviews open beside the label, and the task in progress beneath', async ($, on) => {
  const { show } = band($, on)
  const { ui, head, title, line, tree } = await show(EXECUTING, 'terminal')

  expect(head).toBe(`${BAR_OF_FIVE}40%`)
  expect(barRuns(tree)).toEqual([
    { text: seg(14), color: 'success' },
    { text: seg(14), color: 'claude' },
    { text: seg(14), color: 'warning' },
    { text: seg(14) + seg(14, false), color: 'subtle' },
  ])
  expect(title).toBe('●SLU-123 Add the progress band· 1 in review')
  // The note is its own dim Text on the title row, and the line beneath no longer carries it.
  const note = (await ui.find({ type: 'Text', text: '· 1 in review' })) as unknown as { props?: { dimColor?: boolean } } | undefined
  expect(note?.props?.dimColor).toBe(true)
  expect(line).toBe('▸ now 3/5  Wire the lifecycle hooks')
  expect(await ui.find({ type: 'Text', text: '▸ now 3/5  Wire the lifecycle hooks' })).toBeDefined()
  await ui.unmount()
})

test('terminal between tasks: the next task is named and the reviews open are counted beside the label', async ($, on) => {
  const { show } = band($, on)
  const between: Snapshot = {
    kind: 'executing',
    ref: 'SLU-123',
    title: 'Add the progress band',
    tasks: runOf(['done', 'done', 'next', 'waiting', 'waiting'], [0, 1]),
  }
  const { ui, head, title, line } = await show(between, 'terminal')

  expect(head).toBe(`${BAR_OF_FIVE}40%`)
  expect(title).toBe('●SLU-123 Add the progress band· 2 in review')
  expect(line).toBe('▸ next 3/5  Wire the lifecycle hooks')
  await ui.unmount()
})

test('terminal done: a full green bar, 100%, no reviews, and the count beneath', async ($, on) => {
  const { show } = band($, on)
  const { ui, head, title, line, tree } = await show(DONE, 'terminal')

  expect(head).toBe(`${BAR_OF_FIVE}100%`)
  expect(barRuns(tree)).toEqual([{ text: BAR_OF_FIVE, color: 'success' }])
  expect(title).toBe('●SLU-123 Add the progress band')
  expect(line).toBe('✓ 5/5 done')
  await ui.unmount()
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
  expect(await colorOfDot({ kind: 'creating', ref: 'SLU-123', created: 3 })).toBe('claude')
})

test('terminal creating: the tasks made so far fill slots of the bar, 0% where the percent goes, and no total', async ($, on) => {
  const { show } = band($, on)

  const three = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, 'terminal')
  expect(three.head).toBe(`${BAR_OF_THREE_SLOTS}0%`)
  // The plan is written after the tasks, so a run being created has no title yet.
  expect(three.title).toBe('●SLU-123')
  expect(three.line).toBe('▸ planning  3 tasks so far')
  expect(barRuns(three.tree)).toEqual([{ text: BAR_OF_THREE_SLOTS, color: 'subtle' }])
  await three.ui.unmount()

  const none = await show({ kind: 'creating', ref: 'SLU-123', created: 0 }, 'terminal')
  expect(none.head).toBe('0%')
  expect(none.line).toBe('▸ planning  no tasks yet')
  await none.ui.unmount()

  const one = await show({ kind: 'creating', ref: 'SLU-123', created: 1 }, 'terminal')
  expect(one.line).toBe('▸ planning  1 task so far')
  await one.ui.unmount()
})

test('desktop creating shows the tasks made so far with no total and no percent', async ($, on) => {
  const { show } = band($, on)
  const { ui, head, line } = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, 'desktop')

  expect(head.startsWith('●SLU-123 Progress band')).toBe(true)
  expect(head).not.toContain('%')
  expect(line).toBe('▸ planning  3 tasks so far')
  await ui.unmount()
})

test('terminal starting and unavailable say so in one dim line, without the brackets the desktop keeps', async ($, on) => {
  const { show } = band($, on)
  const reason = 'bd list exited 1: Error: no beads database found'

  const starting = await show({ kind: 'starting' }, 'terminal')
  expect(await starting.ui.find({ type: 'Text', text: 'fathom starting…' })).toBeDefined()
  expect(starting.tree?.props?.paddingTop).toBeUndefined()
  await starting.ui.unmount()

  const down = await show({ kind: 'unavailable', reason }, 'terminal')
  expect(await down.ui.find({ type: 'Text', text: `fathom unavailable: ${reason}` })).toBeDefined()
  await down.ui.unmount()

  const desktopStarting = await show({ kind: 'starting' }, 'desktop')
  expect(await desktopStarting.ui.find({ type: 'Text', text: '[fathom] starting…' })).toBeDefined()
  await desktopStarting.ui.unmount()

  const desktopDown = await show({ kind: 'unavailable', reason }, 'desktop')
  expect(await desktopDown.ui.find({ type: 'Text', text: /^\[fathom\] unavailable: bd list exited 1/ })).toBeDefined()
  await desktopDown.ui.unmount()
})

test('idle draws nothing, so the event passes on and beads-status can draw', async ($, on) => {
  const { show, wasNull } = band($, on)

  // With nothing beneath this mod to answer, the kit refuses to mount: the band yielded.
  await expect(show({ kind: 'idle' }, 'terminal')).rejects.toThrow(/no implementation for ui\.render/)
  expect(wasNull()).toBe(true)
})

test('a narrower terminal shortens the bar, and a row with no room for one shows the count instead', async ($, on) => {
  const { show } = band($, on)

  // 40 columns: 33 cells for the bar, of which 30 divide into five segments of six. The two
  // grey ones are one run of twelve.
  const shorter = await show(EXECUTING, 'terminal', 40)
  expect(barRuns(shorter.tree).map(r => r.text.length)).toEqual([6, 6, 6, 12])
  expect(shorter.head.endsWith('40%')).toBe(true)
  await shorter.ui.unmount()

  // 17 columns leave 11 cells, under the 12 a bar is worth.
  const narrow = await show(EXECUTING, 'terminal', 17)
  expect(narrow.head).toContain('2 of 5')
  expect(narrow.head).not.toContain('━')
  expect(narrow.head.endsWith('40%')).toBe(true)
  await narrow.ui.unmount()

  // More tasks than cells does too.
  const many: Snapshot = { kind: 'executing', ref: 'SLU-123', tasks: runOf(Array.from({ length: 80 }, () => 'waiting' as const)) }
  const crowded = await show(many, 'terminal', 80)
  expect(crowded.head).toContain('0 of 80')
  expect(crowded.head).not.toContain('━')
  await crowded.ui.unmount()
})

test('the second row is the ref and the issue\'s title, with the reviews open after it', async ($, on) => {
  const { show } = band($, on)
  const home: Snapshot = {
    kind: 'executing',
    ref: 'PHA-368',
    title: 'Home page: Restrict actions and CTAs, add video',
    tasks: runOf(['done', 'done', 'inProgress', 'waiting', 'waiting'], [1]),
  }

  const wide = await show(home, 'terminal', 100)
  expect(wide.title).toBe('●PHA-368 Home page: Restrict actions and CTAs, add video· 1 in review')
  // The label and the note are separate Texts, the note dim, and the dot keeps its color.
  expect(await wide.ui.find({ type: 'Text', text: 'PHA-368 Home page: Restrict actions and CTAs, add video' })).toBeDefined()
  expect(await wide.ui.find({ type: 'Text', text: '· 1 in review' })).toBeDefined()
  await wide.ui.unmount()

  // The desktop's band keeps its own label.
  const desktop = await show(home, 'desktop', 100)
  expect(desktop.head.startsWith('●PHA-368 Progress band')).toBe(true)
  await desktop.ui.unmount()
})

test('a title too long for the row is cut with an ellipsis, the reviews open stay while they fit, and the ref stays whole', async ($, on) => {
  const { show } = band($, on)
  const home: Snapshot = {
    kind: 'executing',
    ref: 'PHA-368',
    title: 'Home page: Restrict actions and CTAs, add video',
    tasks: runOf(['done', 'done', 'inProgress', 'waiting', 'waiting'], [1]),
  }

  // 40 columns: a cell in, the dot and its gap, leave 37. The note takes 14 with its gap, so the label gets 23.
  const medium = await show(home, 'terminal', 40)
  expect(medium.title).toBe('●PHA-368 Home page: Res…· 1 in review')
  await medium.ui.unmount()

  // 24 columns leave 21: the ref, a gap and the note need exactly that, so the note stays and the title has no room.
  const tight = await show(home, 'terminal', 24)
  expect(tight.title).toBe('●PHA-368· 1 in review')
  await tight.ui.unmount()

  // One column less and the note cannot fit beside the ref, so it goes and the label gets the row.
  const narrow = await show(home, 'terminal', 23)
  expect(narrow.title).toBe('●PHA-368 Home page:…')
  expect(narrow.title).not.toContain('review')
  await narrow.ui.unmount()

  // Without a note a long title still fits the row.
  const plain: Snapshot = { ...home, tasks: runOf(['done', 'done', 'inProgress', 'waiting', 'waiting']) }
  const noReviews = await show(plain, 'terminal', 40)
  expect(noReviews.title).toBe('●PHA-368 Home page: Restrict actions…')
  await noReviews.ui.unmount()
})

// Whether any Box under a node sets `prop`: the head row is laid out by what its parts
// measure, so the percent follows the bar and is not pushed to the end of the row.
function anyBoxSets(node: unknown, prop: string): boolean {
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
  if (!n || typeof n === 'string') return false
  return (n.type === 'Box' && n.props?.[prop] !== undefined) || (n.children ?? []).some(child => anyBoxSets(child, prop))
}

test('a wide window stretches the bar to fill it, and the percent stays with the bar', async ($, on) => {
  const { show } = band($, on)

  // 150 columns leave 144 cells, of which 140 divide into five segments of 28. The two grey
  // ones are one run of 56. There is no limit: 200 columns give segments of 38.
  const wide = await show(EXECUTING, 'terminal', 150)
  expect(barRuns(wide.tree).map(r => r.text.length)).toEqual([28, 28, 28, 56])
  expect(wide.head.endsWith('40%')).toBe(true)
  // Nothing in the row grows or aligns to push the percent to the end.
  expect(anyBoxSets(wide.tree, 'flexGrow')).toBe(false)
  expect(anyBoxSets(wide.tree, 'justifyContent')).toBe(false)
  await wide.ui.unmount()

  const wider = await show(EXECUTING, 'terminal', 200)
  expect(barRuns(wider.tree).map(r => r.text.length)).toEqual([38, 38, 38, 76])
  await wider.ui.unmount()
})

test('the line beneath is cut to the row, a cell in from the left', async ($, on) => {
  const { show } = band($, on)
  const { ui, line } = await show(EXECUTING, 'terminal', 24)

  // 24 columns less the cell of padding: the lead, then the title cut with an ellipsis.
  expect(line).toHaveLength(23)
  expect(line.startsWith('▸ now 3/5  Wire')).toBe(true)
  expect(line.endsWith('…')).toBe(true)
  await ui.unmount()
})

test('nine tasks, the over-seven case, still draw a bar with every task in it', async ($, on) => {
  const { show } = band($, on)
  const nine: Snapshot = {
    kind: 'executing',
    ref: 'SLU-123',
    tasks: runOf(['done', 'done', 'done', 'inProgress', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']),
  }
  // 74 cells, of which 72 divide into nine segments of eight, with eight half lines between them.
  // The three done are one run, the one in progress is a run, and the five waiting are a run.
  const terminal = await show(nine, 'terminal')
  expect(barRuns(terminal.tree).map(r => [r.color, r.text.length])).toEqual([['success', 24], ['warning', 8], ['subtle', 40]])
  expect([...terminal.head].filter(c => c === '━' || c === '╸')).toHaveLength(72)
  expect([...terminal.head].filter(c => c === '╸')).toHaveLength(8)
  expect(terminal.head.endsWith('33%')).toBe(true)
  expect(terminal.line).toContain('now 4/9')
  await terminal.ui.unmount()

  // On the desktop the nine segments are too narrow for `3 of 9`; each task still has its
  // own segment and its icon, and the line beneath and the percent carry the count.
  const desktop = await show(nine, 'desktop')
  expect(filledBoxes(desktop.tree)).toHaveLength(9)
  expect([...desktop.head].filter(c => c === '✓')).toHaveLength(3)
  expect(desktop.head).not.toContain('━')
  expect(desktop.line).toContain('now 4/9')
  await desktop.ui.unmount()
})

test('desktop planned, executing and done keep the head row, the bar with its step text, and the note on the line beneath', async ($, on) => {
  const { show } = band($, on)

  const planned = await show(PLANNED, 'desktop')
  expect(planned.head.startsWith('●SLU-123 Progress band')).toBe(true)
  expect(planned.head).toContain('0 of 5')
  expect(planned.head.endsWith('  0%')).toBe(true)
  expect(planned.line).toBe('▸ next 1/5  Draft the plan doc')
  await planned.ui.unmount()

  const executing = await show(EXECUTING, 'desktop')
  expect(executing.head).toContain('2 of 5')
  expect(executing.head).toContain('◐')
  expect(executing.head).toContain('●')
  expect(executing.head.endsWith(' 40%')).toBe(true)
  expect(executing.line).toBe('▸ now 3/5  Wire the lifecycle hooks  · 1 in review')
  await executing.ui.unmount()

  const done = await show(DONE, 'desktop')
  expect(done.head).toContain('5 of 5')
  expect(done.head.endsWith('100%')).toBe(true)
  expect(done.line).toBe('✓ 5/5 done')
  await done.ui.unmount()
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
  expect(head).not.toContain('━')
  expect(line).toBe('▸ now 3/5  Wire the lifecycle hooks  · 1 in review')
  await ui.unmount()
})

test('on the desktop with no palette for the theme the bar is boxes in the theme\'s colors, never block characters; the terminal keeps its thin bar', async ($, on) => {
  const { show } = band($, on)

  const unknownTheme = await show(EXECUTING, 'desktop', 80, null)
  expect(await unknownTheme.ui.find({ type: 'Svg' })).toBeUndefined()
  // One box per task: done, done with a review open, in progress, and two waiting.
  const boxes = filledBoxes(unknownTheme.tree)
  expect(boxes.map(b => b.color)).toEqual(['success', 'claude', 'warning', 'subtle', 'subtle'])
  expect(new Set(boxes.map(b => b.width)).size).toBe(1)
  expect(unknownTheme.head).toContain('2 of 5')
  expect(unknownTheme.head).not.toContain('━')
  await unknownTheme.ui.unmount()

  // A palette is for the desktop's Svg; the terminal ignores it and draws no filled box.
  const terminal = await show(EXECUTING, 'terminal', 80, DARK)
  expect(terminal.head).toContain('━')
  expect(terminal.head).not.toContain('of')
  expect(filledBoxes(terminal.tree)).toHaveLength(0)
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
  expect(creating.head).not.toContain('━')
  await creating.ui.unmount()

  // With no palette for the theme it is three blank boxes in the theme's grey, not blocks.
  const plain = await show({ kind: 'creating', ref: 'SLU-123', created: 3 }, 'desktop', 80, null)
  expect(await plain.ui.find({ type: 'Svg' })).toBeUndefined()
  expect(filledBoxes(plain.tree).map(b => [b.color, b.width])).toEqual([['subtle', 4], ['subtle', 4], ['subtle', 4]])
  expect(plain.head).not.toContain('━')
  await plain.ui.unmount()
})
