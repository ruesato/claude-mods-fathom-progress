import { test, expect } from 'claude-code/testing'

import type { RunTask, TaskState } from '../types'
import { BAR_HEIGHT, BAR_WIDTH, DARK, barSvg, desktopBarWidth, growingSvg, paletteFor } from './desktop'
import type { Palette } from './desktop'

const run = (states: TaskState[], reviewed: number[] = []): RunTask[] =>
  states.map((state, i) => ({ id: `t${i}`, ref: null, title: `task ${i}`, state, isInReview: reviewed.includes(i) }))

const attr = (markup: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1]
// The attributes of every segment, in drawing order.
const segments = (source: string) => [...source.matchAll(/<rect class="segment"([^>]*)\/>/g)].map(m => m[1] ?? '')

const PLANNED = run(['next', 'waiting', 'waiting', 'waiting', 'waiting'])
const EXECUTING = run(['done', 'done', 'inProgress', 'waiting', 'waiting'], [0, 1])
const FINISHED = run(['done', 'done', 'done', 'done', 'done'])

test('only the dark theme has a palette; any other theme gets the cell bar', async () => {
  expect(paletteFor('dark')).toBe(DARK)
  for (const theme of ['light', 'auto', 'dark-daltonized', 'Dark', '', null]) {
    expect(paletteFor(theme)).toBeNull()
  }
})

