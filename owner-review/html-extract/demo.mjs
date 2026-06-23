// HTML Extract — sample: seed an item holding HTML -> HTML Extract (h1->title text,
// a->link href attribute) -> sink. Confirm extracted fields are correct for known input.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
const { page } = b;
try {
  const seed = await b.addNode('code');
  const ex = await b.addNode('htmlExtract');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', `return [{ json: { html: '<h1>Hello</h1><a href="/x">link</a>' } }];`);
  await b.cfg(ex);
  await b.fill('cfg-html-source', 'json.html');
  // rule 0 (default present): h1 -> text -> title
  await b.fill('cfg-rule-0-selector', 'h1');
  await b.select('cfg-rule-0-type', 'text');
  await b.fill('cfg-rule-0-output', 'title');
  // add rule 1: a -> attribute href -> link
  await page.locator('[data-testid="extract-add-rule"]').click();
  await b.fill('cfg-rule-1-selector', 'a');
  await b.select('cfg-rule-1-type', 'attribute'); // re-renders, reveals attr field
  await b.fill('cfg-rule-1-attr', 'href');
  await b.fill('cfg-rule-1-output', 'link');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', ex);
  await b.connect(ex, 'main', sink);
  console.log('built: seed(html) -> htmlExtract(h1->title, a@href->link) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[ex].status, 'completed', 'html extract completed');
  const out = s.steps[ex].output[0].json;
  console.log('extracted:', JSON.stringify(out));
  assert.equal(out.title, 'Hello', "h1 text extracted to 'title'");
  assert.equal(out.link, '/x', "a@href extracted to 'link'");
  assert.equal(out.html, '<h1>Hello</h1><a href="/x">link</a>', 'source field preserved');

  await b.cfg(ex);
  await b.shotTo(path.join(DIR, 'html-extract-success.png'));
  console.log('HTML Extract OK: title="Hello", link="/x".');
} catch (e) {
  console.error('HTML Extract demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
