export const MAX_BAR_CELLS = 48
// A cell is the smallest gap a Box can leave, so the gap between segments is
// drawn instead: each segment but the last ends in a 7/8-wide block, leaving
// the last eighth of its cell in the terminal's own background.
export const SEGMENT_EDGE = '▉'

// Splits `cells` across `values` in proportion (largest remainder), giving every
// nonzero value at least one cell. Needs cells >= the number of nonzero values.
export function allocate(values: number[], cells: number): number[] {
  const total = values.reduce((sum, v) => sum + v, 0)
  const exact = values.map(v => (v / total) * cells)
  const widths = values.map((v, i) => (v > 0 ? Math.max(1, Math.floor(exact[i])) : 0))
  let left = cells - widths.reduce((sum, w) => sum + w, 0)

  while (left > 0) {
    let pick = -1
    values.forEach((v, i) => {
      if (v > 0 && (pick === -1 || exact[i] - widths[i] > exact[pick] - widths[pick])) pick = i
    })
    widths[pick] += 1
    left -= 1
  }
  while (left < 0) {
    let pick = 0
    widths.forEach((w, i) => {
      if (w > widths[pick]) pick = i
    })
    widths[pick] -= 1
    left += 1
  }
  return widths
}

export function centered(text: string, width: number): string {
  const shown = text.length <= width ? text : ''
  const before = Math.floor((width - shown.length) / 2)
  return ' '.repeat(before) + shown + ' '.repeat(width - shown.length - before)
}
