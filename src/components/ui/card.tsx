import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />;
}

/**
 * A card's title is a real heading, at the level its place on the page calls
 * for. Most cards sit directly under the page's `h1`, so `h2` is the default;
 * a page whose card *is* the page passes `h1`, and one nesting deeper passes
 * `h3` — a screen reader's outline is only useful if it matches the visual one.
 */
export function CardTitle({
  className,
  as: Heading = 'h2',
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) {
  return <Heading className={cn('text-base font-semibold leading-none', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

/**
 * The big number on a stat card.
 *
 * Deliberately not a heading: "$124.00" is a value, not a section title, and a
 * screen reader announcing it as one turns the page outline into a list of
 * amounts. The label above it is the `CardDescription`.
 */
export function CardMetric({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-2xl font-semibold leading-none tabular-nums', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
