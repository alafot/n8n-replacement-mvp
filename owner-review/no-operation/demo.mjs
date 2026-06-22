// No Operation — sample workflow: seed (deliberately duplicated + unsorted) -> No-Op -> sink.
// Confirm downstream items are byte-for-byte identical (same content, count, order; dup kept).
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const noop = await b.addNode('noop');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [{json:{id:3}},{json:{id:1}},{json:{id:1}},{json:{id:2}}];'); // unsorted + duplicate
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', noop);
  await b.connect(noop, 'main', sink);
  console.log('built: seed([3,1,1,2]) -> noop -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[noop].status, 'completed', 'no-op completed');
  const into = s.steps[noop].input, outOf = s.steps[noop].output;
  assert.deepEqual(outOf, into, 'no-op output identical to input (unchanged)');
  assert.deepEqual(s.steps[sink].input, into, 'downstream received the same items unchanged');
  console.log('pass-through ids downstream:', JSON.stringify(s.steps[sink].input.map((i) => i.json.id)));

  await b.cfg(noop);
  await b.shotTo(path.join(DIR, 'noop-success.png'));
  console.log('No-Op OK: items passed through identical (order + duplicate preserved), step completed.');
} catch (e) {
  console.error('No-Op demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
