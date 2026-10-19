import type { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import UserModel from '../models/User.js';
import RefreshTokenModel from '../models/RefreshToken.js';
import { createRefreshTokenHash, createTokenFamily, signAccessToken, signRefreshToken } from '../services/authService.js';
import env from '../config/env.js';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'USER']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function buildAuthResponse(user: { id: string; email: string; role: 'ADMIN' | 'USER'; name: string }) {
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const refreshToken = signRefreshToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

export async function registerUser(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid registration payload', errors: parsed.error.flatten() });
  }

  const { name, email, password, role } = parsed.data;

  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'User already exists' });
  }

  const createdUser = await UserModel.create({
    name,
    email,
    passwordHash: password,
    role: role ?? 'USER',
  });

  const authResponse = buildAuthResponse({
    id: createdUser._id.toString(),
    email: createdUser.email,
    role: createdUser.role as 'ADMIN' | 'USER',
    name: createdUser.name,
  });

  const family = createTokenFamily();
  await RefreshTokenModel.create({
    userId: createdUser._id,
    tokenHash: createRefreshTokenHash(authResponse.refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    family,
  });

  return res.status(201).json({ success: true, data: authResponse });
}

export async function loginUser(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid login payload' });
  }

  const { email, password } = parsed.data;
  const user = await UserModel.findOne({ email });

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const validPassword = await user.comparePassword(password);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const authResponse = buildAuthResponse({
    id: user._id.toString(),
    email: user.email,
    role: user.role as 'ADMIN' | 'USER',
    name: user.name,
  });

  const family = createTokenFamily();
  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: createRefreshTokenHash(authResponse.refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    family,
  });

  return res.status(200).json({ success: true, data: authResponse });
}

export async function refreshUserToken(req: Request, res: Response) {
  const parsed = refreshSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid refresh payload' });
  }

  const { refreshToken } = parsed.data;

  try {
    const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { id: string; email: string; role: 'ADMIN' | 'USER' };
    const storedToken = await RefreshTokenModel.findOne({
      userId: payload.id,
      tokenHash: createRefreshTokenHash(refreshToken),
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!storedToken) {
      return res.status(401).json({ success: false, message: 'Refresh token revoked or expired' });
    }

    const user = await UserModel.findById(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const authResponse = buildAuthResponse({
      id: user._id.toString(),
      email: user.email,
      role: user.role as 'ADMIN' | 'USER',
      name: user.name,
    });

    await RefreshTokenModel.findByIdAndUpdate(storedToken._id, { revoked: true });
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: createRefreshTokenHash(authResponse.refreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      family: String(storedToken.family || 'default'),
    });

    return res.status(200).json({ success: true, data: authResponse });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
}

export async function logoutUser(req: Request, res: Response) {
  const { refreshToken }: { refreshToken?: string } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required' });
  }

  await RefreshTokenModel.updateOne(
    { tokenHash: createRefreshTokenHash(refreshToken) },
    { revoked: true },
  );

  return res.status(200).json({ success: true, message: 'Logged out successfully' });
}

export async function getCurrentUser(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  const user = await UserModel.findById(req.user.id).select('-passwordHash');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  return res.status(200).json({
    success: true,
    data: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}
