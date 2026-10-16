import {
  addDoc,
  auth,
  writeBatch,
  collection,
  db,
  deleteDoc,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  onSnapshot,
  ref,
  storage,
  uploadBytes,
  getDownloadURL
} from './firebase.js';
import { slugify } from './utils.js';
import { profilePhotoCandidates, webPhoto } from './profile-photo.js';
import { cachedData, invalidateData, rememberData, peekData } from './data-cache.js';
import { warmCatalogImages } from './catalog-images.js';
import { validateCatalogImage, catalogUploadPath } from './catalog-upload.js';

export const ORDER_STATUSES = Object.freeze(['pending', 'processing', 'shipped', 'delivered']);

export async function fetchProducts() {
  const rows = await cachedData('products', async () => {
    const snapshot = await getDocs(query(collection(db, 'products'), orderBy('name')));
    return snapshot.docs.map(mapDoc);
  });
  warmCatalogImages(rows);
  return rows;
}

export async function saveProduct(payload, file) {
  if (!String(payload.name || '').trim()) throw new Error('Product name is required.');
  const description = String(payload.description || '').trim();
  if (!description) throw new Error('Please enter a product description.');
  if (![Number(payload.price), Number(payload.stock)].every((value) => Number.isFinite(value) && value >= 0)
      || !Number.isInteger(Number(payload.stock))) throw new Error('Enter a valid price and whole-number stock.');
  validateCatalogImage(payload.imageUrl, file);
  const id = payload.id || `${slugify(payload.name) || 'item'}-${crypto.randomUUID()}`;
  let imageUrl = String(payload.imageUrl || '').trim();

  if (file) {
    const fileRef = ref(storage, catalogUploadPath('products', payload.name, file));
    await uploadBytes(fileRef, file, { contentType: file.type });
    imageUrl = await getDownloadURL(fileRef);
  }

  const data = {
    id,
    name: payload.name,
    description,
    price: Number(payload.price || 0),
    stock: Number(payload.stock || 0),
    stockCount: Number(payload.stock || 0),
    categoryId: payload.categoryId || '',
    categoryName: payload.categoryName || '',
    active: payload.active,
    mostPopular: payload.mostPopular,
    imageUrl,
    updatedAt: serverTimestamp()
  };

  if (!payload.id) {
    data.rating = Number(payload.rating || 0);
    data.soldCount = Number(payload.soldCount || 0);
  }
  await setDoc(doc(db, 'products', id), data, { merge: true });
  invalidateData('products');
  return id;
}

export async function deleteProduct(productId) {
  await deleteDoc(doc(db, 'products', productId));
  invalidateData('products');
}

export async function fetchCategories() {
  const rows = await cachedData('categories', async () => {
    const snapshot = await getDocs(query(collection(db, 'categories'), orderBy('name')));
    return snapshot.docs.map(mapDoc);
  });
  warmCatalogImages(rows);
  return rows;
}

export async function saveCategory(payload, file) {
  if (!String(payload.name || '').trim()) throw new Error('Category name is required.');
  const description = String(payload.description || '').trim();
  if (!description) throw new Error('Please enter a category description.');
  validateCatalogImage(payload.imageUrl, file);
  const id = payload.id || `${slugify(payload.name) || 'item'}-${crypto.randomUUID()}`;
  let imageUrl = String(payload.imageUrl || '').trim();

  if (file) {
    const fileRef = ref(storage, catalogUploadPath('categories', payload.name, file));
    await uploadBytes(fileRef, file, { contentType: file.type });
    imageUrl = await getDownloadURL(fileRef);
  }

  await setDoc(doc(db, 'categories', id), {
    id,
    name: payload.name,
    description,
    imageUrl,
    active: payload.active !== false,
    sortOrder: Number(payload.sortOrder || 0),
    updatedAt: serverTimestamp()
  }, { merge: true });
  invalidateData('categories');
  return id;
}

export async function deleteCategory(categoryId) {
  await deleteDoc(doc(db, 'categories', categoryId));
  invalidateData('categories');
}

export async function fetchUsers(options = {}) {
  return cachedData('users', async () => {
    const snapshot = await getDocs(collection(db, 'users'));
    return snapshot.docs.map(mapDoc).sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));
  }, options);
}

export async function fetchOrders() {
  return cachedData('orders', async () => {
  const users = await fetchUsers({ waitForFresh: true });
  const groups = await Promise.all(users.map(async (user) => {
    const rows = await cachedData(`orders:${user.id}`, async () => {
      const snapshot = await getDocs(query(collection(db, 'users', user.id, 'orders'), orderBy('createdAt', 'desc')));
      return snapshot.docs.map(mapDoc);
    }, { waitForFresh: true });
    return rows.map((order) => ({ ...order, user }));
  }));
  const orders = groups.flat();
  return orders.sort((a, b) => toMillis(b.createdAt || b.createdAtClient) - toMillis(a.createdAt || a.createdAtClient));
  });
}

