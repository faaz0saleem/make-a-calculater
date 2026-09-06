# Content research and editorial assumptions

Prepared 5–6 September 2026. This records sources for the new content; it is not
legal advice or approval to launch. All policy pages explicitly remain drafts.

## Marketplace source of truth

Read `SPEC.md` and the entire `PROGRESS.md` at main commit
`d228bc0fd29d781fb036fc3236dd902509af1072` before creating files. Later progress
and current exports supersede older figures in the original specification:

- Standard commission: 22%, falling to 16% once the same student has completed a
  paid session with that tutor; any lower negotiated rate is respected.
- Existing confirmed bookings keep their snapshotted rate and price.
- Shipped credit bonuses: none below $50, 3% at $50 and 5% at $100; $5 first
  purchase offer. The pricing page reads `listCreditPacks()` rather than freezing
  those defaults in marketing copy.
- Technical failure: full credit refund for the student; platform-funded tutor
  share up to two qualifying failures per student per 90 days.
- The extra tutor-no-show credit is signalled but not fulfilled. See
  `DECISIONS_NEEDED.md` item 4. No amount or automatic delivery is invented.
- Guardian email collection exists, but verified consent and a guardian dashboard
  do not. Draft policies identify what must be implemented and reviewed.

## Competitor comparison

[Preply’s commission model](https://help.preply.com/en/articles/4171383-preply-commission-model)
confirms 100% commission on trials with new students and paid-lesson commission
ranging from 33% to 18% with cumulative teaching hours. The recruitment page
links the source next to the comparison and dates the check. Its dollar examples
hold the nominal $25 price constant, compare commission only and do not imply
identical session lengths, fee treatment, audience or earnings potential.

## Curriculum content

- [Cambridge AS & A Level Physics 9702](https://www.cambridgeinternational.org/programmes-and-qualifications/view/cambridge-international-as-and-a-level-physics-9702/)
  supports the distinction between concept application and practical assessment.
- [Cambridge practical-skills guidance](https://help.cambridgeinternational.org/hc/en-gb/articles/20616186362002-Where-can-I-find-resources-to-help-deliver-the-practical-skills-necessary-to-teach-AS-A-Level-Physics-And-how-much-time-should-I-spend-teaching-practical-skills)
  directs teachers to the appropriate syllabus and practical-skills materials.
- [Pearson International GCSE Mathematics A](https://qualifications.pearson.com/en/qualifications/edexcel-international-gcses/international-gcse-mathematics-a-2016.html)
  and [Mathematics A Modular](https://qualifications.pearson.com/en/qualifications/edexcel-international-gcses/mathematics-a-2024-modular.html)
  establish separate routes; no single tier or specification is assumed by the
  broad Edexcel IGCSE database position.

Lesson-planning advice and example study routines are original editorial advice,
not an exam-board endorsement or a promise of grades. Students are told to
confirm their examination year, syllabus code and route. No examination-board
logos, copied papers or lengthy source passages are included.

## Legal review context

[FTC COPPA guidance](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa)
explains the special requirements for covered services collecting information
from children under 13. [European Commission guidance on children’s data](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en)
explains that consent-based child-data processing can require parental consent,
with thresholds varying between 13 and 16 by member state. These references
inform review items; the draft does not assert that either regime necessarily
applies to every account, or that email collection satisfies verified consent.

A lawyer familiar with Pakistan and the countries served must confirm operator
identity, provincial and international consumer protections, cross-border data
transfers, consent, retention, contractor classification, tax, complaints and
suspension/closure payouts. The credit-only refund language expressly preserves
non-waivable legal remedies. No unverified Pakistan statute or business address
is presented as fact.

## Technical sources

[React Email rendering documentation](https://react.email/docs/utilities/render)
describes rendering React components into email HTML. Native React HTML avoids
adding a root dependency outside this branch’s ownership. The sender remains a
core-agent integration task.

[Next.js 15 route handlers](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware)
are used for `/sitemap.xml` and `/robots.txt` inside the allowed SEO route group.
Route groups do not appear in the public URL. Metadata and structured data use
the configured `AUTH_URL` origin; no production hostname is invented.
