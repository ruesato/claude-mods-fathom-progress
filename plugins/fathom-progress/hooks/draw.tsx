import type { EngineInterface } from 'claude-code'

import type { RunTask, Snapshot } from '../types'
import { allocate } from './bar'
import { CELL_PX, PERCENT_CELLS, barSvg, desktopBarWidth, growingSvg } from './desktop'
import type { Palette } from './desktop'
import { currentOf, progressOf } from './state'

// The element table `$.ui.resolve(e)` returns. This file never sees `$`: the engine
// follows `$` only within the file that receives it, so register.tsx resolves the
// elements and fetches the data, and this file only draws them. It draws with Box and
// Text alone, which both the terminal and the desktop app render.
type Ui = ReturnType<EngineInterface['ui']['resolve']>

// What a segment looks like per state. Colors are theme keys, so the band follows the
// person's theme; `icon` is the first mark in a desktop segment, so the states that matter
// never rest on color alone there. `text` is the key that reads on the fill. The design's
// state legend gives each state a color: done is `success`, a done task whose review is
// open is `claude`, the one in progress is `warning` (yellow) and marked. A task that is
// next or waiting is plain dark grey with no mark: grey and unmarked means not started,
// and the line under the bar names which one is next. Nothing else is coral, green or
// yellow, so those three read as "in review", "done" and "in progress" and nothing else.
// The terminal's bar is 5px tall, too thin to hold a mark, so it carries `color` alone and
// the rows beneath it say what the colors cannot (`· 2 in review`, `▸ now 3/5`).
const LOOKS = {
  waiting: { color: 'subtle', text: 'text', icon: '' },
  next: { color: 'subtle', text: 'text', icon: '' },
  inProgress: { color: 'warning', text: 'inverseText', icon: '●' },
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
// Desktop: the dot and the gap after it, which the line under the bar leaves blank so
// its text lines up with the label above.
const INSET = 2
// Desktop: the engine draws its `[-]` on the first row of the band, so a row of padding
// keeps the bar clear of it, as the beads-status band does. The terminal takes no gap:
// its first row is the bar with the percent at its end, and the `[-]` sits beside it as in
// the design, since `bodyColumns` already leaves out the engine's cells.
const TOP_GAP = 1

// The terminal's rows follow the States frame of the design (Figma 59:791): the bar on
// a row of its own with the percent right after it, then the dot, ref and label with the
// reviews open, then the dim line. The bar fills the row, as in the later frame (64:792):
// it takes every cell the left padding, the gap and the percent leave. The engine's `[-]`
// sits beyond `bodyColumns`, so the bar never grows into its space.
//
// The design's bar is 5px tall in a 19px row. A heavy horizontal line is the nearest a
// cell draws that sits in the middle of its row, as the design's bar does, and neighbors
// join without a seam.
const BAR_GLYPH = '━'
// The design leaves 2px between segments. No line character stops closer to a cell's edge
// than its middle, so every segment but the last ends in a heavy half line, drawn from the
// left edge of its cell to the middle. That leaves half a cell (about 4.5px) between
// segments. The beads-status band gets about 1px with a 7/8 block, but those are full-height.
const SEGMENT_EDGE = '╸'
// The design's 8px of padding at the left of a row, as a cell. The bar's row has none on
// the right: the percent ends a cell from the engine's `[-]`, as in the design.
const PAD = 1
// Below this many cells a bar says too little to be worth its row; the row falls back
// to the count.
const MIN_BAR_CELLS = 12
// The padding on the left, the gap between the bar and the percent, and the percent's
// columns. The bar leaves all four free whatever the percent reads, so it does not change
// width when the percent gains a digit.
const CHROME = PAD + 1 + PERCENT_COLS
// While the run is still being made there is no total to divide the bar by, so it is this
// many equal slots and each task made fills one, from the left.
const GROWING_SLOTS = 5

// One character cell of the bar, and a run of cells that share a color.
export type Cell = { char: string; color: string | undefined }
export type Span = { text: string; color: string | undefined }

function cell(char: string, color?: string): Cell {
  return { char, color }
}

// How many cells the bar gets on a row `bodyColumns` wide: all that the padding, the gap
// and the percent leave, with no upper limit. `bodyColumns` already leaves out the
// engine's cells at the right end.
export function barWidth(bodyColumns: number): number {
  return bodyColumns - CHROME
}

// The cells for `count` equal segments in `room` cells: the largest multiple of the
// count that fits, so every segment is the same width. Splitting 48 cells five ways
// leaves three over, and those went to the first segments, which showed as a one-cell
// step between them. The bar is a few cells shorter instead (45 for five tasks). This
// goes when Fathom records sizes, since then the widths are meant to differ.
export function equalWidth(room: number, count: number): number {
  return count > 0 ? Math.floor(room / count) * count : 0
}

// A segment of `width` cells: heavy lines, with the last cell a half line when another
// segment follows it, which is the gap.
function segmentCells(width: number, color: string, hasNext: boolean): Cell[] {
  return Array.from({ length: width }, (_, c) => cell(hasNext && c === width - 1 ? SEGMENT_EDGE : BAR_GLYPH, color))
}

// The bar as cells: one segment per task, all the same width for now, each but the last
// ending in the half line that makes the gap. A segment is its state's color and nothing
// else: the design's bar has no icons and no step text. It may be shorter than `cells` (the
// largest that divides evenly), and empty when there is not a cell for every task.
//
// Widths are equal because no task records a size. When Fathom records one, the one
// line to change is the values `allocate` splits the cells by: a task's size where
// there is one, 1 where there is not.
export function barCells(tasks: readonly RunTask[], cells: number): Cell[] {
  const fill = equalWidth(cells, tasks.length)
  if (tasks.length === 0 || fill < tasks.length) return []

  const widths = allocate(
    tasks.map(() => 1),
    fill,
  )
  return tasks.flatMap((task, i) => segmentCells(widths[i] ?? 0, lookOf(task).color, i < tasks.length - 1))
}

// How many tasks are closed, out of how many.
export function stepText(done: number, total: number): string {
  return `${done} of ${total}`
}

// While the run is still being made, each task made takes one of the bar's slots and the
// rest is blank. More tasks than slots leave the bar full; the line beneath counts them.
export function growingCells(created: number, cells: number): Cell[] {
  const slot = Math.floor(cells / GROWING_SLOTS)
  if (slot < 1) return []
  const shown = Math.min(created, GROWING_SLOTS)
  const { color } = LOOKS.waiting
  return Array.from({ length: shown }).flatMap((_, i) => segmentCells(slot, color, i < shown - 1))
}

// Runs of cells with one color become one Text, so a bar of any width is a handful of
// elements, not one for each cell.
export function toSpans(cells: readonly Cell[]): Span[] {
  const spans: Span[] = []
  for (const c of cells) {
    const last = spans[spans.length - 1]
    if (last && last.color === c.color) {
      last.text += c.char
    } else {
      spans.push({ text: c.char, color: c.color })
    }
  }
  return spans
}

// The desktop's bar for a theme that has no Svg palette: one Box per task, its background
// a theme key and its width in cells, so it follows the theme and needs no block
// characters, which do not line up in the desktop's proportional font. A cell is CELL_PX
// there. There is no rounded corner or pill; the icons and the step text are the same.
const DESKTOP_GAP = 1
// While the tasks are made each takes this many cells of the bar.
const GROW_CELLS = 4
// A segment needs a cell of padding each side and room for an icon to carry one; the step
// text `N of M` takes about 5 cells, and with the icon beside it the last segment needs 9.
const MIN_SEGMENT_CELLS = 3
const STEP_CELLS = 6
const STEP_ICON_CELLS = 9

export type DesktopSegment = { width: number; color: string; textColor: string; icon: string; step: string }

// Equal segments with a gap between, across `room` cells; none when they would be too
// narrow to mark. The step text sits in the last, with its icon dropped when the two do
// not fit together.
export function desktopSegments(tasks: readonly RunTask[], room: number): DesktopSegment[] {
  const count = tasks.length
  if (count === 0) return []
  const width = Math.floor((room - (count - 1) * DESKTOP_GAP) / count)
  if (width < MIN_SEGMENT_CELLS) return []
  const { done, total } = progressOf(tasks)
  return tasks.map((task, i) => {
    const look = lookOf(task)
    const hasStep = i === count - 1 && width >= STEP_CELLS
    const hasIcon = look.icon !== '' && (!hasStep || width >= STEP_ICON_CELLS)
    return { width, color: look.color, textColor: look.text, icon: hasIcon ? look.icon : '', step: hasStep ? stepText(done, total) : '' }
  })
}

// One blank piece for each task made so far, as many as the room holds, and at least one.
export function growingSegments(made: number, room: number): DesktopSegment[] {
  const fit = Math.max(1, Math.floor((room + DESKTOP_GAP) / (GROW_CELLS + DESKTOP_GAP)))
  const { color, text } = LOOKS.waiting
  return Array.from({ length: Math.min(Math.max(1, made), fit) }, () => ({ width: GROW_CELLS, color, textColor: text, icon: '', step: '' }))
}

function drawSegments(ui: Ui, segments: readonly DesktopSegment[]) {
  const { Box, Text } = ui
  return (
    <Box columnGap={DESKTOP_GAP}>
      {segments.map((seg, i) => (
        <Box
          key={`segment-${i}`}
          width={seg.width}
          height={1}
          backgroundColor={seg.color}
          paddingX={1}
          justifyContent={seg.icon && seg.step ? 'space-between' : seg.step ? 'flex-end' : 'flex-start'}
        >
          {seg.icon ? <Text color={seg.textColor}>{seg.icon}</Text> : null}
          {seg.step ? (
            <Text color={seg.textColor} bold>
              {seg.step}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

type Head = {
  dot: string
  label: string
  // The desktop's bar, an Svg, which takes the bar's place when there is one.
  svg?: { source: string; alt: string; width: number; height: number } | null
  // The desktop's bar for a theme with no Svg palette, which takes it when there is one.
  segments?: DesktopSegment[] | null
  count: string
  percent: string
}

// The desktop's first row: a dot for the run's state, the label, the bar, and the percent.
// The gaps between them are layout, not text, so each part can be found on its own.
function drawHead(ui: Ui, head: Head) {
  const { Box, Text } = ui
  // Only the desktop's element table has Svg.
  const Svg = 'Svg' in ui ? ui.Svg : null
  const hasSegments = !!head.segments && head.segments.length > 0
  return (
    <Box columnGap={1}>
      <Box flexShrink={0}>
        <Text color={head.dot}>{DOT}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text>{head.label}</Text>
      </Box>
      <Box flexShrink={0}>
        {head.svg && Svg ? (
          <Svg source={head.svg.source} alt={head.svg.alt} width={head.svg.width} height={head.svg.height} />
        ) : hasSegments && head.segments ? (
          drawSegments(ui, head.segments)
        ) : (
          <Text dimColor>{head.count}</Text>
        )}
      </Box>
      {/* Next to a bar sized in pixels or cells the percent has a box of its own width,
          right-aligned, so the row's spare room falls at the end, not before it. */}
      <Box flexShrink={0} width={head.svg || hasSegments ? PERCENT_CELLS : undefined} justifyContent={head.svg || hasSegments ? 'flex-end' : undefined}>
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

// The line under the bar names the task in progress, else the next one; with neither
// (between two tasks) it only counts.
function runLine(tasks: readonly RunTask[], done: number, total: number) {
  const current = currentOf(tasks)
  const task = current ? tasks[current.index] : undefined
  const lead = current
    ? `▸ ${current.state === 'inProgress' ? 'now' : 'next'} ${current.index + 1}/${total}`
    : `▸ ${done}/${total} done`
  return { lead, title: task?.title ?? '' }
}

function reviewNote(tasks: readonly RunTask[]): string {
  const reviews = tasks.filter(t => t.isInReview).length
  return reviews > 0 ? `· ${reviews} in review` : ''
}

// The terminal's first row: the bar, then the percent in bold right after it. The row is
// a cell in from the left, and the engine's `[-]` follows it past `bodyColumns`. The
// percent is not pushed to the end of the row, so it stays with the bar: the bar is trimmed
// to whole segments and may stop a few cells short of the end. The count stands in for a
// bar that has no room.
function drawTerminalHead(ui: Ui, head: { bar: Span[] | null; count: string; percent: string }) {
  const { Box, Text } = ui
  return (
    <Box paddingLeft={PAD} columnGap={1}>
      <Box flexShrink={0}>
        {head.bar ? (
          <Text wrap="truncate">
            {head.bar.map((s, i) => (
              <Text key={String(i)} color={s.color}>
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

// The second row: the dot for the run's state, the label, and the reviews open after
// it in the dim color. The note is the part that gives way when the row is narrow.
function drawTerminalTitle(ui: Ui, dot: string, label: string, note: string) {
  const { Box, Text } = ui
  return (
    <Box paddingLeft={PAD} columnGap={1}>
      <Box flexShrink={0}>
        <Text color={dot}>{DOT}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text>{label}</Text>
      </Box>
      {note ? (
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {note}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

// The third row, flush under the dot.
function drawTerminalLine(ui: Ui, text: string) {
  const { Box, Text } = ui
  return (
    <Box paddingLeft={PAD}>
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

function drawTerminal(ui: Ui, bodyColumns: number, snapshot: Exclude<Snapshot, { kind: 'idle' }>) {
  const { Box, Text } = ui

  if (snapshot.kind === 'starting') {
    return (
      <Box>
        <Text dimColor>fathom starting…</Text>
      </Box>
    )
  }

  if (snapshot.kind === 'unavailable') {
    return (
      <Box>
        <Text dimColor wrap="truncate-end">{`fathom unavailable: ${snapshot.reason}`}</Text>
      </Box>
    )
  }

  const label = `${snapshot.ref}${LABEL_SUFFIX}`
  const room = barWidth(bodyColumns)
  const lineColumns = bodyColumns - PAD

  if (snapshot.kind === 'creating') {
    const made = snapshot.created
    return (
      <Box flexDirection="column">
        {drawTerminalHead(ui, {
          bar: room >= MIN_BAR_CELLS ? toSpans(growingCells(made, room)) : null,
          count: `${made}`,
          percent: '0%',
        })}
        {drawTerminalTitle(ui, 'claude', label, '')}
        {drawTerminalLine(ui, lineText('▸ planning', made === 0 ? 'no tasks yet' : `${made} task${made === 1 ? '' : 's'} so far`, '', lineColumns))}
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
  const cells = room >= MIN_BAR_CELLS ? barCells(tasks, room) : []
  const head = drawTerminalHead(ui, {
    bar: cells.length > 0 ? toSpans(cells) : null,
    count: stepText(done, total),
    percent: `${percent}%`,
  })

  if (isFinished) {
    return (
      <Box flexDirection="column">
        {head}
        {drawTerminalTitle(ui, dot, label, '')}
        {drawTerminalLine(ui, `✓ ${total}/${total} done`)}
      </Box>
    )
  }

  const { lead, title } = runLine(tasks, done, total)
  return (
    <Box flexDirection="column">
      {head}
      {drawTerminalTitle(ui, dot, label, reviewNote(tasks))}
      {drawTerminalLine(ui, lineText(lead, title, '', lineColumns))}
    </Box>
  )
}

// The band for a snapshot, or null when there is nothing to draw (the caller passes the
// event on, so beads-status can draw there).
//
// `target` says where it draws. On the desktop, with a palette for the person's theme, the
// bar is the Svg of the design's frames, with its head pill; with none it is boxes in the
// theme's colors. Anywhere else it is the terminal's band, three rows with a thin bar.
export function drawBand(
  ui: Ui,
  bodyColumns: number,
  snapshot: Snapshot,
  target: { surface?: string; palette?: Palette | null } = {},
) {
  const { Box, Text } = ui

  if (snapshot.kind === 'idle') return null

  if (target.surface !== 'desktop') return drawTerminal(ui, bodyColumns, snapshot)

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

  const hasSvg = !!target.palette && 'Svg' in ui
  // The cells the desktop's bar has, from the pixels the row leaves.
  const desktopCells = Math.floor(desktopBarWidth(bodyColumns, label) / CELL_PX)

  if (snapshot.kind === 'creating') {
    const made = snapshot.created
    const svg = hasSvg && target.palette ? growingSvg(made, { palette: target.palette, width: desktopBarWidth(bodyColumns, label) }) : null
    const segments = !svg ? growingSegments(made, desktopCells) : null
    const head = drawHead(ui, {
      dot: 'claude',
      label,
      svg,
      segments,
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

  const svg =
    hasSvg && target.palette && tasks.length > 0
      ? barSvg(tasks, { palette: target.palette, isFinished, width: desktopBarWidth(bodyColumns, label) })
      : null

  const segments = !svg && tasks.length > 0 ? desktopSegments(tasks, desktopCells) : null
  const head = drawHead(ui, {
    dot,
    label,
    svg,
    segments,
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

  const { lead, title } = runLine(tasks, done, total)
  return (
    <Box flexDirection="column" paddingTop={TOP_GAP}>
      {head}
      {drawLine(ui, lineText(lead, title, reviewNote(tasks), bodyColumns - INSET))}
    </Box>
  )
}
