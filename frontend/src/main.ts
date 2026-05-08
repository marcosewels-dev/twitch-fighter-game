import { io } from 'socket.io-client';

// Cambia esto a tu URL de Render cuando vayas a desplegarlo en producción
const socket = io('http://localhost:3000'); 

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const btnTest = document.getElementById('btn-test') as HTMLButtonElement; // Reactivado para desarrollo

type TipoLuchador = 'guerrero' | 'ninja' | 'mago';

// --- Clase Partícula ---
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

// --- Clase del Luchador Compacto ---
class Luchador {
  x: number;
  y: number;
  ancho = 45; 
  alto = 45;
  nombre: string;
  tipo: TipoLuchador;
  
  // Stats
  vidaMax: number;
  vida: number;
  velocidad: number;
  rangoAtaque: number;
  danoMin: number;
  danoMax: number;

  // Físicas
  vx = 0; vy = 0;
  enSuelo = false;
  gravedad = 0.6;
  friccion = 0.85;
  cooldownAtaque = 0;

  // Render & Animaciones
  emoji: string;
  armaEmoji: string;
  colorTematico: string;
  direccionMira: 'derecha' | 'izquierda' = 'derecha';
  anguloArma = 0;

  constructor(x: number, y: number, nombre: string, tipo: TipoLuchador) {
    this.x = x;
    this.y = y;
    this.nombre = nombre;
    this.tipo = tipo;

    if (tipo === 'guerrero') {
      this.emoji = '🛡️';
      this.armaEmoji = '🪓';
      this.colorTematico = '#e74c3c';
      this.vidaMax = 145;
      this.velocidad = 2.4;
      this.rangoAtaque = 70;
      this.danoMin = 7;
      this.danoMax = 15;
    } else if (tipo === 'ninja') {
      this.emoji = '🥷';
      this.armaEmoji = '🗡️';
      this.colorTematico = '#2ecc71';
      this.vidaMax = 85;
      this.velocidad = 5.2;
      this.rangoAtaque = 55;
      this.danoMin = 5;
      this.danoMax = 11;
    } else { // mago
      this.emoji = '🧙';
      this.armaEmoji = '⚡';
      this.colorTematico = '#9b59b6';
      this.vidaMax = 95;
      this.velocidad = 3.2;
      this.rangoAtaque = 200;
      this.danoMin = 9;
      this.danoMax = 19;
    }

    this.vida = this.vidaMax;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
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

    // Texto con contorno negro
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(this.nombre, centroX, this.y - 25);
    ctx.fillText(this.nombre, centroX, this.y - 25);

    // Barra de Vida
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(centroX - 30, this.y - 15, 60, 6);
    ctx.fillStyle = this.colorTematico;
    ctx.fillRect(centroX - 30, this.y - 15, 60 * (this.vida / this.vidaMax), 6);
  }

  actualizar() {
    if (this.cooldownAtaque > 0) this.cooldownAtaque--;

    this.vy += this.gravedad;
    this.y += this.vy;

    // Suelo de la arena compacto (abajo en la pantalla)
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
    if (this.enSuelo) {
      this.vy = -11;
      this.enSuelo = false;
    }
  }
}

// --- Estado Global ---
let p1: Luchador | null = null;
let p2: Luchador | null = null;
let peleaActiva = false;
let finDePeleaEnviado = false;
let particulas: Particula[] = [];
let intensidadTemblor = 0;

// --- Sockets ---
socket.on('iniciar_pelea', (datos: { p1: string; claseP1: TipoLuchador; p2: string; claseP2: TipoLuchador }) => {
  p1 = new Luchador(150, 600, datos.p1, datos.claseP1);
  p2 = new Luchador(1080, 600, datos.p2, datos.claseP2);
  peleaActiva = true;
  finDePeleaEnviado = false;
  particulas = [];
});

