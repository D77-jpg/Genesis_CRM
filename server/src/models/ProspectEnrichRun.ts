import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

/**
 * 线索批量补全任务
 * ------------------------------------------------------------------
 * Excel 导入的线索经常缺邮箱/电话，这里记录一次「批量补全」的进度：
 * 后台逐条跑官网抓取 / Hunter 找邮箱 / 搜索补官网，前端轮询这个文档看进度。
 */
export type EnrichRunStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export type EnrichMode = 'site' | 'hunter' | 'discover';

export interface IProspectEnrichRun {
  projectId: Types.ObjectId;
  status: EnrichRunStatus;
  modes: EnrichMode[];
  scope: { grade?: string; source?: string };
  queue: Types.ObjectId[];
  total: number;
  done: number;
  /** 抓官网/搜索补官网，让这条线索多了信息（不一定是邮箱） */
  siteFilled: number;
  /** Hunter 补到邮箱 */
  hunterFilled: number;
  /** 搜索到了官网 */
  discovered: number;
  /** 跑完仍然没有邮箱 */
  stillMissing: number;
  /** 出错或跳过的条数 */
  failed: number;
  failures: { name?: string; message: string }[];
  error?: string;
  heartbeatAt?: Date;
  triggeredBy: Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ProspectEnrichRunDocument = HydratedDocument<IProspectEnrichRun>;
export type ProspectEnrichRunModel = Model<IProspectEnrichRun>;

const ProspectEnrichRunSchema = new Schema<IProspectEnrichRun>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'cancelled', 'failed'],
      default: 'running',
      index: true,
    },
    modes: { type: [String], enum: ['site', 'hunter', 'discover'], default: [] },
    scope: { type: new Schema({ grade: String, source: String }, { _id: false }), default: {} },
    queue: { type: [Schema.Types.ObjectId], default: [] },
    total: { type: Number, default: 0 },
    done: { type: Number, default: 0 },
    siteFilled: { type: Number, default: 0 },
    hunterFilled: { type: Number, default: 0 },
    discovered: { type: Number, default: 0 },
    stillMissing: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    // 失败明细：{ name, message }，用 Mixed 免去子文档类型体操
    failures: { type: Schema.Types.Mixed, default: [] },
    error: String,
    heartbeatAt: Date,
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
  },
  { timestamps: true },
);

ProspectEnrichRunSchema.index({ projectId: 1, createdAt: -1 });

export const ProspectEnrichRun = model<IProspectEnrichRun, ProspectEnrichRunModel>(
  'ProspectEnrichRun',
  ProspectEnrichRunSchema,
);
