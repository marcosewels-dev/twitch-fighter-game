import { Server, Socket } from 'socket.io';
import { ArenaService } from './services/arena.js';
import { DungeonService } from './services/dungeon.js';
import { EconomiaService } from './services/economia.js';
import { enviarMensajeChat } from './twitch.js';
import { Jugador } from './models/Jugador.js';

const VERSION_JUEGO = 1.7;

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

// --- SISTEMA DE AFIJOS DIARIOS (14 MODIFICADORES) ---
export const AFIJOS_POOL = [
    { id: 'soleado', nombre: '🌞 Día Despejado', desc: 'Condiciones normales de combate.' },
    { id: 'frenesi', nombre: '🩸 Frenesí', desc: '+20% Daño, -15% Vida máxima para todos.' },
    { id: 'hierro', nombre: '🛡️ Piel de Hierro', desc: '+20% Vida, -15% Daño para todos.' },
    { id: 'viento', nombre: '🏃 Viento de Cola', desc: 'Todos se mueven un 25% más rápido.' },
    { id: 'niebla', nombre: '🌫️ Niebla Densa', desc: 'Los Ninjas atacan más rápido.' },
    { id: 'arcano', nombre: '✨ Sobrecarga Arcana', desc: 'Magos hacen +30% Daño pero atacan más lento.' },
    { id: 'fe', nombre: '⛪ Fe Inquebrantable', desc: 'Clérigos tienen +30% Vida máxima.' },
    { id: 'francotirador', nombre: '🏹 Francotirador', desc: 'Cazadores atacan desde más lejos (+30 rango).' },
    { id: 'berserker', nombre: '🪓 Furia Berserker', desc: 'Guerreros hacen +20% Daño físico.' },
    { id: 'critico', nombre: '☠️ Toque Mortal', desc: 'Todos tienen su daño máximo potenciado.' },
    { id: 'vampirismo', nombre: '🧛 Noche de Vampiros', desc: 'Nadie se cura (Próximamente: Robo de vida).' },
    { id: 'hielo', nombre: '❄️ Suelo Helado', desc: 'Todos se mueven un 30% más lento.' },
    { id: 'fuego', nombre: '🔥 Ola de Calor', desc: 'El suelo quema, todos caminan más rápido.' },
    { id: 'oro', nombre: '💰 Fiebre del Oro', desc: 'Día de riquezas. (Multiplicador de apuestas +20%).' }
];
// Selecciona un afijo aleatorio al encender el servidor (se puede cambiar por un cronómetro diario luego)
export let afijoDiario = AFIJOS_POOL[Math.floor(Math.random() * AFIJOS_POOL.length)];

// --- SISTEMA DE TÍTULOS DE PRESTIGIO (20 MODIFICADORES) ---
export const TITULOS_PRESTIGIO = [
    { id: 'novato', nombre: 'Novato', desc: 'Juega por primera vez' },
    { id: 'luchador', nombre: 'Luchador', desc: 'Alcanza el Nivel 5' },
    { id: 'gladiador', nombre: 'Gladiador', desc: 'Alcanza el Nivel 10' },
    { id: 'veterano', nombre: 'Veterano', desc: 'Alcanza el Nivel 20' },
    { id: 'maestro', nombre: 'Maestro', desc: 'Alcanza el Nivel 30' },
    { id: 'leyenda', nombre: 'Leyenda Viva', desc: 'Alcanza el Nivel 50' },
    { id: 'dios', nombre: 'Dios de la Arena', desc: 'Alcanza el Nivel 100' },
    { id: 'asesino', nombre: 'Asesino', desc: 'Consigue 10 Victorias' },
    { id: 'carnicero', nombre: 'Carnicero', desc: 'Consigue 50 Victorias' },
    { id: 'ejecutor', nombre: 'El Ejecutor', desc: 'Consigue 100 Victorias' },
    { id: 'rico', nombre: 'Acaudalado', desc: 'Acumula 1.000 Oro' },
    { id: 'millonario', nombre: 'Millonario', desc: 'Acumula 10.000 Oro' },
    { id: 'juggernaut', nombre: 'Juggernaut', desc: 'Nivel 20 Guerrero' },
    { id: 'sombra', nombre: 'Sombra', desc: 'Nivel 20 Ninja' },
    { id: 'archimago', nombre: 'Archimago', desc: 'Nivel 20 Mago' },
    { id: 'santo', nombre: 'Santo', desc: 'Nivel 20 Clérigo' },
    { id: 'franco', nombre: 'Francotirador', desc: 'Nivel 20 Cazador' }
];

