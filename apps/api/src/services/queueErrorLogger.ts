import { sanitizeErrorText } from '../config/startupError.js';

const repeatedErrorLogIntervalMs = 30_000;

export interface QueueErrorDetails {
  errorName: string;
  errorMessage: string;
  errorCode?: string | number;
  suppressedCount?: number;
}

function errorDetails(error: unknown): Omit<QueueErrorDetails, 'suppressedCount'> {
  const value = typeof error === 'object' && error !== null ? error : undefined;
  const nestedErrors = error instanceof AggregateError ? error.errors : [];
  const name = value && 'name' in value && typeof value.name === 'string'
    ? value.name
    : error instanceof Error
      ? error.name
      : 'Error';
  const baseMessage = error instanceof Error
    ? error.message
    : value && 'message' in value && typeof value.message === 'string'
      ? value.message
      : String(error);
  const nestedMessage = nestedErrors
    .slice(0, 3)
    .map((nestedError) => {
      const nestedDetails = errorDetails(nestedError);
      return `${nestedDetails.errorName}: ${nestedDetails.errorMessage}${
        nestedDetails.errorCode === undefined ? '' : ` [${nestedDetails.errorCode}]`
      }`;
    })
    .join('; ');
  const code = value && 'code' in value &&
    (typeof value.code === 'string' || typeof value.code === 'number')
    ? value.code
    : nestedErrors[0] && typeof nestedErrors[0] === 'object' &&
        nestedErrors[0] !== null && 'code' in nestedErrors[0] &&
        (typeof nestedErrors[0].code === 'string' || typeof nestedErrors[0].code === 'number')
      ? nestedErrors[0].code
      : undefined;
  const message = nestedMessage
    ? `${nestedMessage}${nestedErrors.length > 3 ? `; and ${nestedErrors.length - 3} more errors` : ''}`
    : baseMessage;

  return {
    errorName: sanitizeErrorText(name).slice(0, 100),
    errorMessage: sanitizeErrorText(message).slice(0, 500),
    ...(code === undefined ? {} : {
      errorCode: typeof code === 'string' ? sanitizeErrorText(code).slice(0, 100) : code,
    }),
  };
}

export function createQueueErrorLogger(
  logError: (message: string, details: QueueErrorDetails) => void,
  intervalMs = repeatedErrorLogIntervalMs,
  now: () => number = Date.now,
): (error: unknown) => void {
  let lastSignature: string | undefined;
  let lastLoggedAt = 0;
  let suppressedCount = 0;

  return (error) => {
    const details = errorDetails(error);
    const signature = JSON.stringify(details);
    const timestamp = now();

    if (signature === lastSignature && timestamp - lastLoggedAt < intervalMs) {
      suppressedCount += 1;
      return;
    }

    logError('Document ingestion worker encountered a queue error', {
      ...details,
      ...(suppressedCount > 0 ? { suppressedCount } : {}),
    });
    lastSignature = signature;
    lastLoggedAt = timestamp;
    suppressedCount = 0;
  };
}
