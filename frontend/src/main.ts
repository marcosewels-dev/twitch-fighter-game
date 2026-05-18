import { socket } from './services/socket';
import { Luchador, Particula } from './entities/Luchador';
import { Monstruo } from './entities/Monstruo';

const VERSION_LOCAL = 1.7; // Control de versiones sincronizado con el backend

socket.on('chequear_version', (datos: { version: number }) => {
  if (datos.version !== VERSION_LOCAL) {
    window.location.reload();
  }
});

// ==========================================
// 🔬 SUITE DE INTEGRACIÓN Y TRAZAS E2E
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const panelTest = document.getElementById('test-panel');
const logTest = document.getElementById('test-log');

// Si la URL lleva ?test=true, mostramos la consola oculta de depuración
if (urlParams.get('test') === 'true' && panelTest) {
  panelTest.style.display = 'flex';
}

function registrarTrazaTest(mensaje: string) {
  if (logTest) {
    logTest.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${mensaje}</div>`;
    logTest.scrollTop = logTest.scrollHeight; // Auto-scroll al último evento
  }
}

// 📡 Interceptores para Visualizar la Extracción de Datos
socket.on('connect', () => {
  registrarTrazaTest(`✅ Sockets: Canal de red abierto con el Servidor.`);
});

socket.on('apuestas_abiertas_overlay', (datos: { modo: '1v1' | '3v3', rojos: any[], azules: any[] }) => {
  registrarTrazaTest(`📥 [EXTRACCIÓN]: Datos de Combate recogidos.`);
  registrarTrazaTest(`⚔️ Modo: ${datos.modo} | Rojos: ${datos.rojos.length} vs Azules: ${datos.azules.length}`);
});

socket.on('combate_fuego_abierto', () => {
  registrarTrazaTest(`🎮 [COMBATE]: Fin de apuestas. Renderizando simulación en Canvas.`);
});

socket.on('dungeon_iniciar', (datos: { jugadores: any[]; nivelMedio: number }) => {
  registrarTrazaTest(`📥 [EXTRACCIÓN RAID]: Capturados ${datos.jugadores.length} héroes.`);
  registrarTrazaTest(`🐲 [COMBATE]: Dungeon Nv.${datos.nivelMedio} cargada en pantalla.`);
});

socket.on('combate_finalizado_resultado', (datos: { nombresGanadores: string[] }) => {
  registrarTrazaTest(`📈 [ACTUALIZACIÓN]: Combate terminado. Ganador: ${datos.nombresGanadores[0]}. Enviando datos de XP/Oro a Base de Datos.`);
});

socket.on('chat_mensaje_bot', (datos: { mensaje: string }) => {
  registrarTrazaTest(`💬 ${datos.mensaje}`);
});

socket.on('dungeon_terminada', (datos: { victoria: boolean, fasesSuperadas: number }) => {
  registrarTrazaTest(`📈 [ACTUALIZACIÓN]: Raid finalizada. Resultado: ${datos.victoria ? 'VICTORIA' : 'DERROTA'} (Fases: ${datos.fasesSuperadas}/4). Sincronizando BD.`);
});

// 🖱️ Vincular los Botones de Acción de la Pantalla
// 🖱️ FUNCIÓN CENTRAL PARA INYECTAR COMANDOS AL BACKEND
function enviarComandoSimulado(mensaje: string) {
  const inputUser = document.getElementById('test-user-name') as HTMLInputElement;
  const username = inputUser?.value || 'ViewerAnonimo';

  if (!mensaje.trim()) return;

  registrarTrazaTest(`💬 [CHAT SIMULADO] @${username}: ${mensaje}`);

  // Enviamos la traza pura al backend para que la procese como un comando real
  socket.emit('test_enviar_comando_chat', {
    username: username,
    mensaje: mensaje
  });
}

// Listener para el botón de enviar (➡️)
document.getElementById('btn-enviar-comando')?.addEventListener('click', () => {
  const inputCmd = document.getElementById('test-chat-input') as HTMLInputElement;
  if (inputCmd) {
    enviarComandoSimulado(inputCmd.value);
    inputCmd.value = ''; // Limpiamos la caja de texto
  }
});

// Listener para enviar pulsando "Enter" en la caja de texto
document.getElementById('test-chat-input')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const inputCmd = e.target as HTMLInputElement;
    enviarComandoSimulado(inputCmd.value);
    inputCmd.value = '';
  }
});

// Vincular los botones de Macros Rápidos
document.querySelectorAll('.btn-macro').forEach(boton => {
  boton.addEventListener('click', (e) => {
    const target = e.target as HTMLButtonElement;
    const comando = target.getAttribute('data-cmd');
    if (comando) {
      enviarComandoSimulado(comando);
    }
  });
});

// Mantenemos el botón heredado de llenado masivo rápido de la cola
document.getElementById('btn-simular-cola')?.addEventListener('click', () => {
  const inputCant = document.getElementById('test-players-count') as HTMLInputElement;
  const cantidad = parseInt(inputCant?.value) || 6;
  registrarTrazaTest(`⚡ [COMANDO MASIVO]: Forzando !luchar automático para ${cantidad} bots.`);
  socket.emit('test_forzar_luchar_masivo', { cantidad: cantidad });
});
// ==========================================

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// --- ESTADOS GLOBALES DE RENDERIZADO DEL ENGINE ---
let listaRojos: Luchador[] = [];
let listaAzules: Luchador[] = [];
let combateGrupalActivo = false;
let apuestasActivasFase = false;
let relojContadorPantalla = 0;
let particulas: Particula[] = [];
let intensidadTemblor = 0;
let limpiezaTimer: number | null = null;
let finDePeleaEnviado = false;

let modoDungeonActivo = false;
let reclutamientoDungeon = false;
let grupoDungeonHéroes: Luchador[] = [];
let apuestasActuales: { usuario: string, bando: string, cantidad: number }[] = [];
let monstruoActual: Monstruo | null = null;
let faseDungeonActual = 0;
let nivelMedioDungeon = 1;
let finDungeonEnviado = false;
let colaEspera: string[] = [];

// Escuchar el afijo del servidor y guardarlo globalmente
socket.on('afijo_actualizado', (afijo: any) => {
  (window as any).afijoDiario = afijo;
});

// --- FUNCIONES DE LIMPIEZA (MÁQUINA DE ESTADOS) ---
function transicionarEstado() {
  // 1. Cancelamos cualquier temporizador de limpieza pendiente (evita bugs visuales)
  if (limpiezaTimer) {
    clearTimeout(limpiezaTimer);
    limpiezaTimer = null;
  }
  
  // 2. Apagamos todas las fases del juego
  apuestasActivasFase = false;
  combateGrupalActivo = false;
  reclutamientoDungeon = false;
  modoDungeonActivo = false;
  apuestasActuales = []; // Limpiamos la tabla de apuestas
  
  // 3. Reseteamos bloqueos de red
  finDePeleaEnviado = false;
  finDungeonEnviado = false;
}

// --- LISTENERS DE COMUNICACIÓN CON EL SERVIDOR ---
socket.on('apuestas_abiertas_overlay', (datos: { modo: '1v1' | '3v3', rojos: any[], azules: any[], tiempo: number }) => {
  transicionarEstado();
  apuestasActivasFase = true; 
  relojContadorPantalla = datos.tiempo;

  listaRojos = datos.rojos.map((j, i) => {
    const l = new Luchador(datos.modo === '3v3' ? 100 + i * 55 : 150, 600, j.nombre, j.clase, j.nivel, 0, false, j.titulo);
    l.equipo = 'rojo'; return l;
  });
  listaAzules = datos.azules.map((j, i) => {
    const l = new Luchador(datos.modo === '3v3' ? 950 + i * 55 : 1080, 600, j.nombre, j.clase, j.nivel, 0, false, j.titulo);
    l.equipo = 'azul'; 
    l.direccionMira = 'izquierda';
    return l;
  });
});

socket.on('actualizar_cola', (cola: string[]) => {
  colaEspera = cola;
});

socket.on('apuestas_actualizar_timer', (datos: { tiempo: number }) => { relojContadorPantalla = datos.tiempo; });

socket.on('apuestas_actualizadas', (listaApuestas: any[]) => {
  apuestasActuales = listaApuestas;
});

socket.on('combate_fuego_abierto', () => { 
  transicionarEstado();
  combateGrupalActivo = true; 
});

socket.on('dungeon_reclutamiento_abierto', (datos: { tiempo: number }) => {
  transicionarEstado();
  reclutamientoDungeon = true; 
  relojContadorPantalla = datos.tiempo; grupoDungeonHéroes = [];
});
socket.on('dungeon_actualizar_timer', (datos: { tiempo: number }) => { relojContadorPantalla = datos.tiempo; });
socket.on('dungeon_actualizar_grupo', (lista: any[]) => {
  grupoDungeonHéroes = lista.map((h, i) => new Luchador(60 + i * 60, 600, h.nombre, h.clase, h.nivel, 0, true, h.titulo));
});

socket.on('dungeon_iniciar', (datos: { jugadores: any[]; nivelMedio: number }) => {
  transicionarEstado();
  modoDungeonActivo = true; 
  faseDungeonActual = 0; 
  nivelMedioDungeon = datos.nivelMedio; 
  grupoDungeonHéroes = datos.jugadores.map((h, i) => new Luchador(80 + i * 60, 600, h.nombre, h.clase, h.nivel, nivelMedioDungeon, true, h.titulo));
  monstruoActual = new Monstruo(850, 600, 0, nivelMedioDungeon);
});

socket.on('dungeon_limpiar_interfaz', () => {
  if (limpiezaTimer) clearTimeout(limpiezaTimer);
  limpiezaTimer = window.setTimeout(() => { grupoDungeonHéroes = []; monstruoActual = null; modoDungeonActivo = false; }, 4000);
});

function spawnearParticulas(x: number, y: number, color: string) {
  for (let i = 0; i < 10; i++) { particulas.push(new Particula(x, y, color)); }
}

// --- BUCLE PRINCIPAL DE FÍSICAS Y RENDERIZADO (GAMELOOP) ---
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  if (intensidadTemblor > 0) {
    ctx.translate((Math.random() - 0.5) * intensidadTemblor, (Math.random() - 0.5) * intensidadTemblor);
    intensidadTemblor *= 0.85; if (intensidadTemblor < 0.5) intensidadTemblor = 0;
  }

  // 🔮 DIBUJAR AFIJO ACTIVO EN LA PANTALLA
  const af = (window as any).afijoDiario;
  if (af) {
      ctx.fillStyle = '#f39c12'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(`🔮 Modificador de Arena: ${af.nombre}`, canvas.width / 2, canvas.height - 40);
      ctx.fillText(`🔮 Modificador de Arena: ${af.nombre}`, canvas.width / 2, canvas.height - 40);
  }

if (apuestasActivasFase) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;

    // Cartel principal Minimalista
    const titulo = `🪙 APUESTAS ABIERTAS: ${relojContadorPantalla}s 🪙`;
    ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    ctx.strokeText(titulo, canvas.width / 2, 30); ctx.fillText(titulo, canvas.width / 2, 30);

    // Bando Rojo (Esquina Izquierda)
    const nombresRojos = listaRojos.map(r => r.nombre).join(', ');
    ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left';
    const txtRojo = `🔴 ${nombresRojos} (!apostar rojo)`;
    ctx.strokeText(txtRojo, 20, 30); ctx.fillText(txtRojo, 20, 30);

    // Bando Azul (Esquina Derecha)
    const nombresAzules = listaAzules.map(b => b.nombre).join(', ');
    ctx.fillStyle = '#3498db'; ctx.textAlign = 'right';
    const txtAzul = `(!apostar azul) ${nombresAzules} 🔵`;
    ctx.strokeText(txtAzul, 1260, 30); ctx.fillText(txtAzul, 1260, 30);

    // 📊 TABLA DE APUESTAS MINIMALISTA (Flotando a los lados sin fondo)
    if (apuestasActuales.length > 0) {
      const apuestasRojas = apuestasActuales.filter(a => a.bando === 'rojo');
      const apuestasAzules = apuestasActuales.filter(a => a.bando === 'azul');
      const totalRojo = apuestasRojas.reduce((sum, a) => sum + a.cantidad, 0);
      const totalAzul = apuestasAzules.reduce((sum, a) => sum + a.cantidad, 0);

      // Rojo (Izquierda)
      ctx.textAlign = 'left'; ctx.fillStyle = '#ff7675'; ctx.font = 'bold 14px Arial';
      ctx.strokeText(`Fondo: ${totalRojo} 🪙`, 20, 55); ctx.fillText(`Fondo: ${totalRojo} 🪙`, 20, 55);
      ctx.font = '13px Arial';
      apuestasRojas.slice(-5).reverse().forEach((ap, idx) => {
        const txt = `@${ap.usuario} ➡️ ${ap.cantidad}`;
        ctx.strokeText(txt, 20, 75 + (idx * 18)); ctx.fillText(txt, 20, 75 + (idx * 18));
      });

      // Azul (Derecha)
      ctx.textAlign = 'right'; ctx.fillStyle = '#74b9ff'; ctx.font = 'bold 14px Arial';
      ctx.strokeText(`🪙 Fondo: ${totalAzul}`, 1260, 55); ctx.fillText(`🪙 Fondo: ${totalAzul}`, 1260, 55);
      ctx.font = '13px Arial';
      apuestasAzules.slice(-5).reverse().forEach((ap, idx) => {
        const txt = `${ap.cantidad} ⬅️ @${ap.usuario}`;
        ctx.strokeText(txt, 1260, 75 + (idx * 18)); ctx.fillText(txt, 1260, 75 + (idx * 18));
      });
    }

    [...listaRojos, ...listaAzules].forEach(l => { l.actualizar(); l.dibujar(ctx); });
  }

  else if (reclutamientoDungeon) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.fillStyle = '#9b59b6'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    const txt = `🏰 RECLUTANDO GRUPO (!entrar) — ${relojContadorPantalla}s ⏳`;
    ctx.strokeText(txt, canvas.width / 2, 30); ctx.fillText(txt, canvas.width / 2, 30);
    grupoDungeonHéroes.forEach(h => { h.actualizar(); h.dibujar(ctx); });
  }

  else if (modoDungeonActivo && monstruoActual) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    const txt = `🐲 FASE ${faseDungeonActual + 1} / 4 ⚔️`;
    ctx.strokeText(txt, canvas.width / 2, 30); ctx.fillText(txt, canvas.width / 2, 30);

    const heroesVivos = grupoDungeonHéroes.filter(h => h.vida > 0);
    if (heroesVivos.length === 0 && !finDungeonEnviado) {
      finDungeonEnviado = true;
      socket.emit('dungeon_terminada', { victoria: false, fasesSuperadas: faseDungeonActual, nivelMedioGrupo: nivelMedioDungeon });
    }

    grupoDungeonHéroes.forEach(h => {
      if (h.vida <= 0) return;
      h.direccionMira = h.x < monstruoActual!.x ? 'derecha' : 'izquierda';
      if (Math.random() < 0.015) h.saltar();
      const dist = Math.abs(h.x - monstruoActual!.x);

      if (dist > h.rangoAtaque) {
        if (h.x < monstruoActual!.x) h.x += h.velocidad; else h.x -= h.velocidad;
      }

      if (dist <= h.rangoAtaque && h.cooldownAtaque === 0) {
        h.atacar();
        let dmg = Math.floor(Math.random() * (h.danoMax - h.danoMin + 1)) + h.danoMin;
        if (h.tipo === 'cazador' && Math.random() < 0.20) dmg = Math.floor(dmg * 1.5);
        monstruoActual!.vida -= dmg;

        if (h.tipo === 'ninja') h.cooldownAtaque = 20;
        else if (h.tipo === 'guerrero') h.cooldownAtaque = 28;
        else if (h.tipo === 'cazador') h.cooldownAtaque = 20;
        else if (h.tipo === 'mago') {
          h.cooldownAtaque = 30;
          if (Math.random() < 0.20) monstruoActual!.congeladoTimer = 35;
        }
        else if (h.tipo === 'clerigo') {
          h.cooldownAtaque = 32; h.vida = Math.min(h.vidaMax, h.vida + 5);
          const aliadosVivos = heroesVivos.filter(a => a.nombre !== h.nombre);
          if (aliadosVivos.length > 0) aliadosVivos[Math.floor(Math.random() * aliadosVivos.length)].vida += 3;
        }

        intensidadTemblor = h.tipo === 'guerrero' ? 4 : 2;
        spawnearParticulas(monstruoActual!.x + monstruoActual!.ancho / 2, monstruoActual!.y + monstruoActual!.alto / 2, h.colorTematico);
      }
      h.actualizar(); h.dibujar(ctx);
    });

    if (monstruoActual.vida > 0) {
      if (monstruoActual.congeladoTimer > 0) monstruoActual.congeladoTimer--;
      if (monstruoActual.cooldownAtaque > 0) monstruoActual.cooldownAtaque--;

      if (monstruoActual.cooldownAtaque === 0 && heroesVivos.length > 0 && monstruoActual.congeladoTimer === 0) {
        const target = heroesVivos[Math.floor(Math.random() * heroesVivos.length)];
        monstruoActual.cooldownAtaque = faseDungeonActual === 3 ? 35 : 50;
        let dmgRecibido = Math.floor(Math.random() * (monstruoActual.danoMax - monstruoActual.danoMin + 1)) + monstruoActual.danoMin;

        if (target.tipo === 'ninja' && Math.random() < 0.20) dmgRecibido = 0;
        else if (target.tipo === 'guerrero' && Math.random() < 0.22) dmgRecibido = Math.floor(dmgRecibido * 0.5);

        target.vida -= dmgRecibido; target.vx = monstruoActual.x > target.x ? -8 : 8;
        intensidadTemblor = 6; spawnearParticulas(target.x + 22, target.y + 22, monstruoActual.color);
      }
      monstruoActual.actualizar();
      monstruoActual.dibujar(ctx);
    } else {
      spawnearParticulas(monstruoActual.x + monstruoActual.ancho / 2, monstruoActual.y + monstruoActual.alto / 2, '#fff');
      if (faseDungeonActual < 3) {
        faseDungeonActual++;
        monstruoActual = new Monstruo(850, 600, faseDungeonActual, nivelMedioDungeon);
      } else {
        if (!finDungeonEnviado) {
          finDungeonEnviado = true;
          socket.emit('dungeon_terminada', { victoria: true, fasesSuperadas: 4, nivelMedioGrupo: nivelMedioDungeon });
        }
      }
    }
  }

  else if (combateGrupalActivo) {
    const rojosVivos = listaRojos.filter(r => r.vida > 0);
    const azulesVivos = listaAzules.filter(b => b.vida > 0);

if ((rojosVivos.length === 0 || azulesVivos.length === 0) && !finDePeleaEnviado) {
      combateGrupalActivo = false; finDePeleaEnviado = true;
      const victoriaRojos = rojosVivos.length > 0;
      
      socket.emit('combate_finalizado_resultado', {
        nombresGanadores: victoriaRojos ? listaRojos.map(r => r.nombre) : listaAzules.map(b => b.nombre),
        nombresPerdedores: victoriaRojos ? listaAzules.map(b => b.nombre) : listaRojos.map(r => r.nombre)
      });

      // 🟢 NUEVO: Al cabo de 5 segundos de ver el cartel de victoria, reseteamos el Canvas a negro
      if (limpiezaTimer) clearTimeout(limpiezaTimer);
      limpiezaTimer = window.setTimeout(() => {
        listaRojos = [];
        listaAzules = [];
        finDePeleaEnviado = false; 
      }, 5000);
    }

    listaRojos.forEach(r => {
      if (r.vida <= 0 || azulesVivos.length === 0) { r.actualizar(); r.dibujar(ctx); return; }
      
      if (!r.objetivoActual || r.objetivoActual.vida <= 0) {
        r.objetivoActual = azulesVivos[Math.floor(Math.random() * azulesVivos.length)];
      }
      const objetivo = r.objetivoActual;

      r.direccionMira = r.x < objetivo.x ? 'derecha' : 'izquierda';
      if (Math.random() < 0.015 && r.congeladoTimer === 0) r.saltar();

      const dist = Math.abs(r.x - objetivo.x);
      if (dist > r.rangoAtaque && r.congeladoTimer === 0) r.x += r.x < objetivo.x ? r.velocidad : -r.velocidad;

      if (dist <= r.rangoAtaque && r.cooldownAtaque === 0 && r.congeladoTimer === 0) {
        r.atacar();
        let dmg = Math.floor(Math.random() * (r.danoMax - r.danoMin + 1)) + r.danoMin;
        if (r.tipo === 'cazador' && Math.random() < 0.20) dmg = Math.floor(dmg * 1.5);

        if (!(objetivo.tipo === 'ninja' && Math.random() < 0.20)) {
          if (objetivo.tipo === 'guerrero' && Math.random() < 0.22) dmg = Math.floor(dmg * 0.5);
          objetivo.vida -= dmg;
        }

        if (r.tipo === 'ninja') r.cooldownAtaque = 20;
        else if (r.tipo === 'guerrero') r.cooldownAtaque = 28;
        else if (r.tipo === 'mago') { r.cooldownAtaque = 30; if (Math.random() < 0.20) objetivo.congeladoTimer = 35; }
        else if (r.tipo === 'clerigo') { r.cooldownAtaque = 32; r.vida = Math.min(r.vidaMax, r.vida + 5); }
        else r.cooldownAtaque = 20;

        objetivo.vx = 8;
        spawnearParticulas(objetivo.x + 22, objetivo.y + 22, r.colorTematico);
      }
      r.actualizar(); r.dibujar(ctx);
    });

    listaAzules.forEach(b => {
      if (b.vida <= 0 || rojosVivos.length === 0) { b.actualizar(); b.dibujar(ctx); return; }
      
      if (!b.objetivoActual || b.objetivoActual.vida <= 0) {
        b.objetivoActual = rojosVivos[Math.floor(Math.random() * rojosVivos.length)];
      }
      const objetivo = b.objetivoActual;

      b.direccionMira = b.x < objetivo.x ? 'derecha' : 'izquierda';
      if (Math.random() < 0.015 && b.congeladoTimer === 0) b.saltar();

      const dist = Math.abs(b.x - objetivo.x);
      if (dist > b.rangoAtaque && b.congeladoTimer === 0) b.x += b.x < objetivo.x ? b.velocidad : -b.velocidad;

      if (dist <= b.rangoAtaque && b.cooldownAtaque === 0 && b.congeladoTimer === 0) {
        b.atacar();
        let dmg = Math.floor(Math.random() * (b.danoMax - b.danoMin + 1)) + b.danoMin;
        if (b.tipo === 'cazador' && Math.random() < 0.20) dmg = Math.floor(dmg * 1.5);

        if (!(objetivo.tipo === 'ninja' && Math.random() < 0.20)) {
          if (objetivo.tipo === 'guerrero' && Math.random() < 0.22) dmg = Math.floor(dmg * 0.5);
          objetivo.vida -= dmg;
        }

        if (b.tipo === 'ninja') b.cooldownAtaque = 20;
        else if (b.tipo === 'guerrero') b.cooldownAtaque = 28;
        else if (b.tipo === 'mago') { b.cooldownAtaque = 30; if (Math.random() < 0.20) objetivo.congeladoTimer = 35; }
        else if (b.tipo === 'clerigo') { b.cooldownAtaque = 32; b.vida = Math.min(b.vidaMax, b.vida + 5); }
        else b.cooldownAtaque = 20;

        objetivo.vx = -8;
        spawnearParticulas(objetivo.x + 22, objetivo.y + 22, b.colorTematico);
      }
      b.actualizar(); b.dibujar(ctx);
    });
  }

  // 🟢 CONDICIÓN BLINDADA: Solo pinta el letrero si NO estás en una mazmorra activa y el combate de la arena terminó de verdad
else if (!modoDungeonActivo && !reclutamientoDungeon && listaRojos.length > 0 && listaAzules.length > 0 && finDePeleaEnviado) {
    [...listaRojos, ...listaAzules].forEach(l => { l.actualizar(); l.dibujar(ctx); });
    
    const vivosRojos = listaRojos.filter(r => r.vida > 0);
    const victoriaRojos = vivosRojos.length > 0;
    const ganadores = victoriaRojos ? listaRojos.map(r => r.nombre).join(', ') : listaAzules.map(b => b.nombre).join(', ');

    ctx.fillStyle = victoriaRojos ? '#e74c3c' : '#3498db';
    ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    const txt = `🏆 VICTORIA: ${ganadores} 🏆`;
    ctx.strokeText(txt, canvas.width / 2, 200); ctx.fillText(txt, canvas.width / 2, 200);
  }

  // ⏳ COLA DE ESPERA (Minimalista en la parte inferior)
  if (colaEspera.length > 0) {
    const max = 3; // Límite de actividades a mostrar
    const mostrados = colaEspera.slice(0, max).join(' ⚔️ ');
    const extra = colaEspera.length > max ? ` ... (+${colaEspera.length - max} en espera)` : '';
    const textoCola = `⏳ Próximos en la Arena: ${mostrados}${extra}`;
    
    ctx.textAlign = 'center'; ctx.fillStyle = '#bdc3c7'; ctx.font = 'bold 14px Arial'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(textoCola, canvas.width / 2, canvas.height - 15); ctx.fillText(textoCola, canvas.width / 2, canvas.height - 15);
  }

  particulas = particulas.filter(p => p.vida > 0);
  particulas.forEach(p => { p.actualizar(); p.dibujar(ctx); });
  ctx.restore();
  requestAnimationFrame(gameLoop);
}

gameLoop();
