import Link from 'next/link';
import type { PublicTutor } from '@/lib/seo/data';
import { formatUsd } from '@/lib/seo/site';
import { actionLink } from '../../(marketing)/_components/public-shell';

export function TutorResults({ tutors }: { tutors: readonly PublicTutor[] }) {
  if (tutors.length === 0) return <div className="rounded-xl border bg-card p-6">
    <h3 className="text-lg font-semibold">No matching tutors are listed right now</h3>
    <p className="mt-2 max-w-2xl leading-7">Try one of the related curriculum pages below, or browse the full feed and check each tutor’s declared subjects. Availability can change as tutors join or update their profiles.</p>
  </div>;
  return <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
    {tutors.map((tutor) => <li key={tutor.id} className="flex min-w-0 flex-col rounded-xl border bg-card p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">Verified tutor profile</p>
      <h3 className="mt-3 break-words text-xl font-semibold">{tutor.name}</h3>
      {tutor.headline && <p className="mt-2 break-words text-sm leading-6">{tutor.headline}</p>}
      {tutor.city && <p className="mt-2 text-sm text-muted-foreground">Profile location: {tutor.city}{tutor.country ? `, ${tutor.country}` : ''} · online lessons</p>}
      <ul aria-label="Matching curriculum positions" className="mt-4 space-y-2 text-sm">
        {tutor.positions.map((position) => <li key={`${position.boardName}:${position.levelName}:${position.subjectName}`} className="rounded-md bg-secondary px-3 py-2">{position.boardName} · {position.levelName} · {position.subjectName}</li>)}
      </ul>
      <p className="mt-4 text-sm">{tutor.rating.count > 0 && tutor.rating.value !== null
        ? `${tutor.rating.value.toFixed(3)} out of 5 · ${tutor.rating.count} visible ${tutor.rating.count === 1 ? 'review' : 'reviews'} (unadjusted average)`
        : 'No reviews yet'}</p>
      <p className="mt-3 font-semibold">Standard rate: {formatUsd(tutor.hourlyCents)} / 60 min</p>
      <p className="mt-1 text-sm">{formatUsd(tutor.halfHourCents)} / 30 min</p>
      <p className="mt-2 text-sm">{tutor.offersTrial ? 'Free trial requests offered; tutor approval required.' : 'Paid lessons; no free trial currently offered.'}</p>
      <p className="mb-5 mt-2 text-xs leading-5 text-muted-foreground">Check the profile and booking screen for any current promotion and final price.</p>
      <Link href={`/tutors/${tutor.id}`} className={`${actionLink} mt-auto`}>View {tutor.name}’s profile</Link>
    </li>)}
  </ul>;
}
