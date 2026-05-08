import { io } from 'socket.io-client';

// En desarrollo usas 'http://localhost:3000'. En producción pon la URL de tu servidor en la nube.
// const socket = io('http://localhost:3000');
const socket = io('https://twitch-fighter-backend.onrender.com');


const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const listaColaEl = document.getElementById('lista-cola')!;
//const btnTest = document.getElementById('btn-test') as HTMLButtonElement;

type TipoLuchador = 'guerrero' | 'ninja' | 'mago';

// --- Clase Partícula (Efectos de impactos/chispas) ---
class Particula {
  x: number; y: number; vx: number; vy: number;
  color: string; vida = 25;

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = (Math.random() - 0.5) * 8 - 2;
    this.color = color;
  }

  actualizar() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.25; // Gravedad de la partícula
    this.vida--;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, 4, 4);
  }
}

// --- Clase del Luchador (Emoji + Armas + Físicas) ---
class Luchador {
  x: number;
  y: number;
  ancho = 60;
  alto = 60;
  nombre: string;
  tipo: TipoLuchador;
  
  // Estadísticas según Clase
  vidaMax: number;
  vida: number;
  velocidad: number;
  rangoAtaque: number;
  danoMin: number;
  danoMax: number;

  // Físicas de combate
  vx = 0; vy = 0;
  enSuelo = false;
  gravedad = 0.6;
  friccion = 0.85;
  cooldownAtaque = 0;

