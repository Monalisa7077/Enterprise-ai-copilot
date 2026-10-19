import { describe, expect, it } from 'vitest';
import {
  checksumUpload,
  validateUpload,
} from '../services/documentUploadService.js';

function makeFile(
  originalname: string,
  mimetype: string,
  content: string | Buffer,
): Express.Multer.File {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    buffer,
    stream: null as never,
  };
}

describe('document upload validation', () => {
  it('accepts UTF-8 text files with the expected name and MIME type', () => {
    const file = makeFile('policies.txt', 'text/plain', 'Company policy');

    expect(validateUpload(file)).toMatchObject({
      fileName: 'policies.txt',
      extension: '.txt',
      mimeType: 'text/plain',
    });
  });

  it('rejects a file whose MIME type does not match its extension', () => {
    const file = makeFile('notes.txt', 'application/pdf', 'Company policy');

    expect(() => validateUpload(file)).toThrow('Only matching PDF, DOCX, and TXT files are supported');
  });

  it('checks PDF file signatures instead of trusting the extension and MIME type', () => {
    const file = makeFile('report.pdf', 'application/pdf', 'not a PDF');

    expect(() => validateUpload(file)).toThrow('File content does not match its declared type');
  });

  it('rejects invalid UTF-8 text', () => {
    const file = makeFile('notes.txt', 'text/plain', Buffer.from([0xc3, 0x28]));

    expect(() => validateUpload(file)).toThrow('Text files must contain valid UTF-8 text');
  });

  it('rejects empty files', () => {
    const file = makeFile('notes.txt', 'text/plain', Buffer.alloc(0));

    expect(() => validateUpload(file)).toThrow('File must be between 1 byte and 10 MB');
  });

  it('calculates a stable SHA-256 checksum for duplicate detection', () => {
    const contents = Buffer.from('same document');

    expect(checksumUpload(contents)).toBe(checksumUpload(contents));
    expect(checksumUpload(contents)).toHaveLength(64);
  });
});
