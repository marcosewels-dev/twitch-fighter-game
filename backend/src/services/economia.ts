import { Jugador } from '../models/Jugador.js';
import { enviarMensajeChat } from '../twitch.js';

interface Apuesta { twitchId: string; username: string; objetivo: string; cantidad: number; }

export class EconomiaService {
  // Procesa el overflow de XP y subidas de nivel dinámicas
  static async procesarSubidaNivel(twitchId: string, xpGanada: number, clase: string, gano: boolean, oroGanado = 0): Promise<void> {
    try {
      const perfil = await Jugador.findOne({ twitchId });
      if (!perfil) return;

      const claseData = (perfil as any)[clase];
      claseData.xp += xpGanada;
      perfil.oro += oroGanado;
      
      if (gano) claseData.victorias += 1;
      else claseData.derrotas += 1;

      let xpNecesaria = claseData.nivel * 100;
      while (claseData.xp >= xpNecesaria) {
        claseData.xp -= xpNecesaria;
        claseData.nivel += 1;
        enviarMensajeChat(`🎉 ¡LEVEL UP! @${perfil.username} alcanzó el Nivel ${claseData.nivel} como [${clase.toUpperCase()}]! ⚔️`);
        xpNecesaria = claseData.nivel * 100;
      }
      await perfil.save();
    } catch (err) {
      console.error('Error al procesar subida de nivel:', err);
    }
  }

  // Algoritmo anti-abuso 1v1 y 3v3
  static calcularXPGanador1v1(nivelGanador: number, nivelPerdedor: number, usernameGanador: string): number {
    if (nivelGanador > nivelPerdedor) {
      const diferencia = nivelGanador - nivelPerdedor;
      if (diferencia >= 4) {
        enviarMensajeChat(`🚫 @${usernameGanador} no gana XP por vencer a un oponente demasiado inferior.`);
        return 0;
      }
      return Math.max(15, 50 - (diferencia * 10));
    }
    return 50;
  }

  // Reparte el pozo proporcional de las apuestas del chat
  static async procesarPremiosApuestas(listadoApuestas: Apuesta[], nombresGanadoresLista: string[]): Promise<void> {
    if (listadoApuestas.length === 0) return;

    const bolsaTotalApuestas = listadoApuestas.reduce((acc, ap) => acc + ap.cantidad, 0);
    const apuestasAcertadas = listadoApuestas.filter(ap => 
      nombresGanadoresLista.map(n => n.toLowerCase()).includes(ap.objetivo.toLowerCase())
    );
    const bolsaOroAcertadaTotal = apuestasAcertadas.reduce((acc, ap) => acc + ap.cantidad, 0);

    for (const apuesta of listadoApuestas) {
      const ganoApuesta = nombresGanadoresLista.map(n => n.toLowerCase()).includes(apuesta.objetivo.toLowerCase());
      if (ganoApuesta && bolsaOroAcertadaTotal > 0) {
        const porcentajeParticipacion = apuesta.cantidad / bolsaOroAcertadaTotal;
        const premioLimpio = Math.floor(bolsaTotalApuestas * porcentajeParticipacion);

        await Jugador.findOneAndUpdate({ twitchId: apuesta.twitchId }, { $inc: { oro: premioLimpio } });
        enviarMensajeChat(`💰 @${apuesta.username} ganó su apuesta: +${premioLimpio} oro!`);
      }
    }
  }
}
