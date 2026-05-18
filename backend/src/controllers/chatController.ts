import { Server } from 'socket.io';
import { ArenaService } from '../services/arena.js';
import { DungeonService } from '../services/dungeon.js';
import { Jugador } from '../models/Jugador.js';
import { enviarMensajeChat } from '../config/twitch.js';
import { TITULOS_PRESTIGIO, afijoDiario } from '../config/constants.js';
import {
    apuestasAbiertas,
    tiempoRestanteApuestas,
    listadoApuestas,
    registrarApuesta,
    peticionesDungeonPendientes,
    evaluarYEjecutarFlujo,
    timerDungeonInterval,
    iniciarWatchdogDungeon
} from '../sockets.js';

export function obtenerTitulosDesbloqueados(jugador: any): string[] {
    const titulosGuardados = jugador.get('titulosDesbloqueados') || [];
    const titulos = new Set<string>(['recluta', 'novato', ...titulosGuardados.map((t: string) => t.toLowerCase())]);
    const oro = jugador.get('oro') || 0;
    const vicT = (jugador.get('guerrero')?.victorias || 0) + (jugador.get('ninja')?.victorias || 0) + (jugador.get('mago')?.victorias || 0) + (jugador.get('clerigo')?.victorias || 0) + (jugador.get('cazador')?.victorias || 0);
    const nivM = Math.max(jugador.get('guerrero')?.nivel || 1, jugador.get('ninja')?.nivel || 1, jugador.get('mago')?.nivel || 1, jugador.get('clerigo')?.nivel || 1, jugador.get('cazador')?.nivel || 1);

    if (nivM >= 5) titulos.add('luchador'); if (nivM >= 10) titulos.add('gladiador'); if (nivM >= 20) titulos.add('veterano');
    if (nivM >= 30) titulos.add('maestro'); if (nivM >= 50) titulos.add('leyenda'); if (nivM >= 100) titulos.add('dios');
    if (vicT >= 10) titulos.add('asesino'); if (vicT >= 50) titulos.add('carnicero'); if (vicT >= 100) titulos.add('ejecutor');
    if (oro >= 1000) titulos.add('rico'); if (oro >= 10000) titulos.add('millonario');
    if ((jugador.get('guerrero')?.nivel || 1) >= 20) titulos.add('juggernaut'); if ((jugador.get('ninja')?.nivel || 1) >= 20) titulos.add('sombra');
    if ((jugador.get('mago')?.nivel || 1) >= 20) titulos.add('archimago'); if ((jugador.get('clerigo')?.nivel || 1) >= 20) titulos.add('santo');
    if ((jugador.get('cazador')?.nivel || 1) >= 20) titulos.add('franco');
    return Array.from(titulos);
}

