// Workflow definitions registered with the worker.
//
// Iteration 0 (B1) only requires the worker to connect and poll the 'engine'
// task queue. We register a single trivial workflow so the worker has a valid
// workflow bundle to load; real engine workflows arrive in later iterations.

export async function noop(): Promise<string> {
  return 'noop';
}
