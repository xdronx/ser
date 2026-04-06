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
const renderProgressWrap = document.getElementById("renderProgressWrap");
const renderProgressBar = document.getElementById("renderProgressBar");
const renderProgressPercent = document.getElementById("renderProgressPercent");
const renderProgressLabel = document.getElementById("renderProgressLabel");
const removeFurnitureBtn = document.getElementById("removeFurnitureBtn");
const confirmRemoveBtn = document.getElementById("confirmRemoveBtn");
const cancelRemoveBtn = document.getElementById("cancelRemoveBtn");
const removeSelectionBox = document.getElementById("removeSelectionBox");

const searchInput = document.getElementById("searchInput");
const categoryTabs = document.getElementById("categoryTabs");
const furnitureGrid = document.getElementById("furnitureGrid");

const newFurnitureName = document.getElementById("newFurnitureName");
const newFurnitureCategory = document.getElementById("newFurnitureCategory");
const newFurnitureImage = document.getElementById("newFurnitureImage");
const uploadFurnitureBtn = document.getElementById("uploadFurnitureBtn");
const uploadStatusText = document.getElementById("uploadStatusText");

const canvasSurface = document.querySelector(".canvas-surface");
const sceneObjectsLayer = document.getElementById("sceneObjectsLayer");
const snapGuideV = document.getElementById("snapGuideV");
const snapGuideH = document.getElementById("snapGuideH");
const layersList = document.getElementById("layersList");
const layersEmpty = document.getElementById("layersEmpty");

const MAX_SCENE_OBJECTS = 6;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2;
const SNAP_THRESHOLD = 0.03;
const BASE_OBJECT_WIDTH = 0.28;

let selectedRoomFile = null;
let selectedRoomUrl = "";
let selectedFurnitureId = "";
let furnitureItems = [];
let selectedCategory = "all";
let searchQuery = "";

let sceneObjects = [];
let activeSceneObjectId = null;
let manualLayerOrdering = false;
let activeSnapState = null;
let dragState = null;
let uidCounter = 1;
let isRendering = false;
let renderProgressValue = 0;
let renderProgressTimer = null;
let isRemoveMode = false;
let isSelectingRemoveArea = false;
let removeSelection = null; // normalized selection {x1,y1,x2,y2}
let removeSelectionStart = null;

const ratioCache = new Map();

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

function normalizeCategory(value) {
  return (value || "other").trim().toLowerCase() || "other";
}

function getFurnitureById(id) {
  return furnitureItems.find((item) => item.id === id) || null;
}

