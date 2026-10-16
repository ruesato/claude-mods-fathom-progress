# RUE-5: Update Desktop version's UX

- Issue: https://linear.app/ruesato/issue/RUE-5/update-desktop-versions-ux
- Ref: RUE-5
- Branch: feat/rue-5-update-desktop-versions-ux

## Issue description

Update the design and layout of the Claude Code Desktop version of the fathom-progress mod. The reference is the `Desktop` section of the Claude Mods Figma file (file key `oG40tY6cPL2NzsJiZQ2gwg`, node `79:1402`). It holds six frames: Creating, Planned, Executing 1/5, Executing (two done tasks in review), Completed and Error.

What the frames change against what the desktop draws today:

- The bar is one 6px-tall, fully rounded segment per task, 3px apart. Today it is a 16px rounded track with boundary ticks and a head pill that counts `2/5`.
- The rows are three, like the terminal's: the bar with the percent after it, then the status dot with the ref and `Progress band`, then the task line indented under the label. Today the dot, label, bar and percent share the first row.
- The next task is `inactive` (#999999) in the Planned frame. Today it is the same grey as a waiting task.
- The percent reads `0%` while the tasks are made. Today it is blank.

## Codebase context

All of it is in `plugins/fathom-progress/hooks/`.

- `desktop.ts`: the Svg bar (`barSvg`, `growingSvg`), the dark `Palette`, `desktopBarWidth` and the pixel constants. `CELL_PX` (7.9) is the one bridge between the Svg's pixels and the row's cells.
- `draw.tsx`: `drawBand` draws the desktop through `drawHead` (the first row today), `drawLine` (the task line) and the box bar for a theme with no Svg palette (`desktopSegments`, `growingSegments`). `lookOf` is shared with the terminal, so its colors stay as they are.
- `register.tsx` passes `paletteFor(theme)` and the surface to `drawBand`. It needs no change.
- `desktop.test.ts` tests the Svg markup as strings. `draw.test.ts` tests the pure helpers. `draw.render.test.tsx` mounts `drawBand` on each surface through the test kit and reads the element tree.
- `types.d.ts` has `TaskState` with `next` already, so the next task's color needs no new state.
- `Box` has `alignItems: 'center'` (engine types), which centers the 6px Svg on the percent's line.

## Implementation approach

1. `desktop.ts`: draw the bar as separate rounded segments. The palette drops `pill`, `pillDone` and `pillText`, takes a `next` color, and `inProgress` is no longer nullable, since the design colors it. No ticks, mask or pill. While the tasks are made the bar is one waiting segment per task made across the full width. The Svg leaves 12px after the bar, which the design puts before the percent.
2. `draw.tsx`: three rows for both the Svg bar and the box bar. The percent is `0%` while the tasks are made. The task line loses its leading `▸` on the desktop, since no frame has one. The reviews open follow the label in the dim color.
3. `README.md`: the desktop's rows, bar, colors and design source.

Deliberately out of scope:

- The Error frame. Nothing in the Beads data says a task failed, so there is no state to draw it from.
- The terminal band, which `lookOf` and the terminal helpers keep exactly as they are.
- The box bar for other themes keeps its height of a row and its marks, since a `Box` cannot be 6px tall or rounded.
- Version bump: `plugin.json` is raised at release, not with a change.

## Tasks

- RUE-6 (`claude-mods-fathom-cua`): Draw the desktop bar as separate thin segments. Files: `desktop.ts`, `desktop.test.ts`.
- RUE-7 (`claude-mods-fathom-g4n`): Lay the desktop band out in three rows. Depends on RUE-6. Files: `draw.tsx`, `draw.test.ts`, `draw.render.test.tsx`.
- RUE-8 (`claude-mods-fathom-tl3`): Document the desktop band's new design. Depends on RUE-7. Files: `README.md`.

## Testing strategy

- `claude plugin test plugins/fathom-progress` runs every `*.test.ts` and `*.test.tsx` in the plugin. The last task runs all of it; earlier tasks run the files that cover them where the runner allows.
- `desktop.test.ts` is rewritten for the new markup: one rect per task, 6px high with rx 3, 3px gaps, the colors from the palette only, the 12px after the bar, and no NaN for zero or many tasks.
- `draw.render.test.tsx` covers the three rows on the desktop for creating, planned, executing, finished and the box bar for a theme with no palette. The terminal's tests must pass untouched.
- Typecheck: `tsc -p plugins/fathom-progress --noEmit` where a TypeScript install exists. The repository has no `package.json`.
- Not testable here: how the desktop app paints it. The element table and the Svg markup are checked, the paint is not.

## Notes

- The task line's text is the same in all six frames (`planning  3 tasks so far`), so only the Creating frame's is real. The executing and finished lines keep today's content, minus the leading arrow.
- The frames hide the `· N in review` note (`showIssueStatus` is off), but the Row component carries it. It stays after the label, since a bar with no marks says in review by color alone.
- The design's bar is 420px in a 500px card. The desktop bar keeps filling the row, as `desktopBarWidth` already does.
- `inactive` (#999999) is the Figma collection's value and has not been compared to a render.
