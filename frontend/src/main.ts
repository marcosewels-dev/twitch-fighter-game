import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling']
}); 

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

type TipoLuchador = 'guerrero' | 'ninja' | 'mago' | 'clerigo' | 'cazador';

// --- Partículas de Impacto ---
class Particula {
  x: number; y: number; vx: number; vy: number;
  color: string; vida = 20;

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 6;
    this.vy = (Math.random() - 0.5) * 6 - 2;
    this.color = color;
  }

  actualizar() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.25;
    this.vida--;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, 3, 3);
  }
}

// --- Clase Luchador ---
class Luchador {
  x: number;
  y: number;
  ancho = 45; 
  alto = 45;
  nombre: string;
  tipo: TipoLuchador;
  nivel: number; 
  
  vidaMax: number;
  vida: number;
  velocidad: number;
  rangoAtaque: number;
  danoMin: number;
  danoMax: number;

  vx = 0; vy = 0;
  enSuelo = false;
  gravedad = 0.6;
  friccion = 0.85;
  cooldownAtaque = 0;

  emoji: string;
  armaEmoji: string;
  colorTematico: string;
  direccionMira: 'derecha' | 'izquierda' = 'derecha';
  anguloArma = 0;

  constructor(x: number, y: number, nombre: string, tipo: TipoLuchador, nivel: number) {
    this.x = x;
    this.y = y;
    this.nombre = nombre;
    this.tipo = tipo;
    this.nivel = nivel;

    if (tipo === 'guerrero') {
      this.emoji = '🛡️';
      this.armaEmoji = '🪓';
      this.colorTematico = '#e74c3c';
      this.vidaMax = 150;      
      this.velocidad = 2.8;    
      this.rangoAtaque = 70;
      this.danoMin = 12;       
      this.danoMax = 16;
    } else if (tipo === 'ninja') {
      this.emoji = '🥷';
      this.armaEmoji = '🗡️';
      this.colorTematico = '#2ecc71';
      this.vidaMax = 105;      
      this.velocidad = 5.5;    
      this.rangoAtaque = 55;
      this.danoMin = 8;        
      this.danoMax = 12;
    } else if (tipo === 'mago') {
      this.emoji = '🧙';
      this.armaEmoji = '⚡';
      this.colorTematico = '#9b59b6';
      this.vidaMax = 110;      
      this.velocidad = 3.2;
      this.rangoAtaque = 180;  
      this.danoMin = 9;
      this.danoMax = 18;       
    } else if (tipo === 'clerigo') {
      this.emoji = '⛪';
      this.armaEmoji = '🔨';
      this.colorTematico = '#f1c40f';
      this.vidaMax = 140;
      this.velocidad = 2.3;    
      this.rangoAtaque = 65;
      this.danoMin = 8;
      this.danoMax = 14;
    } else if (tipo === 'cazador') { 
      this.emoji = '🏹';
      this.armaEmoji = '🏹';
      this.colorTematico = '#27ae60';
      this.vidaMax = 110;
      this.velocidad = 3.8;
      this.rangoAtaque = 210; 
      this.danoMin = 8;        
      this.danoMax = 12;
    } else {
      this.emoji = '⚔️';
      this.armaEmoji = '🗡️';
      this.colorTematico = '#95a5a6';
      this.vidaMax = 100;
      this.velocidad = 3.0;
      this.rangoAtaque = 60;
      this.danoMin = 8;
      this.danoMax = 12;
    }

    const nivelesExtra = Math.max(0, this.nivel - 1);
    this.vidaMax = Math.floor(this.vidaMax * (1 + nivelesExtra * 0.01));
    this.danoMin = Math.floor(this.danoMin * (1 + nivelesExtra * 0.007));
    this.danoMax = Math.floor(this.danoMax * (1 + nivelesExtra * 0.007));

    this.vida = this.vidaMax;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    if (this.vida <= 0) return; // No dibujar héroes caídos
    ctx.save();
    
    const centroX = this.x + this.ancho / 2;
    const centroY = this.y + this.alto / 2;
    ctx.translate(centroX, centroY);

    if (this.direccionMira === 'izquierda') {
      ctx.scale(-1, 1);
    }

    ctx.shadowBlur = 12;
    ctx.shadowColor = this.colorTematico;
    ctx.font = '40px Arial'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, 0, 0);
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.translate(20, 5); 
    ctx.rotate(this.anguloArma);
    ctx.font = '28px Arial';
    ctx.fillText(this.armaEmoji, 0, 0);
    ctx.restore();

    ctx.restore();

