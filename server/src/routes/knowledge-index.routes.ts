import {Router} from 'express';
import {z} from 'zod';
import {rateLimit} from 'express-rate-limit';
import {requireRole} from '../middleware/auth.middleware';
import {asyncHandler} from '../utils/asyncHandler';
import {sendSuccess} from '../utils/pagination';
import {validate} from '../middleware/validate.middleware';
import {indexStatus,requestIndex,controlIndex,cleanupIndexes} from '../services/knowledge/index.service';
const router=Router();router.use(requireRole('admin'));
const limiter=rateLimit({windowMs:60000,max:10,standardHeaders:true,legacyHeaders:false});
router.get('/',asyncHandler(async(req,res)=>sendSuccess(res,await indexStatus(req.user!))));
router.post('/rebuild',limiter,validate({body:z.object({requestKey:z.string().uuid()}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await requestIndex(req.user!,req.body.requestKey),202)));
router.post('/cleanup',limiter,validate({body:z.object({}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await cleanupIndexes(req.user!))));
router.post('/:id/:action',limiter,validate({params:z.object({id:z.string().regex(/^[a-f\d]{24}$/i),action:z.enum(['retry','cancel','rollback'])}),body:z.object({}).strict()}),
 asyncHandler(async(req,res)=>sendSuccess(res,await controlIndex(req.user!,req.params.id,req.params.action as 'retry'|'cancel'|'rollback'))));
export default router;