function spawnearParticulas(x: number, y: number, color: string) {
  for (let i = 0; i < 10; i++) {
    particulas.push(new Particula(x, y, color));
  }
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

  if (peleaActiva && p1 && p2) {
    p1.direccionMira = p1.x < p2.x ? 'derecha' : 'izquierda';
    p2.direccionMira = p2.x < p1.x ? 'derecha' : 'izquierda';

    if (Math.random() < 0.015) p1.saltar();
    if (Math.random() < 0.015) p2.saltar();

    const distancia = Math.abs(p1.x - p2.x);

    if (distancia > p1.rangoAtaque) {
      if (p1.x < p2.x) p1.x += p1.velocidad;
      else p1.x -= p1.velocidad;
    }

    if (distancia > p2.rangoAtaque) {
      if (p2.x > p1.x) p2.x -= p2.velocidad;
      else p2.x += p2.velocidad;
    }

    // Ataques
    if (distancia <= p1.rangoAtaque && p1.cooldownAtaque === 0) {
      p1.atacar();
      const dano = Math.floor(Math.random() * (p1.danoMax - p1.danoMin + 1)) + p1.danoMin;
      p2.vida -= dano;
      p1.cooldownAtaque = p1.tipo === 'ninja' ? 18 : 35;
      
      p2.vx = p1.tipo === 'mago' ? 6 : 12;
      intensidadTemblor = p1.tipo === 'guerrero' ? 6 : 3;
      spawnearParticulas(p2.x + 22, p2.y + 22, p1.colorTematico);
    }

    if (distancia <= p2.rangoAtaque && p2.cooldownAtaque === 0) {
      p2.atacar();
      const dano = Math.floor(Math.random() * (p2.danoMax - p2.danoMin + 1)) + p2.danoMin;
      p1.vida -= dano;
      p2.cooldownAtaque = p2.tipo === 'ninja' ? 18 : 35;
      
      p1.vx = p2.tipo === 'mago' ? -6 : -12;
      intensidadTemblor = p2.tipo === 'guerrero' ? 6 : 3;
      spawnearParticulas(p1.x + 22, p1.y + 22, p2.colorTematico);
    }

    p1.vida = Math.max(0, p1.vida);
    p2.vida = Math.max(0, p2.vida);

    p1.actualizar();
    p2.actualizar();

    p1.dibujar(ctx);
    p2.dibujar(ctx);

    if (p1.vida <= 0 || p2.vida <= 0) {
      peleaActiva = false;
      const ganador = p1.vida > 0 ? p1.nombre : p2.nombre;
      intensidadTemblor = 12;
      
      if (!finDePeleaEnviado) {
        finDePeleaEnviado = true;
        socket.emit('pelea_terminada', { ganador });
      }
    }
  } else if (p1 && p2) {
    p1.actualizar();
    p2.actualizar();
    p1.dibujar(ctx);
    p2.dibujar(ctx);

    const ganador = p1.vida > 0 ? p1.nombre : p2.nombre;
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.strokeText(`¡GANADOR: ${ganador}!`, canvas.width / 2, 400);
    ctx.fillText(`¡GANADOR: ${ganador}!`, canvas.width / 2, 400);
  } else {
    // Texto explicativo sutil para desarrollo
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Esperando pelea... Pulsa "Simular Pelea" arriba a la derecha', canvas.width / 2, 500);
  }

  particulas = particulas.filter(p => p.vida > 0);
  particulas.forEach(p => {
    p.actualizar();
    p.dibujar(ctx);
  });

  ctx.restore();
  requestAnimationFrame(gameLoop);
}

// --- Botón de simulación reactivado para pruebas locales ---
if (btnTest) {
  btnTest.addEventListener('click', () => {
    const nombresFicticios = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Zeta', 'Omega'];
    const clasesDisponibles = ['guerrero', 'ninja', 'mago'];
    
    const p1Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    let p2Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    while (p1Ficticio === p2Ficticio) {
      p2Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    }

    const c1Ficticia = clasesDisponibles[Math.floor(Math.random() * clasesDisponibles.length)] as TipoLuchador;
    const c2Ficticia = clasesDisponibles[Math.floor(Math.random() * clasesDisponibles.length)] as TipoLuchador;

    // Lanzamos el inicio directamente al frontend
    p1 = new Luchador(150, 600, p1Ficticio, c1Ficticia);
    p2 = new Luchador(1080, 600, p2Ficticio, c2Ficticia);
    peleaActiva = true;
    finDePeleaEnviado = false;
    particulas = [];
  });
}

gameLoop();
