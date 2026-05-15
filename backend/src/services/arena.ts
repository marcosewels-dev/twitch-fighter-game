import { Server } from 'socket.io';

interface JugadorPelea { twitchId: string; nombre: string; clase: string; nivel: number; titulo?: string; }

export class ArenaService {
  private static colaEspera: JugadorPelea[] = [];
  public static peleaEnCurso = false;
  public static modoDeCombate: '1v1' | '3v3' = '1v1';
  public static contendientesRojos: JugadorPelea[] = [];
  public static contendientesAzules: JugadorPelea[] = [];

  static obtenerCola(): JugadorPelea[] {
    return this.colaEspera;
  }

  static agregarACola(jugador: JugadorPelea): boolean {
    if (this.colaEspera.some(j => j.twitchId === jugador.twitchId)) return false;
    this.colaEspera.push(jugador);
    return true;
  }

  static vaciarContendientes(): void {
    this.contendientesRojos = [];
    this.contendientesAzules = [];
    this.peleaEnCurso = false;
  }

  // Orquestador inteligente de modos de combate por volumen de cola
  static evaluarSiguienteCombate(io: Server, dungeonActiva: boolean, reclutando: boolean): { arrancó: boolean, modo: '1v1' | '3v3' | 'ninguno' } {
    if (this.peleaEnCurso || dungeonActiva || reclutando) return { arrancó: false, modo: 'ninguno' };

    if (this.colaEspera.length >= 6) {
      this.peleaEnCurso = true;
      this.modoDeCombate = '3v3';
      this.contendientesRojos = [this.colaEspera.shift()!, this.colaEspera.shift()!, this.colaEspera.shift()!];
      this.contendientesAzules = [this.colaEspera.shift()!, this.colaEspera.shift()!, this.colaEspera.shift()!];
      return { arrancó: true, modo: '3v3' };
    } 
    
    if (this.colaEspera.length >= 2) {
      this.peleaEnCurso = true;
      this.modoDeCombate = '1v1';
      this.contendientesRojos = [this.colaEspera.shift()!];
      this.contendientesAzules = [this.colaEspera.shift()!];
      return { arrancó: true, modo: '1v1' };
    }

    return { arrancó: false, modo: 'ninguno' };
  }
}