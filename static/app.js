const roomImageInput = document.getElementById("roomImageInput");
const roomPreview = document.getElementById("roomPreview");
const resultImage = document.getElementById("resultImage");
const marker = document.getElementById("marker");
const emptyHint = document.getElementById("emptyHint");
const coordsText = document.getElementById("coordsText");
const statusText = document.getElementById("statusText");
const renderBtn = document.getElementById("renderBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadLink = document.getElementById("downloadLink");

const searchInput = document.getElementById("searchInput");
const categoryTabs = document.getElementById("categoryTabs");
const furnitureGrid = document.getElementById("furnitureGrid");

const newFurnitureName = document.getElementById("newFurnitureName");
const newFurnitureCategory = document.getElementById("newFurnitureCategory");
const newFurnitureImage = document.getElementById("newFurnitureImage");
const uploadFurnitureBtn = document.getElementById("uploadFurnitureBtn");
const uploadStatusText = document.getElementById("uploadStatusText");

const canvasSurface = document.querySelector(".canvas-surface");

let selectedRoomFile = null;
let selectedPoint = null;
let selectedFurnitureId = "";
let furnitureItems = [];
let selectedCategory = "all";
let searchQuery = "";

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#dc2626" : "#6b7280";
}

function setUploadStatus(text, isError = false) {
  uploadStatusText.textContent = text;
  uploadStatusText.style.color = isError ? "#dc2626" : "#6b7280";
}

function updateEmptyHint() {
  emptyHint.classList.toggle("hidden", Boolean(roomPreview.getAttribute("src")));
}

function updateRenderButtonState() {
  renderBtn.disabled = !(selectedRoomFile && selectedPoint && selectedFurnitureId);
}

function resetResult() {
  resultImage.removeAttribute("src");
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
}

function normalizeCategory(value) {
  return (value || "other").trim().toLowerCase() || "other";
}

function getFilteredItems() {
  return furnitureItems.filter((item) => {
    const itemCategory = normalizeCategory(item.category);
    if (selectedCategory !== "all" && itemCategory !== selectedCategory) {
      return false;
    }
    if (!searchQuery) return true;
    return (item.name || "").toLowerCase().includes(searchQuery);
  });
}

function renderCategoryTabs() {
  const counts = new Map();
  for (const item of furnitureItems) {
    const key = normalizeCategory(item.category);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const categories = [{ id: "all", label: "Все" }];
  for (const key of Array.from(counts.keys()).sort()) {
    categories.push({ id: key, label: key });
  }

  if (!categories.some((cat) => cat.id === selectedCategory)) {
    selectedCategory = "all";
  }

  categoryTabs.innerHTML = "";
  for (const category of categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip ${category.id === selectedCategory ? "active" : ""}`;
    chip.textContent = category.label;
    chip.addEventListener("click", () => {
      selectedCategory = category.id;
      renderCategoryTabs();
      renderFurnitureGrid();
    });
    categoryTabs.appendChild(chip);
  }
}

function renderFurnitureGrid() {
  const items = getFilteredItems();
  furnitureGrid.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-grid";
    empty.textContent = "Ничего не найдено. Измени фильтр или добавь новый предмет.";
    furnitureGrid.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `furniture-card ${item.id === selectedFurnitureId ? "active" : ""}`;

    const preview = document.createElement("div");
    preview.className = "furniture-preview";
    const img = document.createElement("img");
    img.alt = item.name || "Мебель";
    img.src = item.asset_url || "";
    preview.appendChild(img);

    const title = document.createElement("p");
    title.className = "furniture-title";
    title.textContent = item.name || "Без названия";

    const meta = document.createElement("p");
    meta.className = "furniture-meta";
    meta.textContent = normalizeCategory(item.category).toUpperCase();

    card.appendChild(preview);
    card.appendChild(title);
    card.appendChild(meta);

    card.addEventListener("click", () => {
      selectedFurnitureId = item.id;
      renderFurnitureGrid();
      updateRenderButtonState();
      setStatus(`Выбрано: ${item.name}`);
    });

    furnitureGrid.appendChild(card);
  }
}

async function loadFurnitureCatalog() {
  setStatus("Загрузка каталога мебели...");
  const response = await fetch("/api/furniture");
  if (!response.ok) {
    throw new Error("Не удалось получить каталог мебели");
  }
  const data = await response.json();
  furnitureItems = data.items || [];

  if (!furnitureItems.some((item) => item.id === selectedFurnitureId)) {
    selectedFurnitureId = furnitureItems[0]?.id || "";
  }

  renderCategoryTabs();
  renderFurnitureGrid();
  updateRenderButtonState();
  setStatus("Каталог загружен");
}

function handleRoomFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    selectedRoomFile = null;
    selectedPoint = null;
    roomPreview.removeAttribute("src");
    marker.hidden = true;
    coordsText.textContent = "Точка не выбрана";
    updateEmptyHint();
    updateRenderButtonState();
    return;
  }

  selectedRoomFile = file;
  selectedPoint = null;
  marker.hidden = true;
  coordsText.textContent = "Точка не выбрана";
  roomPreview.src = URL.createObjectURL(file);
  resetResult();
  updateEmptyHint();
  setStatus("Фото загружено. Кликни в место установки мебели.");
  updateRenderButtonState();
}

function getImageDrawRect(imgElement) {
  const naturalW = imgElement.naturalWidth;
  const naturalH = imgElement.naturalHeight;
  if (!naturalW || !naturalH) return null;

  const rect = canvasSurface.getBoundingClientRect();
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  const left = (rect.width - drawW) / 2;
  const top = (rect.height - drawH) / 2;
  return { left, top, drawW, drawH };
}

function handleCanvasClick(event) {
  if (!selectedRoomFile || !roomPreview.getAttribute("src")) {
    return;
  }

  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return;

  const surfaceRect = canvasSurface.getBoundingClientRect();
  const sx = event.clientX - surfaceRect.left;
  const sy = event.clientY - surfaceRect.top;

  if (
    sx < drawRect.left ||
    sy < drawRect.top ||
    sx > drawRect.left + drawRect.drawW ||
    sy > drawRect.top + drawRect.drawH
  ) {
    return;
  }

  const x = (sx - drawRect.left) / drawRect.drawW;
  const y = (sy - drawRect.top) / drawRect.drawH;
  selectedPoint = {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };

  marker.hidden = false;
  marker.style.left = `${drawRect.left + selectedPoint.x * drawRect.drawW}px`;
  marker.style.top = `${drawRect.top + selectedPoint.y * drawRect.drawH}px`;
  coordsText.textContent = `Точка: x=${selectedPoint.x.toFixed(3)}, y=${selectedPoint.y.toFixed(3)}`;
  setStatus("Точка выбрана, можно генерировать");
  updateRenderButtonState();
}

async function handleRender() {
  if (!selectedRoomFile || !selectedPoint || !selectedFurnitureId) return;
  renderBtn.disabled = true;
  setStatus("Генерация...");
  resetResult();

  const formData = new FormData();
  formData.append("room_image", selectedRoomFile);
  formData.append("furniture_id", selectedFurnitureId);
  formData.append("x", selectedPoint.x.toString());
  formData.append("y", selectedPoint.y.toString());

  try {
    const response = await fetch("/api/render", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Ошибка генерации");
    }

    resultImage.src = data.result_image_url;
    downloadLink.href = data.result_image_url;
    downloadLink.hidden = false;
    setStatus(`Готово! Режим: ${data.provider}`);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка: ${error.message}`, true);
  } finally {
    updateRenderButtonState();
  }
}

