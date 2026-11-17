/** The words of the feature metamodel's grammars: a name that is one has to be written between quotes. */
const WORDS = new Set(['featuremodel', 'feature', 'abstract', 'mandatory', 'optional', 'alternative', 'or', 'constraints', 'selection', 'of', 'select', 'deselect'])

/** A name as the feature metamodel writes it: plain when it can be, else between double quotes. */
export const bangoName = ({ name }: { name: string }): string =>
  /^[_a-zA-Z][\w-]*$/.test(name) && !WORDS.has(name) ? name : JSON.stringify(name)

/** The root feature of a new SPL called `name`: its parts joined in camel case (`QA-Mono.2` is `QAMono2`), or `fallback` when nothing of the name is left. */
export const rootFeatureName = ({ name, fallback = 'Spl' }: { name: string, fallback?: string }): string =>
  name.replace(/(^|[-_.\s]+)(.)/g, (_match, _separator, char: string) => char.toUpperCase()).replace(/[^A-Za-z0-9_]/g, '') || fallback
