import { test, expect } from 'claude-code/testing'

import type { RunTask, TaskState } from '../types'
import { BAR_HEIGHT, BAR_WIDTH, DARK, GROW_PX, barSvg, desktopBarWidth, growingSvg, paletteFor } from './desktop'
import type { Palette } from './desktop'

const run = (states: TaskState[], reviewed: number[] = []): RunTask[] =>
  states.map((state, i) => ({ id: `t${i}`, ref: null, title: `task ${i}`, state, isInReview: reviewed.includes(i) }))

const attr = (markup: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1]
// The attributes of every rect of one class, in drawing order.
const rects = (source: string, cls: string) => [...source.matchAll(new RegExp(`<rect class="${cls}"([^>]*)/>`, 'g'))].map(m => m[1] ?? '')

const PLANNED = run(['next', 'waiting', 'waiting', 'waiting', 'waiting'])
const EXECUTING = run(['done', 'done', 'inProgress', 'waiting', 'waiting'], [0, 1])
const FINISHED = run(['done', 'done', 'done', 'done', 'done'])

test('only the dark theme has a palette; any other theme gets the cell bar', async () => {
  expect(paletteFor('dark')).toBe(DARK)
  for (const theme of ['light', 'auto', 'dark-daltonized', 'Dark', '', null]) {
    expect(paletteFor(theme)).toBeNull()
  }
})

