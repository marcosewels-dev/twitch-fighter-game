import { Jugador } from '../models/Jugador.js';
import { enviarMensajeChat } from '../config/twitch.js';

export interface Apuesta { usuario: string; bando: string; cantidad: number; }

export class EconomiaService {
  // Procesa el overflow de XP y subidas de nivel dinámicas
  static async procesarSubidaNivel(twitchId: string, xpGanada: number, clase: string, gano: boolean, oroGanado = 0): Promise<void> {
    try {
      const perfil = await Jugador.findOne({ twitchId });
      if (!perfil) return;

      const claseData = (perfil as any)[clase];
      if (!claseData) return;

      // NOTA: Volvemos a usar 'xp' que es el atributo real del schema.
      claseData.xp = (claseData.xp || 0) + xpGanada;
      perfil.set('oro', (perfil.get('oro') || 0) + oroGanado);
      
      if (gano) claseData.victorias = (claseData.victorias || 0) + 1;
      else claseData.derrotas = (claseData.derrotas || 0) + 1;

      let xpNecesaria = claseData.nivel * 100;
      while (claseData.xp >= xpNecesaria) {
        claseData.xp -= xpNecesaria;
        claseData.nivel += 1;
        const msg = `🎉 ¡LEVEL UP! @${perfil.username} alcanzó el Nivel ${claseData.nivel} como [${clase.toUpperCase()}]! ⚔️`;
        console.log(`[ECONOMÍA] ${msg}`); // Imprimir en consola
        enviarMensajeChat(msg);
        xpNecesaria = claseData.nivel * 100;
      }
      
      perfil.markModified(clase); // 🛡️ CRÍTICO: Obliga a Mongoose a registrar los cambios en la sub-clase
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
        const msg = `🚫 @${usernameGanador} no gana XP por vencer a un oponente demasiado inferior.`;
        console.log(`[ECONOMÍA] ${msg}`); // Imprimir en consola
        enviarMensajeChat(msg);
        return 0;
      }
      return Math.max(15, 50 - (diferencia * 10));
    }
    return 50;
  }

  // Reparte el pozo proporcional de las apuestas del chat
  static async procesarPremiosApuestas(listadoApuestas: Apuesta[], bandoGanador: string): Promise<void> {
    if (listadoApuestas.length === 0) return;

    const bolsaTotalApuestas = listadoApuestas.reduce((acc, ap) => acc + ap.cantidad, 0);
    const apuestasAcertadas = listadoApuestas.filter(ap => ap.bando.toLowerCase() === bandoGanador.toLowerCase());
    const bolsaOroAcertadaTotal = apuestasAcertadas.reduce((acc, ap) => acc + ap.cantidad, 0);

    for (const apuesta of listadoApuestas) {
      if (apuesta.bando.toLowerCase() === bandoGanador.toLowerCase() && bolsaOroAcertadaTotal > 0) {
        const porcentajeParticipacion = apuesta.cantidad / bolsaOroAcertadaTotal;
        const premioLimpio = Math.floor(bolsaTotalApuestas * porcentajeParticipacion);

        const jug = await Jugador.findOne({ twitchId: apuesta.usuario.toLowerCase() });
        if (jug) {
            jug.set('oro', (jug.get('oro') || 0) + premioLimpio);
            await jug.save();
        }
        const msg = `💰 @${apuesta.usuario} ganó su apuesta: +${premioLimpio} 🪙!`;
        console.log(`[ECONOMÍA] ${msg}`); // Imprimir en consola
        // Opcional: enviarMensajeChat(msg); -> Puedes habilitarlo, pero puede generar spam en el chat de Twitch.
      }
    }
  }
}
