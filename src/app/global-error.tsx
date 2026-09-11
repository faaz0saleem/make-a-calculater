'use client';

/**
 * The boundary below the boundary.
 *
 * `error.tsx` renders inside the root layout, so it cannot catch a failure in
 * the layout itself. This one replaces the whole document, which is why it has
 * to bring its own `html` and `body` and cannot use anything from the layout —
 * including the stylesheet. Hence the inline styles: this file has to work when
 * nothing else does.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          font: '16px/1.6 system-ui, sans-serif',
          color: '#111',
          background: '#fafafa',
        }}
      >
        <main style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Tutorly is having trouble</h1>
          <p style={{ margin: '0 0 1rem' }}>
            The page could not be loaded. This is at our end, not yours.{' '}
            <strong>Nothing has been charged.</strong>
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: 'inherit',
              padding: '0.6rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '1rem' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
