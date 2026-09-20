/**
 * LetterTemplate 模型
 * ------------------------------------------------------------------
 * 开发信模板：全局可复用资源（不隶属某个客户），供「发送开发信」时一键带入主题与正文。
 * 正文沿用与 DevelopmentLetter 相同的富文本 + {{占位符}} 约定，
 * 因此模板可以直接喂给现有的编辑器与占位符渲染逻辑，无需另造一套。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { TEMPLATE_CATEGORY, type TemplateCategory } from '../constants';

export interface ILetterTemplate {
  projectId: Types.ObjectId;
  /** 模板名称（便于在模板中心识别） */
  name: string;
  /** 模板主题（支持 {{占位符}}） */
  subject: string;
  /** 模板正文（富文本 HTML，支持 {{占位符}}） */
  content: string;
  /** 分类：first_contact / product / quote / followup / festival / other */
  category: TemplateCategory;
  /** 创建人（引用 User）；单用户环境下可留空 */
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type LetterTemplateDocument = HydratedDocument<ILetterTemplate>;
export type LetterTemplateModel = Model<ILetterTemplate>;

const LetterTemplateSchema = new Schema<ILetterTemplate>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: {
      type: String,
      required: [true, '模板名称为必填项'],
      trim: true,
      maxlength: [120, '模板名称不能超过 120 个字符'],
    },
    subject: {
      type: String,
      required: [true, '模板主题为必填项'],
      trim: true,
      maxlength: [300, '模板主题不能超过 300 个字符'],
    },
    content: {
      type: String,
      required: [true, '模板正文不能为空'],
      maxlength: [100000, '模板正文过长'],
    },
    category: {
      type: String,
      enum: { values: TEMPLATE_CATEGORY, message: '模板分类取值非法' },
      default: 'other',
      index: true,
    },
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

// 模板中心按分类浏览 + 按更新时间倒序
LetterTemplateSchema.index({ projectId: 1, category: 1, updatedAt: -1 });

export const LetterTemplate = model<ILetterTemplate, LetterTemplateModel>('LetterTemplate', LetterTemplateSchema);

export default LetterTemplate;
