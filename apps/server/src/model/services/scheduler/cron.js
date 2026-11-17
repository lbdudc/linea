// Five-field cron (minute hour day-of-month month day-of-week), enough for a schedule: `*`, lists, ranges and steps.
// Times are the server's local time. When both day fields are restricted a day matches if EITHER does (as cron does).

export const PRESETS = {
  '1h': '0 * * * *',
  '3h': '0 */3 * * *',
  '6h': '0 */6 * * *',
  '12h': '0 */12 * * *',
  '24h': '0 3 * * *',
  weekly: '0 3 * * 1',
};

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

const parseField = (text, { name, min, max }) => {
  const values = new Set();
  for (const part of text.split(',')) {
    const [range, stepText, extra] = part.split('/');
    if (extra !== undefined || part === '') throw new Error(`${name}: "${part}" is not valid`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`${name}: the step of "${part}" is not valid`);
    let from;
    let to;
    if (range === '*') {
      from = min;
      to = name === 'day of week' ? 6 : max;
    } else {
      const [a, b, more] = range.split('-');
      if (more !== undefined) throw new Error(`${name}: "${part}" is not valid`);
      from = Number(a);
      to = b === undefined ? (stepText === undefined ? from : max) : Number(b);
      if (![from, to].every(Number.isInteger) || from < min || to > max || from > to) throw new Error(`${name}: "${part}" is out of range ${min}-${max}`);
    }
    for (let v = from; v <= to; v += step) values.add(name === 'day of week' && v === 7 ? 0 : v);
  }
  return values;
};

/** Parses an expression into sets of values; throws an Error whose message says what is wrong. */
export const parseCron = (expression) => {
  const parts = String(expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A schedule has five fields: minute hour day month weekday');
  const [minute, hour, dom, month, dow] = parts.map((part, i) => parseField(part, FIELDS[i]));
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
};

/** `null` when the expression is valid, the problem otherwise. */
export const cronProblem = (expression) => {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    return error.message;
  }
};

/** The cron expression of a schedule `{ preset, cron }`: the preset's, or the written one when the preset is `cron`. */
export const expressionOf = ({ preset, cron } = {}) => (preset === 'cron' ? cron : PRESETS[preset]);

const dayMatches = (parsed, date) => {
  const domOk = parsed.dom.has(date.getDate());
  const dowOk = parsed.dow.has(date.getDay());
  if (parsed.domAny && parsed.dowAny) return true;
  if (parsed.domAny) return dowOk;
  if (parsed.dowAny) return domOk;
  return domOk || dowOk;
};

/** The first minute after `from` that matches, or `null` if none in the next 5 years (e.g. 31 February). */
export const nextRun = (expression, from = new Date()) => {
  const parsed = parseCron(expression);
  const date = new Date(from.getTime());
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 24 * 3600_000;
  while (date.getTime() <= limit) {
    if (!parsed.month.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
    } else if (!dayMatches(parsed, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    } else if (!parsed.hour.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!parsed.minute.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
    } else {
      return date;
    }
  }
  return null;
};