async function manejarLuchar(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
    const claseElegida = partes[1]?.toLowerCase() || '';
    let claseFinal = clasesValidas.includes(claseElegida) ? claseElegida : null;

    const targetId = usuarioLimpio.toLowerCase();
    const targetName = usuarioLimpio;
    let nivelFinal = 1;
    let tituloFinal = '';

    try {
        let jugador = await Jugador.findOne({ twitchId: targetId });
        if (jugador) {
            if (!claseFinal && jugador.claseActual) claseFinal = jugador.claseActual;
            const statsClase = jugador.get(claseFinal || 'guerrero');
            if (statsClase && statsClase.nivel) nivelFinal = statsClase.nivel;
            
            const titID = jugador.get('tituloEquipado');
            if (titID) {
                const tObj = TITULOS_PRESTIGIO.find(t => t.id === titID.toLowerCase());
                tituloFinal = tObj ? tObj.nombre : (titID.charAt(0).toUpperCase() + titID.slice(1));
            }
        } else {
            if (!claseFinal) claseFinal = clasesValidas[Math.floor(Math.random() * clasesValidas.length)]!;
            jugador = new Jugador({
                twitchId: targetId,
                username: targetName,
                claseActual: claseFinal
            });
            await jugador.save();
            nivelFinal = 1;
        }
    } catch (e) { console.error('Error al leer nivel BD:', e); }

    if (!claseFinal) claseFinal = clasesValidas[Math.floor(Math.random() * clasesValidas.length)]!;

    ArenaService.agregarACola({ twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: nivelFinal, titulo: tituloFinal });

    const prefijoTit = tituloFinal ? `[${tituloFinal}] ` : '';
    const msg = `⚔️ ${prefijoTit}@${targetName} se ha unido a la cola de la Arena como ${claseFinal.toUpperCase()} (Nv.${nivelFinal}).`;
    io.emit('chat_mensaje_bot', { mensaje: msg });
    if (!esTest) enviarMensajeChat(msg);
    if (esTest) console.log(`📡 RESPUESTA: ${msg}`);

    // --- ESCALADA DINÁMICA PROGRESIVA (HASTA 3v3) DURANTE LAS APUESTAS ---
    if (apuestasAbiertas && ArenaService.contendientesRojos.length < 3 && ArenaService.obtenerCola().length >= 2) {
        ArenaService.modoDeCombate = '3v3';
        ArenaService.contendientesRojos.push(ArenaService.obtenerCola().shift()!);
        ArenaService.contendientesAzules.push(ArenaService.obtenerCola().shift()!);
        
        const numVs = ArenaService.contendientesRojos.length;
        const upgradeMsg = `🔥 ¡LA ARENA SE CALIENTA! Más gladiadores se han unido y el combate escala a un épico ${numVs}v${numVs}. ¡Siguen las apuestas! 🔥`;
        io.emit('chat_mensaje_bot', { mensaje: upgradeMsg });
        if (!esTest) enviarMensajeChat(upgradeMsg);

        io.emit('actualizar_cola', ArenaService.obtenerCola().map(j => `${j.titulo ? '['+j.titulo+'] ' : ''}${j.nombre}(Nv.${j.nivel})`));
        
        io.emit('apuestas_abiertas_overlay', {
            modo: '3v3',
            rojos: ArenaService.contendientesRojos,
            azules: ArenaService.contendientesAzules,
            tiempo: tiempoRestanteApuestas
        });
        io.emit('apuestas_actualizadas', listadoApuestas);
    } else {
        evaluarYEjecutarFlujo(io);
    }
}

async function manejarApostar(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const bando = partes[1]?.toLowerCase();
    const cantidad = parseInt(partes[2] || '0');

    if (!apuestasAbiertas) {
        if (esTest) console.log(`❌ [TEST] Apuestas cerradas.`);
        return;
    }
    if ((bando === 'rojo' || bando === 'azul') && cantidad > 0) {
        registrarApuesta({ usuario: usuarioLimpio, bando: bando, cantidad: cantidad });
    }
}

async function manejarDungeon(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean, comando: string) {
    const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
    const claseElegida = partes[1]?.toLowerCase() || '';
    let claseFinal = clases.includes(claseElegida) ? claseElegida : null;

    const targetId = usuarioLimpio.toLowerCase();
    const targetName = usuarioLimpio;
    let nivelFinal = 1;
    let tituloFinal = '';

    try {
        let jugador = await Jugador.findOne({ twitchId: targetId });
        if (jugador) {
            if (!claseFinal && jugador.claseActual) claseFinal = jugador.claseActual;
            const statsClase = jugador.get(claseFinal || 'guerrero');
            if (statsClase && statsClase.nivel) nivelFinal = statsClase.nivel;
            const titID = jugador.get('tituloEquipado');
            if (titID) {
                const tObj = TITULOS_PRESTIGIO.find(t => t.id === titID.toLowerCase());
                tituloFinal = tObj ? tObj.nombre : (titID.charAt(0).toUpperCase() + titID.slice(1));
            }
        } else {
            if (!claseFinal) claseFinal = clases[Math.floor(Math.random() * clases.length)]!;
            jugador = new Jugador({
                twitchId: targetId,
                username: targetName,
                claseActual: claseFinal
            });
            await jugador.save();
            nivelFinal = 1;
        }
    } catch (e) { console.error('Error al leer nivel BD:', e); }

    if (!claseFinal) claseFinal = clases[Math.floor(Math.random() * clases.length)]!;

    const heroe = { twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: nivelFinal, titulo: tituloFinal };

    if (DungeonService.dungeonFaseReclutamiento) {
        if (DungeonService.grupoDungeon.length < 5) {
            DungeonService.agregarHeroe(heroe);
            io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);

            if (DungeonService.grupoDungeon.length >= 5) {
                if (timerDungeonInterval) clearInterval(timerDungeonInterval);
                DungeonService.dungeonFaseReclutamiento = false;
                DungeonService.dungeonEnCurso = true;
                io.emit('dungeon_iniciar', { jugadores: DungeonService.grupoDungeon, nivelMedio: DungeonService.calcularNivelMedio() });
                iniciarWatchdogDungeon(io);
            }
        } else if (comando === '!dungeon') {
            peticionesDungeonPendientes.push(heroe);
            if (esTest) console.log(`⏳ [COLA] Petición de mazmorra en cola. Total: ${peticionesDungeonPendientes.length}`);
            evaluarYEjecutarFlujo(io);
        }
    } else if (comando === '!dungeon') {
        peticionesDungeonPendientes.push(heroe);
        if (esTest) console.log(`⏳ [COLA] Petición de mazmorra en cola. Total: ${peticionesDungeonPendientes.length}`);
        evaluarYEjecutarFlujo(io);
    }
}

