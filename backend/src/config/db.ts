import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;

export const conectarDB = async (): Promise<void> => {
  if (!MONGO_URI) {
    console.error('❌ Error: No se ha configurado la variable de entorno MONGO_URI');
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado con éxito a MongoDB Atlas');
  } catch (err) {
    console.error('❌ Error al conectar a MongoDB:', err);
    process.exit(1); 
  }
};