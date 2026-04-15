import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Configuración proporcionada por el usuario
const firebaseConfig = {
  apiKey: "AIzaSyAjSfFssGhXi8VbZk4BnGWEc4p8s5S1nvs",
  authDomain: "comunication-ipt.firebaseapp.com",
  databaseURL: "https://comunication-ipt-default-rtdb.firebaseio.com",
  projectId: "comunication-ipt",
  storageBucket: "comunication-ipt.firebasestorage.app",
  messagingSenderId: "649110904978",
  appId: "1:649110904978:web:d561cf966f26e049c6c64b"
};

const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
