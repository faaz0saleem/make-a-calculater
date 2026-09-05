/**
 * Proof that a dump of `payout_methods` is worth nothing.
 *
 *   pnpm prove:payout-privacy
 *
 * The claim is not "the column is called `_enc`". It is that somebody holding a
 * database backup, a read replica, or the output of `select *` in a support
 * tool cannot move a single tutor's money. So this does the dump — every
 * column, every row, as text — and looks for anything usable in it.
 *
 * Three checks, because they fail in different ways:
 *
 *  1. A method is written with known plaintext, and none of that plaintext
 *     appears anywhere in the dump. This catches a column that was added and
 *     never encrypted, which is the realistic mistake.
 *  2. Every column is either on an explicit list of things we mean to be
 *     readable — the tutor id, the bank's name, the last four digits — or is
 *     ciphertext in our own envelope. The list is the point: a column added
 *     later and left in the clear is not on it, so the proof fails closed
 *     rather than quietly passing.
 *  3. The ciphertext is actually decryptable with the key, so the data is
 *     protected rather than lost.
 *
 * Everything it writes is rolled back.
 */

import './bootstrap';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { decryptForTransfer, savePayoutMethod } from '@/db/payouts';

class Rollback extends Error {}

/** The account details a real tutor would type. */
const PLAINTEXT = {
  accountNumber: 'PK36SCBL0000001123456702',
  swift: 'SCBLPKKX',
  branchCode: '0242',
  cnic: '4210112345671',
};

/**
 * The columns we mean anyone to be able to read.
 *
 * Deliberately enumerated rather than derived. Everything not named here has to
 * be ciphertext, so adding a column and forgetting to encrypt it fails this
 * proof instead of shipping.
 */
const ALLOWED_VISIBLE = new Set([
  'id',
  'tutor_id',
  'kind',
  'account_title',
  'bank_name',
  'wallet_provider',
  'country',
  'last4',
  'is_default',
  'created_at',
]);

/**
 * The readable columns a tutor actually typed into.
 *
 * Ids and timestamps are readable and structural; scanning them for digit runs
 * would only ever find a uuid or a date. These are the fields where a real
 * account number could end up by mistake — somebody putting their IBAN in the
 * "account title" box, for instance.
 */
const HUMAN_WRITTEN = ['account_title', 'bank_name', 'wallet_provider', 'country', 'last4'];

/** Our envelope: `v1.<iv>.<tag>.<ciphertext>`, all base64. */
const CIPHERTEXT = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/;

/** Anything long enough and digit-dense enough to be an account number. */
const ACCOUNT_SHAPED = /(?:[A-Z]{2}\d{2}[A-Z0-9]{10,})|(?:\d[\d\s-]{7,}\d)/;

async function main() {
  const [tutor] = (await db.execute(sql`
    select user_id::text as id from tutor_profiles where status = 'verified' limit 1
  `)) as unknown as [{ id: string } | undefined];

  if (!tutor) {
    console.error('No verified tutor to attach a method to. Run `pnpm seed` first.');
    process.exit(1);
  }

  const findings: { claim: string; held: boolean; detail: string }[] = [];

  await db
    .transaction(async (tx) => {
      await savePayoutMethod(
        tutor.id,
        {
          kind: 'bank',
          accountTitle: 'Test Account',
          country: 'PK',
          bankName: 'Standard Chartered',
          ...PLAINTEXT,
        },
        tx as never,
      );

      // The dump: every column of every row, as a support tool would see it.
      const rows = (await tx.execute(
        sql`select to_jsonb(m) as row from payout_methods m`,
      )) as unknown as { row: Record<string, unknown> }[];

      const leaked: string[] = [];
      for (const [label, value] of Object.entries(PLAINTEXT)) {
        const dump = JSON.stringify(rows);
        if (dump.includes(value)) leaked.push(label);
        // ...and without the punctuation, in case something normalised it.
        if (dump.includes(value.replace(/\D/g, '')) && value.replace(/\D/g, '').length > 5) {
          leaked.push(`${label} (digits only)`);
        }
      }

      findings.push({
        claim: 'No plaintext we wrote appears in the dump',
        held: leaked.length === 0,
        detail: leaked.length === 0 ? `${rows.length} rows scanned` : `leaked: ${leaked.join(', ')}`,
      });

      // Every column is either meant to be readable, or is ciphertext.
      const unprotected: string[] = [];
      const columns = new Set<string>();

      for (const { row } of rows) {
        for (const [column, value] of Object.entries(row)) {
          columns.add(column);
          if (value === null || ALLOWED_VISIBLE.has(column)) continue;
          if (typeof value === 'string' && CIPHERTEXT.test(value)) continue;
          unprotected.push(`${column} = ${String(value).slice(0, 24)}`);
        }
      }

      findings.push({
        claim: 'Every column is either meant to be read, or is ciphertext',
        held: unprotected.length === 0,
        detail:
          unprotected.length === 0
            ? `${columns.size} columns, ${rows.length} rows`
            : `in the clear: ${unprotected.join('; ')}`,
      });

      // And the readable half carries nothing account-shaped either — a check
      // on the allow-list itself, in case something visible grows a number.
      const visibleText = rows
        .flatMap(({ row }) =>
          Object.entries(row)
            .filter(([column]) => HUMAN_WRITTEN.includes(column))
            .map(([, value]) => String(value ?? '')),
        )
        .join(' | ');

      findings.push({
        claim: 'Nothing a tutor typed is account-shaped',
        held: !ACCOUNT_SHAPED.test(visibleText.toUpperCase()),
        detail: `scanned ${visibleText.length} characters of readable text`,
      });

      // And it is encryption, not deletion.
      const [stored] = (await tx.execute(sql`
        select id::text as id from payout_methods where tutor_id = ${tutor.id}::uuid limit 1
      `)) as unknown as [{ id: string }];

      const clear = await decryptForTransfer(stored.id, tx as never);
      findings.push({
        claim: 'The key still recovers it, so it is protected not lost',
        held: clear?.accountNumber === PLAINTEXT.accountNumber,
        detail: clear ? `recovered ····${clear.accountNumber.slice(-4)}` : 'could not decrypt',
      });

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

  for (const finding of findings) {
    console.log(`${finding.held ? 'OK  ' : 'FAIL'}  ${finding.claim.padEnd(50)} ${finding.detail}`);
  }

  const held = findings.every((finding) => finding.held);
  console.log(
    held
      ? '\nA dump of payout_methods yields nothing usable. Nothing was left behind.'
      : '\nSomething readable is in that table.',
  );
  process.exit(held ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
