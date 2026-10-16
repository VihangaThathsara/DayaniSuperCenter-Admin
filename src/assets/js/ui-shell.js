const logoUrl = new URL('../images/dayani-logo.png', import.meta.url).href;
import { escapeHtml } from './utils.js';
import { APP_NAME } from './firebase-config.js';
import { logoutAdmin } from './auth.js';
import { watchSupportUnreadCount } from './data-service.js';
import { leavePage } from './page-lifecycle.js';

const menu = [
  ['index.html', 'ti-home', 'Dashboard'],
  ['products.html', 'ti-box-seam', 'Products'],
  ['categories.html', 'ti-category', 'Categories'],
  ['orders.html', 'ti-package', 'Orders'],
  ['customers.html', 'ti-users', 'Customers'],
  ['notifications.html', 'ti-bell-ringing', 'Notifications'],
  ['support-chats.html', 'ti-message-circle', 'Support Chats'],
  ['reports.html', 'ti-chart-bar', 'Reports']
];

export function renderShell({ pageTitle, pageSubtitle = '', activePage, user }) {
  const root = document.getElementById('app');
  if (!root.querySelector('#sidebar')) root.innerHTML = `
    <div id="overlay" class="overlay"></div>
    <nav id="topbar" class="navbar bg-white border-bottom fixed-top topbar px-3">
      <button id="toggleBtn" class="d-none d-lg-inline-flex btn btn-light btn-icon btn-sm me-2">
        <i class="ti ti-layout-sidebar-left-expand"></i>
      </button>
      <button id="mobileBtn" class="btn btn-light btn-icon btn-sm d-lg-none me-2">
        <i class="ti ti-layout-sidebar-left-expand"></i>
      </button>
      <div>
        <div class="d-flex align-items-center gap-3">
          <div class="text-end d-none d-md-block">
            <div class="fw-semibold">${escapeHtml(user?.displayName || 'Admin')}</div>
            <div class="small text-secondary">${escapeHtml(user?.email || '')}</div>
          </div>
        </div>
      </div>
    </nav>

    <aside id="sidebar" class="sidebar">
      <div class="logo-area">
        <div><img src="${logoUrl}" alt="Dayani Logo" style="max-width: 50px; height: auto;"></div>
        <div>
          <div class="fw-bold">${APP_NAME}</div>
        </div>
      </div>
      <ul class="nav flex-column py-3">
        <li class="px-4 py-2"><small class="nav-text text-uppercase text-secondary">Management</small></li>
        ${menu.map(([href, icon, label]) => `
          <li><a class="nav-link ${href === activePage ? 'active' : ''}" href="${href}"><i class="ti ${icon}"></i><span class="nav-text d-flex align-items-center justify-content-between w-100">${label}${href === 'support-chats.html' ? '<span id=\"supportUnreadBadge\" class=\"badge rounded-pill text-bg-danger ms-2 d-none\">0</span>' : ''}</span></a></li>
        `).join('')}
        <li class="px-4 pt-4 pb-2"><small class="nav-text text-uppercase text-secondary">Account</small></li>
        <li><button id="logoutBtn" class="nav-link w-100 text-start border-0 bg-transparent"><i class="ti ti-logout"></i><span class="nav-text">Log out</span></button></li>
      </ul>
    </aside>

    <main id="content" class="content py-10">
      <div class="container-fluid">
        <div class="mb-4 page-header">
          <h1 class="fs-3 mb-1">${pageTitle}</h1>
          <p class="text-secondary mb-0">${pageSubtitle}</p>
        </div>
        <div class="page-stage"><div id="pageContent"></div></div>
      </div>
    </main>
  `;

  if (!root.dataset.shellReady) {
    root.dataset.shellReady = 'true';
    document.getElementById('logoutBtn')?.addEventListener('click', logoutAdmin);
    wireSidebar();
    wireSupportBadge();
  }
  document.querySelector('.page-header h1').textContent = pageTitle;
  document.querySelector('.page-header p').textContent = pageSubtitle;
  for (const link of document.querySelectorAll('#sidebar a.nav-link')) link.classList.toggle('active', link.getAttribute('href') === activePage);
  const previous = document.getElementById('pageContent');
  leavePage(previous);
  const page = document.createElement('div');
  page.id = 'pageContent';
  previous.replaceWith(page);
  if (root.dataset.pageLoading === 'true') {
    page.style.visibility = 'hidden';
    page.setAttribute('aria-busy', 'true');
    let loading = document.getElementById('pageLoading');
    if (!loading) {
      loading = document.createElement('div');
      loading.id = 'pageLoading';
      loading.className = 'page-loader';
      loading.setAttribute('role', 'status');
      loading.setAttribute('aria-live', 'polite');
      loading.innerHTML = `
        <div class="page-loader-card">
          <div class="page-loader-mark" aria-hidden="true">
            <span class="page-loader-ring"></span>
            <img src="${logoUrl}" alt="" width="52" height="52">
          </div>
          <div class="page-loader-title">Loading<span class="page-loader-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></div>
          <div class="page-loader-hint">Getting your page ready</div>
        </div>`;
      page.before(loading);
    }
  }
  return page;
}

export function revealPage() {
  const root = document.getElementById('app');
  delete root.dataset.pageLoading;
  document.getElementById('pageLoading')?.remove();
  const page = document.getElementById('pageContent');
  if (page) { page.style.visibility = ''; page.removeAttribute('aria-busy'); }
}

function wireSupportBadge() {
  const badge = document.getElementById('supportUnreadBadge');
  if (!badge) return;
  const stop = watchSupportUnreadCount((count) => {
    badge.textContent = String(count || 0);
    badge.classList.toggle('d-none', !count);
  });
  window.addEventListener('pagehide', stop, { once: true });
}

function wireSidebar() {
  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('content');
  const topbar = document.getElementById('topbar');
  const toggleBtn = document.getElementById('toggleBtn');
  const mobileBtn = document.getElementById('mobileBtn');
  const overlay = document.getElementById('overlay');

  toggleBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
    content?.classList.toggle('full');
    topbar?.classList.toggle('full');
  });

  mobileBtn?.addEventListener('click', () => {
    sidebar?.classList.add('mobile-show');
    overlay?.classList.add('show');
  });

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('mobile-show');
    overlay?.classList.remove('show');
  });
}
