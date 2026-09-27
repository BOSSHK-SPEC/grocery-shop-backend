// Moves images from the old local-disk store (public/uploads/, referenced as
// "/uploads/<file>") into object storage and repoints the database rows.
//
//   npm run storage:migrate            # dry run: report only, change nothing
//   npm run storage:migrate -- --apply # do it
//
// Safe by construction:
//  - COPIES, never deletes: public/uploads/ is left exactly as it is, so
//    rolling back is just restoring the old column values;
//  - idempotent: only values still in the legacy form are touched, so a
//    second run finds nothing to do;
//  - every image goes through the same pipeline as a live upload (validated,
//    re-encoded, metadata stripped), and driving licences land in the PRIVATE
//    bucket — today they sit in a publicly served folder;
//  - a missing or unreadable file leaves that row unchanged and is reported.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Business, Product, User, sequelize } from '../src/models/index.js';
import { storeImageBuffer, verifyStorage } from '../src/storage/imageStorage.js';
import { canonicalizeClientValue, isLegacyUploadPath, LEGACY_UPLOAD_PREFIX } from '../src/storage/refs.js';
import { storageConfig } from '../src/storage/config.js';

const APPLY = process.argv.includes('--apply');
const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/uploads');

const stats = { rows: 0, images: 0, migrated: 0, missing: 0, invalid: 0 };
const problems = [];
const cache = new Map(); // `${purpose}|${legacyPath}` -> new reference

/** "/uploads/x.png" or "http://host/uploads/x.png" -> "/uploads/x.png", else null. */
function legacyPathOf(value) {
  if (typeof value !== 'string') return null;
  const canonical = canonicalizeClientValue(value, { publicBucket: storageConfig().publicBucket });
  return isLegacyUploadPath(canonical) ? canonical : null;
}

async function migrateValue(value, purpose, where) {
  const legacyPath = legacyPathOf(value);
  if (!legacyPath) return value;
  stats.images++;

  const cacheKey = `${purpose}|${legacyPath}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // basename only: a stored value must never be able to read outside the folder
  const fileName = path.basename(legacyPath.slice(LEGACY_UPLOAD_PREFIX.length));
  let bytes;
  try {
    bytes = await fs.readFile(path.join(UPLOAD_DIR, fileName));
  } catch {
    stats.missing++;
    problems.push(`missing file ${legacyPath} (${where}) — row left unchanged`);
    return value;
  }

  if (!APPLY) {
    stats.migrated++;
    console.log(`  ${where}: ${legacyPath} -> (new ${purpose} image)`);
    cache.set(cacheKey, `(would store as ${purpose})`);
    return cache.get(cacheKey);
  }
  try {
    const ref = await storeImageBuffer(bytes, purpose);
    stats.migrated++;
    cache.set(cacheKey, ref);
    // The rollback record: restoring a column to the left-hand value undoes
    // the migration for that row (the file is still in public/uploads/).
    console.log(`  ${where}: ${legacyPath} -> ${ref}`);
    return ref;
  } catch (error) {
    stats.invalid++;
    problems.push(`could not store ${legacyPath} (${where}): ${error.message} — row left unchanged`);
    return value;
  }
}

async function migrateProducts() {
  for (const product of await Product.findAll()) {
    const before = product.getDataValue('productThumbnail') || [];
    if (!before.some(legacyPathOf)) continue;
    stats.rows++;
    const after = [];
    for (const value of before) after.push(await migrateValue(value, 'product', `product ${product.id}`));
    if (APPLY && after.some((v, i) => v !== before[i])) {
      await product.update({ productThumbnail: after });
    }
  }
}

async function migrateBusinesses() {
  for (const business of await Business.findAll()) {
    const before = business.getDataValue('businessDp');
    if (!legacyPathOf(before)) continue;
    stats.rows++;
    const after = await migrateValue(before, 'business_logo', `business ${business.id}`);
    if (APPLY && after !== before) await business.update({ businessDp: after });
  }
}

async function migrateUsers() {
  for (const user of await User.findAll()) {
    const beforePic = user.getDataValue('profilePic');
    const beforeDl = user.misc?.dlPic;
    if (!legacyPathOf(beforePic) && !legacyPathOf(beforeDl)) continue;
    stats.rows++;

    const afterPic = await migrateValue(beforePic, 'profile_picture', `user ${user.id} profilePic`);
    // Licences go to the PRIVATE bucket: the reason this migration matters.
    const afterDl = await migrateValue(beforeDl, 'driving_licence', `user ${user.id} licence`);
    if (!APPLY) continue;

    if (afterPic !== beforePic) user.profilePic = afterPic;
    if (afterDl !== beforeDl) {
      user.misc = { ...user.misc, dlPic: afterDl };
      user.changed('misc', true); // JSON columns need the dirty flag set by hand
    }
    if (user.changed()) await user.save();
  }
}

try {
  console.log(APPLY ? 'Migrating legacy uploads into object storage…' : 'DRY RUN — nothing will be changed. Re-run with --apply to migrate.');
  await sequelize.authenticate();
  if (APPLY) await verifyStorage();

  await migrateProducts();
  await migrateBusinesses();
  await migrateUsers();

  console.log(`\nRows with legacy images: ${stats.rows}`);
  console.log(`Image values:            ${stats.images}`);
  console.log(`${APPLY ? 'Migrated' : 'Would migrate'} (distinct files): ${stats.migrated}`);
  console.log(`Missing files:           ${stats.missing}`);
  if (APPLY) console.log(`Not valid images:        ${stats.invalid}`);
  for (const line of problems) console.log(`  - ${line}`);
  if (APPLY && stats.migrated) {
    console.log('\npublic/uploads/ was left untouched. Once the app shows every image correctly,');
    console.log('it can be archived and the /uploads static route removed from src/app.js.');
  }
  process.exitCode = problems.length && APPLY ? 1 : 0;
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
