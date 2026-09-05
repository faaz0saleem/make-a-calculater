/**
 * Follow a tutor (SPEC.md §4).
 *
 * A form rather than a fetch, so it works before any JavaScript loads — which
 * on a slow mobile connection is most of the time somebody is looking at the
 * page.
 */

import { Button } from '@/components/ui/button';

export function FollowButton({
  following,
  action,
  tutorName,
}: {
  following: boolean;
  action: (formData: FormData) => void | Promise<void>;
  tutorName: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="following" value={String(following)} />
      <Button
        type="submit"
        size="sm"
        variant={following ? 'secondary' : 'outline'}
        aria-pressed={following}
        className="min-h-11"
      >
        {following ? 'Following' : 'Follow'}
      </Button>
      <span className="sr-only">
        {following
          ? `Stop following ${tutorName}. You will no longer hear when they add new times.`
          : `Follow ${tutorName} to hear when they add new times.`}
      </span>
    </form>
  );
}
