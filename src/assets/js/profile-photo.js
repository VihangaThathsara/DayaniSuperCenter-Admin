import { getDownloadURL, ref, storage } from './firebase.js';
import { escapeHtml } from './utils.js';
const resolved = new Map();
const pending = new Map();

export function webPhoto(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const profileFields = ['photoStoragePath', 'photoUrl', 'photoURL', 'profileImageUrl', 'profileImage',
  'profilePhoto', 'profilePicture', 'avatarUrl', 'imageUrl', 'userProfileImage'];
function photoValue(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value?.url === 'string' ? value.url.trim()
    : typeof value?.data?.url === 'string' ? value.data.url.trim() : '';
}

export function profilePhotoCandidates(profile, chat = {}) {
  const saved = profile ? profileFields.map(field => photoValue(profile[field])).filter(Boolean) : [];
  const chatPhotos = [chat.userPhotoStoragePath, chat.userProfileImage, chat.photoUrl, chat.photoURL].map(photoValue).filter(Boolean);
  // Explicit empty photo fields represent a removed photo and must not revive an old chat avatar.
  const explicitlyEmpty = profile && profileFields.some(field => Object.hasOwn(profile, field)) && !saved.length;
  const values = explicitlyEmpty ? [] : [...saved, ...chatPhotos];
  return [...new Set(values)];
}

export function profileAvatarMarkup(profile) {
  const uid = String(profile.id || profile.uid || '');
  const name = String(profile.name || profile.fullName || profile.displayName || profile.email || 'Customer');
  return `<span class="customer-avatar-wrap" data-photo-user="${escapeHtml(uid)}">
    <span class="customer-avatar-fallback">${escapeHtml(name.charAt(0).toUpperCase())}</span>
    <img hidden class="customer-avatar" alt="${escapeHtml(name)}" referrerpolicy="no-referrer" />
  </span>`;
}

export function bindCustomerPhotos(container, profiles) {
  const byId = new Map(profiles.map(profile => [String(profile.id || profile.uid || ''), profile]));
  for (const wrapper of container.querySelectorAll('.customer-avatar-wrap')) {
    const profile = byId.get(wrapper.dataset.photoUser);
    if (profile) bindProfilePhoto(wrapper.querySelector('img'), profilePhotoCandidates(profile), wrapper.querySelector('.customer-avatar-fallback'));
  }
}

export async function resolveProfilePhoto(value, refresh = false) {
  const photo = String(value || '').trim();
  const url = webPhoto(photo);
  if (url) return url;
  // Android content:// and file:// URIs only exist on the customer's device.
  if (!photo || (!photo.startsWith('gs://') && !photo.startsWith('users/'))) return '';
  if (!refresh && resolved.has(photo)) return resolved.get(photo);
  if (pending.has(photo)) return pending.get(photo);
  const request = getDownloadURL(ref(storage, photo)).then((value) => {
    const url = webPhoto(value);
    if (url) resolved.set(photo, url);
    return url;
  }).catch(() => '').finally(() => pending.delete(photo));
  pending.set(photo, request);
  return request;
}

function storagePathFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'firebasestorage.googleapis.com') return '';
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    return match ? `gs://${match[1]}/${decodeURIComponent(match[2])}` : '';
  } catch { return ''; }
}

// Try the Storage path and renewed download token before falling back to initials.
export function bindProfilePhoto(img, values, fallback) {
  img.dataset.photoLoading = 'true';
  const candidates = [...values];
  const tried = new Set();
  const renewed = new Set();
  let index = 0;
  const next = async () => {
    img.hidden = true;
    fallback.style.display = 'inline-flex';
    while (index < candidates.length) {
      const candidate = candidates[index++];
      const url = await resolveProfilePhoto(candidate);
      if (!img.isConnected) return;
      if (!url || tried.has(url)) continue;
      tried.add(url);
      img.src = url;
      return;
    }
    img.dataset.photoLoading = 'false';
  };
  img.onload = () => { img.hidden = false; fallback.style.display = 'none'; img.dataset.photoLoading = 'false'; };
  img.onerror = async () => {
    const path = storagePathFromUrl(img.src);
    if (path && !renewed.has(path)) {
      renewed.add(path);
      const url = await resolveProfilePhoto(path, true);
      if (url && !tried.has(url)) candidates.splice(index, 0, url);
    }
    if (img.isConnected) next();
  };
  next();
}
