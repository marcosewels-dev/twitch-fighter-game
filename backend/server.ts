import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import tmi from 'tmi.js';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
app.use(cors());

// 🛡️ CONSTANTE DE CONTROL DE VERSIONES ANTI-CACHÉ
const VERSION_JUEGO = 1.1; // 🟢 Si haces cambios en el front, sube esto a 1.2, 1.3, etc.

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
// ⚔️ CONTROL DE LAS COLAS Y ESTADOS
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

let dungeonEnCurso = false;
let dungeonFaseReclutamiento = false;
let grupoDungeon: JugadorPelea[] = [];
let timerReclutamiento: NodeJS.Timeout | null = null;

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

  if (msg === '!comandos' || msg === '!ayuda' || msg === '!arena') {
    enviarMensajeChat(
      channel, 
      `🎮 [ARENA] ⚔️ !luchar [clase] (guerrero, ninja, mago, clerigo, cazador) | 👤 !stats | 🔄 !clase [rol] | 🏆 !ranking || 🐲 [DUNGEON] 🏰 !dungeon (Abre Raid) | 🚪 !entrar (Únete al grupo de asalto)`
    );
    return;
  }

  if (msg === '!dungeon') {
    if (dungeonEnCurso || dungeonFaseReclutamiento || peleaEnCurso) {
      enviarMensajeChat(channel, `@${username}, la arena se encuentra ocupada con otra actividad. Espera un momento.`);
      return;
    }

    dungeonFaseReclutamiento = true;
    grupoDungeon = [];
    enviarMensajeChat(channel, `🏰 ¡INCURSIÓN DE MAZMORRA INICIADA! 🐲 Se buscan 4 héroes valientes. Escribe !entrar para unirte al grupo. ¡Quedan 60 segundos express!`);
    
    io.emit('dungeon_reclutamiento_abierto', { tiempo: 60 });

    timerReclutamiento = setTimeout(() => {
      iniciarBatallaDungeon();
    }, 60000);
    return;
  }

  if (msg === '!entrar') {
    if (!dungeonFaseReclutamiento) {
      enviarMensajeChat(channel, `@${username}, no hay ninguna expedición reclutando en este momento. Escribe !dungeon para abrir una.`);
      return;
    }
    if (grupoDungeon.some(h => h.twitchId === twitchId)) {
      enviarMensajeChat(channel, `@${username}, ya estás dentro del grupo de asalto.`);
      return;
    }
    if (grupoDungeon.length >= 4) {
      enviarMensajeChat(channel, `@${username}, el equipo de incursión ya está lleno (4/4). ¡Toca esperar a la siguiente!`);
      return;
    }

    let perfil = await Jugador.findOne({ twitchId });
    if (!perfil) {
      perfil = new Jugador({ twitchId, username, claseActual: 'guerrero' });
      await perfil.save();
    }

    const claseActual = perfil.claseActual;
    const nivelActual = (perfil as any)[claseActual].nivel;

    grupoDungeon.push({
      twitchId,
      nombre: username,
      clase: claseActual,
      nivel: nivelActual
    });

    enviarMensajeChat(channel, `🚪 @${username} [${claseActual.toUpperCase()} Nv.${nivelActual}] se unió al equipo de asalto! (${grupoDungeon.length}/4)`);
    io.emit('dungeon_actualizar_grupo', grupoDungeon.map(h => ({ nombre: h.nombre, clase: h.clase, nivel: h.nivel })));

    if (grupoDungeon.length === 4) {
      if (timerReclutamiento) clearTimeout(timerReclutamiento);
      iniciarBatallaDungeon();
    }
    return;
  }

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
    
    if (!dungeonFaseReclutamiento && !dungeonEnCurso) {
      chequearSiguientePelea();
    }
  }

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
        perfil = new Jugador({ twitchId, username, claseActual: claseElegida });
      } else {
        perfil.claseActual = claseElegida;
      }
      await perfil.save();

      const nivelClase = (perfil as any)[claseElegida].nivel;
      enviarMensajeChat(channel, `✨ @${username}, ahora eres un [${claseElegida.toUpperCase()}] de Nivel ${nivelClase}.`);

      const indexEnCola = colaEspera.findIndex(j => j.twitchId === twitchId);
      if (indexEnCola !== -1) {
        colaEspera[indexEnCola].clase = claseElegida;
        colaEspera[indexEnCola].nivel = nivelClase;
        io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));
      }
    } catch (error) {
      console.error('Error al cambiar clase:', error);
    }
  }

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

