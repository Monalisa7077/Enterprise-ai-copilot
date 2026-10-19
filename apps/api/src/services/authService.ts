import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export type AuthTokenPayload = {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
};

export function signAccessToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function createRefreshTokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createTokenFamily() {
  return crypto.randomUUID();
}
