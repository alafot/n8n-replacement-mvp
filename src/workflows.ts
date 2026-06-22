// Workflow definitions registered with the worker.
//
// Iteration 0 walking skeleton (B3): a durable workflow that runs a single
// HTTP-request step and returns its output as the run's result, in the
// standard item format.

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { HttpRequestInput } from './activities';
import type { Items } from './itemFormat';

const { httpRequest } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    // Fail reasonably fast on a genuine error (e.g. unreachable host) so a
    // failed run becomes observable promptly. Non-2xx responses do NOT throw
    // (see activities.httpRequest), so they don't trigger retries.
    maximumAttempts: 2,
    initialInterval: '1 second',
  },
});

/**
 * Manual start -> single HTTP-request step -> result.
 * The workflow's return value IS the HTTP step's output (standard item format),
 * making the run's result faithfully equal to what the step produced.
 */
export async function runHttpRequest(input: HttpRequestInput): Promise<Items> {
  const items = await httpRequest(input);
  return items;
}
