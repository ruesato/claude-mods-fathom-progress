# fathom-progress

fathom-progress is a Claude Code mod that draws a progress band above the prompt while Fathom works through an issue. The band shows the issue, how many of its tasks are done, and the task in progress. It is for people who run Fathom's `execute` skill and want to see where a run stands without reading the transcript.

A mod is a plugin that changes Claude Code's own interface or behavior. Fathom is a Claude Code plugin that takes an Asana or Linear issue from breakdown through implementation to an open code review, and records its tasks in Beads, a local issue tracker with a command-line tool called `bd`. fathom-progress reads those Beads tasks and draws them. It never changes them.

I built it with Claude Code. It works in the terminal and in the Claude Code Desktop app.

```
● PHA-352 Progress band  [ done ][ done ][ now ][ next ][ next ]  2 of 5  40%
  ▸ now 3/5  Add the results toggle  · 1 in review
```

*A schematic of the layout, not a screenshot. Each task is a segment of the bar, colored by its state. In the terminal the step count is written over the end of the bar.*

## Setup

### What You Need

- Claude Code with mods. I built and tested this on 2.1.295 and 2.1.296. The Desktop app (version 2.31226.1) bundles Claude Code 2.1.293 and 2.1.295. I have not tried earlier versions.
- The Fathom plugin. I tested with 2.7.1.
- Beads (`bd`), with the project set up for it. I tested with `bd` 1.1.0 and 1.3.1. Fathom must be recording its tasks in Beads, since that is where the band reads them.
- `git`. The band reads the current branch name to find the issue when you don't type one.

### Install

1. Clone this repository.

   ```sh
   git clone git@github.com:ruesato/claude-mods-fathom-progress.git
   ```

