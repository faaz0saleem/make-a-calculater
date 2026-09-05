/**
 * The nightly reconciliation job (SPEC.md §12).
 *
 * Asserts that every materialised balance column equals the sum of its ledger
 * rows. Exits non-zero on drift so a cron runner turns it into an alert.
 *
 * Run with `pnpm reconcile`.
 */

import './bootstrap';

import { formatReconciliationReport, reconcileLedger } from '@/db/ledger';

async function main() {
  const report = await reconcileLedger();
  console.log(formatReconciliationReport(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
