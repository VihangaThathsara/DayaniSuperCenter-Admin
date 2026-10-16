import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { renderShell } from '../ui-shell.js';
import { escapeHtml, formatCurrency, formatDate, statusBadge } from '../utils.js';
import { ORDER_STATUSES, updateOrderStatus, watchOrders } from '../data-service.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Orders',
  pageSubtitle: 'Monitor orders and update their status from pending to delivered.',
  activePage: 'orders.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="card border-0 shadow-sm"><div class="card-body">
    <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th><th>Actions</th></tr></thead><tbody id="ordersBody"></tbody></table></div>
  </div></div>
`;

const body = getElement('ordersBody');
let initialReady;
const initialData = new Promise((resolve) => { initialReady = resolve; });
const unsubscribeOrders = watchOrders((orders) => {
  body.innerHTML = orders.map((order) => {
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const currentStatus = String(order.status || 'pending').trim().toLowerCase();
    const currentIndex = ORDER_STATUSES.indexOf(currentStatus);
    return `
      <tr>
        <td><div class="fw-semibold">${escapeHtml(order.orderId || order.id)}</div><div class="small text-secondary">${escapeHtml(order.paymentMethod || 'Unknown payment')}</div></td>
        <td><div>${escapeHtml(order.user?.name || order.user?.fullName || 'Customer')}</div><div class="small text-secondary">${escapeHtml(order.user?.email || '')}</div></td>
        <td>${itemCount} items</td>
        <td>${formatCurrency(order.total)}</td>
        <td>${statusBadge(order.status)}</td>
        <td>${formatDate(order.createdAt || order.createdAtClient)}</td>
        <td>
          <select class="form-select form-select-sm order-status-select" data-user-id="${escapeHtml(order.user?.id || '')}" data-order-id="${escapeHtml(order.id)}" data-previous-status="${escapeHtml(currentStatus)}" ${currentStatus === 'delivered' || currentIndex < 0 ? 'disabled' : ''}>
            ${currentIndex < 0 ? `<option value="${escapeHtml(currentStatus)}" selected>${escapeHtml(currentStatus)}</option>` : ''}
            ${ORDER_STATUSES.map((status, index) => `<option value="${status}" ${status === currentStatus ? 'selected' : ''} ${index < currentIndex ? 'disabled' : ''}>${status}</option>`).join('')}
          </select>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="text-center text-secondary py-5">No orders available.</td></tr>';
  initialReady();
}, (error) => {
  body.innerHTML = `<tr><td colspan="7" class="text-danger">${escapeHtml(error?.message || 'Unable to load orders.')}</td></tr>`;
  initialReady();
});
onPageLeave(page, () => { unsubscribeOrders(); initialReady(); });

body.addEventListener('change', async (event) => {
  const select = event.target.closest('.order-status-select');
  if (!select || select.disabled) return;
  const requestedStatus = select.value;
  select.disabled = true;
  try {
    await updateOrderStatus(select.dataset.userId, select.dataset.orderId, requestedStatus);
    select.dataset.previousStatus = requestedStatus;
    const currentIndex = ORDER_STATUSES.indexOf(requestedStatus);
    for (const option of select.options) {
      option.disabled = ORDER_STATUSES.indexOf(option.value) < currentIndex;
    }
  } catch (error) {
    select.value = select.dataset.previousStatus || 'pending';
    alert(error?.message || 'Could not update order status.');
  } finally {
    select.disabled = select.dataset.previousStatus === 'delivered'
      || !ORDER_STATUSES.includes(select.dataset.previousStatus);
  }
});

await initialData;
return page;
}
