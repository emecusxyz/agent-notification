'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;
const DEVICE_ID = process.env.DEVICE_ID || 'my-windows-pc';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

if (!API_KEY || Buffer.byteLength(API_KEY) < 32) {
  throw new Error('API_KEY must be configured with at least 32 bytes.');
}
if (!DEVICE_TOKEN || Buffer.byteLength(DEVICE_TOKEN) < 32) {
  throw new Error('DEVICE_TOKEN must be configured with at least 32 bytes.');
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

const io = new Server(server, {
  cors: CORS_ORIGIN
    ? { origin: CORS_ORIGIN.split(',').map((value) => value.trim()) }
    : undefined,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 20_000
});

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb', strict: true }));

const notificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many notification requests. Try again shortly.' }
});

function safeEqual(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireApiKey(req, res, next) {
  const authorization = req.get('authorization') || '';
  const candidate = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';

  if (!safeEqual(candidate, API_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  if (
    auth.deviceId !== DEVICE_ID ||
    !safeEqual(auth.token, DEVICE_TOKEN)
  ) {
    return next(new Error('Unauthorized device'));
  }
  return next();
});

const deviceRoom = `device:${DEVICE_ID}`;
const activeSockets = new Set();

io.on('connection', (socket) => {
  socket.join(deviceRoom);
  activeSockets.add(socket.id);
  console.log(`Agent connected: ${DEVICE_ID}`);

  socket.on('disconnect', (reason) => {
    activeSockets.delete(socket.id);
    console.log(`Agent disconnected (${reason}): ${DEVICE_ID}`);
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agentConnected: activeSockets.size > 0,
    timestamp: new Date().toISOString()
  });
});

app.post(
  '/api/notifications',
  notificationLimiter,
  requireApiKey,
  async (req, res) => {
    const body = req.body || {};
    const { title, message } = body;
    const requestedDeviceId = body.deviceId || DEVICE_ID;

    if (
      typeof title !== 'string' ||
      typeof message !== 'string' ||
      !title.trim() ||
      !message.trim() ||
      title.length > 150 ||
      message.length > 1000
    ) {
      return res.status(400).json({
        error: 'title (max 150 chars) and message (max 1000 chars) are required.'
      });
    }

    if (requestedDeviceId !== DEVICE_ID) {
      return res.status(404).json({ error: 'Unknown device.' });
    }

    const room = io.sockets.adapter.rooms.get(deviceRoom);
    if (!room || room.size === 0) {
      return res.status(503).json({
        error: 'Windows agent is offline.',
        retryable: true
      });
    }

    const notification = {
      id: crypto.randomUUID(),
      title: title.trim(),
      message: message.trim(),
      createdAt: new Date().toISOString()
    };

    try {
      // Socket.IO acknowledgement means the agent's toast command exited successfully;
      // it does not prove that Windows displayed it or that a user saw it.
      const results = await io
        .to(deviceRoom)
        .timeout(8000)
        .emitWithAck('notification', notification);

      const acknowledged = Array.isArray(results) && results.length > 0 &&
        results.every((result) => result && result.ok === true);

      if (!acknowledged) {
        return res.status(502).json({
          error: 'Agent did not confirm the notification command.',
          notificationId: notification.id,
          retryable: true
        });
      }

      return res.status(202).json({
        accepted: true,
        notificationId: notification.id,
        acknowledged: true
      });
    } catch (error) {
      console.error('Notification delivery failed:', error.message);
      return res.status(503).json({
        error: 'Agent did not acknowledge in time.',
        notificationId: notification.id,
        retryable: true
      });
    }
  }
);

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error('Unhandled request error:', error);
  return res.status(500).json({ error: 'Internal server error.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Notification backend listening on ${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
