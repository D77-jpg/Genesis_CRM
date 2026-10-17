import { Schema, model, Types } from 'mongoose';
export interface IndexIdentity { id:string; model:string; revision:string; weightHash:string; dimension:number; adapter:string; maxTokens:number }
export interface IndexState { projectId:Types.ObjectId; requestedBy?:Types.ObjectId; enabled:boolean; activeGeneration?:Types.ObjectId; pendingGeneration?:Types.ObjectId; revision:number; switchToken?:string; switchUntil?:Date; updatedAt:Date }
interface Generation {
 projectId:Types.ObjectId; requestedBy:Types.ObjectId; key:string; manifest:string; identity:IndexIdentity;
 state:'queued'|'running'|'ready'|'failed'|'superseded'|'deleting'|'deleted';
 attempts:number; retryAt?:Date; leaseToken?:string; leaseUntil?:Date; done:number; total:number; publications:number;
 embedded:number; reused:number; checksum?:string; error?:{code:string;message:string}; metrics?:Record<string,number>;
 createdAt:Date; updatedAt:Date; activatedAt?:Date;
}
interface Item {
 projectId:Types.ObjectId; generation:Types.ObjectId; itemId:string; knowledgeId:Types.ObjectId; publicationVersion:number;
 documentIds:string[]; sourceChunkIds:string[]; sourceRefs:Record<string,unknown>[]; location:Record<string,unknown>;
 ordinal:number; content:string; contentHash:string; scope:string; identity:string; dimension:number;
}
const stateSchema=new Schema<IndexState>({projectId:{type:Schema.Types.ObjectId,required:true,unique:true},requestedBy:Schema.Types.ObjectId,enabled:{type:Boolean,default:true},
 switchToken:String,switchUntil:Date,activeGeneration:Schema.Types.ObjectId,pendingGeneration:Schema.Types.ObjectId,revision:{type:Number,default:0}},{timestamps:true,versionKey:false});
const generationSchema=new Schema<Generation>({projectId:{type:Schema.Types.ObjectId,required:true},requestedBy:{type:Schema.Types.ObjectId,required:true},key:{type:String,required:true},
 manifest:{type:String,required:true},identity:{type:Schema.Types.Mixed,required:true},state:{type:String,enum:['queued','running','ready','failed','superseded','deleting','deleted'],default:'queued'},
 attempts:{type:Number,default:0},retryAt:Date,leaseToken:String,leaseUntil:Date,done:{type:Number,default:0},total:{type:Number,default:0},publications:{type:Number,default:0},
 embedded:{type:Number,default:0},reused:{type:Number,default:0},checksum:String,error:{code:String,message:String},metrics:Schema.Types.Mixed,activatedAt:Date},{timestamps:true,versionKey:false});
generationSchema.index({projectId:1,key:1},{unique:true}); generationSchema.index({state:1,leaseUntil:1,createdAt:1});
const itemSchema=new Schema<Item>({projectId:{type:Schema.Types.ObjectId,required:true},generation:{type:Schema.Types.ObjectId,required:true},itemId:{type:String,required:true},
 knowledgeId:{type:Schema.Types.ObjectId,required:true},publicationVersion:{type:Number,required:true},documentIds:[String],sourceChunkIds:[String],sourceRefs:[Schema.Types.Mixed],location:Schema.Types.Mixed,
 ordinal:Number,content:{type:String,required:true},contentHash:{type:String,required:true},scope:{type:String,required:true},identity:{type:String,required:true},dimension:{type:Number,required:true}}, {versionKey:false});
itemSchema.index({generation:1,itemId:1},{unique:true}); itemSchema.index({projectId:1,generation:1,ordinal:1});
export const KnowledgeIndexState=model<IndexState>('KnowledgeIndexState',stateSchema);
export const KnowledgeIndexGeneration=model<Generation>('KnowledgeIndexGeneration',generationSchema);
export const KnowledgeIndexItem=model<Item>('KnowledgeIndexItem',itemSchema);