function iniciarBatallaDungeon() {
  dungeonFaseReclutamiento = false;

  if (grupoDungeon.length < 2) {
    enviarMensajeChat(TWITCH_CHANNEL, `❌ La incursión se ha cancelado por falta de héroes (Mínimo 2 requeridos). Volviendo a duelos 1v1.`);
    dungeonEnCurso = false;
    chequearSiguientePelea();
    return;
  }

  dungeonEnCurso = true;
  peleaEnCurso = false; 

  const sumaNiveles = grupoDungeon.reduce((acc, h) => acc + h.nivel, 0);
  const nivelMedio = sumaNiveles / grupoDungeon.length;

  enviarMensajeChat(TWITCH_CHANNEL, `🐉 ¡GRUPO CONFIRMADO! ${grupoDungeon.length} héroes entran en las Mazmorras del Caos... ¡Fase 1: Los Esbirros! ⚔️`);
  
  io.emit('dungeon_iniciar', {
    jugadores: grupoDungeon,
    nivelMedio: nivelMedio
  });
}

function chequearSiguientePelea() {
  if (peleaEnCurso || dungeonEnCurso || dungeonFaseReclutamiento || colaEspera.length < 2) return;

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
    nivelP1: luchadorActual1.nivel,
    p2: luchadorActual2.nombre,
    claseP2: luchadorActual2.clase,
    nivelP2: luchadorActual2.nivel
  });
}

