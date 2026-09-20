import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export type ProjectStatus = 'active' | 'archived';

export interface IProject {
  name: string;
  slug: string;
  code: string;
  industry?: string;
  companyName: string;
  website?: string;
  moq?: string;
  senderName?: string;
  mailFrom?: string;
  mailProfileKey: string;
  status: ProjectStatus;
  isDefault: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<IProject>;
export type ProjectModel = Model<IProject>;

const ProjectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '项目标识只能包含小写字母、数字和连字符'],
    },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    industry: { type: String, trim: true, maxlength: 120 },
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    website: { type: String, trim: true, maxlength: 300 },
    moq: { type: String, trim: true, maxlength: 120 },
    senderName: { type: String, trim: true, maxlength: 120 },
    mailFrom: { type: String, trim: true, maxlength: 300 },
    // 凭据不入库；通过服务端 PROJECT_MAIL_CONFIGS_JSON 用此键查找。
    mailProfileKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true, versionKey: false } },
);

ProjectSchema.index({ slug: 1 }, { unique: true });
ProjectSchema.index({ code: 1 }, { unique: true });
ProjectSchema.index({ status: 1, name: 1 });

export const Project = model<IProject, ProjectModel>('Project', ProjectSchema);
export default Project;