async function handleFurnitureUpload() {
  const name = (newFurnitureName.value || "").trim();
  const category = (newFurnitureCategory.value || "custom").trim();
  const imageFile = newFurnitureImage.files?.[0];

  if (!name) {
    setUploadStatus("Введи название предмета", true);
    return;
  }
  if (!imageFile) {
    setUploadStatus("Выбери файл PNG/JPG/WEBP", true);
    return;
  }

  uploadFurnitureBtn.disabled = true;
  setUploadStatus("Загружаю предмет...");

  const formData = new FormData();
  formData.append("name", name);
  formData.append("category", category || "custom");
  formData.append("furniture_image", imageFile);
  formData.append("prompt", `A realistic ${name} in modern interior style`);

  try {
    const response = await fetch("/api/furniture/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Не удалось загрузить предмет");
    }

    await loadFurnitureCatalog();
    selectedFurnitureId = data.item.id;
    renderFurnitureGrid();
    updateRenderButtonState();
    newFurnitureName.value = "";
    newFurnitureImage.value = "";
    setUploadStatus(`Добавлено: ${data.item.name}`);
  } catch (error) {
    console.error(error);
    setUploadStatus(`Ошибка: ${error.message}`, true);
  } finally {
    uploadFurnitureBtn.disabled = false;
  }
}

function handleClear() {
  roomImageInput.value = "";
  selectedRoomFile = null;
  selectedPoint = null;
  roomPreview.removeAttribute("src");
  marker.hidden = true;
  coordsText.textContent = "Точка не выбрана";
  resetResult();
  updateEmptyHint();
  updateRenderButtonState();
  setStatus("Сцена очищена");
}

roomImageInput.addEventListener("change", handleRoomFileChange);
canvasSurface.addEventListener("click", handleCanvasClick);
renderBtn.addEventListener("click", handleRender);
clearBtn.addEventListener("click", handleClear);
uploadFurnitureBtn.addEventListener("click", handleFurnitureUpload);
searchInput.addEventListener("input", (event) => {
  searchQuery = (event.target.value || "").trim().toLowerCase();
  renderFurnitureGrid();
});

window.addEventListener("resize", () => {
  if (!selectedPoint || marker.hidden) return;
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return;
  marker.style.left = `${drawRect.left + selectedPoint.x * drawRect.drawW}px`;
  marker.style.top = `${drawRect.top + selectedPoint.y * drawRect.drawH}px`;
});

updateEmptyHint();
loadFurnitureCatalog().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
