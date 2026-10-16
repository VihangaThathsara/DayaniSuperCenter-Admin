import { peekData, subscribeData } from '../data-cache.js';
import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { fetchUsers } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { escapeHtml, formatDate } from '../utils.js';
import { profileAvatarMarkup, bindCustomerPhotos } from '../profile-photo.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Customers',
  pageSubtitle: 'View customer records.',
  activePage: 'customers.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="card border-0 shadow-sm"><div class="card-body">
    <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th></tr></thead><tbody id="customersBody"></tbody></table></div>
  </div></div>
`;

let lastMarkup;
function renderCustomers(customers) {
if (!page.isConnected) return;
const markup = customers.map((customer) => {
  const joined = customer.createdAt || customer.createdAtClient || customer.latestNotificationAt || customer.latestNotificationAtClient || customer.updatedAt || null;
  return `
    <tr>
      <td><div class="d-flex align-items-center gap-3">${profileAvatarMarkup(customer)}<div><div class="fw-semibold">${escapeHtml(customer.name || customer.fullName || 'Unknown user')}</div><div class="small text-secondary">${escapeHtml(customer.id)}</div></div></div></td>
      <td>${escapeHtml(customer.email || '-')}</td>
      <td>${escapeHtml(customer.phone || '-')}</td>
      <td>${formatDate(joined)}</td>
    </tr>
  `;
}).join('') || '<tr><td colspan="4" class="text-center text-secondary py-5">No customers found.</td></tr>';
if (markup === lastMarkup) return;
lastMarkup = markup;
getElement('customersBody').innerHTML = markup;

bindCustomerPhotos(getElement('customersBody'), customers);
}
onPageLeave(page, subscribeData('users', () => renderCustomers(peekData('users') || [])));
renderCustomers(await fetchUsers());
return page;
}