async function manejarClase(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
    const nuevaClase = partes[1]?.toLowerCase() || '';

    if (!clasesValidas.includes(nuevaClase)) {
        const msg = `❌ @${usuarioLimpio}, clase no válida. Usa: !clase [guerrero/ninja/mago/clerigo/cazador]`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
        return;
    }

    try {
        let jugador = await Jugador.findOne({ twitchId: usuarioLimpio.toLowerCase() });
        if (!jugador) jugador = new Jugador({ twitchId: usuarioLimpio.toLowerCase(), username: usuarioLimpio, claseActual: nuevaClase });
        else jugador.claseActual = nuevaClase;
        await jugador.save();

        const msg = `✅ @${usuarioLimpio} ha cambiado su clase a ${nuevaClase!.toUpperCase()}. Ahora lucharás con esta clase por defecto.`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
        if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
    } catch (error) { console.error('Error al cambiar de clase:', error); }
}

async function manejarAfijo(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    if (afijoDiario) {
        const msg = `🔮 MODIFICADOR DE HOY: ${afijoDiario.nombre} - ${afijoDiario.desc}`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
    }
}

async function manejarTitulos(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const subCmd = partes[1]?.toLowerCase();
    
    if (subCmd === 'todos' || subCmd === 'lista') {
        const todosLosTitulos = TITULOS_PRESTIGIO.map(t => t.id);
        const chunkSize = 15; // Enviamos de 15 en 15 para no saturar el límite de Twitch
        
        for (let i = 0; i < todosLosTitulos.length; i += chunkSize) {
            const chunk = todosLosTitulos.slice(i, i + chunkSize).join(', ');
            const prefijo = i === 0 ? '🏆 TÍTULOS: ' : '🏆 (cont.): ';
            const msg = `${prefijo}${chunk}`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        }
        
        const msgAyuda = `💡 Usa "!titulos info [id]" para ver cómo conseguir uno.`;
        io.emit('chat_mensaje_bot', { mensaje: msgAyuda });
        if (!esTest) enviarMensajeChat(msgAyuda);
        return;
    }

    if (subCmd === 'info') {
        const tituloId = partes[2]?.toLowerCase();
        const objTit = TITULOS_PRESTIGIO.find(t => t.id === tituloId);
        if (objTit) {
            const msg = `📜 TÍTULO [${objTit.nombre}] (ID: ${objTit.id}): Requisito ➡️ ${objTit.desc}.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        } else {
            const msg = `❌ @${usuarioLimpio}, el título indicado no existe. Ejemplo válido: !titulos info leyenda`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        }
        return;
    }

    try {
        const targetId = usuarioLimpio.toLowerCase();
        const jugador = await Jugador.findOne({ twitchId: targetId });
        if (!jugador) {
            const msg = `❌ @${usuarioLimpio}, no estás registrado. ¡Escribe !luchar para empezar tu aventura!`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            return;
        }
        
        const desbloqueados = obtenerTitulosDesbloqueados(jugador);
        const titID = jugador.get('tituloEquipado');
        let tituloActualStr = '(Ninguno)';
        if (titID) {
            const tObj = TITULOS_PRESTIGIO.find(t => t.id === titID.toLowerCase());
            tituloActualStr = `(Equipado: ${tObj ? tObj.nombre : titID})`;
        }
        
        const msgCabecera = `🏅 @${usuarioLimpio}, tienes ${desbloqueados.length} títulos. ${tituloActualStr}. Usa !titulo [nombre] para equipar.`;
        io.emit('chat_mensaje_bot', { mensaje: msgCabecera });
        if (!esTest) enviarMensajeChat(msgCabecera);

        const chunkSize = 15;
        for (let i = 0; i < desbloqueados.length; i += chunkSize) {
            const chunk = desbloqueados.slice(i, i + chunkSize).join(', ');
            const prefijo = i === 0 ? '📜 Desbloqueados: ' : '📜 (cont.): ';
            const msg = `${prefijo}${chunk}`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        }
    } catch(e) { console.error('Error procesando !titulos:', e); }
}

async function manejarTitulo(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const tituloId = partes[1]?.toLowerCase();
    if (!tituloId) return;
    try {
        const targetId = usuarioLimpio.toLowerCase();
        const jugador = await Jugador.findOne({ twitchId: targetId });
        if (!jugador) {
            const msg = `❌ @${usuarioLimpio}, no estás registrado. ¡Escribe !luchar para empezar tu aventura!`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            return;
        }
        
        if (tituloId === 'quitar' || tituloId === 'ninguno') {
            jugador.set('tituloEquipado', '');
            await jugador.save();
            const msg = `✅ @${usuarioLimpio} se ha quitado el título.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            return;
        }

        const desbloqueados = obtenerTitulosDesbloqueados(jugador);
        if (desbloqueados.includes(tituloId)) {
            jugador.set('tituloEquipado', tituloId);
            await jugador.save();
            const objTit = TITULOS_PRESTIGIO.find(t => t.id === tituloId);
            const nombreTitulo = objTit ? objTit.nombre : (tituloId.charAt(0).toUpperCase() + tituloId.slice(1));
            const msg = `✅ @${usuarioLimpio} se ha equipado el título de [${nombreTitulo}]!`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        }
    } catch(e) { console.error('Error procesando !titulo:', e); }
}