    const etiquetaNombre = `${this.nombre} (Nv.${this.nivel})`;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(etiquetaNombre, centroX, this.y - 25);
    ctx.fillText(etiquetaNombre, centroX, this.y - 25);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(centroX - 30, this.y - 15, 60, 6);
    ctx.fillStyle = this.colorTematico;
    ctx.fillRect(centroX - 30, this.y - 15, 60 * (this.vida / this.vidaMax), 6);
  }

  actualizar() {
    if (this.vida <= 0) return;
    if (this.cooldownAtaque > 0) this.cooldownAtaque--;

    this.vy += this.gravedad;
    this.y += this.vy;

    const sueloY = 600; 
    if (this.y >= sueloY) {
      this.y = sueloY;
      this.vy = 0;
      this.enSuelo = true;
    }

    this.x += this.vx;
    this.vx *= this.friccion;

    if (this.x < 50) this.x = 50;
    if (this.x > 1180) this.x = 1180;

    this.anguloArma *= 0.8;
  }

  atacar() {
    this.anguloArma = -Math.PI / 2.5;
  }

  saltar() {
    if (this.enSuelo && this.vida > 0) {
      this.vy = -11;
      this.enSuelo = false;
    }
  }
}

// 🟢 CLASE NUEVA: Enemigos de la Mazmorra
class Monstruo {
  x: number; y: number; ancho = 80; alto = 80;
  nombre: string; emoji: string; color: string;
  vidaMax: number; vida: number;
  danoMin: number; danoMax: number;
  cooldownAtaque = 0;

