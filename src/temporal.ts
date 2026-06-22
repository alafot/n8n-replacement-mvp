// Shared Temporal connection configuration, used by the worker, the API, and
// any client. Defined once so address/namespace/queue are consistent everywhere.

export const TASK_QUEUE = 'engine';
export const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
export const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