async function manejarAyuda(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const respuestaAyuda = `🤖 COMANDOS: !luchar [clase] | !apostar [bando] [oro] | !dungeon | !entrar | !clase | !stats | !titulos [lista/info] | !afijo | !top ⚔️ Clases: guerrero, ninja, mago, clerigo, cazador`;
    io.emit('chat_mensaje_bot', { mensaje: respuestaAyuda });
    if (!esTest) enviarMensajeChat(respuestaAyuda);
    if (esTest) console.log(`📡 RESPUESTA: ${respuestaAyuda}`);
}

async function manejarStats(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    try {
        const jugador = await Jugador.findOne({ twitchId: usuarioLimpio.toLowerCase() });
        if (!jugador) {
            const msg = `❌ @${usuarioLimpio}, aún no tienes estadísticas. ¡Escribe !luchar para empezar tu aventura!`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            return;
        }

        const clasePreferida = jugador.claseActual || 'guerrero';
        const statsClase = jugador.get(clasePreferida) || { nivel: 1, xp: 0, victorias: 0 };
        const nivelActual = statsClase.nivel || 1;
        const xpActual = statsClase.xp || 0;
        const victorias = statsClase.victorias || 0;
        const oro = jugador.get('oro') || 0;

        const xpNecesaria = nivelActual * 100; 
        const xpFaltante = Math.max(0, xpNecesaria - xpActual);

        const msg = `📊 @${usuarioLimpio} | ${clasePreferida.toUpperCase()} (Nv.${nivelActual}) | 🪙 Oro: ${oro} | ⚔️ Victorias: ${victorias} | 🌟 Faltan ${xpFaltante} XP.`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
    } catch (error) { console.error('Error al obtener stats:', error); }
}

