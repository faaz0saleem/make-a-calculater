import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class merge helper: conditional classes, last Tailwind class wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
