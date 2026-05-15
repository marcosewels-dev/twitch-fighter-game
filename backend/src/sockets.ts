import { Server, Socket } from 'socket.io';
import { ArenaService } from './services/arena.js';
import { DungeonService } from './services/dungeon.js';
import { EconomiaService } from './services/economia.js';

const VERSION_JUEGO = 1.6;

// Variables internas compartidas con el controlador de Twitch
export let listadoApuestas: any[] = [];
export let apuestasAbiertas = false;
export let timerApuestasInterval: NodeJS.Timeout | null = null;
export let timerDungeonInterval: NodeJS.Timeout | null = null;
export let watchdogArena: NodeJS.Timeout | null = null;
export let watchdogDungeon: NodeJS.Timeout | null = null;
export let peticionesDungeonPendientes = 0;
export let peticionesTestDungeonAuto = 0; // Para encolar dungeons masivas de test
export let ioInstance: Server | null = null;


export function configurarSockets(io: Server) {
    ioInstance = io;
    io.on('connection', (socket: Socket) => {
        // Control automático de versiones anti-caché para el OBS
        socket.emit('chequear_version', { version: VERSION_JUEGO });

        // Sincroniza la cola actual al conectar
        const colaFormateada = ArenaService.obtenerCola().map(j => `${j.nombre}(Nv.${j.nivel})`);
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
                    io.emit('chat_mensaje_bot', { mensaje: `🤖 [BOT] ¡El equipo ${bandoGanador.toUpperCase()} gana! Repartiendo ${totalApostado} 🪙 entre los acertantes (Multiplicador: x${multiplicador}).` });
                } else {
                    io.emit('chat_mensaje_bot', { mensaje: `🤖 [BOT] ¡El equipo ${bandoGanador.toUpperCase()} gana! Nadie apostó por ellos, ¡la casa se embolsa los ${totalApostado} 🪙!` });
                }
            } else {
                 io.emit('chat_mensaje_bot', { mensaje: `🤖 [BOT] Combate terminado sin apuestas. ¡A ver si os animáis en la próxima!` });
            }

            try {
                // Premiar ganadores
                for (const winNombre of datos.nombresGanadores) {
                    const contendiente = [...ArenaService.contendientesRojos, ...ArenaService.contendientesAzules].find(c => c.nombre === winNombre);
                    if (contendiente) {
                        const xpBase = EconomiaService.calcularXPGanador1v1(contendiente.nivel, 1, winNombre); // Nivel aproximado para simplificar la fórmula
                        await EconomiaService.procesarSubidaNivel(contendiente.twitchId, xpBase, contendiente.clase, true, 25);
                    }
                }

                // Recompensar perdedores
                for (const losNombre of datos.nombresPerdedores) {
                    const contendiente = [...ArenaService.contendientesRojos, ...ArenaService.contendientesAzules].find(c => c.nombre === losNombre);
                    if (contendiente) {
                        await EconomiaService.procesarSubidaNivel(contendiente.twitchId, 15, contendiente.clase, false, 5);
                    }
                }

                // Repartir las monedas de las apuestas del chat
                await EconomiaService.procesarPremiosApuestas(listadoApuestas, datos.nombresGanadores);

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
            if (watchdogDungeon) clearTimeout(watchdogDungeon); // Cancelamos el perro guardián
            if (DungeonService.grupoDungeon.length === 0) return;

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
            const partes = mensajeLimpio.split(' ');
            const comando = partes[0]?.toLowerCase();

            console.log(`🧪 [TEST CHAT VIRTUAL] @${usuarioLimpio}: ${mensajeLimpio}`);


            // 1️⃣ SIMULAR COMANDO: !luchar [clase]
            if (comando === '!luchar') {
                const clase = partes[1]?.toLowerCase() || 'guerrero';
                const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];

                if (clasesValidas.includes(clase)) {
                    // Añadimos un sufijo aleatorio para poder añadir a la arena varios 
                    // luchadores escribiendo el comando repetidas veces en el panel de test
                    const testIdRandom = Math.floor(Math.random() * 1000);
                    ArenaService.agregarACola({
                        twitchId: `test_user_${testIdRandom}`,
                        nombre: `${usuarioLimpio}_${testIdRandom}`,
                        clase: clase,
                        nivel: Math.floor(Math.random() * 4) + 1 // Nivel aleatorio entre 1 y 4 para la prueba
                    });
                    // Evaluamos si con este nuevo jugador se puede lanzar ya un combate
                    evaluarYEjecutarFlujo(io);
                }
            } 
            
            // SIMULADOR COMANDO: !apostar [bando] [cantidad]
            else if (comando === '!apostar') {
                const bando = partes[1]?.toLowerCase();
                const cantidad = parseInt(partes[2] || '0');

                if (!apuestasAbiertas) {
                    console.log(`❌ [TEST] Las apuestas están cerradas. No se puede apostar al bando ${bando}.`);
                    return;
                }

                if ((bando === 'rojo' || bando === 'azul') && cantidad > 0) {
                    registrarApuesta({
                        usuario: usuarioLimpio,
                        bando: bando,
                        cantidad: cantidad
                    });
                }
            }

            // 2️⃣ SIMULAR COMANDO: !dungeon (Abrir reclutamiento)
            else if (comando === '!dungeon') {
                peticionesDungeonPendientes++;
                console.log(`⏳ [COLA] Petición de mazmorra recibida. En cola: ${peticionesDungeonPendientes}`);
                evaluarYEjecutarFlujo(io);
            }

            // 3️⃣ SIMULAR COMANDO: !entrar (Unirse a la Raid abierta)
            else if (comando === '!entrar') {
                if (DungeonService.dungeonFaseReclutamiento && DungeonService.grupoDungeon.length < 5) {
                    const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
                    const claseAleatoria = clases[Math.floor(Math.random() * clases.length)]!;

                    // Generamos sufijo aleatorio para poder entrar varias veces con el mismo usuario de test
                    const testIdRandom = Math.floor(Math.random() * 1000);
                    DungeonService.agregarHeroe({
                        twitchId: `test_hero_${testIdRandom}`,
                        nombre: `${usuarioLimpio}_${testIdRandom}`,
                        clase: claseAleatoria,
                        nivel: Math.floor(Math.random() * 3) + 2
                    });

                    // Notificamos al Canvas el grupo actualizado para que los pinte en el HUD de espera
                    io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);

                    // Si ya se ha llenado el grupo de 5, cerramos reclutamiento e iniciamos automáticamente
                    if (DungeonService.grupoDungeon.length >= 5) {
                        if (timerDungeonInterval) clearTimeout(timerDungeonInterval); // Cancelamos el temporizador de 30s
                        DungeonService.dungeonFaseReclutamiento = false;
                        DungeonService.dungeonEnCurso = true;
                        const nivelMedio = DungeonService.calcularNivelMedio();
                        io.emit('dungeon_iniciar', {
                            jugadores: DungeonService.grupoDungeon,
                            nivelMedio: nivelMedio
                        });
                        iniciarWatchdogDungeon(io);
                    }
                }
            }// 4️⃣ SIMULAR COMANDO: !ayuda o !comandos
            else if (comando === '!ayuda' || comando === '!comandos') {
                // Simulamos la respuesta que el bot enviaría al chat de Twitch
                const respuestaAyuda = `🤖 [BOT-AYUDA]: Comandos disponibles: !luchar [clase] (guerrero, ninja, mago, clerigo, cazador), !dungeon (abrir raid), !entrar (unirse a raid), !oro, !stats y !top.`;
                
                io.emit('chat_mensaje_bot', { mensaje: respuestaAyuda });
                console.log(`📡 RESPUESTA ENVIADA A @${usuarioLimpio}: ${respuestaAyuda}`);
            }
        });
    });
}

