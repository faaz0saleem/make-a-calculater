import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Tutorly — find a tutor, book a session',
    template: '%s · Tutorly',
  },
  description:
    'A discovery-first tutoring marketplace. Watch a tutor before you book, buy credits, and take every lesson on-platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
