import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import tmi from 'tmi.js';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
app.use(cors());

// Endpoint público para consultar el Ranking (Top 10 Global)
app.get('/api/ranking', async (req, res) => {
  try {
    const jugadores = await Jugador.find();
    
    // Calculamos las victorias totales sumando el rendimiento de todas sus clases
    const ranking = jugadores.map(j => {
      const victoriasTotales = (j.guerrero?.victorias || 0) + 
                               (j.ninja?.victorias || 0) + 
                               (j.mago?.victorias || 0);
      return {
        username: j.username,
        victorias: victoriasTotales,
        claseActual: j.claseActual
      };
    })
    .filter(j => j.victorias > 0) // Solo listamos jugadores con victorias
    .sort((a, b) => b.victorias - a.victorias)
    .slice(0, 10);

    res.json(ranking);
  } catch (error) {
    console.error('Error al obtener ranking:', error);
    res.status(500).json({ error: 'Error al obtener el ranking de la base de datos' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "*"], // Permitimos local y Vercel en producción
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ==========================================
// 💾 CONEXIÓN A MONGODB ATLAS
// ==========================================
// Usa tu variable de entorno en Render para producción
const MONGO_URI = process.env.MONGO_URI || 'TU_CADENA_DE_CONEXION_DE_MONGODB_ATLAS';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado con éxito a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Esquema de base de datos
const jugadorSchema = new mongoose.Schema({
  twitchId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  claseActual: { type: String, default: 'guerrero' },
  
  guerrero: {
    nivel: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    victorias: { type: Number, default: 0 },
    derrotas: { type: Number, default: 0 }
  },
  ninja: {
    nivel: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    victorias: { type: Number, default: 0 },
    derrotas: { type: Number, default: 0 }
  },
  mago: {
    nivel: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    victorias: { type: Number, default: 0 },
    derrotas: { type: Number, default: 0 }
  }
});

const Jugador = mongoose.model('Jugador', jugadorSchema);

// ==========================================
// ⚔️ CONTROL DE LA COLA Y COMBATES
// ==========================================
interface JugadorPelea {
  twitchId: string;
  nombre: string;
  clase: string;
  nivel: number;
}

let colaEspera: JugadorPelea[] = [];
let peleaEnCurso = false;
let luchadorActual1: JugadorPelea | null = null;
let luchadorActual2: JugadorPelea | null = null;

// ==========================================
// 🔌 CONEXIÓN REAL A TWITCH (ACTIVA)
// ==========================================
const twitchClient = new tmi.Client({
  options: { debug: true },
  channels: [ 'danqvix' ] // <--- ¡Cambia esto por el canal de tu amigo!
});
twitchClient.connect().catch(console.error);

twitchClient.on('message', async (channel, tags, message, self) => {
  if (self) return;

  const msg = message.trim().toLowerCase();
  
  // COMANDO !LUCHAR
  if (msg.startsWith('!luchar')) {
    const twitchId = tags['user-id'];
    const username = tags['display-name'] || tags.username;
    
    if (!twitchId || !username) return;

    if (colaEspera.some(j => j.twitchId === twitchId)) {
      twitchClient.say(channel, `@${username}, ya estás en cola.`);
      return;
    }

    const partes = msg.split(' ');
    let claseElegida = partes[1] || '';
    const clasesValidas = ['guerrero', 'ninja', 'mago'];

    let perfil = await Jugador.findOne({ twitchId });
    if (!perfil) {
      perfil = new Jugador({
        twitchId,
        username,
        claseActual: clasesValidas.includes(claseElegida) ? claseElegida : 'guerrero'
      });
      await perfil.save();
    }

    if (clasesValidas.includes(claseElegida) && perfil.claseActual !== claseElegida) {
      perfil.claseActual = claseElegida;
      await perfil.save();
      const nivelNuevaClase = (perfil as any)[claseElegida].nivel;
      twitchClient.say(channel, `🔄 @${username} cambió su rol a [${claseElegida.toUpperCase()}] (Nivel ${nivelNuevaClase})!`);
    }

    const claseActual = perfil.claseActual;
    const nivelActual = (perfil as any)[claseActual].nivel;

    colaEspera.push({
      twitchId,
      nombre: username,
      clase: claseActual,
      nivel: nivelActual
    });

    twitchClient.say(channel, `⚔️ @${username} [${claseActual.toUpperCase()} Nv.${nivelActual}] listo en cola!`);
    io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));
    chequearSiguientePelea();
  }

  // COMANDO !RANKING
  else if (msg === '!ranking' || msg === '!top') {
    try {
      const jugadores = await Jugador.find();
      
      const ranking = jugadores.map(j => {
        const victoriasTotales = (j.guerrero?.victorias || 0) + 
                                 (j.ninja?.victorias || 0) + 
                                 (j.mago?.victorias || 0);
        return { username: j.username, victorias: victoriasTotales };
      })
      .filter(j => j.victorias > 0)
      .sort((a, b) => b.victorias - a.victorias)
      .slice(0, 5);

      if (ranking.length === 0) {
        twitchClient.say(channel, "🏆 ¡La arena está limpia! Aún no hay campeones con victorias.");
        return;
      }

      const textoRanking = ranking.map((j, index) => `${index + 1}. @${j.username} (${j.victorias} 👑)`).join(' | ');
      twitchClient.say(channel, `🏆 TOP 5 ARENA: ${textoRanking}`);
    } catch (error) {
      console.error('Error al procesar !ranking:', error);
    }
  }
});

function chequearSiguientePelea() {
  if (peleaEnCurso || colaEspera.length < 2) return;

  peleaEnCurso = true;
  luchadorActual1 = colaEspera.shift() || null;
  luchadorActual2 = colaEspera.shift() || null;

  if (!luchadorActual1 || !luchadorActual2) {
    peleaEnCurso = false;
    return;
  }

  io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));
  io.emit('iniciar_pelea', { 
    p1: luchadorActual1.nombre, 
    claseP1: luchadorActual1.clase, 
    p2: luchadorActual2.nombre, 
    claseP2: luchadorActual2.clase 
  });
}

