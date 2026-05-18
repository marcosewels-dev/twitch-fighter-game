import { Server, Socket } from 'socket.io';
import { ArenaService } from './services/arena.js';
import { DungeonService } from './services/dungeon.js';
import { EconomiaService } from './services/economia.js';
import { enviarMensajeChat } from './config/twitch.js';
import { Jugador } from './models/Jugador.js';
import { VERSION_JUEGO, AFIJOS_POOL, afijoDiario, TITULOS_PRESTIGIO } from './config/constants.js';
import { procesarComandoChat } from './controllers/chatController.js';
export { procesarComandoChat }; // Lo re-exportamos para no romper el archivo twitch.ts

// Variables internas compartidas con el controlador de Twitch
export let listadoApuestas: any[] = [];
export let apuestasAbiertas = false;
export let timerApuestasInterval: NodeJS.Timeout | null = null;
export let timerDungeonInterval: NodeJS.Timeout | null = null;
export let watchdogArena: NodeJS.Timeout | null = null;
export let watchdogDungeon: NodeJS.Timeout | null = null;
export let peticionesDungeonPendientes: any[] = [];
export let peticionesTestDungeonAuto = 0; // Para encolar dungeons masivas de test
export let ioInstance: Server | null = null;
export let tiempoRestanteApuestas = 0;