export function watchOrders(callback, onError = console.error) {
  const cached = peekData('orders');
  if (cached) callback(cached);
  let usersReady = false;
  const awaiting = new Set();
  // Orders change inside subcollections, independently of the user document.
  const listeners = new Map();
  const users = new Map();
  const ordersByUser = new Map();
  const publish = () => {
    if (!usersReady || awaiting.size) return;
    const rows = [...ordersByUser.entries()].flatMap(([uid, orders]) =>
      orders.map((order) => ({ ...order, user: users.get(uid) })));
    rows.sort((a, b) => toMillis(b.createdAt || b.createdAtClient) - toMillis(a.createdAt || a.createdAtClient));
    rememberData('orders', rows);
    callback(rows);
  };
  const stopUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
    rememberData('users', snapshot.docs.map(mapDoc));
    usersReady = true;
    const ids = new Set(snapshot.docs.map((item) => item.id));
    for (const uid of ids) if (!listeners.has(uid)) awaiting.add(uid);
    for (const [uid, stop] of listeners) {
      if (!ids.has(uid)) {
        stop();
        listeners.delete(uid);
        ordersByUser.delete(uid);
        awaiting.delete(uid);
        users.delete(uid);
      }
    }
    for (const item of snapshot.docs) {
      users.set(item.id, mapDoc(item));
      if (listeners.has(item.id)) continue;
      listeners.set(item.id, onSnapshot(collection(db, 'users', item.id, 'orders'), (orders) => {
        const rows = orders.docs.map(mapDoc);
        rememberData(`orders:${item.id}`, rows);
        ordersByUser.set(item.id, rows);
        awaiting.delete(item.id);
        publish();
      }, (error) => {
        awaiting.delete(item.id);
        publish();
        onError(error);
      }));
    }
    publish();
  }, onError);
  return () => {
    stopUsers();
    for (const stop of listeners.values()) stop();
    listeners.clear();
  };
}

export async function updateOrderStatus(userId, orderId, status) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error('Invalid order status.');
  }
  const orderRef = doc(db, 'users', userId, 'orders', orderId);
  const notificationRef = doc(collection(db, 'users', userId, 'notifications'));
  const message = `Your order ${orderId} is now ${status}.`;
  const changed = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists()) throw new Error('Order not found.');
    const currentStatus = String(snapshot.data().status || 'pending').trim().toLowerCase();
    const currentIndex = ORDER_STATUSES.indexOf(currentStatus);
    if (currentIndex < 0) throw new Error('The current order status is invalid.');
    if (currentStatus === status) return false;
    if (currentStatus === 'delivered') {
      throw new Error('Delivered orders are complete and their status cannot be changed.');
    }
    if (ORDER_STATUSES.indexOf(status) < currentIndex) {
      throw new Error('Order status cannot move back to an earlier stage.');
    }
    transaction.update(orderRef, {
      status, updatedAt: serverTimestamp(), statusUpdatedAt: serverTimestamp(),
      [`statusHistory.${status}`]: serverTimestamp()
    });
    transaction.set(notificationRef, {
      title: 'Order status updated', message, type: 'order', read: false,
      orderId, createdAt: serverTimestamp(), createdAtClient: new Date()
    });
    transaction.set(doc(db, 'users', userId), {
      latestNotificationTitle: 'Order status updated', latestNotificationMessage: message,
      latestNotificationType: 'order', latestNotificationOrderId: orderId,
      latestNotificationAtClient: new Date(), hasUnreadNotifications: true
    }, { merge: true });
    return true;
  });
  if (!changed) return;
  invalidateData('orders');
  invalidateData(`orders:${userId}`);
  invalidateData('users');
}

export async function sendNotificationToAll(title, message) {
  const users = await fetchUsers({fresh: true});
  await Promise.all(users.map((user) => pushNotification(user.id, title, message)));
}

export async function sendNotificationToSelected(userIds, title, message) {
  await Promise.all(userIds.map((userId) => pushNotification(userId, title, message)));
}

export async function buildDashboardData() {
  const usersRequest = fetchUsers();
  const [users, products, categories, orders] = await Promise.all([
    usersRequest,
    fetchProducts(),
    fetchCategories(),
    usersRequest.then(fetchOrders)
  ]);
  return summarizeDashboardData({ users, products, categories, orders });
}

