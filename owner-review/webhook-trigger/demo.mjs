// Webhook trigger — sample: Webhook(path 'review-hook') -> sink. Save, then POST a known
// payload to /webhook/review-hook and confirm a real run fired carrying that payload downstream.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const NAME = 'Webhook receiver (review demo)';
const HOOK = 'review-hook';
const PAYLOAD = { order: 123, kind: 'review' };
const b = await openBuilder();
const { page } = b;
try {
  const trig = await b.addNode('webhookTrigger');
  const sink = await b.addNode('code');
  await b.cfg(trig);
  await b.fill('cfg-webhook-path', HOOK);
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');
  await b.connect(trig, 'main', sink);

  await page.locator('#automation-name').fill(NAME);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));
  console.log('saved automation:', NAME, '| endpoint: /webhook/' + HOOK);

  // Send a real HTTP request to the exposed endpoint.
  const res = await page.evaluate(async ({ hook, payload }) => {
    const r = await fetch('/webhook/' + hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: r.status, body: await r.json() };
  }, { hook: HOOK, payload: PAYLOAD });
  console.log('POST /webhook/' + HOOK, '->', JSON.stringify(res));
  assert.ok(res.body.fired, 'the request fired a run');
  const runId = res.body.runId;
  assert.ok(runId, 'a run id was returned');

  // Confirm the downstream step received exactly the request payload.
  const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  const downstream = JSON.stringify(s.steps[sink].input);
  console.log('downstream received:', downstream);
  assert.ok(downstream.includes('123') && downstream.includes('review'), 'downstream got the request payload {order:123, kind:review}');

  // Wrong path returns 404 with no run.
  const miss = await page.evaluate(() => fetch('/webhook/nope', { method: 'POST' }).then((r) => r.status));
  assert.equal(miss, 404, 'an unregistered path returns 404');

  await b.cfg(trig); // show the configured path + live listening URL
  await b.shotTo(path.join(DIR, 'webhook-trigger-success.png'));
  console.log('Webhook trigger OK: real HTTP request to /webhook/' + HOOK + ' fired run ' + runId + ' carrying the payload.');
} catch (e) {
  console.error('Webhook trigger demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
