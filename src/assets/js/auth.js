import { ADMIN_EMAIL } from './firebase-config.js';
import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from './firebase-core.js';
import { clearAdminCache } from './data-cache.js';

export function listenAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isAdmin(user) {
  return !!user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export async function requireAdmin() {
  if (isAdmin(auth.currentUser)) return auth.currentUser;
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      queueMicrotask(() => stop());
      if (!user || !isAdmin(user)) {
        if (user && !isAdmin(user)) {
          await signOut(auth);
        }
        window.location.href = 'signin.html';
        return;
      }
      resolve(user);
    });
  });
}

export async function loginAdmin(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  if (!isAdmin(credential.user)) {
    await signOut(auth);
    throw new Error('This account is not allowed to access the admin panel.');
  }
  return credential.user;
}

export async function logoutAdmin() {
  clearAdminCache();
  await signOut(auth);
  window.location.href = 'signin.html';
}
