import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { conectarDB } from './config/db.js';
import { inicializarTwitch } from './config/twitch.js';
import { configurarSockets } from './sockets.js';
import { Jugador } from './models/Jugador.js';

// Limpiamos la URL (quitamos la barra '/' final si la tiene por error)
/*const frontendUrls = process.env.FRONTEND_URL 
  ? [process.env.FRONTEND_URL.replace(/\/$/, ""), "http://localhost:5173", "http://127.0.0.1:5173"] 
  : "*";

const app = express();
app.use(cors({
  origin: frontendUrls
}));

// Desactivar caché estricta para asegurar actualizaciones instantáneas del stream
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Endpoint público para consultar el Ranking (Top 10 Global)
app.get('/api/ranking', async (req, res) => {
  try {
    const jugadores = await Jugador.find();
    const ranking = jugadores.map(j => {
      const victoriasTotales = (j.get('guerrero')?.victorias || 0) + 
                               (j.get('ninja')?.victorias || 0) + 
                               (j.get('mago')?.victorias || 0) +
                               (j.get('clerigo')?.victorias || 0) + 
                               (j.get('cazador')?.victorias || 0); 
      return { username: j.get('username'), victorias: victoriasTotales, claseActual: j.get('claseActual') };
    })
    .filter(j => j.victorias > 0) 
    .sort((a, b) => b.victorias - a.victorias)
    .slice(0, 10);
    
    res.json(ranking);
  } catch (error) {
    console.error('Error al obtener ranking:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: frontendUrls, 
    methods: ["GET", "POST"] 
  }
});

// Inicialización asíncrona de la infraestructura
async function arrancarServidor() {
  await conectarDB();
  configurarSockets(io);
  inicializarTwitch(io); // Inicializamos el bot de Twitch pasándole la instancia de WebSockets

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor Modular balanceado corriendo en el puerto ${PORT}`);
  });
}

arrancarServidor();
*/
