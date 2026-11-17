import { Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import type { Session } from '../commands/types.js';
import type { GuideState } from '../core/guide.js';
import { displayPath } from '../core/workdir.js';
import { theme } from './theme.js';

/**
 * The line under the prompt. On the left what you can press, on the right where you are: the SPL or product, its branch, what is
 * waiting to be pushed or fetched, and whether you are signed in to LINEA.
 */
export function StatusBar(props: { session: Session; state: GuideState }) {
  const size = useTerminalDimensions();
  const here = () => props.state.product ?? props.state.line;
  const name = () => here()?.name ?? props.state.pkg?.name;
  return (
    <box flexDirection="row" flexShrink={0} justifyContent="space-between">
      <Show when={size().width >= 100} fallback={<text fg={theme.faint}>{'? shortcuts'}</text>}>
        <text fg={theme.faint}>{'? shortcuts · Ctrl+C quit'}</text>
      </Show>
      <box flexDirection="row" flexShrink={0}>
        <Show when={name()} fallback={<text fg={theme.faint}>{'not in an SPL'}</text>}>
          <text fg={theme.brand}>{name()}</text>
        </Show>
        <Show when={here()?.branch}>
          <text fg={theme.muted}>{` ⎇ ${here()!.branch}`}</text>
        </Show>
        <Show when={here() && here()!.changes > 0}>
          <text fg={theme.warn}>{` ●${here()!.changes}`}</text>
        </Show>
        <Show when={here() && here()!.ahead > 0}>
          <text fg={theme.success}>{` ↑${here()!.ahead}`}</text>
        </Show>
        <Show when={here() && here()!.behind > 0}>
          <text fg={theme.info}>{` ↓${here()!.behind}`}</text>
        </Show>
        <Show when={size().width >= 150}>
          <text fg={theme.faint}>{` · ${displayPath(props.state.folder)}`}</text>
        </Show>
        <text fg={theme.faint}>{' · '}</text>
        <Show when={props.session.authed} fallback={<text fg={theme.faint}>{'○ not signed in'}</text>}>
          <text fg={theme.success}>{'●'}</text>
          <text fg={theme.muted}>{` ${props.session.user?.username ?? 'signed in'}`}</text>
        </Show>
      </box>
    </box>
  );
}
