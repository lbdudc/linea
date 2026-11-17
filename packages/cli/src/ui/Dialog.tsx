import { createSignal, For, onCleanup, Show } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core';
import type { DialogRow, DialogSpan, DialogTone, DialogView } from '../commands/types.js';
import { theme } from './theme.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const LABEL_WIDTH = 22;
const BAR = 16;

/** The tones of a result are the theme's, so the panel is of the window it is in. */
export const toneColor = (tone: DialogTone | undefined): string =>
  tone === 'ok'
    ? theme.success
    : tone === 'warn'
      ? theme.warn
      : tone === 'err'
        ? theme.error
        : tone === 'info'
          ? theme.info
          : tone === 'dim'
            ? theme.faint
            : tone === 'brand'
              ? theme.brand
              : theme.fg;

/** Names laid out in lines of at most `width` characters. */
export function wrapNames(names: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const n of names) {
    if (line && line.length + 2 + n.length > width) {
      lines.push(line);
      line = n;
    } else line = line ? `${line}  ${n}` : n;
  }
  if (line) lines.push(line);
  return lines;
}

export const barOf = (ratio: number, width = BAR): string => {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

function Spans(props: { spans: DialogSpan[] }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <For each={props.spans}>
        {(s) => (
          <text fg={toneColor(s.tone)} attributes={s.bold ? TextAttributes.BOLD : 0}>
            {s.text}
          </text>
        )}
      </For>
      <Show when={props.spans.length === 0}>
        <text>{' '}</text>
      </Show>
    </box>
  );
}

function Row(props: { row: DialogRow; bodyWidth: number; ruleWidth: number }) {
  const row = () => props.row;
  return (
    <Show
      when={!row().heading}
      fallback={
        <box flexDirection="row" flexShrink={0} marginTop={1}>
          <text fg={theme.brand}>{`── ${row().label} `}</text>
          <text fg={theme.border}>{'─'.repeat(Math.max(2, props.ruleWidth - row().label.length - 4))}</text>
        </box>
      }
    >
      <box flexDirection="row" flexShrink={0}>
        <text fg={theme.muted} flexShrink={0}>
          {`  ${(row().items && row().items!.length > 0 ? `${row().label} (${row().items!.length})` : row().label).padEnd(LABEL_WIDTH)}`}
        </text>
        <Show
          when={row().items}
          fallback={
            <box flexDirection="row">
              <text fg={toneColor(row().tone)} attributes={TextAttributes.BOLD}>
                {row().value ?? ''}
              </text>
              <Show when={row().ratio !== undefined}>
                <text fg={theme.brand}>{`  ${barOf(row().ratio ?? 0)}`}</text>
              </Show>
            </box>
          }
        >
          <Show when={(row().items ?? []).length > 0} fallback={<text fg={theme.faint}>{'none'}</text>}>
            <box flexDirection="column">
              <For each={wrapNames(row().items!, props.bodyWidth).slice(0, 8)}>{(line) => <text fg={toneColor(row().tone)}>{line}</text>}</For>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  );
}

/**
 * A result in a panel over the conversation, made to look like a terminal window and drawn with the colours of the theme: the
 * command that ran after a prompt, each step it took (with its time), what it found, and the status it leaves. Text that is long
 * (a feature model) scrolls: ↑ ↓ PgUp PgDn, or the wheel. Esc or Enter (or a click on ✕) closes it.
 */
