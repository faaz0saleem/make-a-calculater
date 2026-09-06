/** Editorial allowlist. IDs are resolved against active curriculum tables, never seeded tutors. */
export type SeoIntent = {
  slug: string;
  title: string;
  description: string;
  boardId?: string;
  levelIds?: readonly string[];
  subjectSlug?: string;
  city?: string;
  country?: string;
  language?: string;
  paragraphs: readonly string[];
  questions: readonly { question: string; answer: string }[];
  siblings: readonly string[];
  sources: readonly { label: string; url: string }[];
};

export const SEO_INTENTS = [
  {
    slug: 'caie-a-level-physics-tutors',
    title: 'CAIE A Level Physics tutors for AS and A2',
    description: 'Find tutors who declare Cambridge AS or A2 Physics, compare their reviews, and plan lessons around your 9702 syllabus and exam year.',
    boardId: 'caie', levelIds: ['caie:as-level', 'caie:a2-level'], subjectSlug: 'physics',
    paragraphs: [
      'Cambridge International A Level Physics asks you to use familiar ideas in unfamiliar situations. A useful lesson starts with your reasoning: why a force acts in that direction, which quantity a graph represents, or whether an answer has sensible units. Bring an attempted question, including the lines you crossed out. Those decisions help a tutor distinguish a missing concept from an algebra mistake.',
      'Tell your tutor whether you are working on AS, A2, or a combined route, and share your examination year and syllabus code. This page includes tutors who have declared Cambridge AS or A2 Physics; each card names the position they actually teach. Someone listed for AS alone is not automatically an A2 specialist. Confirm coverage of your next topic before choosing a slot, especially when moving from first-year foundations to more advanced applications.',
      'Practical preparation needs its own plan. Discuss graph choices, measurement uncertainty, planning and evaluation alongside theory questions. Online discussion can help you interpret experimental evidence, but it does not replace supervised access to appropriate school laboratory work. Use the official syllabus for your examination year to agree which practical skills need attention.',
      'Try a short diagnostic task at the first lesson and agree a manageable follow-up: one corrected explanation and a few related problems can reveal more than another completed paper. Compare lesson length, the tutor’s stated rate and your local booking time. A free trial is available only when that tutor offers and approves one; neither a trial nor credential verification guarantees a particular grade.',
    ],
    questions: [
      { question: 'Does A Level include AS and A2 on this page?', answer: 'Yes. The list combines the active Cambridge AS and A2 positions. Read the position labels on each tutor card: a tutor may declare one or both.' },
      { question: 'Can online lessons replace practical laboratory sessions?', answer: 'No. A tutor can help with interpretation, planning and evaluation, while supervised practical experience must be arranged through your school or examination centre.' },
      { question: 'What should I bring to the first lesson?', answer: 'Your syllabus code, exam year, AS or A2 stage, and a question you have already attempted. Ask the tutor to explain the next steps from your own working.' },
    ],
    siblings: ['caie-as-level-physics-tutors', 'edexcel-igcse-maths-tutors', 'urdu-speaking-chemistry-tutors'],
    sources: [{ label: 'Cambridge Physics 9702 syllabus and resources', url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/view/cambridge-international-as-and-a-level-physics-9702/' }],
  },
  {
    slug: 'caie-as-level-physics-tutors',
    title: 'CAIE AS Level Physics tutors for first-year foundations',
    description: 'Compare tutors who specifically teach Cambridge AS Level Physics. Build a lesson plan for mechanics, electricity, waves and practical reasoning.',
    boardId: 'caie', levelIds: ['caie:as-level'], subjectSlug: 'physics',
    paragraphs: [
      'The move into Cambridge AS Physics often exposes small gaps that were easy to hide in earlier work. Rearranging an equation, reading a gradient and deciding which forces belong on a diagram now need to work together. Before buying a run of lessons, ask a tutor to watch you attempt one multi-step problem. Their response should identify what you understand already and what needs rebuilding.',
      'These results require a declared Cambridge AS Level Physics position. They do not automatically include everyone who teaches A2 or another examination board. Tell the tutor your examination year and confirm the relevant 9702 syllabus. If your school has a different topic order, share the next assessment topic so the lesson supports the course you are actually taking.',
      'A practical weekly plan might alternate a mechanics or electricity problem with an explanation task. For example, you could explain what changes when a variable doubles before attempting a calculation. This makes guessing a formula less tempting and gives your tutor something specific to correct. Keep a short list of recurring errors, such as missing units or an unexplained sign, and revisit it at the next session.',
      'Remember practical reasoning too: reading scales, selecting axes and discussing uncertainty require deliberate practice. A video or voice lesson can support that reasoning, while practical experience belongs in an appropriately supervised setting. Agree one small piece of independent work between sessions and check that the tutor’s available hours fit your school week. An optional trial is a chance to discuss that plan, subject to the tutor’s approval.',
    ],
    questions: [
      { question: 'Will a tutor who only teaches A2 appear here?', answer: 'No. This page requires a declared AS Level Physics position under Cambridge. The wider A Level page includes AS and A2.' },
      { question: 'Do I need to finish a whole paper before a lesson?', answer: 'No. One attempted question with your working is a useful starting point. Share where your reasoning became uncertain.' },
      { question: 'Can I book a shorter lesson?', answer: 'Paid sessions are available in 30- and 60-minute lengths at the rates shown when booking. Confirm that the shorter format fits the task you want to work on.' },
    ],
    siblings: ['caie-a-level-physics-tutors', 'o-level-tutors-in-lahore', 'caie-o-level-chemistry-tutors'],
    sources: [{ label: 'Cambridge AS Physics practical-skills guidance', url: 'https://help.cambridgeinternational.org/hc/en-gb/articles/20616186362002-Where-can-I-find-resources-to-help-deliver-the-practical-skills-necessary-to-teach-AS-A-Level-Physics-And-how-much-time-should-I-spend-teaching-practical-skills' }],
  },
  {
    slug: 'edexcel-igcse-maths-tutors',
    title: 'Edexcel IGCSE Maths tutors for your specification and tier',
    description: 'Find tutors declaring Pearson Edexcel International GCSE Mathematics. Confirm your specification, linear or modular route, and tier before booking.',
    boardId: 'edexcel', levelIds: ['edexcel:igcse'], subjectSlug: 'math',
    paragraphs: [
      'Edexcel International GCSE Maths is a precise qualification choice, but it is not yet a complete lesson brief. Tell a prospective tutor your specification, whether your course is linear or modular, and your tier where applicable. Mathematics A and Mathematics B are separate specifications, and a tutor should check your course documents before recommending papers. This directory matches the Edexcel International GCSE position; it does not certify expertise in every specification or tier.',
      'For a first meeting, bring two questions: one you solved confidently and one that stopped you. A useful explanation should connect the successful method to the harder problem, rather than just replace your answer. In algebra that may mean explaining why a transformation is allowed; in geometry it may mean naming the property that justifies a step. Showing the reasoning helps a tutor see whether the difficulty is conceptual or simply a missed calculation.',
      'Ask for a revision plan that separates weak topics from exam technique. A student who understands a method but leaves working out needs a different task from someone who cannot choose a method. Short mixed practice can test whether a technique remains usable when the chapter heading no longer gives it away. Review your corrections at the next lesson so repeated mistakes become visible.',
      'Match the lesson length to the work: a focused half-hour can be useful for one error pattern, while a longer session leaves space for diagnostic questions and independent attempts. Check the price and time before confirming. The list below uses declared curriculum positions and visible tutor profiles; verify the exact course fit with the tutor and use Pearson’s current documents for your examination year.',
    ],
    questions: [
      { question: 'Is this the same as UK GCSE Maths?', answer: 'No. These results use the Edexcel International GCSE position, not the separate GCSE position. Confirm the specification shown on your school documents.' },
      { question: 'Does the directory distinguish Mathematics A, B and modular courses?', answer: 'The current curriculum table stores International GCSE as one level. Ask the tutor to confirm your specification and route before booking.' },
      { question: 'Should I tell the tutor my tier?', answer: 'Yes, where your specification uses tiers. The tutor needs that information to choose suitable questions and avoid planning around the wrong assessment.' },
    ],
    siblings: ['caie-a-level-physics-tutors', 'o-level-tutors-in-lahore', 'caie-as-level-physics-tutors'],
    sources: [
      { label: 'Pearson Mathematics A course documents', url: 'https://qualifications.pearson.com/en/qualifications/edexcel-international-gcses/international-gcse-mathematics-a-2016.html' },
      { label: 'Pearson Mathematics A modular course documents', url: 'https://qualifications.pearson.com/en/qualifications/edexcel-international-gcses/mathematics-a-2024-modular.html' },
    ],
  },
  {
    slug: 'o-level-tutors-in-lahore',
    title: 'O Level tutors in Lahore for online Cambridge lessons',
    description: 'Compare Lahore-based tutors who declare Cambridge O Level teaching. Check their subjects and plan online lessons around school and exam preparation.',
    boardId: 'caie', levelIds: ['caie:o-level'], city: 'Lahore', country: 'PK',
    paragraphs: [
      'Looking for an O Level tutor in Lahore can mean wanting someone who understands your school day as much as someone who knows the subject. This page lists tutors whose profile city is Lahore, whose country is Pakistan and who declare at least one Cambridge O Level subject. Lessons happen online on Tutorly. A Lahore listing is not a promise of home visits, a nearby centre or an in-person appointment.',
      'Start with the subject and syllabus code on your school documents. O Level is not interchangeable with IGCSE, Matric or A Level, even where topic names overlap. Each result shows the tutor’s declared O Level subjects so you can check that a maths tutor is also a suitable choice for the chemistry work you need. Ask about your examination year, school’s topic order and upcoming mocks before agreeing a study plan.',
      'A useful routine can fit around homework instead of competing with it. Bring a marked class test, choose a recurring error and ask the tutor to help you explain the correction in your own words. Follow with a small amount of related practice. If several subjects need attention, agree which one has the most urgent deadline rather than expecting one session to cover an entire revision timetable.',
      'Check the booking calendar in your own timezone, including when you travel outside Pakistan. For students under 18, a parent or guardian should approve the arrangement and know when the lesson is taking place. Keep messages and calls on the platform, compare the displayed lesson price, and read the cancellation terms before reserving time. Tutor location is profile information, so confirm any location-specific expectation directly.',
    ],
    questions: [
      { question: 'Are these home tutors who visit my house?', answer: 'No. These are online tutors with Lahore listed as their profile city. Tutorly sessions take place on the platform.' },
      { question: 'Will IGCSE-only tutors appear?', answer: 'No. A tutor needs a declared Cambridge O Level position. Their matching O Level subjects are listed on the card.' },
      { question: 'Can my guardian help choose the tutor?', answer: 'Yes. A parent or guardian should review the tutor, approve spending and know the lesson time. A separate guardian dashboard is not currently available.' },
    ],
    siblings: ['caie-o-level-chemistry-tutors', 'urdu-speaking-chemistry-tutors', 'edexcel-igcse-maths-tutors'],
    sources: [],
  },
  {
    slug: 'urdu-speaking-chemistry-tutors',
    title: 'Urdu-speaking Chemistry tutors for clearer explanations',
    description: 'Find Chemistry tutors who list Urdu and a curriculum position. Use bilingual explanations while preparing answers for your own board and class.',
    subjectSlug: 'chemistry', language: 'ur',
    paragraphs: [
      'Sometimes the obstacle in chemistry is the explanation, not the idea. An Urdu-speaking tutor can discuss why particles behave a certain way or what a calculation represents in a language you are comfortable using. That can make it easier to ask a follow-up question. It does not change your examination language: agree with the tutor how you will practise the scientific terms and written answers your course expects.',
      'This page brings together tutors who list Urdu as a spoken language, teach Chemistry and declare a curriculum position for Chemistry. The results may span Cambridge, Edexcel and other boards. Read the board and class labels on each card. Speaking Urdu and teaching Chemistry does not by itself establish a match for your exact syllabus, and the platform’s language field is a tutor declaration rather than an independent language examination.',
      'A practical bilingual lesson can move through three stages: explain the concept conversationally, identify the required scientific vocabulary, and then write a short answer in the language required by your assessment. For calculations, ask the tutor to explain what each quantity means before working through the numbers. Bring your attempted answer so the session addresses your reasoning instead of becoming a lecture you could have watched elsewhere.',
      'Share your class, examination year and syllabus code before booking. You can also say whether you prefer mostly Urdu explanations or only occasional clarification. Ask for a short follow-up task and discuss how corrections will be reviewed. Keep any practical work in an appropriately supervised school setting; an online chemistry lesson is not an invitation to try experiments at home. Compare prices and available times before committing credits.',
    ],
    questions: [
      { question: 'Are all of these tutors for my examination board?', answer: 'No. This is a language-and-subject page. Each card lists the tutor’s declared Chemistry positions so you can select the correct board and class.' },
      { question: 'Can I still practise English exam answers?', answer: 'Yes. Ask for Urdu explanations followed by practice using the scientific vocabulary and answer language required by your course.' },
      { question: 'Has Urdu proficiency been independently tested?', answer: 'The results use the tutor’s declared spoken-language field. Discuss your preferred balance of Urdu and English before booking.' },
    ],
    siblings: ['caie-o-level-chemistry-tutors', 'o-level-tutors-in-lahore', 'caie-a-level-physics-tutors'],
    sources: [],
  },
  {
    slug: 'caie-o-level-chemistry-tutors',
    title: 'CAIE O Level Chemistry tutors for concepts and exam answers',
    description: 'Compare tutors who declare Cambridge O Level Chemistry. Plan support for explanations, calculations and the practical reasoning in your syllabus.',
    boardId: 'caie', levelIds: ['caie:o-level'], subjectSlug: 'chemistry',
    paragraphs: [
      'Cambridge O Level Chemistry revision becomes more useful when you separate remembering a fact from explaining it. A tutor can help you connect observations to a particle model, decide what a question is asking and express your reasoning in a clear sequence. Bring an answer you have already written, even if it is incomplete. The missing link is often easier to find in your own attempt than in a fresh worked solution.',
      'The tutors on this page have declared Chemistry at Cambridge O Level. That is a closer starting point than a general science listing, but you still need to share the syllabus code and examination year used by your school. Ask how the tutor would divide attention between topic understanding, calculations and the practical reasoning relevant to your assessment. A tutor who explains that plan clearly gives you something concrete to evaluate after the first lesson.',
      'For independent practice, keep a small correction log. Record the original mistake, a corrected explanation and one new question where the same idea appears differently. At the next lesson, try that new question before looking at your notes. This helps distinguish an explanation you recognised from a method you can use independently, and it gives both of you a visible way to judge progress.',
      'If language makes explanations harder to follow, use the Urdu-speaking Chemistry page to explore that preference, then recheck the curriculum labels. Live tutoring should fit your school workload and your family’s schedule. Compare the 30- and 60-minute options, check the local time in the calendar and read the credit-refund rules. Laboratory activities belong in a supervised learning environment; online discussion supports that work without replacing it.',
    ],
    questions: [
      { question: 'Is O Level Chemistry the same as IGCSE Chemistry?', answer: 'They are separate curriculum positions in Tutorly. This list requires Cambridge O Level Chemistry; always confirm your syllabus code and examination year.' },
      { question: 'How can I judge whether a lesson helped?', answer: 'Agree a specific goal, then attempt a related question independently. Review your reasoning at the next session instead of relying only on how familiar the explanation felt.' },
      { question: 'Can I request a trial?', answer: 'Only if the tutor offers trials. Requests need the tutor’s approval, and a free trial is limited to one per student–tutor pair under the current rules.' },
    ],
    siblings: ['urdu-speaking-chemistry-tutors', 'o-level-tutors-in-lahore', 'caie-as-level-physics-tutors'],
    sources: [],
  },
] as const satisfies readonly SeoIntent[];