test('the bar is the design\'s segments, 6px tall with corners half that, and draws nothing else', async () => {
  const svg = barSvg(PLANNED, { palette: DARK })

  expect([svg.width, svg.height]).toEqual([BAR_WIDTH, BAR_HEIGHT])
  expect(svg.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="6" viewBox="0 0 420 6">')).toBe(true)
  expect(svg.source.endsWith('</svg>')).toBe(true)
  const drawn = segments(svg.source)
  expect(drawn).toHaveLength(5)
  expect(drawn.every(s => attr(s, 'height') === '6' && attr(s, 'rx') === '3')).toBe(true)
  // No track under the segments, no ticks between them, no pill and no count: the segments are the bar.
  for (const part of ['<defs', '<mask', '<clipPath', 'class="track"', 'class="tick"', 'class="pill"', '<text']) {
    expect(svg.source).not.toContain(part)
  }
})

test('five tasks share the width with the design\'s 3px between them, so the last segment ends where the bar does', async () => {
  const drawn = segments(barSvg(PLANNED, { palette: DARK }).source)

  expect(drawn.map(s => attr(s, 'x'))).toEqual(['0', '84.6', '169.2', '253.8', '338.4'])
  expect(drawn.every(s => attr(s, 'width') === '81.6')).toBe(true)
})

test('each state has its color: in review, done, in progress, next and waiting', async () => {
  const states = run(['done', 'done', 'inProgress', 'next', 'waiting'], [0])
  const fills = segments(barSvg(states, { palette: DARK }).source).map(s => attr(s, 'fill'))

  expect(fills).toEqual([DARK.review, DARK.done, DARK.inProgress, DARK.next, DARK.waiting])
  expect(new Set(fills).size).toBe(5)
  // A finished run is every segment green, and a planned one has only its first task set apart.
  expect(segments(barSvg(FINISHED, { palette: DARK }).source).map(s => attr(s, 'fill'))).toEqual(Array(5).fill(DARK.done))
  expect(segments(barSvg(PLANNED, { palette: DARK }).source).map(s => attr(s, 'fill'))).toEqual([DARK.next, ...Array(4).fill(DARK.waiting)])
})

test('the alt text says what the colors say: how many are done, in review, and which is running', async () => {
  expect(barSvg(PLANNED, { palette: DARK }).alt).toBe('0 of 5 tasks done')
  expect(barSvg(EXECUTING, { palette: DARK }).alt).toBe('2 of 5 tasks done, 2 in review, task 3 in progress')
  expect(barSvg(FINISHED, { palette: DARK }).alt).toBe('5 of 5 tasks done')
  expect(barSvg(FINISHED, { palette: DARK, alt: 'made up' }).alt).toBe('made up')
})

test('every color in the markup is one the palette was given, so nothing here names a color of its own', async () => {
  const custom: Palette = { waiting: '#010101', next: '#020202', inProgress: '#030303', review: '#040404', done: '#050505' }
  const allowed = new Set(Object.values(custom))

  for (const tasks of [PLANNED, EXECUTING, FINISHED]) {
    const { source } = barSvg(tasks, { palette: custom })
    const used = source.match(/#[0-9A-Fa-f]{6}\b/g) ?? []

    expect(used.length).toBeGreaterThan(0)
    expect(used.every(c => allowed.has(c))).toBe(true)
  }
})

test('any number of tasks fits: the segments share the width, the gaps give way when they would take it all, and the markup stays far under the 131072 limit', async () => {
  const nine = segments(barSvg(run(Array(9).fill('waiting')), { palette: DARK }).source)
  expect(attr(nine[1] ?? '', 'x')).toBe('47')
  expect(attr(nine[0] ?? '', 'width')).toBe('44')

  for (const count of [1, 2, 5, 9, 200]) {
    const drawn = segments(barSvg(run(Array(count).fill('done')), { palette: DARK }).source)
    const last = drawn.at(-1) ?? ''

    expect(drawn).toHaveLength(count)
    expect(Math.abs(Number(attr(last, 'x')) + Number(attr(last, 'width')) - BAR_WIDTH)).toBeLessThan(0.05)
  }
  expect(barSvg(run(Array(200).fill('done')), { palette: DARK }).source.length).toBeLessThan(131072)

  // No tasks: no segments, and nothing that divides by zero.
  const none = barSvg([], { palette: DARK })
  expect(segments(none.source)).toHaveLength(0)
  expect(none.source).not.toContain('NaN')
  expect(none.source).not.toContain('Infinity')
  expect(none.alt).toBe('0 of 0 tasks done')
})

test('the bar fills what the row has left: the cells at 7.9px less the dot, three gaps, the label and the percent box', async () => {
  const label = 'SLU-131 Progress band'

  // Measured in the app: 95 cells across a 752px card.
  expect(desktopBarWidth(95, label)).toBe(530)
  expect(desktopBarWidth(80, label)).toBe(412)
  // A longer label leaves less, by 6.8px for each character.
  expect(desktopBarWidth(95, `${label}12345`)).toBe(496)
  // Never below a bar worth drawing, nor past what an Svg should be.
  expect(desktopBarWidth(20, label)).toBe(120)
  expect(desktopBarWidth(2000, label)).toBe(1200)
})

test('barSvg draws at the width it is given, the segments dividing that width', async () => {
  const { source, width } = barSvg(EXECUTING, { palette: DARK, width: 530 })

  expect(width).toBe(530)
  expect(source).toContain('width="530" height="6" viewBox="0 0 530 6"')
  expect(segments(source).map(s => attr(s, 'x'))).toEqual(['0', '106.6', '213.2', '319.8', '426.4'])
  expect(segments(source).every(s => attr(s, 'width') === '103.6')).toBe(true)
})

test('while tasks are made the bar is one waiting segment for each, sharing the whole width, with no total to divide by', async () => {
  const none = growingSvg(0, { palette: DARK, width: 530 })
  const one = growingSvg(1, { palette: DARK, width: 530 })
  const three = growingSvg(3, { palette: DARK, width: 530 })
  const many = growingSvg(40, { palette: DARK, width: 530 })

  expect([none, one, three, many].map(bar => segments(bar.source).length)).toEqual([0, 1, 3, 40])
  for (const bar of [none, one, three, many]) {
    expect(bar.width).toBe(530)
    expect(bar.source).not.toContain('<text')
    expect(segments(bar.source).every(s => attr(s, 'fill') === DARK.waiting)).toBe(true)
  }
  expect(segments(one.source).map(s => [attr(s, 'x'), attr(s, 'width')])).toEqual([['0', '530']])
  expect(segments(three.source).map(s => [attr(s, 'x'), attr(s, 'width')])).toEqual([
    ['0', '174.67'],
    ['177.67', '174.67'],
    ['355.33', '174.67'],
  ])
  expect([none.alt, one.alt, three.alt]).toEqual(['no tasks made yet', '1 task made so far', '3 tasks made so far'])
})
