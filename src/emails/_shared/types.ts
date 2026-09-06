export type EmailBaseProps = {
  recipientName: string;
  supportUrl: string;
  privacyUrl: string;
};
export type OptionalEmailProps = EmailBaseProps & {
  preferencesUrl: string;
  unsubscribeUrl: string;
};
export type LessonProps = {
  bookingId: string;
  counterpartName: string;
  subjectName: string;
  /** Absolute instant (Z or numeric offset), supplied by the notification owner. */
  startsAt: string;
  /** Recipient's IANA timezone, never inferred from the rendering server. */
  timezone: string;
  durationMinutes: number;
  bookingUrl: string;
};
export type EmailContent = {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: readonly string[];
  details?: readonly (readonly [string, string])[];
  action: { label: string; href: string };
};
