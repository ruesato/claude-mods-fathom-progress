import { test, expect } from 'claude-code/testing'

import type { RunTask, TaskState } from '../types'
import { allocate } from './bar'
import { barCells, barWidth, equalWidth, growingCells, lineText, lookOf, stepText, toSpans } from './draw'
import type { Cell } from './draw'

const task = (state: TaskState, isInReview = false): RunTask => ({
  id: state,
  ref: null,
  title: `${state} task`,
  state,
  isInReview,
})

const chars = (cells: readonly Cell[]) => cells.map(c => c.char).join('')
const sp = (n: number) => ' '.repeat(n)

// Five equal segments across 48 cells are 10, 10, 10, 9 and 9 wide: the cells left
// over after 9 each go to the first segments. Every segment but the last ends in the
// 7/8 block, and starts with its icon one cell in. The step text `done of total` is
// written over the last segment, flush right, with a blank cell between it and the icon.

test('planned: nothing is marked, since next and waiting are plain grey, and the step text reads 0 of 5', async () => {
  const cells = barCells([task('next'), task('waiting'), task('waiting'), task('waiting'), task('waiting')], 48)

  expect(chars(cells)).toBe(`${sp(9)}▉` + `${sp(9)}▉` + `${sp(9)}▉` + `${sp(8)}▉` + '  0 of 5 ')
  expect(cells).toHaveLength(48)
})

test('executing: done, done with a review open, in progress, two waiting; the step text counts the done ones', async () => {
  const tasks = [task('done'), task('done', true), task('inProgress'), task('waiting'), task('waiting')]
  const cells = barCells(tasks, 48)

  expect(chars(cells)).toBe(` ✓${sp(7)}▉` + ` ◐${sp(7)}▉` + ` ●${sp(7)}▉` + `${sp(8)}▉` + '  2 of 5 ')
  expect(cells[1]).toMatchObject({ char: '✓', backgroundColor: 'success' })
  expect(cells[11]).toMatchObject({ char: '◐', backgroundColor: 'claude' })
})

test('finished: every segment is done and the step text reads 5 of 5 over the last, in its green', async () => {
  const cells = barCells(Array.from({ length: 5 }, () => task('done')), 48)

  expect(chars(cells)).toBe(` ✓${sp(7)}▉` + ` ✓${sp(7)}▉` + ` ✓${sp(7)}▉` + ` ✓${sp(6)}▉` + '  5 of 5 ')
})

test('the step text is bold in its segment\'s own fill, with no badge of its own and a blank cell of that fill after it', async () => {
  const cells = barCells([task('done'), task('done'), task('done'), task('waiting'), task('waiting')], 48)

  // The last segment is waiting: dark grey, plain text. Cells 39-40 are blank, 41-46 are
  // the text, and 47 is the margin after it.
  for (const cell of cells.slice(39, 41)) {
    expect(cell).toMatchObject({ char: ' ', color: 'text', backgroundColor: 'subtle', isBold: false })
  }
  for (const cell of cells.slice(41, 47)) {
    expect(cell).toMatchObject({ color: 'text', backgroundColor: 'subtle', isBold: true })
  }
  expect(cells[47]).toMatchObject({ char: ' ', color: 'text', backgroundColor: 'subtle', isBold: false })

  const finished = barCells(Array.from({ length: 5 }, () => task('done')), 48)
  for (const cell of finished.slice(41, 47)) {
    expect(cell).toMatchObject({ color: 'inverseText', backgroundColor: 'success', isBold: true })
  }
  expect(finished[47]).toMatchObject({ char: ' ', backgroundColor: 'success', isBold: false })
})

test('a last segment with room for its icon, a blank, the text and a margin keeps its icon', async () => {
  // Five tasks across 50 cells are ten wide: blank, icon, blank, six of text, margin.
  const finished = barCells(Array.from({ length: 5 }, () => task('done')), 50)
  const running = barCells([task('done'), task('done'), task('done'), task('done'), task('inProgress')], 50)

  expect(chars(finished)).toBe(` ✓${sp(7)}▉`.repeat(4) + ' ✓ 5 of 5 ')
  expect(chars(running)).toBe(` ✓${sp(7)}▉`.repeat(4) + ' ● 4 of 5 ')
  expect(finished).toHaveLength(50)
})

test('stepText says how many are closed out of how many', async () => {
  expect(stepText(0, 5)).toBe('0 of 5')
  expect(stepText(12, 12)).toBe('12 of 12')
})

test('done, in review and in progress each have an icon and a color of their own, and next and waiting are plain dark grey', async () => {
  const look = (state: TaskState, isInReview = false) => barCells([task(state, isInReview)], 8)[1]

  expect(look('waiting')).toMatchObject({ char: ' ', color: 'text', backgroundColor: 'subtle' })
  expect(look('next')).toMatchObject({ char: ' ', color: 'text', backgroundColor: 'subtle' })
  expect(look('inProgress')).toMatchObject({ char: '●', color: 'inverseText', backgroundColor: 'warning' })
  expect(look('done')).toMatchObject({ char: '✓', color: 'inverseText', backgroundColor: 'success' })
  expect(look('done', true)).toMatchObject({ char: '◐', color: 'inverseText', backgroundColor: 'claude' })

  const marked = [lookOf(task('inProgress')), lookOf(task('done')), lookOf(task('done', true))].map(l => l.icon)
  expect(new Set(marked).size).toBe(3)
  expect(lookOf(task('waiting')).icon).toBe('')
  expect(lookOf(task('next')).icon).toBe('')
})

