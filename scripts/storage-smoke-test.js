// End-to-end check of image storage against a real MinIO + database.
//
//   npm run storage:smoke
//
// Drives the same flow a phone does — request a presigned upload, POST the
// file straight to storage, confirm it — and then tries every abuse case the
// design is meant to stop. Uses two throwaway user ids and deletes everything
// it created, so it is safe to run against a dev database. Exit code is
// non-zero if any check fails.
import 'dotenv/config';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { Client } from 'minio';
import { sequelize, UploadIntent } from '../src/models/index.js';
import {
  createUploadRequest,
  discardImages,
  resolveImageInput,
  toPrivateUrl,
  toPublicUrl,
  verifyStorage,
} from '../src/storage/imageStorage.js';
import { storageConfig } from '../src/storage/config.js';
import { internalClient } from '../src/storage/client.js';
import { parseRef } from '../src/storage/refs.js';

const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const createdRefs = [];
let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function expectError(name, fn, code) {
  try {
    await fn();
    check(name, false, 'expected an error, got success');
  } catch (error) {
    check(name, !code || error.code === code, `${error.status ?? ''} ${error.code ?? error.message}`.trim());
  }
}

/** A JPEG carrying EXIF, including a GPS position, like a real phone photo. */
async function phonePhoto() {
  return sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a7' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'smoke-test-secret-marker' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 58/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 35/1 0/1' },
    })
    .toBuffer();
}

/** Uploads bytes the way the app does: every policy field, then the file. */
async function postToStorage(request, bytes, { contentType, overrideFields = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...request.upload.fields, ...overrideFields })) {
    form.append(key, value);
  }
  form.append(request.upload.fileField, new Blob([bytes], { type: contentType ?? 'image/jpeg' }), 'photo');
  const response = await fetch(request.upload.url, { method: 'POST', body: form });
  return response.status;
}

async function uploadAndConfirm(purpose, bytes, userId = userA) {
  const request = await createUploadRequest({ userId, purpose, contentType: 'image/jpeg' });
  const status = await postToStorage(request, bytes);
  if (status !== 204) throw new Error(`upload POST returned ${status}`);
  const ref = await resolveImageInput(request.reference, { purpose, userId });
  createdRefs.push(ref);
  return { request, ref };
}

