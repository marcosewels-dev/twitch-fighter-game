import mongoose, { Schema, Document } from 'mongoose';

interface EstadisticasClase {
  nivel: number;
  xp: number;
  victorias: number;
  derrotas: number;
}

export interface IJugador extends Document {
  twitchId: string;
  username: string;
  claseActual: string;
  oro: number;
  tituloEquipado: string;
  titulosDesbloqueados: string[];
  guerrero: EstadisticasClase;
  ninja: EstadisticasClase;
  mago: EstadisticasClase;
  clerigo: EstadisticasClase;
  cazador: EstadisticasClase;
}

const claseSchema = new Schema<EstadisticasClase>({
  nivel: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  victorias: { type: Number, default: 0 },
  derrotas: { type: Number, default: 0 }
}, { _id: false });

const jugadorSchema = new Schema<IJugador>({
  twitchId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  claseActual: { type: String, default: 'guerrero' },
  oro: { type: Number, default: 50 },
  tituloEquipado: { type: String, default: '' },
  titulosDesbloqueados: { type: [String], default: ['novato'] },
  guerrero: { type: claseSchema, default: () => ({}) },
  ninja: { type: claseSchema, default: () => ({}) },
  mago: { type: claseSchema, default: () => ({}) },
  clerigo: { type: claseSchema, default: () => ({}) },
  cazador: { type: claseSchema, default: () => ({}) }
});

export const Jugador = mongoose.model<IJugador>('Jugador', jugadorSchema);