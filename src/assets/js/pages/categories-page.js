import { catalogImageMarkup, bindCatalogImages } from '../catalog-images.js';
import { peekData, subscribeData } from '../data-cache.js';
import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { deleteCategory, fetchCategories, saveCategory } from '../data-service.js';
import { renderShell } from '../ui-shell.js';
import { catalogDisplayId, escapeHtml, setButtonLoading } from '../utils.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Categories',
  pageSubtitle: 'Maintain category tiles shown in the mobile app.',
  activePage: 'categories.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <div class="row g-4">
    <div class="col-lg-4">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <h2 class="h5 mb-3">Category form</h2>
        <form id="categoryForm" class="d-grid gap-3">
          <input type="hidden" id="categoryId">
          <div><label class="form-label">Category name</label><input id="categoryName" class="form-control" required></div>
          <div><label class="form-label">Description *</label><textarea id="categoryDescription" class="form-control" rows="3" required></textarea></div>
          <div><label class="form-label">Image URL</label><input id="categoryImageUrl" class="form-control"></div>
          <div><label class="form-label">Upload image</label><input id="categoryImageFile" type="file" class="form-control" accept="image/jpeg,image/png,image/webp,image/gif"><div class="form-text">Image required: add an image URL or upload a JPG, PNG, WebP or GIF.</div></div>
          <div class="d-flex gap-2"><button id="categorySaveBtn" class="btn btn-primary" type="submit">Save Category</button><button id="categoryResetBtn" class="btn btn-light" type="button">Reset</button></div>
        </form>
      </div></div>
    </div>
    <div class="col-lg-8">
      <div class="card border-0 shadow-sm"><div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Category list</h2><span id="categoryCount" class="badge text-bg-light"></span></div>
        <div class="row g-3" id="categoryGrid"></div>
      </div></div>
    </div>
  </div>
`;

let categories = [];
let lastMarkup;
let stopImages = () => {};
onPageLeave(page, () => stopImages());

async function loadCategories() {
  renderCategories(await fetchCategories());
}
function renderCategories(rows) {
  if (!page.isConnected) return;
  categories = rows;
  getElement('categoryCount').textContent = `${categories.length} categories`;
  const markup = categories.map((category) => `
    <div class="col-md-6">
      <div class="card border h-100">
        <div class="card-body d-flex gap-3 align-items-center">
          ${catalogImageMarkup(category.imageUrl, 'rounded category-thumb', 72)}
          <div class="flex-grow-1">
            <div class="fw-semibold">${escapeHtml(category.name)}</div>
            <div class="small text-secondary">${escapeHtml(catalogDisplayId(category.id))}</div>
          </div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" data-edit="${escapeHtml(category.id)}">Edit</button><button class="btn btn-outline-danger" data-delete="${escapeHtml(category.id)}">Delete</button></div>
        </div>
      </div>
    </div>
  `).join('') || '<div class="col-12 text-center text-secondary py-5">No categories found.</div>';
  if (markup === lastMarkup) return;
  lastMarkup = markup;
  stopImages();
  getElement('categoryGrid').innerHTML = markup;
  stopImages = bindCatalogImages(getElement('categoryGrid'));
}


getElement('categoryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveBtn = getElement('categorySaveBtn');
  setButtonLoading(saveBtn, true);
  const payload = {
    id: getElement('categoryId').value.trim(),
    name: getElement('categoryName').value.trim(),
    description: getElement('categoryDescription').value.trim(),
    imageUrl: getElement('categoryImageUrl').value.trim(),
    active: categories.find((item) => item.id === getElement('categoryId').value)?.active !== false,
    sortOrder: categories.find((item) => item.id === getElement('categoryId').value)?.sortOrder || 0
  };
  const file = getElement('categoryImageFile').files[0];
  try {
    await saveCategory(payload, file);
    event.target.reset();
    getElement('categoryId').value = '';
    await loadCategories();
  } catch (error) {
    alert(error?.message || 'Could not save category.');
  } finally {
    setButtonLoading(saveBtn, false, 'Save Category');
  }
});

getElement('categoryResetBtn').addEventListener('click', () => getElement('categoryForm').reset());

getElement('categoryGrid').addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) {
    const category = categories.find((item) => item.id === editId);
    if (!category) return;
    getElement('categoryId').value = category.id;
    getElement('categoryName').value = category.name || '';
    getElement('categoryDescription').value = category.description || '';
    getElement('categoryImageUrl').value = category.imageUrl || '';
    getElement('categoryImageFile').value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (deleteId && confirm('Delete this category?')) {
    await deleteCategory(deleteId);
    await loadCategories();
  }
});

onPageLeave(page, subscribeData('categories', () => renderCategories(peekData('categories') || [])));
await loadCategories();
return page;
}
