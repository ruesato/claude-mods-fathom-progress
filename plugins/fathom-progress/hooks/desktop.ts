import type { RunTask } from '../types'
import { progressOf } from './state'

// The desktop app's bar: the rounded track, boundary ticks and head pill of the design's
// A1-A3 frames, drawn as one Svg. The terminal's cells cannot round a corner, and Box has
// no radius, so the desktop bar is an image.
//
// An Svg is drawn as an image (the engine's types say so), so it cannot use theme keys,
// CSS variables or the page's fonts: its colors are literal. They come in as a `Palette`
// and nothing below names a color. The only palette here is the Claude Code dark theme's,
// from the Figma "Claude Code theme" collection (Dark), so the Svg is used only when the
// person's theme is `dark`; any other theme gets the cell bar, which follows it.
export type Palette = {
  // The empty track, and what a task that is not done shows.
  track: string
  done: string
  review: string
  // A task in progress. The design's legend makes it yellow; null leaves it as track,
  // as the A1-A3 frames draw it.
  inProgress: string | null
  pill: string
  pillDone: string
  pillText: string
}

// The ticks and the pill's outline are cut out of the bar with a mask, so the app's own
// background shows through them and no color is named for either.
//
// Values from the Figma collection, checked against what a terminal rendered for the dark
// theme: success #4CBA64, claude #D67855 and subtle #505050 there, within two of these.
// In progress is the collection's `warning`; a terminal render of it was not checked.
export const DARK: Palette = {
  track: '#505050',
  done: '#4EBA65',
  review: '#D77757',
  inProgress: '#FFC107',
  pill: '#D77757',
  pillDone: '#4EBA65',
  pillText: '#000000',
}

// The palette for the person's theme, or null for a theme this has no colors for. The
// value is what the `theme` row of `/config` holds.
export function paletteFor(theme: string | null): Palette | null {
  return theme === 'dark' ? DARK : null
}

// The design's bar: 420 x 16, corners half the height. 420 is the width when none is asked
// for; the band asks for the room the row has, below.
export const BAR_WIDTH = 420
export const BAR_HEIGHT = 16

// An Svg is sized in CSS pixels and a band is laid out in cells, so this is the one bridge
// between them. Measured in the app with a strip `bodyColumns` cells wide: 95 cells filled a
// 752px card, and its first ten cells were 79px, so a cell is 7.9px. It holds at the app's
// default font size.
export const CELL_PX = 7.9
// The dot's box, and what a character of the label takes in the proportional font: 6.3
// measured, 6.8 here so a long ref cannot push the percent onto a row of its own.
const DOT_PX = 14
const LABEL_PX_PER_CHAR = 6.8
// The percent's box on the desktop, in cells: `100%` in bold takes 33px of its 39.5.
export const PERCENT_CELLS = 5
// The gaps of a row of four boxes with a column gap of one cell.
const GAPS = 3
const MIN_BAR_WIDTH = 120
const MAX_BAR_WIDTH = 1200

// The width of the bar that fills the rest of the row after the dot, the label, the percent
// and the gaps, in CSS pixels. A few pixels are left over at the end, never a row too wide.
export function desktopBarWidth(bodyColumns: number, label: string): number {
  const room =
    bodyColumns * CELL_PX - DOT_PX - GAPS * CELL_PX - label.length * LABEL_PX_PER_CHAR - PERCENT_CELLS * CELL_PX
  return Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, Math.floor(Math.round(room * 100) / 100)))
}

// While the run's tasks are being made each takes this much of the bar, and the bar grows.
export const GROW_PX = 36
const PILL_HEIGHT = 16
const TICK_Y = 5
const TICK_HEIGHT = 6

// Numbers in the markup, to two places.
const n = (value: number) => String(Math.round(value * 100) / 100)

function fillOf(task: RunTask, palette: Palette): string | null {
  if (task.state === 'done') return task.isInReview ? palette.review : palette.done
  if (task.state === 'inProgress') return palette.inProgress
  return null
}

