import type { EngineInterface } from 'claude-code'

import type { RunTask, Snapshot } from '../types'
import { SEGMENT_EDGE, allocate } from './bar'
import { currentOf, progressOf } from './state'

// The element table `$.ui.resolve(e)` returns. This file never sees `$`: the engine
// follows `$` only within the file that receives it, so register.tsx resolves the
// elements and fetches the data, and this file only draws them. It draws with Box and
// Text alone, which both the terminal and the desktop app render.
type Ui = ReturnType<EngineInterface['ui']['resolve']>

// What a segment looks like per state. Colors are theme keys, so the band follows the
// person's theme; `icon` is the first mark in the segment, so the states that matter
// never rest on color alone. `text` is the key that reads on the fill. The design (the
// A1-A3 frames) fills only the done and in-review part of the bar: done is `success`, a
// done task whose review is open is `claude`, and every other segment is track. The
// terminal keeps that, with the one in progress a step lighter and marked. A task that
// is next or waiting is plain dark grey with no mark: grey and unmarked means not
// started, and the line under the bar names which one is next. Nothing else is coral
// or green, so those two read as "done" and "in review" and nothing else.
const LOOKS = {
  waiting: { color: 'subtle', text: 'text', icon: '' },
  next: { color: 'subtle', text: 'text', icon: '' },
  inProgress: { color: 'inactive', text: 'inverseText', icon: '●' },
  done: { color: 'success', text: 'inverseText', icon: '✓' },
  review: { color: 'claude', text: 'inverseText', icon: '◐' },
} as const

export function lookOf(task: Pick<RunTask, 'state' | 'isInReview'>) {
  return task.isInReview ? LOOKS.review : LOOKS[task.state]
}

const DOT = '●'
const LABEL_SUFFIX = ' Progress band'
// `100%`, right-aligned.
const PERCENT_COLS = 4
// The dot and the gap after it, which the second row leaves blank so its text lines up
// with the label above.
const INSET = 2
// The engine draws its `[-]` on the first row of the band, so a row of padding keeps
// the bar clear of it, as the beads-status band does.
const TOP_GAP = 1
// The most cells the bar gets. Five tasks of ten cells each have room in the last
// segment for its icon, a blank, `5 of 5` and a blank after it; at nine they do not.
// The design's bar is 420px, about 47 cells, and this is 50, about 450px.
const BAR_CELLS = 50
// Below this many cells a bar says too little to be worth its row; the row falls back
// to the count.
const MIN_BAR_CELLS = 12
// The dot, the gaps between the dot, the label, the bar and the percent, and the percent.
const CHROME = 1 + 3 + PERCENT_COLS

// One character cell of the bar, and a run of cells that share a style.
export type Cell = {
  char: string
  color: string | undefined
  backgroundColor: string | undefined
  isBold: boolean
}
export type Span = { text: string; color: string | undefined; backgroundColor: string | undefined; isBold: boolean }

function cell(char: string, color?: string, backgroundColor?: string, isBold = false): Cell {
  return { char, color, backgroundColor, isBold }
}

// How many cells the bar gets on a row `bodyColumns` wide. `bodyColumns` already
// leaves out the engine's cells at the right end.
export function barWidth(bodyColumns: number, label: string): number {
  return Math.min(BAR_CELLS, bodyColumns - label.length - CHROME)
}

// The bar's width for `count` equal segments in `room` cells: the largest multiple of
// the count that fits, so every segment is the same width. Splitting 48 cells five ways
// leaves three over, and those went to the first segments, which showed as a one-cell
// step between them. The bar is a few cells shorter instead (45 for five tasks). This
// goes when Fathom records sizes, since then the widths are meant to differ.
export function equalWidth(room: number, count: number): number {
  return count > 0 ? Math.floor(room / count) * count : 0
}

// The bar as cells: one segment per task, all the same width for now. Every segment
// but the last ends in the 7/8 block that bar.ts draws the gap with, and starts with
// its icon (one cell in, when the segment is wide enough to inset it).
//
// The step text, `done of total`, is written over the end of the bar in each cell's own
// fill, with a blank cell of the segment's fill after it. The design's head pill is left
// out of the terminal version: five cells of a 48-cell bar, drawn over the segments
// beneath it, it read as extra spacing between them. The last segment keeps its icon only
// when it holds the icon, a blank, the text and the blank after it; narrower than that,
// the text keeps its margin and the segment goes unmarked.
//
// Widths are equal because no task records a size. When Fathom records one, the one
// line to change is the values `allocate` splits the cells by: a task's size where
// there is one, 1 where there is not.
const TEXT_MARGIN = 1

