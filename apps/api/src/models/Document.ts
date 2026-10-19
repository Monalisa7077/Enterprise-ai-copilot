import mongoose from 'mongoose';

export const documentStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const documentFailureCodes = [
  'EXTRACTION_FAILED',
  'EMBEDDING_FAILED',
  'VECTOR_STORAGE_FAILED',
  'UNKNOWN',
] as const;
export type DocumentFailureCode = (typeof documentFailureCodes)[number];

export function sanitizeFailureMessage(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const documentSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    checksum: { type: String, required: true },
    storageKey: { type: String, required: true },
    status: { type: String, enum: documentStatuses, default: 'PENDING', required: true },
    processingStartedAt: { type: Date },
    processingCompletedAt: { type: Date },
    failureCode: { type: String, enum: documentFailureCodes },
    failureMessage: {
      type: String,
      maxlength: 300,
      set: (message: string | undefined) =>
        typeof message === 'string' ? sanitizeFailureMessage(message) : message,
    },
  },
  {
    timestamps: true,
  },
);

documentSchema.index({ ownerId: 1, workspaceId: 1, checksum: 1 }, { unique: true });
documentSchema.index({ ownerId: 1, workspaceId: 1, createdAt: -1 });

export default mongoose.model('Document', documentSchema);