function getActiveSceneObject() {
  return sceneObjects.find((obj) => obj.id === activeSceneObjectId) || null;
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

function getFurnitureRatioById(furnitureId) {
  return ratioCache.get(furnitureId) || 1.2;
}

function getObjectHalfSizeNormalized(sceneObject, drawRect) {
  if (!sceneObject || !drawRect) return { halfW: 0, halfH: 0 };
  const widthPx = Math.max(40, Math.round(drawRect.drawW * BASE_OBJECT_WIDTH * sceneObject.scale));
  const ratio = getFurnitureRatioById(sceneObject.furnitureId);
  const heightPx = widthPx * ratio;
  return {
    halfW: (widthPx / 2) / drawRect.drawW,
    halfH: heightPx / drawRect.drawH,
  };
}

function applySceneBoundsAndSnap(sceneObject, drawRect) {
  const { halfW, halfH } = getObjectHalfSizeNormalized(sceneObject, drawRect);
  const snapState = { wall: null, floor: false };

  sceneObject.x = clamp(sceneObject.x, halfW, 1 - halfW);
  sceneObject.y = clamp(sceneObject.y, halfH, 1);

  if (sceneObject.x - halfW <= SNAP_THRESHOLD) {
    sceneObject.x = halfW;
    snapState.wall = "left";
  } else if (1 - (sceneObject.x + halfW) <= SNAP_THRESHOLD) {
    sceneObject.x = 1 - halfW;
    snapState.wall = "right";
  }
  if (1 - sceneObject.y <= SNAP_THRESHOLD) {
    sceneObject.y = 1;
    snapState.floor = true;
  }
  return snapState;
}

function hideSnapGuides() {
  snapGuideV.hidden = true;
  snapGuideH.hidden = true;
}

function updateSnapGuides(snapState, drawRect) {
  hideSnapGuides();
  if (!snapState || !drawRect) return;
  if (snapState.wall === "left") {
    snapGuideV.hidden = false;
    snapGuideV.style.left = `${drawRect.left}px`;
    snapGuideV.style.top = `${drawRect.top}px`;
    snapGuideV.style.height = `${drawRect.drawH}px`;
  }
  if (snapState.wall === "right") {
    snapGuideV.hidden = false;
    snapGuideV.style.left = `${drawRect.left + drawRect.drawW}px`;
    snapGuideV.style.top = `${drawRect.top}px`;
    snapGuideV.style.height = `${drawRect.drawH}px`;
  }
  if (snapState.floor) {
    snapGuideH.hidden = false;
    snapGuideH.style.left = `${drawRect.left}px`;
    snapGuideH.style.top = `${drawRect.top + drawRect.drawH}px`;
    snapGuideH.style.width = `${drawRect.drawW}px`;
  }
}

function updateEmptyHint() {
  emptyHint.classList.toggle("hidden", Boolean(roomPreview.getAttribute("src")));
}

function updateRenderButtonState() {
  renderBtn.disabled = isRendering || !(selectedRoomFile && sceneObjects.length > 0);
}

function updateRemoveButtonsState() {
  const enabled = Boolean(selectedRoomFile) && !isRendering;
  removeFurnitureBtn.disabled = !enabled;
  confirmRemoveBtn.disabled = !enabled || !removeSelection;
  cancelRemoveBtn.disabled = !enabled;
}

function resetResult() {
  resultImage.removeAttribute("src");
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
  if (!isRendering) {
    hideRenderProgress();
  }
}

function clearRenderProgressTimer() {
  if (renderProgressTimer) {
    clearInterval(renderProgressTimer);
    renderProgressTimer = null;
  }
}

function setRenderProgress(value, labelText = "") {
  renderProgressValue = clamp(Math.round(value), 0, 100);
  renderProgressWrap.hidden = false;
  renderProgressBar.style.width = `${renderProgressValue}%`;
  renderProgressPercent.textContent = `${renderProgressValue}%`;
  if (labelText) {
    renderProgressLabel.textContent = labelText;
  }
  setStatus(`${renderProgressLabel.textContent} ${renderProgressPercent.textContent}`);
}

function hideRenderProgress() {
  clearRenderProgressTimer();
  renderProgressValue = 0;
  renderProgressWrap.hidden = true;
  renderProgressBar.style.width = "0%";
  renderProgressPercent.textContent = "0%";
  renderProgressLabel.textContent = "Нейросеть работает...";
}

function hideRemoveSelectionBox() {
  removeSelectionBox.hidden = true;
}

function drawRemoveSelectionBox(selection) {
  const drawRect = getImageDrawRect(roomPreview);
  if (!selection || !drawRect) {
    hideRemoveSelectionBox();
    return;
  }
  const minX = Math.min(selection.x1, selection.x2);
  const minY = Math.min(selection.y1, selection.y2);
  const maxX = Math.max(selection.x1, selection.x2);
  const maxY = Math.max(selection.y1, selection.y2);

  const left = drawRect.left + minX * drawRect.drawW;
  const top = drawRect.top + minY * drawRect.drawH;
  const width = Math.max(1, (maxX - minX) * drawRect.drawW);
  const height = Math.max(1, (maxY - minY) * drawRect.drawH);

  removeSelectionBox.hidden = false;
  removeSelectionBox.style.left = `${left}px`;
  removeSelectionBox.style.top = `${top}px`;
  removeSelectionBox.style.width = `${width}px`;
  removeSelectionBox.style.height = `${height}px`;
}

function clearRemoveSelection() {
  removeSelection = null;
  removeSelectionStart = null;
  isSelectingRemoveArea = false;
  hideRemoveSelectionBox();
  updateRemoveButtonsState();
}

function setRemoveMode(next) {
  isRemoveMode = Boolean(next);
  canvasSurface.classList.toggle("remove-mode", isRemoveMode);
  if (isRemoveMode) {
    confirmRemoveBtn.hidden = false;
    cancelRemoveBtn.hidden = false;
    removeFurnitureBtn.hidden = true;
    setStatus("Режим удаления: выдели прямоугольник на фото.");
  } else {
    confirmRemoveBtn.hidden = true;
    cancelRemoveBtn.hidden = true;
    removeFurnitureBtn.hidden = false;
    clearRemoveSelection();
  }
  updateRemoveButtonsState();
}

function startProcessingProgress() {
  clearRenderProgressTimer();
  renderProgressTimer = setInterval(() => {
    if (renderProgressValue >= 95) return;
    const step = renderProgressValue < 80 ? 2 : 1;
    setRenderProgress(renderProgressValue + step, "Нейросеть обрабатывает изображение...");
  }, 550);
}

function sendRenderRequest(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/render", true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("loadstart", () => {
      setRenderProgress(3, "Подготовка и отправка в нейросеть...");
    });

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const uploadRatio = event.total > 0 ? event.loaded / event.total : 0;
      const progressValue = 5 + uploadRatio * 45;
      setRenderProgress(progressValue, "Загрузка изображения в нейросеть...");
    });

    xhr.upload.addEventListener("load", () => {
      setRenderProgress(Math.max(renderProgressValue, 50), "Нейросеть получила данные...");
      startProcessingProgress();
    });

    xhr.addEventListener("load", () => {
      clearRenderProgressTimer();
      const payload = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        setRenderProgress(100, "Готово! Финальное изображение получено.");
        resolve(payload);
        return;
      }
      const message = payload?.error || xhr.responseText || "Ошибка генерации";
      reject(new Error(message));
    });

    xhr.addEventListener("error", () => {
      clearRenderProgressTimer();
      reject(new Error("Сетевая ошибка при обращении к нейросети"));
    });

    xhr.addEventListener("abort", () => {
      clearRenderProgressTimer();
      reject(new Error("Запрос к нейросети был прерван"));
    });

    xhr.send(formData);
  });
}

