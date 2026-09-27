import { z } from 'zod';
import { createUploadRequest } from '../../storage/imageStorage.js';
import { ACCEPTED_UPLOAD_TYPES } from '../../storage/imageProcessing.js';
import { IMAGE_PURPOSES } from '../../storage/refs.js';

const uploadRequestSchema = z.object({
  purpose: z.enum(Object.keys(IMAGE_PURPOSES)),
  contentType: z.enum(ACCEPTED_UPLOAD_TYPES),
});

/**
 * POST /media/upload-requests
 *
 * Step 1 of a direct upload: the app asks for permission to upload one image
 * for a given purpose and gets back a presigned POST it sends straight to
 * object storage. The response's `reference` ("upload:<id>") is what the app
 * then puts in the image field of the call that uses it (create product,
 * register rider, …) — step 2 happens there.
 */
export const requestImageUpload = async (req, res, next) => {
  try {
    const { purpose, contentType } = uploadRequestSchema.parse(req.body);
    const result = await createUploadRequest({ userId: req.user.id, purpose, contentType });
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
