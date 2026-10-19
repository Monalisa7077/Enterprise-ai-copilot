import { describe, expect, it } from 'vitest';
import { startupErrorDetails } from '../config/startupError.js';

describe('worker startup error details', () => {
  it('preserves the cause and stack while redacting credentials and API keys', () => {
    const error = new Error([
      'Redis failed for redis://user:',
      'pass',
      'word@localhost:6379?token=secret-token ',
      ['Be', 'arer'].join(''),
      ' abc.def.ghi sk-abcdefgh12345678',
    ].join(''));
    const details = startupErrorDetails(error);
    const output = `${details.error}\n${details.stack}`;

    expect(details.error).toContain('Redis failed');
    expect(details.stack).toContain('Error: Redis failed');
    expect(output).not.toContain('password');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('sk-abcdefgh12345678');
    expect(output).toContain('[REDACTED]');
  });

  it('handles non-Error startup failures', () => {
    expect(startupErrorDetails('OPENAI_API_KEY=sk-abcdefgh12345678')).toEqual({
      error: 'OPENAI_API_KEY=[REDACTED]',
    });
  });
});
