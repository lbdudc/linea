// The entry git runs as a credential helper when linea runs from its sources (`bun run start`): a plain .ts file, because bun
// compiles the JSX of `index.tsx` by the configuration of the folder git is in, which is not this project's, and fails there.
import { credentialHelper, traceHelper } from './core/credentialHelper.js';

const op = process.argv[3]; // credential <get|store|erase>
const request = await Bun.stdin.text();
const answer = credentialHelper(op, request);
traceHelper(op, request, answer);
process.stdout.write(answer);
process.exit(0);
