import { WebSocketServer } from 'ws';
import { verifyAccessToken } from './tokens.js';
import { Business, User } from '../models/index.js';
import * as trackingHub from '../features/tracking/trackingHub.js';
import { loadOrderForTracking, roleOnOrder, buildSnapshot } from '../features/tracking/trackingService.js';

const clients = new Map();

const MAX_PAYLOAD_BYTES = 4096; // every client message is a tiny JSON command
const HEARTBEAT_MS = 30 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX_MESSAGES = 30;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_RATE_LIMITED = 4429;

const sendJson = (ws, payload) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
};

// Handles { type:'track', orderId, token }. Failures are reported on the
// socket rather than closing it, so one bad order id does not drop the
// merchant/other-order subscriptions sharing the connection.
async function handleTrack(ws, data) {
  const orderId = typeof data.orderId === 'string' ? data.orderId : '';
  if (!orderId || typeof data.token !== 'string') {
    return sendJson(ws, { type: 'error', code: 'BAD_REQUEST', orderId });
  }
  let decoded;
  try {
    decoded = verifyAccessToken(data.token);
  } catch {
    ws.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
    return;
  }
  const user = await User.findByPk(decoded.userId);
  if (!user || user.status === 'SUSPENDED') {
    ws.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
    return;
  }
  const order = await loadOrderForTracking(orderId);
  // Same answer for "no such order" and "not yours": never confirm existence.
  if (!order || !roleOnOrder(order, user, decoded.role)) {
    return sendJson(ws, { type: 'error', code: 'NOT_FOUND', orderId });
  }
  if (!trackingHub.subscribe(orderId, ws)) {
    return sendJson(ws, { type: 'error', code: 'TOO_MANY_SUBSCRIPTIONS', orderId });
  }
  // The token's expiry bounds the connection (enforced by the heartbeat), so a
  // session that ends or is revoked cannot keep receiving locations forever.
  ws.authExpiresAt = Math.min(ws.authExpiresAt ?? Infinity, (decoded.exp ?? 0) * 1000 || Infinity);
  sendJson(ws, { type: 'snapshot', data: await buildSnapshot(order) });
}

// A caller may register for a businessCode only if they own that business
// or administer the platform (admin/super_admin).
const canAccessBusiness = async (decoded, businessCode) => {
  if (decoded.role === 'admin' || decoded.role === 'super_admin') return true;
  const business = await Business.findOne({ where: { businessCode } });
  return !!business && business.ownerId === decoded.userId;
};

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

  // Drop connections whose peer vanished (phone lost signal) or whose access
  // token has expired — the client reconnects with a refreshed token.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.authExpiresAt && Date.now() > ws.authExpiresAt) {
        ws.close(CLOSE_UNAUTHORIZED, 'Token expired');
        continue;
      }
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    let registeredCode = null;
    let windowStart = Date.now();
    let windowCount = 0;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', (err) => console.error('[WS] Socket error:', err.message));

    ws.on('message', async (message) => {
      if (Date.now() - windowStart > RATE_WINDOW_MS) {
        windowStart = Date.now();
        windowCount = 0;
      }
      if (++windowCount > RATE_MAX_MESSAGES) {
        ws.close(CLOSE_RATE_LIMITED, 'Too many messages');
        return;
      }
      try {
        const data = JSON.parse(message);
        if (data.type === 'track') {
          await handleTrack(ws, data);
        } else if (data.type === 'untrack' && typeof data.orderId === 'string') {
          trackingHub.unsubscribe(data.orderId, ws);
        } else if (data.type === 'ping') {
          ws.isAlive = true;
          sendJson(ws, { type: 'pong' });
        } else if (data.type === 'register' && data.businessCode && data.token) {
          let decoded;
          try {
            decoded = verifyAccessToken(data.token);
          } catch {
            ws.close(4401, 'Unauthorized');
            return;
          }
          const allowed = await canAccessBusiness(decoded, data.businessCode);
          if (!allowed) {
            ws.close(4403, 'Forbidden');
            return;
          }
          registeredCode = data.businessCode;
          if (!clients.has(registeredCode)) {
            clients.set(registeredCode, new Set());
          }
          const storeClients = clients.get(registeredCode);
          if (!storeClients.has(ws)) {
            storeClients.add(ws);
            console.log(`[WS] Client registered for business: ${registeredCode}`);
          }
        }
      } catch (e) {
        console.error('[WS] Error processing message:', e);
      }
    });

    ws.on('close', () => {
      trackingHub.unsubscribeAll(ws);
      if (registeredCode && clients.has(registeredCode)) {
        clients.get(registeredCode).delete(ws);
        if (clients.get(registeredCode).size === 0) {
          clients.delete(registeredCode);
        }
        console.log(`[WS] Client disconnected from business: ${registeredCode}`);
      }
    });
  });

  console.log('[WS] WebSocket Server initialized.');
};

export const notifyMerchant = (businessCode, payload) => {
  if (clients.has(businessCode)) {
    const message = JSON.stringify(payload);
    for (const ws of clients.get(businessCode)) {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
      }
    }
    console.log(`[WS] Notified merchant ${businessCode} of event: ${payload.type}`);
  }
};