test('segments are as equal as whole cells allow, for any number of tasks including more than seven', async () => {
  for (const count of [1, 2, 3, 7, 8, 9, 12]) {
    const tasks = Array.from({ length: count }, () => task('waiting'))
    const widths = allocate(tasks.map(() => 1), 48)

    expect(widths).toHaveLength(count)
    expect(widths.reduce((sum, w) => sum + w, 0)).toBe(48)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    expect(barCells(tasks, 48)).toHaveLength(48)
  }
})

test('with no segment edge hidden, a bar of n tasks has n - 1 edges and nothing else breaks the rows into uneven runs', async () => {
  // Five tasks, no step text hiding an edge: the text sits in the last segment.
  const text = chars(barCells(Array.from({ length: 5 }, () => task('waiting')), 48))

  expect([...text].filter(c => c === '▉')).toHaveLength(4)
})

test('a bar too narrow for the step text leaves it out, and keeps one cell for every task it can', async () => {
  const cells = barCells([task('done')], 8)

  expect(chars(cells)).not.toContain('of')
  expect(cells).toHaveLength(8)
})

test('while the run is made, each task takes a four-cell segment and the rest of the bar stays blank', async () => {
  expect(chars(growingCells(0, 48))).toBe(sp(48))
  expect(chars(growingCells(3, 48))).toBe('   ▉'.repeat(3) + sp(36))
  expect(chars(growingCells(99, 48))).toBe('   ▉'.repeat(12))
  expect(growingCells(3, 48)).toHaveLength(48)
})

test('toSpans folds runs of one style into one span, so the bar is a handful of elements', async () => {
  const cells = barCells([task('done'), task('done', true), task('inProgress'), task('waiting'), task('waiting')], 48)
  const spans = toSpans(cells)

  expect(spans.map(s => s.text).join('')).toBe(chars(cells))
  expect(spans.length).toBeLessThan(cells.length / 2)
  for (let i = 1; i < spans.length; i++) {
    const [a, b] = [spans[i - 1], spans[i]]
    expect(a?.color === b?.color && a?.backgroundColor === b?.backgroundColor && a?.isBold === b?.isBold).toBe(false)
  }
})

test('the bar takes what the row leaves after the dot, label, gaps and percent, up to 50 cells', async () => {
  const label = 'SLU-123 Progress band'

  expect(barWidth(80, label)).toBe(50)
  expect(barWidth(78, label)).toBe(49)
  expect(barWidth(60, label)).toBe(31)
  expect(barWidth(30, label)).toBe(1)
})

test('lineText joins the lead, the title and the note with two spaces', async () => {
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '· 2 in review', 78)).toBe('▸ now 3/5  Wire the lifecycle hooks  · 2 in review')
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '', 78)).toBe('▸ now 3/5  Wire the lifecycle hooks')
  expect(lineText('▸ planning', '', '', 78)).toBe('▸ planning')
})

test('lineText cuts the title with an ellipsis to keep the note, and drops the note only when it cannot fit beside the lead', async () => {
  // 40 columns: lead 9, note 13, two gaps of 2 leave 40 - 9 - 2 - 2 - 13 = 14 for the title.
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '· 2 in review', 40)).toBe('▸ now 3/5  Wire the life…  · 2 in review')
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '· 2 in review', 40)).toHaveLength(40)
  // 24 columns hold the lead, a gap and the note exactly, with no room left for the title.
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '· 2 in review', 24)).toBe('▸ now 3/5  · 2 in review')
  // One column less and the note cannot fit with the lead, so it goes and the title keeps the room.
  expect(lineText('▸ now 3/5', 'Wire the lifecycle hooks', '· 2 in review', 23)).toBe('▸ now 3/5  Wire the li…')
})

test('equalWidth trims the bar to a multiple of the task count, so every segment is the same width', async () => {
  expect(equalWidth(48, 5)).toBe(45)
  expect(equalWidth(48, 7)).toBe(42)
  expect(equalWidth(48, 9)).toBe(45)
  expect(equalWidth(48, 4)).toBe(48)
  expect(equalWidth(48, 1)).toBe(48)
  // Fewer cells than tasks leaves no bar, and no tasks has none to size.
  expect(equalWidth(7, 12)).toBe(0)
  expect(equalWidth(48, 0)).toBe(0)

  for (const count of [2, 3, 5, 6, 7, 9, 11]) {
    const widths = allocate(Array.from({ length: count }, () => 1), equalWidth(48, count))
    expect(new Set(widths).size).toBe(1)
  }
})
