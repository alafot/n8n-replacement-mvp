// Form trigger — sample: Form(path 'signup', fields name,qty) -> sink. Save, open the served
// form, fill name='Ada' qty='3', submit, and confirm a real run fired carrying those values.
import { openBuilder, URL as CANVAS_URL } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const NAME = 'Signup form (review demo)';
const FORMPATH = 'signup';
const b = await openBuilder();
const { page } = b;
try {
  const trig = await b.addNode('formTrigger');
  const sink = await b.addNode('code');
  await b.cfg(trig);
  await b.fill('cfg-form-path', FORMPATH);
  await b.fill('cfg-form-fields', 'name,qty');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');
  await b.connect(trig, 'main', sink);

  await page.locator('#automation-name').fill(NAME);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));
  console.log('saved automation:', NAME, '| form at /form/' + FORMPATH);

  // Open the actual served form, fill it, submit it.
  await page.goto(CANVAS_URL + 'form/' + FORMPATH, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="form-field-name"]').fill('Ada');
  await page.locator('[data-testid="form-field-qty"]').fill('3');
  await page.locator('[data-testid="form-submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="form-result"]').dataset.runId);
  const runId = await page.locator('[data-testid="form-result"]').getAttribute('data-run-id');
  console.log('form submitted -> run', runId);
  assert.ok(runId, 'submitting the form started a run');
  await b.shotTo(path.join(DIR, 'form-trigger-success.png')); // form page showing "Submitted — run ..."

  // Confirm the downstream step received exactly the entered values.
  const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  const downstream = JSON.stringify(s.steps[sink].input);
  console.log('downstream received:', downstream);
  assert.ok(downstream.includes('Ada') && downstream.includes('3'), 'downstream got the submitted values {name:Ada, qty:3}');
  console.log('Form trigger OK: real submission of {name:Ada, qty:3} fired run ' + runId + ' carrying those values.');
} catch (e) {
  console.error('Form trigger demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
