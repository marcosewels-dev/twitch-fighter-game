import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { conectarDB } from './config/db.js';
import { inicializarTwitch } from './config/twitch.js';
import { configurarSockets } from './sockets.js';
import { Jugador } from './models/Jugador.js';

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"] : "*"
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
      const victoriasTotales = (j.guerrero?.victorias || 0) + 
                               (j.ninja?.victorias || 0) + 
                               (j.mago?.victorias || 0) +
                               (j.clerigo?.victorias || 0) + 
                               (j.cazador?.victorias || 0); 
      return { username: j.username, victorias: victoriasTotales, claseActual: j.claseActual };
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
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"] : "*", 
    methods: ["GET", "POST"] 
  }
});

// Inicialización asíncrona de la infraestructura
async function arrancarServidor() {
  await conectarDB();
  inicializarTwitch(io);
  configurarSockets(io);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor Modular balanceado corriendo en el puerto ${PORT}`);
  });
}

arrancarServidor();

// setTimeout(async () => {
//   console.log('🧪 [TEST] Iniciando simulación de cola de la arena...');
  
//   const { ArenaService } = await import('./services/arena.js');
//   const { configurarSockets, evaluarYEjecutarFlujo } = await import('./sockets.js');

//   // Creamos un array con 6 héroes ficticios para llenar el Matchmaker
//   const usuariosFicticios = [
//     { twitchId: 'test_1', nombre: 'EspectadorGuerrero', clase: 'guerrero', nivel: 3 },
//     { twitchId: 'test_2', nombre: 'EspectadorNinja', clase: 'ninja', nivel: 5 },
//     { twitchId: 'test_3', nombre: 'EspectadorMago', clase: 'mago', nivel: 2 },
//     { twitchId: 'test_4', nombre: 'EspectadorClerigo', clase: 'clerigo', nivel: 4 },
//     { twitchId: 'test_5', nombre: 'EspectadorCazador', clase: 'cazador', nivel: 1 },
//     { twitchId: 'test_6', nombre: 'EspectadorNovato', clase: 'guerrero', nivel: 1 },
//   ];

//   usuariosFicticios.forEach(user => {
//     const exito = ArenaService.agregarACola(user);
//     if (exito) console.log(`  🔹 Encolado: ${user.nombre} (Nv.${user.nivel})`);
//   });

//   console.log(`📊 Total en cola simulada: ${ArenaService.obtenerCola().length} jugadores.`);

//   // Evaluamos si el sistema decide arrancar el nuevo modo 3vs3 al haber 6 personas
//   console.log('🧪 [TEST] Invocando al selector de flujos del Matchmaker...');
//   evaluarYEjecutarFlujo(io);

// }, 5000);
