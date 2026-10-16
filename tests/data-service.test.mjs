import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

// Exercise real application modules against a small Firestore adapter.
// These tests do not connect to or modify the live Firebase project.
const watchers = new Map();
const writes = [];
const commits = [];
let sequence = 0;
let clockOffset = 0;
class TestDate extends Date { static now() { return Date.now() + clockOffset; } }
class MemoryStorage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = value; }
  removeItem(key) { delete this[key]; }
}
const sessions = new MemoryStorage();
const reads = [];
let readData = new Map();
let getDocsImpl = async (reference) => ({ docs: readData.get(reference.path) || [] });
const threads = new Map([['support_chats/u1', { activeConversationId: 'session-after-reset' }]]);
let retryOrderTransaction = null;
const storageReads = [];
const uploads = [];
let uploadError = null;

const pathRef = (parent, ...parts) => ({ path: [parent.path || '', ...parts].filter(Boolean).join('/') });
const firebase = {
  db: { path: '' }, storage: { path: '' },
  auth: { currentUser: { uid: 'admin-uid', email: 'admin@example.test' } },
  collection: pathRef,
  doc: (parent, ...parts) => pathRef(parent, ...(parts.length ? parts : [`new-${++sequence}`])),
  query: (ref) => ref, orderBy: () => ({}), where: () => ({}),
  serverTimestamp: () => 'SERVER_TIME', increment: (amount) => ({ increment: amount }),
  addDoc: async () => {}, deleteDoc: async () => {}, updateDoc: async () => {},
  getDoc: async (ref) => ({ exists: () => threads.has(ref.path), data: () => threads.get(ref.path) }),
  getDocs: async (ref) => { reads.push(ref.path); return getDocsImpl(ref); },
  runTransaction: async (_, action) => {
    const ops = [];
    const transaction = {
      get: firebase.getDoc,
      set: (ref, data, options) => ops.push({ type: 'set', ref, data, options }),
      update: (ref, data) => ops.push({ type: 'update', ref, data })
    };
    let result = await action(transaction);
    if (retryOrderTransaction && ops.some(op => /\/orders\/[^/]+$/.test(op.ref.path))) {
      const retry = retryOrderTransaction;
      retryOrderTransaction = null;
      retry();
      ops.length = 0;
      result = await action(transaction);
    }
    for (const op of ops) {
      if (/\/orders\/[^/]+$/.test(op.ref.path)) {
        threads.set(op.ref.path, { ...threads.get(op.ref.path), ...op.data });
      }
    }
    commits.push(ops);
    return result;
  },
  setDoc: async (ref, data, options) => writes.push({ ref, data, options }),
  onSnapshot: (ref, callback, error) => {
    const entry = { callback, error, active: true };
    if (!watchers.has(ref.path)) watchers.set(ref.path, []);
    watchers.get(ref.path).push(entry);
    return () => { entry.active = false; };
  },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data, options) => ops.push({ type: 'set', ref, data, options }),
      update: (ref, data) => ops.push({ type: 'update', ref, data }),
      commit: async () => commits.push(ops)
    };
  },
  ref: pathRef, uploadBytes: async (ref, file, metadata) => { if (uploadError) throw uploadError; uploads.push({ ref, file, metadata }); },
  getDownloadURL: async (ref) => { storageReads.push(ref.path); return `https://cdn.example.test/${ref.path}`; }
};
const context = vm.createContext({ console, URL, Date: TestDate, Intl, crypto: webcrypto, sessionStorage: sessions });
const modules = new Map();
const root = resolve('src/assets/js');
const config = { CURRENCY: 'LKR' };