function sendRemoveRequest(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/remove-furniture", true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("loadstart", () => {
      setRenderProgress(3, "Подготовка удаления мебели...");
    });

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const uploadRatio = event.total > 0 ? event.loaded / event.total : 0;
      setRenderProgress(5 + uploadRatio * 45, "Отправка выделенной области...");
    });

    xhr.upload.addEventListener("load", () => {
      setRenderProgress(Math.max(renderProgressValue, 50), "Удаляем мебель нейросетью...");
      startProcessingProgress();
    });

    xhr.addEventListener("load", () => {
      clearRenderProgressTimer();
      const payload = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        setRenderProgress(100, "Готово! Область очищена.");
        resolve(payload);
        return;
      }
      const message = payload?.error || xhr.responseText || "Ошибка удаления мебели";
      reject(new Error(message));
    });

    xhr.addEventListener("error", () => {
      clearRenderProgressTimer();
      reject(new Error("Сетевая ошибка при удалении мебели"));
    });

    xhr.addEventListener("abort", () => {
      clearRenderProgressTimer();
      reject(new Error("Запрос удаления мебели прерван"));
    });

    xhr.send(formData);
  });
}

function sortByLayerAsc(items) {
  return [...items].sort((a, b) => a.layerOrder - b.layerOrder);
}

function normalizeLayerOrders() {
  const ordered = sortByLayerAsc(sceneObjects);
  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].layerOrder = i;
  }
}

function autoLayerByYIfNeeded() {
  if (manualLayerOrdering) return;
  const ordered = [...sceneObjects].sort((a, b) => {
    if (a.y === b.y) return a.layerOrder - b.layerOrder;
    return a.y - b.y;
  });
  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].layerOrder = i;
  }
}