2. Add the mod's folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of your Claude Code settings file (`~/.claude/settings.json`). Use the absolute path to `plugins/fathom-progress`.

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/claude-mods-fathom-progress/plugins/fathom-progress"
     }
   }
   ```

   To load more than one mod, separate the paths with a colon. If you also use `beads-status`, which draws a Beads status band in the same spot above the prompt, list fathom-progress first. When `beads-status` is first it draws before fathom-progress gets a turn and never yields.

3. Start a new Claude Code session. A session that was already running when you saved the setting does not load the mod. After the mod is installed, edits to its files load with `/reload-plugins`.

If you run Claude Code with a separate config directory (the `CLAUDE_CONFIG_DIR` variable), that directory has its own `settings.json`, and the setting goes in each one you use.

The Desktop app reads the same settings file, so the same entry loads the mod there.

### Check That It Works

Run a Fathom issue.

```
/fathom:execute PHA-352
```

The band shows `[fathom] starting…` right away, then switches to the run's tasks once Fathom has made them. Replace `PHA-352` with one of your issues.

## Using It

### Starting the Band

The band appears when Fathom's `execute` skill starts, and not before. Three signals can start it, and you don't choose between them:

- You type `/fathom:execute` (or `/fathom:scaffold`).
- Claude calls the Skill tool with a Fathom skill, for example because you asked for it in plain words. This depends on Claude choosing to call the tool.
- The engine reports the skill's own text as a skill prompt. On the Team organization account I used, this signal never reached the mod (see "Team Organization Accounts" below), so the first two carry it there.

`/fathom:scaffold` writes no Beads tasks, so there is no run to follow. It shows `[fathom] starting…` and stops there.

The band goes away when the session ends, and after `/clear`. When no Fathom run is active it passes the space to `beads-status`.

### Which Issue It Follows

The band follows one issue at a time and picks it in this order:

1. **The ref you typed.** `/fathom:execute pha-352` follows PHA-352, in any status, whether the run is open or finished. A ref with no matching issue shows `[fathom] starting…` and never another run. Refs are matched without regard to case, and a URL that contains the ref (a Linear issue URL does) works as well as the ref.
2. **The branch.** With no ref typed, the band reads the ref from the current git branch (`feat/pha-352-relabel-results-view-control` gives PHA-352). Fathom resumes a run the same way, so a run you pick up in a new session shows up. An issue created since you started wins over the branch's.
3. **The newest run.** With no ref and no ref in the branch name, the band follows the issue created since the invocation, or else the open one with the most recent activity.

Asana's numeric task refs are not read yet, and a ref written in a plain-words request is not used (only a typed command carries one).

### What the Band Shows

The first row is a status dot, the issue's ref, a bar with one segment per task, the step count and the percent done. The second row names the task in progress, or the next one.

| State | Looks like | When |
|---|---|---|
| Starting | `[fathom] starting…` | Fathom has started and the issue isn't in Beads yet, or no issue matches the ref you typed. |
| Planning | A growing bar, then `▸ planning` and `3 tasks so far` | The run's issue and some tasks exist, but the plan document isn't written and no task has started, so the total isn't known. |
| Executing | The full bar, `▸ now 3/5`, and the task's title | The plan document exists or a task has been claimed, and not every task is closed. |
| Finished | A green bar and `✓ 5/5 done` | Every task is closed. |
| Unavailable | `[fathom] unavailable: <reason>` | `bd` failed or printed something the band can't read. It never shows zeros in its place. |

Each task segment has a color and, except for tasks not yet started, a mark, so the states don't depend on color alone.

| Task | Color | Mark |
|---|---|---|
| Done | Green | ✓ |
| Done, review still open | Coral | ◐ |
| In progress | Yellow | ● |
| Next or waiting | Dark grey | none |

Fathom can split a large issue into bundles, a stack of branches that each get their own review. A task is in review when it is done and its bundle has a review recorded in the run's plan document (`.fathom/plans/<ref>.md`). The plan document doesn't say whether that review has merged, so a recorded review counts as open, and the mark stays until every task is closed. A finished run shows no review marks. When some tasks are in review, the second row adds `· 2 in review`.

The segments are equal widths. Fathom doesn't record a size for each task yet.

### The Terminal and the Desktop App

Both show the same information. They draw the bar differently.

- **Terminal.** The bar is made of block characters, with the step count (`2 of 5`) written over the end of it.
- **Desktop app, dark theme.** The bar is a rounded image (a Scalable Vector Graphics image, SVG) with the count in a pill at the head of the fill. An SVG can't read theme colors, so its colors are fixed to the dark theme.
- **Desktop app, any other theme.** The bar is drawn from colored boxes that follow the theme. I built and unit-tested this one but have not seen it in the app.

### Commands

- `/fathom-progress` toggles the band between shown and hidden. It replies "Fathom band hidden." or "Fathom band shown." It doesn't report whether a run is active.

### When It Doesn't Show

- **Nothing appears after `/fathom:execute`.** Check that the session started after you saved the setting, then check the path. A session that was already running when you saved it doesn't load the mod.
- **`beads-status` draws instead.** Move fathom-progress ahead of it in `CLAUDE_CODE_PLUGIN_DIRS`.
- **The band stays on `[fathom] starting…`.** Either Fathom hasn't created its issue yet, no issue matches the ref you typed, or you ran `scaffold`. Run `bd list --type epic --all` in the project and look for the issue ref in the epic's external ref.
- **`[fathom] unavailable: …`.** The reason is the first line `bd` printed to stderr. Run the same `bd` command by hand.
- **You hid it.** Run `/fathom-progress` once more.

### Team Organization Accounts

On the account I use for work, which is in a Team organization, Claude Code seats a built-in security plugin (`cc-plugin-sec-default`) ahead of every mod. It answers the skill prompt event itself and never passes it on, so a mod's skill prompt hook doesn't run. The first version of this mod armed only from that event, and the band never appeared on that account. fathom-progress now also arms from the typed prompt and the Skill tool call, and those do reach it. I haven't checked an account in any other kind of organization.

To see whether your account does this, run a Fathom skill with `claude -p "<prompt>" --debug-file /tmp/dbg.txt` and search the file for `bypassed`.

---

## For Developers

### Repository Layout

```
plugins/fathom-progress/
  .claude-plugin/plugin.json    manifest: name, version, the types file
  types.d.ts                    RunTask, Snapshot, Plan and the mod's state
  tsconfig.json                 extends .claude-plugin/types/tsconfig.json
  hooks/
    hooks.json                  lists the one module the engine loads
    register.tsx                every call into the engine ($), and the hook wiring
    lifecycle.ts                pure: which skills start a run, refs, plan path, poll timing
    state.ts                    pure: bd output to epics, the run to follow, the snapshot
    plan.ts                     pure: reads .fathom/plans/<ref>.md
    bd.ts                       reads what bd printed, or says why there is nothing
    draw.tsx                    draws the band from a snapshot (Box and Text, plus Svg)
    desktop.ts                  the Svg bar, the dark palette, the Desktop's pixel sizes
    bar.ts                      splits the bar's cells across segments
    fixtures.ts                 real bd output, captured by the seed script
    *.test.ts, *.test.tsx       unit and render tests
