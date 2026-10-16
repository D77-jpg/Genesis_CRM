import {Schema,model,Types} from 'mongoose';
import type {KnowledgeCategory,KnowledgeTerm} from '../services/agent/knowledge-types';
export interface KnowledgeRevision {
  version:number;title:string;tags:string[];content:string;source:string;approved:boolean;
  category?:KnowledgeCategory;applicability?:string;products?:string[];validFrom?:Date;validUntil?:Date;
  terms?:KnowledgeTerm[];createdBy:Types.ObjectId;createdAt:Date;
}
export interface IAgentKnowledge {
  projectId:Types.ObjectId;version:number;approvedVersion:number;archived:boolean;importKey?:string;
  revisions:KnowledgeRevision[];createdAt:Date;updatedAt:Date;
}
const termSchema=new Schema<KnowledgeTerm>({
 topic:{type:String,required:true},value:{type:String,required:true},conditions:{type:String,required:true},
 unit:String,currency:String,min:Number,max:Number,mode:{type:String,enum:['reference','confirmed','needs_confirmation'],required:true},
},{_id:false});
const schema=new Schema<IAgentKnowledge>({
 projectId:{type:Schema.Types.ObjectId,required:true},version:{type:Number,required:true},
 approvedVersion:{type:Number,default:0},archived:{type:Boolean,default:false},importKey:String,
 revisions:[{_id:false,version:Number,title:String,tags:[String],content:String,source:String,approved:Boolean,
 category:String,applicability:String,products:[String],validFrom:Date,validUntil:Date,terms:[termSchema],
 createdBy:Schema.Types.ObjectId,createdAt:Date}],
},{timestamps:true,versionKey:false});
schema.index({projectId:1,archived:1,updatedAt:-1});
schema.index({projectId:1,importKey:1},{unique:true,partialFilterExpression:{importKey:{$type:'string'}}});
export const AgentKnowledge=model<IAgentKnowledge>('AgentKnowledge',schema);
export const AgentAttachmentText=model('AgentAttachmentText',new Schema({projectId:{type:Schema.Types.ObjectId,required:true},customerId:{type:Schema.Types.ObjectId,required:true},attachmentId:{type:Schema.Types.ObjectId,required:true},hash:String,status:{type:String,enum:['ready','no_text','unsupported','failed']},text:{type:String,maxlength:24000},reason:String,truncated:Boolean},{timestamps:true,versionKey:false}).index({projectId:1,attachmentId:1},{unique:true}));
