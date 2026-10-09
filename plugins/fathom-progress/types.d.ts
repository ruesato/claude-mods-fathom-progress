// What one sub-task is doing. `waiting` is blocked behind its predecessor in the
// chain; `next` is the one task bd ready offers. In review is not a task state:
// it is an overlay for a done task whose bundle's review is open.
export type TaskState = 'waiting' | 'next' | 'inProgress' | 'done'

// What the plan document (.fathom/plans/<ref>.md) records about one review. Only a
// `recorded` review names an id; `pending` (a run reached openReview and wrote no
// outcome) and `none` (the user confirmed there is none) both count as no record.
export type PlanReview =
  | { kind: 'recorded'; id: string; url: string }
  | { kind: 'pending' }
  | { kind: 'none' }

// One `- Bundle k/N: <branch> - <refs>` line: bundle `index` of `of`, the branch it
// is built on, the sub-issue refs it carries, and the review line beneath it.
export type PlanBundle = {
  index: number
  of: number
  branch: string
  refs: string[]
  review: PlanReview | null
}

// The plan document read back as data. `bundles` is empty when the issue was not
// split into a stack, and `review` is then the issue's own review line, if any.
export type Plan = {
  issue: string | null
  ref: string | null
  branch: string | null
  bundles: PlanBundle[]
  review: PlanReview | null
  isFinalized: boolean
}

// One sub-task of the run, in the order the chain runs it.
export type RunTask = {
  id: string
  // The sub-issue ref the task was created for (bd's external_ref). It names the
  // task's bundle in the plan document.
  ref: string | null
  title: string
  state: TaskState
  // A done task whose bundle has a recorded review, while the run is still executing.
  // The plan document does not say whether that review merged, so a recorded review
  // counts as open. A finished run has none.
  isInReview: boolean
}

// What the band shows. `idle` is not armed, so the band yields. `starting` is armed
// with no run found yet. `creating` has an epic and the tasks made so far, with no
// total: the plan document that fixes it is written after the last task. `executing`
// and `finished` carry every task. `unavailable` carries why bd could not be read,
// so the band can say so instead of showing zeros.
export type Snapshot =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'creating'; ref: string; created: number }
  | { kind: 'executing'; ref: string; tasks: RunTask[] }
  | { kind: 'finished'; ref: string; tasks: RunTask[] }
  | { kind: 'unavailable'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'fathom-progress': {
      // When the latest Fathom invocation of the session happened, in ms; null until
      // the first one and again after the session ends. While it is null the band
      // yields and nothing polls.
      armedAt: number | null
      // What the band draws, rebuilt from bd while armed.
      snapshot: Snapshot
      // The person's toggle, like beads-status has.
      isHidden: boolean
    }
  }
}