export function configurarSockets(io: Server) {
    ioInstance = io;
    io.on('connection', (socket: Socket) => {
        // Control automático de versiones anti-caché para el OBS
        socket.emit('chequear_version', { version: VERSION_JUEGO });

        // Enviar el modificador de hoy al Frontend para que lo pinte
        socket.emit('afijo_actualizado', afijoDiario);

        // Sincroniza la cola actual al conectar
        const colaFormateada = ArenaService.obtenerCola().map(j => `${j.titulo ? '['+j.titulo+'] ' : ''}${j.nombre}(Nv.${j.nivel})`);
        socket.emit('actualizar_cola', colaFormateada);

        // --- RECUPERACIÓN DE ESTADO PARA RECARGAS DEL FRONTEND (F5 o Vite HMR) ---
        if (apuestasAbiertas) {
            socket.emit('apuestas_abiertas_overlay', {
                modo: ArenaService.contendientesRojos.length > 1 ? '3v3' : '1v1',
                rojos: ArenaService.contendientesRojos,
                azules: ArenaService.contendientesAzules,
                tiempo: 0 // Se sobrescribirá rápidamente por el timer
            });
            socket.emit('apuestas_actualizadas', listadoApuestas);
        } else if (ArenaService.contendientesRojos.length > 0 && ArenaService.contendientesAzules.length > 0) {
            socket.emit('apuestas_abiertas_overlay', {
                modo: ArenaService.contendientesRojos.length > 1 ? '3v3' : '1v1',
                rojos: ArenaService.contendientesRojos,
                azules: ArenaService.contendientesAzules,
                tiempo: 0
            });
            socket.emit('combate_fuego_abierto');
        }

        if (DungeonService.dungeonFaseReclutamiento) {
            socket.emit('dungeon_reclutamiento_abierto', { tiempo: 0 });
            socket.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);
        } else if (DungeonService.dungeonEnCurso) {
            socket.emit('dungeon_iniciar', {
                jugadores: DungeonService.grupoDungeon,
                nivelMedio: DungeonService.calcularNivelMedio()
            });
        }
        // -------------------------------------------------------------------------

        // --- ESCUCHADOR: ESCARAMUZA FINALIZADA (1v1 o 3v3) ---
        socket.on('combate_finalizado_resultado', async (datos: { nombresGanadores: string[]; nombresPerdedores: string[] }) => {
            if (!ArenaService.peleaEnCurso) return; // 🛡️ Evita recompensas dobles si hay varios navegadores u OBS abiertos

            if (watchdogArena) clearTimeout(watchdogArena); // Cancelamos el perro guardián
            ArenaService.peleaEnCurso = false;
            apuestasAbiertas = false;

            // Determinar bando ganador para las estadísticas de apuestas en el chat
            const bandoGanador = datos.nombresGanadores.length > 0 && ArenaService.contendientesRojos.some(r => r.nombre === datos.nombresGanadores[0]) ? 'rojo' : 'azul';
            const totalRojo = listadoApuestas.filter(a => a.bando === 'rojo').reduce((sum, a) => sum + a.cantidad, 0);
            const totalAzul = listadoApuestas.filter(a => a.bando === 'azul').reduce((sum, a) => sum + a.cantidad, 0);
            const totalApostado = totalRojo + totalAzul;
            const totalBandoGanador = bandoGanador === 'rojo' ? totalRojo : totalAzul;

            if (totalApostado > 0) {
                if (totalBandoGanador > 0) {
                    const multiplicador = (totalApostado / totalBandoGanador).toFixed(2);
                    const msg = `🤖 [BOT] ¡El equipo ${bandoGanador.toUpperCase()} gana! Repartiendo ${totalApostado} 🪙 entre los acertantes (Multiplicador: x${multiplicador}).`;
                    io.emit('chat_mensaje_bot', { mensaje: msg });
                    enviarMensajeChat(msg);
                } else {
                    const msg = `🤖 [BOT] ¡El equipo ${bandoGanador.toUpperCase()} gana! Nadie apostó por ellos, ¡la casa se embolsa los ${totalApostado} 🪙!`;
                    io.emit('chat_mensaje_bot', { mensaje: msg });
                    enviarMensajeChat(msg);
                }
            } else {
                 const msg = `🤖 [BOT] Combate terminado sin apuestas. ¡A ver si os animáis en la próxima!`;
                 io.emit('chat_mensaje_bot', { mensaje: msg });
                 enviarMensajeChat(msg);
            }

            try {
                // Premiar ganadores
                for (const winNombre of datos.nombresGanadores) {
                    const contendiente = [...ArenaService.contendientesRojos, ...ArenaService.contendientesAzules].find(c => c.nombre === winNombre);
                    if (contendiente) {
                        // Calculamos la XP base con el nivel real del oponente para que funcione el sistema anti-abuso
                        const oponentePerdedor = [...ArenaService.contendientesRojos, ...ArenaService.contendientesAzules].find(c => datos.nombresPerdedores.includes(c.nombre));
                        const nivelPerdedor = oponentePerdedor ? oponentePerdedor.nivel : 1;
                        const xpBase = EconomiaService.calcularXPGanador1v1(contendiente.nivel, nivelPerdedor, winNombre);
                        await EconomiaService.procesarSubidaNivel(contendiente.twitchId, xpBase, contendiente.clase, true, 25);

                        const jug = await Jugador.findOne({ twitchId: contendiente.twitchId });
                        const nivelPost = jug?.get(contendiente.clase)?.nivel || 1;
                        if (nivelPost > contendiente.nivel) {
                            const msg = `🎉 ¡@${contendiente.nombre} ha subido al Nivel ${nivelPost} con su ${contendiente.clase.toUpperCase()}! ⚔️`;
                            io.emit('chat_mensaje_bot', { mensaje: msg });
                            enviarMensajeChat(msg);
                        }
                    }
                }

                // Recompensar perdedores
                for (const losNombre of datos.nombresPerdedores) {
                    const contendiente = [...ArenaService.contendientesRojos, ...ArenaService.contendientesAzules].find(c => c.nombre === losNombre);
                    if (contendiente) {
                        await EconomiaService.procesarSubidaNivel(contendiente.twitchId, 15, contendiente.clase, false, 5);

                        const jug = await Jugador.findOne({ twitchId: contendiente.twitchId });
                        const nivelPost = jug?.get(contendiente.clase)?.nivel || 1;
                        if (nivelPost > contendiente.nivel) {
                            const msg = `🎉 ¡@${contendiente.nombre} ha subido al Nivel ${nivelPost} con su ${contendiente.clase.toUpperCase()}! ⚔️`;
                            io.emit('chat_mensaje_bot', { mensaje: msg });
                            enviarMensajeChat(msg);
                        }
                    }
                }

                // Repartir las monedas de las apuestas del chat
                await EconomiaService.procesarPremiosApuestas(listadoApuestas, bandoGanador);

            } catch (e) {
                console.error('Error al procesar el fin del combate:', e);
            }

            // Limpieza de estado y llamada al siguiente combate
            ArenaService.vaciarContendientes();
            listadoApuestas = [];
            setTimeout(() => {
                evaluarYEjecutarFlujo(io);
            }, 5000);
        });

        // --- ESCUCHADOR: MAZMORRA TERMINADA ---
        socket.on('dungeon_terminada', async (datos: { victoria: boolean; fasesSuperadas: number; nivelMedioGrupo: number }) => {
            if (!DungeonService.dungeonEnCurso) return; // 🛡️ Evita recompensas dobles
            DungeonService.dungeonEnCurso = false;

            if (watchdogDungeon) clearTimeout(watchdogDungeon); // Cancelamos el perro guardián
            if (DungeonService.grupoDungeon.length === 0) return;

            const msgDungeon = datos.victoria 
                ? `🤖 [BOT] ¡La Raid ha sido un ÉXITO! Los héroes superaron la mazmorra y regresan con grandes recompensas. 🏆`
                : `🤖 [BOT] ¡La Raid ha FRACASADO en la fase ${datos.fasesSuperadas + 1}! El grupo ha sido aniquilado por los monstruos... ☠️`;
            io.emit('chat_mensaje_bot', { mensaje: msgDungeon });
            enviarMensajeChat(msgDungeon);

            let xpRecompensa = datos.fasesSuperadas * 20;
            let oroRecompensa = datos.fasesSuperadas * 15;

            if (datos.victoria) {
                xpRecompensa += 120;
                oroRecompensa += 60;
            }

            try {
                for (const heroe of DungeonService.grupoDungeon) {
                    let xpFinal = xpRecompensa;
                    // Bono de aprendizaje cooperativo (+25% XP si tienes menos nivel que la media)
                    if (heroe.nivel < datos.nivelMedioGrupo) {
                        xpFinal = Math.floor(xpFinal * 1.25);
                    }
                    await EconomiaService.procesarSubidaNivel(heroe.twitchId, xpFinal, heroe.clase, datos.victoria, oroRecompensa);

                    const jug = await Jugador.findOne({ twitchId: heroe.twitchId });
                    const nivelPost = jug?.get(heroe.clase)?.nivel || 1;
                    if (nivelPost > heroe.nivel) {
                        const msgLvl = `🎉 ¡@${heroe.nombre} ha subido al Nivel ${nivelPost} con su ${heroe.clase.toUpperCase()} tras la mazmorra! 🐉`;
                        io.emit('chat_mensaje_bot', { mensaje: msgLvl });
                        enviarMensajeChat(msgLvl);
                    }
                }
            } catch (err) {
                console.error('Error al guardar recompensas de la Dungeon:', err);
            }

            io.emit('dungeon_limpiar_interfaz');
            DungeonService.resetearDungeon();

            setTimeout(() => {
                evaluarYEjecutarFlujo(io);
            }, 4000);
        });

        // 🧪 ESCUCHADOR DE PRUEBAS INTERNAS: Forzar la entrada de N gladiadores a la Arena
        socket.on('test_forzar_luchar_masivo', async (datos: { cantidad: number }) => {
            const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
            const nombres = ['Thor', 'Altair', 'Gandalf', 'Uther', 'Legolas', 'Rookie'];

            console.log(`🧪 [TEST] Generando ${datos.cantidad} jugadores falsos...`);

            for (let i = 0; i < datos.cantidad; i++) {
                const claseRam = clases[i % clases.length]!;
                const nombreRam = `${nombres[i % nombres.length]!}_${Math.floor(Math.random() * 100)}`;

                ArenaService.agregarACola({
                    twitchId: `test_user_${Math.random()}`,
                    nombre: nombreRam,
                    clase: claseRam,
                    nivel: Math.floor(Math.random() * 5) + 1
                });
            }

            // Lanzamos de inmediato el selector de combates automático
            evaluarYEjecutarFlujo(io);
        });

        // 🧪 ESCUCHADOR DE PRUEBAS INTERNAS: Forzar una Incursión de Dungeon de 5 héroes
        socket.on('test_forzar_dungeon_automatica', async () => {
            console.log('🧪 [TEST] Petición de Raid cooperativa de 5 héroes (Añadida a la cola)...');
            // En lugar de romper la arena actual, la encolamos como una petición de test
            peticionesTestDungeonAuto++;
            evaluarYEjecutarFlujo(io);
        });

        // 🧪 CONSOLA DE COMANDOS E2E: Simula comandos del chat directamente en los servicios del juego
        socket.on('test_enviar_comando_chat', async (datos: { username: string; mensaje: string }) => {
            const mensajeLimpio = datos.mensaje.trim();
            const usuarioLimpio = datos.username.trim();

            console.log(`🧪 [TEST CHAT VIRTUAL] @${usuarioLimpio}: ${mensajeLimpio}`);
            
            // Delegamos TODO al procesador real para que use los datos reales de BD
            await procesarComandoChat(io, usuarioLimpio, mensajeLimpio, true);
        });
    });
}

