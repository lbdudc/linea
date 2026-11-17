/** How a success rate (0-100) reads on the dashboard: `ok` from 90, `bad` under 70, `warn` between, nothing without a rate. */
export const successTone = (rate) => (rate == null ? '' : rate >= 90 ? 'ok' : rate < 70 ? 'bad' : 'warn')
