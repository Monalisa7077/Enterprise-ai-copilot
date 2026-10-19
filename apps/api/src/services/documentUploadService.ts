import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';
import { AppError } from '../middleware/error.js';

const maxUploadSize = 10 * 1024 * 1024;
const uploadDirectory = path.resolve(env.UPLOAD_DIR);

const supportedTypes = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
} as const;

export interface ValidatedUpload {
  fileName: string;
  extension: keyof typeof supportedTypes;
  mimeType: (typeof supportedTypes)[keyof typeof supportedTypes];
}

export function validateUpload(file: Express.Multer.File): ValidatedUpload {
  if (file.size === 0 || file.size > maxUploadSize) {
    throw new AppError('File must be between 1 byte and 10 MB', 400);
  }

  const fileName = path.basename(file.originalname.replace(/\\/g, '/')).trim();
  if (!fileName || /[\u0000-\u001f\u007f]/.test(fileName)) {
    throw new AppError('Invalid file name', 400);
  }

  const extension = path.extname(fileName).toLowerCase() as keyof typeof supportedTypes;
  const expectedMimeType = supportedTypes[extension];
  if (!expectedMimeType || file.mimetype !== expectedMimeType) {
    throw new AppError('Only matching PDF, DOCX, and TXT files are supported', 400);
  }

  const hasPdfSignature = file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const hasDocxSignature = file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if ((extension === '.pdf' && !hasPdfSignature) || (extension === '.docx' && !hasDocxSignature)) {
    throw new AppError('File content does not match its declared type', 400);
  }

  if (extension === '.txt') {
    if (file.buffer.includes(0)) {
      throw new AppError('Text files must contain valid UTF-8 text', 400);
    }

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new AppError('Text files must contain valid UTF-8 text', 400);
    }
  }

  return {
    fileName,
    extension,
    mimeType: expectedMimeType,
  };
}

export function checksumUpload(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function saveUpload(buffer: Buffer, extension: ValidatedUpload['extension']): Promise<string> {
  await mkdir(uploadDirectory, { recursive: true });
  const storageKey = `${randomUUID()}${extension}`;
  await writeFile(path.join(uploadDirectory, storageKey), buffer, { flag: 'wx' });
  return storageKey;
}

export async function removeUpload(storageKey: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\.(pdf|docx|txt)$/.test(storageKey)) {
    throw new AppError('Invalid document storage reference', 500);
  }

  await unlink(path.join(uploadDirectory, storageKey));
}
