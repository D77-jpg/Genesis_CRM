import {Schema,model,Types} from 'mongoose';
export interface KnowledgeRevision {version:number;title:string;tags:string[];content:string;source:string;approved:boolean;createdBy:Types.ObjectId;createdAt:Date}
export interface IAgentKnowledge {projectId:Types.ObjectId;version:number;approvedVersion:number;archived:boolean;revisions:KnowledgeRevision[];createdAt:Date;updatedAt:Date}
const schema=new Schema<IAgentKnowledge>({projectId:{type:Schema.Types.ObjectId,required:true},version:{type:Number,required:true},approvedVersion:{type:Number,default:0},archived:{type:Boolean,default:false},revisions:[{_id:false,version:Number,title:String,tags:[String],content:String,source:String,approved:Boolean,createdBy:Schema.Types.ObjectId,createdAt:Date}]},{timestamps:true,versionKey:false});
schema.index({projectId:1,archived:1,updatedAt:-1});
export const AgentKnowledge=model<IAgentKnowledge>('AgentKnowledge',schema);
export const AgentAttachmentText=model('AgentAttachmentText',new Schema({projectId:{type:Schema.Types.ObjectId,required:true},customerId:{type:Schema.Types.ObjectId,required:true},attachmentId:{type:Schema.Types.ObjectId,required:true},hash:String,status:{type:String,enum:['ready','no_text','unsupported','failed']},text:{type:String,maxlength:24000},reason:String,truncated:Boolean},{timestamps:true,versionKey:false}).index({projectId:1,attachmentId:1},{unique:true}));