function setActiveSceneObject(id) {
  if (!sceneObjects.some((obj) => obj.id === id)) {
    activeSceneObjectId = null;
  } else {
    activeSceneObjectId = id;
  }
  const active = getActiveSceneObject();
  if (active) {
    coordsText.textContent = `Объект: x=${active.x.toFixed(3)}, y=${active.y.toFixed(3)}`;
  }
  renderSceneObjects();
  renderLayersPanel();
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

function getFilteredItems() {
  return furnitureItems.filter((item) => {
    const itemCategory = normalizeCategory(item.category);
    if (selectedCategory !== "all" && itemCategory !== selectedCategory) return false;
    if (!searchQuery) return true;
    return (item.name || "").toLowerCase().includes(searchQuery);
  });
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

function renderLayersPanel() {
  if (!sceneObjects.length) {
    layersEmpty.hidden = false;
    layersList.innerHTML = "";
    return;
  }
  layersEmpty.hidden = true;
  layersList.innerHTML = "";

  const topDown = sortByLayerAsc(sceneObjects).reverse();
  for (let i = 0; i < topDown.length; i += 1) {
    const obj = topDown[i];
    const item = getFurnitureById(obj.furnitureId);
    const isTop = i === 0;
    const isBottom = i === topDown.length - 1;

    const row = document.createElement("div");
    row.className = `layer-item ${obj.id === activeSceneObjectId ? "active" : ""}`;
    row.addEventListener("click", () => setActiveSceneObject(obj.id));

    const main = document.createElement("div");
    main.className = "layer-main";

    const badge = document.createElement("span");
    badge.className = "layer-badge";
    badge.textContent = `${obj.layerOrder + 1}`;

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = item?.name || obj.furnitureId;

    main.appendChild(badge);
    main.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "layer-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Выше";
    up.disabled = isTop;
    up.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(obj.id, +1);
    });

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Ниже";
    down.disabled = isBottom;
    down.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(obj.id, -1);
    });

    actions.appendChild(up);
    actions.appendChild(down);
    row.appendChild(main);
    row.appendChild(actions);
    layersList.appendChild(row);
  }
}

function moveLayer(sceneObjectId, delta) {
  if (!delta) return;
  const ordered = sortByLayerAsc(sceneObjects);
  const index = ordered.findIndex((obj) => obj.id === sceneObjectId);
  if (index < 0) return;
  const target = clamp(index + delta, 0, ordered.length - 1);
  if (target === index) return;

  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved);
  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].layerOrder = i;
  }
  manualLayerOrdering = true;
  sceneObjects = ordered;
  resetResult();
  setStatus("Порядок слоёв обновлён");
  renderSceneObjects();
  renderLayersPanel();
}

