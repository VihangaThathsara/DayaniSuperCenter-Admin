import { escapeHtml } from './utils.js';

const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="72"%3E%3Crect width="72" height="72" fill="%23f3f3f3"/%3E%3C/svg%3E';
const maxImages = 128;
const maxAge = 30 * 86400000;
let account = 'guest';
let activeDownloads = 0;
const queue = [];
const pending = new Map();
const resolved = new Map();
const elementLoads = new WeakMap();

export function configureCatalogImages(uid) {
  if (account === uid) return;
  for (const url of resolved.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  resolved.clear(); pending.clear(); account = uid;
}

function webUrl(source) {
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function thumbnail(blob) {
  if (typeof createImageBitmap !== 'function') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((result) => resolve(result || blob), 'image/webp', 0.85));
  } finally { bitmap.close(); }
}

function pump() {
  while (activeDownloads < 4 && queue.length) {
    const job = queue.shift();
    activeDownloads++;
    job.run().then(job.finish, () => job.finish(job.url)).finally(() => { activeDownloads--; pump(); });
  }
}

function imageUrl(source, visible = false) {
  const url = webUrl(source);
  if (!url) return Promise.resolve(placeholder);
  if (typeof window === 'undefined' || !window.caches) return Promise.resolve(url);
  const owner = account;
  const key = `${owner}:${url}`;
  if (resolved.has(key)) return Promise.resolve(resolved.get(key));
  if (pending.has(key)) {
    if (visible) {
      const index = queue.findIndex((job) => job.key === key);
      if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
    }
    return pending.get(key);
  }
  const request = new Promise((finish) => {
    const job = { key, url, finish, run: async () => {
      if (owner !== account) return placeholder;
      let cache;
      let blob;
      try {
        cache = await window.caches.open(`dayani-catalog-thumbnails-v1:${owner}`);
        const cached = await cache.match(url);
        if (cached && Date.now() - Number(cached.headers.get('x-dayani-cached-at')) < maxAge) blob = await cached.blob();
      } catch { }
      if (!blob) {
        const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return url;
        blob = await response.blob();
        if (owner !== account) return placeholder;
        if (blob.size <= 5 * 1024 * 1024 && cache) {
          const original = blob;
          try { blob = await thumbnail(blob); } catch { blob = original; }
          try {
            await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type, 'x-dayani-cached-at': String(Date.now()) } }));
            const keys = await cache.keys();
            for (const old of keys.slice(0, Math.max(0, keys.length - maxImages))) await cache.delete(old);
          } catch { }
        }
      }
      if (owner !== account) return placeholder;
      return URL.createObjectURL(blob);
    } };
    visible ? queue.unshift(job) : queue.push(job);
    pump();
  }).then((result) => {
    if (owner !== account) return placeholder;
    resolved.set(key, result);
    if (resolved.size > maxImages) {
      const oldest = resolved.keys().next().value;
      const oldUrl = resolved.get(oldest);
      resolved.delete(oldest);
      if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
    }
    return result;
  }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}

export function warmCatalogImages(rows) {
  if (typeof window === 'undefined' || !window.caches) return;
  for (const row of rows.slice(0, 12)) if (row.imageUrl) imageUrl(row.imageUrl).catch(() => {});
}

export function catalogImageMarkup(source, className, size) {
  const url = webUrl(source);
  const src = resolved.get(`${account}:${url}`) || placeholder;
  return `<img src='${escapeHtml(src)}' data-catalog-image='${escapeHtml(url)}' class='${escapeHtml(className)}' width='${size}' height='${size}' alt='' decoding='async'>`;
}

export function bindCatalogImages(root) {
  let active = true;
  const load = (image) => loadCatalogElement(image, () => active);
  const images = root.querySelectorAll('[data-catalog-image]');
  let observer;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { load(entry.target); observer.unobserve(entry.target); }
    }, { rootMargin: '300px' });
    for (const image of images) observer.observe(image);
  } else for (const image of images) load(image);
  return () => { active = false; observer?.disconnect(); };
}

async function decodeImage(image) {
  if (typeof image.decode === 'function') {
    try { await image.decode(); } catch { }
    return;
  }
  if (image.complete) return;
  await new Promise((resolve) => {
    const done = () => { image.removeEventListener('load', done); image.removeEventListener('error', done); resolve(); };
    image.addEventListener('load', done);
    image.addEventListener('error', done);
  });
}

function loadCatalogElement(image, active = () => true) {
  const source = image.dataset.catalogImage;
  if (!source) return Promise.resolve();
  const previous = elementLoads.get(image);
  if (previous?.source === source && previous.account === account) return previous.promise;
  const request = { source, account };
  image.dataset.catalogLoading = 'true';
  request.promise = imageUrl(source, true).then(async (url) => {
    if (!active() || !image.isConnected || image.dataset.catalogImage !== source || request.account !== account) return;
    image.src = url;
    await decodeImage(image);
  }).finally(() => {
    if (elementLoads.get(image) === request) image.dataset.catalogLoading = 'false';
  });
  elementLoads.set(image, request);
  return request.promise;
}

export function prepareCatalogImageElements(root) {
  return Promise.all([...root.querySelectorAll('[data-catalog-image]')].map((image) => loadCatalogElement(image)));
}
