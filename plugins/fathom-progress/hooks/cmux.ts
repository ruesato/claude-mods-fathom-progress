import type { Snapshot } from '../types'
import { DARK } from './desktop'
import { currentOf, progressOf } from './state'

// What the band puts on a cmux workspace's sidebar row, worked out from the same snapshot
// the band draws. Pure: no `$` and no cmux call here, so it has tests. register.tsx sends
// it (`cmux set-status`, `cmux set-progress`) and keeps the row clean.
//
// cmux's sidebar row takes a status pill (an icon, a line of text, a color) and one
// progress bar with a label per workspace. The pill is one line that cuts off at the row's
// edge, so its text is short; the title of the task in progress stays in the band.
export type Pill = { text: string; icon: string; color: string }
export type Meter = { value: number; label: string }
export type CmuxEntries = { pill: Pill | null; meter: Meter | null }

// Nothing of ours on the row.
export const NONE: CmuxEntries = { pill: null, meter: null }

// The pill's key. cmux's own Claude Code integration owns `claude_code`; a key of our own
// leaves it alone and lets us clear only ours.
export const PILL_KEY = 'fathom'

// About what fits on one line of the row at the default sidebar width: a 66-character pill
// was cut after 32 (claude-mods-fathom-5l2.14.1).
export const MAX_PILL_TEXT = 30

// The band's colors, so a pill reads like the band: coral while Fathom is getting ready,
// yellow for work in progress, green when done. The red is not from the design (the Figma
// collection has no failure state for this); it is macOS's system red.
const COLOR = {
  getting: DARK.pill,
  working: DARK.inProgress ?? DARK.pill,
  done: DARK.done,
  failed: '#FF453A',
} as const

// Icons are SF Symbols names, which cmux takes by name.
const ICON = {
  starting: 'hourglass',
  planning: 'list.bullet',
  working: 'hammer',
  done: 'checkmark.circle',
  failed: 'exclamationmark.triangle',
} as const

export function clip(text: string, max = MAX_PILL_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function cmuxEntries(snapshot: Snapshot): CmuxEntries {
  switch (snapshot.kind) {
    case 'idle':
      return NONE

    case 'starting':
      return { pill: { text: 'starting…', icon: ICON.starting, color: COLOR.getting }, meter: null }

    // The total is not known while the tasks are made, so there is nothing to divide a bar by.
    case 'creating': {
      const made = snapshot.created
      const text = made === 0 ? 'planning' : `planning · ${made} task${made === 1 ? '' : 's'}`
      return { pill: { text: clip(text), icon: ICON.planning, color: COLOR.getting }, meter: null }
    }

    case 'executing': {
      const { done, total } = progressOf(snapshot.tasks)
      const current = currentOf(snapshot.tasks)
      const reviews = snapshot.tasks.filter(t => t.isInReview).length
      const parts = [`${done}/${total}`]
      if (current) parts.push(`${current.state === 'inProgress' ? 'now' : 'next'} ${current.index + 1}`)
      if (reviews > 0) parts.push(`${reviews} in review`)
      return {
        pill: { text: clip(parts.join(' · ')), icon: ICON.working, color: COLOR.working },
        meter: { value: total > 0 ? done / total : 0, label: `${snapshot.ref} · ${done} of ${total}` },
      }
    }

    case 'finished': {
      const { total } = progressOf(snapshot.tasks)
      return {
        pill: { text: clip(`done ${total}/${total}`), icon: ICON.done, color: COLOR.done },
        meter: { value: 1, label: `${snapshot.ref} · done` },
      }
    }

    // The reason is in the debug log and in the band; here it would be cut off.
    case 'unavailable':
      return { pill: { text: 'bd unavailable', icon: ICON.failed, color: COLOR.failed }, meter: null }
  }
}

// `cmux set-progress` takes 0.0 to 1.0.
export function meterValue(value: number): string {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 100) / 100)
}
