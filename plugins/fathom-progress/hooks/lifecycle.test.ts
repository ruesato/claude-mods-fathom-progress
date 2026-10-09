import { test, expect } from 'claude-code/testing'

import { planPath, startOf, touchesRun } from './lifecycle'

test('startOf names which Fathom skill started, with or without the plugin prefix', async () => {
  expect(startOf('fathom:execute')).toBe('execute')
  expect(startOf('execute')).toBe('execute')
  expect(startOf('fathom:scaffold')).toBe('scaffold')
  expect(startOf('scaffold')).toBe('scaffold')
})

test('the other Fathom skills, other plugins\' skills and near misses start nothing', async () => {
  for (const name of ['fathom:review', 'fathom:ship', 'fathom:fathom-shared', 'ship:execute', 'fathom:execute-all', 'xfathom:execute', 'commit', '']) {
    expect(startOf(name)).toBeNull()
  }
})

test('planPath puts a plain ref under .fathom/plans, whether or not the root ends in a slash', async () => {
  expect(planPath('/work/repo', 'SLU-123')).toBe('/work/repo/.fathom/plans/SLU-123.md')
  expect(planPath('/work/repo/', 'ONC-5')).toBe('/work/repo/.fathom/plans/ONC-5.md')
  expect(planPath('/work/repo', '1209384756')).toBe('/work/repo/.fathom/plans/1209384756.md')
})

test('planPath refuses a ref that could leave the directory or is not a token', async () => {
  for (const ref of ['', '.', '..', '../x', 'a/b', 'a b', 'x\n', '$(id)']) {
    expect(planPath('/work/repo', ref)).toBeNull()
  }
})

test('a bd call or a commit may have changed the run, and other commands have not', async () => {
  for (const command of ['bd update fx-1 --claim', 'bd close fx-2', 'cd repo && bd list --json', 'git add x; bd ready', 'git commit -m "x"', 'git -C repo commit -m x']) {
    expect(touchesRun(command)).toBe(true)
  }
  for (const command of ['ls -la', 'git status', 'echo bdx', 'cat feedback.md', 'npm test', 'git commits']) {
    expect(touchesRun(command)).toBe(false)
  }
})