function createSceneObjectElement(sceneObject, drawRect) {
  const furniture = getFurnitureById(sceneObject.furnitureId);
  if (!furniture) return null;

  const el = document.createElement("div");
  el.className = `scene-object ${sceneObject.id === activeSceneObjectId ? "active" : ""}`;
  el.dataset.sceneObjectId = sceneObject.id;
  el.style.zIndex = String(20 + sceneObject.layerOrder);

  applySceneObjectElementGeometry(el, sceneObject, drawRect);

  const image = document.createElement("img");
  image.src = furniture.asset_url || "";
  image.alt = furniture.name || "Furniture";
  image.draggable = false;
  image.addEventListener("load", () => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      const ratio = image.naturalHeight / image.naturalWidth;
      ratioCache.set(sceneObject.furnitureId, clamp(ratio, 0.25, 6));
    }
  });

  const controls = document.createElement("div");
  controls.className = "scene-controls";

  const scaleDown = document.createElement("button");
  scaleDown.type = "button";
  scaleDown.textContent = "−";
  scaleDown.title = "Уменьшить";
  scaleDown.addEventListener("click", (event) => {
    event.stopPropagation();
    updateSceneObjectScale(sceneObject.id, -0.1);
  });

  const scaleLabel = document.createElement("span");
  scaleLabel.className = "scene-scale-label";
  scaleLabel.textContent = `${Math.round(sceneObject.scale * 100)}%`;

  const scaleUp = document.createElement("button");
  scaleUp.type = "button";
  scaleUp.textContent = "+";
  scaleUp.title = "Увеличить";
  scaleUp.addEventListener("click", (event) => {
    event.stopPropagation();
    updateSceneObjectScale(sceneObject.id, 0.1);
  });

  const rotateLeft = document.createElement("button");
  rotateLeft.type = "button";
  rotateLeft.textContent = "⟲";
  rotateLeft.title = "Повернуть влево";
  rotateLeft.addEventListener("click", (event) => {
    event.stopPropagation();
    updateSceneObjectRotation(sceneObject.id, -5);
  });

  const rotateLabel = document.createElement("span");
  rotateLabel.className = "scene-rotation-label";
  rotateLabel.textContent = `${Math.round(sceneObject.rotationDeg)}°`;

  const rotateRight = document.createElement("button");
  rotateRight.type = "button";
  rotateRight.textContent = "⟳";
  rotateRight.title = "Повернуть вправо";
  rotateRight.addEventListener("click", (event) => {
    event.stopPropagation();
    updateSceneObjectRotation(sceneObject.id, 5);
  });

  controls.appendChild(scaleDown);
  controls.appendChild(scaleLabel);
  controls.appendChild(scaleUp);
  controls.appendChild(rotateLeft);
  controls.appendChild(rotateLabel);
  controls.appendChild(rotateRight);

  const meta = document.createElement("div");
  meta.className = "scene-object-meta";
  meta.textContent = furniture.name || "Object";

  el.appendChild(image);
  el.appendChild(controls);
  el.appendChild(meta);

  el.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveSceneObject(sceneObject.id);
  });

  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".scene-controls")) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveSceneObject(sceneObject.id);
    dragState = { sceneObjectId: sceneObject.id, pointerId: event.pointerId };
    el.classList.add("dragging");
    el.setPointerCapture(event.pointerId);
  });

  el.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.sceneObjectId !== sceneObject.id) return;
    const point = eventToNormalized(event.clientX, event.clientY, true);
    const draw = getImageDrawRect(roomPreview);
    if (!point || !draw) return;
    const target = sceneObjects.find((obj) => obj.id === sceneObject.id);
    if (!target) return;
    target.x = point.x;
    target.y = point.y;
    activeSnapState = applySceneBoundsAndSnap(target, draw);
    applySceneObjectElementGeometry(el, target, draw);
    updateSnapGuides(activeSnapState, draw);
    coordsText.textContent = `Объект: x=${target.x.toFixed(3)}, y=${target.y.toFixed(3)}`;
    resetResult();
  });

  const finishDrag = (event) => {
    if (!dragState || dragState.sceneObjectId !== sceneObject.id) return;
    dragState = null;
    el.classList.remove("dragging");
    try {
      el.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    if (!manualLayerOrdering) {
      autoLayerByYIfNeeded();
    }
    normalizeLayerOrders();
    activeSnapState = null;
    hideSnapGuides();
    renderSceneObjects();
    renderLayersPanel();
    setStatus("Предмет перемещён");
  };
  el.addEventListener("pointerup", finishDrag);
  el.addEventListener("pointercancel", finishDrag);

  el.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      updateSceneObjectRotation(sceneObject.id, event.deltaY > 0 ? -5 : 5);
      return;
    }
    updateSceneObjectScale(sceneObject.id, event.deltaY > 0 ? -0.05 : 0.05);
  });

  return el;
}

function applySceneObjectElementGeometry(el, sceneObject, drawRect) {
  const widthPx = Math.max(40, Math.round(drawRect.drawW * BASE_OBJECT_WIDTH * sceneObject.scale));
  el.style.zIndex = String(20 + sceneObject.layerOrder);
  el.style.width = `${widthPx}px`;
  el.style.left = `${drawRect.left + sceneObject.x * drawRect.drawW}px`;
  el.style.top = `${drawRect.top + sceneObject.y * drawRect.drawH}px`;
  el.style.transform = `translate(-50%, -100%) rotate(${sceneObject.rotationDeg}deg)`;
}

function renderSceneObjects() {
  sceneObjectsLayer.innerHTML = "";

  if (!selectedRoomFile || !roomPreview.getAttribute("src") || !sceneObjects.length) {
    hideSnapGuides();
    return;
  }

  autoLayerByYIfNeeded();
  normalizeLayerOrders();
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) {
    hideSnapGuides();
    return;
  }

  const ordered = sortByLayerAsc(sceneObjects);
  for (const obj of ordered) {
    const snapState = activeSceneObjectId === obj.id && activeSnapState ? activeSnapState : null;
    applySceneBoundsAndSnap(obj, drawRect);
    const el = createSceneObjectElement(obj, drawRect);
    if (el) {
      sceneObjectsLayer.appendChild(el);
    }
    if (snapState) {
      updateSnapGuides(snapState, drawRect);
    }
  }
}

