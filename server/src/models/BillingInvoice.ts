import './tenant-setup';
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';

export interface IInvoiceLine {
  key: string;
  description: string;
  quantity: number;
  unitAmountUsd: number;
  amountUsd: number;
}

export interface IBillingInvoice {
  organizationId: Types.ObjectId;
  number: string;
  period: string;
  status: InvoiceStatus;
  currency: string;
  lines: IInvoiceLine[];
  subtotalUsd: number;
  totalUsd: number;
  dueAt: Date;
  paidAt?: Date;
  externalInvoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BillingInvoiceDocument = HydratedDocument<IBillingInvoice>;
export type BillingInvoiceModel = Model<IBillingInvoice>;

const BillingInvoiceSchema = new Schema<IBillingInvoice>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    number: { type: String, required: true, unique: true, trim: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ['draft', 'open', 'paid', 'void'], default: 'draft', index: true },
    currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },
    lines: [{
      _id: false,
      key: { type: String, required: true },
      description: { type: String, required: true },
      quantity: { type: Number, required: true, min: 0 },
      unitAmountUsd: { type: Number, required: true },
      amountUsd: { type: Number, required: true },
    }],
    subtotalUsd: { type: Number, default: 0 },
    totalUsd: { type: Number, default: 0 },
    dueAt: { type: Date, required: true },
    paidAt: Date,
    externalInvoiceId: String,
  },
  { timestamps: true, versionKey: false },
);

BillingInvoiceSchema.index({ organizationId: 1, period: 1 }, { unique: true });

export const BillingInvoice = model<IBillingInvoice, BillingInvoiceModel>('BillingInvoice', BillingInvoiceSchema);
export default BillingInvoice;
