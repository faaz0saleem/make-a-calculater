/**
 * Structured logs, and the thread that ties them together (SPEC.md §10).
 *
 * One JSON object per line on stdout, because that is what every hosted log
 * viewer can filter on and what `grep` can still read at 2am. No transport, no
 * buffering, no dependency: a logger that can fail is a logger that will fail
 * during the incident it exists for.
 *
 * The point of the whole file is `correlationId`. When somebody says "my
 * lesson never happened and I was charged", the answer has to be assembled from
 * a booking, a ledger entry, a LiveKit webhook, a settlement and an email —
 * five subsystems that otherwise share nothing. They all carry
 * `booking:<uuid>`, so one search returns the story in order.
 */

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown> & {
  severity?: LogSeverity;
  correlationId?: string | null;
};

/** `booking:<id>`, `payout:<id>`, `purchase:<id>` — the id somebody can search. */
export function correlationFor(
  kind: 'booking' | 'payout' | 'purchase' | 'series' | 'user' | 'homework',
  id: string,
): string {
  return `${kind}:${id}`;
}

const REDACTED = new Set([
  'password',
  'passwordHash',
  'token',
  'accountNumber',
  'iban',
  'apiKey',
  'secret',
  'html',
  'text',
]);

/**
 * Anything named like a secret never reaches the log, whatever the caller
 * passed. A log line is a thing that gets copied into a support ticket.
 */
function scrub(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'severity') continue;
    out[key] = REDACTED.has(key) ? '[redacted]' : value;
  }

  return out;
}

export function logEvent(event: string, fields: LogFields = {}): void {
  const severity = fields.severity ?? 'info';
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    severity,
    event,
    ...scrub(fields),
  });

  // Errors go to stderr so a platform that separates the two shows them as
  // errors without any configuration.
  if (severity === 'error') console.error(line);
  else console.log(line);
}

/**
 * Money moved. Deliberately its own function rather than a `logEvent` call with
 * a convention, so every movement is greppable as `event":"money.` and so the
 * fields cannot drift between call sites.
 */
export function logMoney(
  action: string,
  fields: LogFields & {
    correlationId: string;
    amountCents: number;
    account?: string;
    userId?: string | null;
  },
): void {
  logEvent(`money.${action}`, fields);
}

/** A row changed state. The `from`/`to` pair is what makes a timeline readable. */
export function logTransition(
  entity: 'booking' | 'payout' | 'series' | 'tutor_profile' | 'purchase' | 'report',
  fields: LogFields & {
    correlationId: string;
    from: string;
    to: string;
    actor?: string | null;
    reason?: string | null;
  },
): void {
  logEvent(`transition.${entity}`, fields);
}
