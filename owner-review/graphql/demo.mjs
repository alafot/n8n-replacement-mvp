// GraphQL — sample: GraphQL step queries the local test endpoint for user(id:7){id name}
// -> sink. Confirm the response data carries the expected user (id 7 -> Ada).
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const gql = await b.addNode('graphql');
  const sink = await b.addNode('code');

  await b.cfg(gql);
  await b.fill('cfg-graphql-endpoint', 'http://127.0.0.1:3000/test/graphql');
  await b.fill('cfg-graphql-query', 'query GetUser($id: ID!) { user(id: $id) { id name } }');
  await b.fill('cfg-graphql-variables', '{"id":"7"}');
  await b.fill('cfg-graphql-output', 'data');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(gql, 'main', sink);
  console.log('built: graphql(user id:7 {id name}) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[gql].status, 'completed', 'graphql completed');
  const out = s.steps[gql].output[0].json;
  const blob = JSON.stringify(out);
  console.log('graphql response on item:', blob);
  assert.ok(blob.includes('Ada'), 'response carries the queried user name (Ada)');
  assert.ok(/"id"\s*:\s*"?7"?/.test(blob), 'response carries the queried user id (7)');

  await b.cfg(gql);
  await b.shotTo(path.join(DIR, 'graphql-success.png'));
  console.log('GraphQL OK: user(id:7) -> Ada (real query round-trip).');
} catch (e) {
  console.error('GraphQL demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
