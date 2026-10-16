import { peekData, subscribeData } from './data-cache.js';
import { summarizeDashboardData } from './data-service.js';
import { onPageLeave } from './page-lifecycle.js';

// Update an existing view after background cache refreshes; never remount its charts.
export function watchDashboardData(page, initial, render) {
  let active = true;
  let timer;
  let updating = false;
  let pending = false;
  let signature = JSON.stringify(initial);
  const schedule = () => {
    if (!active) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(update, 60);
  };
  const update = async () => {
    if (!active || !page.isConnected || updating) return;
    const names = ['users', 'products', 'categories', 'orders'];
    const rows = names.map(peekData);
    if (rows.some((items) => !items)) return;
    pending = false;
    const data = summarizeDashboardData(Object.fromEntries(names.map((name, index) => [name, rows[index]])));
    const next = JSON.stringify(data);
    if (next === signature) return;
    updating = true;
    try {
      await render(data);
      signature = next;
    } catch (error) {
      if (active) console.error('Unable to update chart data.', error);
    } finally {
      updating = false;
      if (pending && active) schedule();
    }
  };
  const stop = subscribeData('*', (name) => {
    if (['users', 'products', 'categories', 'orders'].includes(name)) schedule();
  });
  onPageLeave(page, () => { active = false; clearTimeout(timer); stop(); });
  // A refresh may have completed while the chart library was rendering.
  schedule();
}
