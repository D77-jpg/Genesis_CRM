import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export interface SearchProfile {
 id:string;name:string;queries:string[];enrichLimit:number;hunterLimit:number;minScore:number;llmScoring:boolean;
}
export interface IProspectingConfig {
  profiles:SearchProfile[];
  activeProfileId?:string;
  version:number;
  projectId: Types.ObjectId;
  enabled: boolean;
  dailyTarget: number;
  queries: string[];
  minScore: number;
  llmScoring: boolean;
  enrichLimit: number;
  hunterLimit: number;
  cooldownDays: number;
  runAt: string;      // HH:mm, project timezone (used in P1 scheduler)
  reviewAt: string;
  timezone: string;
  ownerId?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ProspectingConfigDocument = HydratedDocument<IProspectingConfig>;
export type ProspectingConfigModel = Model<IProspectingConfig>;

const ProspectingConfigSchema = new Schema<IProspectingConfig>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  profiles:{type:[new Schema<SearchProfile>({id:{type:String,required:true},name:{type:String,required:true,maxlength:60},queries:{type:[String],default:[]},enrichLimit:{type:Number,required:true,min:1,max:80},hunterLimit:{type:Number,required:true,min:0,max:50},minScore:{type:Number,required:true,min:0,max:100},llmScoring:{type:Boolean,default:true}},{_id:false})],default:[]},
  activeProfileId:{type:String},version:{type:Number,default:0},
  enabled: { type: Boolean, default: false },
  dailyTarget: { type: Number, default: 15, min: 1, max: 50 },
  queries: { type: [String], default: [] },
  minScore: { type: Number, default: 60, min: 0, max: 100 },
  llmScoring: { type: Boolean, default: true },
  enrichLimit: { type: Number, default: 30, min: 1, max: 80 },
  hunterLimit: { type: Number, default: 15, min: 0, max: 50 },
  cooldownDays: { type: Number, default: 90, min: 1, max: 365 },
  runAt: { type: String, default: '06:30' },
  reviewAt: { type: String, default: '09:30' },
  timezone: { type: String, default: 'Asia/Shanghai' },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

export const ProspectingConfig = model<IProspectingConfig, ProspectingConfigModel>('ProspectingConfig', ProspectingConfigSchema);
