// Schedule trigger — sample: Schedule(every 0.5s) -> sink. Save, Start the schedule, let it
// fire several real runs, Stop it, then confirm multiple runs landed in History. Screenshot History.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const NAME = 'Scheduled greeter (review demo)';
const b = await openBuilder();
const { page } = b;
try {
  const trig = await b.addNode('scheduleTrigger');
  const sink = await b.addNode('code');
  await b.cfg(trig);
  await b.fill('cfg-schedule-interval', '0.5');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return [{ json: { ranAt: "scheduled" } }];');
  await b.connect(trig, 'main', sink);

  // Save (schedule start needs a saved definition).
  await page.locator('#automation-name').fill(NAME);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));
  console.log('saved automation:', NAME);

  // Start the schedule.
  await b.cfg(trig);
  await page.locator('[data-testid="schedule-start"]').click();
  await page.waitForFunction(() => /schedule started/.test(document.querySelector('[data-testid="run-status"]').textContent || ''));
  console.log('schedule started:', (await page.locator('[data-testid="run-status"]').textContent()).trim());

  // Let it fire several times, then stop.
  await page.waitForTimeout(2800);
  await page.locator('[data-testid="schedule-stop"]').click();

  // Confirm multiple real runs landed in history for this automation.
  const runs = await page.evaluate((name) => fetch('/history').then((r) => r.json()).then((rows) => rows.filter((x) => x.automationName === name)), NAME);
  console.log('scheduled runs recorded in history:', runs.length, '| statuses:', JSON.stringify([...new Set(runs.map((r) => r.status))]));
  assert.ok(runs.length >= 2, 'the schedule fired multiple real runs (got ' + runs.length + ')');

  // Show the History panel (the fired runs) and screenshot.
  await page.locator('#btn-history').click();
  await page.waitForSelector('[data-testid="history-row"]');
  await b.shotTo(path.join(DIR, 'schedule-trigger-success.png'));
  console.log('Schedule trigger OK: schedule fired ' + runs.length + ' real runs (entry point, interval-governed).');
} catch (e) {
  console.error('Schedule trigger demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
