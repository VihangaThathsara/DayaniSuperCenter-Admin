import { mountChart } from '../page-lifecycle.js';
import { watchDashboardData } from '../dashboard-updates.js';
import '../main.js';
import { buildDashboardData } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { escapeHtml, formatCurrency, formatDate } from '../utils.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Dashboard',
  pageSubtitle: 'Overview of products, orders, revenue and recent activity.',
  activePage: 'index.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="row g-3 mb-4" id="statsRow"></div>
  <div class="row g-3 mb-4">
    <div class="col-lg-8"><div class="card border-0 shadow-sm"><div class="card-body"><div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Last 7 days sales</h2><span class="small text-secondary">From user orders</span></div><div id="salesChart"></div></div></div></div>
    <div class="col-lg-4"><div class="card border-0 shadow-sm h-100"><div class="card-body"><h2 class="h5 mb-3">Orders by status</h2><div id="statusChart"></div></div></div></div>
  </div>
  <div class="card border-0 shadow-sm">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h5 mb-0">Recent orders</h2>
        <a href="orders.html" class="btn btn-outline-primary btn-sm">Open orders</a>
      </div>
      <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Order ID</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr></thead><tbody id="recentOrdersBody"></tbody></table></div>
    </div>
  </div>
`;

const [data, { default: ApexCharts }] = await Promise.all([buildDashboardData(), import('apexcharts')]);
if (!page.isConnected) return;
function renderSummary(data) {
const stats = [
  ['Total Revenue', formatCurrency(data.totalRevenue), 'ti-cash-banknote', 'success'],
  ['Orders', String(data.orders.length), 'ti-package', 'primary'],
  ['Pending / Active', String(data.pendingOrders), 'ti-loader-2', 'warning'],
  ['Low Stock Products', String(data.lowStockCount), 'ti-alert-triangle', 'danger']
];

getElement('statsRow').innerHTML = stats.map(([label, value, icon, tone]) => `
  <div class="col-lg-3 col-md-6">
    <div class="card border-0 shadow-sm stat-card h-100">
      <div class="card-body d-flex align-items-center gap-3">
        <div class="icon-shape icon-md bg-${tone} bg-opacity-10 text-${tone} rounded-3"><i class="ti ${icon}"></i></div>
        <div><div class="small text-secondary mb-1">${label}</div><div class="h4 mb-0">${value}</div></div>
      </div>
    </div>
  </div>
`).join('');

getElement('recentOrdersBody').innerHTML = data.orders.slice(0, 6).map((order) => `
  <tr>
    <td class="fw-semibold">${escapeHtml(order.orderId || order.id)}</td>
    <td>${escapeHtml(order.user?.name || order.user?.fullName || order.user?.email || 'Customer')}</td>
    <td><span class="badge text-bg-light border text-capitalize">${escapeHtml(order.status || 'pending')}</span></td>
    <td>${formatCurrency(order.total)}</td>
    <td>${formatDate(order.createdAt || order.createdAtClient)}</td>
  </tr>
`).join('') || '<tr><td colspan="5" class="text-center text-secondary py-4">No orders found yet.</td></tr>';

}
renderSummary(data);


const chart1 = new ApexCharts(page.querySelector('#salesChart'), {
  chart: { type: 'area', height: 320, toolbar: { show: false }, animations: { enabled: false } },
  series: [{ name: 'Sales', data: data.dailySales.map((item) => item.total) }],
  xaxis: { categories: data.dailySales.map((item) => item.date) },
  noData: { text: 'No sales yet' },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 3 },
  yaxis: { labels: { formatter: formatCurrency } },
  tooltip: { y: { formatter: formatCurrency } }
});

const chart2 = new ApexCharts(page.querySelector('#statusChart'), {
  chart: { type: 'donut', height: 300, animations: { enabled: false } },
  series: data.orders.length ? data.ordersByStatus.map((item) => item.count) : [],
  labels: data.ordersByStatus.map((item) => item.status),
  noData: { text: 'No orders yet' },
  legend: { position: 'bottom' }
});

await Promise.all([mountChart(page, chart1), mountChart(page, chart2)]);
if (!page.isConnected) return;
watchDashboardData(page, data, async (next) => {
  renderSummary(next);
  await Promise.all([
    chart1.updateOptions({
      series: [{ name: 'Sales', data: next.dailySales.map((item) => item.total) }],
      xaxis: { categories: next.dailySales.map((item) => item.date) }
    }, false, false, false),
    chart2.updateOptions({
      series: next.orders.length ? next.ordersByStatus.map((item) => item.count) : [],
      labels: next.ordersByStatus.map((item) => item.status)
    }, false, false, false)
  ]);
});


return page;
}