test('the bar is the design\'s 420 x 16 with corners half the height, clipped to a rounded track', async () => {
  const svg = barSvg(PLANNED, { palette: DARK, isFinished: false })

  expect([svg.width, svg.height]).toEqual([BAR_WIDTH, BAR_HEIGHT])
  expect(svg.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="16" viewBox="0 0 420 16">')).toBe(true)
  expect(svg.source.endsWith('</svg>')).toBe(true)
  expect(svg.source).toContain('<clipPath id="fathom-track"><rect width="420" height="16" rx="8"/></clipPath>')
  expect(rects(svg.source, 'track')).toHaveLength(1)
  expect(svg.source).toContain('<g clip-path="url(#fathom-track)">')
})

test('the ticks and the ring round the pill are cut out with a mask, so the app\'s own background shows through and no color is named for them', async () => {
  const { source } = barSvg(EXECUTING, { palette: DARK, isFinished: false })
  const mask = /<mask id="fathom-cut"[^>]*>(.*?)<\/mask>/.exec(source)?.[1] ?? ''

  expect(source).toContain('<g mask="url(#fathom-cut)">')
  expect(mask).toContain('fill="white"')
  expect(rects(mask, 'tick')).toHaveLength(4)
  expect(rects(mask, 'tick').every(t => t.includes('fill="black"'))).toBe(true)
  // The ring is the pill widened by two on every side, and the pill itself is drawn after the mask's group.
  const [ring] = rects(mask, 'ring')
  expect([attr(ring ?? '', 'x'), attr(ring ?? '', 'width')]).toEqual(['234', '36'])
  expect(source.indexOf('class="pill"')).toBeGreaterThan(source.indexOf('</g></g>'))
  expect(source).not.toContain('stroke')
})

test('planned: no segment is filled, four ticks mark the five tasks, and the pill reads 0/5 at the far left', async () => {
  const { source, alt } = barSvg(PLANNED, { palette: DARK, isFinished: false })

  expect(rects(source, 'segment')).toHaveLength(0)
  expect(rects(source, 'tick').map(t => attr(t, 'x'))).toEqual(['83.5', '167.5', '251.5', '335.5'])
  const [pill] = rects(source, 'pill')
  expect([attr(pill ?? '', 'x'), attr(pill ?? '', 'width'), attr(pill ?? '', 'fill')]).toEqual(['0', '32', DARK.pill])
  expect(source).toContain('>0/5</text>')
  expect(alt).toBe('0 of 5 tasks done')
})

test('executing: done and in-review segments are filled in their colors and the one in progress in yellow, and the yellow pill leads the fill', async () => {
  const { source, alt } = barSvg(EXECUTING, { palette: DARK, isFinished: false })

  const segments = rects(source, 'segment')
  expect(segments.map(s => [attr(s, 'x'), attr(s, 'width'), attr(s, 'fill')])).toEqual([
    ['0', '84', DARK.review],
    ['84', '84', DARK.review],
    ['168', '84', '#FFC107'],
  ])
  // The task in progress ends at 252; the 32-wide pill is centered on it, in its yellow.
  const [pill] = rects(source, 'pill')
  expect([attr(pill ?? '', 'x'), attr(pill ?? '', 'fill')]).toEqual(['236', '#FFC107'])
  expect(source).toContain('<text class="step" x="252"')
  expect(source).toContain('>2/5</text>')
  expect(alt).toBe('2 of 5 tasks done, 2 in review, task 3 in progress')
})

test('the pill leads the fill: at the end of the task in progress, else at the end of the done ones, coral between tasks', async () => {
  const pillOf = (tasks: RunTask[], palette: Palette = DARK) => {
    const [pill] = rects(barSvg(tasks, { palette, isFinished: false }).source, 'pill')
    return [attr(pill ?? '', 'x'), attr(pill ?? '', 'fill')]
  }

  // The first task claimed: the pill is at the end of its segment, not at the far left.
  expect(pillOf(run(['inProgress', 'waiting', 'waiting', 'waiting', 'waiting']))).toEqual(['68', '#FFC107'])
  // Between two tasks, with none in progress: the end of the done ones, in the pill's coral.
  expect(pillOf(run(['done', 'done', 'next', 'waiting', 'waiting']))).toEqual(['152', DARK.pill])
  // With no color for in progress its segment is track, so the pill stays at the end of the done ones.
  expect(pillOf(EXECUTING, { ...DARK, inProgress: null })).toEqual(['152', DARK.pill])
  // The last task in progress puts the pill at the far right, held inside the bar.
  expect(pillOf(run(['done', 'done', 'done', 'done', 'inProgress']))).toEqual(['388', '#FFC107'])
})

test('a done task with no review is green, and the finished bar is full green with the pill at the far right, green too', async () => {
  const { source, alt } = barSvg(FINISHED, { palette: DARK, isFinished: true })

  expect(rects(source, 'segment').map(s => attr(s, 'fill'))).toEqual(Array(5).fill(DARK.done))
  const [pill] = rects(source, 'pill')
  expect([attr(pill ?? '', 'x'), attr(pill ?? '', 'fill')]).toEqual(['388', DARK.pillDone])
  expect(source).toContain('>5/5</text>')
  expect(alt).toBe('5 of 5 tasks done')
})

test('a task in progress is yellow, and is left as track when the palette gives it no color', async () => {
  const yellow = barSvg(EXECUTING, { palette: DARK, isFinished: false })
  const plain = barSvg(EXECUTING, { palette: { ...DARK, inProgress: null }, isFinished: false })

  const third = rects(yellow.source, 'segment')[2] ?? ''
  expect([attr(third, 'x'), attr(third, 'fill')]).toEqual(['168', '#FFC107'])
  expect(rects(plain.source, 'segment')).toHaveLength(2)
})

test('every color in the markup is one the palette was given, so nothing here names a color of its own', async () => {
  const custom: Palette = {
    track: '#010101', done: '#020202', review: '#030303', inProgress: '#040404', pill: '#050505', pillDone: '#060606', pillText: '#070707',
  }
  const allowed = new Set(Object.values(custom))

  for (const tasks of [PLANNED, EXECUTING, FINISHED]) {
    const { source } = barSvg(tasks, { palette: custom, isFinished: tasks === FINISHED })
    const used = source.match(/#[0-9A-Fa-f]{6}\b/g) ?? []

    expect(used.length).toBeGreaterThan(0)
    expect(used.every(c => allowed.has(c))).toBe(true)
  }
})

test('any number of tasks fits: widths are shared equally to two places, and the markup stays far under the 131072 limit', async () => {
  const nine = barSvg(run(Array(9).fill('waiting')), { palette: DARK, isFinished: false })
  expect(rects(nine.source, 'tick')).toHaveLength(8)
  expect(attr(rects(nine.source, 'tick')[0] ?? '', 'x')).toBe('46.17')

  const many = barSvg(run(Array(200).fill('done')), { palette: DARK, isFinished: true })
  expect(many.source.length).toBeLessThan(131072)
  expect(rects(many.source, 'segment')).toHaveLength(200)

  // No tasks: a bare track and a 0/0 pill, nothing that divides by zero.
  const none = barSvg([], { palette: DARK, isFinished: false })
  expect(none.source).not.toContain('NaN')
  expect(none.source).not.toContain('Infinity')
})

test('the pill widens for a longer count so its text stays inside it', async () => {
  const { source } = barSvg(run(Array(12).fill('done')), { palette: DARK, isFinished: true })
  const [pill] = rects(source, 'pill')

  expect(source).toContain('>12/12</text>')
  // Five characters of 7px each and 11 of padding, wider than the 32 a three-character count gets.
  expect(Number(attr(pill ?? '', 'width'))).toBe(5 * 7 + 11)
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

test('barSvg draws at the width it is given, with the ticks at its boundaries and the pill kept inside it', async () => {
  const { source, width } = barSvg(EXECUTING, { palette: DARK, isFinished: false, width: 530 })

  expect(width).toBe(530)
  expect(source).toContain('width="530" height="16" viewBox="0 0 530 16"')
  expect(rects(source, 'tick').map(t => attr(t, 'x'))).toEqual(['105.5', '211.5', '317.5', '423.5'])
  const [pill] = rects(source, 'pill')
  // The yellow segment ends at 318; the 32-wide pill is centered on it.
  expect(attr(pill ?? '', 'x')).toBe('302')
})

test('while tasks are made the bar is one track piece for each, grows to the room the row has, and has no pill', async () => {
  const one = growingSvg(1, { palette: DARK, width: 530 })
  const five = growingSvg(5, { palette: DARK, width: 530 })
  const many = growingSvg(40, { palette: DARK, width: 530 })
  const none = growingSvg(0, { palette: DARK, width: 530 })

  expect([one.width, five.width, many.width]).toEqual([GROW_PX, 5 * GROW_PX, 530])
  expect(rects(five.source, 'tick')).toHaveLength(4)
  expect(rects(many.source, 'tick')).toHaveLength(39)
  for (const bar of [one, five, many, none]) {
    expect(bar.source).not.toContain('class="pill"')
    expect(bar.source).not.toContain('<text')
    expect(bar.source).not.toContain('class="ring"')
    expect(rects(bar.source, 'segment')).toHaveLength(0)
  }
  expect([none.width, none.alt, one.alt, five.alt]).toEqual([GROW_PX, 'no tasks made yet', '1 task made so far', '5 tasks made so far'])
})