export function barCells(tasks: readonly RunTask[], cells: number): Cell[] {
  const widths = allocate(
    tasks.map(() => 1),
    cells,
  )
  const { done, total } = progressOf(tasks)
  const text = stepText(done, total)
  const hasText = cells >= text.length * 2 + 2
  const row: Cell[] = []

  tasks.forEach((task, i) => {
    const look = lookOf(task)
    const width = widths[i] ?? 0
    const isLast = i === tasks.length - 1
    const fill = isLast ? width : width - 1
    const iconAt = fill >= 3 ? 1 : 0
    const hasRoom = !isLast || !hasText || width >= text.length + TEXT_MARGIN + 3

    for (let c = 0; c < fill; c++) {
      row.push(cell(c === iconAt && look.icon && hasRoom ? look.icon : ' ', look.text, look.color))
    }
    if (!isLast && width > 0) row.push(cell(SEGMENT_EDGE, look.color))
  })

  if (hasText) {
    const start = cells - TEXT_MARGIN - text.length
    for (let k = 0; k < text.length; k++) {
      const under = row[start + k]
      // A segment's gap cell has no fill of its own, so its text reads as plain text.
      row[start + k] = cell(text[k] ?? ' ', under?.backgroundColor ? under.color : 'text', under?.backgroundColor, true)
    }
  }
  return row
}

// How many tasks are closed, out of how many: the text the design puts in the pill.
export function stepText(done: number, total: number): string {
  return `${done} of ${total}`
}

// While the run is still being made there is no total to divide the bar by, so each
// task made takes a segment of its own width and the bar fills from the left as they
// come, up to what the bar holds. The rest is blank.
const GROWING_WIDTH = 4

export function growingCells(created: number, cells: number): Cell[] {
  const row: Cell[] = []
  const shown = Math.min(created, Math.floor(cells / GROWING_WIDTH))
  const look = LOOKS.waiting
  for (let i = 0; i < shown; i++) {
    row.push(cell(' ', look.text, look.color), cell(' ', look.text, look.color), cell(' ', look.text, look.color))
    row.push(cell(SEGMENT_EDGE, look.color))
  }
  while (row.length < cells) row.push(cell(' '))
  return row
}

// Runs of cells with one style become one Text, so a 48-cell bar is a handful of
// elements, not 48.
export function toSpans(cells: readonly Cell[]): Span[] {
  const spans: Span[] = []
  for (const c of cells) {
    const last = spans[spans.length - 1]
    if (last && last.color === c.color && last.backgroundColor === c.backgroundColor && last.isBold === c.isBold) {
      last.text += c.char
    } else {
      spans.push({ text: c.char, color: c.color, backgroundColor: c.backgroundColor, isBold: c.isBold })
    }
  }
  return spans
}

type Head = {
  dot: string
  label: string
  // The bar, or null when the row is too narrow for one: the count stands in.
  bar: Span[] | null
  count: string
  percent: string
}

