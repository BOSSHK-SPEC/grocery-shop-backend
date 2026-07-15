import { WebSocketServer } from 'ws';

const clients = new Map();

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let registeredCode = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'register' && data.businessCode) {
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
