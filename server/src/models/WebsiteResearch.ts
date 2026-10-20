import {Schema,model,Types} from 'mongoose';
import type {ResearchProfile,ResearchReport,WebsitePage} from '../services/website/site-analysis';
interface WebsiteResearchRecord {
 projectId:Types.ObjectId;userId:Types.ObjectId;requestKey:string;url:string;profile:ResearchProfile;
 state:'queued'|'running'|'ready'|'partial'|'failed'|'cancelled';stage:string;version:number;attempts:number;
 pages:WebsitePage[];targets:string[];failures:{url:string;message:string}[];robots?:string;report?:ResearchReport;
 leaseToken?:string;leaseUntil?:Date;error?:string;customerId?:Types.ObjectId;confirmationHash?:string;draftTaskId?:Types.ObjectId;
 createdAt:Date;updatedAt:Date;
}
const pageSchema=new Schema<WebsitePage>({url:String,title:String,text:String,hash:String,htmlHash:String,collectedAt:String,name:String,links:{type:[new Schema({url:String,text:String},{_id:false})],default:[]}},{_id:false});
const schema=new Schema<WebsiteResearchRecord>({
 projectId:{type:Schema.Types.ObjectId,ref:'Project',required:true},userId:{type:Schema.Types.ObjectId,ref:'User',required:true},
 requestKey:{type:String,required:true,maxlength:100},url:{type:String,required:true,maxlength:1200},profile:{type:String,enum:['genesis','ironhue','velaturo','general'],required:true},
 state:{type:String,enum:['queued','running','ready','partial','failed','cancelled'],default:'queued'},stage:{type:String,default:'等待采集'},version:{type:Number,default:1},attempts:{type:Number,default:0},
 pages:{type:[pageSchema],default:[]},targets:{type:[String],default:[]},failures:{type:[new Schema({url:String,message:String},{_id:false})],default:[]},
 robots:{type:String,maxlength:131072},report:{type:Schema.Types.Mixed},leaseToken:{type:String,select:false},leaseUntil:Date,error:String,
 draftTaskId:{type:Schema.Types.ObjectId,ref:'AgentTask'},customerId:{type:Schema.Types.ObjectId,ref:'Customer'},confirmationHash:{type:String,select:false},
},{timestamps:true,versionKey:false});
schema.index({projectId:1,userId:1,requestKey:1},{unique:true});schema.index({state:1,leaseUntil:1,createdAt:1});schema.index({projectId:1,customerId:1,createdAt:-1});
export const WebsiteResearch=model<WebsiteResearchRecord>('WebsiteResearch',schema);
