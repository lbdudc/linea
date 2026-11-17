import type { DialogSpan, DialogTone } from '../commands/types.js';

/**
 * A UVL feature model as a tree a person can read. The file indents with tabs (eight columns each in a terminal) and gives a line of
 * its own to `mandatory`, `optional`, `or` and `alternative`; here those groups are a marker on each feature, so a level takes three
 * columns, and the constraints follow.
 */

type Kind = 'root' | 'mandatory' | 'optional' | 'or' | 'alternative' | 'group';

interface Node {
  name: string;
  attrs: string;
  kind: Kind;
  /** for a group line (`or`, `[1..2]`...): the kind its features take */
  group?: Kind;
  children: Node[];
}

const GROUPS: Record<string, Kind> = { mandatory: 'mandatory', optional: 'optional', or: 'or', alternative: 'alternative' };
const MARK: Record<Kind, string> = { root: '■', mandatory: '●', optional: '○', or: '◆', alternative: '◇', group: '▫' };
const TONE: Record<Kind, DialogTone> = { root: 'brand', mandatory: 'ok', optional: 'dim', or: 'info', alternative: 'warn', group: 'dim' };

export interface UvlView {
  /** the tree and the constraints, as spans with a tone each */
  lines: DialogSpan[][];
  /** the same without tones, for the history */
  text: string;
  features: number;
  constraints: number;
  /** what the markers mean */
  legend: DialogSpan[];
}

function depthOf(line: string, unit: number): number {
  const lead = /^[\t ]*/.exec(line)?.[0] ?? '';
  const tabs = (lead.match(/\t/g) ?? []).length;
  return tabs + Math.floor((lead.length - tabs) / unit);
}

export function viewUvl(uvl: string): UvlView {
  const raw = uvl
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('//'));
  // spaces are counted by the smallest indent seen; tabs are one level each
  const spaced = raw.map((l) => /^ +/.exec(l)?.[0].length ?? 0).filter((n) => n > 0);
  const unit = spaced.length ? Math.min(...spaced) : 1;

  const roots: Node[] = [];
  const constraints: string[] = [];
  let section: 'features' | 'constraints' | 'other' = 'other';
  const stack: { depth: number; node: Node }[] = [];
  let features = 0;

  for (const line of raw) {
    const text = line.trim();
    const depth = depthOf(line, unit);
    if (depth === 0) {
      const word = (text.split(/\s+/)[0] ?? '').toLowerCase();
      section = word === 'features' ? 'features' : word === 'constraints' ? 'constraints' : 'other';
      stack.length = 0;
      continue;
    }
    if (section === 'constraints') {
      constraints.push(text);
      continue;
    }
    if (section !== 'features') continue;

    const group = GROUPS[text.toLowerCase()] ?? (/^\[\d+(\.\.(\d+|\*))?\]$/.test(text) ? 'group' : undefined);
    const parts = /^(.*?)(\s*(\{.*\}|\[[^\]]*\]))?$/.exec(text);
    const node: Node = group
      ? { name: text, attrs: '', kind: 'group', group, children: [] }
      : { name: (parts?.[1] ?? text).trim(), attrs: (parts?.[3] ?? '').trim(), kind: 'optional', children: [] };
    while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= depth) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) {
      if (!group) node.kind = parent.kind === 'group' ? (parent.group ?? 'optional') : 'optional';
      parent.children.push(node);
    } else if (!group) {
      node.kind = 'root';
      roots.push(node);
    }
    if (!group) features++;
    stack.push({ depth, node });
  }

  // a group line is not drawn: its features hang from the feature that holds the group
  const featuresOf = (n: Node): Node[] => n.children.flatMap((c) => (c.kind === 'group' ? featuresOf(c) : [c]));

  const lines: DialogSpan[][] = [];
  const plain: string[] = [];
  const draw = (n: Node, prefix: string, last: boolean, top: boolean): void => {
    const guide = top ? '' : `${prefix}${last ? '└─ ' : '├─ '}`;
    const mark = MARK[n.kind];
    const spans: DialogSpan[] = [
      { text: guide, tone: 'dim' },
      { text: `${mark} `, tone: TONE[n.kind] },
      { text: n.name, tone: 'plain', bold: n.kind === 'root' },
    ];
    if (n.attrs) spans.push({ text: ` ${n.attrs}`, tone: 'dim' });
    lines.push(spans);
    plain.push(`${guide}${mark} ${n.name}${n.attrs ? ` ${n.attrs}` : ''}`);
    const kids = featuresOf(n);
    const next = top ? '' : `${prefix}${last ? '   ' : '│  '}`;
    kids.forEach((k, i) => draw(k, next, i === kids.length - 1, false));
  };
  // the history keeps the word UVL starts with, so what is printed is still recognisably the model
  plain.push('features');
  roots.forEach((r) => draw(r, '', true, true));

  if (constraints.length) {
    lines.push([]);
    plain.push('');
    lines.push([{ text: `constraints (${constraints.length})`, tone: 'dim' }]);
    plain.push(`constraints (${constraints.length})`);
    for (const c of constraints) {
      const spans: DialogSpan[] = [{ text: '  ', tone: 'dim' }];
      for (const part of c.split(/(<=>|=>|&|\||!)/)) {
        if (part) spans.push({ text: part, tone: /^(<=>|=>|&|\||!)$/.test(part) ? 'brand' : 'plain' });
      }
      lines.push(spans);
      plain.push(`  ${c}`);
    }
  }

  const legend: DialogSpan[] = [
    { text: '● ', tone: 'ok' },
    { text: 'mandatory  ', tone: 'dim' },
    { text: '○ ', tone: 'dim' },
    { text: 'optional  ', tone: 'dim' },
    { text: '◆ ', tone: 'info' },
    { text: 'or  ', tone: 'dim' },
    { text: '◇ ', tone: 'warn' },
    { text: 'alternative', tone: 'dim' },
  ];
  return { lines, text: plain.join('\n'), features, constraints: constraints.length, legend };
}
