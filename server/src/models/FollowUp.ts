/**
 * FollowUp 模型
 * ------------------------------------------------------------------
 * 客户跟进记录：每跟进一次落一条，与 Customer 是 N:1 关系；
 * 删除客户时级联清理其跟进记录。
 *
 * 跟进记录支持新增 / 编辑 / 删除；编辑时 timestamps 会自动刷新 updatedAt 以便审计。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import {
  FOLLOW_UP_METHOD,
  FOLLOW_UP_RESULT,
  type FollowUpMethod,
  type FollowUpResult,
} from '../constants';

export interface IFollowUp {
  projectId: Types.ObjectId;
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 跟进方式：email / whatsapp / phone / chat / other */
  method: FollowUpMethod;
  /** 跟进内容（必填） */
  content: string;
  /** 跟进结果：no_reply / replied / interested / quoted / negotiating / won / no_need / other */
  result: FollowUpResult;
  /** 本次跟进发生的时间（默认当前时间） */
  followUpAt: Date;
  /** 计划的下一次跟进时间（可空）；填写后会同步到客户的 nextFollowUpAt */
  nextFollowUpAt?: Date;
  /** 记录人（引用 User）；单用户环境下可留空 */
  createdBy?: Types.ObjectId;
  /** Agent 确认写入的幂等标识，不对普通跟进记录设置。 */
  agentActionKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FollowUpDocument = HydratedDocument<IFollowUp>;
export type FollowUpModel = Model<IFollowUp>;

const FollowUpSchema = new Schema<IFollowUp>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, '跟进记录必须关联一个客户'],
      index: true,
    },
    method: {
      type: String,
      enum: { values: FOLLOW_UP_METHOD, message: '跟进方式取值非法' },
      default: 'email',
      index: true,
    },
    content: {
      type: String,
      required: [true, '跟进内容不能为空'],
      trim: true,
      maxlength: [5000, '跟进内容不能超过 5000 个字符'],
    },
    result: {
      type: String,
      enum: { values: FOLLOW_UP_RESULT, message: '跟进结果取值非法' },
      default: 'no_reply',
      index: true,
    },
    followUpAt: {
      type: Date,
      default: Date.now,
      required: [true, '跟进时间为必填项'],
    },
    nextFollowUpAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    agentActionKey: { type: String, select: false },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

// 客户详情页按跟进时间倒序拉取历史
FollowUpSchema.index({ projectId: 1, customerId: 1, followUpAt: -1 });
// 「今日 / 逾期」等按下一次跟进时间的聚合查询
FollowUpSchema.index({ projectId: 1, nextFollowUpAt: 1 });
FollowUpSchema.index(
  { projectId: 1, agentActionKey: 1 },
  { unique: true, partialFilterExpression: { agentActionKey: { $type: 'string' } } },
);

export const FollowUp = model<IFollowUp, FollowUpModel>('FollowUp', FollowUpSchema);

export default FollowUp;