export function Dialog(props: { view: DialogView; onClose: () => void }) {
  const size = useTerminalDimensions();
  const width = () => Math.max(44, Math.min(96, size().width - 6));
  const left = () => Math.max(1, Math.floor((size().width - width()) / 2));
  const inner = () => width() - 4;
  const hasText = () => (props.view.lines?.length ?? 0) > 0;
  // the text takes what is left of the window; the rest of the panel is as tall as what it says
  const textHeight = () => Math.max(5, size().height - 12 - (props.view.rows.length > 0 ? props.view.rows.length : 0));

  const [frame, setFrame] = createSignal(0);
  const [seconds, setSeconds] = createSignal(0);
  const started = Date.now();
  const t = setInterval(() => {
    setFrame((n) => (n + 1) % SPINNER.length);
    setSeconds(Math.floor((Date.now() - started) / 1000));
  }, 100);
  onCleanup(() => clearInterval(t));

  let text: ScrollBoxRenderable | undefined;
  let closed = false;
  onCleanup(() => {
    closed = true;
  });
  useKeyboard((e: KeyEvent) => {
    if (!text || closed) return;
    const page = Math.max(1, textHeight() - 1);
    if (e.name === 'up') text.scrollBy(-1);
    else if (e.name === 'down') text.scrollBy(1);
    else if (e.name === 'pageup') text.scrollBy(-page);
    else if (e.name === 'pagedown') text.scrollBy(page);
    else if (e.name === 'home') text.scrollTo(0);
    else if (e.name === 'end') text.scrollTo(1_000_000);
  });

  const stepGlyph = (state: 'running' | 'done' | 'fail'): { glyph: string; color: string } =>
    state === 'done'
      ? { glyph: '✓', color: theme.success }
      : state === 'fail'
        ? { glyph: '✗', color: theme.error }
        : { glyph: SPINNER[frame()] ?? '·', color: theme.brand };

  return (
    <box
      position="absolute"
      left={left()}
      top={1}
      width={width()}
      zIndex={20}
      flexDirection="column"
      backgroundColor={theme.quoteBg}
      border
      borderStyle="rounded"
      borderColor={theme.brand}
    >
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <box flexDirection="row">
          <text fg={theme.error}>{'● '}</text>
          <text fg={theme.warn}>{'● '}</text>
          <text fg={theme.success}>{'●  '}</text>
          <text fg={theme.muted}>{props.view.title}</text>
        </box>
        <text fg={theme.faint} onMouseDown={() => props.onClose()}>
          {'✕'}
        </text>
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={0}>
        <box flexDirection="row" flexShrink={0}>
          <text fg={theme.brand}>{'❯ '}</text>
          <text fg={theme.fg}>{`linea ${props.view.command}`}</text>
        </box>

        <Show when={(props.view.steps?.length ?? 0) > 0}>
          <box flexDirection="column" flexShrink={0} marginTop={1}>
            <For each={props.view.steps}>
              {(s) => (
                <box flexDirection="row" flexShrink={0}>
                  <text fg={stepGlyph(s.state).color}>{`  ${stepGlyph(s.state).glyph} `}</text>
                  <text fg={s.state === 'fail' ? theme.error : theme.muted}>{s.text}</text>
                  <Show when={s.detail}>
                    <text fg={theme.faint}>{`  ${s.detail}`}</text>
                  </Show>
                  <Show when={s.state === 'running' && seconds() >= 2}>
                    <text fg={theme.faint}>{`  ${seconds()}s`}</text>
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>

        <Show when={props.view.running && (props.view.steps?.length ?? 0) === 0}>
          <box flexDirection="row" marginTop={1}>
            <text fg={theme.brand}>{`  ${SPINNER[frame()]} `}</text>
            <text fg={theme.muted}>{props.view.running}</text>
            <text fg={theme.faint}>{seconds() >= 2 ? `  ${seconds()}s` : ''}</text>
          </box>
        </Show>

        <Show when={props.view.rows.length > 0}>
          <box flexDirection="column" flexShrink={0} marginTop={props.view.rows[0]?.heading ? 0 : 1}>
            <For each={props.view.rows}>{(row) => <Row row={row} bodyWidth={inner() - LABEL_WIDTH - 2} ruleWidth={inner()} />}</For>
          </box>
        </Show>

        <Show when={hasText()}>
          <box flexDirection="column" flexShrink={0} marginTop={1} border={['top']} borderStyle="single" borderColor={theme.border}>
            <scrollbox ref={(el: ScrollBoxRenderable) => (text = el)} height={textHeight()} verticalScrollbarOptions={{ visible: false }}>
              <For each={props.view.lines}>{(line) => <Spans spans={line} />}</For>
            </scrollbox>
          </box>
        </Show>

        <Show when={props.view.note}>
          <text fg={theme.faint}>{props.view.note}</text>
        </Show>

        <Show when={props.view.footer}>
          <box flexDirection="row" flexShrink={0} marginTop={1}>
            <text fg={toneColor(props.view.footer?.tone)}>{`${props.view.footer?.tone === 'err' ? '✗' : props.view.footer?.tone === 'dim' ? '·' : props.view.footer?.tone === 'warn' ? '!' : '✓'} `}</text>
            <text fg={toneColor(props.view.footer?.tone)}>{props.view.footer?.text ?? ''}</text>
          </box>
        </Show>
        <box flexShrink={0} marginTop={1}>
          <text fg={theme.faint}>
            {hasText()
              ? 'Esc close · ↑↓ PgUp PgDn scroll'
              : (props.view.steps ?? []).some((s) => s.state === 'running')
                ? 'Esc gives it up · the window stays usable'
                : 'Esc or Enter to close · the result is also in the history'}
          </text>
        </box>
      </box>
    </box>
  );
}