export let timerEmparejamientoArena: NodeJS.Timeout | null = null;

// Helper para invocar de forma centralizada al asignador de combates
export function evaluarYEjecutarFlujo(io: Server) {

    const cola = ArenaService.obtenerCola();

    // Si ya tenemos 6 luchadores, cancelamos cualquier espera y lanzamos el 3v3 directo
    if (cola.length >= 6 && !ArenaService.peleaEnCurso && !DungeonService.dungeonEnCurso && !DungeonService.dungeonFaseReclutamiento && !apuestasAbiertas) {
        if (timerEmparejamientoArena) {
            clearTimeout(timerEmparejamientoArena);
            timerEmparejamientoArena = null;
        }
        ejecutarCombate(io);
        return;
    }

    if (timerEmparejamientoArena) return; // Si ya estamos esperando gente para la arena, no hacer nada

    // 1. PRIORIDAD: Si hay al menos 2 luchadores, iniciamos la espera de la Arena
    if (cola.length >= 2 && !ArenaService.peleaEnCurso && !DungeonService.dungeonEnCurso && !DungeonService.dungeonFaseReclutamiento && !apuestasAbiertas) {
        const msg = `⏳ ¡Combate inminente en 15s! Escribe !luchar para unirte a la cola y forzar un 3vs3 épico.`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!ioInstance) enviarMensajeChat(msg); // Opcional para test

        timerEmparejamientoArena = setTimeout(() => {
            timerEmparejamientoArena = null;
            ejecutarCombate(io);
        }, 15000);
        return; // Evita que se evalúe la mazmorra si la Arena tiene a gladiadores esperando
    }

    // 2. MENOR PRIORIDAD: Si la Arena está completamente vacía, evaluamos las peticiones de Dungeon
    const totalDungeons = peticionesDungeonPendientes.length + peticionesTestDungeonAuto;
    if (totalDungeons > 0 && !DungeonService.dungeonEnCurso && !DungeonService.dungeonFaseReclutamiento && !ArenaService.peleaEnCurso && !apuestasAbiertas && !timerEmparejamientoArena) {
        if (peticionesTestDungeonAuto > 0) {
            peticionesTestDungeonAuto--;
            iniciarDungeonReclutamiento(io, true);
        } else {
            const creador = peticionesDungeonPendientes.shift();
            iniciarDungeonReclutamiento(io, false, creador);
        }
        return;
    }
}

