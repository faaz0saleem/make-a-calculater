import type { Metadata } from 'next';

/** No invented production hostname. AUTH_URL is already part of the app's config. */
export function siteOrigin(): string {
  const raw = process.env.AUTH_URL ?? 'http://localhost:3000';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AUTH_URL must be a public HTTP(S) origin without credentials.');
  }
  return url.origin;
}

export function absoluteUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected an internal path.');
  const url = new URL(path, siteOrigin());
  // Tracking, sorting and filters never form a canonical URL.
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function productionIndexingAllowed(): boolean {
  const url = new URL(siteOrigin());
  return process.env.NODE_ENV === 'production'
    && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production')
    && url.protocol === 'https:'
    && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.hostname.endsWith('.invalid') && !url.hostname.endsWith('.test');
}

export type QueryParameters = Record<string, string | string[] | undefined>;
export function hasQueryParameters(query: QueryParameters): boolean {
  return Object.keys(query).length > 0;
}

export function pageMetadata(title: string, description: string, path: string, index = true): Metadata {
  const canonical = absoluteUrl(path);
  return {
    title, description,
    alternates: { canonical },
    robots: { index: index && productionIndexingAllowed(), follow: true },
    openGraph: { title, description, url: canonical, type: 'website', siteName: 'Tutorly' },
    twitter: { card: 'summary', title, description },
  };
}

/** Display only. This module never prices, refunds, transfers or settles money. */
export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Expected non-negative integer cents.');
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}
