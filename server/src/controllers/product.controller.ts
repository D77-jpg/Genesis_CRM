import type {Request,Response} from 'express';
import {asyncHandler} from '../utils/asyncHandler';
import {sendSuccess} from '../utils/pagination';
import {archiveProduct,createProduct,getProduct,importProducts,listProducts,updateProduct} from '../services/product.service';
import type {CreateProductInput,ImportProductsInput,ListProductsQuery,UpdateProductInput} from '../validators/product.validator';

export const listProductsHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await listProducts(req.query as unknown as ListProductsQuery,req.user!));
});

export const getProductHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await getProduct(req.params.id,req.user!));
});

export const createProductHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await createProduct(req.body as CreateProductInput,req.user!),201);
});

export const updateProductHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await updateProduct(req.params.id,req.body as UpdateProductInput,req.user!));
});

export const archiveProductHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await archiveProduct(req.params.id,req.user!));
});

export const importProductsHandler=asyncHandler(async(req:Request,res:Response)=>{
  sendSuccess(res,await importProducts(req.body as ImportProductsInput,req.user!),201);
});
