import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { getScratchpadHandler, updateScratchpadHandler } from '../controllers/scratchpad.controller';
import { updateScratchpadSchema } from '../validators/scratchpad.validator';

const router = Router();

router.get('/', getScratchpadHandler);
router.put('/', validate({ body: updateScratchpadSchema }), updateScratchpadHandler);

export default router;
