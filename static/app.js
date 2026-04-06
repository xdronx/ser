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
let selectedFurnitureId = "";
let furnitureItems = [];
let selectedCategory = "all";
let searchQuery = "";

// Single active object on the scene (can be moved, resized, rotated)
let sceneObject = null; // { furnitureId, x, y, scale, rotation }
let sceneObjectEl = null;
let sceneObjectImg = null;
let sceneScaleLabel = null;
let sceneRotationLabel = null;
let isDraggingSceneObject = false;
const SNAP_THRESHOLD = 0.03; // 3% of image bounds

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
  renderBtn.disabled = !(selectedRoomFile && sceneObject && sceneObject.furnitureId);
}

function resetResult() {
  resultImage.removeAttribute("src");
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
}

function normalizeCategory(value) {
  return (value || "other").trim().toLowerCase() || "other";
}

function getFurnitureById(id) {
  return furnitureItems.find((item) => item.id === id) || null;
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
    card.setAttribute("draggable", "true");
    card.dataset.furnitureId = item.id;

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
      setStatus(`Выбрано: ${item.name}. Перетащи предмет на сцену.`);
    });

    card.addEventListener("dragstart", (event) => {
      selectedFurnitureId = item.id;
      renderFurnitureGrid();
      if (event.dataTransfer) {
        event.dataTransfer.setData("text/furniture-id", item.id);
        event.dataTransfer.effectAllowed = "copy";
      }
      canvasSurface.classList.add("drop-active");
    });

    card.addEventListener("dragend", () => {
      canvasSurface.classList.remove("drop-active");
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
  if (sceneObject && !furnitureItems.some((item) => item.id === sceneObject.furnitureId)) {
    sceneObject = null;
  }

  renderCategoryTabs();
  renderFurnitureGrid();
  renderSceneObject();
  updateRenderButtonState();
  setStatus("Каталог загружен");
}

function handleRoomFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    selectedRoomFile = null;
    roomPreview.removeAttribute("src");
    marker.hidden = true;
    sceneObject = null;
    removeSceneObjectElement();
    coordsText.textContent = "Точка не выбрана";
    updateEmptyHint();
    updateRenderButtonState();
    return;
  }

  selectedRoomFile = file;
  roomPreview.src = URL.createObjectURL(file);
  marker.hidden = true;
  sceneObject = null;
  removeSceneObjectElement();
  coordsText.textContent = "Перетащи мебель на сцену";
  resetResult();
  updateEmptyHint();
  setStatus("Фото загружено. Перетащи мебель из каталога на сцену.");
  updateRenderButtonState();
}

function getImageDrawRect(imgElement) {
  const naturalW = imgElement.naturalWidth;
  const naturalH = imgElement.naturalHeight;
  if (!naturalW || !naturalH) return null;

  const rect = canvasSurface.getBoundingClientRect();
  const fit = Math.min(rect.width / naturalW, rect.height / naturalH);
  const drawW = naturalW * fit;
  const drawH = naturalH * fit;
  const left = (rect.width - drawW) / 2;
  const top = (rect.height - drawH) / 2;
  return { left, top, drawW, drawH };
}

function eventToNormalized(clientX, clientY, clampOutside = false) {
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return null;

  const surfaceRect = canvasSurface.getBoundingClientRect();
  let sx = clientX - surfaceRect.left;
  let sy = clientY - surfaceRect.top;

  if (!clampOutside) {
    if (
      sx < drawRect.left ||
      sy < drawRect.top ||
      sx > drawRect.left + drawRect.drawW ||
      sy > drawRect.top + drawRect.drawH
    ) {
      return null;
    }
  }

  sx = clamp(sx, drawRect.left, drawRect.left + drawRect.drawW);
  sy = clamp(sy, drawRect.top, drawRect.top + drawRect.drawH);
  return {
    x: clamp((sx - drawRect.left) / drawRect.drawW, 0, 1),
    y: clamp((sy - drawRect.top) / drawRect.drawH, 0, 1),
  };
}

function getSceneObjectHalfSizeNormalized() {
  if (!sceneObject) return { halfW: 0, halfH: 0 };
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return { halfW: 0, halfH: 0 };
  const baseW = drawRect.drawW * 0.28;
  const widthPx = Math.max(40, Math.round(baseW * sceneObject.scale));
  const item = getFurnitureById(sceneObject.furnitureId);
  let ratio = 1;
  if (item) {
    // use a reasonable ratio until image natural size is available
    ratio = sceneObjectImg?.naturalWidth && sceneObjectImg?.naturalHeight
      ? sceneObjectImg.naturalHeight / sceneObjectImg.naturalWidth
      : 1.2;
  }
  const heightPx = widthPx * ratio;
  return {
    halfW: (widthPx / 2) / drawRect.drawW,
    halfH: heightPx / drawRect.drawH, // anchored by bottom
  };
}

