import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['ADMIN', 'USER'],
      default: 'USER',
    },
  },
  {
    timestamps: true,
  },
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) {
    return next();
  }

  this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
  return next();
});

userSchema.methods.comparePassword = async function comparePassword(candidatePassword: string) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export type UserRole = 'ADMIN' | 'USER';

export type UserDocument = HydratedDocument<
  InferSchemaType<typeof userSchema> & {
    comparePassword(candidatePassword: string): Promise<boolean>;
  }
>;

const UserModel = mongoose.model<UserDocument>('User', userSchema) as Model<UserDocument>;
export default UserModel;