function ejecutarCombate(io: Server) {
    const totalDungeons = peticionesDungeonPendientes.length + peticionesTestDungeonAuto;
    const resultado = ArenaService.evaluarSiguienteCombate(io, DungeonService.dungeonEnCurso || totalDungeons > 0, DungeonService.dungeonFaseReclutamiento);

    if (resultado.arrancó) {
        apuestasAbiertas = true;
        listadoApuestas = [];
        tiempoRestanteApuestas = 45;

        io.emit('actualizar_cola', ArenaService.obtenerCola().map(j => `${j.titulo ? '['+j.titulo+'] ' : ''}${j.nombre}(Nv.${j.nivel})`));
        io.emit('apuestas_abiertas_overlay', {
            modo: resultado.modo,
            rojos: ArenaService.contendientesRojos,
            azules: ArenaService.contendientesAzules,
            tiempo: tiempoRestanteApuestas
        });

        if (timerApuestasInterval) clearInterval(timerApuestasInterval);
        timerApuestasInterval = setInterval(() => {
            tiempoRestanteApuestas--;
            io.emit('apuestas_actualizar_timer', { tiempo: tiempoRestanteApuestas });
            if (tiempoRestanteApuestas <= 0) {
                if (timerApuestasInterval) clearInterval(timerApuestasInterval);
                apuestasAbiertas = false;
                io.emit('combate_fuego_abierto');

                // WATCHDOG ARENA: Si en 3 minutos el frontend no responde, forzar reinicio
                if (watchdogArena) clearTimeout(watchdogArena);
                watchdogArena = setTimeout(async () => {
                    console.log('⚠️ [WATCHDOG] El combate se congeló. Reembolsando apuestas...');
                    // Reembolsar el oro comprometido si el servidor reinicia la partida
                    try {
                        for (const apuesta of listadoApuestas) {
                            const jug = await Jugador.findOne({ twitchId: apuesta.usuario.toLowerCase() });
                            if (jug) {
                                jug.set('oro', (jug.get('oro') || 0) + apuesta.cantidad);
                                await jug.save();
                            }
                        }
                    } catch(e) { console.error('Error reembolsando:', e); }
                    
                    ArenaService.peleaEnCurso = false;
                    ArenaService.vaciarContendientes();
                    listadoApuestas = [];
                    evaluarYEjecutarFlujo(io);
                }, 180000); // 3 minutos
            }
        }, 1000);
    } else {
        evaluarYEjecutarFlujo(io);
    }
}