async function manejarTop(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    try {
        const jugadores = await Jugador.find();
        const ranking = jugadores.map(j => {
            const victoriasTotales = (j.get('guerrero')?.victorias || 0) + (j.get('ninja')?.victorias || 0) + (j.get('mago')?.victorias || 0) + (j.get('clerigo')?.victorias || 0) + (j.get('cazador')?.victorias || 0); 
            return { username: j.get('username'), victorias: victoriasTotales };
        }).filter(j => j.victorias > 0).sort((a, b) => b.victorias - a.victorias).slice(0, 3);
        
        const respuestaTop = ranking.length === 0 
            ? `🏆 Aún no hay nadie en el TOP. ¡Sé el primero en ganar en la arena!`
            : `🏆 TOP 3 LUCHADORES: ` + ranking.map((j, i) => `${i+1}º ${j.username} (${j.victorias}V)`).join(' | ');
        
        io.emit('chat_mensaje_bot', { mensaje: respuestaTop });
        if (!esTest) enviarMensajeChat(respuestaTop);
    } catch (error) { console.error('Error al obtener el ranking:', error); }
}

async function manejarRegalar(io: Server, usuarioLimpio: string, partes: string[], esTest: boolean) {
    const cantidad = parseInt(partes[1] || '0');
    // Limpiamos la arroba por si el usuario lo autocompleta con el chat de Twitch
    const targetUser = partes[2]?.replace('@', '').toLowerCase();

    if (isNaN(cantidad) || cantidad <= 0 || !targetUser) {
        const msg = `❌ @${usuarioLimpio}, uso correcto: !regalar [cantidad] [usuario]`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
        return;
    }

    if (targetUser === usuarioLimpio.toLowerCase()) return; // No se puede regalar a sí mismo

    try {
        const donante = await Jugador.findOne({ twitchId: usuarioLimpio.toLowerCase() });
        if (!donante || (donante.get('oro') || 0) < cantidad) {
            const msg = `❌ @${usuarioLimpio}, no tienes oro suficiente para ese regalo.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            return;
        }
        const receptor = await Jugador.findOne({ twitchId: targetUser });
        if (!receptor) return; // Si no existe, cancelamos en silencio

        donante.set('oro', (donante.get('oro') || 0) - cantidad);
        receptor.set('oro', (receptor.get('oro') || 0) + cantidad);
        await donante.save();
        await receptor.save();
        
        const msg = `🎁 ¡@${usuarioLimpio} ha regalado ${cantidad} 🪙 a @${targetUser}!`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
    } catch (e) { console.error('Error regalando oro:', e); }
}

// --- MAPEO DEL PATRÓN COMANDO ---
const comandos: Record<string, Function> = {
    '!luchar': manejarLuchar,
    '!apostar': manejarApostar,
    '!dungeon': manejarDungeon,
    '!entrar': manejarDungeon,
    '!clase': manejarClase,
    '!afijo': manejarAfijo,
    '!titulos': manejarTitulos,
    '!titulo': manejarTitulo,
    '!ayuda': manejarAyuda,
    '!comandos': manejarAyuda,
    '!stats': manejarStats,
    '!oro': manejarStats,
    '!top': manejarTop,
    '!regalar': manejarRegalar
};

// 🛡️ CANDADO ANTI-SPAM (Mutex Lock): Evita que un jugador ejecute comandos paralelos
const locksUsuarios = new Set<string>();

export async function procesarComandoChat(io: Server, username: string, mensaje: string, esTest: boolean = false) {
    const mensajeLimpio = mensaje.trim();
    const usuarioLimpio = username.trim();
    const partes = mensajeLimpio.split(' ');
    const comando = partes[0]?.toLowerCase();
    const targetId = usuarioLimpio.toLowerCase();

    if (comando && comandos[comando]) {
        if (locksUsuarios.has(targetId)) return; // Si ya hay un comando de este usuario procesándose, ignoramos el mensaje
        
        locksUsuarios.add(targetId); // Echamos el candado
        try {
            // Ejecutamos la función del comando pasando todos los parámetros necesarios
            await comandos[comando](io, usuarioLimpio, partes, esTest, comando);
        } catch (error) {
            console.error(`Error de ejecución en comando ${comando}:`, error);
        } finally {
            locksUsuarios.delete(targetId); // Quitamos el candado SIEMPRE (incluso si la BD falla)
        }
    }
}