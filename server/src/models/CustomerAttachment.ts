/**
 * CustomerAttachment 模型
 * ------------------------------------------------------------------
 * 客户附件：销售把与客户相关的资料（产品图片 / 需求 PDF / 报价单 / PI / PO /
 * 合同 / 公司资料等）集中挂到某个客户下，与 Customer 是 N:1 关系；
 * 删除客户时级联清理其附件（含磁盘文件，见 attachment.service.purgeCustomerAttachments）。
 *
 * 第一版使用「本地 uploads 目录」存储，不引入对象存储：
 *   - 文件以随机名落盘（filename），原始名（originalName）仅用于展示与下载；
 *   - 下载走带鉴权的接口按流返回，不做静态托管，天然复用客户数据隔离规则。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export interface ICustomerAttachment {
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 上传时的原始文件名（用于展示 / 下载还原） */
  originalName: string;
  /** 落盘用的随机文件名（对外不暴露） */
  filename: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件字节数 */
  size: number;
  /** 磁盘绝对路径（对外不暴露） */
  path: string;
  /** 上传人（引用 User）；单用户环境下可留空 */
  uploadedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerAttachmentDocument = HydratedDocument<ICustomerAttachment>;
export type CustomerAttachmentModel = Model<ICustomerAttachment>;

const CustomerAttachmentSchema = new Schema<ICustomerAttachment>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, '附件必须关联一个客户'],
      index: true,
    },
    originalName: {
      type: String,
      required: [true, '附件文件名为必填项'],
      trim: true,
      maxlength: [255, '文件名不能超过 255 个字符'],
    },
    filename: {
      type: String,
      required: [true, '附件存储名为必填项'],
      trim: true,
    },
    mimeType: {
      type: String,
      trim: true,
      maxlength: 160,
      default: 'application/octet-stream',
    },
    size: {
      type: Number,
      required: [true, '附件大小为必填项'],
      min: [0, '附件大小非法'],
    },
    path: {
      type: String,
      required: [true, '附件存储路径为必填项'],
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

// 客户详情页按上传时间倒序拉取附件
CustomerAttachmentSchema.index({ customerId: 1, createdAt: -1 });

export const CustomerAttachment = model<ICustomerAttachment, CustomerAttachmentModel>(
  'CustomerAttachment',
  CustomerAttachmentSchema,
);

export default CustomerAttachment;
