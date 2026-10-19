export function sanitizeErrorText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
    .replace(/((?:redis|rediss|mongodb(?:\+srv)?|https?):\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(
      /\b((?:(?:OPENAI|GEMINI)_API_KEY|(?:api[_-]?key|password|passwd|token|secret))\s*[:=]\s*)[^\s,;)'"]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /([?&](?:api[_-]?key|password|passwd|token|secret)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    );
}

export function startupErrorDetails(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error) {
    return {
      error: sanitizeErrorText(`${error.name}: ${error.message}`),
      ...(error.stack ? { stack: sanitizeErrorText(error.stack) } : {}),
    };
  }

  return { error: sanitizeErrorText(String(error)) };
}
