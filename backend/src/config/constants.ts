export const VERSION_JUEGO = 1.7;

// --- SISTEMA DE AFIJOS DIARIOS (14 MODIFICADORES) ---
export const AFIJOS_POOL = [
    { id: 'soleado', nombre: '🌞 Día Despejado', desc: 'Condiciones normales de combate.' },
    { id: 'frenesi', nombre: '🩸 Frenesí', desc: '+20% Daño, -15% Vida máxima para todos.' },
    { id: 'hierro', nombre: '🛡️ Piel de Hierro', desc: '+20% Vida, -15% Daño para todos.' },
    { id: 'viento', nombre: '🏃 Viento de Cola', desc: 'Todos se mueven un 25% más rápido.' },
    { id: 'niebla', nombre: '🌫️ Niebla Densa', desc: 'Los Ninjas atacan más rápido.' },
    { id: 'arcano', nombre: '✨ Sobrecarga Arcana', desc: 'Magos hacen +30% Daño pero atacan más lento.' },
    { id: 'fe', nombre: '⛪ Fe Inquebrantable', desc: 'Clérigos tienen +30% Vida máxima.' },
    { id: 'francotirador', nombre: '🏹 Francotirador', desc: 'Cazadores atacan desde más lejos (+30 rango).' },
    { id: 'berserker', nombre: '🪓 Furia Berserker', desc: 'Guerreros hacen +20% Daño físico.' },
    { id: 'critico', nombre: '☠️ Toque Mortal', desc: 'Todos tienen su daño máximo potenciado.' },
    { id: 'vampirismo', nombre: '🧛 Noche de Vampiros', desc: 'Nadie se cura (Próximamente: Robo de vida).' },
    { id: 'hielo', nombre: '❄️ Suelo Helado', desc: 'Todos se mueven un 30% más lento.' },
    { id: 'fuego', nombre: '🔥 Ola de Calor', desc: 'El suelo quema, todos caminan más rápido.' },
    { id: 'oro', nombre: '💰 Fiebre del Oro', desc: 'Día de riquezas. (Multiplicador de apuestas +20%).' }
];

// Selecciona un afijo basado en la fecha actual (cambia a las 00:00 y sobrevive a los reinicios)
function obtenerAfijoDelDia() {
    const hoy = new Date();
    // Crea una "semilla" numérica única para hoy (Ej: 20231024)
    const semillaDia = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();
    // Truco matemático para generar un número pseudoaleatorio basado en esa fecha
    const pseudoRandom = Math.abs(Math.sin(semillaDia) * 10000);
    return AFIJOS_POOL[Math.floor(pseudoRandom) % AFIJOS_POOL.length]!;
}

export const afijoDiario = obtenerAfijoDelDia();

// --- SISTEMA DE TÍTULOS DE PRESTIGIO (20 MODIFICADORES) ---
export const TITULOS_PRESTIGIO = [
    { id: 'recluta', nombre: 'Recluta', desc: 'Título inicial' },
    { id: 'novato', nombre: 'Novato', desc: 'Juega por primera vez' },
    { id: 'luchador', nombre: 'Luchador', desc: 'Alcanza el Nivel 5' },
    { id: 'gladiador', nombre: 'Gladiador', desc: 'Alcanza el Nivel 10' },
    { id: 'veterano', nombre: 'Veterano', desc: 'Alcanza el Nivel 20' },
    { id: 'maestro', nombre: 'Maestro', desc: 'Alcanza el Nivel 30' },
    { id: 'leyenda', nombre: 'Leyenda Viva', desc: 'Alcanza el Nivel 50' },
    { id: 'dios', nombre: 'Dios de la Arena', desc: 'Alcanza el Nivel 100' },
    { id: 'asesino', nombre: 'Asesino', desc: 'Consigue 10 Victorias' },
    { id: 'carnicero', nombre: 'Carnicero', desc: 'Consigue 50 Victorias' },
    { id: 'ejecutor', nombre: 'El Ejecutor', desc: 'Consigue 100 Victorias' },
    { id: 'rico', nombre: 'Acaudalado', desc: 'Acumula 1.000 Oro' },
    { id: 'millonario', nombre: 'Millonario', desc: 'Acumula 10.000 Oro' },
    { id: 'juggernaut', nombre: 'Juggernaut', desc: 'Nivel 20 Guerrero' },
    { id: 'sombra', nombre: 'Sombra', desc: 'Nivel 20 Ninja' },
    { id: 'archimago', nombre: 'Archimago', desc: 'Nivel 20 Mago' },
    { id: 'santo', nombre: 'Santo', desc: 'Nivel 20 Clérigo' },
    { id: 'franco', nombre: 'Francotirador', desc: 'Nivel 20 Cazador' }
];