// Helper para invocar de forma centralizada al asignador de combates
export function evaluarYEjecutarFlujo(io: Server) {
    // Si hay una dungeon en cola y la arena está libre, lanzamos la dungeon
    const totalDungeons = peticionesDungeonPendientes + peticionesTestDungeonAuto;
    if (totalDungeons > 0 && !DungeonService.dungeonEnCurso && !DungeonService.dungeonFaseReclutamiento && !ArenaService.peleaEnCurso && !apuestasAbiertas) {
        if (peticionesTestDungeonAuto > 0) {
            peticionesTestDungeonAuto--;
            iniciarDungeonReclutamiento(io, true);
        } else {
            peticionesDungeonPendientes--;
            iniciarDungeonReclutamiento(io, false);
        }
        return;
    }

    const resultado = ArenaService.evaluarSiguienteCombate(io, DungeonService.dungeonEnCurso || totalDungeons > 0, DungeonService.dungeonFaseReclutamiento);

    if (resultado.arrancó) {
        apuestasAbiertas = true;
        listadoApuestas = [];
        let tiempoRestante = 45;

        io.emit('actualizar_cola', ArenaService.obtenerCola().map(j => `${j.nombre}(Nv.${j.nivel})`));
        io.emit('apuestas_abiertas_overlay', {
            modo: resultado.modo,
            rojos: ArenaService.contendientesRojos,
            azules: ArenaService.contendientesAzules,
            tiempo: tiempoRestante
        });

        if (timerApuestasInterval) clearInterval(timerApuestasInterval);
        timerApuestasInterval = setInterval(() => {
            tiempoRestante--;
            io.emit('apuestas_actualizar_timer', { tiempo: tiempoRestante });
            if (tiempoRestante <= 0) {
                if (timerApuestasInterval) clearInterval(timerApuestasInterval);
                apuestasAbiertas = false;
                io.emit('combate_fuego_abierto');

                // WATCHDOG ARENA: Si en 3 minutos el frontend no responde, forzar reinicio
                if (watchdogArena) clearTimeout(watchdogArena);
                watchdogArena = setTimeout(() => {
                    console.log('⚠️ [WATCHDOG] El combate superó el tiempo máximo o se congeló. Forzando reinicio...');
                    ArenaService.peleaEnCurso = false;
                    ArenaService.vaciarContendientes();
                    listadoApuestas = [];
                    evaluarYEjecutarFlujo(io);
                }, 180000); // 3 minutos
            }
        }, 1000);
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
export function iniciarDungeonReclutamiento(io: Server, esTestAuto: boolean = false) {
    DungeonService.resetearDungeon();
    DungeonService.dungeonFaseReclutamiento = true;

    io.emit('dungeon_reclutamiento_abierto', { tiempo: 30 });

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
    
    if (timerDungeonInterval) clearTimeout(timerDungeonInterval);
    timerDungeonInterval = setTimeout(() => {
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
    }, 30000);
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

// --- PROCESADOR CENTRAL DE COMANDOS (PARA TWITCH Y TEST) ---
export async function procesarComandoChat(io: Server, username: string, mensaje: string, esTest: boolean = false) {
    const mensajeLimpio = mensaje.trim();
    const usuarioLimpio = username.trim();
    const partes = mensajeLimpio.split(' ');
    const comando = partes[0]?.toLowerCase();

    if (comando === '!luchar') {
        const clase = partes[1]?.toLowerCase() || 'guerrero';
        const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];

        if (clasesValidas.includes(clase)) {
            // En Test simulamos diferentes usuarios. En Twitch usamos el real para que un espectador no entre 50 veces.
            const targetId = esTest ? `test_user_${Math.floor(Math.random() * 1000)}` : usuarioLimpio.toLowerCase();
            const targetName = esTest ? `${usuarioLimpio}_${Math.floor(Math.random() * 1000)}` : usuarioLimpio;

            ArenaService.agregarACola({ twitchId: targetId, nombre: targetName, clase: clase, nivel: Math.floor(Math.random() * 4) + 1 });
            evaluarYEjecutarFlujo(io);
        }
    } 
    else if (comando === '!apostar') {
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
    else if (comando === '!dungeon') {
        peticionesDungeonPendientes++;
        if (esTest) console.log(`⏳ [COLA] Petición de mazmorra en cola.`);
        evaluarYEjecutarFlujo(io);
    }
    else if (comando === '!entrar') {
        if (DungeonService.dungeonFaseReclutamiento && DungeonService.grupoDungeon.length < 5) {
            const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
            const claseElegida = partes[1]?.toLowerCase();
            const claseFinal = clases.includes(claseElegida!) ? claseElegida! : clases[Math.floor(Math.random() * clases.length)]!;

            const targetId = esTest ? `test_hero_${Math.floor(Math.random() * 1000)}` : usuarioLimpio.toLowerCase();
            const targetName = esTest ? `${usuarioLimpio}_${Math.floor(Math.random() * 1000)}` : usuarioLimpio;

            DungeonService.agregarHeroe({ twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: Math.floor(Math.random() * 3) + 2 });
            io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);

            if (DungeonService.grupoDungeon.length >= 5) {
                if (timerDungeonInterval) clearTimeout(timerDungeonInterval);
                DungeonService.dungeonFaseReclutamiento = false;
                DungeonService.dungeonEnCurso = true;
                io.emit('dungeon_iniciar', { jugadores: DungeonService.grupoDungeon, nivelMedio: DungeonService.calcularNivelMedio() });
                iniciarWatchdogDungeon(io);
            }
        }
    } 
    else if (comando === '!ayuda' || comando === '!comandos') {
        const respuestaAyuda = `🤖 [BOT-AYUDA]: Comandos: !luchar [clase], !dungeon, !entrar [clase], !apostar [rojo/azul] [cant]`;
        io.emit('chat_mensaje_bot', { mensaje: respuestaAyuda });
        if (esTest) console.log(`📡 RESPUESTA: ${respuestaAyuda}`);
    }
}