import type { Checklist, ChecklistTask } from '../types'

// The checklist file at .fathom/tasks/<ref>.md, read back as data: the memory backend
// Fathom uses when the base branch does not track beads (memory/checklist.md in the
// Fathom skill). The file in the working tree is the truth, not the last commit, since
// the in-progress marker is left uncommitted. Everything here is pure over the text, so
// it can be tested without a session.
const FENCE = /^\s*(```|~~~)/
// The header, `# <ref>: <title>`. The title may be missing in a file `init` just made.
const HEADING = /^# +([A-Za-z][A-Za-z0-9]*-\d+)(?:: +(\S.*?))?\s*$/
const SECTION = /^## +(.+?)\s*$/
const LINK = /^\s*- (Issue|Branch|Review|PR): (.+?)\s*$/
const TASK = /^\s*- \[( |>|x)\] (\d+)\. (.+?)\s*$/
// The tail close writes: `(done YYYY-MM-DD)`, then the hash once the commit exists.
const DONE = /\s*\(done (\d{4}-\d{2}-\d{2})(?:, ([0-9a-f]{4,40}))?\)\s*$/
const SUB_ISSUE = /\s*->\s*sub-issue:\s*(\S+)\s*$/
const DEPS = /\s*\(deps:\s*(\d+(?:\s*,\s*\d+)*)\s*\)/

const MARKERS = { ' ': 'open', '>': 'inProgress', x: 'done' } as const

// One line under `## Tasks`, or null for any other line: a blank, the `Closed` footer an
// older sweep appended, prose, or a task line too broken to name a number and a title.
function taskOf(line: string): ChecklistTask | null {
  const match = TASK.exec(line)
  if (!match) return null
  const marker = MARKERS[(match[1] ?? ' ') as keyof typeof MARKERS]

  let rest = match[3] ?? ''
  const done = DONE.exec(rest)
  if (done) rest = rest.slice(0, done.index)
  const sub = SUB_ISSUE.exec(rest)
  if (sub) rest = rest.slice(0, sub.index)
  const deps = DEPS.exec(rest)
  if (deps) rest = rest.replace(DEPS, '')

  const title = rest.replace(/\s+/g, ' ').trim()
  if (title === '') return null
  return {
    number: Number(match[2]),
    title,
    marker,
    deps: deps ? (deps[1] ?? '').split(',').map(n => Number(n.trim())) : [],
    subIssue: sub?.[1] ?? null,
    doneOn: done?.[1] ?? null,
    hash: done?.[2] ?? null,
  }
}

// What follows `- Review: `: an id and a URL once the review exists. The placeholder
// before that (`(id and url, filled at open)`) names nothing.
function reviewOf(value: string): Checklist['review'] {
  const [id, url, ...rest] = value.split(/\s+/)
  return id && url && rest.length === 0 && !value.startsWith('(') ? { kind: 'recorded', id, url } : null
}

// Lines inside a code fence are skipped, so a file that quotes Fathom's own format in an
// example does not read as a record. The Issue, Branch and Review lines count only in the
// header block above the first `##` section, where Fathom writes them. A task line counts
// only under `## Tasks`, and the first of two lines with one number wins.
export function parseChecklist(text: string): Checklist {
  const checklist: Checklist = {
    ref: null,
    title: null,
    issue: null,
    branch: null,
    review: null,
    pr: null,
    tasks: [],
  }
  let isFenced = false
  let hasHeading = false
  let section: string | null = null

  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue

    if (!hasHeading && /^# /.test(line)) {
      hasHeading = true
      const heading = HEADING.exec(line)
      if (heading) {
        checklist.ref = heading[1] ?? null
        checklist.title = heading[2] ? heading[2].replace(/\s+/g, ' ') : null
      }
      continue
    }

    const named = SECTION.exec(line)
    if (named) {
      section = (named[1] ?? '').toLowerCase()
      continue
    }

    if (section === null) {
      const link = LINK.exec(line)
      if (!link) continue
      const value = link[2] ?? ''
      if (link[1] === 'Issue') checklist.issue ??= value
      else if (link[1] === 'Branch') checklist.branch ??= value
      else if (link[1] === 'Review') checklist.review ??= reviewOf(value)
      else checklist.pr ??= value
      continue
    }

    if (section === 'tasks') {
      const task = taskOf(line)
      if (task && !checklist.tasks.some(t => t.number === task.number)) checklist.tasks.push(task)
    }
  }

  checklist.tasks.sort((a, b) => a.number - b.number)
  return checklist
}
