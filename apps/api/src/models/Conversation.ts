import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema(
  {
    documentId: { type: String, required: true, trim: true },
    chunkIndex: { type: Number, required: true, min: 0 },
    pageNumbers: { type: [Number], default: undefined },
    score: { type: Number, required: true },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    sources: { type: [sourceSchema], default: undefined },
  },
  { _id: true },
);

const conversationSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200, default: 'New conversation' },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

conversationSchema.index({ ownerId: 1, workspaceId: 1, updatedAt: -1 });

export default mongoose.model('Conversation', conversationSchema);
