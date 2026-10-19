import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError('Route not found', 404));
}

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  const statusCode =
    error instanceof AppError
      ? error.statusCode
      : error instanceof multer.MulterError
        ? error.code === 'LIMIT_FILE_SIZE'
          ? 413
          : 400
        : 500;
  const message = error.message || 'Something went wrong';

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
}
