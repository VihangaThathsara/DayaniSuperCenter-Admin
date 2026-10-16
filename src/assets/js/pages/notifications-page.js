import { peekData, subscribeData } from '../data-cache.js';
import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { fetchUsers, sendNotificationToAll, sendNotificationToSelected } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { escapeHtml, setButtonLoading } from '../utils.js';
import { profileAvatarMarkup, bindCustomerPhotos } from '../profile-photo.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Notifications',
  pageSubtitle: 'Send promotional or service notifications to all users or selected users.',
  activePage: 'notifications.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


let users = peekData('users') || [];
let successTimer;
let active = true;
function clearSuccessTimer() {
  window.clearTimeout(successTimer);
  successTimer = undefined;
}
onPageLeave(page, () => {
  active = false;
  clearSuccessTimer();
});

page.innerHTML = `
  <div class="row g-4">
    <div class="col-lg-5">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <h2 class="h5 mb-3">Compose notification</h2>
        <form id="notificationForm" class="d-grid gap-3">
          <div>
            <label class="form-label">Send type</label>
            <select id="sendType" class="form-select">
              <option value="all">All users</option>
              <option value="selected">Selected users</option>
            </select>
          </div>
          <div>
            <label class="form-label">Title</label>
            <input id="notificationTitle" class="form-control" required>
          </div>
          <div>
            <label class="form-label">Message</label>
            <textarea id="notificationMessage" class="form-control" rows="4" required></textarea>
          </div>
          <div id="userPickerWrap" class="d-none">
            <label class="form-label">Select users</label>
            <div class="user-picker" id="userPicker"></div>
          </div>
          <button id="notificationSubmitBtn" class="btn btn-primary" type="submit">Send notification</button>
          <div id="notificationAlert"></div>
        </form>
      </div></div>
    </div>
    <div class="col-lg-7">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <h2 class="h5 mb-3">Recipients preview</h2>
        <div class="list-group" id="recipientsPreview"></div>
      </div></div>
    </div>
  </div>
`;

const sendType = getElement('sendType');
getElement('notificationForm').addEventListener('input', () => {
  clearSuccessTimer();
  getElement('notificationAlert').innerHTML = '';
});
sendType.addEventListener('change', () => {
  getElement('userPickerWrap').classList.toggle('d-none', sendType.value !== 'selected');
});

getElement('notificationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = getElement('notificationSubmitBtn');
  const alertBox = getElement('notificationAlert');
  clearSuccessTimer();
  setButtonLoading(submitBtn, true, 'Send notification');
  alertBox.innerHTML = '';

  try {
    const title = getElement('notificationTitle').value.trim();
    const message = getElement('notificationMessage').value.trim();
    if (sendType.value === 'all') {
      await sendNotificationToAll(title, message);
    } else {
      const selected = [...page.querySelectorAll('.selected-user:checked')].map((input) => input.value);
      if (!selected.length) throw new Error('Select at least one user.');
      await sendNotificationToSelected(selected, title, message);
    }
    if (!active) return;
    event.target.reset();
    page.querySelectorAll('.selected-user').forEach(input => {
      input.checked = false;
      input.defaultChecked = false;
    });
    getElement('userPickerWrap').classList.add('d-none');
    alertBox.innerHTML = '<div class="alert alert-success mb-0">Notification sent successfully.</div>';
    successTimer = window.setTimeout(() => {
      if (active) alertBox.innerHTML = '';
      successTimer = undefined;
    }, 3500);
  } catch (error) {
    if (active) alertBox.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message)}</div>`;
  } finally {
    setButtonLoading(submitBtn, false, 'Send notification');
  }
});

function renderUsers(rows) {
  if (!page.isConnected) return;
  users = rows;
  const selected = new Set([...page.querySelectorAll('.selected-user:checked')].map(input => input.value));
  getElement('userPicker').innerHTML = rows.map(row => `<label class="list-group-item d-flex gap-3 align-items-center">
    <input class="form-check-input selected-user" type="checkbox" value="${escapeHtml(row.id)}" ${selected.has(row.id) ? 'checked' : ''}>
    ${profileAvatarMarkup(row)}
    <span class="min-w-0"><div class="fw-semibold">${escapeHtml(row.name || row.fullName || 'Customer')}</div>
    <div class="small text-secondary">${escapeHtml(row.email || row.phone || row.id)}</div></span></label>`).join('');
  getElement('recipientsPreview').innerHTML = rows.map(row => `<div class="list-group-item d-flex align-items-center gap-3">
    ${profileAvatarMarkup(row)}<div><div class="fw-semibold">${escapeHtml(row.name || row.fullName || 'Customer')}</div>
    <div class="small text-secondary">${escapeHtml(row.email || row.phone || row.id)}</div></div></div>`).join('');
  bindCustomerPhotos(getElement('userPicker'), rows);
  bindCustomerPhotos(getElement('recipientsPreview'), rows);
}
renderUsers(users);

onPageLeave(page, subscribeData('users', () => renderUsers(peekData('users') || [])));
renderUsers(await fetchUsers());
return page;
}
