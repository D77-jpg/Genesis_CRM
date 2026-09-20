/**
 * CustomerEvent 模型
 * ------------------------------------------------------------------
 * 客户活动时间线里「无法从其它集合还原」的字段改动事件。
 *
 * 设计取舍：
 *   - 客户创建、开发信、跟进记录都能从 Customer / DevelopmentLetter / FollowUp 派生，
 *     不在此重复登记，避免双写与数据不一致；
 *   - 只有「状态变化」「下一次跟进时间变化」这类瞬时字段改动，事后无法追溯，
 *     才在 updateCustomer 时补记一条事件。
 *
 * 因此本集合是「增量」的：升级之前发生的历史改动不会有事件（旧数据允许为空），
 * 但升级之后的每一次状态 / 跟进时间调整都会进入时间线。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { CUSTOMER_EVENT_TYPE, type CustomerEventType, type CustomerStatus } from '../constants';

export interface ICustomerEvent {
  projectId: Types.ObjectId;
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 事件类型：status_changed 状态变化 / followup_scheduled 下一次跟进时间变化 */
  type: CustomerEventType;
  /** 事件发生时间（用于时间线排序，索引） */
  at: Date;
  /** status_changed：变更前状态 */
  fromStatus?: CustomerStatus;
  /** status_changed：变更后状态 */
  toStatus?: CustomerStatus;
  /** followup_scheduled：变更后的下一次跟进时间（null 表示被清除） */
  nextFollowUpAt?: Date | null;
  /** 触发人（引用 User）；单用户环境下可留空 */
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerEventDocument = HydratedDocument<ICustomerEvent>;
export type CustomerEventModel = Model<ICustomerEvent>;

const CustomerEventSchema = new Schema<ICustomerEvent>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, '活动事件必须关联一个客户'],
      index: true,
    },
    type: {
      type: String,
      enum: { values: CUSTOMER_EVENT_TYPE, message: '活动事件类型非法' },
      required: [true, '活动事件类型为必填项'],
    },
    at: {
      type: Date,
      default: Date.now,
      required: [true, '活动事件时间为必填项'],
    },
    fromStatus: { type: String },
    toStatus: { type: String },
    nextFollowUpAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

// 客户时间线按时间倒序拉取
CustomerEventSchema.index({ projectId: 1, customerId: 1, at: -1 });

export const CustomerEvent = model<ICustomerEvent, CustomerEventModel>('CustomerEvent', CustomerEventSchema);

export default CustomerEvent;
