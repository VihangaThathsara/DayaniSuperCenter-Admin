import './main.js';
import { requireAdmin, listenAuth, isAdmin } from './auth.js';
import { renderShell, revealPage } from './ui-shell.js';
import { leavePage } from './page-lifecycle.js';
import { configureCatalogImages } from './catalog-images.js';
import { waitForPageImages } from './page-ready.js';

const routes = {
  'index.html': { title: 'Dashboard', load: () => import('./pages/index-page.js') },
  'products.html': { title: 'Products', load: () => import('./pages/products-page.js') },
  'categories.html': { title: 'Categories', load: () => import('./pages/categories-page.js') },
  'orders.html': { title: 'Orders', load: () => import('./pages/orders-page.js') },
  'customers.html': { title: 'Customers', load: () => import('./pages/customers-page.js') },
  'notifications.html': { title: 'Notifications', load: () => import('./pages/notifications-page.js') },
  'support-chats.html': { title: 'Support Chats', load: () => import('./pages/support-chats-page.js') },
  'reports.html': { title: 'Reports', load: () => import('./pages/reports-page.js') }
};
const modules = new Map();
const user = await requireAdmin();
configureCatalogImages(user.uid);
let activeRoute = '';
let sequence = 0;
function preload(route) {
  if (!modules.has(route)) modules.set(route, routes[route].load().catch((error) => { modules.delete(route); throw error; }));
  return modules.get(route);
}
export async function navigate(route, mode = 'push') {
  if (!routes[route] || (route === activeRoute && mode !== 'refresh')) return;
  const request = ++sequence;
  activeRoute = route;
  document.getElementById('app').dataset.pageLoading = 'true';
  const page = renderShell({ pageTitle: routes[route].title, activePage: route, user });
  page.innerHTML = '<div class="text-secondary py-3">Loading…</div>';
  if (mode === 'push') window.history.pushState({}, '', route);
  document.title = routes[route].title;
  document.getElementById('sidebar')?.classList.remove('mobile-show');
  document.getElementById('overlay')?.classList.remove('show');
  try {
    const module = await preload(route);
    if (request !== sequence) return;
    await module.mount(user);
    if (request !== sequence) return;
    await waitForPageImages(document.getElementById('pageContent'));
    if (request === sequence && mode !== 'refresh') window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    if (request === sequence) {
      const current = document.getElementById('pageContent');
      current.textContent = error?.message || 'Unable to load this page. Please try again.';
    }
  } finally { if (request === sequence) revealPage(); }
}

const routeFromUrl = () => window.location.pathname.split('/').pop() || 'index.html';
document.addEventListener('click', (event) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('a[href]');
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
  const url = new URL(link.href, window.location.href);
  const route = url.pathname.split('/').pop();
  if (url.origin !== window.location.origin || !routes[route]) return;
  event.preventDefault();
  navigate(route);
});
document.addEventListener('pointerover', (event) => {
  const route = event.target.closest?.('a[href]')?.getAttribute('href');
  if (routes[route]) preload(route).catch(() => {});
});
window.addEventListener('popstate', () => navigate(routeFromUrl(), 'pop'));
const stopAuth = listenAuth((current) => { if (!isAdmin(current)) window.location.href = 'signin.html'; });
window.addEventListener('pagehide', () => {
  stopAuth();
  leavePage(document.getElementById('pageContent'));
});
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
await navigate(routeFromUrl() in routes ? routeFromUrl() : 'index.html', 'pop');
const warmPages = () => { for (const route of Object.keys(routes)) preload(route).catch(() => {}); };
if (window.requestIdleCallback) window.requestIdleCallback(warmPages, { timeout: 2000 });
else setTimeout(warmPages, 0);