function updateSceneObjectScale(sceneObjectId, delta) {
  const target = sceneObjects.find((obj) => obj.id === sceneObjectId);
  const drawRect = getImageDrawRect(roomPreview);
  if (!target || !drawRect) return;
  target.scale = clamp(target.scale + delta, SCALE_MIN, SCALE_MAX);
  applySceneBoundsAndSnap(target, drawRect);
  renderSceneObjects();
  renderLayersPanel();
  resetResult();
  setStatus(`Масштаб: ${Math.round(target.scale * 100)}% (мин. 50%)`);
}

function updateSceneObjectRotation(sceneObjectId, deltaDeg) {
  const target = sceneObjects.find((obj) => obj.id === sceneObjectId);
  if (!target) return;
  const raw = target.rotationDeg + deltaDeg;
  let normalized = raw % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  target.rotationDeg = normalized;
  renderSceneObjects();
  renderLayersPanel();
  resetResult();
  setStatus(`Поворот: ${Math.round(target.rotationDeg)}°`);
}

function addSceneObject(furnitureId, x, y, scale = 1, rotationDeg = 0) {
  if (sceneObjects.length >= MAX_SCENE_OBJECTS) {
    setStatus(`Можно добавить максимум ${MAX_SCENE_OBJECTS} объектов`, true);
    return;
  }
  const furniture = getFurnitureById(furnitureId);
  const drawRect = getImageDrawRect(roomPreview);
  if (!furniture || !drawRect) return;

  const sceneObject = {
    id: `scene-${uidCounter++}`,
    furnitureId,
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    scale: clamp(scale, SCALE_MIN, SCALE_MAX),
    rotationDeg: clamp(rotationDeg, -180, 180),
    layerOrder: sceneObjects.length,
  };
  applySceneBoundsAndSnap(sceneObject, drawRect);
  sceneObjects.push(sceneObject);

  selectedFurnitureId = furnitureId;
  activeSceneObjectId = sceneObject.id;
  autoLayerByYIfNeeded();
  normalizeLayerOrders();
  renderFurnitureGrid();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  resetResult();
  coordsText.textContent = `Объект: x=${sceneObject.x.toFixed(3)}, y=${sceneObject.y.toFixed(3)}`;
  setStatus(`Предмет "${furniture.name}" добавлен на сцену`);
}

function handleCanvasClick(event) {
  if (isRemoveMode) return;
  if (event.target.closest(".scene-object")) return;
  if (!selectedRoomFile || !roomPreview.getAttribute("src")) return;
  if (!selectedFurnitureId) {
    setStatus("Сначала выбери мебель в каталоге", true);
    return;
  }
  const point = eventToNormalized(event.clientX, event.clientY, false);
  if (!point) return;
  const active = getActiveSceneObject();
  addSceneObject(
    selectedFurnitureId,
    point.x,
    point.y,
    active?.scale || 1,
    active?.rotationDeg || 0
  );
}

function handleCanvasDrop(event) {
  if (isRemoveMode) return;
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
  furnitureId = furnitureId || selectedFurnitureId;
  if (!furnitureId) return;

  const point = eventToNormalized(event.clientX, event.clientY, true) || { x: 0.5, y: 0.82 };
  const active = getActiveSceneObject();
  addSceneObject(
    furnitureId,
    point.x,
    point.y,
    active?.scale || 1,
    active?.rotationDeg || 0
  );
}

function handleRemovePointerDown(event) {
  if (!isRemoveMode || !selectedRoomFile || isRendering) return;
  if (event.target.closest(".scene-object")) return;
  const point = eventToNormalized(event.clientX, event.clientY, false);
  if (!point) return;
  isSelectingRemoveArea = true;
  removeSelectionStart = { x: point.x, y: point.y };
  removeSelection = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
  drawRemoveSelectionBox(removeSelection);
  updateRemoveButtonsState();
}

