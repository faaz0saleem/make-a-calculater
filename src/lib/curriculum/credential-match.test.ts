import { describe, expect, it } from 'vitest';

import {
  hasTeachingQualification,
  unsupportedSubjects,
  type CredentialSummary,
} from './credential-match';

const degree = (title: string, institution = 'University of the Punjab'): CredentialSummary => ({
  kind: 'degree',
  title,
  institution,
});

const MATHS = { slug: 'math', name: 'Math' };
const CHEMISTRY = { slug: 'chemistry', name: 'Chemistry' };
const MUSIC = { slug: 'music', name: 'Music' };

describe('unsupportedSubjects', () => {
  it('says nothing when the degree matches the subject', () => {
    expect(unsupportedSubjects([MATHS], [degree('BSc Mathematics')])).toEqual([]);
  });

  it('flags a subject with no visible support', () => {
    const flags = unsupportedSubjects([CHEMISTRY], [degree('BA History')]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectSlug).toBe('chemistry');
    expect(flags[0]!.reason).toContain('chemistry');
  });

  it('flags only the subjects that are unsupported, not the whole profile', () => {
    const flags = unsupportedSubjects([MATHS, MUSIC], [degree('MSc Applied Mathematics')]);
    expect(flags.map((flag) => flag.subjectSlug)).toEqual(['music']);
  });

  it('accepts an adjacent field rather than demanding the exact word', () => {
    // The point of the generous keyword lists: an engineer teaching physics is
    // not a suspicious profile.
    expect(unsupportedSubjects([{ slug: 'physics', name: 'Physics' }], [degree('BE Electrical Engineering')])).toEqual([]);
    expect(unsupportedSubjects([MATHS], [degree('BS Computer Science')])).toEqual([]);
    expect(unsupportedSubjects([{ slug: 'biology', name: 'Biology' }], [degree('MBBS')])).toEqual([]);
  });

  it('never flags anybody holding a teaching qualification', () => {
    // A licence certifies the ability to teach; a ministry has already checked.
    expect(unsupportedSubjects([MUSIC, CHEMISTRY], [
      { kind: 'teaching_licence', title: 'Secondary teaching licence', institution: 'FBISE' },
    ])).toEqual([]);
    expect(unsupportedSubjects([MUSIC], [degree('PGCE Secondary', 'University of Leeds')])).toEqual([]);
  });

  it('stays quiet when there is nothing to compare against', () => {
    expect(unsupportedSubjects([CHEMISTRY], [])).toEqual([]);
    // An identity document says who somebody is, not what they know.
    expect(
      unsupportedSubjects([CHEMISTRY], [{ kind: 'id', title: 'CNIC', institution: 'NADRA' }]),
    ).toEqual([]);
  });

  it('stays quiet about a subject nobody wrote a keyword list for', () => {
    expect(unsupportedSubjects([{ slug: 'pottery', name: 'Pottery' }], [degree('BA History')])).toEqual([]);
  });

  it('matches on the institution too, not only the title', () => {
    expect(
      unsupportedSubjects([MUSIC], [degree('Diploma, Grade 8', 'Royal Academy of Music')]),
    ).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(unsupportedSubjects([MATHS], [degree('BSC MATHEMATICS')])).toEqual([]);
  });
});

describe('hasTeachingQualification', () => {
  it('recognises a licence by kind and by wording', () => {
    expect(hasTeachingQualification([{ kind: 'teaching_licence', title: 'x', institution: 'y' }])).toBe(true);
    expect(hasTeachingQualification([degree('B.Ed Mathematics')])).toBe(true);
    expect(hasTeachingQualification([degree('BSc Physics')])).toBe(false);
  });
});