async function moduleAt(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let module;
  const mock = (filename.endsWith('/firebase.js') || filename.endsWith('/firebase-core.js')) ? firebase : filename.endsWith('/firebase-config.js') ? config : null;
  if (mock) {
    module = new vm.SyntheticModule(Object.keys(mock), function () {
      for (const [key, value] of Object.entries(mock)) this.setExport(key, value);
    }, { context, identifier: filename });
  } else {
    module = new vm.SourceTextModule(await readFile(filename, 'utf8'), { context, identifier: filename });
  }
  modules.set(filename, module);
  await module.link((specifier) => moduleAt(resolve(dirname(filename), specifier)));
  return module;
}
const module = await moduleAt(resolve(root, 'data-service.js'));
await module.evaluate();
const service = module.namespace;
const photo = modules.get(resolve(root, 'profile-photo.js')).namespace;
const cache = modules.get(resolve(root, 'data-cache.js')).namespace;
const utils = modules.get(resolve(root, 'utils.js')).namespace;
const document = (id, data = {}) => ({ id, data: () => data, exists: () => true });
const emit = async (path, snapshot) => {
  for (const watcher of watchers.get(path) || []) if (watcher.active) watcher.callback(snapshot);
  await new Promise((done) => setImmediate(done));
};
let passed = 0;
async function check(name, run) {
  await run(); passed++;
  console.log(`PASS ${name}`);
}