// What Svg takes: the markup, the alt text it requires, and its size in CSS pixels. The
// segments are equal widths until Fathom records sizes, as in the terminal bar; the one
// line to change then is where `seg` is worked out. The pill sits at the head of the fill:
// the end of the task in progress, else of the done tasks; at the far left when nothing is
// started and the far right when all are done.
export function barSvg(
  tasks: readonly RunTask[],
  {
    palette,
    isFinished,
    width = BAR_WIDTH,
    height = BAR_HEIGHT,
    hasPill = true,
    alt: altText,
  }: { palette: Palette; isFinished: boolean; width?: number; height?: number; hasPill?: boolean; alt?: string },
): { source: string; alt: string; width: number; height: number } {
  const count = tasks.length
  const seg = count > 0 ? width / count : width
  const radius = height / 2
  const { done, total } = progressOf(tasks)
  const reviews = tasks.filter(t => t.isInReview).length
  const running = tasks.findIndex(t => t.state === 'inProgress')

  const text = `${done}/${total}`
  const pillWidth = Math.max(32, text.length * 7 + 11)
  const endOfDone = tasks.reduce((x, task, i) => (task.state === 'done' ? (i + 1) * seg : x), 0)
  // With a color for the task in progress its segment is part of the fill, so the pill leads
  // it: at the end of that segment, in its color. Without one the segment is track, as in
  // the design's frames, and the pill stays at the end of the done tasks.
  const isLeading = running !== -1 && palette.inProgress !== null
  const end = isLeading ? Math.max(endOfDone, (running + 1) * seg) : endOfDone
  const pillX = Math.max(0, Math.min(end - pillWidth / 2, width - pillWidth))
  const pillFill = isFinished ? palette.pillDone : isLeading && palette.inProgress ? palette.inProgress : palette.pill

  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`)
  out.push('<defs>')
  out.push(`<clipPath id="fathom-track"><rect width="${n(width)}" height="${n(height)}" rx="${n(radius)}"/></clipPath>`)
  // White shows and black hides: a tick at each task boundary, and a ring round the pill.
  out.push(`<mask id="fathom-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(width)}" height="${n(height)}"><rect width="${n(width)}" height="${n(height)}" fill="white"/>`)
  for (let i = 1; i < count; i++) {
    out.push(`<rect class="tick" x="${n(i * seg - 0.5)}" y="${TICK_Y}" width="1" height="${TICK_HEIGHT}" fill="black"/>`)
  }
  if (hasPill) {
    out.push(`<rect class="ring" x="${n(pillX - 2)}" y="-2" width="${n(pillWidth + 4)}" height="${PILL_HEIGHT + 4}" rx="${PILL_HEIGHT / 2 + 2}" fill="black"/>`)
  }
  out.push('</mask>')
  out.push('</defs>')

  // The track and its fills, clipped to the rounded track and cut by the mask. Nothing in
  // them names the app's background.
  out.push('<g mask="url(#fathom-cut)"><g clip-path="url(#fathom-track)">')
  out.push(`<rect class="track" width="${n(width)}" height="${n(height)}" rx="${n(radius)}" fill="${palette.track}"/>`)
  tasks.forEach((task, i) => {
    const fill = fillOf(task, palette)
    if (fill) out.push(`<rect class="segment" x="${n(i * seg)}" width="${n(seg)}" height="${n(height)}" fill="${fill}"/>`)
  })
  out.push('</g></g>')

  if (hasPill) {
    out.push(
      `<rect class="pill" x="${n(pillX)}" width="${n(pillWidth)}" height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}" fill="${pillFill}"/>`,
    )
    out.push(
      `<text class="step" x="${n(pillX + pillWidth / 2)}" y="11.5" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11" font-weight="700" fill="${palette.pillText}">${text}</text>`,
    )
  }
  out.push('</svg>')

  const alt =
    altText ??
    `${done} of ${total} tasks done` +
      (reviews > 0 ? `, ${reviews} in review` : '') +
      (running !== -1 ? `, task ${running + 1} in progress` : '')
  return { source: out.join(''), alt, width, height }
}

// The bar while the run's tasks are made: one track piece of GROW_PX for each, growing
// until the row is full, with no pill since nothing is done to count. The terminal's blocks
// do the same in cells; they do not line up in the desktop's font.
export function growingSvg(made: number, { palette, width }: { palette: Palette; width: number }) {
  const count = Math.max(1, made)
  const tasks: RunTask[] = Array.from({ length: count }, (_, i) => ({ id: `made-${i}`, ref: null, title: '', state: 'waiting', isInReview: false }))
  const alt = made === 0 ? 'no tasks made yet' : `${made} task${made === 1 ? '' : 's'} made so far`
  return barSvg(tasks, { palette, isFinished: false, width: Math.min(width, count * GROW_PX), hasPill: false, alt })
}
