import { describe, expect, it } from 'vitest'
import { defaultTemplate, withTemplate } from 'src/utils/templates'
import { notificationLink } from 'src/utils/notificationLink'

const bug = { name: 'Bug', content: '## Steps' }
const idea = { name: 'Idea', content: '## Why' }

describe('defaultTemplate', () => {
  it('is none when there are none, or several and none is the default', () => {
    expect(defaultTemplate([])).toBeNull()
    expect(defaultTemplate(undefined)).toBeNull()
    expect(defaultTemplate([bug, idea])).toBeNull()
  })

  it('is the only one, or the one called default in any case', () => {
    expect(defaultTemplate([bug])).toBe(bug)
    const standard = { name: 'DEFAULT', content: 'x' }
    expect(defaultTemplate([bug, standard])).toBe(standard)
  })
})

describe('withTemplate', () => {
  it('replaces an empty or untouched description', () => {
    expect(withTemplate({ description: '', previous: null, next: bug })).toBe('## Steps')
    expect(withTemplate({ description: '## Steps', previous: bug, next: idea })).toBe('## Why')
    expect(withTemplate({ description: '## Steps', previous: bug, next: null })).toBe('')
  })

  it('keeps what the person wrote and adds the template after it', () => {
    expect(withTemplate({ description: 'It crashes\n', previous: null, next: bug })).toBe('It crashes\n\n## Steps')
    expect(withTemplate({ description: 'It crashes', previous: bug, next: null })).toBe('It crashes')
  })
})

describe('notificationLink', () => {
  it('opens the issue or the merge request in the tab of the line or product', () => {
    expect(notificationLink({ subject: 'issue', number: 3, target: { kind: 'line', id: 'a1' } })).toBe('/lines/a1?tab=issues&issue=3')
    expect(notificationLink({ subject: 'mr', number: 7, target: { kind: 'product', id: 'b2' } })).toBe('/products/b2?tab=mrs&mr=7')
  })
})
