/**
 * A fixed-size download, for the pre-call bandwidth check.
 *
 * `navigator.connection.downlink` is the browser's estimate and Safari does not
 * have it at all, so the check times a real transfer from our own origin
 * instead. `bytes=0` makes it a latency ping.
 */

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('bytes') ?? '0');
  const bytes = Number.isFinite(requested) ? Math.max(0, Math.min(requested, MAX_BYTES)) : 0;

  // Random rather than zeroes, so nothing along the path can compress it away
  // and report a speed the student does not really have. `getRandomValues`
  // caps at 64 KB per call, hence the chunking.
  const payload = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += 65_536) {
    crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, bytes)));
  }

  return new Response(payload, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
      'cache-control': 'no-store, no-transform',
    },
  });
}
