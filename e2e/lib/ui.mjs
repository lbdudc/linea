import assert from 'node:assert/strict';

/** A browser context in English, with what the page keeps (the session) of its own. */
export const newContext = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('linea.locale', 'en'); } catch { /* storage off */ } });
  return context;
};

const NAV = '.app-nav__item';

/** The labels of the navigation bar. */
export const navLabels = async (page) => {
  await page.locator(NAV).first().waitFor();
  return (await page.locator(NAV).evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))).filter(Boolean);
};

export const signInLocal = async (page, base, username, password) => {
  await page.goto(`${base}/login`);
  await page.locator('input[name=username]').fill(username);
  await page.locator('#local-password').fill(password);
  await page.locator('button[name=local-submit]').click();
  await page.locator(NAV).first().waitFor({ timeout: 30_000 });
};

/** "Continue with <host>": the dev host lands straight back, signed in as its `dev`. */
export const signInWith = async (page, base, host) => {
  await page.goto(`${base}/login`);
  await page.locator(`button[name=${host}-submit]`).click();
  await page.locator(NAV).first().waitFor({ timeout: 30_000 });
};

export const signOut = async (page) => {
  await page.locator('.user-dropdown-btn').click();
  await page.getByText('Sign out', { exact: true }).click();
  await page.waitForURL(/\/login/);
};

export const token = (page) => page.evaluate(() => localStorage.getItem('token'));

/** A call to the API as the person of the page. Answers `{ status, body }`. */
export const apiAs = async (page, api, method, path, body) => {
  const jwt = await token(page);
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

export const lineNames = async (page, api) => {
  const { status, body } = await apiAs(page, api, 'GET', '/lines/enrolled');
  assert.equal(status, 200, JSON.stringify(body));
  return body.map((line) => line.name).sort();
};

/** The names of the lines the Lines page shows. */
export const shownLines = async (page, base) => {
  await page.goto(`${base}/lines`);
  await page.locator('.app-main').waitFor();
  await page.waitForLoadState('networkidle');
  return page;
};

export const check = (name, condition, detail = '') => assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`);
export { assert };
