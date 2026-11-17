import { test, expect } from 'vitest';
import { splChangesMarkdown, dependenciesMarkdown, isSyncDescription, SPL_CHANGES_HEADING, SYNC_DESCRIPTION_HEADING } from '../model/services/changelogs.js';

// What a product is told when its SPL moves: the SPL's own commits (any kind of line), then what its dependencies changed.
const entry = (description, version, extra = {}) => ({ description, version, shortId: `c${version.replace(/\./g, '')}`, webUrl: `https://git.example/x/-/commit/c${version.replace(/\./g, '')}`, ...extra });
const changelog = {
  sections: [
    { id: 'breaking', title: 'Breaking changes', entries: [entry('greet() takes an options object', '2.0.0', { scope: 'api' })] },
    { id: 'fixes', title: 'Fixes', entries: [entry('add the missing exclamation mark', '1.2.0', { scope: 'greet' })] },
    { id: 'features', title: 'Features', entries: [] },
  ],
};

test('the SPL commits go by version, the oldest first, each with a link to its commit', () => {
  const text = splChangesMarkdown({ from: '1.1.0', to: '2.0.0', changelog });
  expect(text.startsWith(SPL_CHANGES_HEADING)).toBe(true);
  expect(text).toContain('(v1.1.0 → v2.0.0)');
  expect(text.indexOf('### v1.2.0')).toBeLessThan(text.indexOf('### v2.0.0'));
  expect(text).toContain('⚠ **api:** greet() takes an options object ([c200](https://git.example/x/-/commit/c200))');
  expect(text).toContain('- **greet:** add the missing exclamation mark ([c120](https://git.example/x/-/commit/c120))');
  expect(text).not.toContain('Features'); // a section with nothing in it is left out
});

test('a commit whose host gave no address keeps its id without a link', () => {
  const text = splChangesMarkdown({ from: '1.0.0', to: '1.1.0', changelog: { sections: [{ id: 'fixes', title: 'Fixes', entries: [entry('x', '1.1.0', { webUrl: '' })] }] } });
  expect(text).toContain('x (c110)');
  expect(text).not.toContain('](');
});

test('nothing to say gives an empty description', () => {
  expect(splChangesMarkdown({ from: '1.0.0', to: '1.1.0', changelog: { sections: [] } })).toBe('');
  expect(splChangesMarkdown({ from: '1.0.0', to: '1.1.0', changelog: null })).toBe('');
});

test('what a commit says cannot mention people or link items in the request, and a link cannot be broken out of', () => {
  const text = splChangesMarkdown({ from: '1.0.0', to: '1.1.0', changelog: { sections: [{ id: 'fixes', title: 'Fixes', entries: [entry('thanks @someone, closes #12 and !3 <script>', '1.1.0', { webUrl: 'https://git.example/c) [x](https://evil.example' })] }] } });
  expect(text).not.toMatch(/@someone|#12|!3|<script>/);
  expect(text).not.toContain('](https://evil');
});

test('a description a sync wrote is recognised, one a person wrote is not', () => {
  expect(isSyncDescription(`${SPL_CHANGES_HEADING} (v1.0.0 → v1.1.0)\n\n- x`)).toBe(true);
  expect(isSyncDescription(`${SYNC_DESCRIPTION_HEADING} (line v1.0.0 → v1.1.0)`)).toBe(true);
  expect(isSyncDescription('Please review, this is mine')).toBe(false);
  expect(isSyncDescription('')).toBe(false); // (an empty one is filled in by the caller, which checks for it first)
});

test('the dependencies come after the SPL commits, metamodels and modules apart, versions oldest first', () => {
  const dep = (name, kind) => ({ name, kind, change: 'upgraded', from: '0.1.0', to: '0.3.0', changelog: { breaking: false, sections: [
    { id: 'fixes', title: 'Fixes', entries: [entry('fix it', '0.3.0')] },
    { id: 'features', title: 'Features', entries: [entry('add a capability', '0.2.0')] },
  ] } });
  const both = [splChangesMarkdown({ from: '1.1.0', to: '1.2.0', changelog }), dependenciesMarkdown({ from: '1.1.0', to: '1.2.0', dependencies: [dep('a-module', 'module'), dep('a-metamodel', 'metamodel')] })].filter(Boolean).join('\n\n');
  expect(both.indexOf(SPL_CHANGES_HEADING)).toBeLessThan(both.indexOf(SYNC_DESCRIPTION_HEADING));
  expect(both.indexOf('### Metamodels')).toBeLessThan(both.indexOf('### Modules'));
  expect(both).toContain('**a-metamodel**: v0.1.0 → v0.3.0');
  const mm = both.slice(both.indexOf('### Metamodels'), both.indexOf('### Modules'));
  expect(mm.indexOf('**v0.2.0**')).toBeLessThan(mm.indexOf('**v0.3.0**'));
  expect(mm).toContain('add a capability ([c020](https://git.example/x/-/commit/c020))');
});
