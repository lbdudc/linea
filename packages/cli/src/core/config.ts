/** What the environment says, read when asked (not once at start-up), so a test or a script can change it. */
export const config = {
  get DEFAULT_BASE_URL(): string {
    return process.env['LINEA_BASE_URL'] ?? 'http://localhost:3000';
  },
  get BASE_URL_FROM_ENV(): boolean {
    return Boolean(process.env['LINEA_BASE_URL']);
  },
  /** a development JWT that replaces `login` */
  get DEV_TOKEN(): string {
    return process.env['LINEA_TOKEN'] ?? '';
  },
  /** `server` or `offline`: overrides the mode that was kept, for one run */
  get MODE(): string {
    return process.env['LINEA_MODE'] ?? '';
  },
  get LOOPBACK_PORT(): number {
    return Number(process.env['LINEA_OAUTH_PORT'] ?? 53682);
  },
};
