import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';

interface AcceptInviteRequest {
  token: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

interface LoginRequest {
  email: string;
  password: string;
}

export const register = asyncHandler(async (req: Request<{}, {}, RegisterRequest>, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Check if user already exists
  const result = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (result.rows.length > 0) {
    throw new AppError('User with this email already exists', 409);
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const userId = randomUUID();
  await query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, email, passwordHash, firstName || null, lastName || null, 'viewer']
  );

  // Generate token
  const token = generateToken({
    userId,
    email,
    role: 'viewer',
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    token,
    user: {
      id: userId,
      email,
      firstName,
      lastName,
      role: 'viewer',
    },
  });
});

export const login = asyncHandler(async (req: Request<{}, {}, LoginRequest>, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user
  const result = await query('SELECT id, email, password_hash, role FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    throw new AppError('Invalid credentials', 401);
  }

  const user = result.rows[0];

  // Compare password
  const isValidPassword = await comparePassword(password, user.password_hash);
  if (!isValidPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate token
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  res.json({
    success: true,
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
});

// ── Invitation acceptance (public) ─────────────────────────────────────────

// Validate an invite token and return who it's for (so the set-password page can greet them).
export const getInvite = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const result = await query(
    'SELECT email, first_name, last_name, role, invite_expires FROM users WHERE invite_token = $1',
    [token]
  );
  const u = result.rows[0];
  if (!u) {
    throw new AppError('Invalid or already-used invitation', 404);
  }
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) {
    throw new AppError('This invitation has expired. Ask an admin to resend it.', 410);
  }
  res.json({
    success: true,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
  });
});

// Set the password for an invited user, activate them, and log them in.
export const acceptInvite = asyncHandler(
  async (req: Request<{}, {}, AcceptInviteRequest>, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) {
      throw new AppError('token and password are required', 400);
    }
    if (String(password).length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    const result = await query('SELECT * FROM users WHERE invite_token = $1', [token]);
    const u = result.rows[0];
    if (!u) {
      throw new AppError('Invalid or already-used invitation', 400);
    }
    if (u.invite_expires && new Date(u.invite_expires) < new Date()) {
      throw new AppError('This invitation has expired. Ask an admin to resend it.', 410);
    }

    const hash = await hashPassword(password);
    await query(
      `UPDATE users SET password_hash = $1, active = true, invite_token = NULL,
         invite_expires = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hash, u.id]
    );

    const token2 = generateToken({ userId: u.id, email: u.email, role: u.role });
    res.json({
      success: true,
      message: 'Account activated',
      token: token2,
      user: { id: u.id, email: u.email, role: u.role },
    });
  }
);

export const getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const result = await query(
    'SELECT id, email, first_name, last_name, role, created_at FROM users WHERE id = $1',
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = result.rows[0];
  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      createdAt: user.created_at,
    },
  });
});
