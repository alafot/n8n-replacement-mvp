// The run's STANDARD item format — defined ONCE here and reused by every step,
// the workflow result, and the API. Modelled on n8n's items array: each item
// carries structured `json` data and an optional `binary` map.
//
// A step's output is always `Items` (an array of `Item`). This is the single
// shared data shape that flows between steps and out as the run result.

export interface BinaryDatum {
  /** Base64-encoded bytes. */
  data: string;
  mimeType: string;
  /** Original byte length before base64 encoding. */
  byteLength: number;
}

export interface Item {
  json: Record<string, unknown>;
  binary: Record<string, BinaryDatum>;
}

/** A step always emits an array of items — the standard inter-step payload. */
export type Items = Item[];

/** Convenience constructor keeping the shape consistent across callers. */
export function makeItem(
  json: Record<string, unknown>,
  binary: Record<string, BinaryDatum> = {},
): Item {
  return { json, binary };
}
