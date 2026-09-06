export type PolicySection = { heading: string; paragraphs: readonly string[] };
export type LegalPolicy = {
  slug: string;
  title: string;
  description: string;
  reviewItems: readonly string[];
  sections: readonly PolicySection[];
};

export const LEGAL_DRAFT_NOTICE = 'DRAFT — REQUIRES LEGAL REVIEW';
export const LEGAL_POLICIES = [
  {
    slug: 'terms', title: 'Terms of Service',
    description: 'Draft marketplace terms for students, guardians and independent tutors using Tutorly from Pakistan and internationally.',
    reviewItems: ['Confirm the operator’s legal name, Pakistan address, service contact and applicable province before adoption.', 'Approve age eligibility and verifiable guardian consent before opening the service to children who require it.', 'Confirm the additional tutor-no-show credit and the treatment of balances on closure.'],
    sections: [
      { heading: 'The marketplace and the people using it', paragraphs: [
        'Tutorly is the working name of a tutoring marketplace operated from Pakistan by an operator whose legal identity and address must be completed before these terms take effect. We arrange discovery, booking, credits, on-platform communications and tutor payouts. The tutor supplies the teaching service; the student receives it, with a parent or legal guardian responsible for the arrangement where the student is a minor.',
        'Most intended students are under 18. An adult must approve a minor’s use and spending, provide accurate guardian details and remain appropriately involved in lesson arrangements. Providing an email address alone does not establish legally valid parental consent. Accounts requiring verified consent must not be activated for the relevant processing or lessons until that consent and any local age requirements have been satisfied. Tutors must be adults legally able to enter the Tutor Agreement.',
      ] },
      { heading: 'Choosing a tutor and booking a lesson', paragraphs: [
        'Tutors are independent contractors who set their own permitted rates, subjects and availability. Credential verification means the platform has reviewed submitted information; it is not a guarantee of teaching quality, language proficiency, suitability for every syllabus, examination results or admission to an institution. It does not imply a criminal-record check unless a specific check is expressly described.',
        'Review the tutor’s declared board, class and subject, lesson duration, displayed price and local booking time before confirming. Confirmed paid bookings retain their agreed price even if a tutor later changes their rates. Lessons and related messages must stay on the platform. Do not share account access, impersonate another person, arrange academic cheating or use the service for harassment.',
      ] },
      { heading: 'Credits, purchases and refunds', paragraphs: [
        'One credit represents US$1 of lesson value. Credits do not expire, are not a bank deposit or an investment, and cannot be withdrawn, transferred as money or redeemed for cash. Credit purchases are non-refundable to cash under the standard marketplace policy. Approved booking refunds return as credits to the student wallet. Any non-waivable statutory right to a monetary refund or other remedy remains available and takes priority over this policy.',
        'Credit packs, any bonus and the price payable are shown before purchase. Provider or currency-conversion charges must be disclosed where applicable. A first-purchase offer is available only to eligible first-time purchasers. Tutors are paid from their earnings balance, which is separate from student lesson credits. Do not describe purchasing credits as purchasing a guaranteed number of lessons: tutor prices vary.',
      ] },
      { heading: 'Cancellations, attendance and disputes', paragraphs: [
        'A student cancellation more than 24 hours before the scheduled start receives a full credit refund. From 2 hours through exactly 24 hours before start, half is refunded. With less than 2 hours remaining, no credit refund is due under the standard policy. The tutor receives the corresponding chargeable share after commission. Tutor cancellation at any time returns the full lesson price as credits and may result in a strike; three strikes in 90 days trigger review.',
        'If the student does not attend and the tutor joins and waits at least 10 minutes, the lesson is charged in full and the tutor receives their full share. If the tutor does not attend, the student receives a full credit refund and the tutor receives a strike. The product specification also proposes one additional free-session credit; its value and fulfilment must be approved and implemented before that additional benefit can be promised.',
        'A qualifying connection failure with less than half the booked time attended together returns the lesson price as credits. Under the current policy the platform absorbs the tutor’s share for up to two qualifying failures per student in 90 days; subsequent qualifying failures still refund the student but do not carry that tutor-payment protection. Attendance is assessed from server session events. Raise a problem through the session’s report or dispute controls as soon as possible, preferably within the 24-hour settlement window; that window does not remove statutory complaint rights.',
      ] },
      { heading: 'Optional trials and communications', paragraphs: [
        'Free trials are optional for tutors, require their approval and move no credits. A tutor may offer a 10-, 15- or 20-minute trial and limit weekly requests. The current rule allows one trial request per student–tutor pair for the lifetime of the pair, including requests that expire or are declined; the product owner must review that restriction before launch. A requested trial is not a confirmed appointment until accepted.',
        'Transactional notices concern bookings, purchases, verification and payouts. Optional reminder, review, low-balance and followed-tutor messages should respect notification preferences. Contact details may be masked in messages, while unmasked originals may be accessible to authorised moderators for safety and policy review. Do not ask a child to keep a conversation secret or move it to a private social account.',
      ] },
      { heading: 'Restrictions, closure and legal rights', paragraphs: [
        'We may restrict or suspend an account to investigate safety concerns, fraud or serious policy breaches. Where lawful and compatible with safety, we provide the reason, affected bookings and a way to appeal. A suspension does not by itself confiscate a tutor’s earned balance. Disputed amounts or amounts reasonably needed for refunds or lawful holds may remain pending review; undisputed earnings remain owed, subject to documented adjustments and payout verification. Closure and below-threshold settlement require the approved process described in the Tutor Agreement.',
        'These draft terms propose Pakistani law for the marketplace relationship, subject to mandatory protections in the student’s place of residence and any court or regulator they may lawfully use. Nothing excludes liability or consumer remedies that cannot legally be excluded, including rights relating to defective services. The legal reviewer must confirm jurisdiction and any fair, proportionate liability terms. Material changes need an effective date and appropriate notice; they must not silently rewrite confirmed bookings or accrued balances.',
      ] },
    ],
  },
  {
    slug: 'privacy', title: 'Privacy Policy',
    description: 'Draft privacy notice explaining student, guardian, tutor, lesson, moderation and payout data on Tutorly.',
    reviewItems: ['Complete the controller’s legal identity, address and privacy-request contact.', 'Confirm production vendors, hosting countries, transfer mechanisms and retention periods before publication.', 'Validate child-consent, deletion, access-request and optional-cookie workflows; a guardian email is not verified consent.'],
    sections: [
      { heading: 'Who handles your information', paragraphs: [
        'The Pakistan-based Tutorly operator determines how marketplace account, booking, safety and payment records are used. Its legal name, business address and privacy contact must be supplied before this draft becomes effective. Tutors receive limited student information to deliver a booked lesson and must use it only for that educational purpose, subject to the Tutor Agreement and applicable privacy law.',
      ] },
      { heading: 'Information used to run lessons', paragraphs: [
        'Account information includes email, login credentials or sign-in-provider identifiers, name, roles, age-band answer, country and timezone. A minor’s account may include a guardian’s email and linking records. Student curriculum choices help match a board, class and subject. A phone number may be supplied for optional reminders; entering it must not imply consent to every marketing channel.',
        'Tutor profiles include public names, photos, biographies, declared city and country, subjects, curriculum positions, spoken languages, intro videos, rates and availability. Submitted identity or qualification documents are private review material, not public downloads. Reviews may become public; students and guardians should avoid including a child’s school, contact details or other identifying information in review text.',
        'Booking and financial records include lesson times, participants, prices, credit purchases, wallet and ledger entries, provider references, disputes and payouts. The platform stores tutor bank or wallet details encrypted at the application layer and displays only a limited masked view. Credentials are supplied to authorised reviewers using temporary access links. Security measures reduce risk but cannot guarantee that an incident will never occur.',
      ] },
      { heading: 'Calls, messages and moderation', paragraphs: [
        'Video or voice is transmitted to deliver the lesson. The current classroom does not provide session recording; any future recording requires a separate notice and explicit consent from both parties, plus guardian consent where required. Attendance events record joins, leaves and timing for access control, settlement and disputes. This is different from recording a lesson’s audio or video.',
        'Messages and homework attachments support booked lessons. Contact details are masked in displayed message bodies; the unmasked original remains available to authorised moderators for safety investigations and policy enforcement. Reports, appeals, administrator actions and relevant technical records support those reviews. Moderation is not a promise that every lesson or message is watched live.',
      ] },
      { heading: 'Purposes and legal grounds', paragraphs: [
        'We use necessary account and booking data to provide the agreed marketplace service, financial records for accounting and legal duties, and proportionate security and moderation records to protect users. Where applicable, legitimate interests require a documented balancing assessment that gives particular weight to children. Consent is used where required for optional communications, non-essential tracking or child-data processing. A legal reviewer must confirm each basis by country; this notice does not claim one basis applies everywhere.',
        'The draft policy prohibits selling children’s personal data or using it for behavioural advertising. Guardian approval of tutoring must not be bundled with consent to unrelated marketing. Withdrawing optional consent should be as easy as giving it and does not invalidate earlier lawful processing.',
      ] },
      { heading: 'Children and guardians', paragraphs: [
        'Most intended students are minors, so information and choices must be explained in language they can understand. We must establish the legally required guardian authorisation before the relevant child-data processing or lesson access, not simply collect an email and assume permission. Additional rules may apply to children under 13 in the United States and to consent-based online services for children in European countries, where age thresholds differ.',
        'A guardian may request information about the child’s account, corrections, deletion or withdrawal of consent through the approved privacy contact, subject to appropriate verification and the child’s rights. A separate guardian dashboard is not currently available. If an account lacks a required consent, access and unnecessary processing should be paused while the operator resolves the issue; retention needed to protect the child or comply with law must be explained.',
      ] },
      { heading: 'Service providers and international transfers', paragraphs: [
        'Hosting, database, file-storage, video, authentication, payment and notification providers may process the information needed for their role. Tutors and students can be in different countries, so an online lesson itself can involve an international disclosure. Production vendor identities and storage locations must be confirmed before launch; development mocks are not evidence that a named payment or email provider is live.',
        'Before restricted international transfers, the operator must put required contractual safeguards and assessments in place and explain how users can obtain relevant information. We may disclose limited information to competent authorities where legally required or necessary to address a serious safety concern. We do not publish credential documents, full payout details or private message attachments in search pages or structured data.',
      ] },
      { heading: 'Retention, cookies and your choices', paragraphs: [
        'Raw call-webhook payloads are scheduled for removal after 90 days; the attendance events themselves remain for settlement and dispute evidence. Financial, account, message, credential and safety records need separately approved retention periods based on purpose and legal requirements. The operator must complete that schedule, including backup deletion and legal holds, before this notice is adopted. Closing an account does not automatically erase legally necessary financial records.',
        'The application uses session and security cookies and remembers preferences such as timezone and recently browsed subject. Optional analytics or advertising must not be represented as essential and require an appropriate choice where law demands it. Users may have rights to access, correct, erase, restrict or object to processing, obtain a portable copy, withdraw consent or complain to a relevant authority. Availability depends on applicable law; requests need a working privacy contact and a proportionate verification process before launch.',
      ] },
    ],
  },
  {
    slug: 'refund-policy', title: 'Refund Policy',
    description: 'Draft rules for credit refunds, student and tutor cancellations, no-shows and connection failures.',
    reviewItems: ['Review mandatory local consumer refund rights; a credit-only term cannot remove them.', 'Resolve the extra tutor-no-show session credit, which is signalled by the core but not awarded.', 'Resolve the core’s rounding to whole notice minutes at the 24-hour boundary.'],
    sections: [
      { heading: 'Refunds return as lesson credits', paragraphs: [
        'Credit purchases are non-refundable to cash under the standard Tutorly policy. An approved lesson refund restores credits to the student wallet for another lesson; it is not a withdrawal to a bank account or card. Credits do not expire. This policy does not limit a cash refund or other remedy required by mandatory consumer law, an unauthorised-payment process or a binding decision.',
        'The refund is calculated from the confirmed booking price. A later tutor rate change does not change it. A parent or guardian should review the cost and this policy before approving a minor’s booking. Report an incorrect debit with the booking or purchase reference, never by sending full payment credentials in a message.',
      ] },
      { heading: 'When the student cancels', paragraphs: [
        'More than 24 hours before the scheduled start: all booking credits return to the student and the tutor receives no cancellation earnings.',
        'From exactly 2 hours through exactly 24 hours before the scheduled start: half the booking credits return to the student. The tutor receives their commission-adjusted share of the chargeable half.',
        'Less than 2 hours before the scheduled start: no booking credits return under the standard policy. The tutor receives their commission-adjusted share of the booked price. For a US$20 booking, these tiers ordinarily return 20, 10 or 0 credits respectively. Half-cent calculations follow the core’s whole-cent rounding rule.',
        'Notice is measured against the scheduled start recorded by the platform, not the time a message was sent to a tutor. Use the cancellation control and check its stated result. Exactly 24 hours belongs to the half-refund tier and exactly 2 hours also belongs to the half-refund tier. Review is still required for the current engine’s truncation of notice to whole minutes.',
      ] },
      { heading: 'Tutor cancellation and missed lessons', paragraphs: [
        'When a tutor cancels, the full booking price returns as credits at any notice period. The tutor earns nothing for the cancelled lesson and may receive a strike; three strikes within 90 days trigger review.',
        'A student no-show is charged in full only when the tutor joined and waited at least 10 minutes. If the tutor did not wait long enough, the case is assessed using the attendance and technical-failure rules rather than assumed to be a student no-show.',
        'A tutor no-show returns the full booked price as credits, pays no lesson earnings to the tutor and results in a strike. An additional free-session credit is proposed by the specification, but its value and delivery are unresolved in the current core. This draft must not be adopted as a promise of an automatic extra credit until that benefit is defined and wired.',
      ] },
      { heading: 'Connection problems and disputed quality', paragraphs: [
        'If a qualifying technical failure means both people attended together for less than half the booked duration, the student receives the full booking price as credits. For the first two qualifying failures per student in a rolling 90-day period, the platform covers the tutor’s normal share. Beyond that cap the student still receives the credit refund, but the tutor is not paid under the absorbed-failure policy.',
        'Server attendance records, including reconnections, inform the outcome. A disagreement about lesson quality is reviewed separately: credential verification does not guarantee a grade or that a particular teaching style will suit every student. Use the session’s report or dispute controls promptly, preferably before the 24-hour settlement window closes. Include what went wrong and relevant lesson details, and keep the report appropriate for the student’s privacy. Statutory rights are not extinguished by missing that platform window.',
      ] },
      { heading: 'Trials, rescheduling and the outcome notice', paragraphs: [
        'An optional, tutor-approved free trial has no credit charge to refund. A trial request is not a confirmed lesson until accepted. Rescheduling is a separate process: it can be requested once, more than 12 hours before start, with acceptance required within 6 hours. Until accepted, the original booking stands; an unanswered message does not move it.',
        'The outcome should identify the booking, the reason and the credits restored or retained. If a correction is required, the platform records an adjustment rather than changing payment history silently. The final policy must supply the operator’s working support contact and escalation procedure before publication.',
      ] },
    ],
  },
  {
    slug: 'tutor-agreement', title: 'Tutor Agreement',
    description: 'Draft independent-tutor terms covering teaching, credentials, commission, trials, earnings, payouts and suspension.',
    reviewItems: ['Confirm contractor status, tax treatment and work eligibility by relevant country.', 'Approve a suspension-review timetable and a way to settle undisputed balances below US$100 on permanent closure.', 'Confirm legal operator details, appeal contact and the extra tutor-no-show benefit.'],
    sections: [
      { heading: 'An independent teaching business', paragraphs: [
        'You provide tutoring as an independent contractor, not as an employee, partner or agent of Tutorly. You choose your permitted rates, curriculum claims and published hours and are responsible for your teaching, preparation, equipment, tax reporting and any registration or work permission required where you operate. This description does not override employment or worker rights that mandatory law gives you.',
        'You must be at least 18 and legally able to contract. Do not delegate a booked lesson to another person or permit someone else to use your verified account. The platform handles booking and settlement under the marketplace rules and does not guarantee a volume of students, an income or continuing placement in search.',
      ] },
      { heading: 'Credentials and a truthful public profile', paragraphs: [
        'Submit accurate qualifications and identity information, declare only subjects and curriculum positions you can teach, and keep your profile current. Verification checks submitted material; it does not certify every curriculum claim, guarantee teaching quality or represent an unspecified criminal-record check. Misleading claims can lead to review, removal from discovery or suspension.',
        'You permit the platform to display your approved profile, introduction video and teaching information to promote your services. You retain your rights in your teaching materials and must have permission to upload or share third-party materials. Private credential documents and payout details must not be published as profile content.',
      ] },
      { heading: 'Commission and confirmed prices', paragraphs: [
        'The standard platform commission is 22% on a student’s first paid booking with you, falling to 16% on later bookings once that student has completed a paid session with you. A lower individually agreed commission can apply. Eligibility is determined when the booking is created; booking several lessons before the first one happens does not automatically make all of them rebookings at the lower rate.',
        'At a US$25 lesson price, the standard share is US$19.50 for a new student and US$21.00 for an eligible rebooking, before any disclosed payout fees and your own taxes. The booking stores its price and commission, so later changes do not rewrite an existing booking or settled earnings. Rates and any promotion must follow the platform’s pricing limits.',
      ] },
      { heading: 'Trials, cancellations and attendance', paragraphs: [
        'Free trials are entirely optional and need your acceptance. Choose a supported trial length and weekly cap; a free trial moves no credits and produces no earnings or commission. Do not advertise a free trial and then request an off-platform payment to attend it.',
        'Student cancellation more than 24 hours before start produces no earnings; 2–24 hours produces your share of half the price; under 2 hours produces your share of the full price. A student no-show is chargeable only if you join and wait at least 10 minutes. If you cancel or do not attend, the student receives a full credit refund, you earn nothing for that lesson and a strike may be recorded. Three strikes in 90 days trigger review.',
        'A qualifying technical failure refunds the student in full. The platform pays your normal share for up to two qualifying failures per student in 90 days, absorbing that cost; after the cap, no tutor payment applies to that failure outcome. Use the platform room so server attendance records can support the decision, and raise disputed outcomes through the report or dispute process.',
      ] },
      { heading: 'Earnings and the US$100 payout threshold', paragraphs: [
        'Lesson funds remain subject to the 24-hour dispute window before settlement. Pending earnings are distinct from available earnings. You may request a payout when your available balance reaches US$100, for an eligible amount of at least US$100. The requested amount is locked while the payout proceeds, so it cannot be requested twice.',
        'Payouts require accurate verified bank or supported wallet details and are reviewed manually. A request moves through requested, approved, processing and paid, or is rejected with a reason and returned to available funds. Approval is not confirmation that the transfer has reached your account. A paid reference identifies the transfer; banking delays, currency conversion and any disclosed fee may affect the amount or timing received. No fixed processing deadline is promised in this draft.',
      ] },
      { heading: 'What happens to your balance on suspension', paragraphs: [
        'Suspension does not automatically forfeit earned money. We may hold disputed earnings, pending payouts or amounts reasonably needed for refunds, fraud investigation, chargebacks or a lawful restriction. The hold must be proportionate, its reason and affected amount documented, and a review timetable provided where law and safety permit. A restriction must not be used as an unexplained penalty against all historical earnings.',
        'Undisputed earned funds remain owed, subject to lawful deductions and verification of the receiving account. Pending payout requests must be reviewed individually; a suspension must not silently mark a transfer as paid. After review, the operator must provide a reconciliation of releases, refunds and deductions and a way to appeal. The final closure process, especially release of an undisputed balance below US$100, requires approval and implementation before this agreement is adopted.',
      ] },
      { heading: 'Teaching children and keeping professional boundaries', paragraphs: [
        'Most students are minors. Keep teaching and messages on the platform, communicate in an age-appropriate way, respect guardian arrangements and request only information needed for the lesson. Do not seek secret communication, personal social contact, private meetings or inappropriate content. A child may end a lesson and raise a concern without pressure or retaliation.',
        'Do not record, screenshot or reuse a child’s image, voice or work for promotion without a lawful, specific authorisation and the required guardian consent. Never ask a child to conduct unsupervised hazardous practical work. Report safeguarding concerns promptly through the available reporting route, preserve only necessary platform evidence and cooperate with authorised review. Follow the Child Safety Policy, including emergency escalation where appropriate.',
      ] },
    ],
  },
  {
    slug: 'child-safety', title: 'Child Safety Policy',
    description: 'Draft safeguarding expectations for children, guardians and tutors using live online lessons and messaging.',
    reviewItems: ['Appoint a safeguarding lead, working reporting contact and escalation coverage before launch.', 'Implement and verify the required guardian-consent and child-age controls; the current email field is not sufficient proof.', 'Approve incident response, retention and referrals with counsel in the countries served.'],
    sections: [
      { heading: 'Children come first', paragraphs: [
        'Most students expected to use Tutorly are under 18. Their safety is part of arranging a lesson, not an optional add-on. This policy applies to tutors, students, guardians and platform staff during profiles, trials, lessons, messages and reviews. A child should be able to ask for help, stop an uncomfortable interaction and report a concern without punishment or pressure to continue.',
        'For students: you do not have to share personal contact details, agree to a secret conversation or stay in a lesson that feels uncomfortable. Leave the call if you need to, tell a trusted adult and use the reporting controls. You do not need to investigate or prove everything before asking for help.',
      ] },
      { heading: 'Guardian involvement and consent', paragraphs: [
        'A parent or legal guardian should approve the tutor, lesson arrangements and spending, know when lessons happen and be available to support the child. Accurate age information matters. The operator must obtain and document the guardian authorisation required for the child’s age and country before permitting the relevant processing or lesson access.',
        'The current product records an under-18 answer and collects a guardian email before booking; it does not yet offer a separate guardian dashboard or a complete verifiable-consent workflow. An email address is not proof of consent. Those gaps must be resolved for the intended age groups and countries before launch; this draft is not evidence that the software already enforces the policy.',
      ] },
      { heading: 'Tutor screening and conduct', paragraphs: [
        'Tutors must be adults, use their own verified identity and provide accurate credentials. The platform reviews submitted documents but does not guarantee teaching quality, safety in every interaction or a criminal-record check that has not been explicitly performed. Ongoing reports and supervision arrangements remain necessary even when a profile is verified.',
        'Keep a professional educational relationship. No bullying, discriminatory treatment, humiliating comments, requests for secrecy, inappropriate personal content or retaliation for a report. Do not invite a child to personal social accounts, off-platform calls or private meetings. Never ask for information about a child’s address, school routine or family finances unless a clearly necessary, approved purpose has been established.',
      ] },
      { heading: 'Lessons, learning materials and privacy', paragraphs: [
        'Use the platform classroom and lesson thread. Choose age-appropriate materials and allow the child to ask questions, take a pause or seek a guardian’s help. Practical science work must remain in an appropriately supervised setting; tutors must not direct hazardous home experiments. Academic support should build understanding rather than complete an assessment dishonestly for the student.',
        'There is no platform lesson-recording feature in the current classroom. Neither party should make a private recording or reuse a child’s image, voice or work without specific lawful authorisation and required guardian consent. Avoid sharing child identifiers in public reviews. Keep reports factual and limited to what the reviewer needs; do not circulate sensitive evidence to other students or tutors.',
      ] },
      { heading: 'Reporting a concern', paragraphs: [
        'For an immediate threat, leave the interaction, contact a trusted adult and use local emergency services where needed. Tutorly reporting is not an emergency service and there is no promise of live monitoring or an immediate reply.',
        'Use the report control on a tutor profile, message or session when available. Include the relevant profile or booking, approximate time, what happened and whether a guardian has been told. Do not forward sensitive material to a personal email or gather additional evidence through private contact. A guardian who cannot access a report needs a public safeguarding contact; the operator must publish and staff that channel before adopting this policy.',
      ] },
      { heading: 'How concerns should be handled', paragraphs: [
        'The safeguarding lead should triage the report, assess immediate protective steps and preserve necessary platform records with restricted access. Staff must use a documented referral process for competent authorities where required and seek specialist advice for cross-border incidents. Information should be shared only with people who need it for protection, investigation or a legal duty; absolute confidentiality cannot be promised.',
        'Proportionate steps may include stopping contact, restricting new bookings or suspending an account while the concern is reviewed. Tell the child and guardian what they need to stay safe without exposing another child’s information or compromising a review. Give reasons and an appeal route where lawful and compatible with safety. Any financial hold must follow the Tutor Agreement: suspension alone does not confiscate earned balances.',
      ] },
      { heading: 'Accountability and review', paragraphs: [
        'The operator must designate responsibility, train reviewers, record decisions and review repeated concerns across accounts. Consent checks, response arrangements, retention periods and incident escalation must be tested before being described as live protections. The final policy must display its effective date, named operator and accessible safety contact and be reviewed when services, vendors or countries change.',
      ] },
    ],
  },
] as const satisfies readonly LegalPolicy[];