async function main() {
  const config = storageConfig();
  console.log(`Object storage: ${config.endpoint}:${config.port}  buckets: ${config.publicBucket} / ${config.privateBucket}\n`);

  await sequelize.authenticate();
  await UploadIntent.sync(); // no-op when the server has already created it
  await verifyStorage();
  check('storage configured and both buckets reachable with the app credentials', true);

  const photo = await phonePhoto();

  console.log('\nHappy path — public image');
  const { request, ref } = await uploadAndConfirm('product', photo);
  check('presigned upload issued for the private pending/ area',
    request.upload.fields.key?.startsWith(`pending/product/${userA}/`), request.upload.fields.key);
  check('confirmed upload stored as a public reference, not a URL', parseRef(ref)?.visibility === 'public', ref);
  const publicUrl = toPublicUrl(ref);
  const publicResponse = await fetch(publicUrl);
  check('public image readable anonymously', publicResponse.status === 200, publicUrl);
  check('re-encoded to WebP', publicResponse.headers.get('content-type') === 'image/webp');
  const stored = Buffer.from(await publicResponse.arrayBuffer());
  const storedMeta = await sharp(stored).metadata();
  check('EXIF (incl. GPS location) stripped from the stored image',
    !storedMeta.exif && !stored.includes('smoke-test-secret-marker'));

  console.log('\nAbuse cases the design must stop');
  await expectError('same upload cannot be attached twice',
    () => resolveImageInput(request.reference, { purpose: 'product', userId: userA }), 'UPLOAD_INVALID');

  const forB = await createUploadRequest({ userId: userA, purpose: 'product', contentType: 'image/jpeg' });
  await postToStorage(forB, photo);
  await expectError("another user cannot attach someone else's upload",
    () => resolveImageInput(forB.reference, { purpose: 'product', userId: userB }), 'UPLOAD_INVALID');
  await expectError('an upload cannot be attached for a different purpose',
    () => resolveImageInput(forB.reference, { purpose: 'driving_licence', userId: userA }), 'UPLOAD_INVALID');

  const big = await createUploadRequest({ userId: userA, purpose: 'product', contentType: 'image/jpeg' });
  const bigStatus = await postToStorage(big, Buffer.alloc(6 * 1024 * 1024, 1));
  check('storage itself rejects a file over 5 MB', bigStatus === 400, `HTTP ${bigStatus}`);

  const typed = await createUploadRequest({ userId: userA, purpose: 'product', contentType: 'image/jpeg' });
  const typeStatus = await postToStorage(typed, photo, { overrideFields: { 'Content-Type': 'text/html' } });
  check('storage rejects a content type the policy did not sign', typeStatus === 403, `HTTP ${typeStatus}`);

  const moved = await createUploadRequest({ userId: userA, purpose: 'product', contentType: 'image/jpeg' });
  const keyStatus = await postToStorage(moved, photo, { overrideFields: { key: 'products/2026/01/overwrite.webp' } });
  check('storage rejects a client choosing its own object key', keyStatus === 403, `HTTP ${keyStatus}`);

  const fake = await createUploadRequest({ userId: userA, purpose: 'product', contentType: 'image/jpeg' });
  await postToStorage(fake, Buffer.from('<html><script>alert(1)</script></html>'));
  await expectError('a non-image with an image content type is refused at confirm',
    () => resolveImageInput(fake.reference, { purpose: 'product', userId: userA }), 'IMAGE_INVALID');
  const fakeIntent = await UploadIntent.findByPk(fake.uploadId);
  check('...and that upload is marked rejected so it cannot be retried', fakeIntent?.status === 'rejected');

  await expectError('an unknown upload id is refused',
    () => resolveImageInput(`upload:${crypto.randomUUID()}`, { purpose: 'product', userId: userA }), 'UPLOAD_INVALID');

  console.log('\nPrivate image — driving licence');
  const licence = await uploadAndConfirm('driving_licence', photo);
  check('licence stored as a private reference', parseRef(licence.ref)?.visibility === 'private', licence.ref);
  const rawPrivateUrl = `http://${config.endpoint}:${config.port}/${config.privateBucket}/${parseRef(licence.ref).key}`;
  check('licence NOT readable anonymously', (await fetch(rawPrivateUrl)).status === 403);
  check('licence never becomes a public URL', toPublicUrl(licence.ref) === null);
  const signed = await toPrivateUrl(licence.ref);
  check('licence readable through a short-lived signed link', (await fetch(signed)).status === 200);
  check('signed link expires in 15 minutes', /X-Amz-Expires=900\b/.test(signed));

  const pendingUrl = `http://${config.endpoint}:${config.port}/${config.privateBucket}/${forB.upload.fields.key}`;
  check('not-yet-confirmed uploads are not readable anonymously', (await fetch(pendingUrl)).status === 403);
  const listing = await fetch(`http://${config.endpoint}:${config.port}/${config.publicBucket}/`);
  check('public bucket cannot be listed anonymously', listing.status === 403, `HTTP ${listing.status}`);

  console.log('\nEditing without changing the image, and injected references');
  check('echoing back the URL the client was given keeps the stored image',
    (await resolveImageInput(publicUrl, { purpose: 'product', userId: userA, current: [ref] })) === ref);
  await expectError("a client cannot point a record at another stored image (e.g. someone's licence)",
    () => resolveImageInput(licence.ref, { purpose: 'profile_picture', userId: userB, current: null }),
    'IMAGE_REFERENCE_REJECTED');
  await expectError('a client cannot point a record at an arbitrary external URL',
    () => resolveImageInput('https://evil.example.com/x.png', { purpose: 'product', userId: userA }),
    'IMAGE_REFERENCE_REJECTED');

  console.log('\nOlder app versions (base64 in the request)');
  const legacyRef = await resolveImageInput(`data:image/jpeg;base64,${photo.toString('base64')}`,
    { purpose: 'profile_picture', userId: userA });
  createdRefs.push(legacyRef);
  check('base64 still accepted, and lands in object storage (not on disk)', parseRef(legacyRef)?.visibility === 'public', legacyRef);
  await expectError('base64 that is not an image is refused',
    () => resolveImageInput(Buffer.from('not an image').toString('base64'), { purpose: 'product', userId: userA }),
    'IMAGE_INVALID');

  console.log('\nLeast privilege');
  const app = new Client({
    endPoint: config.endpoint, port: config.port, useSSL: config.useSSL,
    accessKey: config.accessKey, secretKey: config.secretKey, region: config.region,
  });
  await expectError('the app credentials cannot create buckets', () => app.makeBucket(`smoke-${Date.now()}`));
  await expectError('the app credentials cannot change bucket access policy',
    () => app.setBucketPolicy(config.privateBucket, JSON.stringify({ Version: '2012-10-17', Statement: [] })));
}

try {
  await main();
} catch (error) {
  failures++;
  console.error('\nSmoke test aborted:', error);
} finally {
  await discardImages(createdRefs);
  // Uploads this run issued but never confirmed (the abuse cases).
  const intents = await UploadIntent.findAll({ where: { userId: [userA, userB] } }).catch(() => []);
  for (const intent of intents) {
    await internalClient().removeObject(storageConfig().privateBucket, intent.objectKey).catch(() => {});
  }
  await UploadIntent.destroy({ where: { userId: [userA, userB] } }).catch(() => {});
  await sequelize.close().catch(() => {});
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}
