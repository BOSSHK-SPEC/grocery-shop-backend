import { WebSocketServer } from 'ws';
import { verifyAccessToken } from './tokens.js';
import { Business } from '../models/index.js';

const clients = new Map();

// A caller may register for a businessCode only if they own that business
// or administer the platform (admin/super_admin).
const canAccessBusiness = async (decoded, businessCode) => {
  if (decoded.role === 'admin' || decoded.role === 'super_admin') return true;
  const business = await Business.findOne({ where: { businessCode } });
  return !!business && business.ownerId === decoded.userId;
};

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let registeredCode = null;

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'register' && data.businessCode && data.token) {
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
          clients.get(registeredCode).add(ws);
          console.log(`[WS] Client registered for business: ${registeredCode}`);
        }
      } catch (e) {
        console.error('[WS] Error processing message:', e);
      }
    });

    ws.on('close', () => {
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
