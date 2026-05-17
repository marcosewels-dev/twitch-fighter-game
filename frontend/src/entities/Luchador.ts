export type TipoLuchador = 'guerrero' | 'ninja' | 'mago' | 'clerigo' | 'cazador';

export class Particula {
  x: number; y: number; vx: number; vy: number; color: string; vida = 20;
  constructor(x: number, y: number, color: string) {
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 6;
    this.vy = (Math.random() - 0.5) * 6 - 2;
    this.color = color;
  }
  actualizar() { this.x += this.vx; this.y += this.vy; this.vy += 0.25; this.vida--; }
  dibujar(ctx: CanvasRenderingContext2D) { ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, 3, 3); }
}

export class Luchador {
  x: number; y: number; ancho = 45; alto = 45;
  nombre: string; tipo: TipoLuchador; nivel: number; equipo: 'rojo' | 'azul' = 'rojo';
  vidaMax: number; vida: number; velocidad: number; rangoAtaque: number; danoMin: number; danoMax: number;
  vx = 0; vy = 0; enSuelo = false; gravedad = 0.6; friccion = 0.85; cooldownAtaque = 0;
  emoji: string; armaEmoji: string; colorTematico: string;
  direccionMira: 'derecha' | 'izquierda' = 'derecha'; anguloArma = 0;
  esNovatoDopado = false;
  congeladoTimer = 0; 
  objetivoActual: Luchador | null = null;

  // --- PROPIEDADES DE ANIMACIÓN 2D ---
  sprite: HTMLImageElement;
  estadoAnim: 'idle' | 'run' | 'attack' = 'idle';
  frameActual = 0;
  frameTick = 0;
  filasAnimacion = 3; // Número de filas que tiene el sprite por defecto
  columnasAnimacion = 0; // Si es 0, lo calcula automáticamente. Si no, fuerza la cuadrícula.
  escalaSprite = 1; // Para agrandar o achicar el dibujo visualmente
  frameWExacto = 100; // Si el creador dio una medida exacta (ej. 100), ponla aquí
  frameHExacto = 100; // Si el creador dio una medida exacta, ponla aquí
  velocidadAnimacion = 6; // Velocidad a la que cambian los fotogramas (menor = más rápido)
  spritesFila = { idle: 0, run: 1, attack: 2 }; // Qué fila de la imagen es cada animación
  framesPorEstado = { idle: 4, run: 6, attack: 4 }; // Cuántos frames tiene cada animación

