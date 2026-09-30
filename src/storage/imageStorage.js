import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { UploadIntent } from '../models/UploadIntent.js';
import { internalClient, signingClient } from './client.js';
import { configurationProblems, storageConfig } from './config.js';
import { StorageError, isClientError } from './errors.js';
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, normalizeImage } from './imageProcessing.js';
import {
  IMAGE_PURPOSES,
  VISIBILITY,
  canonicalizeClientValue,
  finalObjectKey,
  isLegacyUploadPath,
  makeRef,
  parseRef,
  parseUploadReference,
  pendingObjectKey,
} from './refs.js';
import { currentPublicBase } from './requestContext.js';

// How long a phone has to finish the upload once it has the link.
const UPLOAD_WINDOW_MS = 5 * 60 * 1000;
// How long an uploaded-but-unattached image can still be attached (e.g. a
// licence picked on step 1 of registration, submitted on step 2). Matches the
// 1-day lifecycle rule on pending/, after which the object is gone anyway.
const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
// Private images are shown through signed links this short-lived.
const PRIVATE_LINK_SECONDS = 15 * 60;

const unavailable = () =>
  new StorageError(503, 'STORAGE_UNAVAILABLE', 'Image storage is temporarily unavailable. Please try again.');

function bucketFor(visibility) {
  const config = storageConfig();
  return visibility === VISIBILITY.PRIVATE ? config.privateBucket : config.publicBucket;
}

function purposeOrThrow(purpose) {
  const spec = IMAGE_PURPOSES[purpose];
  if (!spec) throw new StorageError(400, 'IMAGE_PURPOSE_INVALID', 'Unknown image purpose.');
  return spec;
}

async function streamToBuffer(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      stream.destroy();
      throw new StorageError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Normalises an image and writes it to its final, permanent location. */
async function storeProcessedImage(buffer, purpose) {
  const spec = purposeOrThrow(purpose);
  const processed = await normalizeImage(buffer);
  const key = finalObjectKey(spec.folder, crypto.randomUUID(), processed.extension);
  const isPublic = spec.visibility === VISIBILITY.PUBLIC;
  try {
    await internalClient().putObject(bucketFor(spec.visibility), key, processed.buffer, processed.buffer.length, {
      'Content-Type': processed.contentType,
      // Keys are never reused (a new photo gets a new UUID), so public copies
      // can be cached forever. Identity documents are never cached.
      'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store',
    });
  } catch (error) {
    console.error('[storage] putObject failed:', error.message);
    throw unavailable();
  }
  return makeRef(spec.visibility, key);
}

/**
 * Stores raw image bytes for a purpose (validated, re-encoded, metadata
 * stripped) and returns the reference. For server-side jobs such as the
 * legacy-upload migration; request handlers use resolveImageInput().
 */
export const storeImageBuffer = (buffer, purpose) => storeProcessedImage(buffer, purpose);

// ── Direct upload: step 1 ─────────────────────────────────────────────────

/**
 * Authorises one direct upload. Returns a presigned POST policy the phone
 * submits straight to object storage.
 *
 * A POST policy rather than a presigned PUT because only a policy can bound
 * the upload: storage itself rejects anything that is not this exact key,
 * this content type, or between 1 byte and 5 MB. A presigned PUT would accept
 * a 5 GB file.
 */
export async function createUploadRequest({ userId, purpose, contentType }) {
  purposeOrThrow(purpose);
  if (!ACCEPTED_UPLOAD_TYPES.includes(contentType)) {
    throw new StorageError(400, 'IMAGE_TYPE_UNSUPPORTED', 'Only JPEG, PNG, WebP or GIF images can be uploaded.');
  }

  const config = storageConfig();
  const id = crypto.randomUUID();
  const objectKey = pendingObjectKey(purpose, userId, id);
  const now = Date.now();
  const uploadExpiresAt = new Date(now + UPLOAD_WINDOW_MS);

  let post;
  try {
    const signer = signingClient(currentPublicBase());
    const policy = signer.newPostPolicy();
    policy.setBucket(config.privateBucket);
    policy.setKey(objectKey);
    policy.setContentType(contentType);
    policy.setContentLengthRange(1, MAX_UPLOAD_BYTES);
    policy.setExpires(uploadExpiresAt);
    post = await signer.presignedPostPolicy(policy);
  } catch (error) {
    console.error('[storage] presignedPostPolicy failed:', error.message);
    throw unavailable();
  }

  await UploadIntent.create({
    id,
    userId,
    purpose,
    objectKey,
    contentType,
    uploadExpiresAt,
    confirmBy: new Date(now + CONFIRM_WINDOW_MS),
  });

  return {
    uploadId: id,
    // What the client puts in the image field of the API call that uses it.
    reference: `upload:${id}`,
    upload: {
      method: 'POST',
      url: post.postURL,
      // Send every field, then the file last, as multipart/form-data.
      fields: post.formData,
      fileField: 'file',
    },
    maxBytes: MAX_UPLOAD_BYTES,
    expiresAt: uploadExpiresAt.toISOString(),
  };
}

// ── Direct upload: step 2 ─────────────────────────────────────────────────

/**
 * Attaches a direct upload: checks it belongs to this user and purpose, turns
 * the pending object into a validated, re-encoded permanent image, and marks
 * the intent used.
 */
async function confirmUpload({ uploadId, userId, purpose }) {
  const now = new Date();
  // Claim atomically. Two concurrent requests presenting the same upload id
  // race on this UPDATE, and exactly one of them wins.
  const [claimed] = await UploadIntent.update(
    { status: 'consumed', consumedAt: now },
    { where: { id: uploadId, userId, purpose, status: 'issued', confirmBy: { [Op.gt]: now } } },
  );
  if (claimed !== 1) {
    throw new StorageError(
      400,
      'UPLOAD_INVALID',
      'This image upload is invalid, expired or already used. Please choose the image again.',
    );
  }

  const intent = await UploadIntent.findByPk(uploadId);
  const config = storageConfig();
  try {
    let stat;
    try {
      stat = await internalClient().statObject(config.privateBucket, intent.objectKey);
    } catch (error) {
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        throw new StorageError(400, 'UPLOAD_MISSING', 'The image was not uploaded. Please choose it again.');
      }
      throw error;
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
      throw new StorageError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller.');
    }

    const original = await streamToBuffer(
      await internalClient().getObject(config.privateBucket, intent.objectKey),
      MAX_UPLOAD_BYTES,
    );
    const ref = await storeProcessedImage(original, purpose);

    // Best effort: the lifecycle rule removes it within a day regardless.
    internalClient().removeObject(config.privateBucket, intent.objectKey).catch(() => {});
    return ref;
  } catch (error) {
    if (isClientError(error)) {
      // Unusable upload: it can never succeed, so do not let it be retried,
      // and do not keep the bytes around (they may not even be an image).
      await UploadIntent.update({ status: 'rejected' }, { where: { id: uploadId } }).catch(() => {});
      internalClient().removeObject(config.privateBucket, intent.objectKey).catch(() => {});
      throw error;
    }
    // Storage hiccup: release the claim so the same upload can be retried.
    await UploadIntent.update({ status: 'issued', consumedAt: null }, { where: { id: uploadId } }).catch(() => {});
    if (error instanceof StorageError) throw error;
    console.error('[storage] confirmUpload failed:', error.message);
    throw unavailable();
  }
}

