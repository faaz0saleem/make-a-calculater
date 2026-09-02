/**
 * Loads `.env.local` then `.env` for standalone scripts (seed, migrate, reconcile).
 * Next.js does this itself, so nothing in `src/app` needs it.
 *
 * Import this first, before anything that reads `process.env`.
 */

import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