  constructor(x: number, y: number, nombre: string, tipo: TipoLuchador, nivel: number, nivelRival: number = 0, esDungeon: boolean = false) {
    this.x = x; this.y = y; this.nombre = nombre; this.tipo = tipo;
    this.nivel = nivel;

    if (esDungeon && nivel > nivelRival && nivelRival > 0) {
      this.nivel = Math.min(nivel, Math.round(nivelRival + 2)); 
    }

    if (tipo === 'guerrero') {
      this.emoji = '🛡️'; this.armaEmoji = '🪓'; this.colorTematico = '#e74c3c';
      this.vidaMax = 150; this.velocidad = 2.9; this.rangoAtaque = 70; this.danoMin = 13; this.danoMax = 17;
      
      // Configuración para el sprite sheet de 8 filas
      this.filasAnimacion = 8;
      this.columnasAnimacion = 10; // 👈 ¡La fila 5 (ataque de fuego) tiene 10 frames en total!
      this.escalaSprite = 4; // Aumentamos la escala un poco más
      this.velocidadAnimacion = 4; // Aceleramos un poco para que se vea bien fluido
      
      // ¡LA CLAVE ESTÁ AQUÍ! 
      // Cambia el 100 por la medida real que ponga en itch.io (100, 128, 64, etc.)
      this.frameWExacto = 100; 
      this.frameHExacto = 100; 
      this.spritesFila = { idle: 0, run: 1, attack: 2 };
      this.framesPorEstado = { idle: 6, run: 8, attack: 7 };
    } else if (tipo === 'ninja') {
      this.emoji = '🥷'; this.armaEmoji = '🗡️'; this.colorTematico = '#2ecc71';
      this.vidaMax = 110; this.velocidad = 5.4; this.rangoAtaque = 55; this.danoMin = 10; this.danoMax = 13;
      
      this.filasAnimacion = 8;
      this.columnasAnimacion = 10;
      this.escalaSprite = 4;
      this.velocidadAnimacion = 4;
      this.frameWExacto = 100; 
      this.frameHExacto = 100; 
      this.spritesFila = { idle: 0, run: 1, attack: 2 };
      this.framesPorEstado = { idle: 6, run: 8, attack: 7 };
    } else if (tipo === 'mago') {
      this.emoji = '🧙'; this.armaEmoji = '⚡'; this.colorTematico = '#9b59b6';
      this.vidaMax = 115; this.velocidad = 3.2; this.rangoAtaque = 175; this.danoMin = 10; this.danoMax = 17;
      
      this.filasAnimacion = 8;
      this.columnasAnimacion = 10;
      this.escalaSprite = 4;
      this.velocidadAnimacion = 4;
      this.frameWExacto = 100; 
      this.frameHExacto = 100; 
      this.spritesFila = { idle: 0, run: 1, attack: 2 };
      this.framesPorEstado = { idle: 6, run: 8, attack: 7 };
    } else if (tipo === 'clerigo') {
      this.emoji = '⛪'; this.armaEmoji = '🔨'; this.colorTematico = '#f1c40f';
      this.vidaMax = 145; this.velocidad = 2.8; this.rangoAtaque = 65; this.danoMin = 9; this.danoMax = 15;
      
      this.filasAnimacion = 8;
      this.columnasAnimacion = 10;
      this.escalaSprite = 4;
      this.velocidadAnimacion = 4;
      this.frameWExacto = 100; 
      this.frameHExacto = 100; 
      this.spritesFila = { idle: 0, run: 1, attack: 2 };
      this.framesPorEstado = { idle: 6, run: 8, attack: 7 };
    } else { 
      this.emoji = '🏹'; this.armaEmoji = '🏹'; this.colorTematico = '#27ae60';
      this.vidaMax = 115; this.velocidad = 3.8; this.rangoAtaque = 190; this.danoMin = 9; this.danoMax = 13;
      
      this.filasAnimacion = 8;
      this.columnasAnimacion = 10;
      this.escalaSprite = 4;
      this.velocidadAnimacion = 4;
      this.frameWExacto = 100; 
      this.frameHExacto = 100; 
      this.spritesFila = { idle: 0, run: 1, attack: 2 };
      this.framesPorEstado = { idle: 6, run: 8, attack: 7 };
    }

    const nivelesExtra = Math.max(0, this.nivel - 1);
    this.vidaMax = Math.round(this.vidaMax * (1 + nivelesExtra * 0.01));
    this.danoMin = Math.round(this.danoMin * (1 + nivelesExtra * 0.007));
    this.danoMax = Math.round(this.danoMax * (1 + nivelesExtra * 0.007));

    if (!esDungeon && nivelRival > nivel && (nivelRival - nivel) >= 3) {
      this.vidaMax = Math.round(this.vidaMax * 1.15);
      this.danoMin = Math.round(this.danoMin * 1.15);
      this.danoMax = Math.round(this.danoMax * 1.15);
      this.esNovatoDopado = true;
    }

    this.vida = this.vidaMax;

    // --- 🔮 APLICAR REGLAS DEL AFIJO DIARIO ---
    const afijo = (window as any).afijoDiario?.id;
    if (afijo === 'frenesi') { this.danoMin *= 1.2; this.danoMax *= 1.2; this.vidaMax *= 0.85; }
    else if (afijo === 'hierro') { this.vidaMax *= 1.2; this.danoMin *= 0.85; this.danoMax *= 0.85; }
    else if (afijo === 'viento' || afijo === 'fuego') { this.velocidad *= 1.25; }
    else if (afijo === 'hielo') { this.velocidad *= 0.7; }
    else if (afijo === 'niebla' && tipo === 'ninja') { this.cooldownAtaque = 15; }
    else if (afijo === 'arcano' && tipo === 'mago') { this.danoMin *= 1.3; this.danoMax *= 1.3; }
    else if (afijo === 'fe' && tipo === 'clerigo') { this.vidaMax *= 1.3; }
    else if (afijo === 'francotirador' && tipo === 'cazador') { this.rangoAtaque += 30; }
    else if (afijo === 'berserker' && tipo === 'guerrero') { this.danoMin *= 1.2; this.danoMax *= 1.2; }
    else if (afijo === 'critico') { this.danoMax *= 1.3; }
    
    this.vidaMax = Math.floor(this.vidaMax); // Prevenir decimales flotantes
    this.vida = this.vidaMax;

    // Intentamos cargar la hoja de sprites desde la carpeta pública
    this.sprite = new Image();
    this.sprite.src = `/sprites/${tipo}.png`;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    if (this.vida <= 0) return; 
    ctx.save();
    const centroX = this.x + this.ancho / 2;
    const centroY = this.y + this.alto / 2;
    ctx.translate(centroX, centroY);
    if (this.direccionMira === 'izquierda') ctx.scale(-1, 1);

    ctx.shadowBlur = this.congeladoTimer > 0 ? 20 : (this.esNovatoDopado ? 25 : 12); 
    ctx.shadowColor = this.congeladoTimer > 0 ? '#00d2ff' : (this.esNovatoDopado ? '#f39c12' : this.colorTematico);
    
    // DIBUJAR SPRITE SI ESTÁ CARGADO, SI NO, USAR EMOJI
    if (this.sprite.complete && this.sprite.naturalWidth > 0) {
      // Usamos columnasAnimacion si está definido, sino usamos el automático
      const cols = this.columnasAnimacion > 0 ? this.columnasAnimacion : Math.max(...Object.values(this.framesPorEstado));
      const frameW = this.frameWExacto > 0 ? this.frameWExacto : (this.sprite.naturalWidth / cols);
      const frameH = this.frameHExacto > 0 ? this.frameHExacto : (this.sprite.naturalHeight / this.filasAnimacion);
      const filaY = this.spritesFila[this.estadoAnim] * frameH;
      const frameX = this.frameActual * frameW;
      
      // USAR LAS PROPORCIONES REALES DE LA IMAGEN PARA NO DEFORMARLA
      const drawW = frameW * this.escalaSprite;
      const drawH = frameH * this.escalaSprite;
      // Dibujamos el recorte exacto del frame correspondiente
      ctx.drawImage(this.sprite, frameX, filaY, frameW, frameH, -drawW/2, -drawH/2, drawW, drawH);
    } else {
      ctx.font = '40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.emoji, 0, 0);
    }
    ctx.shadowBlur = 0;

    // Solo pintamos el arma flotante si estamos usando el modo Emoji de respaldo
    if (!this.sprite.complete || this.sprite.naturalWidth === 0) {
      ctx.save();
      ctx.translate(20, 5); ctx.rotate(this.anguloArma);
      ctx.font = '28px Arial'; ctx.fillText(this.armaEmoji, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    const etiquetaNombre = `${this.congeladoTimer > 0 ? '🥶 ' : (this.esNovatoDopado ? '🔰 ' : '')}${this.nombre} (Nv.${this.nivel})`;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(etiquetaNombre, centroX, this.y - 25); ctx.fillText(etiquetaNombre, centroX, this.y - 25);

    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(centroX - 30, this.y - 15, 60, 6);
    ctx.fillStyle = this.congeladoTimer > 0 ? '#00d2ff' : (this.equipo === 'rojo' ? '#e74c3c' : '#3498db');
    ctx.fillRect(centroX - 30, this.y - 15, 60 * (this.vida / this.vidaMax), 6);
  }

  actualizar() {
    if (this.vida <= 0) return;
    if (this.cooldownAtaque > 0) this.cooldownAtaque--;
    if (this.congeladoTimer > 0) this.congeladoTimer--;

    this.vy += this.gravedad; this.y += this.vy;
    if (this.y >= 600) { this.y = 600; this.vy = 0; this.enSuelo = true; }
    
    this.x += this.congeladoTimer > 0 ? 0 : this.vx;
    this.vx *= this.friccion;

    if (this.x < 50) this.x = 50;
    if (this.x > 1180) this.x = 1180;
    this.anguloArma *= 0.8;

    // --- ACTUALIZAR MÁQUINA DE ESTADOS Y ANIMACIONES ---
    if (this.cooldownAtaque > 15) { // Si acaba de atacar, mostramos animación de ataque
      this.estadoAnim = 'attack';
    } else if (Math.abs(this.vx) > 0.5 && this.congeladoTimer === 0) {
      this.estadoAnim = 'run';
    } else {
      this.estadoAnim = 'idle';
    }

    this.frameTick++;
    if (this.frameTick > this.velocidadAnimacion) { 
      this.frameTick = 0;
      this.frameActual = (this.frameActual + 1) % this.framesPorEstado[this.estadoAnim];
    }
  }
  atacar() { this.anguloArma = -Math.PI / 2.5; }
  saltar() { if (this.enSuelo && this.vida > 0 && this.congeladoTimer === 0) { this.vy = -11; this.enSuelo = false; } }
}