  // Render & Orientación
  emoji: string;
  armaEmoji: string;
  colorTematico: string;
  direccionMira: 'derecha' | 'izquierda' = 'derecha';
  anguloArma = 0; // Se inclina al dar un tajo

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
      this.rangoAtaque = 80;
      this.danoMin = 7;
      this.danoMax = 15;
    } else if (tipo === 'ninja') {
      this.emoji = '🥷';
      this.armaEmoji = '🗡️';
      this.colorTematico = '#2ecc71';
      this.vidaMax = 85;
      this.velocidad = 5.2;
      this.rangoAtaque = 65;
      this.danoMin = 5;
      this.danoMax = 11;
    } else { // mago
      this.emoji = '🧙';
      this.armaEmoji = '⚡';
      this.colorTematico = '#9b59b6';
      this.vidaMax = 95;
      this.velocidad = 3.2;
      this.rangoAtaque = 240;
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

    // Espejar el render si el oponente está al otro lado
    if (this.direccionMira === 'izquierda') {
      ctx.scale(-1, 1);
    }

    // Aura resplandeciente de Clase
    ctx.shadowBlur = 20;
    ctx.shadowColor = this.colorTematico;

    // Dibujar avatar (Emoji)
    ctx.font = '50px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, 0, 0);

    ctx.shadowBlur = 0; // Desactivar sombra para el arma

    // Dibujar el Arma y aplicar rotación de ataque
    ctx.save();
    ctx.translate(25, 5); 
    ctx.rotate(this.anguloArma);
    ctx.font = '35px Arial';
    ctx.fillText(this.armaEmoji, 0, 0);
    ctx.restore();

    ctx.restore();

    // Nombre (Estático para evitar que se lea al revés si se espeja el personaje)
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.nombre, centroX, this.y - 30);

    // Barra de Vida
    ctx.fillStyle = '#222';
    ctx.fillRect(centroX - 40, this.y - 18, 80, 8);
    ctx.fillStyle = this.colorTematico;
    ctx.fillRect(centroX - 40, this.y - 18, 80 * (this.vida / this.vidaMax), 8);
  }

  actualizar() {
    if (this.cooldownAtaque > 0) this.cooldownAtaque--;

    // Gravedad
    this.vy += this.gravedad;
    this.y += this.vy;

    const sueloY = 450;
    if (this.y >= sueloY) {
      this.y = sueloY;
      this.vy = 0;
      this.enSuelo = true;
    }

    // Fricción horizontal para frenar retrocesos
    this.x += this.vx;
    this.vx *= this.friccion;

    // Límites de la arena
    if (this.x < 50) this.x = 50;
    if (this.x > 1180) this.x = 1180;

    // El arma vuelve lentamente a su posición de descanso
    this.anguloArma *= 0.8;
  }

  atacar() {
    this.anguloArma = -Math.PI / 2.5; // Genera el movimiento de tajo/disparo
  }

  saltar() {
    if (this.enSuelo) {
      this.vy = -12;
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
socket.on('actualizar_cola', (cola: string[]) => {
  listaColaEl.innerText = cola.length > 0 ? cola.join(', ') : 'Vacía';
});

socket.on('iniciar_pelea', (datos: { p1: string; claseP1: TipoLuchador; p2: string; claseP2: TipoLuchador }) => {
  p1 = new Luchador(200, 450, datos.p1, datos.claseP1);
  p2 = new Luchador(1000, 450, datos.p2, datos.claseP2);
  peleaActiva = true;
  finDePeleaEnviado = false;
  particulas = [];
});

function spawnearParticulas(x: number, y: number, color: string) {
  for (let i = 0; i < 15; i++) {
    particulas.push(new Particula(x, y, color));
  }
}

// --- Game Loop (Bucle Principal de Animación) ---
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Sacudida de pantalla (Screen Shake) si hay impacto
  if (intensidadTemblor > 0) {
    const dx = (Math.random() - 0.5) * intensidadTemblor;
    const dy = (Math.random() - 0.5) * intensidadTemblor;
    ctx.translate(dx, dy);
    intensidadTemblor *= 0.9;
    if (intensidadTemblor < 0.5) intensidadTemblor = 0;
  }

  if (peleaActiva && p1 && p2) {
    // 1. Orientación de miradas hacia el rival
    p1.direccionMira = p1.x < p2.x ? 'derecha' : 'izquierda';
    p2.direccionMira = p2.x < p1.x ? 'derecha' : 'izquierda';

    // 2. Comportamiento de saltos aleatorios
    if (Math.random() < 0.015) p1.saltar();
    if (Math.random() < 0.015) p2.saltar();

    const distancia = Math.abs(p1.x - p2.x);

    // 3. Movimiento inteligente de aproximación según el rango de clase
    if (distancia > p1.rangoAtaque) {
      if (p1.x < p2.x) p1.x += p1.velocidad;
      else p1.x -= p1.velocidad;
    }

    if (distancia > p2.rangoAtaque) {
      if (p2.x > p1.x) p2.x -= p2.velocidad;
      else p2.x += p2.velocidad;
    }

    // 4. Procesamiento de Ataques
    // Ataque P1 -> P2
    if (distancia <= p1.rangoAtaque && p1.cooldownAtaque === 0) {
      p1.atacar();
      const dano = Math.floor(Math.random() * (p1.danoMax - p1.danoMin + 1)) + p1.danoMin;
      p2.vida -= dano;
      p1.cooldownAtaque = p1.tipo === 'ninja' ? 18 : 35; // Ninjas atacan más rápido
      
      p2.vx = p1.tipo === 'mago' ? 8 : 16; // Empuje físico
      intensidadTemblor = p1.tipo === 'guerrero' ? 8 : 4; // Guerreros sacuden más la pantalla
      spawnearParticulas(p2.x + 30, p2.y + 30, p1.colorTematico);
    }

    // Ataque P2 -> P1
    if (distancia <= p2.rangoAtaque && p2.cooldownAtaque === 0) {
      p2.atacar();
      const dano = Math.floor(Math.random() * (p2.danoMax - p2.danoMin + 1)) + p2.danoMin;
      p1.vida -= dano;
      p2.cooldownAtaque = p2.tipo === 'ninja' ? 18 : 35;
      
      p1.vx = p2.tipo === 'mago' ? -8 : -16;
      intensidadTemblor = p2.tipo === 'guerrero' ? 8 : 4;
      spawnearParticulas(p1.x + 30, p1.y + 30, p2.colorTematico);
    }

    p1.vida = Math.max(0, p1.vida);
    p2.vida = Math.max(0, p2.vida);

    p1.actualizar();
    p2.actualizar();

    p1.dibujar(ctx);
    p2.dibujar(ctx);

    // Comprobar K.O.
    if (p1.vida <= 0 || p2.vida <= 0) {
      peleaActiva = false;
      const ganador = p1.vida > 0 ? p1.nombre : p2.nombre;
      intensidadTemblor = 20; // Sacudida final violenta
      
      if (!finDePeleaEnviado) {
        finDePeleaEnviado = true;
        socket.emit('pelea_terminada', { ganador });
      }
    }
  } else if (p1 && p2) {
    // Escena de Post-combate (Pantalla de ganador)
    p1.actualizar();
    p2.actualizar();
    p1.dibujar(ctx);
    p2.dibujar(ctx);

    const ganador = p1.vida > 0 ? p1.nombre : p2.nombre;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`¡GANADOR: ${ganador}!`, canvas.width / 2, canvas.height / 2);
  } else {
    // Pantalla de Reposo (Esperando cola)
    ctx.fillStyle = '#888';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Escribe !luchar [guerrero | ninja | mago] para unirte!', canvas.width / 2, canvas.height / 2);
  }

  // Renderizar partículas activas
  particulas = particulas.filter(p => p.vida > 0);
  particulas.forEach(p => {
    p.actualizar();
    p.dibujar(ctx);
  });

  ctx.restore();
  requestAnimationFrame(gameLoop);
}

// 🧪 [PRUEBAS COMENTADAS] Botón de simulación en pantalla
/*
if (btnTest) {
  btnTest.style.display = 'none'; // Ocultar el botón visualmente
  btnTest.addEventListener('click', () => {
    const nombresFicticios = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Zeta', 'Omega'];
    const clasesDisponibles = ['guerrero', 'ninja', 'mago'];
    
    const p1Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    let p2Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    while (p1Ficticio === p2Ficticio) {
      p2Ficticio = nombresFicticios[Math.floor(Math.random() * nombresFicticios.length)];
    }

    const c1Ficticia = clasesDisponibles[Math.floor(Math.random() * clasesDisponibles.length)];
    const c2Ficticia = clasesDisponibles[Math.floor(Math.random() * clasesDisponibles.length)];

    socket.emit('test_unirse_cola', { nombre: p1Ficticio, clase: c1Ficticia });
    socket.emit('test_unirse_cola', { nombre: p2Ficticio, clase: c2Ficticia });
  });
}
*/

gameLoop();
