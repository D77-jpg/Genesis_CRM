import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export type ProspectStatus = 'ready' | 'low' | 'needs_contact' | 'rejected' | 'converted';

import type {LeadContact} from '../services/prospecting/lead-contact';
export interface IProspect extends LeadContact {
  projectId: Types.ObjectId;
  day: string;                 // YYYY-MM-DD in the project timezone
  domain: string;
  website: string;
  name?: string;
  company?: string;
  country?: string;
  emails: string[];
  emailSource?: 'site' | 'hunter';
  emailConfidence?: number;
  contactName?: string;
  contactTitle?: string;
  instagram?: string;
  linkedin?: string;
  snippet?: string;
  excerpt?: string;            // first ~600 chars of the crawled homepage
  sourceUrl: string;
  /** serper = 搜索抓取；excel = 业务员导入的线索（没有抓取证据链） */
  source: 'serper' | 'excel';
  /** Excel 里的等级 / 优先级 / 备注 / 来源列，转客户时原样带过去 */
  grade?: string;
  priority?: string;
  notes?: string;
  leadSource?: string;
  score: number;
  aiScore?: number;
  scoreReasons: string[];
  status: ProspectStatus;
  /** 领取/负责这条线索的业务员；空 = 公共池 */
  ownerId?: Types.ObjectId;
  customerId?: Types.ObjectId;
  convertedBy?: Types.ObjectId;
  draftTaskId?: Types.ObjectId;
  rejectReason?: string;
  contactRefreshToken?:string;contactRefreshUntil?:Date;contactRefreshedAt?:Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ProspectDocument = HydratedDocument<IProspect>;
export type ProspectModel = Model<IProspect>;

const ProspectSchema = new Schema<IProspect>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  day: { type: String, required: true, index: true },
  domain: { type: String, required: true, trim: true, lowercase: true },
  // Excel 导入的线索可能只有邮箱、没有官网，所以网站允许为空
  website: { type: String, trim: true, default: '' },
  name: { type: String, trim: true, maxlength: 200 },
  company: { type: String, trim: true, maxlength: 200 },
  country: { type: String, trim: true, maxlength: 80 },
  phone:{type:String,trim:true,maxlength:60},address:{type:String,trim:true,maxlength:500},industry:{type:String,trim:true,maxlength:120},
  facebook:{type:String,trim:true,maxlength:300},whatsapp:{type:String,trim:true,maxlength:200},
  contactSources:{type:[{_id:false,source:{type:String,enum:['site','hunter']},url:String,fields:[String]}],default:[]},
  emails: { type: [String], default: [] },
  emailSource: { type: String, enum: ['site', 'hunter'] },
  emailConfidence: { type: Number },
  contactName: { type: String, trim: true, maxlength: 120 },
  contactTitle: { type: String, trim: true, maxlength: 120 },
  instagram: { type: String, trim: true },
  linkedin: { type: String, trim: true },
  snippet: { type: String, trim: true, maxlength: 1000 },
  excerpt: { type: String, maxlength: 2000 },
  sourceUrl: { type: String, trim: true, default: '' },
  source: { type: String, enum: ['serper', 'excel'], default: 'serper' },
  grade: { type: String, trim: true, maxlength: 20 },
  priority: { type: String, trim: true, maxlength: 20 },
  notes: { type: String, trim: true, maxlength: 5000 },
  leadSource: { type: String, trim: true, maxlength: 120 },
  score: { type: Number, default: 0 },
  aiScore: { type: Number },
  scoreReasons: { type: [String], default: [] },
  status: { type: String, enum: ['ready', 'low', 'needs_contact', 'rejected', 'converted'], default: 'ready', index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  convertedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  draftTaskId: { type: Schema.Types.ObjectId, ref: 'AgentTask' },
  rejectReason: { type: String, maxlength: 500 },
  contactRefreshToken:String,contactRefreshUntil:Date,contactRefreshedAt:Date,
}, { timestamps: true, versionKey: false });

ProspectSchema.index({ projectId: 1, domain: 1 }, { unique: true });
ProspectSchema.index({ projectId: 1, day: 1, status: 1, score: -1 });
ProspectSchema.index({ projectId: 1, ownerId: 1, status: 1, score: -1 });

export const Prospect = model<IProspect, ProspectModel>('Prospect', ProspectSchema);
