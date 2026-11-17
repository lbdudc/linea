#!/usr/bin/env bun
import pkg from '../package.json';

const args = process.argv.slice(2);

const HELP = [
  `linea ${pkg.version} — the SPLALM command line`,
  '',
  'Usage:',
  '  linea                       the interactive window',
  '  linea <command> [args]      run one command and exit (scripts, CI)',
  '',
  'A command is `<noun> <verb>`, or a verb on its own:',
  '  linea get my-spl            bring an SPL and its products from LINEA (again: update them)',
  '  linea open                  open what you are in with your editor',
  '  linea check                 check the SPL / product / package of this folder',
  '  linea push                  send your changes back as a merge/pull request',
  '  linea spl list | product list | module list | fm show …',
  '  linea help                  every command',
  '',
  'Flags for any command:  --json (data for a program)  --local (do not talk to the server)',
  'Exit code: 0 ok · 1 failed, or a check found problems · 2 used wrong',
  '',
  'Env:',
  '  LINEA_BASE_URL   backend URL (default http://localhost:3000)',
  '  LINEA_TOKEN      dev-only JWT override (skips login)',
  '  LINEA_OAUTH_PORT loopback port login listens on (default 53682)',
  '',
].join('\n');

if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  process.stdout.write(`linea ${pkg.version}\n`);
  process.exit(0);
}

if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args[0] === 'credential') {
  // git asks for the token of the host (see core/credentialHelper.ts): no window, no sign-in, nothing else on stdout
  const { credentialHelper, traceHelper } = await import('./core/credentialHelper.js');
  const request = await Bun.stdin.text();
  const answer = credentialHelper(args[1], request);
  traceHelper(args[1], request, answer); // with LINEA_DEBUG=1: a line in ~/.linea/credential.log, to tell whether git asked at all
  process.stdout.write(answer);
  process.exit(0);
}

if (args.length > 0) {
  // one command, no window
  const { runShell } = await import('./shell.js');
  process.exit(await runShell(args));
}

const { runInteractive } = await import('./interactive.js');
await runInteractive();
