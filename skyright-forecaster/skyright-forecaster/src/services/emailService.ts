import nodemailer from 'nodemailer';

/**
 * Email service (Gmail SMTP). Mirrors the FrameworkOPS KPI Dashboard setup.
 * Requires SMTP_USER + SMTP_PASS (a Google App Password, NOT the account
 * password) and optionally SMTP_FROM / SMTP_HOST / SMTP_PORT.
 */
function getTransporter() {
  // Default to Gmail; auto-correct the common "smpt." typo.
  let host = process.env.SMTP_HOST || 'smtp.gmail.com';
  if (/^smpt\./i.test(host)) host = host.replace(/^smpt\./i, 'smtp.');
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP_USER and SMTP_PASS environment variables are required');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

const APP_URL_DEFAULT = 'https://productionforecaster-production.up.railway.app';

export interface InvitationOptions {
  to: string;
  firstName?: string | null;
  inviteUrl: string;
  roleName?: string | null;
  appUrl?: string;
}

export async function sendInvitationEmail(opts: InvitationOptions): Promise<void> {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const appUrl = opts.appUrl || APP_URL_DEFAULT;
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : 'Hi,';
  const roleLine = opts.roleName
    ? `<p style="margin:0 0 8px;color:#94a3b8;font-size:14px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${opts.roleName}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    <div style="background:#1d4ed8;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">You're invited 🎉</h1>
    </div>
    <div style="padding:28px 32px;">
      ${roleLine}
      <p style="margin:0 0 16px;color:#f1f5f9;font-size:16px;">${greeting}</p>
      <p style="margin:0 0 20px;color:#cbd5e1;font-size:14px;line-height:1.6;">
        You've been invited to join the <strong>Skyright Production Forecaster</strong>. Click below to set your
        password and activate your account.
      </p>
      <p style="margin:24px 0;">
        <a href="${opts.inviteUrl}" style="display:inline-block;background:#3b82f6;color:#fff;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
          Set Password &amp; Join
        </a>
      </p>
      <p style="margin:0 0 4px;color:#64748b;font-size:12px;">Or paste this link into your browser:</p>
      <a href="${opts.inviteUrl}" style="color:#60a5fa;font-size:12px;word-break:break-all;">${opts.inviteUrl}</a>
      <p style="margin:24px 0 0;color:#64748b;font-size:13px;">This invitation link expires in 7 days.</p>
    </div>
    <div style="padding:16px 32px;background:#0f172a;border-top:1px solid #1e293b;">
      <p style="margin:0;color:#475569;font-size:12px;">Skyright Production Forecaster · <a href="${appUrl}" style="color:#475569;">${appUrl.replace(/^https?:\/\//, '')}</a></p>
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from,
    to: opts.to,
    subject: "You're invited to the Skyright Production Forecaster",
    html,
  });
}
