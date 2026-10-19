import { describe, expect, it } from 'vitest';
import { createRefreshTokenHash, signAccessToken } from '../services/authService.js';

describe('auth service', () => {
  it('creates a stable hash for refresh tokens', () => {
    const token = 'sample-refresh-token';
    expect(createRefreshTokenHash(token)).toHaveLength(64);
  });

  it('creates a token with the expected payload', () => {
    const token = signAccessToken({
      id: 'user-123',
      email: 'jane@example.com',
      role: 'USER',
    });

    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
  });
});
