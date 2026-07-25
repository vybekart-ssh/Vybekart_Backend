import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  VybeKartMailBranding,
} from './vybekart-email-layout';

export type WelcomeEmailRole = 'buyer' | 'seller';

export interface BuildWelcomeEmailParams {
  firstName: string;
  role: WelcomeEmailRole;
  recipientEmail: string;
  branding: VybeKartMailBranding;
}

/** Soothing, low-pressure welcome copy — different tone for shoppers vs seller partners. */
function welcomeCopy(role: WelcomeEmailRole): {
  headerBadge: string;
  headerTitle: string;
  headerSubtitle: string;
  intro: string;
  points: string[];
  ctaLabel: string;
} {
  if (role === 'seller') {
    return {
      headerBadge: 'Seller partner',
      headerTitle: 'Welcome to Vybekart Seller Partner',
      headerSubtitle: 'Your store journey starts here',
      intro:
        "We're delighted to have you on board. Your application is now with our team, and we'll take it from here — no need to do anything else right now.",
      points: [
        'Our team reviews new seller partners within ~24 hours.',
        'Once approved, you can list products and go live to start selling.',
        "We'll keep you posted by email as your application moves forward.",
      ],
      ctaLabel: 'Open the Vybekart Seller Partner app to track your status.',
    };
  }
  return {
    headerBadge: 'Welcome',
    headerTitle: 'Welcome to Vybekart',
    headerSubtitle: 'Shop live. Discover more. Just Vybe it.',
    intro:
      "We're so glad you're here. Your account is ready, and a whole world of live shopping, curated stores, and everyday deals is just a tap away.",
    points: [
      'Discover trending products from live shows and top sellers.',
      'Save your favourite items and follow sellers you love.',
      'Enjoy a smooth, secure checkout every time you shop.',
    ],
    ctaLabel: 'Open the Vybekart app and start exploring.',
  };
}

export function buildWelcomeEmail(
  params: BuildWelcomeEmailParams,
): { subject: string; html: string; text: string } {
  const { firstName, role, recipientEmail, branding } = params;
  const name = (firstName || '').trim() || 'there';
  const copy = welcomeCopy(role);

  const subject =
    role === 'seller'
      ? `Welcome to Vybekart Seller Partner, ${name}!`
      : `Welcome to Vybekart, ${name}!`;

  const pointsHtml = copy.points
    .map(
      (p) =>
        `<li style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#334155;">${escapeHtml(p)}</li>`,
    )
    .join('');

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.55;">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.55;">${escapeHtml(copy.intro)}</p>
    <ul style="margin:0 0 22px;padding-left:20px;">${pointsHtml}</ul>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;margin-bottom:22px;">
      <tr><td style="padding:16px 18px;text-align:center;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#0B1E5B;line-height:1.5;">${escapeHtml(copy.ctaLabel)}</p>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">If you have any questions, we're always happy to help at <a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#1565C0;font-weight:600;">${escapeHtml(branding.supportEmail)}</a>.</p>
  `;

  const html = buildVybeKartMailShellHtml({
    branding,
    recipientEmail,
    headerBadge: copy.headerBadge,
    headerTitle: copy.headerTitle,
    headerSubtitle: copy.headerSubtitle,
    bodyHtml,
    whyReceivedHtml:
      role === 'seller'
        ? 'You submitted a seller partner registration on Vybekart and this welcome note was sent to your registered email.'
        : 'You created a Vybekart account and this welcome note was sent to your registered email.',
  });

  const text = [
    `Hi ${name},`,
    '',
    copy.intro,
    '',
    ...copy.points.map((p) => `- ${p}`),
    '',
    copy.ctaLabel,
    '',
    `Need help? Email ${branding.supportEmail}`,
  ].join('\n');

  return { subject, html, text };
}