// Conexiones WebSockets
io.on('connection', (socket) => {
  console.log('Frontend conectado.');
  socket.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));

  // 🧪 [DESACTIVADO EN PRODUCCIÓN] Pruebas locales comentadas
  /*
  socket.on('test_unirse_cola', async (datos: { nombre: string, clase: string }) => {
    const fakeTwitchId = `test_id_${datos.nombre.toLowerCase()}`;
    
    let perfil = await Jugador.findOne({ twitchId: fakeTwitchId });
    if (!perfil) {
      perfil = new Jugador({
        twitchId: fakeTwitchId,
        username: datos.nombre,
        claseActual: datos.clase
      });
      await perfil.save();
      console.log(`💾 [MongoDB] Creado nuevo perfil para: ${datos.nombre}`);
    } else {
      if (perfil.claseActual !== datos.clase) {
        perfil.claseActual = datos.clase;
        await perfil.save();
        console.log(`🔄 [MongoDB] Actualizada clase de ${datos.nombre} a ${datos.clase}`);
      }
    }

    const claseActual = perfil.claseActual;
    const nivelActual = (perfil as any)[claseActual].nivel;

    colaEspera.push({
      twitchId: fakeTwitchId,
      nombre: datos.nombre,
      clase: claseActual,
      nivel: nivelActual
    });

    io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));
    chequearSiguientePelea();
  });
  */

  // Procesar final del combate y guardar XP
  socket.on('pelea_terminada', async (datos: { ganador: string }) => {
    if (!luchadorActual1 || !luchadorActual2) return;

    const ganadorNombre = datos.ganador;
    const esP1Ganador = luchadorActual1.nombre === ganadorNombre;
    
    const idGanador = esP1Ganador ? luchadorActual1.twitchId : luchadorActual2.twitchId;
    const idPerdedor = esP1Ganador ? luchadorActual2.twitchId : luchadorActual1.twitchId;

    const claseGanador = esP1Ganador ? luchadorActual1.clase : luchadorActual2.clase;
    const clasePerdedor = esP1Ganador ? luchadorActual2.clase : luchadorActual1.clase;

    try {
      // 1. Ganador: +50 XP y +1 Victoria
      const perfilGanador = await Jugador.findOne({ twitchId: idGanador });
      if (perfilGanador) {
        const claseData = (perfilGanador as any)[claseGanador];
        claseData.victorias += 1;
        claseData.xp += 50;

        const xpNecesaria = claseData.nivel * 100;
        if (claseData.xp >= xpNecesaria) {
          claseData.nivel += 1;
          claseData.xp = 0;
          console.log(`🎉 ¡LEVEL UP! @${perfilGanador.username} subió a Nivel ${claseData.nivel} (${claseGanador})`);
        }
        await perfilGanador.save();
      }

      // 2. Perdedor: +15 XP y +1 Derrota
      const perfilPerdedor = await Jugador.findOne({ twitchId: idPerdedor });
      if (perfilPerdedor) {
        const claseData = (perfilPerdedor as any)[clasePerdedor];
        claseData.derrotas += 1;
        claseData.xp += 15;

        const xpNecesaria = claseData.nivel * 100;
        if (claseData.xp >= xpNecesaria) {
          claseData.nivel += 1;
          claseData.xp = 0;
          console.log(`🎉 ¡LEVEL UP! @${perfilPerdedor.username} subió a Nivel ${claseData.nivel} (${clasePerdedor})`);
        }
        await perfilPerdedor.save();
      }
    } catch (error) {
      console.error('Error al actualizar estadísticas:', error);
    }

    luchadorActual1 = null;
    luchadorActual2 = null;

    setTimeout(() => {
      peleaEnCurso = false;
      chequearSiguientePelea();
    }, 5000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
