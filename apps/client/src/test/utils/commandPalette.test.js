import { describe, it, expect, beforeEach } from 'vitest'
import { fuzzyScore, searchEntries, readRecent, rememberRecent, highlightParts, countByGroup, readUsage, recordUsage, readPinned, togglePinned, PINNED_MAX } from 'src/utils/commandPalette'

const entries = [
  { id: 'line:1', group: 'lines', title: 'GIS-Platform', caption: 'v1.0.0' },
  { id: 'product:1', group: 'products', title: 'GIS-Platform-1', caption: 'GIS-Platform' },
  { id: 'module:17', group: 'modules', title: 'main-component', caption: 'registry/modules/main-component' },
  { id: 'page:users', group: 'pages', title: 'Configuration → Users', caption: '', keywords: ['settings'] },
  { id: 'action:create-line', group: 'actions', title: 'Create SPL', caption: '' },
  { id: 'action:theme', group: 'actions', title: 'Toggle theme', caption: '' },
]

describe('fuzzyScore', () => {
  it('ranks exact, prefix, substring and subsequence matches in that order', () => {
    const exact = fuzzyScore('sensor', 'sensor')
    const prefix = fuzzyScore('sen', 'sensor')
    const inside = fuzzyScore('nso', 'sensor')
    const loose = fuzzyScore('snr', 'sensor')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(loose)
    expect(loose).toBeGreaterThan(-1)
  })

  it('rejects text that does not contain the letters in order', () => {
    expect(fuzzyScore('zq', 'sensor')).toBe(-1)
  })
})

describe('searchEntries', () => {
  it('finds modules and pages by name or keyword', () => {
    expect(searchEntries(entries, 'main-comp').map((e) => e.id)).toEqual(['module:17'])
    expect(searchEntries(entries, 'settings').map((e) => e.id)).toEqual(['page:users'])
  })

  it('matches the caption and keywords only as a substring, not as scattered letters', () => {
    const items = [{ id: 'm', group: 'modules', title: 'security', caption: 'registry/metamodels/security', keywords: ['the units of every user'] }]
    expect(searchEntries(items, 'users')).toEqual([])
    expect(searchEntries(items, 'metamodels')).toHaveLength(1)
  })

  it('drops scattered-letter matches when something matches directly, and puts the best group first', () => {
    const items = [
      { id: 'action:lang', group: 'actions', title: 'Language: English', caption: '' },
      { id: 'line:1', group: 'lines', title: 'GIS-Platform', caption: '' },
    ]
    expect(searchEntries(items, 'gis').map((e) => e.id)).toEqual(['line:1'])
    expect(searchEntries(items, 'lngg').map((e) => e.id)).toEqual(['action:lang'])
  })

  it('shows only actions after a > prefix', () => {
    expect(searchEntries(entries, '>create').map((e) => e.id)).toEqual(['action:create-line'])
    expect(searchEntries(entries, '>').every((e) => e.group === 'actions')).toBe(true)
  })

  it('puts the recent entries first when nothing is typed', () => {
    const result = searchEntries(entries, '', { recent: ['module:17'] })
    expect(result[0]).toMatchObject({ id: 'module:17', group: 'recent' })
    expect(result[0].origin).toBe('modules')
    expect(result.filter((e) => e.id === 'module:17')).toHaveLength(1)
    expect(countByGroup(result)).toMatchObject({ modules: 1 })
  })

  it('lists every action after a > prefix, however many there are', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `action:${i}`, group: 'actions', title: `action-${i}`, caption: '' }))
    expect(searchEntries(many, '>', { perGroup: 5 })).toHaveLength(20)
    expect(searchEntries(many, '>action', { perGroup: 5 })).toHaveLength(20)
    expect(searchEntries(many, 'action', { perGroup: 5 })).toHaveLength(5)
  })

  it('ranks an entry with a boost above the others that match as well', () => {
    const items = [
      { id: 'a', group: 'actions', title: 'Open item', caption: '' },
      { id: 'b', group: 'actions', title: 'Open item later', caption: '', boost: 300 },
    ]
    expect(searchEntries(items, 'open item').map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('caps each group', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `line:${i}`, group: 'lines', title: `line-${i}`, caption: '' }))
    expect(searchEntries(many, 'line', { perGroup: 3 })).toHaveLength(3)
  })
})