function handleRemovePointerMove(event) {
  if (!isRemoveMode || !isSelectingRemoveArea || !removeSelectionStart) return;
  const point = eventToNormalized(event.clientX, event.clientY, true);
  if (!point) return;
  removeSelection = {
    x1: removeSelectionStart.x,
    y1: removeSelectionStart.y,
    x2: point.x,
    y2: point.y,
  };
  drawRemoveSelectionBox(removeSelection);
  updateRemoveButtonsState();
}

function handleRemovePointerUp() {
  if (!isRemoveMode) return;
  if (!isSelectingRemoveArea || !removeSelection) return;
  isSelectingRemoveArea = false;
  const width = Math.abs(removeSelection.x2 - removeSelection.x1);
  const height = Math.abs(removeSelection.y2 - removeSelection.y1);
  if (width < 0.01 || height < 0.01) {
    clearRemoveSelection();
    setStatus("Слишком маленькая область. Выдели больше.", true);
    return;
  }
  drawRemoveSelectionBox(removeSelection);
  setStatus("Область выбрана. Нажми «Подтвердить удаление».");
  updateRemoveButtonsState();
}

async function handleConfirmRemove() {
  if (!isRemoveMode || !selectedRoomFile || !removeSelection || isRendering) return;
  isRendering = true;
  updateRenderButtonState();
  updateRemoveButtonsState();
  setRenderProgress(1, "Запуск удаления мебели...");

  const x1 = Math.min(removeSelection.x1, removeSelection.x2);
  const y1 = Math.min(removeSelection.y1, removeSelection.y2);
  const x2 = Math.max(removeSelection.x1, removeSelection.x2);
  const y2 = Math.max(removeSelection.y1, removeSelection.y2);

  const formData = new FormData();
  formData.append("room_image", selectedRoomFile);
  formData.append(
    "remove_box",
    JSON.stringify({
      x1,
      y1,
      x2,
      y2,
    })
  );

  try {
    const data = await sendRemoveRequest(formData);
    if (!data?.result_image_url) {
      throw new Error("Не удалось получить результат удаления");
    }
    resultImage.src = data.result_image_url;
    downloadLink.href = data.result_image_url;
    downloadLink.setAttribute("download", `room-clean-${Date.now()}.jpg`);
    downloadLink.hidden = false;

    const newRoomResponse = await fetch(data.result_image_url);
    if (!newRoomResponse.ok) {
      throw new Error("Не удалось загрузить обновлённое фото комнаты");
    }
    const blob = await newRoomResponse.blob();
    const filename = selectedRoomFile.name || "room-clean.jpg";
    selectedRoomFile = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
    selectedRoomUrl = URL.createObjectURL(blob);
    roomPreview.src = selectedRoomUrl;

    sceneObjects = [];
    activeSceneObjectId = null;
    manualLayerOrdering = false;
    renderSceneObjects();
    renderLayersPanel();
    updateRenderButtonState();
    setRemoveMode(false);
    setStatus("Готово! Старая мебель удалена, можешь добавлять новую.");
  } catch (error) {
    console.error(error);
    setRenderProgress(renderProgressValue, "Ошибка удаления");
    setStatus(`Ошибка: ${error.message}`, true);
  } finally {
    isRendering = false;
    updateRenderButtonState();
    updateRemoveButtonsState();
  }
}

function handleCancelRemove() {
  if (isRendering) return;
  setRemoveMode(false);
  setStatus("Режим удаления выключен.");
}

