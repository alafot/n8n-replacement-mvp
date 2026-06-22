// Driven-browser check for B23 — a user can see the run history listing with
// each run's automation, time, and correct outcome.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  // A user opens the history.
  await page.locator('[data-testid="btn-history"]').click();
  await page.waitForSelector('[data-testid="history-row"]');
  const rows = await page.locator('[data-testid="history-row"]').evaluateAll((els) =>
    els.map((e) => ({ automation: e.dataset.automation, status: e.dataset.status, when: e.querySelector('[data-testid="history-when"]').textContent })),
  );
  log(`B23 E1 user sees a history listing: ${rows.length} past runs`);
  for (const r of rows) log(`   - ${r.automation} | ${r.when} | ${r.status}`);

  assert.ok(rows.length >= 4, 'multiple runs listed');
  assert.ok(rows.every((r) => r.automation && r.automation.trim()), 'E2 every entry identifies its automation');
  assert.ok(rows.every((r) => r.when && r.when.trim()), 'E3 every entry shows when it ran');
  const statuses = new Set(rows.map((r) => r.status));
  assert.ok(statuses.has('failed') && statuses.has('completed'), 'E4/E5 failed and completed both shown as distinct outcomes');
  const failed = rows.find((r) => r.status === 'failed');
  log(`B23 E4 a genuine failure reads 'failed': "${failed.automation}" -> ${failed.status}`);
  log(`B23 E5 outcome vocabulary on screen: ${JSON.stringify([...statuses])}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'history.png') });

  log('\nALL B23 BROWSER ASSERTIONS PASSED.');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
