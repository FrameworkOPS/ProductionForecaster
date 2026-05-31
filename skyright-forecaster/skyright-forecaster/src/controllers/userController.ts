import { Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';
import { hashPassword } from '../utils/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { sendInvitationEmail, isEmailConfigured } from '../services/emailService';

const VALID_ROLES = ['admin', 'manager', 'scheduler', 'viewer'];

function appUrl(): string {
  return (
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    'https://productionforecaster-production.up.railway.app'
  );
}

function makeInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const roleLabel: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  scheduler: 'Scheduler',
  viewer: 'Viewer',
};

export const getUsers = asyncHandler(async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT id, email, first_name, last_name, role, active, created_at,
            (invite_token IS NOT NULL) AS invited
     FROM users
     ORDER BY first_name, last_name`
  );
  res.json({ success: true, users: result.rows });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, first_name, last_name, role, active, invite } = req.body;
  const wantsInvite = invite === true || invite === 'true';

  if (!email) {
    throw new AppError('email is required', 400);
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [
    email.trim(),
  ]);
  if (existing.rows.length > 0) {
    throw new AppError('A user with that email already exists', 409);
  }

  let passwordHash: string;
  let inviteToken: string | null = null;
  let inviteExpires: Date | null = null;
  let isActive: boolean;

  if (wantsInvite) {
    // Invited users get an unusable random password + are inactive until they accept.
    passwordHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
    inviteToken = makeInviteToken();
    inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    isActive = false;
  } else {
    if (!password) {
      throw new AppError('password is required (or set invite: true to send an invitation)', 400);
    }
    if (String(password).length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }
    passwordHash = await hashPassword(password);
    isActive = active !== false;
  }

  const result = await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, active, invite_token, invite_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, email, first_name, last_name, role, active, created_at, (invite_token IS NOT NULL) AS invited`,
    [
      email.toLowerCase().trim(),
      passwordHash,
      first_name || '',
      last_name || '',
      role || 'viewer',
      isActive,
      inviteToken,
      inviteExpires,
    ]
  );
  const user = result.rows[0];

  let email_warning: string | undefined;
  if (wantsInvite) {
    if (!isEmailConfigured()) {
      email_warning =
        'User created, but email is not configured (set SMTP_USER / SMTP_PASS on the server). Use "Resend Invite" once email works.';
    } else {
      try {
        const inviteUrl = `${appUrl()}/set-password?token=${inviteToken}`;
        await sendInvitationEmail({
          to: user.email,
          firstName: user.first_name,
          inviteUrl,
          roleName: roleLabel[user.role] || user.role,
          appUrl: appUrl(),
        });
      } catch (e) {
        email_warning = `User created, but the invitation email failed to send: ${(e as Error).message}`;
      }
    }
  }

  res.status(201).json({ success: true, user, email_warning });
});

// Re-send (or send) an invitation email with a fresh token — admin only.
export const resendInvite = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  const u = result.rows[0];
  if (!u) {
    throw new AppError('User not found', 404);
  }
  if (!isEmailConfigured()) {
    throw new AppError('Email is not configured (set SMTP_USER / SMTP_PASS on the server).', 400);
  }

  const inviteToken = makeInviteToken();
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    'UPDATE users SET invite_token = $1, invite_expires = $2, active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [inviteToken, inviteExpires, id]
  );

  const inviteUrl = `${appUrl()}/set-password?token=${inviteToken}`;
  await sendInvitationEmail({
    to: u.email,
    firstName: u.first_name,
    inviteUrl,
    roleName: roleLabel[u.role] || u.role,
    appUrl: appUrl(),
  });

  res.json({ success: true, message: 'Invitation re-sent' });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { email, password, first_name, last_name, role, active } = req.body;

  if (role && !VALID_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  const existing = await query('SELECT id FROM users WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (email !== undefined)      { sets.push(`email = $${p++}`);      values.push(email.toLowerCase().trim()); }
  if (first_name !== undefined) { sets.push(`first_name = $${p++}`); values.push(first_name); }
  if (last_name !== undefined)  { sets.push(`last_name = $${p++}`);  values.push(last_name); }
  if (role !== undefined)       { sets.push(`role = $${p++}`);       values.push(role); }
  if (active !== undefined)     { sets.push(`active = $${p++}`);     values.push(active); }
  if (password) {
    const hash = await hashPassword(password);
    sets.push(`password_hash = $${p++}`);
    values.push(hash);
  }

  if (sets.length === 0) {
    throw new AppError('No fields provided to update', 400);
  }

  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, email, first_name, last_name, role, active, created_at, (invite_token IS NOT NULL) AS invited`,
    values
  );

  res.json({ success: true, user: result.rows[0] });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (req.user && req.user.userId === id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const existing = await query('SELECT id FROM users WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  await query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ success: true, message: 'User deleted' });
});
