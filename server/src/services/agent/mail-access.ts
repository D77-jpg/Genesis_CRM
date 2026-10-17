import {Types} from 'mongoose';
import {MailMessage} from '../../models/MailMessage';
import {customerScope,customerRefScope} from '../../utils/access';
import type {AuthUser} from '../../types/express';
import {ApiError} from '../../utils/ApiError';
import {Customer} from '../../models';
// Explicit project-shared mail is the only shared content. Missing owner is
// quarantined, not an implicit grant. Customer reassignment does not transfer a mailbox.
export function privateMailScope(actor:AuthUser){return {$and:[{$or:[{mailboxUserId:new Types.ObjectId(actor.id)},{visibility:'project_shared'}]}]};}
export async function inboundAgentScope(actor:AuthUser){return {...await customerRefScope(actor),...privateMailScope(actor)};}
export async function agentMailOrThrow(id:string,actor:AuthUser){
 if(!Types.ObjectId.isValid(id))throw ApiError.notFound('邮件不存在');const mail=await MailMessage.findOne({_id:id,deleted:{$ne:true},...await inboundAgentScope(actor)});
 if(!mail)throw ApiError.notFound('邮件不存在或无权访问');
 if(mail.customerId&&!await Customer.exists({_id:mail.customerId,...customerScope(actor)}))throw ApiError.notFound('客户权限已变化');return mail;
}
