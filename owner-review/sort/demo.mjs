// Sort — sample: seed [3,1,2,1] -> Sort(json.value, ascending) -> sink.
// Confirm items emerge [1,1,2,3], same set + count preserved (duplicate kept).
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const sort = await b.addNode('sort');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [{json:{value:3}},{json:{value:1}},{json:{value:2}},{json:{value:1}}];');
  await b.cfg(sort);
  await b.fill('cfg-sort-field', 'json.value');
  await b.select('cfg-sort-direction', 'asc');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', sort);
  await b.connect(sort, 'main', sink);
  console.log('built: seed([3,1,2,1]) -> sort(json.value asc) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[sort].status, 'completed', 'sort completed');
  const out = s.steps[sort].output.map((i) => i.json.value);
  console.log('sorted output:', JSON.stringify(out));
  assert.deepEqual(out, [1, 1, 2, 3], 'items reordered ascending, duplicate preserved, none dropped/added');
  assert.equal(s.steps[sink].input.length, 4, 'downstream received all 4 items in sorted order');

  await b.cfg(sort);
  await b.shotTo(path.join(DIR, 'sort-success.png'));
  console.log('Sort OK: [3,1,2,1] -> [1,1,2,3] ascending.');
} catch (e) {
  console.error('Sort demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
