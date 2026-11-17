/** Splits a line into words the way a shell would: spaces separate, quotes group. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || current) out.push(current);
      current = '';
      has = false;
    } else {
      current += ch;
    }
  }
  if (has || current) out.push(current);
  return out;
}

export interface FlagSpec {
  /** flags that take a value: `--to x`, `--to=x`, and their short form `-m x` */
  value?: Record<string, string | undefined>;
  /** flags that do not: `--yes`. A short form maps to the long name. */
  bool?: Record<string, string | undefined>;
  /** flags that may have a value: `--plain UML` or just `--plain` (the value is the next word, unless that is a flag) */
  optional?: Record<string, string | undefined>;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

/** The words that are not flags, and the flags. Unknown `--x` is a boolean flag, so a typo is not silently a value. */
export function parseFlags(args: readonly string[], spec: FlagSpec = {}): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const values = new Map<string, string>();
  for (const [name, short] of Object.entries(spec.value ?? {})) {
    values.set(name, name);
    if (short) values.set(short, name);
  }
  const optionals = new Map<string, string>();
  for (const [name, short] of Object.entries(spec.optional ?? {})) {
    optionals.set(name, name);
    if (short) optionals.set(short, name);
  }
  const bools = new Map<string, string>();
  for (const [name, short] of Object.entries(spec.bool ?? {})) {
    bools.set(name, name);
    if (short) bools.set(short, name);
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    const isLong = a.startsWith('--');
    const isShort = !isLong && /^-[a-zA-Z]$/.test(a);
    if (!isLong && !isShort) {
      positional.push(a);
      continue;
    }
    const [rawKey, inline] = isLong ? splitOnce(a.slice(2), '=') : [a.slice(1), undefined];
    const valueName = values.get(rawKey!);
    if (valueName) {
      const value = inline ?? args[++i];
      if (value === undefined) throw new Error(`--${valueName} needs a value.`);
      flags[valueName] = value;
    } else if (optionals.has(rawKey!)) {
      const next = args[i + 1];
      flags[optionals.get(rawKey!)!] = inline ?? (next !== undefined && !next.startsWith('-') ? args[++i]! : true);
    } else {
      flags[bools.get(rawKey!) ?? rawKey!] = inline ?? true;
    }
  }
  return { positional, flags };
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

export const flagString = (f: Parsed['flags'], name: string): string | undefined => {
  const v = f[name];
  return typeof v === 'string' ? v : undefined;
};
