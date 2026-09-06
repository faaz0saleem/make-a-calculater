/**
 * What this session is for (SPEC.md §4).
 *
 * Two halves, and the second matters more than it looks. The checkboxes are a
 * curated syllabus and cover most of what somebody needs; the free-text box is
 * for the sentence they would actually say — "I don't understand titration
 * calculations" — which no taxonomy contains and which tells the tutor more
 * than three ticked chapters do.
 *
 * Neither is required. A student who books without saying anything gets a
 * session; the tutor asks in the first minute, which is what happens today.
 * Making this mandatory would buy a little tutor convenience at the cost of
 * abandoned bookings, which is the wrong trade at the one page that asks for
 * money.
 */

import { Field } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MAX_TOPICS_PER_BOOKING } from '@/db/topics';

export type PickableTopic = {
  id: string;
  name: string;
  reference: string | null;
  subjectName: string;
  levelName: string;
};

export function TopicPicker({
  topics,
  selected = [],
  note = '',
  label = 'What would you like to cover?',
}: {
  topics: readonly PickableTopic[];
  selected?: readonly string[];
  note?: string;
  label?: string;
}) {
  const chosen = new Set(selected);

  // Grouped, because a student studying two subjects should not scroll one
  // list of forty chapters looking for the physics.
  const groups = new Map<string, PickableTopic[]>();
  for (const topic of topics) {
    const key = `${topic.subjectName} · ${topic.levelName}`;
    groups.set(key, [...(groups.get(key) ?? []), topic]);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="topic-picker">
      {topics.length > 0 ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{label}</legend>
          <p className="text-xs text-muted-foreground">
            Optional, and up to {MAX_TOPICS_PER_BOOKING}. An hour rarely covers more than two.
          </p>

          {[...groups.entries()].map(([heading, list]) => (
            <div key={heading} className="flex flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {heading}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {list.map((topic) => (
                  <label key={topic.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="topicIds"
                      value={topic.id}
                      defaultChecked={chosen.has(topic.id)}
                      className="mt-1 h-4 w-4 accent-[var(--primary)]"
                      data-testid="topic-option"
                    />
                    <span>
                      {topic.reference ? (
                        <span className="text-muted-foreground">{topic.reference} </span>
                      ) : null}
                      {topic.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      ) : (
        <p className="rounded-md bg-secondary px-3 py-2 text-xs">
          We do not have a chapter list for your syllabus yet. Tell your tutor what you need in your
          own words below — it is the more useful half anyway.
        </p>
      )}

      <Field
        label="Anything else they should know"
        htmlFor="topicNote"
        hint="Your tutor reads this before the session."
      >
        <Textarea
          id="topicNote"
          name="topicNote"
          rows={3}
          maxLength={2000}
          defaultValue={note}
          placeholder="I don't understand titration calculations."
          data-testid="topic-note"
        />
      </Field>
    </div>
  );
}
