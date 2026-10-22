'use strict';

require('dotenv').config();

const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL;
const DEVICE_ID = process.env.DEVICE_ID;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;

if (!BACKEND_URL || !DEVICE_ID || !DEVICE_TOKEN) {
  throw new Error('BACKEND_URL, DEVICE_ID and DEVICE_TOKEN are required.');
}

let shuttingDown = false;
const socket = io(BACKEND_URL, {
  auth: { deviceId: DEVICE_ID, token: DEVICE_TOKEN },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30_000,
  timeout: 10_000
});

socket.on('connect', () => {
  console.log(`Connected to notification backend (${socket.id}).`);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log(`Disconnected: ${reason}`);
});

function showToast(title, message) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'show-toast.ps1');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      scriptPath,
      '-Title',
      title,
      '-Message',
      message
    ], {
      windowsHide: true,
      shell: false
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
      }
    });
  });
}

socket.on('notification', async (event, acknowledge) => {
  if (typeof acknowledge !== 'function') {
    console.error('Received event without acknowledgement callback.');
    return;
  }

  if (
    !event ||
    typeof event.id !== 'string' ||
    typeof event.title !== 'string' ||
    typeof event.message !== 'string' ||
    event.title.length > 150 ||
    event.message.length > 1000
  ) {
    acknowledge({ ok: false, error: 'Invalid notification payload.' });
    return;
  }

  try {
    await showToast(event.title, event.message);
    console.log(`Toast command completed for notification ${event.id}.`);
    acknowledge({ ok: true, id: event.id });
  } catch (error) {
    console.error(`Toast failed for ${event.id}:`, error.message);
    acknowledge({ ok: false, id: event.id, error: 'Toast command failed.' });
  }
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Stopping Windows notification agent...');
  socket.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
