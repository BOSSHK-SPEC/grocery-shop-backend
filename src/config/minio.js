// MinIO / S3-compatible object storage for images.
//
// Fully self-degrading: if the env vars below are not set, or the `minio`
// package is not installed, or the server is unreachable, image uploads
// transparently fall back to local disk (see src/utils/helpers.js).
//
// Required env to enable:
//   MINIO_ENDPOINT      e.g. "localhost" or "minio.example.com" (host only, no scheme)
//   MINIO_ACCESS_KEY
//   MINIO_SECRET_KEY
//   MINIO_BUCKET        e.g. "grocery-images"
// Optional:
//   MINIO_PORT          default 9000 (or 443 when SSL)
//   MINIO_USE_SSL       "true" | "false" (default false)
//   MINIO_PUBLIC_URL    public base URL for objects, e.g. "https://cdn.example.com/grocery-images"
//                       (defaults to http(s)://ENDPOINT:PORT/BUCKET)

let _client = null;
let _initTried = false;
let _enabled = false;

export function isMinioConfigured() {
  return !!(
    process.env.MINIO_ENDPOINT &&
    process.env.MINIO_ACCESS_KEY &&
    process.env.MINIO_SECRET_KEY &&
    process.env.MINIO_BUCKET
  );
}

function minioPort() {
  if (process.env.MINIO_PORT) return parseInt(process.env.MINIO_PORT, 10);
  return process.env.MINIO_USE_SSL === 'true' ? 443 : 9000;
}

async function ensureBucket(client) {
  const bucket = process.env.MINIO_BUCKET;
  const exists = await client.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await client.makeBucket(bucket);
  }
  // Allow public read so returned image URLs are directly viewable.
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
  await client.setBucketPolicy(bucket, JSON.stringify(policy)).catch((e) => {
    console.warn('MinIO: could not set public-read policy:', e.message);
  });
}

// Lazily create (and memoize) the MinIO client. Returns null when disabled.
export async function getMinioClient() {
  if (_initTried) return _enabled ? _client : null;
  _initTried = true;
  if (!isMinioConfigured()) return null;
  try {
    const { Client } = await import('minio');
    _client = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: minioPort(),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });
    await ensureBucket(_client);
    _enabled = true;
    console.log(`MinIO storage enabled (bucket: ${process.env.MINIO_BUCKET}).`);
    return _client;
  } catch (err) {
    console.error('MinIO unavailable, using local disk storage instead:', err.message);
    _enabled = false;
    _client = null;
    return null;
  }
}

export function minioPublicUrl(objectName) {
  const configured = process.env.MINIO_PUBLIC_URL;
  if (configured) return `${configured.replace(/\/$/, '')}/${objectName}`;
  const scheme = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  return `${scheme}://${process.env.MINIO_ENDPOINT}:${minioPort()}/${process.env.MINIO_BUCKET}/${objectName}`;
}
