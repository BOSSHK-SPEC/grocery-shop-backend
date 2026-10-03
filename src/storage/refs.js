// Pure helpers for how images are referenced. No I/O here, so every rule about
// what a client may send and what the database stores is unit-testable.
//
// The database stores a *reference*, never a URL:
//
//   storage:public/products/2026/09/5f0c…e1.webp
//   storage:private/licences/2026/09/9a41…7b.webp
//
// A URL is only produced when a response is built. Moving to a CDN, changing
// domain or switching S3 provider is then a config change, not a data
// migration. Two legacy shapes still exist in older rows and pass through
// untouched: "/uploads/<file>" (the old local-disk store) and absolute URLs.

export const REF_PREFIX = 'storage:';
export const UPLOAD_REFERENCE_PREFIX = 'upload:';
export const LEGACY_UPLOAD_PREFIX = '/uploads/';

export const VISIBILITY = Object.freeze({ PUBLIC: 'public', PRIVATE: 'private' });

/**
 * What an uploaded image is for. Decides who can see it and where it lives.
 * Product photos, store logos and profile pictures are shown to other users,
 * so they are public. A driving licence is an identity document: private,
 * readable only through a short-lived signed link.
 */
export const IMAGE_PURPOSES = Object.freeze({
  product: { visibility: VISIBILITY.PUBLIC, folder: 'products' },
  business_logo: { visibility: VISIBILITY.PUBLIC, folder: 'businesses' },
  profile_picture: { visibility: VISIBILITY.PUBLIC, folder: 'profiles' },
  driving_licence: { visibility: VISIBILITY.PRIVATE, folder: 'licences' },
  // A rider KYC selfie and a vehicle's registration certificate are identity
  // documents the same way a licence is: private, signed-link only.
  rider_selfie: { visibility: VISIBILITY.PRIVATE, folder: 'selfies' },
  vehicle_rc: { visibility: VISIBILITY.PRIVATE, folder: 'vehicles' },
});

export const isImagePurpose = (value) =>
  Object.prototype.hasOwnProperty.call(IMAGE_PURPOSES, value);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export const makeRef = (visibility, key) => `${REF_PREFIX}${visibility}/${key}`;

/** `{ visibility, key }` for a well-formed storage reference, otherwise null. */
export function parseRef(value) {
  if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null;
  const rest = value.slice(REF_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const visibility = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (visibility !== VISIBILITY.PUBLIC && visibility !== VISIBILITY.PRIVATE) return null;
  if (!isSafeObjectKey(key)) return null;
  return { visibility, key };
}

/** Rejects empty keys, traversal segments and anything outside a plain charset. */
export function isSafeObjectKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return false;
  if (!SAFE_KEY_RE.test(key)) return false;
  return !key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

export const isLegacyUploadPath = (value) =>
  typeof value === 'string' && value.startsWith(LEGACY_UPLOAD_PREFIX);

/** The upload id inside an "upload:<uuid>" value, otherwise null. */
export function parseUploadReference(value) {
  if (typeof value !== 'string' || !value.startsWith(UPLOAD_REFERENCE_PREFIX)) return null;
  const id = value.slice(UPLOAD_REFERENCE_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

/** Path-style public URL for an object: `<base>/<bucket>/<key>`. */
export function publicObjectUrl(base, bucket, key) {
  const origin = String(base).replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${origin}/${bucket}/${encodedKey}`;
}

/**
 * Turns whatever an image field holds into the value a client should see, for
 * PUBLIC fields. Private references never come out of here as a URL — a
 * licence reference accidentally stored in a public column must not become a
 * public link.
 */
export function toPublicUrl(value, { publicBase, publicBucket }) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const ref = parseRef(value);
  if (!ref) return value; // legacy "/uploads/…" or absolute URL: unchanged
  if (ref.visibility !== VISIBILITY.PUBLIC) return null;
  return publicObjectUrl(publicBase, publicBucket, ref.key);
}

/**
 * Canonical form of an image value sent back by a client, so it can be
 * compared with what is stored. Clients receive URLs and may echo them back
 * unchanged on an edit; those map back to the stored reference. The host is
 * deliberately ignored: the same object is reachable as localhost, 10.0.2.2 or
 * a public domain, and the result is only ever *compared* against the row's
 * current value, never trusted on its own.
 */
export function canonicalizeClientValue(value, { publicBucket }) {
  if (typeof value !== 'string') return value;
  if (parseRef(value) || isLegacyUploadPath(value)) return value;
  if (!/^https?:\/\//i.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const path = decodeURIComponent(url.pathname);
  const bucketPrefix = `/${publicBucket}/`;
  if (path.startsWith(bucketPrefix)) {
    const key = path.slice(bucketPrefix.length);
    if (isSafeObjectKey(key)) return makeRef(VISIBILITY.PUBLIC, key);
  }
  if (path.startsWith(LEGACY_UPLOAD_PREFIX)) return path;
  return value;
}

/** True for values that point at something already stored (or elsewhere). */
export function isStoredImageValue(value) {
  return (
    typeof value === 'string' &&
    (parseRef(value) !== null || isLegacyUploadPath(value) || /^https?:\/\//i.test(value))
  );
}

/** `<folder>/<yyyy>/<mm>/<uuid>.<ext>` — dated folders keep listings browsable. */
export function finalObjectKey(folder, id, extension, now = new Date()) {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${folder}/${yyyy}/${mm}/${id}.${extension}`;
}

/** Where a direct upload waits until the API confirms it. */
export const pendingObjectKey = (purpose, userId, id) => `pending/${purpose}/${userId}/${id}`;
