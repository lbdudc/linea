import vm from 'node:vm';

const QUIET = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

export const runTransformation = ({ code, spec, timeoutMs = 5000 }) => {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, console: QUIET, __input: JSON.parse(JSON.stringify(spec ?? {})) });
  vm.runInContext(code, context, { timeout: timeoutMs, filename: 'transformation.js' });
  if (typeof context.module.exports !== 'function') throw new Error('it does not export a function');
  vm.runInContext('__output = JSON.stringify(module.exports(__input))', context, { timeout: timeoutMs, filename: 'transformation.js' });
  const output = JSON.parse(context.__output ?? 'null');
  return output && typeof output === 'object' && output.data && typeof output.data === 'object' ? output.data : {};
};