// Helpers para modificar variables de apuestas desde el lector de Twitch
export function setApuestasAbiertas(val: boolean) { apuestasAbiertas = val; }
export function registrarApuesta(apuesta: { usuario: string, bando: string, cantidad: number }) { 
    listadoApuestas.push(apuesta);
    console.log(`🪙 [APUESTA REGISTRADA] @${apuesta.usuario} metió ${apuesta.cantidad} monedas al bando ${apuesta.bando}`);
    
    // Emitimos la lista actualizada de apuestas al Frontend
    if (ioInstance) {
        ioInstance.emit('apuestas_actualizadas', listadoApuestas);
    }
}

// Función auxiliar para iniciar el reclutamiento de Dungeon
export function iniciarDungeonReclutamiento(io: Server, esTestAuto: boolean = false, creador?: any) {
    DungeonService.resetearDungeon();
    DungeonService.dungeonFaseReclutamiento = true;

    // Añadimos automáticamente al creador si existe
    if (creador) {
        DungeonService.agregarHeroe(creador);
    }

    io.emit('dungeon_reclutamiento_abierto', { tiempo: 30 });
    if (creador) {
        io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);
    }

    // Si viene del botón de test automático, simulamos que entran 5 personas de golpe
    if (esTestAuto) {
        const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
        const héroesFalsos = ['Ragnar', 'Shadow', 'Merlin', 'Priest', 'Robin'];

        héroesFalsos.forEach((nombre, i) => {
            DungeonService.agregarHeroe({
                twitchId: `test_hero_auto_${i}`,
                nombre: nombre,
                clase: clases[i]!,
                nivel: Math.floor(Math.random() * 4) + 2
            });
        });
        
        io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);
        
        DungeonService.dungeonFaseReclutamiento = false;
        DungeonService.dungeonEnCurso = true;
        io.emit('dungeon_iniciar', {
            jugadores: DungeonService.grupoDungeon,
            nivelMedio: DungeonService.calcularNivelMedio()
        });
        iniciarWatchdogDungeon(io);
        return;
    }
    
    let tiempoRestanteDungeon = 30;
    if (timerDungeonInterval) clearInterval(timerDungeonInterval);
    timerDungeonInterval = setInterval(() => {
        tiempoRestanteDungeon--;
        io.emit('dungeon_actualizar_timer', { tiempo: tiempoRestanteDungeon });

        if (tiempoRestanteDungeon <= 0) {
            if (timerDungeonInterval) clearInterval(timerDungeonInterval);
            if (DungeonService.dungeonFaseReclutamiento) {
                DungeonService.dungeonFaseReclutamiento = false;
                if (DungeonService.grupoDungeon.length > 0) {
                    DungeonService.dungeonEnCurso = true;
                    io.emit('dungeon_iniciar', {
                        jugadores: DungeonService.grupoDungeon,
                        nivelMedio: DungeonService.calcularNivelMedio()
                    });
                    iniciarWatchdogDungeon(io);
                } else {
                    io.emit('dungeon_limpiar_interfaz');
                    evaluarYEjecutarFlujo(io); // Evaluar si hay peleas de arena pendientes al cancelar
                }
            }
        }
    }, 1000);
}

// Función auxiliar para el watchdog de la mazmorra
export function iniciarWatchdogDungeon(io: Server) {
    if (watchdogDungeon) clearTimeout(watchdogDungeon);
    watchdogDungeon = setTimeout(() => {
        console.log('⚠️ [WATCHDOG] La mazmorra superó el tiempo máximo o se congeló. Forzando reinicio...');
        DungeonService.dungeonEnCurso = false;
        DungeonService.resetearDungeon();
        io.emit('dungeon_limpiar_interfaz');
        evaluarYEjecutarFlujo(io);
    }, 300000); // 5 minutos
}