// ── What API handlers call ────────────────────────────────────────────────

/**
 * Resolves whatever a client put in an image field into the value to store.
 *
 *   - null / ''                → null
 *   - "upload:<id>"            → confirmed direct upload (the normal path)
 *   - the image already stored → kept (edits that do not change the photo)
 *   - raw base64               → legacy path for older app versions: the
 *                                server uploads it itself
 *   - any other reference/URL  → rejected
 *
 * The last rule matters. Accepting an arbitrary reference would let a client
 * point its profile at someone else's licence; accepting an arbitrary URL
 * would let it embed images hosted anywhere. A reference is only accepted if
 * it is what this record already holds.
 */
export async function resolveImageInput(input, { purpose, userId, current = null }) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') {
    throw new StorageError(400, 'IMAGE_INVALID', 'Image must be sent as a string.');
  }
  purposeOrThrow(purpose);

  const uploadId = parseUploadReference(input);
  if (uploadId) return confirmUpload({ uploadId, userId, purpose });

  const currentValues = new Set([].concat(current ?? []).filter(Boolean));
  const { publicBucket } = storageConfig();
  const canonical = canonicalizeClientValue(input, { publicBucket });
  if (currentValues.has(canonical)) return canonical;

  if (parseRef(canonical) || isLegacyUploadPath(canonical) || /^https?:\/\//i.test(canonical)) {
    throw new StorageError(
      400,
      'IMAGE_REFERENCE_REJECTED',
      'That image cannot be used here. Please choose the image again.',
    );
  }

  return storeLegacyBase64(input, purpose);
}

/** `resolveImageInput` for fields holding a list (product thumbnails). */
export async function resolveImageInputs(inputs, { purpose, userId, current = [] }) {
  const resolved = [];
  for (const input of inputs ?? []) {
    const ref = await resolveImageInput(input, { purpose, userId, current });
    if (ref) resolved.push(ref);
  }
  return resolved;
}

const DATA_URL_RE = /^data:([a-z0-9.+/-]+);base64,(.*)$/is;