function applySceneBoundsAndSnap() {
  if (!sceneObject) return;
  const { halfW, halfH } = getSceneObjectHalfSizeNormalized();

  // Keep object fully inside visible room image bounds.
  sceneObject.x = clamp(sceneObject.x, halfW, 1 - halfW);
  sceneObject.y = clamp(sceneObject.y, halfH, 1);

  // Snap to nearest wall/floor for realistic placement.
  if (sceneObject.x - halfW <= SNAP_THRESHOLD) {
    sceneObject.x = halfW;
  } else if (1 - (sceneObject.x + halfW) <= SNAP_THRESHOLD) {
    sceneObject.x = 1 - halfW;
  }
  if (1 - sceneObject.y <= SNAP_THRESHOLD) {
    sceneObject.y = 1;
  }
}

function ensureSceneObjectElement() {
  if (sceneObjectEl) return;

  sceneObjectEl = document.createElement("div");
  sceneObjectEl.className = "scene-object";
  sceneObjectEl.id = "sceneObject";

  sceneObjectImg = document.createElement("img");
  sceneObjectImg.alt = "Scene furniture object";
  sceneObjectImg.draggable = false;
  sceneObjectEl.appendChild(sceneObjectImg);

  const controls = document.createElement("div");
  controls.className = "scene-controls";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.title = "Уменьшить";
  minus.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustSceneScale(-0.1);
  });

  sceneScaleLabel = document.createElement("span");
  sceneScaleLabel.className = "scene-scale-label";
  sceneScaleLabel.textContent = "100%";

  sceneRotationLabel = document.createElement("span");
  sceneRotationLabel.className = "scene-rotation-label";
  sceneRotationLabel.textContent = "0°";

  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.title = "Увеличить";
  plus.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustSceneScale(0.1);
  });

  const rotateLeft = document.createElement("button");
  rotateLeft.type = "button";
  rotateLeft.textContent = "⟲";
  rotateLeft.title = "Повернуть влево";
  rotateLeft.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustSceneRotation(-5);
  });

  const rotateRight = document.createElement("button");
  rotateRight.type = "button";
  rotateRight.textContent = "⟳";
  rotateRight.title = "Повернуть вправо";
  rotateRight.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustSceneRotation(5);
  });

  controls.appendChild(minus);
  controls.appendChild(sceneScaleLabel);
  controls.appendChild(plus);
  controls.appendChild(rotateLeft);
  controls.appendChild(sceneRotationLabel);
  controls.appendChild(rotateRight);
  sceneObjectEl.appendChild(controls);

  sceneObjectEl.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".scene-controls")) return;
    isDraggingSceneObject = true;
    sceneObjectEl.classList.add("dragging");
    sceneObjectEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  sceneObjectEl.addEventListener("pointermove", (event) => {
    if (!isDraggingSceneObject || !sceneObject) return;
    const point = eventToNormalized(event.clientX, event.clientY, true);
    if (!point) return;
    sceneObject.x = point.x;
    sceneObject.y = point.y;
    applySceneBoundsAndSnap();
    renderSceneObject();
    resetResult();
    setStatus("Предмет перемещён");
  });
  sceneObjectEl.addEventListener("pointerup", (event) => {
    isDraggingSceneObject = false;
    sceneObjectEl.classList.remove("dragging");
    try {
      sceneObjectEl.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  });
  sceneObjectEl.addEventListener("pointercancel", () => {
    isDraggingSceneObject = false;
    sceneObjectEl.classList.remove("dragging");
  });
  sceneObjectEl.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.shiftKey) {
      const rot = event.deltaY > 0 ? -5 : 5;
      adjustSceneRotation(rot);
      return;
    }
    const delta = event.deltaY > 0 ? -0.05 : 0.05;
    adjustSceneScale(delta);
  });

  canvasSurface.appendChild(sceneObjectEl);
}

function removeSceneObjectElement() {
  if (!sceneObjectEl) return;
  sceneObjectEl.remove();
  sceneObjectEl = null;
  sceneObjectImg = null;
  sceneScaleLabel = null;
  sceneRotationLabel = null;
}

function placeSceneObject(furnitureId, x, y, scale = 1, rotation = 0) {
  const item = getFurnitureById(furnitureId);
  if (!item) return;
  sceneObject = {
    furnitureId,
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    scale: clamp(scale, 0.5, 2),
    rotation: clamp(rotation, -180, 180),
  };
  applySceneBoundsAndSnap();
  selectedFurnitureId = furnitureId;
  renderFurnitureGrid();
  renderSceneObject();
  updateRenderButtonState();
  resetResult();
  coordsText.textContent = `Точка: x=${sceneObject.x.toFixed(3)}, y=${sceneObject.y.toFixed(3)}`;
  setStatus(`Предмет "${item.name}" размещён на сцене`);
}

