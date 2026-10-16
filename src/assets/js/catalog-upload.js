import { slugify } from './utils.js';

const extensions = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']
]);

export function validateCatalogImage(source, file) {
  if (file) {
    if (!extensions.has(file.type) || file.size <= 0) {
      throw new Error('Choose a valid JPG, PNG, WebP or GIF image.');
    }
    return;
  }
  try {
    const url = new URL(String(source || '').trim());
    if (['https:', 'http:'].includes(url.protocol)) return;
  } catch { }
  throw new Error('Add a valid image URL or upload an image.');
}

export function catalogUploadPath(folder, name, file) {
  const prefix = folder === 'categories' ? 'cat' : 'prod';
  const label = (slugify(name) || 'item').replace(/-/g, '_').slice(0, 60);
  const unique = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${folder}/${prefix}_${label}_${unique}.${extensions.get(file.type)}`;
}
