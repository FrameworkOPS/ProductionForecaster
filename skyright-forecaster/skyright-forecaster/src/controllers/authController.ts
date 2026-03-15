import { Request, Response } from 'express';
import { query } from '../config/database';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';

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
  const { v4: uuidv4 } = await import('uuid');
  const userId = uuidv4();
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
