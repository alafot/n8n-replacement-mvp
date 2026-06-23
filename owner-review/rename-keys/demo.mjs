// Rename Keys — sample: seed {first:'Ada', qty:3, city:'London'} -> Rename Keys
// (first->name, qty->quantity) -> sink. Confirm renamed keys with same values, city untouched.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const ren = await b.addNode('renameKeys');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', "return [{ json: { first: 'Ada', qty: 3, city: 'London' } }];");
  await b.cfg(ren);
  await b.fill('cfg-renames', '{"first":"name","qty":"quantity"}');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', ren);
  await b.connect(ren, 'main', sink);
  console.log('built: seed({first,qty,city}) -> renameKeys(first->name, qty->quantity) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[ren].status, 'completed', 'rename keys completed');
  const out = s.steps[ren].output[0].json;
  console.log('renamed output:', JSON.stringify(out));
  assert.deepEqual(out, { name: 'Ada', quantity: 3, city: 'London' }, 'old keys gone, new keys present with same values, city untouched');

  await b.cfg(ren);
  await b.shotTo(path.join(DIR, 'rename-keys-success.png'));
  console.log('Rename Keys OK: {first,qty,city} -> {name,quantity,city}.');
} catch (e) {
  console.error('Rename Keys demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
