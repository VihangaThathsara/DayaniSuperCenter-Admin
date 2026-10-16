import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export { onAuthStateChanged, signInWithEmailAndPassword, signOut };
