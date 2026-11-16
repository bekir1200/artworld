// Process-local abuse control. Do not trust client-provided forwarding headers.
const WINDOW_MS = 60_000;
const MAX_CLIENTS = 10_000;
const MAX_EVENTS_PER_CLIENT = 60;
const clients = new Map();

function allowAdEvent(address, eventType, creativeId, placement, now = Date.now()) {
  const window = Math.floor(now / WINDOW_MS);
  const key = address || 'unknown';
  let client = clients.get(key);
  if (!client || client.window !== window) {
    if (clients.size >= MAX_CLIENTS) {
      for (const [ip, entry] of clients) if (entry.window !== window) clients.delete(ip);
      if (!clients.has(key) && clients.size >= MAX_CLIENTS) return false;
    }
    client = { window, count: 0, events: new Set() };
    clients.set(key, client);
  }
  const event = `${eventType}:${creativeId}:${placement}`;
  if (client.count >= MAX_EVENTS_PER_CLIENT || client.events.has(event)) return false;
  client.count++;
  client.events.add(event);
  return true;
}

module.exports = { allowAdEvent };
