const cleanups = new WeakMap();
export function onPageLeave(page, callback) {
  if (!page.isConnected) { callback(); return; }
  if (!cleanups.has(page)) cleanups.set(page, []);
  cleanups.get(page).push(callback);
}
export function leavePage(page) {
  for (const callback of cleanups.get(page) || []) callback();
  cleanups.delete(page);
}

export async function mountChart(page, chart) {
  let rendered = false;
  let left = false;
  onPageLeave(page, () => { left = true; if (rendered) chart.destroy(); });
  if (left) return;
  try {
    await chart.render();
    rendered = true;
    if (left) chart.destroy();
  } catch (error) {
    if (!left) throw error;
  }
}