/**
 * Older app versions send the image itself, base64-encoded, inside the JSON.
 * Still accepted so an out-of-date install keeps working, but it now lands
 * in object storage like everything else — never on local disk.
 */
async function storeLegacyBase64(value, purpose) {
  let payload = value;
  const dataUrl = value.match(DATA_URL_RE);
  if (dataUrl) {
    if (!ACCEPTED_UPLOAD_TYPES.includes(dataUrl[1].toLowerCase())) {
      throw new StorageError(400, 'IMAGE_TYPE_UNSUPPORTED', 'Only JPEG, PNG, WebP or GIF images can be uploaded.');
    }
    payload = dataUrl[2];
  }
  // A base64 string ~4/3 the size of the bytes: reject before decoding.
  if (payload.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4) {
    throw new StorageError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller.');
  }
  return storeProcessedImage(Buffer.from(payload, 'base64'), purpose);
}

// ── Reading ───────────────────────────────────────────────────────────────

export { toPublicUrl } from './publicUrl.js';

/**
 * Short-lived signed link for a private image (a driving licence). Signed for
 * the address the requesting client uses, so it opens on that device and
 * stops working after 15 minutes.
 */
export async function toPrivateUrl(value) {
  if (!value) return null;
  const ref = parseRef(value);
  if (!ref) return value; // legacy value: unchanged until migrated
  const bucket = bucketFor(ref.visibility);
  try {
    return await signingClient(currentPublicBase()).presignedGetObject(bucket, ref.key, PRIVATE_LINK_SECONDS);
  } catch (error) {
    console.error('[storage] presignedGetObject failed:', error.message);
    return null;
  }
}

/** `misc` as a client should see it: the licence as a signed link. */
export async function presentUserMisc(misc) {
  if (!misc || typeof misc !== 'object') return misc ?? null;
  if (!misc.dlPic) return misc;
  return { ...misc, dlPic: await toPrivateUrl(misc.dlPic) };
}

// Identity documents inside a business's KYC record. They are stored as
// private references, so a client can only open them through a signed link.
const PRIVATE_KYC_FIELDS = ['panPhoto', 'fssaiPhoto'];

/** `kyc` as a client entitled to see it should receive it: photos as signed links. */
export async function presentKyc(kyc) {
  if (!kyc || typeof kyc !== 'object') return kyc ?? null;
  const out = { ...kyc };
  for (const field of PRIVATE_KYC_FIELDS) {
    if (out[field]) out[field] = await toPrivateUrl(out[field]);
  }
  return out;
}

/**
 * A business as JSON for a given viewer. Secure by default: KYC (PAN, document
 * photos) and the payout account are only included when `includePrivate` is
 * set, which callers do for the store's owner and for admins. Shoppers and
 * everyone else get the storefront fields only.
 */
export async function presentBusiness(business, { includePrivate = false } = {}) {
  if (!business) return business;
  const plain = typeof business.toJSON === 'function' ? business.toJSON() : { ...business };
  if (includePrivate) {
    plain.kyc = await presentKyc(plain.kyc);
  } else {
    delete plain.kyc;
    delete plain.payoutAccount;
  }
  return plain;
}

// ── Housekeeping ──────────────────────────────────────────────────────────

/**
 * Deletes stored images that are no longer referenced (a replaced photo, or
 * one saved for a write that then failed). Best effort, never throws: a
 * leftover object costs a few KB, a failed request costs the user.
 */
export async function discardImages(values) {
  for (const value of [].concat(values ?? [])) {
    const ref = parseRef(value);
    if (!ref) continue;
    try {
      await internalClient().removeObject(bucketFor(ref.visibility), ref.key);
    } catch (error) {
      console.warn('[storage] could not delete replaced image:', error.message);
    }
  }
}

/** Images in `before` that are no longer in `after`. */
export function replacedImages(before, after) {
  const kept = new Set([].concat(after ?? []));
  return [].concat(before ?? []).filter((value) => value && !kept.has(value));
}

// ── Startup ───────────────────────────────────────────────────────────────

/**
 * Proves storage is usable: configuration is complete and both buckets are
 * reachable with the app's own (restricted) credentials. Throws with every
 * problem found.
 */
export async function verifyStorage() {
  const problems = configurationProblems();
  if (problems.length) throw new Error(problems.join('; '));

  const config = storageConfig();
  for (const bucket of [config.publicBucket, config.privateBucket]) {
    let exists;
    try {
      exists = await internalClient().bucketExists(bucket);
    } catch (error) {
      throw new Error(`cannot reach object storage at ${config.endpoint}:${config.port} (${error.message})`);
    }
    if (!exists) {
      throw new Error(`bucket "${bucket}" does not exist — run \`docker compose up -d\` to bootstrap it`);
    }
  }
}
