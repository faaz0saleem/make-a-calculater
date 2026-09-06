import * as React from 'react';
import type { EmailBaseProps, EmailContent, OptionalEmailProps } from './types';
import { safeUrl, subjectLine } from './format';

const paragraph: React.CSSProperties = { fontSize: '16px', lineHeight: '26px', margin: '0 0 18px', overflowWrap: 'anywhere' };
const link: React.CSSProperties = { color: '#304bb0', textDecoration: 'underline' };
function preferences(props: EmailBaseProps): Partial<Pick<OptionalEmailProps, 'preferencesUrl' | 'unsubscribeUrl'>> {
  return props as Partial<OptionalEmailProps>;
}

/** Native email-safe React HTML, renderable by React Email/Resend.
 * No dependency changes, hooks, network calls, environment or application imports.
 */
export function EmailLayout({ props, content }: { props: EmailBaseProps; content: EmailContent }) {
  const optional = preferences(props);
  return <html lang="en" dir="ltr"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{content.subject}</title></head>
    <body lang="en" dir="ltr" style={{ margin: 0, padding: '24px 12px', backgroundColor: '#f4f5f9', fontFamily: 'Arial, Helvetica, sans-serif', color: '#20283d' }}>
      <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden', opacity: 0, fontSize: '1px', lineHeight: '1px' }}>{content.preheader}</div>
      <table role="presentation" width="100%" cellPadding="0" cellSpacing="0"><tbody><tr><td align="center">
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ maxWidth: '600px', backgroundColor: '#ffffff', border: '1px solid #dce0eb', borderRadius: '12px' }}><tbody><tr><td style={{ padding: '32px 24px' }}>
          <p style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 700, color: '#304bb0' }}>Tutorly.</p>
          <h1 style={{ margin: '0 0 22px', fontSize: '28px', lineHeight: '36px', fontWeight: 700 }}>{content.heading}</h1>
          <p style={paragraph}>Hello {props.recipientName},</p>
          {content.paragraphs.map((text, index) => <p key={index} style={paragraph}>{text}</p>)}
          {content.details && <table width="100%" cellPadding="0" cellSpacing="0" style={{ margin: '24px 0', fontSize: '14px', borderCollapse: 'collapse', tableLayout: 'fixed' }}><tbody>{content.details.map(([label, value]) => <tr key={label}><th scope="row" style={{ width: '30%', textAlign: 'left', padding: '10px 8px 10px 0', verticalAlign: 'top', borderBottom: '1px solid #dce0eb' }}>{label}</th><td style={{ padding: '10px 0', lineHeight: '22px', overflowWrap: 'anywhere', borderBottom: '1px solid #dce0eb' }}>{value}</td></tr>)}</tbody></table>}
          <table role="presentation" cellPadding="0" cellSpacing="0" style={{ margin: '26px 0' }}><tbody><tr><td style={{ backgroundColor: '#304bb0', borderRadius: '6px' }}><a href={safeUrl(content.action.href)} style={{ display: 'inline-block', padding: '14px 22px', fontWeight: 700, fontSize: '16px', lineHeight: '22px', color: '#ffffff', textDecoration: 'none' }}>{content.action.label}</a></td></tr></tbody></table>
          <p style={{ ...paragraph, fontSize: '13px', lineHeight: '21px' }}>If the button does not open, use this link:<br /><a style={{ ...link, overflowWrap: 'anywhere' }} href={safeUrl(content.action.href)}>{safeUrl(content.action.href)}</a></p>
          <hr style={{ margin: '24px 0', border: 0, borderTop: '1px solid #dce0eb' }} />
          <p style={{ fontSize: '12px', lineHeight: '20px', color: '#505b72' }}>Keep lesson conversations and payments on Tutorly. Never send passwords or full payment details by email.</p>
          <p style={{ fontSize: '12px', lineHeight: '22px' }}><a style={link} href={safeUrl(props.supportUrl)}>Help</a>{' · '}<a style={link} href={safeUrl(props.privacyUrl)}>Privacy</a>{optional.preferencesUrl && <>{' · '}<a style={link} href={safeUrl(optional.preferencesUrl)}>Email preferences</a></>}{optional.unsubscribeUrl && <>{' · '}<a style={link} href={safeUrl(optional.unsubscribeUrl)}>Unsubscribe from this notification</a></>}</p>
        </td></tr></tbody></table>
      </td></tr></tbody></table>
    </body></html>;
}

export function contentToText(props: EmailBaseProps, content: EmailContent): string {
  const optional = preferences(props);
  return [
    'Tutorly', '', content.heading, '', `Hello ${props.recipientName},`, '',
    ...content.paragraphs.flatMap((text) => [text, '']),
    ...(content.details ?? []).map(([label, value]) => `${label}: ${value}`), '',
    `${content.action.label}: ${safeUrl(content.action.href)}`, '',
    'Keep lesson conversations and payments on Tutorly. Never send passwords or full payment details by email.',
    `Help: ${safeUrl(props.supportUrl)}`, `Privacy: ${safeUrl(props.privacyUrl)}`,
    ...(optional.preferencesUrl ? [`Email preferences: ${safeUrl(optional.preferencesUrl)}`] : []),
    ...(optional.unsubscribeUrl ? [`Unsubscribe from this notification: ${safeUrl(optional.unsubscribeUrl)}`] : []), '',
  ].join('\n');
}

export function defineEmail<Props extends EmailBaseProps>(name: string, content: (props: Props) => EmailContent) {
  const Component = (props: Props) => <EmailLayout props={props} content={content(props)} />;
  Component.displayName = name;
  return Object.assign(Component, {
    plainText: (props: Props) => contentToText(props, content(props)),
    subject: (props: Props) => subjectLine(content(props).subject),
  });
}
