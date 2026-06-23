// Markdown — sample: seed an item holding Markdown -> Markdown (MD→HTML) -> sink.
// Confirm the HTML output contains <h1>Hello</h1> and <strong>bold</strong>.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const md = await b.addNode('markdown');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', `return [{ json: { md: '# Hello\\n\\nsome **bold** text' } }];`);
  await b.cfg(md);
  await b.fill('cfg-md-source', 'json.md');
  await b.select('cfg-md-direction', 'markdownToHtml');
  await b.fill('cfg-md-output', 'html');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', md);
  await b.connect(md, 'main', sink);
  console.log('built: seed(markdown) -> markdown(MD→HTML -> html) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[md].status, 'completed', 'markdown completed');
  const html = s.steps[md].output[0].json.html;
  console.log('html output:', JSON.stringify(html));
  assert.ok(/<h1[^>]*>Hello<\/h1>/.test(html), 'heading converted to <h1>Hello</h1>');
  assert.ok(/<strong>bold<\/strong>/.test(html), 'emphasis converted to <strong>bold</strong>');

  await b.cfg(md);
  await b.shotTo(path.join(DIR, 'markdown-success.png'));
  console.log('Markdown OK: # Hello -> <h1>, **bold** -> <strong>.');
} catch (e) {
  console.error('Markdown demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
