import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Op } from 'sequelize';
import { Business } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const saveBase64Image = async (base64Str) => {
  if (!base64Str) return null;
  if (base64Str.startsWith('http://') || base64Str.startsWith('https://') || base64Str.startsWith('/uploads/')) {
    return base64Str;
  }
  try {
    let imageBuffer;
    let extension = 'png';
    const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      imageBuffer = Buffer.from(base64Str, 'base64');
    } else {
      extension = matches[1].split('/')[1] || 'png';
      imageBuffer = Buffer.from(matches[2], 'base64');
    }

    const filename = `img_${Date.now()}_${Math.round(Math.random() * 1e9)}.${extension}`;
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
