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
    
    const ranking = jugadores.map(j => {
      const victoriasTotales = (j.guerrero?.victorias || 0) + 
                               (j.ninja?.victorias || 0) + 
                               (j.mago?.victorias || 0) +
                               (j.clerigo?.victorias || 0) + 
                               (j.cazador?.victorias || 0); 
      return {
        username: j.username,
        victorias: victoriasTotales,
        claseActual: j.claseActual
      };
    })
    .filter(j => j.victorias > 0) 
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
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "*"], 
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ==========================================
// 💾 CONEXIÓN A MONGODB ATLAS
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'ERROR: No se ha configurado la variable de entorno MONGO_URI';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado con éxito a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Esquema de base de datos completo para las 5 clases
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
  },
  clerigo: { 
    nivel: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    victorias: { type: Number, default: 0 },
    derrotas: { type: Number, default: 0 }
  },
  cazador: { 
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
// 🔌 CONEXIÓN CONFIGURABLE A TWITCH
// ==========================================
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || 'EL_CANAL_DE_TU_AMIGO';
const TWITCH_BOT_USER = process.env.TWITCH_BOT_USER; 
const TWITCH_OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN; 

const tmiOptions: any = {
  options: { debug: true },
  channels: [ TWITCH_CHANNEL ]
};

if (TWITCH_BOT_USER && TWITCH_OAUTH_TOKEN) {
  tmiOptions.identity = {
    username: TWITCH_BOT_USER,
    password: TWITCH_OAUTH_TOKEN
  };
}

const twitchClient = new tmi.Client(tmiOptions);
twitchClient.connect().catch(console.error);

function enviarMensajeChat(canal: string, mensaje: string) {
  if (!TWITCH_BOT_USER || !TWITCH_OAUTH_TOKEN) {
    console.log(`⚠️ [CHAT SIMULADO]: ${mensaje}`);
    return;
  }
  twitchClient.say(canal, mensaje).catch(err => {
    console.error('❌ Error al enviar mensaje al chat de Twitch:', err);
  });
}

twitchClient.on('message', async (channel, tags, message, self) => {
  if (self) return;

  const msg = message.trim().toLowerCase();
  const twitchId = tags['user-id'];
  const username = tags['display-name'] || tags.username;
  
  if (!twitchId || !username) return;

  // COMANDO: !COMANDOS / !AYUDA
  if (msg === '!comandos' || msg === '!ayuda' || msg === '!arena') {
    enviarMensajeChat(
      channel, 
      `🎮 [ARENA COMMANDS] ⚔️ !luchar [clase] (Clases: guerrero, ninja, mago, clerigo, cazador) | 👤 !stats | 🔄 !clase [rol] | 🏆 !ranking`
    );
    return;
  }

  // COMANDO: !LUCHAR
  if (msg.startsWith('!luchar')) {
    if (colaEspera.some(j => j.twitchId === twitchId)) {
      enviarMensajeChat(channel, `@${username}, ya estás en la cola de espera de la arena.`);
      return;
    }

    const partes = msg.split(' ');
    let claseElegida = partes[1] || '';
    const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];

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
      enviarMensajeChat(channel, `🔄 @${username} cambió su rol activo a [${claseElegida.toUpperCase()}] (Nivel ${nivelNuevaClase})!`);
    }

    const claseActual = perfil.claseActual;
    const nivelActual = (perfil as any)[claseActual].nivel;

    colaEspera.push({
      twitchId,
      nombre: username,
      clase: claseActual,
      nivel: nivelActual
    });

    enviarMensajeChat(channel, `⚔️ @${username} [${claseActual.toUpperCase()} Nv.${nivelActual}] listo en la cola! (Total: ${colaEspera.length})`);
    io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));
    chequearSiguientePelea();
  }

  // COMANDO: !STATS / !PERFIL
  else if (msg === '!stats' || msg === '!perfil') {
    try {
      const perfil = await Jugador.findOne({ twitchId });
      
      if (!perfil) {
        enviarMensajeChat(channel, `👋 @${username}, aún no has luchado en la arena. ¡Escribe !luchar para registrarte gratis!`);
        return;
      }

      const clase = perfil.claseActual;
      const claseData = (perfil as any)[clase];
      const xpSiguienteNivel = claseData.nivel * 100;

      enviarMensajeChat(
        channel, 
        `👤 [@${username}] Rol Activo: ${clase.toUpperCase()} (Nv. ${claseData.nivel}) | 📈 XP: ${claseData.xp}/${xpSiguienteNivel} | 👑 Victorias: ${claseData.victorias} | 💀 Derrotas: ${claseData.derrotas}`
      );
    } catch (error) {
      console.error('Error al procesar !stats:', error);
    }
  }

  // COMANDO: !CLASE [guerrero/ninja/mago/clerigo/cazador]
  else if (msg.startsWith('!clase') || msg.startsWith('!rol')) {
    const partes = msg.split(' ');
    const claseElegida = partes[1];
    const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];

    if (!claseElegida || !clasesValidas.includes(claseElegida)) {
      enviarMensajeChat(channel, `❌ @${username}, elige una clase válida: guerrero, ninja, mago, clerigo, cazador`);
      return;
    }

    try {
      let perfil = await Jugador.findOne({ twitchId });
      
      if (!perfil) {
        perfil = new Jugador({
          twitchId,
          username,
          claseActual: claseElegida
        });
        await perfil.save();
      } else {
        perfil.claseActual = claseElegida;
        await perfil.save();
      }

      const nivelClase = (perfil as any)[claseElegida].nivel;
      enviarMensajeChat(channel, `✨ @${username}, ahora eres un [${claseElegida.toUpperCase()}] de Nivel ${nivelClase}.`);

    } catch (error) {
      console.error('Error al cambiar clase:', error);
    }
  }

  // COMANDO: !RANKING
  else if (msg === '!ranking' || msg === '!top') {
    try {
      const jugadores = await Jugador.find();
      
      const ranking = jugadores.map(j => {
        const victoriasTotales = (j.guerrero?.victorias || 0) + 
                                 (j.ninja?.victorias || 0) + 
                                 (j.mago?.victorias || 0) +
                                 (j.clerigo?.victorias || 0) +
                                 (j.cazador?.victorias || 0);
        return { username: j.username, victorias: victoriasTotales };
      })
      .filter(j => j.victorias > 0)
      .sort((a, b) => b.victorias - a.victorias)
      .slice(0, 5);

      if (ranking.length === 0) {
        enviarMensajeChat(channel, "🏆 ¡La arena está limpia! Aún no hay campeones con victorias.");
        return;
      }

      const textoRanking = ranking.map((j, index) => `${index + 1}. @${j.username} (${j.victorias} 👑)`).join(' | ');
      enviarMensajeChat(channel, `🏆 TOP 5 ARENA: ${textoRanking}`);
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
  
  // 🛠️ BUG CORREGIDO: Línea duplicada con errata eliminada por completo
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

    io.emit('pelea_terminada_confirmada');

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
