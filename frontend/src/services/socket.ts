import { io } from 'socket.io-client';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000').trim();

export const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  upgrade: false,
  secure: false
});