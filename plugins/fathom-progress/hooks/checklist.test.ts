import { test, expect } from 'claude-code/testing'

import { parseChecklist } from './checklist'

// The example memory/checklist.md in the Fathom skill gives, line for line.
const EXAMPLE = [
  '# ONC-5: Add login flow',
  '',
  '- Issue: https://linear.app/acme/issue/ONC-5',
  '- Branch: feat/onc-5-add-login',
  '- Review: (id and url, filled at open)',
  '- PR: (legacy, read but no longer written)',
  '',
  '## Plan',
  '',
  'One-paragraph approach summary.',
  'Testing notes.',
  '',
  '## Tasks',
  '',
  '- [x] 1. Create login form component -> sub-issue: https://x.test/ONC-6 (done 2026-07-28, a1b2c3d)',
  '- [>] 2. Wire auth API (deps: 1) -> sub-issue: https://x.test/ONC-7',
  '- [ ] 3. Add e2e test (deps: 2) -> sub-issue: https://x.test/ONC-8',
].join('\n')

test('the documented example reads as the issue, its links and three tasks', async () => {
  const checklist = parseChecklist(EXAMPLE)

  expect(checklist.ref).toBe('ONC-5')
  expect(checklist.title).toBe('Add login flow')
  expect(checklist.issue).toBe('https://linear.app/acme/issue/ONC-5')
  expect(checklist.branch).toBe('feat/onc-5-add-login')
  expect(checklist.tasks).toEqual([
    {
      number: 1,
      title: 'Create login form component',
      marker: 'done',
      deps: [],
      subIssue: 'https://x.test/ONC-6',
      doneOn: '2026-07-28',
      hash: 'a1b2c3d',
    },
    {
      number: 2,
      title: 'Wire auth API',
      marker: 'inProgress',
      deps: [1],
      subIssue: 'https://x.test/ONC-7',
      doneOn: null,
      hash: null,
    },
    {
      number: 3,
      title: 'Add e2e test',
      marker: 'open',
      deps: [2],
      subIssue: 'https://x.test/ONC-8',
      doneOn: null,
      hash: null,
    },
  ])
})

test('the placeholder Review line names no review, and the legacy PR line is kept apart from it', async () => {
  const checklist = parseChecklist(EXAMPLE)

  expect(checklist.review).toBeNull()
  expect(checklist.pr).toBe('(legacy, read but no longer written)')
})

test('a Review line with an id and a URL is a recorded review', async () => {
  const checklist = parseChecklist('# ONC-5: A\n\n- Review: 42 https://github.com/acme/app/pull/42\n')

  expect(checklist.review).toEqual({ kind: 'recorded', id: '42', url: 'https://github.com/acme/app/pull/42' })
})

test('a PR line with a URL and no id is a legacy record, not a review', async () => {
  const checklist = parseChecklist('# ONC-5: A\n\n- PR: https://github.com/acme/app/pull/7\n')

  expect(checklist.review).toBeNull()
  expect(checklist.pr).toBe('https://github.com/acme/app/pull/7')
})

test('several dependencies are one comma-separated list, and a task may have none, one or many', async () => {
  const text = [
    '## Tasks',
    '- [x] 1. First',
    '- [x] 2. Second',
    '- [ ] 3. Third (deps: 1, 2) -> sub-issue: ONC-9',
    '- [ ] 4. Fourth (deps: 3)',
  ].join('\n')
  // The tasks sit under the section, so the lines above it are not a header block.
  const tasks = parseChecklist(text).tasks

  expect(tasks.map(t => t.deps)).toEqual([[], [], [1, 2], [3]])
  expect(tasks[2]?.subIssue).toBe('ONC-9')
  expect(tasks[3]?.subIssue).toBeNull()
})

test('several in-progress lines are kept, which is how a parallel run reads', async () => {
  const text = ['## Tasks', '- [>] 1. One', '- [>] 2. Two', '- [ ] 3. Three (deps: 1, 2)'].join('\n')

  expect(parseChecklist(text).tasks.map(t => t.marker)).toEqual(['inProgress', 'inProgress', 'open'])
})

test('a closed task whose hash is not written yet has a date and no hash', async () => {
  const task = parseChecklist('## Tasks\n- [x] 1. Done (done 2026-10-20)\n').tasks[0]

  expect(task?.doneOn).toBe('2026-10-20')
  expect(task?.hash).toBeNull()
})

test('the Closed footer an older sweep appended is not a task and changes no count', async () => {
  const text = `${EXAMPLE}\n- Closed: 2026-07-30\n`

  expect(parseChecklist(text).tasks.map(t => t.number)).toEqual([1, 2, 3])
})

test('task lines outside the Tasks section are not tasks', async () => {
  const text = [
    '# ONC-5: A',
    '',
    '## Plan',
    '- [ ] 9. A step the plan lists',
    '',
    '## Tasks',
    '- [ ] 1. The only task',
    '',
    '## Notes',
    '- [ ] 8. A follow-up note',
  ].join('\n')

  expect(parseChecklist(text).tasks.map(t => t.number)).toEqual([1])
})

test('links count in the header block only, so a Plan that quotes them does not change them', async () => {
  const text = [
    '# ONC-5: A',
    '- Branch: feat/onc-5-real',
    '',
    '## Plan',
    '- Branch: feat/onc-5-quoted',
    '',
    '## Tasks',
    '- [ ] 1. T',
  ].join('\n')

  expect(parseChecklist(text).branch).toBe('feat/onc-5-real')
})

test('lines inside a code fence are skipped', async () => {
  const text = ['# ONC-5: A', '', '## Tasks', '```', '- [x] 1. Quoted from the docs', '```', '- [ ] 2. Real'].join('\n')

  expect(parseChecklist(text).tasks.map(t => t.title)).toEqual(['Real'])
})

test('tasks come out in task-number order, and the first of two lines with a number wins', async () => {
  const text = ['## Tasks', '- [ ] 3. Third', '- [x] 1. First', '- [ ] 1. First again', '- [ ] 2. Second'].join('\n')
  const tasks = parseChecklist(text).tasks

  expect(tasks.map(t => t.number)).toEqual([1, 2, 3])
  expect(tasks[0]).toMatchObject({ title: 'First', marker: 'done' })
})

test('a task line too broken to name a number and a title is skipped, not an error', async () => {
  const text = [
    '## Tasks',
    '- [?] 1. Unknown marker',
    '- [ ] two. No number',
    '- [ ] 3.',
    '- [ ] 4. (deps: 1)',
    '- [ ] 5. Fine',
  ].join('\n')

  expect(parseChecklist(text).tasks.map(t => t.number)).toEqual([5])
})

test('a header with no title still names the ref', async () => {
  const checklist = parseChecklist('# ONC-5\n\n## Tasks\n')

  expect(checklist.ref).toBe('ONC-5')
  expect(checklist.title).toBeNull()
})

test('text that is not a checklist reads as an empty one', async () => {
  for (const text of ['', 'hello\nworld', '# Just a note\n\nNo tasks here.', '{"not": "a checklist"}']) {
    const checklist = parseChecklist(text)

    expect(checklist.ref).toBeNull()
    expect(checklist.tasks).toEqual([])
  }
})

test('Windows line endings read the same as Unix ones', async () => {
  expect(parseChecklist(EXAMPLE.replace(/\n/g, '\r\n'))).toEqual(parseChecklist(EXAMPLE))
})
