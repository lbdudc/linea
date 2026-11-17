import { For, type JSX } from 'solid-js';
import { parseLine, TONE_COLOR } from './style.js';
import { theme } from './theme.js';

export interface HistoryItem {
  id: number;
  kind: 'input' | 'output' | 'error' | 'info';
  text: string;
}

/** One line of a result, with its `✓ ✗ ! ·` coloured. */
function Line(props: { text: string; force?: string }) {
  return (
    <box flexDirection="row">
      <For each={parseLine(props.text)}>
        {(part) => <text fg={props.force ?? TONE_COLOR[part.tone]} flexShrink={part.tone === 'plain' || part.tone === 'dim' ? 1 : 0}>{part.text}</text>}
      </For>
    </box>
  );
}

/** What a command answered: the lines, hanging from a `⎿`, the way a result hangs from the thing that asked for it. */
function Block(props: { text: string; kind: 'output' | 'error' | 'info' }) {
  const lines = () => props.text.replace(/\s+$/, '').split('\n');
  return (
    <box flexDirection="row" marginBottom={1}>
      <text fg={theme.faint} flexShrink={0}>{props.kind === 'info' ? '    ' : '  ⎿  '}</text>
      <box flexDirection="column" flexShrink={1} flexGrow={1}>
        <For each={lines()}>
          {(line) => <Line text={line} force={props.kind === 'error' ? theme.error : props.kind === 'info' ? theme.muted : undefined} />}
        </For>
      </box>
    </box>
  );
}

export function HistoryView(props: { items: HistoryItem[]; header?: JSX.Element }) {
  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" verticalScrollbarOptions={{ visible: false }}>
      {props.header}
      <For each={props.items}>
        {(item) =>
          item.kind === 'input' ? (
            <box flexDirection="row" backgroundColor={theme.quoteBg} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <text fg={theme.brand} flexShrink={0}>{'❯ '}</text>
              <text fg={theme.fg}>{item.text}</text>
            </box>
          ) : (
            <Block text={item.kind === 'error' && !item.text.startsWith('✗') ? `✗ ${item.text}` : item.text} kind={item.kind} />
          )
        }
      </For>
    </scrollbox>
  );
}