export function obtenerTitulosDesbloqueados(jugador: any): string[] {
    const titulosGuardados = jugador.get('titulosDesbloqueados') || [];
    const titulos = new Set<string>(['novato', ...titulosGuardados.map((t: string) => t.toLowerCase())]);
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
                        const xpBase = EconomiaService.calcularXPGanador1v1(contendiente.nivel, 1, winNombre); // Nivel aproximado para simplificar la fórmula
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

// Helper para invocar de forma centralizada al asignador de combates
export function evaluarYEjecutarFlujo(io: Server) {
    // Si hay una dungeon en cola y la arena está libre, lanzamos la dungeon
    const totalDungeons = peticionesDungeonPendientes.length + peticionesTestDungeonAuto;
    if (totalDungeons > 0 && !DungeonService.dungeonEnCurso && !DungeonService.dungeonFaseReclutamiento && !ArenaService.peleaEnCurso && !apuestasAbiertas) {
        if (peticionesTestDungeonAuto > 0) {
            peticionesTestDungeonAuto--;
            iniciarDungeonReclutamiento(io, true);
        } else {
            const creador = peticionesDungeonPendientes.shift();
            iniciarDungeonReclutamiento(io, false, creador);
        }
        return;
    }

    const resultado = ArenaService.evaluarSiguienteCombate(io, DungeonService.dungeonEnCurso || totalDungeons > 0, DungeonService.dungeonFaseReclutamiento);

    if (resultado.arrancó) {
        apuestasAbiertas = true;
        listadoApuestas = [];
        let tiempoRestante = 45;

        io.emit('actualizar_cola', ArenaService.obtenerCola().map(j => `${j.titulo ? '['+j.titulo+'] ' : ''}${j.nombre}(Nv.${j.nivel})`));
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

// --- PROCESADOR CENTRAL DE COMANDOS (PARA TWITCH Y TEST) ---
export async function procesarComandoChat(io: Server, username: string, mensaje: string, esTest: boolean = false) {
    const mensajeLimpio = mensaje.trim();
    const usuarioLimpio = username.trim();
    const partes = mensajeLimpio.split(' ');
    const comando = partes[0]?.toLowerCase();

    if (comando === '!luchar') {
        const clasesValidas = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
        const claseElegida = partes[1]?.toLowerCase() || '';
        let claseFinal = clasesValidas.includes(claseElegida) ? claseElegida : null;

        const targetId = usuarioLimpio.toLowerCase();
        const targetName = usuarioLimpio;
        let nivelFinal = 1; // Nivel base
        let tituloFinal = '';

        try {
            let jugador = await Jugador.findOne({ twitchId: targetId });
            if (jugador) {
                if (!claseFinal && jugador.claseActual) {
                    claseFinal = jugador.claseActual; // Usamos su clase guardada
                }
                // Cogemos su nivel REAL para esa clase
                const statsClase = jugador.get(claseFinal || 'guerrero');
                if (statsClase && statsClase.nivel) nivelFinal = statsClase.nivel;
                
                const titID = jugador.get('tituloEquipado');
                if (titID) tituloFinal = TITULOS_PRESTIGIO.find(t => t.id === titID)?.nombre || '';
            } else {
                // EL JUGADOR NO EXISTE: Lo creamos para que se guarden sus progresos futuros
                if (!claseFinal) claseFinal = clasesValidas[Math.floor(Math.random() * clasesValidas.length)]!;
                jugador = new Jugador({
                    twitchId: targetId,
                    username: targetName,
                    claseActual: claseFinal
                });
                await jugador.save();
                nivelFinal = 1; // Nivel 1 por defecto al empezar
            }
        } catch (e) { console.error('Error al leer nivel BD:', e); }

        // Si es su primera vez y no eligió clase, le damos una aleatoria
        if (!claseFinal) {
            claseFinal = clasesValidas[Math.floor(Math.random() * clasesValidas.length)]!;
        }

        ArenaService.agregarACola({ twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: nivelFinal, titulo: tituloFinal });

        const prefijoTit = tituloFinal ? `[${tituloFinal}] ` : '';
        const msg = `⚔️ ${prefijoTit}@${targetName} se ha unido a la cola de la Arena como ${claseFinal.toUpperCase()} (Nv.${nivelFinal}).`;
        io.emit('chat_mensaje_bot', { mensaje: msg });
        if (!esTest) enviarMensajeChat(msg);
        if (esTest) console.log(`📡 RESPUESTA: ${msg}`);

        evaluarYEjecutarFlujo(io);
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
                if (titID) tituloFinal = TITULOS_PRESTIGIO.find(t => t.id === titID)?.nombre || '';
            } else {
                // EL JUGADOR NO EXISTE: Lo creamos para guardar stats de la raid
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

        peticionesDungeonPendientes.push({
            twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: nivelFinal, titulo: tituloFinal
        });

        if (esTest) console.log(`⏳ [COLA] Petición de mazmorra en cola. Total: ${peticionesDungeonPendientes.length}`);
        evaluarYEjecutarFlujo(io);
    }
    else if (comando === '!entrar') {
        if (DungeonService.dungeonFaseReclutamiento && DungeonService.grupoDungeon.length < 5) {
            const clases = ['guerrero', 'ninja', 'mago', 'clerigo', 'cazador'];
            const claseElegida = partes[1]?.toLowerCase() || '';
            let claseFinal = clases.includes(claseElegida) ? claseElegida : null;

            const targetId = usuarioLimpio.toLowerCase();
            const targetName = usuarioLimpio;
            let nivelFinal = 1; // Nivel base
            let tituloFinal = '';

            try {
                let jugador = await Jugador.findOne({ twitchId: targetId });
                if (jugador) {
                    if (!claseFinal && jugador.claseActual) claseFinal = jugador.claseActual;
                    
                    const statsClase = jugador.get(claseFinal || 'guerrero');
                    if (statsClase && statsClase.nivel) nivelFinal = statsClase.nivel;
                    const titID = jugador.get('tituloEquipado');
                    if (titID) tituloFinal = TITULOS_PRESTIGIO.find(t => t.id === titID)?.nombre || '';
                } else {
                    // EL JUGADOR NO EXISTE: Lo creamos en DB
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

            if (!claseFinal) {
                claseFinal = clases[Math.floor(Math.random() * clases.length)]!;
            }

            DungeonService.agregarHeroe({ twitchId: targetId, nombre: targetName, clase: claseFinal, nivel: nivelFinal, titulo: tituloFinal });
            io.emit('dungeon_actualizar_grupo', DungeonService.grupoDungeon);

            if (DungeonService.grupoDungeon.length >= 5) {
                if (timerDungeonInterval) clearInterval(timerDungeonInterval);
                DungeonService.dungeonFaseReclutamiento = false;
                DungeonService.dungeonEnCurso = true;
                io.emit('dungeon_iniciar', { jugadores: DungeonService.grupoDungeon, nivelMedio: DungeonService.calcularNivelMedio() });
                iniciarWatchdogDungeon(io);
            }
        }
    } 
    else if (comando === '!clase') {
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
            if (!jugador) {
                jugador = new Jugador({ twitchId: usuarioLimpio.toLowerCase(), username: usuarioLimpio, claseActual: nuevaClase });
            } else {
                jugador.claseActual = nuevaClase;
            }
            await jugador.save();

            const msg = `✅ @${usuarioLimpio} ha cambiado su clase a ${nuevaClase!.toUpperCase()}. Ahora lucharás con esta clase por defecto.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
        } catch (error) {
            console.error('Error al cambiar de clase:', error);
        }
    }
    else if (comando === '!afijo') {
        if (afijoDiario) {
            const msg = `🔮 MODIFICADOR DE HOY: ${afijoDiario.nombre} - ${afijoDiario.desc}`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        }
    }
    else if (comando === '!titulos') {
        const subCmd = partes[1]?.toLowerCase();
        
        if (subCmd === 'todos' || subCmd === 'lista') {
            const lista = TITULOS_PRESTIGIO.map(t => `${t.id}(${t.desc})`).join(', ');
            const msg = `🏆 TÍTULOS: ${lista}. Usa !titulo [id] para equipar.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg.substring(0, 500));
            if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
            return;
        }

        try {
            const targetId = usuarioLimpio.toLowerCase();
            const jugador = await Jugador.findOne({ twitchId: targetId });
            if (!jugador) {
                const msg = `❌ @${usuarioLimpio}, no estás registrado. ¡Escribe !luchar para empezar!`;
                io.emit('chat_mensaje_bot', { mensaje: msg });
                if (!esTest) enviarMensajeChat(msg);
                if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
                return;
            }
            
            const desbloqueados = obtenerTitulosDesbloqueados(jugador);
            const titID = jugador.get('tituloEquipado');
            const tituloActualStr = titID ? `(Equipado: ${titID})` : '(Ninguno)';
            const msg = `🏅 @${usuarioLimpio}, tienes ${desbloqueados.length} títulos: ${desbloqueados.join(', ')}. ${tituloActualStr}. Usa !titulo [nombre] para equiparte uno o !titulos todos para ver la lista.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg.substring(0, 500));
            if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
        } catch(e) {
            console.error('Error procesando !titulos:', e);
        }
    }
    else if (comando === '!titulo') {
        const tituloId = partes[1]?.toLowerCase();
        if (!tituloId) {
            const msg = `❌ @${usuarioLimpio}, debes indicar qué título equipar. Ejemplo: !titulo novato`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
            if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
            return;
        }
        try {
            const targetId = usuarioLimpio.toLowerCase();
            const jugador = await Jugador.findOne({ twitchId: targetId });
            if (!jugador) {
                const msg = `❌ @${usuarioLimpio}, no estás registrado. ¡Escribe !luchar para empezar!`;
                io.emit('chat_mensaje_bot', { mensaje: msg });
                if (!esTest) enviarMensajeChat(msg);
                if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
                return;
            }
            const desbloqueados = obtenerTitulosDesbloqueados(jugador);
            if (desbloqueados.includes(tituloId)) {
                jugador.set('tituloEquipado', tituloId);
                await jugador.save();
                const objTit = TITULOS_PRESTIGIO.find(t => t.id === tituloId);
                const msg = `✅ @${usuarioLimpio} se ha equipado el título de [${objTit?.nombre}]! Lo verás en tu próxima partida.`;
                io.emit('chat_mensaje_bot', { mensaje: msg });
                if (!esTest) enviarMensajeChat(msg);
                if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
            } else {
                const msg = `❌ @${usuarioLimpio}, no tienes desbloqueado el título [${tituloId}].`;
                io.emit('chat_mensaje_bot', { mensaje: msg });
                if (!esTest) enviarMensajeChat(msg);
                if (esTest) console.log(`📡 RESPUESTA: ${msg}`);
            }
        } catch(e) {
            console.error('Error procesando !titulo:', e);
        }
    }
    else if (comando === '!ayuda' || comando === '!comandos') {
        const respuestaAyuda = `🤖 COMANDOS: !luchar [clase] | !apostar [bando] [oro] | !dungeon | !entrar | !clase | !stats | !titulos | !afijo | !top ⚔️ Clases: guerrero, ninja, mago, clerigo, cazador`;
        io.emit('chat_mensaje_bot', { mensaje: respuestaAyuda });
        if (!esTest) enviarMensajeChat(respuestaAyuda);
        if (esTest) console.log(`📡 RESPUESTA: ${respuestaAyuda}`);
    }
    else if (comando === '!stats' || comando === '!oro') {
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
            const oro = jugador.oro || 0;

            // Calcular XP restante para el próximo nivel (Fórmula base aproximada: Nivel * 100)
            const xpNecesaria = nivelActual * 100; 
            const xpFaltante = Math.max(0, xpNecesaria - xpActual);

            const msg = `📊 @${usuarioLimpio} | ${clasePreferida.toUpperCase()} (Nv.${nivelActual}) | 🪙 Oro: ${oro} | ⚔️ Victorias: ${victorias} | 🌟 Faltan ${xpFaltante} XP para el Nv.${nivelActual + 1}.`;
            io.emit('chat_mensaje_bot', { mensaje: msg });
            if (!esTest) enviarMensajeChat(msg);
        } catch (error) {
            console.error('Error al obtener stats:', error);
        }
    }
    else if (comando === '!top') {
        try {
            const jugadores = await Jugador.find();
            const ranking = jugadores.map(j => {
                const victoriasTotales = (j.guerrero?.victorias || 0) + (j.ninja?.victorias || 0) + (j.mago?.victorias || 0) + (j.clerigo?.victorias || 0) + (j.cazador?.victorias || 0); 
                return { username: j.username, victorias: victoriasTotales };
            })
            .filter(j => j.victorias > 0).sort((a, b) => b.victorias - a.victorias).slice(0, 3);
            
            const respuestaTop = ranking.length === 0 
                ? `🏆 Aún no hay nadie en el TOP. ¡Sé el primero en ganar en la arena!`
                : `🏆 TOP 3 LUCHADORES: ` + ranking.map((j, i) => `${i+1}º ${j.username} (${j.victorias}V)`).join(' | ');
            
            io.emit('chat_mensaje_bot', { mensaje: respuestaTop });
            if (!esTest) enviarMensajeChat(respuestaTop);
        } catch (error) {
            console.error('Error al obtener el ranking para Twitch:', error);
        }
    }
}
