import { catalogImageMarkup, bindCatalogImages } from '../catalog-images.js';
import { peekData, subscribeData } from '../data-cache.js';
import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { deleteProduct, fetchCategories, fetchProducts, saveProduct } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { catalogDisplayId, escapeHtml, formatCurrency, setButtonLoading } from '../utils.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Products',
  pageSubtitle: 'Add, edit and remove products that appear in the Android app.',
  activePage: 'products.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="row g-4">
    <div class="col-lg-4">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <h2 class="h5 mb-3">Product form</h2>
        <form id="productForm" class="d-grid gap-3">
          <input type="hidden" id="productId">
          <div><label class="form-label">Name</label><input id="productName" class="form-control" required></div>
          <div><label class="form-label">Description *</label><textarea id="productDescription" class="form-control" rows="3" required></textarea></div>
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label">Price</label><input id="productPrice" type="number" min="0" class="form-control" required></div>
            <div class="col-md-6"><label class="form-label">Stock</label><input id="productStock" type="number" min="0" class="form-control" required></div>
          </div>
          <div><label class="form-label">Category</label><select id="productCategory" class="form-select"><option value="">Select category</option></select></div>
          <div><label class="form-label">Image URL</label><input id="productImageUrl" class="form-control" placeholder="or upload below"></div>
          <div><label class="form-label">Upload image</label><input id="productImageFile" type="file" class="form-control" accept="image/jpeg,image/png,image/webp,image/gif"><div class="form-text">Image required: add an image URL or upload a JPG, PNG, WebP or GIF.</div></div>
          <div class="row g-3">
            <div class="col-md-6 form-check"><input id="productActive" class="form-check-input" type="checkbox" checked><label class="form-check-label" for="productActive">Active</label></div>
            <div class="col-md-6 form-check"><input id="productPopular" class="form-check-input" type="checkbox"><label class="form-check-label" for="productPopular">Most popular</label></div>
          </div>
          <div class="d-flex gap-2"><button id="productSaveBtn" class="btn btn-primary" type="submit">Save Product</button><button id="productResetBtn" class="btn btn-light" type="button">Reset</button></div>
        </form>
      </div></div>
    </div>
    <div class="col-lg-8">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Product list</h2><span id="productCount" class="badge text-bg-light"></span></div>
        <div class="table-responsive"><table class="table align-middle"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody id="productsBody"></tbody></table></div>
      </div></div>
    </div>
  </div>
`;

let products = [];
let lastMarkup;
let stopImages = () => {};
onPageLeave(page, () => stopImages());
let categories = [];
const categorySelect = getElement('productCategory');
function renderCategories(rows) {
  if (!page.isConnected) return;
  const selected = categorySelect.value;
  categories = rows;
  categorySelect.innerHTML = '<option value="">Select category</option>' + categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  categorySelect.value = selected;
}
const categoriesReady = fetchCategories().then(renderCategories);

async function loadProducts() {
  renderProducts(await fetchProducts());
}
function renderProducts(rows) {
  if (!page.isConnected) return;
  products = rows;
  getElement('productCount').textContent = `${products.length} products`;
  const markup = products.map((product) => `
    <tr>
      <td><div class="d-flex align-items-center gap-3">${catalogImageMarkup(product.imageUrl, 'rounded product-thumb', 60)}<div><div class="fw-semibold">${escapeHtml(product.name)}</div><div class="small text-secondary">${escapeHtml(catalogDisplayId(product.id))}</div></div></div></td>
      <td>${escapeHtml(product.categoryName || '-')}</td>
      <td>${formatCurrency(product.price)}</td>
      <td>${Number(product.stock ?? product.stockCount ?? 0)}</td>
      <td>${product.active !== false ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Hidden</span>'}</td>
      <td class="text-end"><div class="btn-group btn-group-sm"><button class="btn btn-light" data-edit="${escapeHtml(product.id)}">Edit</button><button class="btn btn-outline-danger" data-delete="${escapeHtml(product.id)}">Delete</button></div></td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center text-secondary py-4">No products found.</td></tr>';
  if (markup === lastMarkup) return;
  lastMarkup = markup;
  stopImages();
  getElement('productsBody').innerHTML = markup;
  stopImages = bindCatalogImages(getElement('productsBody'));
}


getElement('productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveBtn = getElement('productSaveBtn');
  setButtonLoading(saveBtn, true);

  const selectedOption = categorySelect.selectedOptions[0];
  const payload = {
    id: getElement('productId').value.trim(),
    name: getElement('productName').value.trim(),
    description: getElement('productDescription').value.trim(),
    price: getElement('productPrice').value,
    stock: getElement('productStock').value,
    categoryId: categorySelect.value,
    categoryName: selectedOption ? selectedOption.textContent : '',
    imageUrl: getElement('productImageUrl').value.trim(),
    active: getElement('productActive').checked,
    mostPopular: getElement('productPopular').checked
  };
  const file = getElement('productImageFile').files[0];
  try {
    await saveProduct(payload, file);
    event.target.reset();
    getElement('productId').value = '';
    await loadProducts();
  } catch (error) {
    alert(error?.message || 'Could not save product.');
  } finally {
    setButtonLoading(saveBtn, false, 'Save Product');
  }
});

getElement('productResetBtn').addEventListener('click', () => getElement('productForm').reset());

getElement('productsBody').addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;

  if (editId) {
    const product = products.find((item) => item.id === editId);
    if (!product) return;
    getElement('productId').value = product.id;
    getElement('productName').value = product.name || '';
    getElement('productDescription').value = product.description || '';
    getElement('productPrice').value = product.price || 0;
    getElement('productStock').value = product.stock ?? product.stockCount ?? 0;
    getElement('productCategory').value = product.categoryId || '';
    getElement('productImageUrl').value = product.imageUrl || '';
    getElement('productImageFile').value = '';
    getElement('productActive').checked = product.active !== false;
    getElement('productPopular').checked = !!product.mostPopular;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (deleteId && confirm('Delete this product?')) {
    await deleteProduct(deleteId);
    await loadProducts();
  }
});

onPageLeave(page, subscribeData('products', () => renderProducts(peekData('products') || [])));
onPageLeave(page, subscribeData('categories', () => renderCategories(peekData('categories') || [])));
await Promise.all([categoriesReady, loadProducts()]);
return page;
}
