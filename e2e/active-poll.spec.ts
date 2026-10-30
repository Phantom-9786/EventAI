import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('background polling stops for idle/hidden tabs and resumes on user activity', async ({ page }) => {
  await page.clock.install();
  await page.setContent('<button>Resume</button>');
  const source = readFileSync('apps/web/src/lib/active-poll.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  await page.addScriptTag({ content: `(() => { const exports = {}; ${compiled}
    window.pollCount = 0;
    window.stopPoll = exports.pollWhileActive(() => window.pollCount++, 15000);
  })();` });
  const count = () => page.evaluate(() => (window as any).pollCount as number);
  await page.clock.runFor(60_000);
  expect(await count()).toBe(4);
  await page.clock.runFor(60_000);
  const beforeIdle = await count();
  await page.clock.runFor(10 * 60_000);
  expect(await count()).toBe(beforeIdle);
  await page.getByRole('button').click();
  expect(await count()).toBe(beforeIdle + 1);
  await page.clock.runFor(15_000);
  expect(await count()).toBe(beforeIdle + 2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeHidden = await count();
  await page.clock.runFor(5 * 60_000);
  expect(await count()).toBe(beforeHidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await count()).toBe(beforeHidden + 1);
  await page.evaluate(() => (window as any).stopPoll());
  await page.clock.runFor(60_000);
  await page.getByRole('button').click();
  expect(await count()).toBe(beforeHidden + 1);
});
