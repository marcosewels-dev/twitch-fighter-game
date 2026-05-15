import tmi from 'tmi.js';
import { Server } from 'socket.io';
import { procesarComandoChat } from './sockets.js';

export function iniciarBotTwitch(io: Server) {
    if (!process.env.TWITCH_USERNAME || !process.env.TWITCH_OAUTH_TOKEN || !process.env.TWITCH_CHANNEL) {
        console.warn('⚠️ [TWITCH] Credenciales no encontradas en el archivo .env. Ignorando conexión.');
        return;
    }

    const client = new tmi.Client({
        options: { debug: false },
        connection: { reconnect: true, secure: true },
        identity: {
            username: process.env.TWITCH_USERNAME,
            password: process.env.TWITCH_OAUTH_TOKEN
        },
        channels: [process.env.TWITCH_CHANNEL]
    });

    client.connect().catch(console.error);

    client.on('connected', (address, port) => {
        console.log(`✅ [TWITCH] Conectado exitosamente al canal de ${process.env.TWITCH_CHANNEL}`);
    });

    client.on('message', async (channel, tags, message, self) => {
        if (self) return; // Evita que el bot se procese a sí mismo
        const username = tags['display-name'] || tags.username || 'Anonimo';
        
        // Pasamos el mensaje al juego (esTest = false)
        await procesarComandoChat(io, username, message, false);
    });
}