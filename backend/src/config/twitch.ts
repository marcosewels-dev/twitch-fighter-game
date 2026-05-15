import tmi from 'tmi.js';

const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || 'EL_CANAL_DE_TU_AMIGO';
const TWITCH_BOT_USER = process.env.TWITCH_BOT_USER; 
const TWITCH_OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN; 

const tmiOptions: any = {
  options: { debug: true },
  channels: [ TWITCH_CHANNEL ]
};

if (TWITCH_BOT_USER && TWITCH_OAUTH_TOKEN) {
  tmiOptions.identity = {
    username: TWITCH_BOT_USER,
    password: TWITCH_OAUTH_TOKEN
  };
}

export const twitchClient = new tmi.Client(tmiOptions);

export function enviarMensajeChat(mensaje: string): void {
  if (!TWITCH_BOT_USER || !TWITCH_OAUTH_TOKEN) {
    console.log(`⚠️ [CHAT SIMULADO]: ${mensaje}`);
    return;
  }
  // Enviar mensaje forzando el canal configurado
  twitchClient.say(TWITCH_CHANNEL, mensaje).catch(err => {
    console.error('❌ Error al enviar mensaje al chat de Twitch:', err);
  });
}

export const inicializarTwitch = (): void => {
  twitchClient.connect().catch(console.error);
};