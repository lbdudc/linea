import { describe, expect, it } from 'vitest'
import { closingIssueNumbers } from '../src/index.js'

describe('closingIssueNumbers', () => {
  it('reads the closing words, in any case and form', () => {
    expect(closingIssueNumbers('Closes #1', 'fixed #2', 'RESOLVES: #3', 'Implements #4', 'closing #5')).toEqual([1, 2, 3, 4, 5])
  })

  it('reads a list after one word', () => {
    expect(closingIssueNumbers('Fixes #1, #2 and #3 & #4')).toEqual([1, 2, 3, 4])
  })

  it('ignores a plain mention, another word that ends the same, and what is not a number', () => {
    expect(closingIssueNumbers('see #7', 'disclose #8', 'closes the door', 'fix #', undefined, null)).toEqual([])
  })

  it('counts an issue once', () => {
    expect(closingIssueNumbers('Closes #1', 'Fixes #1')).toEqual([1])
  })
})
