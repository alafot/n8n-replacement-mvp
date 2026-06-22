// Driven-browser check for B24 — open a past run from history and inspect its
// per-step input/output/error.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="btn-history"]').click();
  await page.waitForSelector('[data-testid="history-row"]');

  // Open the FAILED run to inspect which step failed + the cause.
  const failedRow = page.locator('[data-testid="history-row"][data-status="failed"]').first();
  await failedRow.click();
  await page.waitForSelector('[data-testid="step-detail"]');
  const failedStep = page.locator('[data-testid="step-detail"][data-step-status="failed"]').first();
  const err = await failedStep.locator('[data-testid="step-error"]').textContent();
  log(`B24 (browser) opened a failed run; failing step shows error cause: "${err.trim()}"`);
  assert.ok(err && err.trim().length, 'failed step shows a real error cause');
  await page.screenshot({ path: path.join(SHOT_DIR, 'inspect-failed.png') });

  // Open a completed run to inspect per-step input + output.
  const okRow = page.locator('[data-testid="history-row"][data-status="completed"]').first();
  const okRunId = await okRow.getAttribute('data-run-id');
  await okRow.click();
  // Wait for the detail to re-render for THIS run (avoid the stale prior detail).
  await page.waitForFunction((id) => document.querySelector('[data-testid="run-detail"]')?.dataset.runId === id, okRunId);
  await page.waitForSelector('[data-testid="step-output-detail"]');
  const inputs = await page.locator('[data-testid="step-input"]').count();
  const outputs = await page.locator('[data-testid="step-output-detail"]').count();
  log(`B24 (browser) opened a completed run; per-step input blocks=${inputs}, output blocks=${outputs}`);
  assert.ok(inputs > 0 && outputs > 0, 'completed run shows per-step input and output');
  await page.screenshot({ path: path.join(SHOT_DIR, 'inspect-completed.png') });

  log('\nB24 BROWSER INSPECTION ASSERTIONS PASSED.');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
