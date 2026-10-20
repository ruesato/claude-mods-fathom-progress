# RUE-29: Allow fathom progress mod to read from checklists

- Issue: https://linear.app/ruesato/issue/RUE-29/allow-fathom-progress-mod-to-read-from-checklists
- Ref: RUE-29
- Branch: feat/rue-29-read-checklists-in-the-band
- Review: 2 https://github.com/ruesato/claude-mods-fathom-progress/pull/2
- Finalization: complete

## Issue description

Let the fathom-progress band follow a Fathom run that uses the checklist memory backend, so it works when beads is not available. Today the band reads `bd` only, so in a repository whose base branch does not track `.beads/` it shows nothing.

The source is `.fathom/tasks/<ISSUE-REF>.md`, as the Fathom skill's `memory/checklist.md` defines it, read from the working tree because the in-progress marker is uncommitted by design. Beads wins when both exist. A missing or unreadable file must show a clear state, never zeros or a blank band.

Out of scope: writing to the checklist, task sizes (RUE-30), and moving the mod into crodris/skills (RUE-28).

## Codebase context

All of it is in `plugins/fathom-progress/hooks/`.

- `register.tsx`: `build()` runs three `bd` calls (`list --type epic`, `list -l <ref> --type task`, `ready -l <ref>`), then `toSnapshot`. `readPlan` reads the plan document with `$.fs.read(planPath(...))`. The ref comes from the typed command or the branch (`refsOfBranch`). The poll is `POLL_MS` (10s).
- `state.ts`: `parseEpics`, `pickRun`, `toSnapshot`, `currentOf`, `progressOf`. `toSnapshot` turns bd's rows into `RunTask` and then a `Snapshot` (`creating`, `executing`, `finished`, `unavailable`). `reviewedRefs` marks done tasks whose bundle review is recorded in the plan.
- `plan.ts`: `parsePlan` reads the plan document's labels, bundles, reviews and the first heading.
- `lifecycle.ts`: `refsIn`, `refsOfBranch`, `planPath`, the small decisions that are pure so they can be tested.
- `types.d.ts`: `TaskState`, `RunTask`, `Plan`, `Snapshot`, and the `PluginState` contract.
- Tests use `claude-code/testing` (`test`, `expect`), live beside their module (`state.test.ts`, `plan.test.ts`), and read captured bd output from `fixtures.ts`. Nothing in the tests runs `bd`.
- The checklist format, from `memory/checklist.md` in the Fathom skill: a `# REF: title` header; `- Issue:`, `- Branch:`, `- Review:` and the legacy `- PR:` lines; `## Plan`; `## Tasks` with lines `- [ ] N. title (deps: 1, 2) -> sub-issue: <ref>`, `[>]` for in progress, `[x]` with `(done YYYY-MM-DD, hash)`; and an optional trailing `- Closed: <date>` footer.

## Implementation approach

1. `checklist.ts`: `parseChecklist(text)` returns the header, links and task lines as data. It skips code fences, ignores everything outside `## Tasks` and the `Closed` footer, and drops a malformed task line instead of throwing. Types go in `types.d.ts`.
2. `toChecklistSnapshot(checklist, plan)` in `checklist.ts`: `[x]` done, `[>]` in progress, a `[ ]` whose deps are all done is next, the rest wait. Tasks go in task-number order. Finished when every task is done. No task lines means `creating` with no plan, `unavailable` with a reason when the file is not a checklist. The title is the checklist header's, then the plan's. In-review marks reuse the plan's recorded bundle reviews.
3. A pure decision function (`lifecycle.ts` or `checklist.ts`) that picks the source: beads when `bd` has an epic for the ref, otherwise the checklist when the file exists, otherwise the existing `starting` or `unavailable` states. `build()` in `register.tsx` calls it and reads the file with `$.fs`. A failing `bd` does not hide a readable checklist.
4. README and `types.d.ts` comments say the band follows both backends. The last task runs `tsc -p` and the full `claude plugin test`.

Deliberately out of scope: writing the checklist, per-task sizes, the terminal and Desktop drawing (both work from the same `Snapshot`), and any change to how scaffold runs are inferred.

## Tasks

- RUE-60 (`claude-mods-fathom-441`): Parse a Fathom checklist file. Files: `checklist.ts`, `checklist.test.ts`, `types.d.ts`.
- RUE-61 (`claude-mods-fathom-p6i`): Turn a checklist into the band's snapshot. Depends on RUE-60. Files: `checklist.ts`, `checklist.test.ts`.
- RUE-62 (`claude-mods-fathom-3f3`): Follow a checklist run when beads has none. Depends on RUE-61. Files: `register.tsx`, `lifecycle.ts` or `checklist.ts`, and their tests.
- RUE-63 (`claude-mods-fathom-665`): Document checklist support and verify the plugin. Depends on RUE-62. Files: `README.md`, `types.d.ts`.

## Testing strategy

- `claude plugin test plugins/fathom-progress` runs every `*.test.ts` and `*.test.tsx` in the plugin. Earlier tasks run the files that cover them; the last task runs the typecheck and all of it.
- New: `checklist.test.ts` with string fixtures built from the format above: sequential, parallel (several `[>]`), dependencies, done with a hash, a legacy `PR:` line, a `Closed:` footer that is not counted, a code fence that quotes the format, an empty tasks section, and a malformed file. The decision function is tested for: beads wins, checklist used when bd has no epic, checklist used when bd fails, neither found, no ref.
- Existing `state.test.ts`, `plan.test.ts` and the render tests must pass untouched.
- Typecheck: `tsc -p plugins/fathom-progress --noEmit` where a TypeScript install exists. The repository has no `package.json`.
- Not testable here: a live checklist run in a repository without beads. The format is built from `checklist.md`, not captured from a real run.

## Notes

- The plan document is written on both backends: execute step 8 writes it for every run and writes the checklist file additionally only when the checklist is the resolved backend. So bundles, reviews and the heading title can come from the plan document in a checklist run. This answers the open question on the issue.
- This run itself uses beads, because `origin/main` tracks `.beads/`. The checklist reader is therefore verified against the documented format only.
- A checklist has no epic and no creation time, so the run cannot be picked by `armedAt`. The ref must come from the typed command or the branch name.