// The first row: a dot for the run's state, the label, the bar, and the percent. The
// gaps between them are layout, not text, so each part can be found on its own.
function drawHead(ui: Ui, head: Head) {
  const { Box, Text } = ui
  return (
    <Box columnGap={1}>
      <Box flexShrink={0}>
        <Text color={head.dot}>{DOT}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text>{head.label}</Text>
      </Box>
      <Box flexShrink={0}>
        {head.bar ? (
          <Text wrap="truncate">
            {head.bar.map((s, i) => (
              <Text key={i} color={s.color} backgroundColor={s.backgroundColor} bold={s.isBold}>
                {s.text}
              </Text>
            ))}
          </Text>
        ) : (
          <Text dimColor>{head.count}</Text>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text bold>{head.percent}</Text>
      </Box>
    </Box>
  )
}

// The line under the bar as one string: the lead, the title cut to what is left of
// the row, and the note after it, two spaces apart. It is plain text, not boxes that
// grow and shrink, so what it shows does not depend on how a surface lays flex out.
// The note goes first when the row is too narrow for it, then the title is cut with an
// ellipsis.
export function lineText(lead: string, title: string, note: string, columns: number): string {
  const gap = 2
  const hasNote = note !== '' && lead.length + gap + note.length <= columns
  const room = columns - lead.length - gap - (hasNote ? gap + note.length : 0)
  const shown = title.length <= room ? title : room > 1 ? `${title.slice(0, room - 1)}…` : ''
  return [lead, shown, hasNote ? note : ''].filter(part => part !== '').join(' '.repeat(gap))
}

function drawLine(ui: Ui, text: string) {
  const { Box, Text } = ui
  return (
    <Box paddingLeft={INSET}>
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

function percentText(percent: number): string {
  return `${percent}%`.padStart(PERCENT_COLS)
}

// The band for a snapshot, or null when there is nothing to draw (the caller passes the
// event on, so beads-status can draw there).
export function drawBand(ui: Ui, bodyColumns: number, snapshot: Snapshot) {
  const { Box, Text } = ui

  if (snapshot.kind === 'idle') return null

  if (snapshot.kind === 'starting') {
    return (
      <Box paddingTop={TOP_GAP}>
        <Text dimColor>[fathom] starting…</Text>
      </Box>
    )
  }

  if (snapshot.kind === 'unavailable') {
    return (
      <Box paddingTop={TOP_GAP}>
        <Text dimColor wrap="truncate-end">{`[fathom] unavailable: ${snapshot.reason}`}</Text>
      </Box>
    )
  }

  const label = `${snapshot.ref}${LABEL_SUFFIX}`
  const room = barWidth(bodyColumns, label)

  if (snapshot.kind === 'creating') {
    const made = snapshot.created
    const head = drawHead(ui, {
      dot: 'claude',
      label,
      bar: room >= MIN_BAR_CELLS ? toSpans(growingCells(made, room)) : null,
      count: `${made}`,
      percent: ' '.repeat(PERCENT_COLS),
    })
    return (
      <Box flexDirection="column" paddingTop={TOP_GAP}>
        {head}
        {drawLine(ui, lineText('▸ planning', made === 0 ? 'no tasks yet' : `${made} task${made === 1 ? '' : 's'} so far`, '', bodyColumns - INSET))}
      </Box>
    )
  }

  const { tasks } = snapshot
  const isFinished = snapshot.kind === 'finished'
  const { done, total, percent } = progressOf(tasks)
  const hasStarted = tasks.some(t => t.state === 'done' || t.state === 'inProgress')
  // Grey until the first task starts, the band's own color while it runs, green once done.
  const dot = isFinished ? LOOKS.done.color : hasStarted ? 'claude' : 'inactive'
  // More tasks than cells cannot each have one, so the row falls back to the count.
  const cells = equalWidth(room, tasks.length)
  const hasBar = tasks.length > 0 && cells >= Math.max(MIN_BAR_CELLS, tasks.length)

  const head = drawHead(ui, {
    dot,
    label,
    bar: hasBar ? toSpans(barCells(tasks, cells)) : null,
    count: stepText(done, total),
    percent: percentText(percent),
  })

  if (isFinished) {
    return (
      <Box flexDirection="column" paddingTop={TOP_GAP}>
        {head}
        {drawLine(ui, `✓ ${total}/${total} done`)}
      </Box>
    )
  }

  // The line under the bar names the task in progress, else the next one; with neither
  // (between two tasks) it only counts.
  const current = currentOf(tasks)
  const task = current ? tasks[current.index] : undefined
  const lead = current
    ? `▸ ${current.state === 'inProgress' ? 'now' : 'next'} ${current.index + 1}/${total}`
    : `▸ ${done}/${total} done`
  const reviews = tasks.filter(t => t.isInReview).length

  return (
    <Box flexDirection="column" paddingTop={TOP_GAP}>
      {head}
      {drawLine(ui, lineText(lead, task?.title ?? '', reviews > 0 ? `· ${reviews} in review` : '', bodyColumns - INSET))}
    </Box>
  )
}
