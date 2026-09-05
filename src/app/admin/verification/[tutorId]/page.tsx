/**
 * The verification screen (SPEC.md §10).
 *
 * Profile claims on the left, the documents that are supposed to back them on
 * the right, the legibility checklist under them, and approve / reject-with-
 * reason at the bottom.
 *
 * Document links are minted fresh on every page load and expire after 60
 * seconds, so a URL copied out of the page is useless a minute later.
 *
 * Where the claims and the documents look unrelated, the screen says so — as a
 * flag next to the claim, never as a decision. A physics graduate teaching
 * GCSE English is a real tutor; what an admin needs is to be told where to
 * look, not to be told the answer.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { approveTutorAction, rejectTutorAction } from '@/app/admin/verification/actions';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { getTutorCurriculum } from '@/db/curriculum';
import { loadTutorDossier } from '@/db/tutors';
import { unsupportedSubjects } from '@/lib/curriculum/credential-match';
import { requireRole } from '@/lib/auth/guards';
import { formatCents } from '@/lib/money/cents';
import { takeHomeFor } from '@/lib/money/commission';
import { objectUrl, SIGNED_URL_TTL_SECONDS } from '@/lib/storage';
import { languageName, PROFICIENCY_LABELS, type LanguageProficiency } from '@/lib/tutors/languages';
import { CHECKLIST_ITEMS } from '@/lib/tutors/verification';
import { formatInTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Claim({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function VerificationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tutorId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireRole('admin');
  const { tutorId } = await params;
  const { error } = await searchParams;

  const tutor = await loadTutorDossier(tutorId);
  if (!tutor) notFound();

  const positions = await getTutorCurriculum(tutorId);
  const takeHome = takeHomeFor(tutor.hourlyCents, tutor.commissionBps);
  const flags = unsupportedSubjects(tutor.subjects, tutor.credentials);
  const flagged = new Set(flags.map((flag) => flag.subjectSlug));

  const decidable = tutor.status === 'pending_review';

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tutor.name}</h1>
            <p className="text-sm text-muted-foreground">
              {tutor.email} · submitted{' '}
              {tutor.submittedAt ? formatInTimeZone(tutor.submittedAt, admin.timezone) : 'unknown'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={tutor.status === 'verified' ? 'success' : 'secondary'}>{tutor.status}</Badge>
            <Link href="/admin/verification" className="text-sm text-muted-foreground underline underline-offset-4">
              Back to queue
            </Link>
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!decidable ? (
          <p className="rounded-md bg-secondary px-3 py-2 text-sm">
            This profile is <strong>{tutor.status}</strong>, so there is nothing to decide. It is shown here
            for reference.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---------------------------------------------------------------- */}
          {/* What the tutor claims                                            */}
          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Profile claims</CardTitle>
              <CardDescription>What the tutor entered.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col">
                <Claim label="Name">{tutor.name}</Claim>
                <Claim label="Location">
                  {[tutor.city, tutor.country].filter(Boolean).join(', ') || '—'} · {tutor.timezone}
                </Claim>
                <Claim label="Headline">{tutor.headline ?? '—'}</Claim>
                <Claim label="Languages">
                  {tutor.languages.length === 0
                    ? '—'
                    : tutor.languages
                        .map(
                          (language) =>
                            `${languageName(language.languageCode)} (${
                              PROFICIENCY_LABELS[language.proficiency as LanguageProficiency] ??
                              language.proficiency
                            })`,
                        )
                        .join(', ')}
                </Claim>
                <Claim label="Subjects">
                  {tutor.subjects.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {tutor.subjects.map((subject) => (
                        <li key={subject.slug}>
                          {subject.name} · {subject.level.replace('_', ' ')} · {subject.yearsExperience} yr
                          {flagged.has(subject.slug) ? (
                            <Badge variant="warning" className="ml-2 text-[10px]" data-testid="credential-flag">
                              Check this
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Claim>
                <Claim label="Boards and classes">
                  {positions.length === 0 ? (
                    <span className="text-muted-foreground">
                      None declared — this tutor will not be matched to a student&rsquo;s curriculum.
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {positions.map((position) => (
                        <li key={`${position.boardId}:${position.levelId}:${position.subjectId}`}>
                          {position.boardName} · {position.levelName} · {position.subjectName}
                        </li>
                      ))}
                    </ul>
                  )}
                </Claim>
                <Claim label="Rates">
                  {formatCents(tutor.hourlyCents)}/hr · {formatCents(tutor.halfHourCents)} per 30 min ·
                  they receive {formatCents(takeHome.firstCents)} of an hour from a new student,{' '}
                  {formatCents(takeHome.rebookingCents)} from a returning one
                  {tutor.commissionBps === null
                    ? ''
                    : ` · ${tutor.commissionBps / 100}% negotiated floor (they pay the lower of this and the retention rate)`}
                </Claim>
                <Claim label="Free trial">
                  {tutor.offersTrial ? `Yes, ${tutor.trialMinutes} minutes` : 'No'}
                </Claim>
                <Claim label="Availability">
                  {tutor.availability.length === 0
                    ? '—'
                    : tutor.availability
                        .map(
                          (rule) =>
                            `${WEEKDAYS[rule.weekdayLocal]} ${rule.startTimeLocal.slice(0, 5)}–${rule.endTimeLocal.slice(0, 5)}`,
                        )
                        .join(', ')}
                </Claim>
                <Claim label="Intro video">
                  {tutor.video
                    ? `${tutor.video.status}${tutor.video.durationS ? ` · ${tutor.video.durationS}s` : ''}`
                    : 'None'}
                </Claim>
                <Claim label="Bio">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tutor.bio ?? '—'}</p>
                </Claim>
              </dl>
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          {/* The documents backing them                                       */}
          {/* ---------------------------------------------------------------- */}
          {flags.length > 0 ? (
            <Card className="border-[var(--warning)]" data-testid="credential-flags">
              <CardHeader>
                <CardTitle as="h2">Worth asking about</CardTitle>
                <CardDescription>
                  This is a prompt, not a verdict. Plenty of good tutors teach outside the field they
                  studied — but if the documents say nothing about a subject, it is worth knowing why
                  before approving.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {flags.map((flag) => (
                    <li key={flag.subjectSlug}>
                      <strong className="font-medium">{flag.subjectName}</strong> — {flag.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                Links expire {SIGNED_URL_TTL_SECONDS} seconds after this page loaded. Reload for fresh ones.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {tutor.credentials.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                tutor.credentials.map((document) => {
                  const href = objectUrl(document.fileKey);
                  const isImage = /\.(jpe?g|png)$/i.test(document.fileKey);

                  return (
                    <div key={document.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{document.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {document.institution}
                            {document.year ? ` · ${document.year}` : ''} · {document.kind.replace('_', ' ')}
                          </p>
                        </div>
                        <Badge variant={document.status === 'approved' ? 'success' : 'outline'}>
                          {document.status}
                        </Badge>
                      </div>

                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={href}
                          alt={`${document.title} from ${document.institution}`}
                          className="max-h-80 w-full rounded border border-border object-contain"
                        />
                      ) : (
                        <object data={href} type="application/pdf" className="h-80 w-full rounded border border-border">
                          <p className="p-3 text-sm text-muted-foreground">
                            Your browser cannot display this inline.{' '}
                            <a href={href} className="underline underline-offset-4" target="_blank" rel="noreferrer">
                              Open it in a new tab
                            </a>{' '}
                            within the next {SIGNED_URL_TTL_SECONDS} seconds.
                          </p>
                        </object>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Decision                                                            */}
        {/* ------------------------------------------------------------------ */}
        {decidable ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Approve</CardTitle>
                <CardDescription>Every box has to be ticked. The list is recorded in the audit log.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={approveTutorAction} className="flex flex-col gap-4">
                  <input type="hidden" name="tutorId" value={tutor.id} />

                  <ul className="flex flex-col gap-2">
                    {CHECKLIST_ITEMS.map((item) => (
                      <li key={item.key}>
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name={item.key} className="mt-0.5 size-4" />
                          {item.label}
                        </label>
                      </li>
                    ))}
                  </ul>

                  <Textarea name="note" rows={2} placeholder="Optional note for the record" />

                  <Button type="submit" className="self-start">
                    Approve and publish
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reject</CardTitle>
                <CardDescription>
                  The reason is shown to the tutor verbatim, so write something they can act on.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={rejectTutorAction} className="flex flex-col gap-4">
                  <input type="hidden" name="tutorId" value={tutor.id} />
                  <Textarea
                    name="reason"
                    rows={4}
                    required
                    minLength={10}
                    placeholder="The name on your degree certificate does not match your profile name. Upload a document in the same name, or update your profile."
                  />
                  <Button type="submit" variant="destructive" className="self-start">
                    Reject with this reason
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </>
  );
}