await check('new category is compatible with mobile active filter', async () => {
  await service.saveCategory({ name: 'Fruit', description: 'Fresh fruit', imageUrl: 'https://cdn.example.test/fruit.png' });
  assert.equal(writes.at(-1).data.active, true);
  assert.equal(writes.at(-1).data.sortOrder, 0);
});
await check('product edits preserve existing sales and rating', async () => {
  await service.saveProduct({description:'Fresh apples', imageUrl:'https://cdn.example.test/apple.png',  id: 'p1', name: 'Apple', price: 100, stock: 9 });
  assert.ok(!('soldCount' in writes.at(-1).data));
  assert.ok(!('rating' in writes.at(-1).data));
});
await check('duplicate names create distinct products', async () => {
  const first = await service.saveProduct({description:'Fresh apples', imageUrl:'https://cdn.example.test/apple.png',  name: 'Apple', price: 100, stock: 9 });
  const second = await service.saveProduct({description:'Fresh apples', imageUrl:'https://cdn.example.test/apple.png',  name: 'Apple', price: 100, stock: 9 });
  assert.notEqual(first, second);
});
await check('negative stock is rejected before a write', async () => {
  await assert.rejects(service.saveProduct({description:'Fresh apples', imageUrl:'https://cdn.example.test/apple.png',  name: 'Apple', price: 100, stock: -1 }));
});
await check('local, malformed, and executable photo URLs are rejected', async () => {
  for (const value of ['content://media/5', 'file:///a.jpg', 'javascript:alert(1)', 'broken']) {
    assert.equal(photo.webPhoto(value), '');
    assert.equal(await photo.resolveProfilePhoto(value), '');
  }
});
await check('Storage profile paths resolve to a browser URL', async () => {
  assert.equal(await photo.resolveProfilePhoto('users/u1/profile/p.jpg'), 'https://cdn.example.test/users/u1/profile/p.jpg');
});
await check('chat uses current profile and reacts to photo removal', async () => {
  let rows;
  const stop = service.watchSupportChats((value) => { rows = value; });
  await emit('support_chats', { docs: [document('u1', { userId: 'wrong', userProfileImage: 'content://media/5' })] });
  await emit('users/u1', document('u1', { name: 'Customer', photoUrl: 'https://cdn.example.test/new.jpg' }));
  assert.equal(rows[0].userId, 'u1');
  assert.equal(rows[0].userProfileImage, 'https://cdn.example.test/new.jpg');
  await emit('users/u1', document('u1', { name: 'Customer' }));
  assert.equal(rows[0].userProfileImage, '');
  stop();
  assert.ok(watchers.get('users/u1').every((entry) => !entry.active));
});
await check('order updates arrive without changing the user document', async () => {
  let rows;
  const stop = service.watchOrders((value) => { rows = value; });
  await emit('users', { docs: [document('u2', { id: 'wrong', name: 'Second customer' })] });
  await emit('users/u2/orders', { docs: [document('o1', { id: 'wrong', status: 'pending', createdAtClient: 10 })] });
  assert.equal(rows[0].id, 'o1');
  assert.equal(rows[0].user.id, 'u2');
  await emit('users/u2/orders', { docs: [document('o1', { status: 'shipped', createdAtClient: 10 })] });
  assert.equal(rows[0].status, 'shipped');
  await emit('users', { docs: [] });
  assert.equal(rows.length, 0);
  assert.ok(watchers.get('users/u2/orders').every((entry) => !entry.active));
  stop();
});
await check('reply and unread metadata commit together with real admin identity', async () => {
  await service.sendSupportReply('u1', ' Hello ');
  const batch = commits.at(-1);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].data.text, 'Hello');
  assert.equal(batch[0].data.senderId, 'admin-uid');
  assert.equal(batch[0].data.conversationId, 'session-after-reset');
  assert.equal(batch[1].ref.path, 'support_chats/u1');
});
await check('order status, timestamps and notification commit together', async () => {
  threads.set('users/u2/orders/o1', { status: 'processing' });
  await service.updateOrderStatus('u2', 'o1', 'shipped');
  const batch = commits.at(-1);
  assert.equal(batch.length, 3);
  assert.equal(batch[0].data['statusHistory.shipped'], 'SERVER_TIME');
  assert.equal(batch[0].data.statusUpdatedAt, 'SERVER_TIME');
  await assert.rejects(service.updateOrderStatus('u2', 'o1', 'invalid'));
});
await check('order stages can advance but can never move backwards', async () => {
  const statuses = ['pending', 'processing', 'shipped', 'delivered'];
  for (let from = 0; from < statuses.length; from++) {
    for (let to = 0; to < statuses.length; to++) {
      threads.set('users/status-user/orders/status-order', { status: statuses[from] });
      const before = commits.length;
      if (to < from) {
        await assert.rejects(service.updateOrderStatus('status-user', 'status-order', statuses[to]),
          /earlier stage|Delivered orders/);
        assert.equal(commits.length, before);
        assert.equal(threads.get('users/status-user/orders/status-order').status, statuses[from]);
      } else {
        await service.updateOrderStatus('status-user', 'status-order', statuses[to]);
        assert.equal(commits.at(-1).length, to === from ? 0 : 3);
        assert.equal(threads.get('users/status-user/orders/status-order').status, statuses[to]);
      }
    }
  }
});
await check('repeating a delivered status creates no duplicate notification or timestamps', async () => {
  const saved = { status: 'delivered', statusUpdatedAt: 'ORIGINAL_TIME', statusHistory: { delivered: 'ORIGINAL_TIME' } };
  threads.set('users/repeat-user/orders/done', saved);
  await service.updateOrderStatus('repeat-user', 'done', 'delivered');
  assert.equal(commits.at(-1).length, 0);
  assert.equal(threads.get('users/repeat-user/orders/done'), saved);
});
await check('stale admin requests are rejected after another admin delivers the order', async () => {
  threads.set('users/race-user/orders/race-order', { status: 'pending' });
  retryOrderTransaction = () => threads.set('users/race-user/orders/race-order', { status: 'delivered' });
  const before = commits.length;
  await assert.rejects(service.updateOrderStatus('race-user', 'race-order', 'processing'), /Delivered orders/);
  assert.equal(commits.length, before);
  assert.equal(threads.get('users/race-user/orders/race-order').status, 'delivered');
});
await check('missing orders cannot create notifications or update customer badges', async () => {
  const before = commits.length;
  await assert.rejects(service.updateOrderStatus('missing-user', 'missing-order', 'processing'), /Order not found/);
  assert.equal(commits.length, before);
});
await check('customer HTML and unknown statuses cannot inject markup', async () => {
  assert.equal(utils.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.ok(!utils.statusBadge('<img src=x>').includes('<img'));
});
await check('photo candidates recover from invalid URL using Storage path', async () => {
  const values = photo.profilePhotoCandidates({photoUrl: 'content://media/5', photoStoragePath: 'users/u3/profile/p.jpg'});
  assert.equal(values[0], 'users/u3/profile/p.jpg');
  assert.equal(await photo.resolveProfilePhoto(values[0]), 'https://cdn.example.test/users/u3/profile/p.jpg');
  const count = storageReads.length;
  await Promise.all([photo.resolveProfilePhoto(values[0]), photo.resolveProfilePhoto(values[0])]);
  assert.equal(storageReads.length, count);
  await photo.resolveProfilePhoto(values[0], true);
  assert.equal(storageReads.length, count + 1);
});
await check('concurrent and repeated product reads are cached; edits invalidate them', async () => {
  cache.clearAdminCache(); reads.length = 0;
  readData.set('products', [document('p1', {name: 'Apple'})]);
  const [a,b] = await Promise.all([service.fetchProducts(), service.fetchProducts()]);
  await service.fetchProducts();
  assert.equal(reads.filter(path => path === 'products').length, 1);
  assert.equal(a[0].id, b[0].id);
  await service.saveProduct({description:'Fresh apples', imageUrl:'https://cdn.example.test/apple.png', id:'p1', name:'Apple', price:100, stock:4});
  await service.fetchProducts();
  assert.equal(reads.filter(path => path === 'products').length, 2);
  clockOffset += 16000;
  await service.fetchProducts();
  assert.equal(reads.filter(path => path === 'products').length, 3);
});
await check('cache isolates accounts and preserves Firestore timestamp dates', async () => {
  cache.clearAdminCache();
  cache.rememberData('dated', [{createdAt: {toMillis: () => 1234567}}]);
  const rows = await cache.cachedData('dated', () => { throw Error('should use cache'); });
  assert.equal(rows[0].createdAt.toMillis(), 1234567);
  const cold = new vm.SourceTextModule(await readFile(resolve(root, 'data-cache.js'), 'utf8'), {context, identifier: resolve(root, 'cold-cache.js')});
  await cold.link(specifier => moduleAt(resolve(root, specifier)));
  await cold.evaluate();
  const restored = await cold.namespace.cachedData('dated', () => { throw Error('should restore saved cache'); });
  assert.equal(restored[0].createdAt.getTime(), 1234567);
  firebase.auth.currentUser = {uid:'another-admin'};
  const other = await cache.cachedData('dated', async () => [{id:'other'}]);
  assert.equal(other[0].id, 'other');
  firebase.auth.currentUser = {uid:'admin-uid', email:'admin@example.test'};
});
await check('invalidated in-flight read cannot overwrite newer cached results', async () => {
  let finish;
  const first = cache.cachedData('race', () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  cache.invalidateData('race');
  await cache.cachedData('race', async () => ['new']);
  finish(['old']); await first;
  assert.equal((await cache.cachedData('race', () => { throw Error('cache missing'); }))[0], 'new');
});
await check('dashboard reads each user once and fetches users orders in parallel', async () => {
  cache.clearAdminCache(); reads.length = 0;
  readData.set('users', [document('parallel-a', {name:'A'}), document('parallel-b', {name:'B'})]);
  let active = 0, maximum = 0;
  const previous = getDocsImpl;
  getDocsImpl = async (ref) => {
    if (ref.path.endsWith('/orders')) {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setImmediate(resolve)); --active;
      return {docs:[document('order-' + ref.path, {total:100, createdAtClient:1000})]};
    }
    return previous(ref);
  };
  const data = await service.buildDashboardData();
  assert.equal(reads.filter(path => path === 'users').length, 1);
  assert.equal(maximum, 2);
  assert.equal(data.orders.length, 2);
  getDocsImpl = previous;
});
await check('admin replies before the first reset remain visible as legacy messages', async () => {
  threads.delete('support_chats/u1');
  await service.sendSupportReply('u1', 'Legacy reply');
  assert.equal(commits.at(-1)[0].data.conversationId, 'legacy');
});
await check('mark-read avoids writes for empty or missing threads', async () => {
  await service.markSupportChatReadByAdmin('missing');
  assert.equal(commits.at(-1).length, 0);
  threads.set('support_chats/u1', {unreadForAdminCount:0});
  await service.markSupportChatReadByAdmin('u1');
  assert.equal(commits.at(-1).length, 0);
  threads.set('support_chats/u1', {unreadForAdminCount:2});
  await service.markSupportChatReadByAdmin('u1');
  assert.equal(commits.at(-1)[0].data.unreadForAdminCount, 0);
});
await check('stale cached rows appear before the background network read finishes', async () => {
  cache.rememberData('slow', ['cached']); clockOffset += 16000;
  let finish;
  const rows = await cache.cachedData('slow', () => new Promise(resolve => {finish = resolve;}));
  assert.equal(rows[0], 'cached');
  assert.equal(cache.peekData('slow')[0], 'cached');
  finish(['updated']); await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.peekData('slow')[0], 'updated');
});
await check('cached order rows stay visible until all initial listeners answer', async () => {
  cache.rememberData('orders', [{id:'cached-order'}]);
  const emissions = [];
  const stop = service.watchOrders(rows => emissions.push(rows));
  assert.equal(emissions[0][0].id, 'cached-order');
  await emit('users', {docs:[document('initial-a'), document('initial-b')]});
  await emit('users/initial-a/orders', {docs:[document('first-order')]});
  assert.equal(emissions.length, 1);
  await emit('users/initial-b/orders', {docs:[document('second-order')]});
  assert.equal(emissions.at(-1).length, 2); stop();
});
await check('failed initial order listener does not block other customers updates', async () => {
  let rows; const errors = [];
  const stop = service.watchOrders(value => {rows = value;}, error => errors.push(error));
  await emit('users', {docs:[document('error-a'), document('error-b')]});
  await emit('users/error-a/orders', {docs:[document('visible-order')]});
  for (const watcher of watchers.get('users/error-b/orders')) if (watcher.active) watcher.error(Error('denied'));
  assert.equal(rows[0].id, 'visible-order'); assert.equal(errors.length, 1); stop();
});
await check('expired aggregate orders cache refreshes from updated customer orders', async () => {
  cache.clearAdminCache(); reads.length = 0;
  readData.set('users', [document('refresh-u', {name:'Refresh customer'})]);
  readData.set('users/refresh-u/orders', [document('refresh-o', {status:'pending',total:100})]);
  await service.fetchOrders();
  readData.set('users/refresh-u/orders', [document('refresh-o', {status:'shipped',total:200})]);
  clockOffset += 16000;
  const immediate = await service.fetchOrders();
  assert.equal(immediate[0].total, 100);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.peekData('orders')[0].status, 'shipped');
  assert.equal(cache.peekData('orders')[0].total, 200);
});
await check('orders background refresh includes newly added customers', async () => {
  cache.clearAdminCache();
  readData.set('users', [document('old-u')]);
  readData.set('users/old-u/orders', [document('old-o', {total:100})]);
  await service.fetchOrders();
  readData.set('users', [document('old-u'), document('new-u')]);
  readData.set('users/new-u/orders', [document('new-o', {total:200})]);
  clockOffset += 16000;
  const cached = await service.fetchOrders();
  assert.equal(cached.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.peekData('orders').length, 2);
});
await check('legacy profile aliases and missing profile photos recover without reviving an explicitly removed photo', async () => {
  assert.deepEqual(Array.from(photo.profilePhotoCandidates({profileImageUrl: 'https://cdn.example.test/legacy.jpg'})), ['https://cdn.example.test/legacy.jpg']);
  assert.deepEqual(Array.from(photo.profilePhotoCandidates({name: 'Legacy'}, {userProfileImage:'https://cdn.example.test/chat.jpg'})), ['https://cdn.example.test/chat.jpg']);
  assert.deepEqual(Array.from(photo.profilePhotoCandidates({photoUrl:'', photoStoragePath:''}, {userProfileImage:'https://cdn.example.test/old.jpg'})), []);
  assert.deepEqual(Array.from(photo.profilePhotoCandidates({profilePicture:{data:{url:'https://cdn.example.test/nested.jpg'}}})), ['https://cdn.example.test/nested.jpg']);
});
await check('selected notifications atomically publish unread document and matching badge metadata', async () => {
  const before = commits.length;
  await service.sendNotificationToSelected(['u1'], 'Promotion', 'Hello');
  const ops = commits[before];
  assert.equal(ops.length, 2);
  assert.equal(ops[0].data.read, false);
  assert.equal(ops[0].data.type, 'admin');
  assert.equal(ops[1].data.hasUnreadNotifications, true);
  assert.equal(ops[0].data.createdAtClient, ops[1].data.latestNotificationAtClient);
});

