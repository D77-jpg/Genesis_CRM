import './tenant-setup';
/**
 * User 模型（mock 登录用）
 * ------------------------------------------------------------------
 * 密码使用 bcryptjs 加盐哈希存储，序列化时永不输出 passwordHash。
 * 首次启动服务时会自动写入 .env 中配置的默认管理员账号。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * admin        系统管理员：全部项目与账号管理
 * project_admin 项目管理员：仅被分配项目的全部数据、品牌与发信设置
 * user          销售：仅自己名下客户
 * viewer        只读：被分配项目的全部数据，但禁止任何写操作
 */
export type UserRole = 'admin' | 'project_admin' | 'user' | 'viewer';

/** 账号启用状态：active 启用 / disabled 停用（停用后无法登录，且已签发 token 立即失效） */
export type UserStatus = 'active' | 'disabled';

export interface IUser {
  organizationId?: Types.ObjectId;
  /** Platform operators may inspect all organizations; ordinary admins are organization admins. */
  isPlatformAdmin: boolean;
  username: string;
  passwordHash: string;
  displayName: string;
  /** Optional account email used for password reset and email OTP 2FA. */
  email?: string;
  /** Require an email OTP after the password step. */
  twoFactorEnabled: boolean;
  oauthSecurityVersion: number;
  role: UserRole;
  status: UserStatus;
  /** 可访问的项目。系统管理员不受此列表限制，普通用户严格按此列表授权。 */
  projectIds: Types.ObjectId[];
  defaultProjectId?: Types.ObjectId;
  lastLoginAt?: Date;
  /** Consecutive failed password attempts; selected explicitly by the auth service. */
  failedLoginAttempts: number;
  /** Temporary lockout expiry; selected explicitly by the auth service. */
  lockedUntil?: Date;
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
    isPlatformAdmin: { type: Boolean, default: false, index: true },
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
    email: { type: String, trim: true, lowercase: true, maxlength: 200, unique: true, sparse: true },
    oauthSecurityVersion: { type: Number, default: 0, select: false },
    twoFactorEnabled: { type: Boolean, default: false },
    role: { type: String, enum: ['admin', 'project_admin', 'user', 'viewer'], default: 'user' },
    // 旧数据无此字段时按「启用」处理（查询逻辑用 status !== 'disabled' 判断），无需迁移
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    projectIds: { type: [Schema.Types.ObjectId], ref: 'Project', default: [] },
    defaultProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, min: 0, select: false },
    lockedUntil: { type: Date, select: false },
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