export function summarizeDashboardData({ users, products, categories, orders }) {
  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingOrders = orders.filter((order) => order.status !== 'delivered').length;
  const lowStockCount = products.filter((product) => Number(product.stock ?? product.stockCount ?? 0) <= 5).length;

  const ordersByStatus = ['pending', 'processing', 'shipped', 'delivered'].map((status) => ({
    status,
    count: orders.filter((order) => (order.status || 'pending') === status).length
  }));

  const dailySalesMap = new Map();
  orders.forEach((order) => {
    const date = new Date(toMillis(order.createdAt || order.createdAtClient));
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    dailySalesMap.set(key, (dailySalesMap.get(key) || 0) + Number(order.total || 0));
  });

  const dailySales = [...dailySalesMap.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .slice(-7)
    .map(([date, total]) => ({ date, total }));

  return {
    users,
    products,
    categories,
    orders,
    totalRevenue,
    pendingOrders,
    lowStockCount,
    ordersByStatus,
    dailySales
  };
}

function mapDoc(snapshot) {
  return { ...snapshot.data(), id: snapshot.id };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  return new Date(value).getTime() || 0;
}

async function pushNotification(userId, title, message) {
  const createdAtClient = new Date();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'users', userId, 'notifications')), {
    title, message, type: 'admin', read: false,
    createdAt: serverTimestamp(), createdAtClient
  });
  batch.set(doc(db, 'users', userId), {
    latestNotificationTitle: title, latestNotificationMessage: message,
    latestNotificationType: 'admin', latestNotificationAtClient: createdAtClient,
    hasUnreadNotifications: true
  }, { merge: true });
  await batch.commit();
  invalidateData('users');
}


export function watchSupportChats(callback, onError = console.error) {
  const cached = peekData('support-chats');
  if (cached) callback(cached);
  let chats = [];
  const profiles = new Map();
  const listeners = new Map();
  const publish = () => {
    const rows = chats.map((chat) => {
      const profile = profiles.get(chat.userId);
      const candidates = profilePhotoCandidates(profile, chat);
      return {
        ...chat,
        userName: profile?.name || profile?.fullName || profile?.displayName || chat.userName,
        userEmail: profile?.email || chat.userEmail,
        userProfileImage: candidates.map(webPhoto).find(Boolean) || '',
        photoCandidates: candidates
      };
    });
    rememberData('support-chats', rows);
    callback(rows);
  };
  const stopChats = onSnapshot(query(collection(db, 'support_chats'), orderBy('lastMessageAtClient', 'desc')), (snapshot) => {
    chats = snapshot.docs.map((item) => ({ ...mapDoc(item), userId: item.id }));
    const ids = new Set(chats.map((chat) => chat.userId));
    for (const [uid, stop] of listeners) {
      if (!ids.has(uid)) {
        stop(); listeners.delete(uid); profiles.delete(uid);
      }
    }
    for (const uid of ids) {
      if (listeners.has(uid)) continue;
      listeners.set(uid, onSnapshot(doc(db, 'users', uid), (snapshot) => {
        profiles.set(uid, snapshot.exists() ? snapshot.data() : null);
        publish();
      }, onError));
    }
    publish();
  }, onError);
  return () => {
    stopChats();
    for (const stop of listeners.values()) stop();
    listeners.clear();
  };
}

export function watchSupportMessages(userId, callback, onError = console.error) {
  const q = query(collection(db, 'support_chats', userId, 'messages'), orderBy('createdAtClient', 'asc'));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(mapDoc)), onError);
}

export async function sendSupportReply(userId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Message is empty.');
  const thread = doc(db, 'support_chats', userId);
  const messageRef = doc(collection(thread, 'messages'));
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(thread);
    const conversationId = snapshot.data()?.activeConversationId || 'legacy';
    transaction.set(messageRef, {
      text: trimmed, senderType: 'admin', senderId: auth.currentUser?.uid || 'admin',
      senderEmail: auth.currentUser?.email || 'admin', conversationId,
      createdAt: serverTimestamp(), createdAtClient: new Date()
    });
    transaction.set(thread, {
      userId, lastMessage: trimmed, lastMessageAt: serverTimestamp(),
      lastMessageAtClient: new Date(), lastSenderType: 'admin',
      unreadForAdminCount: 0, unreadForUserCount: increment(1), updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

export async function markSupportChatReadByAdmin(userId) {
  const thread = doc(db, 'support_chats', userId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(thread);
    if (snapshot.exists() && Number(snapshot.data()?.unreadForAdminCount || 0) > 0) {
      transaction.update(thread, { unreadForAdminCount: 0 });
    }
  });
}

export function watchSupportUnreadCount(callback) {
  const q = query(collection(db, 'support_chats'), where('unreadForAdminCount', '>', 0));
  return onSnapshot(q, (snapshot) => {
    let total = 0;
    snapshot.forEach((doc) => {
      total += Number(doc.data()?.unreadForAdminCount || 0);
    });
    callback(total);
  });
}
