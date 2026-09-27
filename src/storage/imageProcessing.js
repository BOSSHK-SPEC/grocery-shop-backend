import sharp from 'sharp';
import { StorageError } from './errors.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** What a client may upload. HEIC is absent: iOS pickers already hand JPEG. */
export const ACCEPTED_UPLOAD_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const DECODABLE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
// ~40 MP. Bounds memory for a "decompression bomb": a tiny file that claims
// enormous dimensions.
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_EDGE = 1600;

const invalid = () =>
  new StorageError(400, 'IMAGE_INVALID', 'This file is not a valid image. Use a JPEG, PNG, WebP or GIF photo.');

/**
 * Decodes, validates and re-encodes an uploaded image.
 *
 * Re-encoding is the point, not a side effect:
 *  - it proves the bytes really are an image — a declared type or a file
 *    extension proves nothing;
 *  - it drops all metadata, including the GPS position phones embed in
 *    photos (sharp keeps none unless asked);
 *  - it applies EXIF orientation before dropping it, so photos do not come
 *    out sideways;
 *  - it caps dimensions and normalises everything to one format (WebP).
 */
export async function normalizeImage(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw invalid();
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new StorageError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller.');
  }

  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const metadata = await image.metadata();
    if (!DECODABLE_FORMATS.has(metadata.format)) throw invalid();

    const buffer = await image
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return { buffer, contentType: 'image/webp', extension: 'webp' };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw invalid();
  }
}
