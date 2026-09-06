/**
 * The chapters inside a syllabus (SPEC.md §4).
 *
 * Seeded for the launch board — Cambridge, which is what the private schools
 * this product is aimed at actually teach — across the four subjects that carry
 * most of the demand. Everything else has no topics yet and the booking form
 * says so plainly rather than showing an empty list: a student with no
 * chapters to tick still gets the free-text box, which is the more useful half
 * anyway.
 *
 * These are real syllabus units, not invented ones. An admin can edit, add and
 * retire them at `/admin/curriculum` — this file is the starting point, not the
 * source of truth once the product is running.
 */

export type TopicSeed = {
  /** Chapter or unit number as the syllabus prints it. */
  reference: string;
  name: string;
};

export type TopicSet = {
  boardId: string;
  levelId: string;
  subjectSlug: string;
  topics: TopicSeed[];
};

const IGCSE_MATHS: TopicSeed[] = [
  { reference: '1', name: 'Number' },
  { reference: '2', name: 'Algebra and graphs' },
  { reference: '3', name: 'Coordinate geometry' },
  { reference: '4', name: 'Geometry' },
  { reference: '5', name: 'Mensuration' },
  { reference: '6', name: 'Trigonometry' },
  { reference: '7', name: 'Transformations and vectors' },
  { reference: '8', name: 'Probability' },
  { reference: '9', name: 'Statistics' },
];

const IGCSE_PHYSICS: TopicSeed[] = [
  { reference: '1', name: 'Motion, forces and energy' },
  { reference: '2', name: 'Thermal physics' },
  { reference: '3', name: 'Waves' },
  { reference: '4', name: 'Electricity and magnetism' },
  { reference: '5', name: 'Nuclear physics' },
  { reference: '6', name: 'Space physics' },
];

const IGCSE_CHEMISTRY: TopicSeed[] = [
  { reference: '1', name: 'States of matter' },
  { reference: '2', name: 'Atoms, elements and compounds' },
  { reference: '3', name: 'Stoichiometry' },
  { reference: '4', name: 'Electrochemistry' },
  { reference: '5', name: 'Chemical energetics' },
  { reference: '6', name: 'Chemical reactions' },
  { reference: '7', name: 'Acids, bases and salts' },
  { reference: '8', name: 'The Periodic Table' },
  { reference: '9', name: 'Metals' },
  { reference: '10', name: 'Chemistry of the environment' },
  { reference: '11', name: 'Organic chemistry' },
  { reference: '12', name: 'Experimental techniques and chemical analysis' },
];

const IGCSE_BIOLOGY: TopicSeed[] = [
  { reference: '1', name: 'Characteristics and classification of living organisms' },
  { reference: '2', name: 'Organisation of the organism' },
  { reference: '3', name: 'Movement into and out of cells' },
  { reference: '4', name: 'Biological molecules' },
  { reference: '5', name: 'Enzymes' },
  { reference: '6', name: 'Plant nutrition' },
  { reference: '7', name: 'Human nutrition' },
  { reference: '8', name: 'Transport in plants' },
  { reference: '9', name: 'Transport in animals' },
  { reference: '10', name: 'Diseases and immunity' },
  { reference: '11', name: 'Gas exchange in humans' },
  { reference: '12', name: 'Respiration' },
  { reference: '13', name: 'Excretion in humans' },
  { reference: '14', name: 'Coordination and response' },
  { reference: '15', name: 'Drugs' },
  { reference: '16', name: 'Reproduction' },
  { reference: '17', name: 'Inheritance' },
  { reference: '18', name: 'Variation and selection' },
  { reference: '19', name: 'Organisms and their environment' },
  { reference: '20', name: 'Human influences on ecosystems' },
  { reference: '21', name: 'Biotechnology and genetic modification' },
];

const AS_MATHS: TopicSeed[] = [
  { reference: 'P1.1', name: 'Quadratics' },
  { reference: 'P1.2', name: 'Functions' },
  { reference: 'P1.3', name: 'Coordinate geometry' },
  { reference: 'P1.4', name: 'Circular measure' },
  { reference: 'P1.5', name: 'Trigonometry' },
  { reference: 'P1.6', name: 'Series' },
  { reference: 'P1.7', name: 'Differentiation' },
  { reference: 'P1.8', name: 'Integration' },
  { reference: 'S1.1', name: 'Representation of data' },
  { reference: 'S1.2', name: 'Permutations and combinations' },
  { reference: 'S1.3', name: 'Probability' },
  { reference: 'S1.4', name: 'Discrete random variables' },
  { reference: 'S1.5', name: 'The normal distribution' },
];

