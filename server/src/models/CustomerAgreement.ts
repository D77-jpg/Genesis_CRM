import {Schema,model,Types} from 'mongoose';
import type {KnowledgeTerm} from '../services/agent/knowledge-types';
export interface AgreementRevision {version:number;title:string;source:string;content:string;terms:KnowledgeTerm[];validFrom:Date;validUntil:Date;approved:boolean;reviewedBy:Types.ObjectId;reviewedAt:Date}
export interface ICustomerAgreement {projectId:Types.ObjectId;customerId:Types.ObjectId;version:number;approvedVersion:number;disabled:boolean;revisions:AgreementRevision[];createdAt:Date;updatedAt:Date}
const schema=new Schema<ICustomerAgreement>({projectId:{type:Schema.Types.ObjectId,required:true},customerId:{type:Schema.Types.ObjectId,required:true},version:{type:Number,required:true},approvedVersion:{type:Number,default:0},disabled:{type:Boolean,default:false},revisions:[{_id:false,version:Number,title:String,source:String,content:String,terms:[Schema.Types.Mixed],validFrom:Date,validUntil:Date,approved:Boolean,reviewedBy:Schema.Types.ObjectId,reviewedAt:Date}]},{timestamps:true,versionKey:false});
schema.index({projectId:1,customerId:1,disabled:1});
export const CustomerAgreement=model<ICustomerAgreement>('CustomerAgreement',schema);
