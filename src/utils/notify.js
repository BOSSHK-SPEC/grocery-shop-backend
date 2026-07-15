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
import { User, Notification } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let messaging = null;
let initTried = false;

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

    const user = await User.findByPk(userId);
    const token = user?.deviceToken;
    if (!token) {
      console.warn(`[notify] skipped: user ${userId} has no deviceToken registered.`);
      return;
    }

    // FCM data payload values must all be strings.
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const id = await msg.send({
      token,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    console.log(`[notify] sent to user ${userId}: "${title}" (messageId ${id})`);
  } catch (error) {
    // A bad/expired token or transient FCM error must never break the request.
    console.warn('[notify] send failed:', error.code || '', error.message);
  }
}
