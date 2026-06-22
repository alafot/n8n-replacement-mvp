// Limit — sample: seed 5 items (n 1..5) -> Limit(max 2, keep first) -> sink.
// Confirm only 2 items continue (the first 2, in order).
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const limit = await b.addNode('limit');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [1,2,3,4,5].map(n => ({ json: { n } }));');
  await b.cfg(limit);
  await b.fill('cfg-limit-max', '2');
  await b.select('cfg-limit-keep', 'first');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', limit);
  await b.connect(limit, 'main', sink);
  console.log('built: seed(5 items) -> limit(max 2, keep first) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[limit].status, 'completed', 'limit completed');
  const out = s.steps[limit].output.map((i) => i.json.n);
  console.log('limit output:', JSON.stringify(out));
  assert.deepEqual(out, [1, 2], 'kept the first 2 of 5 items, in order');
  assert.equal(s.steps[sink].input.length, 2, 'downstream received only 2 items');

  await b.cfg(limit);
  await b.shotTo(path.join(DIR, 'limit-success.png'));
  console.log('Limit OK: 5 items capped to first 2.');
} catch (e) {
  console.error('Limit demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
