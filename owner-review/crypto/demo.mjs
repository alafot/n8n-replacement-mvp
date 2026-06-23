// Crypto — sample: seed {value:'hello'} -> Crypto (hash SHA256) -> sink.
// Confirm the output equals the well-known SHA256('hello') digest exactly.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPECTED = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const crypto = await b.addNode('crypto');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', "return [{ json: { value: 'hello' } }];");
  await b.cfg(crypto);
  await b.select('cfg-crypto-action', 'hash');
  await b.select('cfg-crypto-algorithm', 'sha256');
  await b.fill('cfg-crypto-source', 'json.value');
  await b.fill('cfg-crypto-output', 'hash');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', crypto);
  await b.connect(crypto, 'main', sink);
  console.log("built: seed({value:'hello'}) -> crypto(SHA256 -> hash) -> sink");

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[crypto].status, 'completed', 'crypto completed');
  const hash = s.steps[crypto].output[0].json.hash;
  console.log('SHA256(hello) =', hash);
  assert.equal(hash, EXPECTED, 'SHA256(hello) matches the known test vector');

  await b.cfg(crypto);
  await b.shotTo(path.join(DIR, 'crypto-success.png'));
  console.log('Crypto OK: SHA256("hello") == known digest.');
} catch (e) {
  console.error('Crypto demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