function renderSceneObject() {
  if (!sceneObject || !selectedRoomFile) {
    removeSceneObjectElement();
    return;
  }
  const item = getFurnitureById(sceneObject.furnitureId);
  const drawRect = getImageDrawRect(roomPreview);
  if (!item || !drawRect) {
    removeSceneObjectElement();
    return;
  }

  ensureSceneObjectElement();
  if (!sceneObjectEl || !sceneObjectImg || !sceneScaleLabel) return;

  const baseW = drawRect.drawW * 0.28;
  const width = Math.max(40, Math.round(baseW * sceneObject.scale));
  applySceneBoundsAndSnap();
  sceneObjectEl.style.width = `${width}px`;
  sceneObjectEl.style.left = `${drawRect.left + sceneObject.x * drawRect.drawW}px`;
  sceneObjectEl.style.top = `${drawRect.top + sceneObject.y * drawRect.drawH}px`;
  sceneObjectEl.style.transform = `translate(-50%, -100%) rotate(${sceneObject.rotation || 0}deg)`;

  sceneObjectImg.src = item.asset_url || "";
  sceneObjectImg.alt = item.name || "Furniture";
  sceneScaleLabel.textContent = `${Math.round(sceneObject.scale * 100)}%`;
  if (sceneRotationLabel) {
    sceneRotationLabel.textContent = `${Math.round(sceneObject.rotation || 0)}°`;
  }
}

function adjustSceneScale(delta) {
  if (!sceneObject) return;
  const next = clamp(sceneObject.scale + delta, 0.5, 2);
  sceneObject.scale = next;
  applySceneBoundsAndSnap();
  renderSceneObject();
  resetResult();
  setStatus(`Масштаб: ${Math.round(sceneObject.scale * 100)}% (мин. 50%)`);
}

function adjustSceneRotation(deltaDeg) {
  if (!sceneObject) return;
  const raw = (sceneObject.rotation || 0) + deltaDeg;
  let normalized = raw % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  sceneObject.rotation = normalized;
  renderSceneObject();
  resetResult();
  setStatus(`Поворот: ${Math.round(sceneObject.rotation)}°`);
}

function handleCanvasClick(event) {
  if (!selectedRoomFile || !roomPreview.getAttribute("src")) return;
  if (!selectedFurnitureId) {
    setStatus("Сначала выбери мебель в каталоге", true);
    return;
  }

  const point = eventToNormalized(event.clientX, event.clientY, false);
  if (!point) return;
  placeSceneObject(
    selectedFurnitureId,
    point.x,
    point.y,
    sceneObject?.scale || 1,
    sceneObject?.rotation || 0
  );
}

async function handleRender() {
  if (!selectedRoomFile || !sceneObject || !sceneObject.furnitureId) return;
  renderBtn.disabled = true;
  setStatus("Генерация...");
  resetResult();

  const formData = new FormData();
  formData.append("room_image", selectedRoomFile);
  formData.append("furniture_id", sceneObject.furnitureId);
  formData.append("x", sceneObject.x.toString());
  formData.append("y", sceneObject.y.toString());
  formData.append("scale", sceneObject.scale.toString());
  formData.append("rotation_deg", (sceneObject.rotation || 0).toString());

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
    newFurnitureName.value = "";
    newFurnitureImage.value = "";
    setUploadStatus(`Добавлено: ${data.item.name}`);
    setStatus(`Добавлено: ${data.item.name}. Перетащи предмет на сцену.`);
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
  sceneObject = null;
  removeSceneObjectElement();
  roomPreview.removeAttribute("src");
  marker.hidden = true;
  coordsText.textContent = "Точка не выбрана";
  resetResult();
  updateEmptyHint();
  updateRenderButtonState();
  setStatus("Сцена очищена");
}

function handleCanvasDrop(event) {
  event.preventDefault();
  canvasSurface.classList.remove("drop-active");

  if (!selectedRoomFile) {
    setStatus("Сначала загрузи фото комнаты", true);
    return;
  }

  let furnitureId = "";
  if (event.dataTransfer) {
    furnitureId = event.dataTransfer.getData("text/furniture-id");
  }
  if (!furnitureId) {
    furnitureId = selectedFurnitureId;
  }
  if (!furnitureId) return;

  const point = eventToNormalized(event.clientX, event.clientY, true) || { x: 0.5, y: 0.82 };
  placeSceneObject(
    furnitureId,
    point.x,
    point.y,
    sceneObject?.scale || 1,
    sceneObject?.rotation || 0
  );
}

roomImageInput.addEventListener("change", handleRoomFileChange);
canvasSurface.addEventListener("click", handleCanvasClick);
canvasSurface.addEventListener("dragover", (event) => {
  if (!selectedRoomFile) return;
  event.preventDefault();
  canvasSurface.classList.add("drop-active");
});
canvasSurface.addEventListener("dragleave", () => {
  canvasSurface.classList.remove("drop-active");
});
canvasSurface.addEventListener("drop", handleCanvasDrop);

renderBtn.addEventListener("click", handleRender);
clearBtn.addEventListener("click", handleClear);
uploadFurnitureBtn.addEventListener("click", handleFurnitureUpload);
searchInput.addEventListener("input", (event) => {
  searchQuery = (event.target.value || "").trim().toLowerCase();
  renderFurnitureGrid();
});

roomPreview.addEventListener("load", () => {
  updateEmptyHint();
  renderSceneObject();
});

window.addEventListener("resize", () => {
  renderSceneObject();
});

updateEmptyHint();
loadFurnitureCatalog().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
