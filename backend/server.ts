import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import tmi from 'tmi.js';
import cors from 'cors';

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

interface JugadorCola {
  nombre: string;
  clase: string;
}

// Cola de objetos de jugadores
let colaEspera: JugadorCola[] = [];
let peleaEnCurso = false;

// ==========================================
// 🔌 CONEXIÓN REAL A TWITCH (ACTIVA)
// ==========================================
const twitchClient = new tmi.Client({
  options: { debug: true },
  channels: [ 'danqvix' ] // 👈 CAMBIA ESTO por el nombre de Twitch de tu amigo (en minúsculas)
});

twitchClient.connect().catch(console.error);

twitchClient.on('message', (channel, tags, message, self) => {
  if (self) return;

  const msg = message.trim().toLowerCase();
  
  if (msg.startsWith('!luchar')) {
    // CORREGIDO: Aseguramos que username sea un string y no undefined
    const username: string = (tags['display-name'] || tags.username || '').trim();
    if (!username) return;

    // Evitar que el mismo usuario se apunte dos veces
    if (colaEspera.some(j => j.nombre === username)) {
      twitchClient.say(channel, `@${username}, ya estás en la cola de espera.`);
      return;
    }

    // Extraer la clase si se especifica: "!luchar ninja" -> "ninja"
    const partes = msg.split(' ');
    let claseElegida = partes[1] || ''; 
    const clasesValidas = ['guerrero', 'ninja', 'mago'];

    if (!clasesValidas.includes(claseElegida)) {
      // Si no eligen clase o la escriben mal, se asigna una al azar
      claseElegida = clasesValidas[Math.floor(Math.random() * clasesValidas.length)];
    }
    
    colaEspera.push({ nombre: username, clase: claseElegida });
    twitchClient.say(channel, `@${username} se une como [${claseElegida.toUpperCase()}]! (Cola: ${colaEspera.length})`);
    
    // Enviamos la cola formateada al frontend para que la muestre en pantalla
    io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(${j.clase[0].toUpperCase()})`));
    chequearSiguientePelea();
  }
});

// Lógica para emparejar y lanzar combates
function chequearSiguientePelea() {
  if (peleaEnCurso || colaEspera.length < 2) return;

  peleaEnCurso = true;
  const p1 = colaEspera.shift();
  const p2 = colaEspera.shift();

  // CORREGIDO: Validación estricta de que ambos luchadores existen antes de iniciar
  if (!p1 || !p2) {
    peleaEnCurso = false;
    return;
  }

  io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(${j.clase[0].toUpperCase()})`));
  
  console.log(`Iniciando pelea: ${p1.nombre} (${p1.clase}) vs ${p2.nombre} (${p2.clase})`);
  io.emit('iniciar_pelea', { 
    p1: p1.nombre, 
    claseP1: p1.clase, 
    p2: p2.nombre, 
    claseP2: p2.clase 
  });
}

// Eventos de conexión con el navegador (OBS / Frontend)
io.on('connection', (socket) => {
  console.log('Frontend conectado.');
  
  // Enviamos el estado de la cola al conectar
  socket.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(${j.clase[0].toUpperCase()})`));

  // 🧪 [PRUEBAS COMENTADAS] Recibir registros del botón de simulación del Frontend
  /*
  socket.on('test_unirse_cola', (datos: { nombre: string, clase: string }) => {
    if (datos && datos.nombre && datos.clase) {
      colaEspera.push(datos);
      io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(${j.clase[0].toUpperCase()})`));
      chequearSiguientePelea();
    }
  });
  */

  // Escuchar cuando la pelea termina en el frontend
  socket.on('pelea_terminada', (datos: { ganador: string }) => {
    if (!datos || !datos.ganador) return;
    console.log(`Pelea finalizada. Ganador: ${datos.ganador}`);
    
    // Esperamos 5 segundos mostrando la pantalla de victoria antes de lanzar la siguiente
    setTimeout(() => {
      peleaEnCurso = false;
      chequearSiguientePelea();
    }, 5000);
  });
});

// 🧪 [PRUEBAS COMENTADAS] Permitir meter bots escribiendo en la consola del servidor
/*
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  if (input) {
    const partes = input.split(' ');
    const nombre = partes[0];
    let clase = partes[1] || 'guerrero';
    
    colaEspera.push({ nombre, clase });
    console.log(`[TEST] ${nombre} (${clase}) añadido a la cola.`);
    io.emit('actualizar_cola', colaEspera.map(j => `${j.nombre}(${j.clase[0].toUpperCase()})`));
    chequearSiguientePelea();
  }
});
*/

// Usar puerto dinámico para facilitar el despliegue en la nube (Render/Heroku/etc)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
