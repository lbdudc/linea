import { describe, it, expect } from 'vitest'
import { diffLines, hunksOf, countChanges, diffModules, diffPackages, withContext } from 'src/utils/textDiff'

describe('diffLines', () => {
  it('marks what was added and what was removed, in order', () => {
    const diff = diffLines('a\nb\nc', 'a\nc\nd')
    expect(diff.map((l) => `${l.type}:${l.text}`)).toEqual(['same:a', 'del:b', 'same:c', 'add:d'])
    expect(countChanges(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('is empty of changes for the same text, and everything added for an empty one', () => {
    expect(countChanges(diffLines('x\ny', 'x\ny'))).toEqual({ added: 0, removed: 0 })
    expect(countChanges(diffLines('', 'x\ny'))).toEqual({ added: 2, removed: 0 })
  })

  it('keeps three lines of context around a change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'changed')
    const hunks = hunksOf(diffLines(before, after), 3)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines).toHaveLength(3 + 2 + 3)
  })
})

describe('diffModules', () => {
  it('tells the modules that came in, went out, and changed what they accept', () => {
    const d = diffModules({ 'gitlab:r/a': '^1.0.0', 'gitlab:r/b': '*' }, { 'gitlab:r/a': '^1.1.0', 'gitlab:r/c': '*' })
    expect(d.added.map((m) => m.location)).toEqual(['gitlab:r/c'])
    expect(d.removed.map((m) => m.location)).toEqual(['gitlab:r/b'])
    expect(d.changed).toEqual([{ location: 'gitlab:r/a', from: '^1.0.0', to: '^1.1.0' }])
  })
})

describe('diffPackages', () => {
  it('compares the versions a resolution gave', () => {
    const rows = diffPackages(
      [{ location: 'x/a', name: 'a', kind: 'module', version: '1.0.0' }, { location: 'x/b', name: 'b', kind: 'metamodel', version: '1.0.0' }],
      [{ location: 'x/a', name: 'a', kind: 'module', version: '1.2.0' }, { location: 'x/c', name: 'c', kind: 'module', version: '0.1.0' }],
    )
    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual(['a:chg', 'b:del', 'c:add'])
    expect(rows[0]).toMatchObject({ from: '1.0.0', to: '1.2.0' })
  })
})

describe('withContext', () => {
  it('keeps the changes with a little around them and says how many lines it left out', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'changed')
    const shown = withContext(diffLines(before, after), 2)

    expect(shown[0]).toEqual({ type: 'gap', skipped: 8 })
    expect(shown.filter((l) => l.type === 'del' || l.type === 'add')).toHaveLength(2)
    expect(shown.at(-1)).toEqual({ type: 'gap', skipped: 7 })
  })
})
