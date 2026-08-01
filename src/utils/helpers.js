import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Op } from 'sequelize';
import { Business } from '../models/index.js';
import { getMinioClient, minioPublicUrl } from '../config/minio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only these image types may be uploaded — blocks SVG (stored-XSS via inline
// <script>) and arbitrary file types being written into the public uploads dir.
const ALLOWED_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

export const saveBase64Image = async (base64Str) => {
  if (!base64Str) return null;
  // Pass through already-stored images (local path or any absolute URL).
  if (base64Str.startsWith('http://') || base64Str.startsWith('https://') || base64Str.startsWith('/uploads/')) {
    return base64Str;
  }
  try {
    let imageBuffer;
    let extension = 'png';
    let contentType = 'image/png';
    const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      imageBuffer = Buffer.from(base64Str, 'base64');
    } else {
      contentType = matches[1].toLowerCase();
      if (!ALLOWED_IMAGE_TYPES[contentType]) {
        console.error(`Rejected image upload with disallowed content type: ${contentType}`);
        return null;
      }
      extension = ALLOWED_IMAGE_TYPES[contentType];
      imageBuffer = Buffer.from(matches[2], 'base64');
    }

    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      console.error(`Rejected image upload exceeding ${MAX_IMAGE_BYTES} bytes (${imageBuffer.length} bytes).`);
      return null;
    }

    const filename = `img_${Date.now()}_${Math.round(Math.random() * 1e9)}.${extension}`;

    // Prefer MinIO/S3 object storage when configured; otherwise local disk.
    const minio = await getMinioClient();
    if (minio) {
      await minio.putObject(
        process.env.MINIO_BUCKET,
        filename,
        imageBuffer,
        imageBuffer.length,
        { 'Content-Type': contentType }
      );
      return minioPublicUrl(filename);
    }

    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filepath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filepath, imageBuffer);
    return `/uploads/${filename}`;
  } catch (error) {
    console.error('Failed to save base64 image:', error.message);
    return null;
  }
};

export const resolveBusiness = async (businessId) => {
  return await Business.findOne({
    where: {
      [Op.or]: [
        { id: businessId },
        { businessCode: businessId }
      ]
    }
  });
};
