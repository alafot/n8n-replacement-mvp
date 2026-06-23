// Remove Duplicates — sample: seed ids [1,2,2,3,1] -> Remove Duplicates(by key json.id)
// -> sink. Confirm only distinct ids [1,2,3] continue, first occurrence kept in order.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const dedup = await b.addNode('removeDuplicates');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [1,2,2,3,1].map(id => ({ json: { id } }));');
  await b.cfg(dedup);
  await b.select('cfg-dedup-by', 'field');
  await b.fill('cfg-dedup-field', 'json.id');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', dedup);
  await b.connect(dedup, 'main', sink);
  console.log('built: seed(ids 1,2,2,3,1) -> removeDuplicates(by json.id) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[dedup].status, 'completed', 'remove duplicates completed');
  const out = s.steps[dedup].output.map((i) => i.json.id);
  console.log('deduped output:', JSON.stringify(out));
  assert.deepEqual(out, [1, 2, 3], 'duplicates removed, first occurrence kept in original order');
  assert.equal(s.steps[sink].input.length, 3, 'downstream received only the 3 distinct items');

  await b.cfg(dedup);
  await b.shotTo(path.join(DIR, 'remove-duplicates-success.png'));
  console.log('Remove Duplicates OK: [1,2,2,3,1] -> [1,2,3].');
} catch (e) {
  console.error('Remove Duplicates demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
