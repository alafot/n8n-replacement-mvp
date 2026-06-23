// Respond to Webhook — sample: Webhook(path 'respond-hook') -> code(double order) ->
// Respond to Webhook(status 201, first item's data). POST {order:21} and confirm the caller
// receives HTTP 201 with an automation-derived body {received:21, doubled:42, status:ok}.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const NAME = 'Webhook responder (review demo)';
const HOOK = 'respond-hook';
const b = await openBuilder();
const { page } = b;
try {
  const trig = await b.addNode('webhookTrigger');
  const xform = await b.addNode('code');
  const resp = await b.addNode('respondToWebhook');
  await b.cfg(trig);
  await b.fill('cfg-webhook-path', HOOK);
  await b.cfg(xform);
  await b.fill('cfg-code', "return $input.map(it => ({ json: { received: it.json.order, doubled: it.json.order * 2, status: 'ok' } }));");
  await b.cfg(resp);
  await b.fill('cfg-respond-status', '201');
  await b.select('cfg-respond-bodymode', 'firstItem');

  await b.connect(trig, 'main', xform);
  await b.connect(xform, 'main', resp);

  await page.locator('#automation-name').fill(NAME);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));
  console.log('saved automation:', NAME);

  // Real request -> expect the custom response back.
  const res = await page.evaluate(async (hook) => {
    const r = await fetch('/webhook/' + hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: 21 }) });
    return { status: r.status, body: await r.json() };
  }, HOOK);
  console.log('caller received: HTTP', res.status, JSON.stringify(res.body));
  assert.equal(res.status, 201, 'caller received the configured non-default status 201');
  assert.equal(res.body.received, 21, 'response body reflects the request data');
  assert.equal(res.body.doubled, 42, 'response body carries an automation-derived value (21*2=42)');

  await b.cfg(resp); // show the configured status/body mode
  await b.shotTo(path.join(DIR, 'respond-to-webhook-success.png'));
  console.log('Respond to Webhook OK: caller got HTTP 201 with automation-built body {received:21, doubled:42}.');
} catch (e) {
  console.error('Respond to Webhook demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