scripts/seed-fathom-fixture.sh  drives a scratch Beads repo and writes fixtures.ts
.beads/                         this project's own issue tracker
```

### How a Run Becomes a Band

1. **Arm.** `arm` in `register.tsx` records when the run started (`armedAt`) and any refs you typed, and sets the snapshot to `starting`. One start can arrive by two signals, and a repeat within three seconds is counted once. The second signal can still add the typed refs, which only `prompt.submit` carries.
2. **Refresh.** `refresh` runs once at arm, then every 10 seconds (`POLL_MS`) while the snapshot isn't `finished`, and after any Bash call that runs `bd` or `git commit` (`touchesRun`). One refresh runs at a time. A call that arrives during one asks for another straight after, so the last change is never missed.
3. **Build.** `build` runs `bd list` for the epics, picks the run (`pickRun` in `state.ts`), then runs `bd list` for that epic's tasks and `bd ready` for the next one, and reads the plan document. The calls run in sequence because `bd` keeps one embedded database.
4. **Snapshot.** `toSnapshot` orders the tasks by their `blocks` edges (`bd` lists them in no useful order, and `created_at` ties), and marks each as done, in progress, next or waiting. A done task whose bundle has a recorded review is marked in review. The result is stored in the engine's state.
5. **Draw.** The `ui.render` hook for `AbovePrompt` reads the snapshot and calls `drawBand`. It passes the event on with `next(e)` when idle, hidden, or when a survey holds the spot.

Fathom makes its epic with the issue ref as both the epic's `external_ref` and a label, and labels each task with the ref. `parseEpics` relies on that pair, so an epic without both is someone else's and is not a run. `bd` timestamps have one-second resolution, so `pickRun` rounds the arm time down to the second before comparing.

The module registers these hooks:

| Event | Does |
|---|---|
| `session.start` | Starts the poll timer and registers `/fathom-progress`. |
| `session.end` | Resets the arm time, the typed refs and the snapshot. |
| `skill.prompt` | Arms on `fathom:execute` and `fathom:scaffold`. |
| `prompt.submit` | Arms from a typed `/fathom:execute` or `/fathom:scaffold`, and takes the typed refs. |
| `tool.call` (Skill) | Arms from the Skill tool. The event carries the skill name and no arguments. |
| `tool.call` (Bash) | Refreshes when the command touched the run. |
| `command.run` (`fathom-progress`) | Toggles the band. |
| `ui.render` (`AbovePrompt`) | Draws the band. |

### Why the Code Is Split This Way

Two constraints from the engine shape the files.

The engine's validator follows `$` (the handle to the engine) only inside the file that receives it, not across imports. A helper that takes `$` has to live in `register.tsx`. A helper in another file that took `$` would be rejected, which is why `draw.tsx` never sees `$`: `register.tsx` resolves the UI elements and fetches the data, and `draw.tsx` only draws them.

The second is that `register.tsx` reads engine state, which is empty in a test, so none of its own code can be tested. Everything that decides something (which skill started a run, which ref was typed, which epic to follow, what the tasks' states are) is a pure function in `lifecycle.ts`, `state.ts`, `plan.ts` or `bd.ts`, and has tests.

### Working With the Engine

What I learned while building this, on Claude Code 2.1.295 and 2.1.296:

- **Hooks run in tiers, outermost first:** `prepend`, `user`, `append`, `builtin`, `core`. A hook that doesn't call `next(e)` stops every tier inside it. A mod is in `user`. In a Team organization the built-in security plugin is seated outside it, and the debug log says `skill.prompt bypassed by cc-plugin-sec-default`. `prompt.submit` and `tool.call` aren't in its list.
- **A hook that throws is skipped**, and the chain carries on. The hooks that only read (`prompt.submit`, the Skill `tool.call`) wrap their work in `try/catch` so a failure can't hold up a prompt or a tool.
- **`session.start` doesn't fire again after `/clear`**, but the module and its timer survive. The reset is on `session.end`.
- **A command name that is already taken throws** in `$.command.register`. The registration is wrapped, and it's the last thing `session.start` does.
- **`/reload-plugins` fires `session.start` again.**
- **An `Svg` is drawn as an image.** It can't use theme keys, CSS variables or the page's fonts. Its colors are literal, which is why the Desktop's SVG bar is dark-theme only.
- **A cell is 7.9 pixels on the Desktop.** I measured it with a strip `bodyColumns` cells wide (95 cells filled a 752-pixel card). It holds at the app's default font size. `desktop.ts` uses it to size the bar to the row.

### Tests, Validation and Type-Check

Run the tests with the engine's own runner.

```sh
claude plugin test plugins/fathom-progress
```

It runs every `*.test.ts` and `*.test.tsx` under the folder you give it, each in a child process that is set up like the mod's hooks. A test imports its kit from `claude-code/testing`, and the sandbox allows relative imports and `claude-code` only, so a test can't read a file from disk. That is why the captured `bd` output is a TypeScript module (`fixtures.ts`) and not a JSON file. The render tests mount the band on both the terminal and Desktop surfaces.

Validate the manifest and hooks.

```sh
claude plugin validate plugins/fathom-progress
```

This passes. It reports three notes of "gating hook without .catch" for `prompt.submit` and the two `tool.call` hooks. They are notes, not errors.

Type-check with TypeScript. This repository has no `package.json`, so use any TypeScript install you have.

```sh
tsc -p plugins/fathom-progress --noEmit
```

The config extends `.claude-plugin/types/tsconfig.json`, which turns on strict mode and `noUncheckedIndexedAccess`. At the commit that added this README the check reports ten errors (TypeScript 6.0.3): eight in `bar.ts` from indexing arrays, one in `draw.tsx` where a numeric `key` needs to be a string, and one in `register.tsx` where `$.fs.read(path, { as: 'text' })` is typed as `string | FsBytes` and needs to be `$.fs.read(path)`. They don't change behavior, and fixing them is tracked under `claude-mods-fathom-5l2.5`.

### Fixtures

`hooks/fixtures.ts` holds real `bd` output for one Fathom run at each stage, so the state tests run against what `bd` prints and not against a guess. `scripts/seed-fathom-fixture.sh` regenerates it.

```sh
bash scripts/seed-fathom-fixture.sh [scratch-dir] [out-file]
```

The script runs the commands Fathom's Beads adapter runs (Fathom 2.2.0) in a scratch repository, and writes what `bd` printed to `hooks/fixtures.ts`. It refuses a scratch folder inside this repository or one that isn't empty, checks that `bd` resolves to the scratch repository before it writes anything, and deletes nothing. The fixtures in the repository were captured with `bd` 1.1.0. Re-run the script after a `bd` upgrade that changes its JSON (a text format for data), since `parseEpics` and the task parsing read a missing key as a missing field and don't trust it.

### Debugging

The mod logs to the debug channel. Start Claude Code with `--debug-file <path>` and search for `fathom-progress`:

- `fathom-progress: armed (execute) by prompt.submit, typed refs PHA-352` says which signal armed the band.
- `fathom-progress: following PHA-352 (typed PHA-352, branch -)` says which issue the band picked and why. It is logged once per change.
- `fathom-progress: refresh failed: <reason>` says why the band is `unavailable`.

Running `claude -p "..." --debug-file f` with a prompt that starts a Fathom skill reproduces the arming without opening the interface. That run uses the `sdk-cli` entry point and not the Desktop app's, so it can't show how the Desktop behaves.

### Design Source

The band follows frames in the Claude Mods Figma file (file key `oG40tY6cPL2NzsJiZQ2gwg`): A1 Planned (`9:274`), A2 Executing (`9:289`) and A3 Done (`9:314`). The first drafts, including the per-task pills, are in section `11:77`. The frames don't include a creating or starting state, so those two are placeholders (`claude-mods-fathom-5l2.7`).

`desktop.ts` takes its colors from the "Claude Code theme" collection in that file (Dark mode). I checked success, claude and subtle against what a terminal renders for the dark theme, and each is within two of the Figma value. The yellow for in progress is the collection's `warning`, and I haven't compared it to a terminal render.

### Extending It

- **Task sizes.** Segments are equal widths. When Fathom records a size per task, the terminal bar changes where `barCells` passes its values to `allocate` (a task's size where there is one, 1 where there isn't), and the SVG bar changes where `barSvg` works out `seg`. The request to Fathom is `claude-mods-fathom-5l2.10`.
- **A full task list.** A pane that shows every task of the run, opened from the band, is planned under `claude-mods-fathom-5l2.13`. It starts with a probe, `claude-mods-fathom-5l2.12`, to see whether a pane seats in the Desktop app and how wide it is. The probe isn't built.
- **More trackers' refs.** `REF` in `lifecycle.ts` reads refs shaped like `PHA-352` (letters, a hyphen, digits). Asana's numeric task ids aren't read.
- **A ref from plain words.** The Skill tool's call event has no arguments, so a request in plain words can arm the band but can't name the issue. A prompt's text would have to be parsed for it.
- **Continuing a run without a Fathom command.** `claude --continue` followed by ordinary prompts leaves the band idle, because nothing arms it.
- **A rounded bar on other Desktop themes.** `Box` has no corner radius and an `Svg` has fixed colors, so only the dark theme gets the rounded bar. Another theme needs its own palette in `desktop.ts` (`paletteFor` returns one only for `dark`).

### Issue Tracking

This project tracks its work in Beads, in `.beads/`. The epic is `claude-mods-fathom-5l2`.

```sh
bd ready              # work with no blockers
bd show <id>          # one issue's details and comments
```

`bd` keeps the database locally and syncs it through the `refs/dolt/data` ref on the git remote.

```sh
bd dolt push
bd dolt pull
```

I have run `bd dolt push`. I haven't run `bd dolt pull` from a second clone.

## Status

The terminal band, the Desktop's dark-theme SVG bar and the arming on a Team organization account have each been seen working: the first two in a scratch repository, the third in a work profile. The typed-ref and branch-fallback logic has unit tests and headless runs in a real repository, and I haven't yet watched it in a live session. I haven't seen the Desktop's non-dark bar, or the new arming signals in the Desktop app, and the type-check reports ten errors.
