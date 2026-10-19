import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    family: { type: String, default: '' },
  },
  {
    timestamps: true,
  },
);

refreshTokenSchema.index({ userId: 1, revoked: 1, expiresAt: 1 });

export default mongoose.model('RefreshToken', refreshTokenSchema);
