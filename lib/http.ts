import { NextResponse } from 'next/server';
import { HttpError } from './errors';

/**
 * The one error response every API route sends. Expected failures (HttpError)
 * keep their message — "Room not found", "Wrong password". Anything else is a
 * bug or an outage: it is logged here and the client gets a generic message,
 * because raw errors can carry database URLs, SQL or file paths.
 */
export function fail(error: unknown, extra: (status: number) => object = () => ({})) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, ...extra(error.status) },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json({ error: 'Something went wrong on the server' }, { status: 500 });
}

/**
 * Reads a JSON object body, refusing anything larger than `maxBytes` or not
 * an object. Without a cap one request could make the server parse megabytes.
 */
export async function readJson(
  request: Request,
  maxBytes = 32_000,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'Request too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'Invalid request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Invalid request');
  }
  return body as Record<string, unknown>;
}