io.on('connection', (socket) => {
  console.log('Frontend conectado.');
  
  // 🟢 ENVIAR COMPROBACIÓN DE VERSIÓN AL OBS NADA MÁS CONECTAR
  socket.emit('chequear_version', { version: VERSION_JUEGO });

  socket.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(Nv.${j.nivel})`));

  socket.on('dungeon_terminada', async (datos: { victoria: boolean; fasesSuperadas: number }) => {
    if (grupoDungeon.length === 0) return;

    let xpRecompensa = datos.fasesSuperadas * 25;
    if (datos.victoria) xpRecompensa += 100;

    try {
      for (const heroe of grupoDungeon) {
        const perfil = await Jugador.findOne({ twitchId: heroe.twitchId });
        if (perfil) {
          const claseData = (perfil as any)[heroe.clase];
          claseData.xp += xpRecompensa;

          if (datos.victoria) claseData.victorias += 1;

          let xpNecesaria = claseData.nivel * 100;
          while (claseData.xp >= xpNecesaria) {
            claseData.xp -= xpNecesaria;
            claseData.nivel += 1;
            enviarMensajeChat(TWITCH_CHANNEL, `🎉 ¡MAZMORRA PURGADA! @${perfil.username} subió a Nivel ${claseData.nivel} como [${heroe.clase.toUpperCase()}]! 👑`);
            xpNecesaria = claseData.nivel * 100;
          }
          await perfil.save();
        }
      }

      if (datos.victoria) {
        enviarMensajeChat(TWITCH_CHANNEL, `🏆 ¡MAZMORRA COMPLETADA! El grupo purgó las 3 fases y derrotó al Boss Supremo. ¡Recompensa total de +${xpRecompensa} XP! 👑`);
      } else {
        enviarMensajeChat(TWITCH_CHANNEL, `💀 INCURSIÓN FALLIDA... El grupo cayó en la Fase ${datos.fasesSuperadas + 1}. Consuelo de +${xpRecompensa} XP asignado.`);
      }

    } catch (err) {
      console.error('Error al procesar botín de mazmorras:', err);
    }

    io.emit('dungeon_limpiar_interfaz');
    grupoDungeon = [];
    dungeonEnCurso = false;
    peleaEnCurso = false; 

    setTimeout(() => {
      chequearSiguientePelea();
    }, 5000);
  });

  socket.on('pelea_terminada', async (datos: { ganador: string }) => {
    if (!luchadorActual1 || !luchadorActual2) return;

    const ganadorNombre = datos.ganador;
    const esP1Ganador = luchadorActual1.nombre === ganadorNombre;
    
    const idGanador = esP1Ganador ? luchadorActual1.twitchId : luchadorActual2.twitchId;
    const idPerdedor = esP1Ganador ? luchadorActual2.twitchId : luchadorActual1.twitchId;

    const claseGanador = esP1Ganador ? luchadorActual1.clase : luchadorActual2.clase;
    const clasePerdedor = esP1Ganador ? luchadorActual2.clase : luchadorActual1.clase;

    const nivelGanador = esP1Ganador ? luchadorActual1.nivel : luchadorActual2.nivel;
    const nivelPerdedor = esP1Ganador ? luchadorActual2.nivel : luchadorActual1.nivel;

    try {
      const perfilGanador = await Jugador.findOne({ twitchId: idGanador });
      if (perfilGanador) {
        const claseData = (perfilGanador as any)[claseGanador];
        claseData.victorias += 1;
        
        let xpGanadaGanador = 50;
        let mensajeGanador = "";

        if (nivelGanador > nivelPerdedor) {
          const diferencia = nivelGanador - nivelPerdedor;
          const penalizacion = diferencia * 5;
          xpGanadaGanador = Math.max(15, 50 - penalizacion);
          if (penalizacion > 0) {
            mensajeGanador = ` (Recortado -${penalizacion} XP por vencer a un nivel inferior)`;
          }
        }

        claseData.xp += xpGanadaGanador;
        console.log(`👑 @${perfilGanador.username} sumó +${xpGanadaGanador} XP${mensajeGanador}`);

        let xpNecesaria = claseData.nivel * 100;
        while (claseData.xp >= xpNecesaria) {
          claseData.xp -= xpNecesaria;
          claseData.nivel += 1;
          enviarMensajeChat(TWITCH_CHANNEL, `🎉 ¡LEVEL UP! @${perfilGanador.username} ha alcanzado el Nivel ${claseData.nivel} como [${claseGanador.toUpperCase()}]! ⚔️`);
          xpNecesaria = claseData.nivel * 100;
        }
        await perfilGanador.save();
      }

      const perfilPerdedor = await Jugador.findOne({ twitchId: idPerdedor });
      if (perfilPerdedor) {
        const claseData = (perfilPerdedor as any)[clasePerdedor];
        claseData.derrotas += 1;
        
        let xpGanadaPerdedor = 15;
        let mensajePerdedor = "";

        if (nivelGanador > nivelPerdedor) {
          const diferenciaNivel = nivelGanador - nivelPerdedor;
          const bonoDesafio = diferenciaNivel * 10;
          xpGanadaPerdedor += bonoDesafio;
          mensajePerdedor = ` (¡Incluye +${bonoDesafio} XP de Bono por Desafío contra Nv.${nivelGanador}!)`;
        }

        claseData.xp += xpGanadaPerdedor;
        console.log(`💀 @${perfilPerdedor.username} sumó +${xpGanadaPerdedor} XP${mensajePerdedor}`);

        let xpNecesaria = claseData.nivel * 100;
        while (claseData.xp >= xpNecesaria) {
          claseData.xp -= xpNecesaria;
          claseData.nivel += 1;
          enviarMensajeChat(TWITCH_CHANNEL, `🎉 ¡LEVEL UP! @${perfilPerdedor.username} ha alcanzado el Nivel ${claseData.nivel} como [${clasePerdedor.toUpperCase()}]! ⚔️`);
          xpNecesaria = claseData.nivel * 100;
        }
        await perfilPerdedor.save();
      }
    } catch (error) {
      console.error('Error al actualizar estadísticas:', error);
    }

    io.emit('pelea_terminada_confirmada');

    luchadorActual1 = null;
    luchadorActual2 = null;
    peleaEnCurso = false; 

    setTimeout(() => {
      chequearSiguientePelea();
    }, 5000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