  constructor(x: number, y: number, fase: number, nivelMedio: number) {
    this.x = x;
    this.y = y;

    // Ajuste express a 3 fases escalando según el nivel medio del grupo
    if (fase === 0) {
      this.nombre = "👻 Esbirro Espectral";
      this.emoji = "👻";
      this.color = "#7f8c8d";
      this.vidaMax = Math.floor(180 * (1 + nivelMedio * 0.04));
      this.danoMin = 4; this.danoMax = 8;
    } else if (fase === 1) {
      this.nombre = "👹 Miniboss Ogro";
      this.emoji = "👹";
      this.color = "#d35400";
      this.ancho = 100; this.alto = 100;
      this.vidaMax = Math.floor(350 * (1 + nivelMedio * 0.05));
      this.danoMin = 8; this.danoMax = 14;
    } else {
      this.nombre = "🐉 JEFE SUPREMO DRAGÓN";
      this.emoji = "🐉";
      this.color = "#c0392b";
      this.ancho = 140; this.alto = 140;
      this.vidaMax = Math.floor(700 * (1 + nivelMedio * 0.06));
      this.danoMin = 12; this.danoMax = 22;
    }
    this.vida = this.vidaMax;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    if (this.vida <= 0) return;
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.color;
    ctx.font = `${this.ancho - 10}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, this.x + this.ancho / 2, this.y + this.alto / 2);
    ctx.restore();

    // Barra de salud gigante para el Boss
    const centroX = this.x + this.ancho / 2;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(this.nombre, centroX, this.y - 20);
    ctx.fillText(this.nombre, centroX, this.y - 20);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(centroX - 60, this.y - 10, 120, 8);
    ctx.fillStyle = this.color;
    ctx.fillRect(centroX - 60, this.y - 10, 120 * (this.vida / this.vidaMax), 8);
  }
}

// --- Estado Global ---
let p1: Luchador | null = null;
let p2: Luchador | null = null;
let peleaActiva = false;
let finDePeleaEnviado = false;
let particulas: Particula[] = [];
let intensidadTemblor = 0;
let limpiezaTimer: number | null = null;

// 🟢 Variables de estado globales para las Dungeons
let modoDungeonActivo = false;
let reclutamientoDungeon = false;
let tiempoReclutamientoRestante = 0;
let grupoDungeonHéroes: Luchador[] = [];
let monstruoActual: Monstruo | null = null;
let faseDungeonActual = 0; 
let nivelMedioDungeon = 1;
let finDungeonEnviado = false;

// --- Recepción de Eventos de Servidor (1v1) ---
socket.on('iniciar_pelea', (datos: { p1: string; claseP1: TipoLuchador; nivelP1: number; p2: string; claseP2: TipoLuchador; nivelP2: number }) => {
  if (limpiezaTimer) {
    clearTimeout(limpiezaTimer);
    limpiezaTimer = null;
  }
  modoDungeonActivo = false;
  reclutamientoDungeon = false;
  
  p1 = new Luchador(150, 600, datos.p1, datos.claseP1, datos.nivelP1);
  p2 = new Luchador(1080, 600, datos.p2, datos.claseP2, datos.nivelP2);
  peleaActiva = true;
  finDePeleaEnviado = false;
  particulas = [];
});

socket.on('pelea_terminada_confirmada', () => {
  limpiezaTimer = setTimeout(() => {
    p1 = null; p2 = null;
    limpiezaTimer = null;
  }, 5000);
});

// --- 🟢 RECEPCIÓN DE EVENTOS NUEVOS: MAZMORRAS COOPERATIVAS ---
socket.on('dungeon_reclutamiento_abierto', (datos: { tiempo: number }) => {
  p1 = null; p2 = null; peleaActiva = false;
  reclutamientoDungeon = true;
  modoDungeonActivo = false;
  tiempoReclutamientoRestante = datos.tiempo;
  grupoDungeonHéroes = [];
});

socket.on('dungeon_actualizar_grupo', (lista: { nombre: string; clase: TipoLuchador; nivel: number }[]) => {
  // Posicionamos escalonadamente a los miembros en el flanco izquierdo
  grupoDungeonHéroes = lista.map((h, i) => new Luchador(80 + i * 65, 600, h.nombre, h.clase, h.nivel));
});

socket.on('dungeon_iniciar', (datos: { jugadores: any[]; nivelMedio: number }) => {
  reclutamientoDungeon = false;
  modoDungeonActivo = true;
  faseDungeonActual = 0;
  finDungeonEnviado = false;
  nivelMedioDungeon = datos.nivelMedio;
  
  // Re-instanciar héroes listos para cargar hacia el centro
  grupoDungeonHéroes = datos.jugadores.map((h, i) => new Luchador(100 + i * 65, 600, h.nombre, h.clase, h.nivel));
  // Instanciar primer esbirro express en el centro derecho
  monstruoActual = new Monstruo(850, 540, 0, nivelMedioDungeon);
});

socket.on('dungeon_limpiar_interfaz', () => {
  limpiezaTimer = setTimeout(() => {
    grupoDungeonHéroes = [];
    monstruoActual = null;
    modoDungeonActivo = false;
  }, 5000);
});

function spawnearParticulas(x: number, y: number, color: string) {
  for (let i = 0; i < 10; i++) {
    particulas.push(new Particula(x, y, color));
  }
}

function calcularDanoEfectivo(atacante: Luchador, defensor: Luchador): { dano: number; textoEspecial: string } {
  let danoBase = Math.floor(Math.random() * (atacante.danoMax - atacante.danoMin + 1)) + atacante.danoMin;
  let textoEspecial = "";

  if (atacante.tipo === 'cazador' && Math.random() < 0.20) {
    danoBase = Math.floor(danoBase * 1.5);
    textoEspecial = "🎯 ¡CRÍTICO!";
  }
  if (defensor.tipo === 'ninja' && Math.random() < 0.20) {
    return { dano: 0, textoEspecial: "💨 ¡ESQUIVADO!" };
  }
  if (defensor.tipo === 'guerrero' && Math.random() < 0.15) {
    danoBase = Math.floor(danoBase * 0.5);
    textoEspecial = "🛡️ ¡BLOQUEADO!";
  }
  return { dano: danoBase, textoEspecial };
}

// --- Game Loop ---
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  
  if (intensidadTemblor > 0) {
    const dx = (Math.random() - 0.5) * intensidadTemblor;
    const dy = (Math.random() - 0.5) * intensidadTemblor;
    ctx.translate(dx, dy);
    intensidadTemblor *= 0.85;
    if (intensidadTemblor < 0.5) intensidadTemblor = 0;
  }

  // LÓGICA 1: Modo Reclutamiento de Incursiones
  if (reclutamientoDungeon) {
    ctx.fillStyle = 'rgba(145, 70, 255, 0.15)';
    ctx.fillRect(100, 40, 1080, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`🏰 FORMANDO GRUPO DE INMOLACIÓN (Falta !entrar en el chat) ⏳`, canvas.width / 2, 75);

    // Pintar avatares en la antesala de espera
    grupoDungeonHéroes.forEach(h => {
      h.actualizar();
      h.dibujar(ctx);
    });
  }

  // LÓGICA 2: Modo Incursión de Mazmorra Activo (3 Fases)
  else if (modoDungeonActivo && monstruoActual) {
    // Info superior de la expedición
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 26px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`🐲 INCURSIÓN EXPRESS: FASE ${faseDungeonActual + 1} / 3 ⚔️`, canvas.width / 2
