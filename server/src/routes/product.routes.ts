import {Router} from 'express';
import {validate} from '../middleware/validate.middleware';
import {requireAuth,requireRole} from '../middleware/auth.middleware';
import {
  archiveProductHandler,createProductHandler,getProductHandler,importProductsHandler,listProductsHandler,updateProductHandler,
} from '../controllers/product.controller';
import {
  createProductSchema,idParamsSchema,importProductsSchema,listProductsQuerySchema,updateProductSchema,
} from '../validators/product.validator';

const router=Router();
router.use(requireAuth);

router.get('/',validate({query:listProductsQuerySchema}),listProductsHandler);
router.get('/:id',validate({params:idParamsSchema}),getProductHandler);
router.post('/',requireRole('admin'),validate({body:createProductSchema}),createProductHandler);
router.post('/import',requireRole('admin'),validate({body:importProductsSchema}),importProductsHandler);
router.put('/:id',requireRole('admin'),validate({params:idParamsSchema,body:updateProductSchema}),updateProductHandler);
router.delete('/:id',requireRole('admin'),validate({params:idParamsSchema}),archiveProductHandler);

export default router;
