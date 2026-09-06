/**
 * One-click unsubscribe, the machine-readable half (RFC 8058, SPEC.md §11).
 *
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` tells a mail client it
 * may POST to the URL in `List-Unsubscribe` when somebody presses the
 * unsubscribe button the client draws itself. That button is the reason a
 * person does not press "report spam" instead, which is the outcome that
 * actually damages a sending domain.
 *
 * A page cannot answer POST, so the header points here and the footer link in
 * the message points at `/unsubscribe/<token>`, which is the same action with
 * something to read afterwards.
 */

import { NextResponse } from 'next/server';

import { unsubscribe } from '@/db/email';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);

  // A bad token is still a 200. The client is a mail app, not a person, and
  // telling it the token was invalid gains nobody anything — while a 4xx makes
  // some clients retry, then show the user an error they cannot act on.
  if (verified) await unsubscribe(verified.userId, verified.target);

  return new NextResponse(null, { status: 200 });
}

/** Some clients probe with GET first. Send them to the page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/unsubscribe/${token}`, request.url));
}
