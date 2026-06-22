// Step implementations run as Temporal activities (real-world side effects live
// here, outside the deterministic workflow). Iteration 0 has one step: the
// caller-configurable HTTP Request step (B2).

import { Items, makeItem, BinaryDatum } from './itemFormat';

export interface HttpRequestInput {
  /** HTTP method; defaults to GET. */
  method?: string;
  /** Absolute target URL. */
  url: string;
  /** Optional request headers. */
  headers?: Record<string, string>;
  /** Optional request body (string). */
  body?: string;
}

/** Content types we represent as text (kept losslessly as a string in json.body). */
function isTextual(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript') ||
    contentType.includes('x-www-form-urlencoded')
  );
}

/**
 * HTTP Request step. Performs a REAL outbound request honouring the caller's
 * method/url/headers/body, then returns the response in the STANDARD item
 * format with the status surfaced so success vs failure is distinguishable.
 *
 * - A non-2xx response is NOT an error: it returns normally with ok=false and
 *   the statusCode, so callers can distinguish it from success (B2 E3).
 * - A network/connection error throws — surfacing as an activity/workflow
 *   failure rather than a fake "success".
 */
export async function httpRequest(input: HttpRequestInput): Promise<Items> {
  const method = (input.method ?? 'GET').toUpperCase();
  const res = await fetch(input.url, {
    method,
    headers: input.headers,
    body: input.body,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: unknown = null;
  const binary: Record<string, BinaryDatum> = {};

  if (contentType.includes('application/json')) {
    const text = await res.text();
    body = text.length ? JSON.parse(text) : null;
  } else if (isTextual(contentType) || contentType === '') {
    // text/HTML/etc. — kept losslessly as a string (B2 E4).
    body = await res.text();
  } else {
    // Truly binary payload — base64 into the binary slot without loss.
    const buf = Buffer.from(await res.arrayBuffer());
    binary.data = {
      data: buf.toString('base64'),
      mimeType: contentType,
      byteLength: buf.byteLength,
    };
    body = null;
  }

  // Status is surfaced inside the standard item so callers can tell success
  // (ok=true, 2xx) from failure (ok=false, non-2xx).
  return [
    makeItem(
      {
        statusCode: res.status,
        ok: res.ok,
        contentType,
        headers,
        body,
      },
      binary,
    ),
  ];
}
