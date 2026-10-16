import { mountChart } from '../page-lifecycle.js';
import { watchDashboardData } from '../dashboard-updates.js';
import '../main.js';
import { buildDashboardData } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { escapeHtml, formatCurrency } from '../utils.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Reports',
  pageSubtitle: 'Sales, product and customer summaries.',
  activePage: 'reports.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="row g-4 mb-4">
    <div class="col-lg-6"><div class="card border-0 shadow-sm"><div class="card-body"><h2 class="h5 mb-3">Revenue by day</h2><div id="reportSalesChart"></div></div></div></div>
    <div class="col-lg-6"><div class="card border-0 shadow-sm"><div class="card-body"><h2 class="h5 mb-3">Order status breakdown</h2><div id="reportStatusChart"></div></div></div></div>
  </div>
  <div class="card border-0 shadow-sm"><div class="card-body">
    <h2 class="h5 mb-3">Top selling products</h2>
    <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Product</th><th>Sold Count</th><th>Stock</th><th>Price</th></tr></thead><tbody id="topProductsBody"></tbody></table></div>
  </div></div>
`;

const [data, { default: ApexCharts }] = await Promise.all([buildDashboardData(), import('apexcharts')]);
if (!page.isConnected) return;

function renderSummary(data) {
const topProducts = [...data.products].sort((a, b) => Number(b.soldCount || 0) - Number(a.soldCount || 0)).slice(0, 8);
getElement('topProductsBody').innerHTML = topProducts.map((product) => `
  <tr>
    <td>${escapeHtml(product.name || product.id)}</td>
    <td>${Number(product.soldCount || 0)}</td>
    <td>${Number(product.stock ?? product.stockCount ?? 0)}</td>
    <td>${formatCurrency(product.price)}</td>
  </tr>
`).join('') || '<tr><td colspan="4" class="text-center text-secondary py-5">No products available.</td></tr>';

}
renderSummary(data);


const chart1 = new ApexCharts(page.querySelector('#reportSalesChart'), {
  chart: { type: 'bar', height: 320, toolbar: { show: false }, animations: { enabled: false } },
  series: [{ name: 'Revenue', data: data.dailySales.map((item) => item.total) }],
  xaxis: { categories: data.dailySales.map((item) => item.date) },
  noData: { text: 'No sales yet' },
  dataLabels: { enabled: false },
  yaxis: { labels: { formatter: formatCurrency } },
  tooltip: { y: { formatter: formatCurrency } }
});

const chart2 = new ApexCharts(page.querySelector('#reportStatusChart'), {
  chart: { type: 'pie', height: 320, animations: { enabled: false } },
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
      series: [{ name: 'Revenue', data: next.dailySales.map((item) => item.total) }],
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
