import { onPageLeave } from './page-lifecycle.js';
import { prepareCatalogImageElements } from './catalog-images.js';

export function waitForPageImages(page) {
  return new Promise((resolve) => {
    let finished = false;
    let observer;
    const done = () => {
      if (finished) return;
      finished = true;
      observer?.disconnect();
      page.removeEventListener('load', check, true);
      page.removeEventListener('error', check, true);
      resolve();
    };
    const check = () => {
      if (finished) return;
      if (!page.isConnected) { done(); return; }
      prepareCatalogImageElements(page).catch(() => {});
      const ready = [...page.querySelectorAll('img')].every((image) =>
        image.dataset.catalogLoading !== 'true' && image.dataset.photoLoading !== 'true'
        && (image.hidden || !image.getAttribute('src') || image.complete));
      if (ready) done();
    };
    observer = new MutationObserver(check);
    observer.observe(page, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'hidden', 'data-photo-loading', 'data-catalog-loading'] });
    page.addEventListener('load', check, true);
    page.addEventListener('error', check, true);
    onPageLeave(page, done);
    check();
  });
}