const A2_MATHS: TopicSeed[] = [
  { reference: 'P3.1', name: 'Algebra' },
  { reference: 'P3.2', name: 'Logarithmic and exponential functions' },
  { reference: 'P3.3', name: 'Trigonometry' },
  { reference: 'P3.4', name: 'Differentiation' },
  { reference: 'P3.5', name: 'Integration' },
  { reference: 'P3.6', name: 'Numerical solution of equations' },
  { reference: 'P3.7', name: 'Vectors' },
  { reference: 'P3.8', name: 'Differential equations' },
  { reference: 'P3.9', name: 'Complex numbers' },
];

const AS_PHYSICS: TopicSeed[] = [
  { reference: '1', name: 'Physical quantities and units' },
  { reference: '2', name: 'Kinematics' },
  { reference: '3', name: 'Dynamics' },
  { reference: '4', name: 'Forces, density and pressure' },
  { reference: '5', name: 'Work, energy and power' },
  { reference: '6', name: 'Deformation of solids' },
  { reference: '7', name: 'Waves' },
  { reference: '8', name: 'Superposition' },
  { reference: '9', name: 'Electricity' },
  { reference: '10', name: 'D.C. circuits' },
  { reference: '11', name: 'Particle physics' },
];

const AS_CHEMISTRY: TopicSeed[] = [
  { reference: '1', name: 'Atomic structure' },
  { reference: '2', name: 'Atoms, molecules and stoichiometry' },
  { reference: '3', name: 'Chemical bonding' },
  { reference: '4', name: 'States of matter' },
  { reference: '5', name: 'Chemical energetics' },
  { reference: '6', name: 'Electrochemistry' },
  { reference: '7', name: 'Equilibria' },
  { reference: '8', name: 'Reaction kinetics' },
  { reference: '9', name: 'The Periodic Table' },
  { reference: '10', name: 'Group 2 and Group 17' },
  { reference: '11', name: 'Introduction to organic chemistry' },
  { reference: '12', name: 'Hydrocarbons and halogen compounds' },
];

const AS_BIOLOGY: TopicSeed[] = [
  { reference: '1', name: 'Cell structure' },
  { reference: '2', name: 'Biological molecules' },
  { reference: '3', name: 'Enzymes' },
  { reference: '4', name: 'Cell membranes and transport' },
  { reference: '5', name: 'The mitotic cell cycle' },
  { reference: '6', name: 'Nucleic acids and protein synthesis' },
  { reference: '7', name: 'Transport in plants' },
  { reference: '8', name: 'Transport in mammals' },
  { reference: '9', name: 'Gas exchange' },
  { reference: '10', name: 'Infectious disease' },
  { reference: '11', name: 'Immunity' },
];

/** The launch taxonomy. Cambridge, IGCSE and A Level, four subjects. */
export const TOPIC_SEEDS: TopicSet[] = [
  { boardId: 'caie', levelId: 'caie:igcse', subjectSlug: 'math', topics: IGCSE_MATHS },
  { boardId: 'caie', levelId: 'caie:igcse', subjectSlug: 'physics', topics: IGCSE_PHYSICS },
  { boardId: 'caie', levelId: 'caie:igcse', subjectSlug: 'chemistry', topics: IGCSE_CHEMISTRY },
  { boardId: 'caie', levelId: 'caie:igcse', subjectSlug: 'biology', topics: IGCSE_BIOLOGY },

  // O Level shares the IGCSE syllabus closely enough that the chapter list is
  // the same one; the exam differs, the content does not.
  { boardId: 'caie', levelId: 'caie:o-level', subjectSlug: 'math', topics: IGCSE_MATHS },
  { boardId: 'caie', levelId: 'caie:o-level', subjectSlug: 'physics', topics: IGCSE_PHYSICS },
  { boardId: 'caie', levelId: 'caie:o-level', subjectSlug: 'chemistry', topics: IGCSE_CHEMISTRY },
  { boardId: 'caie', levelId: 'caie:o-level', subjectSlug: 'biology', topics: IGCSE_BIOLOGY },

  { boardId: 'caie', levelId: 'caie:as-level', subjectSlug: 'math', topics: AS_MATHS },
  { boardId: 'caie', levelId: 'caie:as-level', subjectSlug: 'physics', topics: AS_PHYSICS },
  { boardId: 'caie', levelId: 'caie:as-level', subjectSlug: 'chemistry', topics: AS_CHEMISTRY },
  { boardId: 'caie', levelId: 'caie:as-level', subjectSlug: 'biology', topics: AS_BIOLOGY },

  { boardId: 'caie', levelId: 'caie:a2-level', subjectSlug: 'math', topics: A2_MATHS },
];

/** How many chapters the launch taxonomy carries, for the seed's own report. */
export function totalSeededTopics(): number {
  return TOPIC_SEEDS.reduce((total, set) => total + set.topics.length, 0);
}
