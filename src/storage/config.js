// Storage configuration, read lazily. ESM hoists imports above app.js's
// dotenv.config() call, so reading process.env at module load would see an
// empty environment; everything here resolves on first use instead.

const read = (key) => (process.env[key] ?? '').trim();

let cached = null;

export function storageConfig() {
  if (cached) return cached;
  const useSSL = read('MINIO_USE_SSL') === 'true';
  const port = parseInt(read('MINIO_PORT'), 10) || (useSSL ? 443 : 9000);
  cached = Object.freeze({
    endpoint: read('MINIO_ENDPOINT'),
    port,
    useSSL,
    accessKey: read('MINIO_ACCESS_KEY'),
    secretKey: read('MINIO_SECRET_KEY'),
    // Fixed so presigning never needs a network round-trip to look the
    // region up — the signing host may not be reachable from the server.
    region: read('MINIO_REGION') || 'us-east-1',
    publicBucket: read('MINIO_PUBLIC_BUCKET') || 'grocery-public',
    privateBucket: read('MINIO_PRIVATE_BUCKET') || 'grocery-private',
    publicUrl: read('MINIO_PUBLIC_URL').replace(/\/+$/, ''),
    isProduction: process.env.NODE_ENV === 'production',
  });
  return cached;
}

/**
 * Everything wrong with the current configuration, as readable sentences.
 * Empty means usable.
 */
export function configurationProblems(config = storageConfig()) {
  const problems = [];
  for (const [key, value] of [
    ['MINIO_ENDPOINT', config.endpoint],
    ['MINIO_ACCESS_KEY', config.accessKey],
    ['MINIO_SECRET_KEY', config.secretKey],
  ]) {
    if (!value) problems.push(`${key} is not set`);
  }
  if (config.publicBucket === config.privateBucket) {
    problems.push('MINIO_PUBLIC_BUCKET and MINIO_PRIVATE_BUCKET must differ');
  }
  if (config.publicUrl) {
    let url;
    try {
      url = new URL(config.publicUrl);
    } catch {
      problems.push('MINIO_PUBLIC_URL is not a valid URL');
    }
    // Objects are addressed path-style (<origin>/<bucket>/<key>) and presigned
    // links are signed for exactly that shape, so the base must be a bare
    // origin — a path here would produce links whose signature never matches.
    if (url && url.pathname !== '/' && url.pathname !== '') {
      problems.push('MINIO_PUBLIC_URL must be an origin only (e.g. https://images.example.com), without a path');
    }
    if (url && config.isProduction && url.protocol !== 'https:') {
      problems.push('MINIO_PUBLIC_URL must use https in production');
    }
  } else if (config.isProduction) {
    problems.push('MINIO_PUBLIC_URL is required in production (the address phones use to reach image storage)');
  }
  return problems;
}

/** For tests: forget the memoized config so a changed environment is re-read. */
export function resetStorageConfigForTests() {
  cached = null;
}