function removeUnknownSceneObjects() {
  const validFurnitureIds = new Set(furnitureItems.map((item) => item.id));
  sceneObjects = sceneObjects.filter((obj) => validFurnitureIds.has(obj.furnitureId));
  normalizeLayerOrders();
  if (!sceneObjects.some((obj) => obj.id === activeSceneObjectId)) {
    activeSceneObjectId = sceneObjects[0]?.id || null;
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
  removeUnknownSceneObjects();
  renderCategoryTabs();
  renderFurnitureGrid();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  setStatus("Каталог загружен");
}

function handleRoomFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
    selectedRoomUrl = "";
    selectedRoomFile = null;
    sceneObjects = [];
    activeSceneObjectId = null;
    roomPreview.removeAttribute("src");
    marker.hidden = true;
    hideSnapGuides();
    coordsText.textContent = "Точка не выбрана";
    updateEmptyHint();
    renderSceneObjects();
    renderLayersPanel();
    updateRenderButtonState();
    setRemoveMode(false);
    updateRemoveButtonsState();
    return;
  }

  if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
  selectedRoomUrl = URL.createObjectURL(file);
  selectedRoomFile = file;
  roomPreview.src = selectedRoomUrl;
  sceneObjects = [];
  activeSceneObjectId = null;
  manualLayerOrdering = false;
  marker.hidden = true;
  hideSnapGuides();
  coordsText.textContent = "Перетащи мебель на сцену";
  resetResult();
  updateEmptyHint();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  setRemoveMode(false);
  updateRemoveButtonsState();
  setStatus("Фото загружено. Перетащи мебель из каталога на сцену.");
}

async function handleRender() {
  if (!selectedRoomFile || !sceneObjects.length || isRendering) return;
  isRendering = true;
  updateRenderButtonState();
  setRenderProgress(1, "Запуск нейросети...");
  resetResult();

  const payloadSceneObjects = sortByLayerAsc(sceneObjects).map((obj) => ({
    id: obj.id,
    furniture_id: obj.furnitureId,
    x: obj.x,
    y: obj.y,
    scale: obj.scale,
    rotation_deg: obj.rotationDeg,
    layer_order: obj.layerOrder,
  }));

  const formData = new FormData();
  formData.append("room_image", selectedRoomFile);
  formData.append("scene_objects", JSON.stringify(payloadSceneObjects));

  try {
    const data = await sendRenderRequest(formData);
    resultImage.src = data.result_image_url;
    downloadLink.href = data.result_image_url;
    downloadLink.setAttribute("download", `result-${Date.now()}.jpg`);
    downloadLink.hidden = false;
    setStatus(`Готово! Режим: ${data.provider}`);
  } catch (error) {
    console.error(error);
    setRenderProgress(renderProgressValue, "Ошибка нейросети");
    setStatus(`Ошибка: ${error.message}`, true);
  } finally {
    isRendering = false;
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
  if (isRendering) return;
  roomImageInput.value = "";
  if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
  selectedRoomUrl = "";
  selectedRoomFile = null;
  sceneObjects = [];
  activeSceneObjectId = null;
  manualLayerOrdering = false;
  roomPreview.removeAttribute("src");
  marker.hidden = true;
  hideSnapGuides();
  coordsText.textContent = "Точка не выбрана";
  resetResult();
  updateEmptyHint();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  setRemoveMode(false);
  updateRemoveButtonsState();
  setStatus("Сцена очищена");
}

roomImageInput.addEventListener("change", handleRoomFileChange);
canvasSurface.addEventListener("click", handleCanvasClick);
canvasSurface.addEventListener("pointerdown", handleRemovePointerDown);
canvasSurface.addEventListener("pointermove", handleRemovePointerMove);
canvasSurface.addEventListener("pointerup", handleRemovePointerUp);
canvasSurface.addEventListener("pointercancel", handleRemovePointerUp);
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
removeFurnitureBtn.addEventListener("click", () => {
  if (!selectedRoomFile || isRendering) return;
  setRemoveMode(true);
});
confirmRemoveBtn.addEventListener("click", handleConfirmRemove);
cancelRemoveBtn.addEventListener("click", handleCancelRemove);
uploadFurnitureBtn.addEventListener("click", handleFurnitureUpload);
searchInput.addEventListener("input", (event) => {
  searchQuery = (event.target.value || "").trim().toLowerCase();
  renderFurnitureGrid();
});

roomPreview.addEventListener("load", () => {
  updateEmptyHint();
  renderSceneObjects();
  renderLayersPanel();
  if (isRemoveMode) {
    drawRemoveSelectionBox(removeSelection);
  }
});

window.addEventListener("resize", () => {
  renderSceneObjects();
});

updateEmptyHint();
hideSnapGuides();
renderLayersPanel();
updateRemoveButtonsState();
loadFurnitureCatalog().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
