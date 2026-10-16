import { auth } from './firebase-core.js';

const prefix = 'dayani-admin-cache-v2:';
const ttl = 15000;
const maxAge = 86400000;
const pending = new Map();
const generations = new Map();
const memory = new Map();
const subscribers = new Set();
const cacheKey = (name) => `${prefix}${auth.currentUser?.uid || 'signed-out'}:${name}`;

function read(key) {
  let entry = memory.get(key);
  if (!entry) {
    try {
      entry = JSON.parse(sessionStorage.getItem(key), (_, value) =>
        value?.__dayaniTimestamp !== undefined ? new Date(value.__dayaniTimestamp) : value);
      if (entry) memory.set(key, entry);
    } catch { return null; }
  }
  return entry && Date.now() - entry.at < maxAge ? entry : null;
}

function write(key, name, rows) {
  const previous = read(key);
  const serialize = (value) => JSON.stringify(value, function (field, item) {
    const original = this[field];
    if (original?.toMillis) return { __dayaniTimestamp: original.toMillis() };
    if (original instanceof Date) return { __dayaniTimestamp: original.getTime() };
    return item;
  });
  let unchanged = false;
  try { unchanged = previous && serialize(previous.rows) === serialize(rows); } catch { }
  const entry = { at: Date.now(), rows };
  memory.set(key, entry);
  try {
    sessionStorage.setItem(key, JSON.stringify(entry, function (field, value) {
      const original = this[field];
      if (original?.toMillis) return { __dayaniTimestamp: original.toMillis() };
      if (original instanceof Date) return { __dayaniTimestamp: original.getTime() };
      return value;
    }));
  } catch { }
  if (unchanged) return;
  for (const subscriber of subscribers) {
    if (subscriber.uid === auth.currentUser?.uid && (subscriber.name === name || subscriber.name === '*')) subscriber.callback(name);
  }
}

export function peekData(name) { return read(cacheKey(name))?.rows ?? null; }
export function subscribeData(name, callback) {
  const subscriber = { name, callback, uid: auth.currentUser?.uid };
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
export function rememberData(name, rows) { write(cacheKey(name), name, rows); }

export function invalidateData(name) {
  const key = cacheKey(name);
  generations.set(key, (generations.get(key) || 0) + 1);
  pending.delete(key);
  memory.delete(key);
  try { sessionStorage.removeItem(key); } catch { }
}

function refreshData(name, loader) {
  const key = cacheKey(name);
  if (pending.has(key)) return pending.get(key);
  const uid = auth.currentUser?.uid;
  const generation = generations.get(key) || 0;
  const request = Promise.resolve().then(loader).then((rows) => {
    if (auth.currentUser?.uid === uid && generation === (generations.get(key) || 0)) write(key, name, rows);
    return rows;
  }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}

export async function cachedData(name, loader, { fresh = false, waitForFresh = false } = {}) {
  const entry = read(cacheKey(name));
  if (!fresh && entry) {
    if (Date.now() - entry.at >= ttl) {
      if (waitForFresh) return refreshData(name, loader);
      refreshData(name, loader).catch(() => {});
    }
    return entry.rows;
  }
  return refreshData(name, loader);
}

export function clearAdminCache() {
  for (const key of pending.keys()) generations.set(key, (generations.get(key) || 0) + 1);
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('dayani-admin-cache-')) sessionStorage.removeItem(key);
  } catch { }
  pending.clear(); memory.clear();
}