describe('recent entries', () => {
  beforeEach(() => localStorage.clear())

  it('remembers the latest first, without repeats', () => {
    rememberRecent('a')
    rememberRecent('b')
    rememberRecent('a')
    expect(readRecent()).toEqual(['a', 'b'])
  })
})

describe('highlightParts', () => {
  it('marks the substring that matched', () => {
    expect(highlightParts('main-component', 'comp')).toEqual([
      { text: 'main-', match: false }, { text: 'comp', match: true }, { text: 'onent', match: false },
    ])
  })

  it('marks scattered letters when there is no substring, and nothing when they are not all there', () => {
    expect(highlightParts('sensor', 'snr').filter((p) => p.match).map((p) => p.text).join('')).toBe('snr')
    expect(highlightParts('sensor', 'zq')).toEqual([{ text: 'sensor', match: false }])
  })

  it('ignores the > of the actions mode and an empty query', () => {
    expect(highlightParts('Create line', '>create')[0]).toEqual({ text: 'Create', match: true })
    expect(highlightParts('Create line', '')).toEqual([{ text: 'Create line', match: false }])
  })
})

describe('groups', () => {
  it('can be narrowed to some groups and counted', () => {
    expect(searchEntries(entries, 'gis', { groups: ['products'] }).map((e) => e.id)).toEqual(['product:1'])
    expect(countByGroup(entries)).toMatchObject({ lines: 1, actions: 2 })
  })
})

describe('remembered use', () => {
  beforeEach(() => localStorage.clear())

  it('counts how often each action is used', () => {
    recordUsage('action:theme')
    recordUsage('action:theme')
    recordUsage('action:create-line')
    expect(readUsage()).toEqual({ 'action:theme': 2, 'action:create-line': 1 })
  })

  it('orders the actions of the empty palette by use, keeping the rest of the order', () => {
    const result = searchEntries(entries, '>', { usage: { 'action:theme': 3 } })
    expect(result.map((e) => e.id)).toEqual(['action:theme', 'action:create-line'])
    expect(searchEntries(entries, '>').map((e) => e.id)).toEqual(['action:create-line', 'action:theme'])
  })

  it('lets use break the tie between matches', () => {
    const items = [
      { id: 'a', group: 'actions', title: 'Open one', caption: '' },
      { id: 'b', group: 'actions', title: 'Open two', caption: '' },
    ]
    expect(searchEntries(items, 'open', { usage: { b: 4 } }).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('ranks by the usage key when an entry has one', () => {
    const items = [
      { id: 'x1', usageKey: 'k:generate', group: 'actions', title: 'Generate one', caption: '' },
      { id: 'x2', group: 'actions', title: 'Generate two', caption: '' },
    ]
    expect(searchEntries(items, 'generate', { usage: { 'k:generate': 5 } })[0].id).toBe('x1')
  })

  it('puts the pinned entries first in the empty palette, before the recent ones, once each', () => {
    const result = searchEntries(entries, '', { pinned: ['action:theme'], recent: ['action:theme', 'module:17'] })
    expect(result.slice(0, 2).map((e) => [e.id, e.group])).toEqual([['action:theme', 'pinned'], ['module:17', 'recent']])
    expect(result.filter((e) => e.id === 'action:theme')).toHaveLength(1)
    expect(result[0].origin).toBe('actions')
  })

  it('does not lift pinned entries when searching', () => {
    expect(searchEntries(entries, 'theme', { pinned: ['action:theme'] })[0].group).toBe('actions')
  })

  it('pins up to three entries and unpins on a second toggle', () => {
    for (const id of ['a', 'b', 'c']) togglePinned(id)
    expect(readPinned()).toEqual(['a', 'b', 'c'])
    expect(togglePinned('d')).toEqual({ pinned: ['a', 'b', 'c'], full: true })
    expect(togglePinned('b')).toEqual({ pinned: ['a', 'c'], full: false })
    expect(PINNED_MAX).toBe(3)
  })

  it('ignores a damaged store', () => {
    localStorage.setItem('linea.search.usage', '[1,2')
    localStorage.setItem('linea.search.pinned', '{"a":1}')
    expect(readUsage()).toEqual({})
    expect(readPinned()).toEqual([])
  })
})
