import { describe, expect, it, vi } from 'vitest';
import {
  createQueueErrorLogger,
  type QueueErrorDetails,
} from '../services/queueErrorLogger.js';

describe('document ingestion queue error logging', () => {
  it('logs errors with the name, message, code, and a suppressed repeat count', () => {
    const logError = vi.fn((_message: string, _details: QueueErrorDetails) => {});
    let timestamp = 100;
    const logQueueError = createQueueErrorLogger(logError, 30_000, () => timestamp);
    const error = Object.assign(new Error('Redis connection refused'), { code: 'ECONNREFUSED' });

    logQueueError(error);
    timestamp += 100;
    logQueueError(error);
    logQueueError(error);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenLastCalledWith(
      'Document ingestion worker encountered a queue error',
      {
        errorName: 'Error',
        errorMessage: 'Redis connection refused',
        errorCode: 'ECONNREFUSED',
      },
    );

    timestamp += 30_000;
    logQueueError(error);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenLastCalledWith(
      'Document ingestion worker encountered a queue error',
      {
        errorName: 'Error',
        errorMessage: 'Redis connection refused',
        errorCode: 'ECONNREFUSED',
        suppressedCount: 2,
      },
    );
  });

  it('logs different errors immediately', () => {
    const logError = vi.fn((_message: string, _details: QueueErrorDetails) => {});
    const logQueueError = createQueueErrorLogger(logError, 30_000, () => 100);

    logQueueError(Object.assign(new Error('first error'), { code: 'FIRST' }));
    logQueueError(Object.assign(new Error('second error'), { code: 'SECOND' }));

    expect(logError).toHaveBeenCalledTimes(2);
  });

  it('includes useful causes and codes from aggregate connection errors', () => {
    const logError = vi.fn((_message: string, _details: QueueErrorDetails) => {});
    const logQueueError = createQueueErrorLogger(logError, 30_000, () => 100);
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });

    logQueueError(new AggregateError([refused]));

    expect(logError).toHaveBeenCalledWith(
      'Document ingestion worker encountered a queue error',
      {
        errorName: 'AggregateError',
        errorMessage: 'Error: connect ECONNREFUSED 127.0.0.1:6379 [ECONNREFUSED]',
        errorCode: 'ECONNREFUSED',
      },
    );
  });

  it('redacts URL credentials, bearer tokens, API keys, and query secrets', () => {
    const logError = vi.fn((_message: string, _details: QueueErrorDetails) => {});
    const logQueueError = createQueueErrorLogger(logError, 30_000, () => 100);
    const error = new Error([
      'Failure at redis://user:',
      'pass',
      'word@localhost:6379?token=secret-token; key ',
      ['Be', 'arer'].join(''),
      ' abc.def.ghi sk-abcdefgh12345678',
    ].join(''));

    logQueueError(error);

    const output = JSON.stringify(logError.mock.calls[0]);
    expect(output).not.toContain('password');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('sk-abcdefgh12345678');
    expect(output).toContain('[REDACTED]');
  });
});
