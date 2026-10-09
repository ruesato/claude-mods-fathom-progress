// The small decisions the lifecycle in register.tsx makes, pulled out so they can be
// tested: register.tsx reads engine state, which is empty in a test, so none of its
// own code can be.

// The skills that start a Fathom run, and which of the two one is. The engine reports
// a skill as `plugin:skill` (`fathom:execute`, seen in the probe,
// claude-mods-fathom-5l2.2); a bare name is accepted too, since the Skill tool takes
// whatever the model passes. `review` and `ship` do not start a run, and the plugin's
// internal `fathom-shared` is never invoked.
//
// Only execute writes beads, so only execute has a run to find: scaffold shows
// `starting` and nothing polls, which also keeps the band from showing some older open
// run as if scaffold had started it.
export function startOf(skill: string): 'execute' | 'scaffold' | null {
  const [, , name] = /^(fathom:)?(execute|scaffold)$/.exec(skill) ?? []
  return name === 'execute' || name === 'scaffold' ? name : null
}

// The plan document of a run: .fathom/plans/<ref>.md under the session's root. A ref
// that could leave that directory, or is not a plain token, has no document to read.
export function planPath(root: string, ref: string): string | null {
  return /^[\w.-]+$/.test(ref) && ref !== '.' && ref !== '..'
    ? `${root.replace(/\/+$/, '')}/.fathom/plans/${ref}.md`
    : null
}

// A Bash command that may have changed what bd or the plan document holds: a bd call,
// or a commit (the plan document is committed with the breakdown, and each task with
// its own commit). The band refreshes after it instead of waiting for the next poll.
// A match that is not one, such as `git log --grep commit`, only costs a refresh.
export function touchesRun(command: string): boolean {
  return /(^|[\s;&|(])bd\s/.test(command) || /\bgit\b[^;&|\n]*\bcommit\b/.test(command)
}

// How often the band re-reads bd while armed. A bd call costs about 0.65s here, so
// one refresh is about 2s of work; 10s keeps that to a fifth of a core at worst.
export const POLL_MS = 10_000