await check('product and category descriptions are required before any upload or write', async () => {
  const before = writes.length, uploaded = uploads.length;
  const file = { name: 'image.png', type: 'image/png', size: 12 };
  for (const description of ['', '   ']) {
    await assert.rejects(service.saveProduct({name:'Rice', description, price:450, stock:5}, file), /product description/);
    await assert.rejects(service.saveCategory({name:'Grocery', description}, file), /category description/);
  }
  assert.equal(writes.length, before); assert.equal(uploads.length, uploaded);
});
await check('a missing or invalid catalog image cannot create a product or category', async () => {
  const before = writes.length;
  for (const imageUrl of ['', '   ', 'broken', 'javascript:alert(1)', 'content://media/5']) {
    await assert.rejects(service.saveProduct({name:'Rice', description:'Rice pack', price:450, stock:5, imageUrl}), /image/);
    await assert.rejects(service.saveCategory({name:'Grocery', description:'Groceries', imageUrl}), /image/);
  }
  assert.equal(writes.length, before);
});
await check('empty and unsupported image uploads are rejected before storage or document writes', async () => {
  const before = writes.length, uploaded = uploads.length;
  for (const file of [{type:'text/plain',size:12}, {type:'image/png',size:0}, {type:'image/svg+xml',size:12}]) {
    await assert.rejects(service.saveProduct({name:'Rice', description:'Rice pack', price:450, stock:5}, file), /valid JPG/);
    await assert.rejects(service.saveCategory({name:'Grocery', description:'Groceries'}, file), /valid JPG/);
  }
  assert.equal(writes.length, before); assert.equal(uploads.length, uploaded);
});
await check('a product upload uses a short unique storage name, correct MIME and the SDK download URL', async () => {
  const file={name:'very long original file name.jpg',type:'image/jpeg',size:123};
  const id=await service.saveProduct({name:'TEST Rice',description:'Rice pack',price:450,stock:5,categoryId:'grocery',active:true},file);
  const upload=uploads.at(-1), saved=writes.at(-1);
  assert.match(upload.ref.path, /^products\/prod_test_rice_[a-f0-9]{12}\.jpg$/);
  assert.equal(upload.metadata.contentType,'image/jpeg');assert.equal(saved.data.imageUrl,'https://cdn.example.test/'+upload.ref.path);
  assert.equal(saved.data.id,id);assert.equal(saved.data.description,'Rice pack');assert.equal(saved.data.rating,0);assert.equal(saved.data.soldCount,0);
});
await check('category uploads persist the required description and keep distinct paths for duplicate names', async () => {
  const file={name:'photo.png',type:'image/png',size:123};
  const first=await service.saveCategory({name:'TEST Grocery',description:'Groceries'},file);
  const path=uploads.at(-1).ref.path;
  assert.match(path,/^categories\/cat_test_grocery_[a-f0-9]{12}\.png$/);
  assert.equal(writes.at(-1).data.description,'Groceries');assert.equal(writes.at(-1).data.imageUrl,'https://cdn.example.test/'+path);
  const second=await service.saveCategory({name:'TEST Grocery',description:'Other groceries'},file);
  assert.notEqual(first,second);assert.notEqual(path,uploads.at(-1).ref.path);
});
await check('editing keeps the existing image URL without re-uploading and preserves rating and sales', async () => {
  const before=uploads.length;
  await service.saveProduct({id:'existing',name:'Rice',description:' Updated rice ',price:450,stock:5,imageUrl:' https://cdn.example.test/existing.png ',active:true});
  assert.equal(uploads.length,before);assert.equal(writes.at(-1).data.imageUrl,'https://cdn.example.test/existing.png');
  assert.equal(writes.at(-1).data.description,'Updated rice');assert.ok(!('rating' in writes.at(-1).data));assert.ok(!('soldCount' in writes.at(-1).data));
  await service.saveCategory({id:'existing-category',name:'Grocery',description:'Updated groceries',imageUrl:'https://cdn.example.test/category.png'});
  assert.equal(uploads.length,before);assert.equal(writes.at(-1).ref.path,'categories/existing-category');
});
await check('a failed upload never saves a new catalog document', async () => {
  const before=writes.length;uploadError=new Error('Upload failed');
  try {
    await assert.rejects(service.saveProduct({name:'Rice',description:'Rice pack',price:450,stock:5},{type:'image/jpeg',size:12}),/Upload failed/);
    await assert.rejects(service.saveCategory({name:'Grocery',description:'Groceries'},{type:'image/png',size:12}),/Upload failed/);
  } finally {uploadError=null;}
  assert.equal(writes.length,before);
});
console.log(`${passed} regression checks passed (mocked Firebase).`);
