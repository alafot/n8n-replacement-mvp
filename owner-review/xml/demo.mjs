// XML — sample: seed an item holding an XML string -> XML (XML→JSON parse) -> sink.
// Confirm the parsed structure carries the known values (id 7, item 'book').
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const xml = await b.addNode('xml');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', `return [{ json: { xml: '<order id="7"><item>book</item></order>' } }];`);
  await b.cfg(xml);
  await b.fill('cfg-xml-source', 'json.xml');
  await b.select('cfg-xml-direction', 'xmlToJson');
  await b.fill('cfg-xml-output', 'parsed');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', xml);
  await b.connect(xml, 'main', sink);
  console.log('built: seed(xml) -> xml(XML→JSON -> parsed) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[xml].status, 'completed', 'xml completed');
  const out = s.steps[xml].output[0].json;
  const parsedStr = JSON.stringify(out.parsed);
  console.log('parsed structure:', parsedStr);
  assert.ok(out.parsed && typeof out.parsed === 'object', 'parsed XML produced a structured JSON object');
  assert.ok(parsedStr.includes('7'), 'order id 7 present in parsed structure');
  assert.ok(parsedStr.includes('book'), "item text 'book' present in parsed structure");

  await b.cfg(xml);
  await b.shotTo(path.join(DIR, 'xml-success.png'));
  console.log('XML OK: parsed to structured JSON carrying id 7 and item "book".');
} catch (e) {
  console.error('XML demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
