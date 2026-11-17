import { For, Show } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import type { Session } from '../commands/types.js';
import type { GuideState, Tip } from '../core/guide.js';
import { displayPath } from '../core/workdir.js';
import { theme } from './theme.js';

/** What the first lines say you are looking at: the thing you are in, or what this tool is for. */
function headline(state: GuideState): { title: string; detail: string } {
  if (state.product) {
    const c = state.product;
    return { title: c.name, detail: `product${state.line ? ` of ${state.line.name}` : ''}${c.branch ? ` · ${c.branch}` : ''}${c.changes ? ` · ${c.changes} change${c.changes === 1 ? '' : 's'}` : ''}` };
  }
  if (state.line) {
    const c = state.line;
    return {
      title: c.name,
      detail: `SPL${c.branch ? ` · ${c.branch}` : ''}${c.changes ? ` · ${c.changes} change${c.changes === 1 ? '' : 's'}` : ''}${c.linked ? '' : ' · only on this machine'}`,
    };
  }
  if (state.pkg) return { title: state.pkg.name, detail: state.pkg.kind };
  return { title: 'Software product lines', detail: 'build them, check them, ship them: here and on LINEA' };
}

const host = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function Welcome(props: { version: string; session: Session; state: GuideState; tips: Tip[] }) {
  const head = () => headline(props.state);
  const width = () => Math.min(34, Math.max(...props.tips.map((t) => t.command.length), 8) + 2);
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={theme.brand}
      paddingLeft={2}
      paddingRight={2}
      marginBottom={1}
    >
      <text fg={theme.brand} attributes={TextAttributes.BOLD}>{'✻ Welcome to LINEA'}</text>
      <text> </text>
      <box flexDirection="row">
        <text fg={theme.fg} attributes={TextAttributes.BOLD}>{head().title}</text>
        <text fg={theme.muted}>{`  ${head().detail}`}</text>
      </box>
      <text fg={theme.faint}>
        {props.state.signedIn
          ? `signed in${props.state.user ? ` as ${props.state.user}` : ''} · ${host(props.session.baseUrl)}`
          : 'not signed in · working on this machine'}
        {` · ${displayPath(props.state.folder)}`}
      </text>
      <text> </text>
      <text fg={theme.muted}>Try:</text>
      <For each={props.tips}>
        {(tip) => (
          <box flexDirection="row">
            <text fg={theme.brand}>{`  ${tip.command.padEnd(width())}`}</text>
            <text fg={theme.muted}>{tip.why}</text>
          </box>
        )}
      </For>
      <text> </text>
      <text fg={theme.faint}>{`help for everything · ? for shortcuts · Ctrl+C to quit`}</text>
      <Show when={props.version}>
        <text fg={theme.faint}>{`linea v${props.version}`}</text>
      </Show>
    </box>
  );
}
