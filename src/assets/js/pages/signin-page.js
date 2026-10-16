const logoUrl = new URL('../../images/dayani-logo.png', import.meta.url).href;
import '../main.js';
import { APP_NAME, ADMIN_EMAIL } from '../firebase-config.js';
import { listenAuth, isAdmin, loginAdmin } from '../auth.js';

const root = document.getElementById('app');
root.innerHTML = `
  <div class="container d-flex align-items-center justify-content-center min-vh-100 py-5">
    <div class="card shadow-sm border-0 auth-card">
      <div class="card-body p-5">
        <div class="text-center mb-4">
          <div class="text-center mb-3">
            <img src="${logoUrl}" alt="Dayani Logo" style="max-width: 180px; height: auto;">
          </div>
          <h1 class="h4 mb-2">${APP_NAME}</h1>
          <p class="text-secondary mb-0">Sign in with the single admin account to manage products, orders, customers and reports.</p>
        </div>

        <form id="loginForm" class="d-grid gap-3">
          <div>
            <label class="form-label">Email address</label>
            <input id="email" type="email" class="form-control" required>
          </div>
          <div>
            <label class="form-label">Password</label>
            <input id="password" type="password" class="form-control" required>
          </div>
          <button id="loginBtn" class="btn btn-primary w-100" type="submit">Sign in</button>
          <div id="loginAlert"></div>
        </form>
      </div>
    </div>
  </div>
`;

listenAuth((user) => {
  if (user && isAdmin(user)) {
    window.location.href = 'index.html';
  }
});

const form = document.getElementById('loginForm');
const alertBox = document.getElementById('loginAlert');
const loginBtn = document.getElementById('loginBtn');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  alertBox.innerHTML = '';
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in...';

  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    await loginAdmin(email, password);
    window.location.href = 'index.html';
  } catch (error) {
    alertBox.innerHTML = `<div class="alert alert-danger mt-1 mb-0">${error.message}</div>`;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});
