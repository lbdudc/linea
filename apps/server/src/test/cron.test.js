import { describe, it, expect } from 'vitest';
import { cronProblem, expressionOf, nextRun, PRESETS } from '../model/services/scheduler/cron.js';

const at = (text) => new Date(text);
const iso = (date) => date && [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()].join('-');

describe('cron', () => {
  it('accepts every preset', () => {
    for (const expression of Object.values(PRESETS)) expect(cronProblem(expression)).toBeNull();
  });

  it('says what is wrong', () => {
    expect(cronProblem('* * * *')).toMatch(/five fields/);
    expect(cronProblem('61 * * * *')).toMatch(/minute.*out of range/);
    expect(cronProblem('*/0 * * * *')).toMatch(/step/);
    expect(cronProblem('a * * * *')).toMatch(/minute/);
    expect(cronProblem('5-2 * * * *')).toMatch(/out of range/);
  });

  it('finds the next time after now, never now itself', () => {
    expect(iso(nextRun('0 */6 * * *', at('2026-03-10T05:59:30')))).toBe('2026-3-10-6-0');
    expect(iso(nextRun('0 */6 * * *', at('2026-03-10T06:00:00')))).toBe('2026-3-10-12-0');
    expect(iso(nextRun('*/15 * * * *', at('2026-03-10T10:07:00')))).toBe('2026-3-10-10-15');
  });

  it('rolls over days, months and years', () => {
    expect(iso(nextRun('0 3 * * *', at('2026-03-10T04:00:00')))).toBe('2026-3-11-3-0');
    expect(iso(nextRun('30 23 31 * *', at('2026-04-01T00:00:00')))).toBe('2026-5-31-23-30');
    expect(iso(nextRun('0 0 1 1 *', at('2026-03-10T00:00:00')))).toBe('2027-1-1-0-0');
  });

  it('weekly: next Monday, and 7 is Sunday', () => {
    expect(iso(nextRun(PRESETS.weekly, at('2026-03-10T00:00:00')))).toBe('2026-3-16-3-0'); // 10 March 2026 is a Tuesday
    expect(iso(nextRun('0 0 * * 7', at('2026-03-10T00:00:00')))).toBe('2026-3-15-0-0');
  });

  it('weekdays range and day-of-month OR day-of-week', () => {
    expect(iso(nextRun('0 2 * * 1-5', at('2026-03-13T03:00:00')))).toBe('2026-3-16-2-0'); // Friday -> Monday
    expect(iso(nextRun('0 0 13 * 1', at('2026-03-10T00:00:00')))).toBe('2026-3-13-0-0'); // the 13th comes before Monday
  });

  it('gives up on a date that never happens', () => {
    expect(nextRun('0 0 31 2 *', at('2026-01-01T00:00:00'))).toBeNull();
  });

  it('expressionOf picks the preset or the written one', () => {
    expect(expressionOf({ preset: '6h', cron: 'x' })).toBe(PRESETS['6h']);
    expect(expressionOf({ preset: 'cron', cron: '5 4 * * *' })).toBe('5 4 * * *');
  });
});
