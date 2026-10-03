/**
 * Push-notification service (Firebase Cloud Messaging).
 *
 * Self-degrading: if firebase-admin isn't installed or no service-account
 * credentials are present, every call becomes a logged no-op so the rest of the
 * app keeps working. To enable real push:
 *   1. npm install firebase-admin
 *   2. Place your Firebase service-account JSON at grocery-backend/serviceAccountKey.json
 *      (or set FIREBASE_SERVICE_ACCOUNT to its absolute path).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { User, Notification, DeviceToken } from '../models/index.js';

// Where a web push notification opens when clicked. No default origin is
// baked in — pushes still deliver and display without one; only the
// click-through link is affected (the service worker falls back to its own
// origin). Set WEB_APP_URL, or this reuses the first CORS_ORIGINS entry
// since that is already the deployed web app's origin on most setups.
function webAppOrigin() {
  const explicit = (process.env.WEB_APP_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const first = (process.env.CORS_ORIGINS || '').split(',')[0]?.trim();
  return first ? first.replace(/\/+$/, '') : null;
}

// FCM token error codes that mean the token will never work again — the
// app was uninstalled, the browser revoked it, or it's malformed. Any other
// error (network blip, quota) leaves the row alone for the next attempt.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let messaging = null;
let initTried = false;

/**
 * Initializes Firebase on server startup, so a missing/bad service account
 * shows up immediately in the boot log instead of silently on the first
 * order placed — potentially hours or days later. Never throws: push is
 * optional (the app works without it), so a failure here only logs.
 */
export async function initPush() {
  await ensureInit();
  return messaging !== null;
}

async function ensureInit() {
  if (initTried) return messaging;
  initTried = true;
  try {
    const credPath =
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      path.join(__dirname, '../../serviceAccountKey.json');

    if (!fs.existsSync(credPath)) {
      console.warn('[notify] Firebase service account not found — push notifications disabled.');
      return null;
    }

    const mod = await import('firebase-admin');
    const admin = mod.default;
    const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    messaging = admin.messaging();
    console.log('[notify] Firebase Cloud Messaging initialized.');
  } catch (error) {
    console.warn('[notify] Firebase init failed — push notifications disabled:', error.message);
    messaging = null;
  }
  return messaging;
}

/**
 * Sends a push notification to a single user by id. Safe to await-and-forget:
 * never throws, degrades to a no-op when FCM isn't configured.
 */
export async function sendToUser(userId, title, body, data = {}) {
  try {
    if (!userId) {
      console.warn('[notify] skipped: no userId (order has no customerId?)');
      return;
    }

    // Save notification to DB history
    try {
      await Notification.create({
        userId,
        title,
        body,
        data: data || {},
        read: false
      });
      console.log(`[notify] saved notification to DB for user ${userId}: "${title}"`);
    } catch (dbError) {
      console.error('[notify] DB save failure:', dbError.message);
    }

    const msg = await ensureInit();
    if (!msg) {
      console.warn('[notify] skipped: FCM not initialized (service account / firebase-admin missing).');
      return;
    }

    // Every signed-in device/browser for this user gets pushed to. Older
    // accounts that haven't re-registered since this table was added fall
    // back to the legacy single-token column so they don't go dark.
    let tokens = (await DeviceToken.findAll({ where: { userId } })).map((row) => row.token);
    if (tokens.length === 0) {
      const user = await User.findByPk(userId);
      if (user?.deviceToken) tokens = [user.deviceToken];
    }
    if (tokens.length === 0) {
      console.warn(`[notify] skipped: user ${userId} has no device token registered.`);
      return;
    }

    // FCM data payload values must all be strings.
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const link = webAppOrigin();
    const response = await msg.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      // Each platform's FCM client applies only its own block below, so one
      // message safely covers phones and browsers at once.
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
      webpush: {
        notification: { icon: '/icons/Icon-192.png' },
        ...(link ? { fcmOptions: { link } } : {})
      }
    });
    console.log(`[notify] sent to user ${userId}: "${title}" (${response.successCount}/${tokens.length} delivered)`);

    // A token FCM reports as permanently dead (uninstalled, revoked,
    // malformed) is removed so future sends stop wasting a round trip on it.
    const dead = response.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? tokens[i] : null))
      .filter(Boolean);
    if (dead.length > 0) {
      await DeviceToken.destroy({ where: { token: dead } });
      console.log(`[notify] pruned ${dead.length} dead token(s) for user ${userId}`);
    }
  } catch (error) {
    // A bad/expired token or transient FCM error must never break the request.
    console.warn('[notify] send failed:', error.code || '', error.message);
  }
}
