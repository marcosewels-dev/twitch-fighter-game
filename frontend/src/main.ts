import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling']
}); 

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

type TipoLuchador = 'guerrero' | 'ninja' | 'mago' | 'clerigo' | 'cazador';

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
    if (this.enSuelo) {
      this.vy = -11;
      this.enSuelo = false;
    }
  }
}

let p1: Luchador | null = null;
let p2: Luchador | null = null;
let peleaActiva = false;
let finDePeleaEnviado = false;
let particulas: Particula[] = [];
let intensidadTemblor = 0;
let limpiezaTimer: number | null = null;

socket.on('iniciar_pelea', (datos: { p1: string; claseP1: TipoLuchador; nivelP1: number; p2: string; claseP2: TipoLuchador; nivelP2: number }) => {
  if (limpiezaTimer) {
    clearTimeout(limpiezaTimer);
    limpiezaTimer = null;
  }
  
  p1 = null;
  p2 = null;
  
  p1 = new Luchador(150, 600, datos.p1, datos.claseP1, datos.nivelP1);
  p2 = new Luchador(1080, 600, datos.p2, datos.claseP2, datos.nivelP2);
  peleaActiva = true;
  finDePeleaEnviado = false;
  particulas = [];
});

socket.on('pelea_terminada_confirmada', () => {
  limpiezaTimer = setTimeout(() => {
    p1 = null;
    p2 = null;
    limpiezaTimer = null;
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

    if (distancia <= p1.rangoAtaque && p1.cooldownAtaque === 0) {
      p1.atacar();
      const resultado = calcularDanoEfectivo(p1, p2);
      p2.vida -= resultado.dano;
      
      if (p1.tipo === 'ninja') p1.cooldownAtaque = 12;       
      else if (p1.tipo === 'guerrero') p1.cooldownAtaque = 32; 
      else if (p1.tipo === 'cazador') p1.cooldownAtaque = 20;   
      else if (p1.tipo === 'clerigo') {
        p1.cooldownAtaque = 38;
        const esCriticoSalud = p1.vida < (p1.vidaMax * 0.3);
        p1.vida = Math.min(p1.vidaMax, p1.vida + (esCriticoSalud ? 10 : 5));
      } else p1.cooldownAtaque = 38;                            
      
      p2.vx = p1.tipo === 'mago' || p1.tipo === 'cazador' ? 6 : 12;
      intensidadTemblor = p1.tipo === 'guerrero' || p1.tipo === 'clerigo' ? 6 : 3;
      spawnearParticulas(p2.x + 22, p2.y + 22, p1.colorTematico);
    }

    if (distancia <= p2.rangoAtaque && p2.cooldownAtaque === 0) {
      p2.atacar();
      const resultado = calcularDanoEfectivo(p2, p1);
      p1.vida -= resultado.dano;
      
      if (p2.tipo === 'ninja') p2.cooldownAtaque = 12;
      else if (p2.tipo === 'guerrero') p2.cooldownAtaque = 32;
      else if (p2.tipo === 'cazador') p2.cooldownAtaque = 20;
      else if (p2.tipo === 'clerigo') {
        p2.cooldownAtaque = 38;
        const esCriticoSalud = p2.vida < (p2.vidaMax * 0.3);
        p2.vida = Math.min(p2.vidaMax, p2.vida + (esCriticoSalud ? 10 : 5));
      } else p2.cooldownAtaque = 38;
      
      p1.vx = p2.tipo === 'mago' || p2.tipo === 'cazador' ? -6 : -12;
      intensidadTemblor = p2.tipo === 'guerrero' || p2.tipo === 'clerigo' ? 6 : 3;
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
  }

  particulas = particulas.filter(p => p.vida > 0);
  particulas.forEach(p => {
    p.actualizar();
    p.dibujar(ctx);
  });

  ctx.restore();
  requestAnimationFrame(gameLoop);
}

gameLoop();
