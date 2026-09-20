/**
 * User 模型（mock 登录用）
 * ------------------------------------------------------------------
 * 密码使用 bcryptjs 加盐哈希存储，序列化时永不输出 passwordHash。
 * 首次启动服务时会自动写入 .env 中配置的默认管理员账号。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'user';

/** 账号启用状态：active 启用 / disabled 停用（停用后无法登录，且已签发 token 立即失效） */
export type UserStatus = 'active' | 'disabled';

export interface IUser {
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  /** 可访问的项目。系统管理员不受此列表限制，普通用户严格按此列表授权。 */
  projectIds: Types.ObjectId[];
  defaultProjectId?: Types.ObjectId;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  /** 校验明文密码是否匹配 */
  comparePassword(plain: string): Promise<boolean>;
}

export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const SALT_ROUNDS = 10;

const UserSchema = new Schema<IUser, {}, IUserMethods>(
  {
    username: {
      type: String,
      required: [true, '用户名为必填项'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, '用户名至少 3 个字符'],
      maxlength: [40, '用户名最多 40 个字符'],
    },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, trim: true, default: '', maxlength: 80 },
    role: { type: String, enum: ['admin', 'user'], default: 'admin' },
    // 旧数据无此字段时按「启用」处理（查询逻辑用 status !== 'disabled' 判断），无需迁移
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    projectIds: { type: [Schema.Types.ObjectId], ref: 'Project', default: [] },
    defaultProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

UserSchema.methods.comparePassword = async function comparePassword(
  this: UserDocument,
  plain: string,
): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

/** 生成密码哈希（供 seed 脚本 / 注册逻辑复用） */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export type UserModel = Model<IUser, {}, IUserMethods>;

export const User = model<IUser, UserModel>('User', UserSchema);

export default User;
