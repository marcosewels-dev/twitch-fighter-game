export class Monstruo {
  x: number; y: number; ancho = 80; alto = 80;
  nombre: string; emoji: string; color: string; vidaMax: number; vida: number; danoMin: number; danoMax: number; cooldownAtaque = 0;
  congeladoTimer = 0; 
  fase: number;

  // --- PROPIEDADES DE ANIMACIÓN 2D ---
  sprite: HTMLImageElement;
  estadoAnim: 'idle' | 'run' | 'attack' = 'idle';
  frameActual = 0;
  frameTick = 0;
  filasAnimacion = 3;
  columnasAnimacion = 0;
  escalaSprite = 3;
  frameWExacto = 0;
  frameHExacto = 0;
  velocidadAnimacion = 8;
  spritesFila = { idle: 0, run: 1, attack: 2 }; // Qué fila de la imagen es cada animación
  framesPorEstado = { idle: 4, run: 6, attack: 4 }; // Cuántos frames tiene cada animación

  constructor(x: number, y: number, fase: number, nivelMedio: number) {
    this.x = x; this.y = y; this.fase = fase;

    // 1. Definimos los pools de enemigos por fase (Tiers)
    const poolEnemigos = [
      ['lobo', 'slime', 'orco'],               // Fase 0 (Tier 1)
      ['oso', 'esqueleto'],                    // Fase 1 (Tier 2)
      ['orco-elite', 'esqueleto-arquero'],     // Fase 2 (Tier 3)
      ['jinete-orco', 'hacha-armadura']        // Fase 3 (Tier 4)
    ];

    // 2. Elegimos un enemigo aleatorio de la fase correspondiente
    const opcionesFase = poolEnemigos[fase] || poolEnemigos[0];
    const tipoElegido = opcionesFase![Math.floor(Math.random() * opcionesFase!.length)]!;

    // 3. Diccionario visual para nombres, emojis y colores temáticos
    const configVisual: Record<string, { nombre: string, emoji: string, color: string }> = {
      'lobo': { nombre: '🐺 Lobo Salvaje', emoji: '🐺', color: '#7f8c8d' },
      'slime': { nombre: '💧 Slime Tóxico', emoji: '💧', color: '#2ecc71' },
      'orco': { nombre: '👹 Orco Menor', emoji: '👹', color: '#e67e22' },
      'oso': { nombre: '🐻 Oso Furioso', emoji: '🐻', color: '#8e44ad' },
      'esqueleto': { nombre: '💀 Esqueleto', emoji: '💀', color: '#bdc3c7' },
      'orco-elite': { nombre: '👺 Orco de Élite', emoji: '👺', color: '#c0392b' },
      'esqueleto-arquero': { nombre: '🏹 Esq. Arquero', emoji: '🏹', color: '#95a5a6' },
      'jinete-orco': { nombre: '🐗 Jinete Orco', emoji: '🐗', color: '#d35400' },
      'hacha-armadura': { nombre: '🪓 Armadura Maldita', emoji: '🪓', color: '#34495e' }
    };

    const conf = configVisual[tipoElegido]!;
    this.nombre = conf.nombre;
    this.emoji = conf.emoji;
    this.color = conf.color;

    // 4. Asignamos estadísticas base y tamaño según el Tier
    if (fase === 0) {
      this.vidaMax = Math.floor(220 * (1 + nivelMedio * 0.05)); this.danoMin = Math.floor(5 * (1 + nivelMedio * 0.05)); this.danoMax = Math.floor(9 * (1 + nivelMedio * 0.05));
      this.escalaSprite = 3.5;
      // EJEMPLO FUTURO:
      // this.frameWExacto = 100; this.frameHExacto = 100;
      // this.filasAnimacion = 8; this.columnasAnimacion = 10;
    } else if (fase === 1) {
      this.vidaMax = Math.floor(340 * (1 + nivelMedio * 0.05)); this.danoMin = Math.floor(7 * (1 + nivelMedio * 0.05)); this.danoMax = Math.floor(12 * (1 + nivelMedio * 0.05));
      this.escalaSprite = 4.5;
      // this.frameWExacto = 100; this.frameHExacto = 100;
      // this.filasAnimacion = 8; this.columnasAnimacion = 10;
    } else if (fase === 2) {
      this.ancho = 100; this.alto = 100;
      this.vidaMax = Math.floor(480 * (1 + nivelMedio * 0.06)); this.danoMin = Math.floor(10 * (1 + nivelMedio * 0.06)); this.danoMax = Math.floor(16 * (1 + nivelMedio * 0.06));
      this.escalaSprite = 5.5;
      // this.frameWExacto = 100; this.frameHExacto = 100;
      // this.filasAnimacion = 8; this.columnasAnimacion = 10;
    } else {
      this.ancho = 140; this.alto = 140;
      this.vidaMax = Math.floor(850 * (1 + nivelMedio * 0.07)); this.danoMin = Math.floor(15 * (1 + nivelMedio * 0.07)); this.danoMax = Math.floor(26 * (1 + nivelMedio * 0.07));
      this.escalaSprite = 8; // El jefe será enorme
      // this.frameWExacto = 100; this.frameHExacto = 100;
      // this.filasAnimacion = 8; this.columnasAnimacion = 10;
    }
    this.vida = this.vidaMax;

    // 5. Intentamos cargar la hoja de sprites según el tipo seleccionado aleatoriamente
    this.sprite = new Image();
    this.sprite.src = `/sprites/${tipoElegido}.png`;
  }

  dibujar(ctx: CanvasRenderingContext2D) {
    if (this.vida <= 0) return;
    ctx.save();
    
    const centroX = this.x + this.ancho / 2;
    const centroY = this.y + this.alto / 2;
    
    ctx.translate(centroX, centroY);
    ctx.shadowBlur = 15; 
    ctx.shadowColor = this.congeladoTimer > 0 ? '#00d2ff' : this.color;
    
    // DIBUJAR SPRITE SI ESTÁ CARGADO, SI NO, USAR EMOJI
    if (this.sprite.complete && this.sprite.naturalWidth > 0) {
      const cols = this.columnasAnimacion > 0 ? this.columnasAnimacion : Math.max(...Object.values(this.framesPorEstado));
      const frameW = this.frameWExacto > 0 ? this.frameWExacto : (this.sprite.naturalWidth / cols);
      const frameH = this.frameHExacto > 0 ? this.frameHExacto : (this.sprite.naturalHeight / this.filasAnimacion);
      const filaY = this.spritesFila[this.estadoAnim] * frameH;
      const frameX = this.frameActual * frameW;
      
      const drawW = frameW * this.escalaSprite;
      const drawH = frameH * this.escalaSprite;
      // Dibujamos el recorte exacto del frame correspondiente usando las proporciones originales
      ctx.drawImage(this.sprite, frameX, filaY, frameW, frameH, -drawW/2, -drawH/2, drawW, drawH);
    } else {
      ctx.font = `${this.ancho - 10}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.emoji, 0, 0); 
    }
    ctx.restore();

    const txt = `${this.congeladoTimer > 0 ? '🥶 ' : ''}${this.nombre}`;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(txt, centroX, this.y - 20); ctx.fillText(txt, centroX, this.y - 20);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(centroX - 60, this.y - 10, 120, 8);
    ctx.fillStyle = this.congeladoTimer > 0 ? '#00d2ff' : this.color;
    ctx.fillRect(centroX - 60, this.y - 10, 120 * (this.vida / this.vidaMax), 8);
  }

  actualizar() {
    if (this.vida <= 0) return;

    // --- ACTUALIZAR MÁQUINA DE ESTADOS Y ANIMACIONES ---
    const maxCooldown = this.fase === 3 ? 35 : 50;
    if (this.cooldownAtaque > maxCooldown - 15 && this.congeladoTimer === 0) { // Si acaba de atacar
      this.estadoAnim = 'attack';
    } else {
      this.estadoAnim = 'idle'; // Monstruos no se mueven (no necesitan run), así que idle es por defecto
    }

    this.frameTick++;
    if (this.frameTick > this.velocidadAnimacion) {
      this.frameTick = 0;
      this.frameActual = (this.frameActual + 1) % this.framesPorEstado[this.estadoAnim];
    }
  }
}
