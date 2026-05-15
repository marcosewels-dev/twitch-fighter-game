interface JugadorPelea { twitchId: string; nombre: string; clase: string; nivel: number; titulo?: string; }

export class DungeonService {
  public static dungeonEnCurso = false;
  public static dungeonFaseReclutamiento = false;
  public static grupoDungeon: JugadorPelea[] = [];
  public static tiempoDungeonRestante = 0;

  static resetearDungeon(): void {
    this.grupoDungeon = [];
    this.dungeonEnCurso = false;
    this.dungeonFaseReclutamiento = false;
    this.tiempoDungeonRestante = 0;
  }

  static agregarHeroe(jugador: JugadorPelea): boolean {
    if (!this.dungeonFaseReclutamiento) return false;
    if (this.grupoDungeon.some(h => h.twitchId === jugador.twitchId)) return false;
    if (this.grupoDungeon.length >= 5) return false;

    this.grupoDungeon.push(jugador);
    return true;
  }

  static calcularNivelMedio(): number {
    if (this.grupoDungeon.length === 0) return 1;
    const sumaNiveles = this.grupoDungeon.reduce((acc, h) => acc + h.nivel, 0);
    return Math.round(sumaNiveles / this.grupoDungeon.length);
  }
}