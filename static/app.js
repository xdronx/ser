const roomImageInput = document.getElementById("roomImageInput");
const roomPreview = document.getElementById("roomPreview");
const resultImage = document.getElementById("resultImage");
const emptyHint = document.getElementById("emptyHint");
const coordsText = document.getElementById("coordsText");
const statusText = document.getElementById("statusText");
const renderBtn = document.getElementById("renderBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadLink = document.getElementById("downloadLink");
const workspace = document.querySelector(".workspace");
const renderProgressWrap = document.getElementById("renderProgressWrap");
const renderProgressBar = document.getElementById("renderProgressBar");
const renderProgressPercent = document.getElementById("renderProgressPercent");
const renderProgressLabel = document.getElementById("renderProgressLabel");
const modeInsertBtn = document.getElementById("modeInsertBtn");
const modeRemoveBtn = document.getElementById("modeRemoveBtn");
const modePanelBadge = document.getElementById("modePanelBadge");
const modePanelIcon = document.getElementById("modePanelIcon");
const modePanelLabel = document.getElementById("modePanelLabel");
const duplicateObjectBtn = document.getElementById("duplicateObjectBtn");
const deleteObjectBtn = document.getElementById("deleteObjectBtn");
const centerObjectBtn = document.getElementById("centerObjectBtn");
const resetSizeBtn = document.getElementById("resetSizeBtn");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const saveProjectBtn = document.getElementById("saveProjectBtn");
const loadProjectInput = document.getElementById("loadProjectInput");
const saveStateText = document.getElementById("saveStateText");

const removeRectBtn = document.getElementById("removeRectBtn");
const removeBrushBtn = document.getElementById("removeBrushBtn");
const removeEraserBtn = document.getElementById("removeEraserBtn");
const removeBrushSizeWrap = document.getElementById("removeBrushSizeWrap");
const removeBrushSize = document.getElementById("removeBrushSize");
const clearMaskBtn = document.getElementById("clearMaskBtn");
const confirmRemoveBtn = document.getElementById("confirmRemoveBtn");
const cancelRemoveBtn = document.getElementById("cancelRemoveBtn");
const removeSelectionBox = document.getElementById("removeSelectionBox");
const removeMaskCanvas = document.getElementById("removeMaskCanvas");

const compareWrap = document.getElementById("compareWrap");
const compareBeforeImage = document.getElementById("compareBeforeImage");
const compareAfterImage = document.getElementById("compareAfterImage");
const compareAfterClip = document.getElementById("compareAfterClip");
const compareDivider = document.getElementById("compareDivider");
const compareSlider = document.getElementById("compareSlider");
const comparePercentText = document.getElementById("comparePercentText");
const onboardingTips = document.getElementById("onboardingTips");
const hideOnboardingBtn = document.getElementById("hideOnboardingBtn");
const cursorHint = document.getElementById("cursorHint");

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
const MAX_HISTORY = 60;
const MAX_INPUT_ROOM_FILE_BYTES = 25 * 1024 * 1024; // hard upload cap before compression
const MAX_ROOM_DIMENSION_PX = 2048;
const TARGET_ROOM_FILE_BYTES = 2_500_000;
const AUTOSAVE_INTERVAL_MS = 25_000;
const AUTOSAVE_STORAGE_KEY = "furniture-mvp-autosave-v1";
const ONBOARDING_DISMISSED_STORAGE_KEY = "furniture-mvp-onboarding-dismissed-v1";

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
let removeModeTool = "rect"; // rect | brush | eraser
let isSelectingRemoveArea = false;
let removeSelection = null;
let removeSelectionStart = null;
let isPaintingMask = false;
let lastMaskPoint = null;
let maskDirty = false;
let layerDragSourceId = null;
let layerDropTargetId = null;
let layerDropBefore = true;

let beforeImageUrl = "";
let afterImageUrl = "";
let autosaveTimer = null;
let autosaveInFlight = false;
let lastAutoSavedVersion = -1;
let projectStateVersion = 0;
let cachedAutoSaveRoomDataUrl = "";
let cachedAutoSaveRoomSignature = "";
let maskVersion = 0;
let maskNeedsRecount = false;
let isProjectDirty = false;
let suppressProjectDirtySideEffects = false;

const ratioCache = new Map();
const historyPast = [];
const historyFuture = [];
let isRestoringHistory = false;

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
  return {
    left: (rect.width - drawW) / 2,
    top: (rect.height - drawH) / 2,
    drawW,
    drawH,
  };
}

function eventToSurfacePoint(clientX, clientY) {
  const rect = canvasSurface.getBoundingClientRect();
  return { sx: clientX - rect.left, sy: clientY - rect.top };
}

function eventToNormalized(clientX, clientY, clampOutside = false) {
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return null;
  let { sx, sy } = eventToSurfacePoint(clientX, clientY);
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
  if (snapState.wall === "left" || snapState.wall === "right") {
    snapGuideV.hidden = false;
    snapGuideV.style.left = `${snapState.wall === "left" ? drawRect.left : drawRect.left + drawRect.drawW}px`;
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

function updateUndoRedoButtons() {
  undoBtn.disabled = isRendering || historyPast.length === 0;
  redoBtn.disabled = isRendering || historyFuture.length === 0;
}

function updateRemoveButtonsState() {
  const enabled = Boolean(selectedRoomFile) && !isRendering;
  modeInsertBtn.disabled = isRendering;
  modeRemoveBtn.disabled = !enabled;
  const hasRect = Boolean(removeSelection);
  const hasMask = maskDirty;
  confirmRemoveBtn.disabled = !enabled || (!hasRect && !hasMask);
  cancelRemoveBtn.disabled = !enabled;
  removeRectBtn.disabled = !enabled;
  removeBrushBtn.disabled = !enabled;
  removeEraserBtn.disabled = !enabled;
  clearMaskBtn.disabled = !enabled || !hasMask;
  updateQuickActionButtons();
}

function updateSaveStateIndicator() {
  if (!saveStateText) return;
  saveStateText.textContent = isProjectDirty ? "Есть изменения" : "Сохранено";
  saveStateText.classList.toggle("dirty", isProjectDirty);
  saveStateText.classList.toggle("saved", !isProjectDirty);
}

function setProjectDirty(nextDirty) {
  const next = Boolean(nextDirty);
  if (next && !suppressProjectDirtySideEffects) projectStateVersion += 1;
  if (next === isProjectDirty) return;
  isProjectDirty = next;
  updateSaveStateIndicator();
}

function updateQuickActionButtons() {
  const active = getActiveSceneObject();
  const enabled = Boolean(active) && !isRendering && !isRemoveMode;
  duplicateObjectBtn.disabled = !enabled || sceneObjects.length >= MAX_SCENE_OBJECTS;
  deleteObjectBtn.disabled = !enabled;
  centerObjectBtn.disabled = !enabled;
  resetSizeBtn.disabled = !enabled;
}

function duplicateActiveObject() {
  const active = getActiveSceneObject();
  if (!active || isRendering) return;
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return;
  const dx = 0.03;
  const dy = 0.03;
  addSceneObject(active.furnitureId, clamp(active.x + dx, 0, 1), clamp(active.y + dy, 0, 1), active.scale, active.rotationDeg);
  setProjectDirty(true);
  setStatus("Объект дублирован");
}

function deleteActiveObject() {
  const active = getActiveSceneObject();
  if (!active || isRendering) return;
  const idx = sceneObjects.findIndex((obj) => obj.id === active.id);
  if (idx < 0) return;
  pushHistory();
  sceneObjects.splice(idx, 1);
  normalizeLayerOrders();
  activeSceneObjectId = sceneObjects[Math.max(0, idx - 1)]?.id || sceneObjects[0]?.id || null;
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  updateUndoRedoButtons();
  updateQuickActionButtons();
  setProjectDirty(true);
  resetResult();
  setStatus("Объект удалён");
}

function centerActiveObject() {
  const active = getActiveSceneObject();
  const drawRect = getImageDrawRect(roomPreview);
  if (!active || !drawRect || isRendering) return;
  pushHistory();
  active.x = 0.5;
  active.y = 1;
  applySceneBoundsAndSnap(active, drawRect);
  renderSceneObjects();
  renderLayersPanel();
  updateUndoRedoButtons();
  updateQuickActionButtons();
  setProjectDirty(true);
  resetResult();
  setStatus("Объект выровнен по центру");
}

function resetActiveObjectScale() {
  const active = getActiveSceneObject();
  const drawRect = getImageDrawRect(roomPreview);
  if (!active || !drawRect || isRendering) return;
  pushHistory();
  active.scale = 1;
  applySceneBoundsAndSnap(active, drawRect);
  renderSceneObjects();
  renderLayersPanel();
  updateUndoRedoButtons();
  updateQuickActionButtons();
  setProjectDirty(true);
  resetResult();
  setStatus("Размер объекта сброшен");
}

function updateModeUI() {
  const removeActive = isRemoveMode;
  workspace.classList.toggle("mode-remove", removeActive);
  workspace.classList.toggle("mode-insert", !removeActive);
  canvasSurface.classList.toggle("remove-mode", removeActive);
  modeInsertBtn.classList.toggle("active", !removeActive);
  modeRemoveBtn.classList.toggle("active", removeActive);
  modeInsertBtn.setAttribute("aria-selected", String(!removeActive));
  modeRemoveBtn.setAttribute("aria-selected", String(removeActive));
  modePanelBadge.classList.toggle("mode-remove", removeActive);
  modePanelBadge.classList.toggle("mode-insert", !removeActive);
  modePanelIcon.textContent = removeActive ? "🧹" : "🛋️";
  modePanelLabel.textContent = removeActive ? "Режим: Удаление мебели" : "Режим: Вставка мебели";
}

function isOnboardingDismissed() {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function updateOnboardingVisibility() {
  if (!onboardingTips) return;
  onboardingTips.hidden = isOnboardingDismissed();
}

function dismissOnboardingForever() {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // ignore storage failures
  }
  updateOnboardingVisibility();
  setStatus("Подсказки скрыты. Можно включить их позже через localStorage.");
}

function getCursorHintText() {
  if (isRemoveMode) {
    if (removeModeTool === "brush") return "Удаление: веди кистью по мебели";
    if (removeModeTool === "eraser") return "Ластик: стирай область маски";
    return "Удаление: протяни прямоугольник по мебели";
  }
  return selectedFurnitureId
    ? "Вставка: кликни по сцене, чтобы добавить мебель"
    : "Вставка: сначала выбери мебель в каталоге";
}

function updateCursorHintPosition(clientX, clientY) {
  if (!cursorHint || !canvasSurface) return;
  const rect = canvasSurface.getBoundingClientRect();
  const localX = clamp(clientX - rect.left + 14, 8, Math.max(8, rect.width - 220));
  const localY = clamp(clientY - rect.top + 14, 8, Math.max(8, rect.height - 40));
  cursorHint.style.left = `${localX}px`;
  cursorHint.style.top = `${localY}px`;
}

function updateCursorHintVisibility(visible) {
  if (!cursorHint) return;
  if (!visible || !selectedRoomFile || isRendering) {
    cursorHint.hidden = true;
    cursorHint.classList.remove("mode-remove");
    return;
  }
  cursorHint.hidden = false;
  cursorHint.textContent = getCursorHintText();
  cursorHint.classList.toggle("mode-remove", isRemoveMode);
}

function resetResult() {
  const hasResultImage = Boolean(resultImage.getAttribute("src"));
  if (!hasResultImage && downloadLink.hidden && compareWrap.hidden && (!isRendering || renderProgressWrap.hidden)) return;
  resultImage.removeAttribute("src");
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
  hideCompare();
  if (!isRendering) hideRenderProgress();
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
  if (labelText) renderProgressLabel.textContent = labelText;
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

function startProcessingProgress(label = "Нейросеть обрабатывает изображение...") {
  clearRenderProgressTimer();
  renderProgressTimer = setInterval(() => {
    if (renderProgressValue >= 95) return;
    const step = renderProgressValue < 80 ? 2 : 1;
    setRenderProgress(renderProgressValue + step, label);
  }, 550);
}

function updateCompareUI() {
  const percent = Number(compareSlider.value || 50);
  comparePercentText.textContent = `${percent}%`;
  compareAfterClip.style.width = `${percent}%`;
  compareDivider.style.left = `${percent}%`;
}

function showCompare(beforeUrl, afterUrl) {
  beforeImageUrl = beforeUrl || "";
  afterImageUrl = afterUrl || "";
  if (!beforeImageUrl || !afterImageUrl) {
    hideCompare();
    return;
  }
  compareBeforeImage.src = beforeImageUrl;
  compareAfterImage.src = afterImageUrl;
  compareWrap.hidden = false;
  updateCompareUI();
}

function hideCompare() {
  compareWrap.hidden = true;
  compareBeforeImage.removeAttribute("src");
  compareAfterImage.removeAttribute("src");
  beforeImageUrl = "";
  afterImageUrl = "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl, filename = "room.jpg", mimeType = "image/jpeg") {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Не удалось прочитать data_url изображения");
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || mimeType });
}

function getCurrentProjectPayload(roomDataUrl = "") {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    room: roomDataUrl
      ? {
          name: selectedRoomFile?.name || "room.jpg",
          type: selectedRoomFile?.type || "image/jpeg",
          data_url: roomDataUrl,
        }
      : null,
    scene_objects: sceneObjects.map((obj) => ({ ...obj })),
    active_scene_object_id: activeSceneObjectId,
    manual_layer_ordering: manualLayerOrdering,
    selected_furniture_id: selectedFurnitureId,
    selected_category: selectedCategory,
    search_query: searchQuery,
    remove_mode_tool: removeModeTool,
    remove_mask_data_url: maskDirty ? maskCanvasToDataUrl() : "",
  };
}

function getRoomFileSignature(file) {
  if (!file) return "";
  return `${file.name}|${file.size}|${file.type}|${file.lastModified}`;
}

async function compressRoomImageFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Можно загрузить только изображение");
  }
  if (file.size <= TARGET_ROOM_FILE_BYTES && file.size <= MAX_INPUT_ROOM_FILE_BYTES) {
    return file;
  }

  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    img.src = dataUrl;
  });

  const longSide = Math.max(image.width, image.height);
  const scale = longSide > MAX_ROOM_DIMENSION_PX ? MAX_ROOM_DIMENSION_PX / longSide : 1;
  const targetW = Math.max(1, Math.round(image.width * scale));
  const targetH = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен для сжатия изображения");
  ctx.drawImage(image, 0, 0, targetW, targetH);

  let quality = 0.9;
  let resultBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  while (resultBlob && resultBlob.size > TARGET_ROOM_FILE_BYTES && quality > 0.45) {
    quality -= 0.08;
    resultBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!resultBlob) {
    throw new Error("Не удалось сжать изображение");
  }
  return new File([resultBlob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function persistAutoSavedProject() {
  if (!selectedRoomFile || isRendering || autosaveInFlight) return;
  const roomSignature = getRoomFileSignature(selectedRoomFile);
  if (projectStateVersion === lastAutoSavedVersion && cachedAutoSaveRoomSignature === roomSignature) return;
  autosaveInFlight = true;
  try {
    if (!cachedAutoSaveRoomDataUrl || cachedAutoSaveRoomSignature !== roomSignature) {
      cachedAutoSaveRoomDataUrl = await fileToDataUrl(selectedRoomFile);
      cachedAutoSaveRoomSignature = roomSignature;
    }
    const payload = getCurrentProjectPayload(cachedAutoSaveRoomDataUrl);
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(payload));
    lastAutoSavedVersion = projectStateVersion;
  } catch (error) {
    console.warn("Autosave skipped:", error);
  } finally {
    autosaveInFlight = false;
  }
}

function startAutoSaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    persistAutoSavedProject();
  }, AUTOSAVE_INTERVAL_MS);
}

async function restoreAutoSavedProject() {
  const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
  if (!raw) return;
  try {
    const project = JSON.parse(raw);
    if (!project?.room?.data_url) return;
    await applyLoadedProject(project, true);
    setStatus("Восстановлен автосохранённый проект");
  } catch (error) {
    console.warn("Failed to restore autosave:", error);
  }
}

function getHistorySnapshot() {
  return {
    sceneObjects: sceneObjects.map((obj) => ({ ...obj })),
    activeSceneObjectId,
    manualLayerOrdering,
    selectedFurnitureId,
    removeModeTool,
  };
}

function applyHistorySnapshot(snapshot) {
  sceneObjects = (snapshot.sceneObjects || []).map((obj) => ({ ...obj }));
  activeSceneObjectId = snapshot.activeSceneObjectId || null;
  manualLayerOrdering = Boolean(snapshot.manualLayerOrdering);
  selectedFurnitureId = snapshot.selectedFurnitureId || selectedFurnitureId;
  removeModeTool = snapshot.removeModeTool || removeModeTool;
  renderFurnitureGrid();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  updateRemoveToolButtons();
}

function pushHistory() {
  if (isRestoringHistory) return;
  historyPast.push(getHistorySnapshot());
  if (historyPast.length > MAX_HISTORY) historyPast.shift();
  historyFuture.length = 0;
  setProjectDirty(true);
  updateUndoRedoButtons();
}

function undoHistory() {
  if (!historyPast.length || isRendering) return;
  const current = getHistorySnapshot();
  const prev = historyPast.pop();
  historyFuture.push(current);
  isRestoringHistory = true;
  applyHistorySnapshot(prev);
  isRestoringHistory = false;
  updateUndoRedoButtons();
  setStatus("Отменено");
}

function redoHistory() {
  if (!historyFuture.length || isRendering) return;
  const current = getHistorySnapshot();
  const next = historyFuture.pop();
  historyPast.push(current);
  isRestoringHistory = true;
  applyHistorySnapshot(next);
  isRestoringHistory = false;
  updateUndoRedoButtons();
  setStatus("Возвращено");
}

function sortByLayerAsc(items) {
  return [...items].sort((a, b) => a.layerOrder - b.layerOrder);
}

function getSceneObjectById(sceneObjectId) {
  return sceneObjects.find((obj) => obj.id === sceneObjectId) || null;
}

function normalizeLayerOrders() {
  const ordered = sortByLayerAsc(sceneObjects);
  for (let i = 0; i < ordered.length; i += 1) ordered[i].layerOrder = i;
}

function autoLayerByYIfNeeded() {
  if (manualLayerOrdering) return;
  const ordered = [...sceneObjects].sort((a, b) => (a.y === b.y ? a.layerOrder - b.layerOrder : a.y - b.y));
  for (let i = 0; i < ordered.length; i += 1) ordered[i].layerOrder = i;
}

function updateLayerDropHint() {
  const rows = layersList.querySelectorAll(".layer-item");
  rows.forEach((row) => {
    row.classList.remove("dragging", "drop-before", "drop-after");
    if (row.dataset.layerId === layerDragSourceId) row.classList.add("dragging");
  });
  if (!layerDragSourceId || !layerDropTargetId || layerDropTargetId === layerDragSourceId) return;
  rows.forEach((row) => {
    if (row.dataset.layerId === layerDropTargetId) row.classList.add(layerDropBefore ? "drop-before" : "drop-after");
  });
}

function setLayerDropTarget(layerId, before) {
  layerDropTargetId = layerId || null;
  layerDropBefore = Boolean(before);
  updateLayerDropHint();
}

function clearLayerDragState() {
  layerDragSourceId = null;
  layerDropTargetId = null;
  layerDropBefore = true;
  updateLayerDropHint();
}

function reorderLayerByDrag(draggedId, targetId, before) {
  if (!draggedId || !targetId || draggedId === targetId) return false;
  const topDown = sortByLayerAsc(sceneObjects).reverse();
  const fromIndex = topDown.findIndex((obj) => obj.id === draggedId);
  const targetIndex = topDown.findIndex((obj) => obj.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return false;
  let insertIndex = targetIndex + (before ? 0 : 1);
  if (fromIndex < insertIndex) insertIndex -= 1;
  if (insertIndex === fromIndex) return false;
  const [moved] = topDown.splice(fromIndex, 1);
  topDown.splice(clamp(insertIndex, 0, topDown.length), 0, moved);
  const asc = [...topDown].reverse();
  for (let i = 0; i < asc.length; i += 1) asc[i].layerOrder = i;
  sceneObjects = asc;
  manualLayerOrdering = true;
  return true;
}

function setActiveSceneObject(id) {
  activeSceneObjectId = sceneObjects.some((obj) => obj.id === id) ? id : null;
  const active = getActiveSceneObject();
  if (active) coordsText.textContent = `Объект: x=${active.x.toFixed(3)}, y=${active.y.toFixed(3)}`;
  renderSceneObjects();
  renderLayersPanel();
  updateQuickActionButtons();
}

function renderCategoryTabs() {
  const counts = new Map();
  for (const item of furnitureItems) {
    const key = normalizeCategory(item.category);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const categories = [{ id: "all", label: "Все" }, ...Array.from(counts.keys()).sort().map((k) => ({ id: k, label: k }))];
  if (!categories.some((cat) => cat.id === selectedCategory)) selectedCategory = "all";
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
    const cat = normalizeCategory(item.category);
    if (selectedCategory !== "all" && cat !== selectedCategory) return false;
    return !searchQuery || (item.name || "").toLowerCase().includes(searchQuery);
  });
}

function renderFurnitureGrid() {
  const items = getFilteredItems();
  furnitureGrid.innerHTML = "";
  if (!items.length) {
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
    card.draggable = true;
    card.dataset.furnitureId = item.id;
    card.innerHTML = `
      <div class="furniture-preview"><img alt="${item.name || "Мебель"}" src="${item.asset_url || ""}" /></div>
      <p class="furniture-title">${item.name || "Без названия"}</p>
      <p class="furniture-meta">${normalizeCategory(item.category).toUpperCase()}</p>
    `;
    card.addEventListener("click", () => {
      selectedFurnitureId = item.id;
      renderFurnitureGrid();
      setStatus(`Выбрано: ${item.name}. Перетащи предмет на сцену.`);
      updateCursorHintVisibility(!cursorHint.hidden);
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
    card.addEventListener("dragend", () => canvasSurface.classList.remove("drop-active"));
    furnitureGrid.appendChild(card);
  }
}

function renderLayersPanel() {
  if (!sceneObjects.length) {
    layersEmpty.hidden = false;
    layersList.innerHTML = "";
    clearLayerDragState();
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
    row.dataset.layerId = obj.id;
    row.draggable = true;
    row.addEventListener("click", () => setActiveSceneObject(obj.id));
    row.addEventListener("dragstart", (event) => {
      if (isRendering) {
        event.preventDefault();
        return;
      }
      layerDragSourceId = obj.id;
      setLayerDropTarget(obj.id, true);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/layer-id", obj.id);
      }
      updateLayerDropHint();
    });
    row.addEventListener("dragover", (event) => {
      if (!layerDragSourceId) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      setLayerDropTarget(obj.id, before);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      if (!layerDragSourceId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      pushHistory();
      const changed = reorderLayerByDrag(layerDragSourceId, obj.id, before);
      clearLayerDragState();
      if (changed) {
        resetResult();
        renderSceneObjects();
        setStatus("Порядок слоёв обновлён");
      }
      renderLayersPanel();
      updateUndoRedoButtons();
    });
    row.addEventListener("dragend", () => {
      clearLayerDragState();
      renderLayersPanel();
    });

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
  updateLayerDropHint();
}

function moveLayer(sceneObjectId, delta) {
  if (!delta) return;
  const ordered = sortByLayerAsc(sceneObjects);
  const index = ordered.findIndex((obj) => obj.id === sceneObjectId);
  if (index < 0) return;
  const target = clamp(index + delta, 0, ordered.length - 1);
  if (target === index) return;
  pushHistory();
  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved);
  for (let i = 0; i < ordered.length; i += 1) ordered[i].layerOrder = i;
  manualLayerOrdering = true;
  sceneObjects = ordered;
  resetResult();
  setStatus("Порядок слоёв обновлён");
  renderSceneObjects();
  renderLayersPanel();
  updateUndoRedoButtons();
}

function applySceneObjectElementGeometry(el, sceneObject, drawRect) {
  const widthPx = Math.max(40, Math.round(drawRect.drawW * BASE_OBJECT_WIDTH * sceneObject.scale));
  el.style.zIndex = String(20 + sceneObject.layerOrder);
  el.style.width = `${widthPx}px`;
  el.style.left = `${drawRect.left + sceneObject.x * drawRect.drawW}px`;
  el.style.top = `${drawRect.top + sceneObject.y * drawRect.drawH}px`;
  el.style.transform = `translate(-50%, -100%) rotate(${sceneObject.rotationDeg}deg)`;
}

function createSceneObjectElement(sceneObject, drawRect) {
  const furniture = getFurnitureById(sceneObject.furnitureId);
  if (!furniture) return null;
  const el = document.createElement("div");
  el.className = `scene-object ${sceneObject.id === activeSceneObjectId ? "active" : ""}`;
  el.dataset.sceneObjectId = sceneObject.id;
  applySceneObjectElementGeometry(el, sceneObject, drawRect);

  const image = document.createElement("img");
  image.src = furniture.asset_url || "";
  image.alt = furniture.name || "Furniture";
  image.draggable = false;
  image.addEventListener("load", () => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      ratioCache.set(sceneObject.furnitureId, clamp(image.naturalHeight / image.naturalWidth, 0.25, 6));
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
  controls.append(scaleDown, scaleLabel, scaleUp, rotateLeft, rotateLabel, rotateRight);

  const meta = document.createElement("div");
  meta.className = "scene-object-meta";
  meta.textContent = furniture.name || "Object";

  el.append(image, controls, meta);
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveSceneObject(sceneObject.id);
  });
  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".scene-controls")) return;
    event.preventDefault();
    event.stopPropagation();
    pushHistory();
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
    const target = getSceneObjectById(sceneObject.id);
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
      // ignore
    }
    if (!manualLayerOrdering) autoLayerByYIfNeeded();
    normalizeLayerOrders();
    activeSnapState = null;
    hideSnapGuides();
    renderSceneObjects();
    renderLayersPanel();
    updateUndoRedoButtons();
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
    if (el) sceneObjectsLayer.appendChild(el);
    if (snapState) updateSnapGuides(snapState, drawRect);
  }
}

function updateSceneObjectScale(sceneObjectId, delta) {
  const target = getSceneObjectById(sceneObjectId);
  const drawRect = getImageDrawRect(roomPreview);
  if (!target || !drawRect) return;
  pushHistory();
  target.scale = clamp(target.scale + delta, SCALE_MIN, SCALE_MAX);
  applySceneBoundsAndSnap(target, drawRect);
  renderSceneObjects();
  renderLayersPanel();
  resetResult();
  updateUndoRedoButtons();
  setStatus(`Масштаб: ${Math.round(target.scale * 100)}% (мин. 50%)`);
}

function updateSceneObjectRotation(sceneObjectId, deltaDeg) {
  const target = getSceneObjectById(sceneObjectId);
  if (!target) return;
  pushHistory();
  const raw = target.rotationDeg + deltaDeg;
  let normalized = raw % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  target.rotationDeg = normalized;
  renderSceneObjects();
  renderLayersPanel();
  resetResult();
  updateUndoRedoButtons();
  setStatus(`Поворот: ${Math.round(target.rotationDeg)}°`);
}

function addSceneObject(furnitureId, x, y, scale = 1, rotationDeg = 0, options = {}) {
  if (sceneObjects.length >= MAX_SCENE_OBJECTS) {
    setStatus(`Можно добавить максимум ${MAX_SCENE_OBJECTS} объектов`, true);
    return;
  }
  const furniture = getFurnitureById(furnitureId);
  const drawRect = getImageDrawRect(roomPreview);
  if (!furniture || !drawRect) return;
  pushHistory();
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
  updateUndoRedoButtons();
  updateQuickActionButtons();
  if (options.markDirty !== false) setProjectDirty(true);
  coordsText.textContent = `Объект: x=${sceneObject.x.toFixed(3)}, y=${sceneObject.y.toFixed(3)}`;
  setStatus(`Предмет "${furniture.name}" добавлен на сцену`);
}

function clearMaskCanvas() {
  const ctx = removeMaskCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, removeMaskCanvas.width, removeMaskCanvas.height);
  maskDirty = false;
  maskNeedsRecount = false;
  maskVersion += 1;
  updateRemoveButtonsState();
}

function resizeMaskCanvas() {
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) {
    removeMaskCanvas.hidden = true;
    return;
  }
  const width = Math.max(1, Math.round(drawRect.drawW));
  const height = Math.max(1, Math.round(drawRect.drawH));
  if (removeMaskCanvas.width !== width || removeMaskCanvas.height !== height) {
    const old = document.createElement("canvas");
    old.width = removeMaskCanvas.width;
    old.height = removeMaskCanvas.height;
    const oldCtx = old.getContext("2d");
    const currentCtx = removeMaskCanvas.getContext("2d");
    if (oldCtx && currentCtx) oldCtx.drawImage(removeMaskCanvas, 0, 0);
    removeMaskCanvas.width = width;
    removeMaskCanvas.height = height;
    const ctx = removeMaskCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      if (old.width > 0 && old.height > 0) ctx.drawImage(old, 0, 0, width, height);
    }
  }
  removeMaskCanvas.style.left = `${drawRect.left}px`;
  removeMaskCanvas.style.top = `${drawRect.top}px`;
  removeMaskCanvas.style.width = `${drawRect.drawW}px`;
  removeMaskCanvas.style.height = `${drawRect.drawH}px`;
}

function updateRemoveToolButtons() {
  removeRectBtn.classList.toggle("active", removeModeTool === "rect");
  removeBrushBtn.classList.toggle("active", removeModeTool === "brush");
  removeEraserBtn.classList.toggle("active", removeModeTool === "eraser");
  updateCursorHintVisibility(!cursorHint.hidden);
}

function setRemoveMode(next) {
  isRemoveMode = Boolean(next);
  updateModeUI();
  const prevDirty = isProjectDirty;
  const prevSuppress = suppressProjectDirtySideEffects;
  suppressProjectDirtySideEffects = true;
  if (isRemoveMode) {
    confirmRemoveBtn.hidden = false;
    cancelRemoveBtn.hidden = false;
    removeRectBtn.hidden = false;
    removeBrushBtn.hidden = false;
    removeEraserBtn.hidden = false;
    removeBrushSizeWrap.hidden = false;
    clearMaskBtn.hidden = false;
    resizeMaskCanvas();
    removeMaskCanvas.hidden = false;
    setStatus("Режим удаления: прямоугольник, кисть или ластик.");
  } else {
    confirmRemoveBtn.hidden = true;
    cancelRemoveBtn.hidden = true;
    removeRectBtn.hidden = true;
    removeBrushBtn.hidden = true;
    removeEraserBtn.hidden = true;
    removeBrushSizeWrap.hidden = true;
    clearMaskBtn.hidden = true;
    clearRemoveSelection();
    clearMaskCanvas();
    removeMaskCanvas.hidden = true;
  }
  suppressProjectDirtySideEffects = prevSuppress;
  updateRemoveToolButtons();
  updateRemoveButtonsState();
  setProjectDirty(prevDirty);
  updateCursorHintVisibility(!cursorHint.hidden);
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

function recomputeMaskDirtyFromCanvas() {
  const ctx = removeMaskCanvas.getContext("2d");
  if (!ctx || removeMaskCanvas.width <= 0 || removeMaskCanvas.height <= 0) {
    maskDirty = false;
    return;
  }
  const sample = ctx.getImageData(0, 0, removeMaskCanvas.width, removeMaskCanvas.height).data;
  let any = false;
  for (let i = 3; i < sample.length; i += 4) {
    if (sample[i] > 0) {
      any = true;
      break;
    }
  }
  maskDirty = any;
}

function markStateDirty() {
  setProjectDirty(true);
}

function paintMaskLine(from, to, erase = false) {
  const drawRect = getImageDrawRect(roomPreview);
  if (!drawRect) return;
  const ctx = removeMaskCanvas.getContext("2d");
  if (!ctx) return;
  const size = Number(removeBrushSize.value || 28);
  const toCanvas = (pt) => ({
    x: clamp((pt.x * drawRect.drawW), 0, removeMaskCanvas.width),
    y: clamp((pt.y * drawRect.drawH), 0, removeMaskCanvas.height),
  });
  const a = toCanvas(from);
  const b = toCanvas(to);
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
  if (!erase) maskDirty = true;
  else maskNeedsRecount = true;
  maskVersion += 1;
  updateRemoveButtonsState();
}

function maskCanvasToDataUrl() {
  return removeMaskCanvas.toDataURL("image/png");
}

function sendRenderRequest(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/render", true);
    xhr.responseType = "json";
    xhr.upload.addEventListener("loadstart", () => setRenderProgress(3, "Подготовка и отправка в нейросеть..."));
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setRenderProgress(5 + (event.loaded / event.total) * 45, "Загрузка изображения в нейросеть...");
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
      reject(new Error(payload?.error || xhr.responseText || "Ошибка генерации"));
    });
    xhr.addEventListener("error", () => reject(new Error("Сетевая ошибка при обращении к нейросети")));
    xhr.addEventListener("abort", () => reject(new Error("Запрос к нейросети был прерван")));
    xhr.send(formData);
  });
}

function sendRemoveRequest(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/remove-furniture", true);
    xhr.responseType = "json";
    xhr.upload.addEventListener("loadstart", () => setRenderProgress(3, "Подготовка удаления мебели..."));
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setRenderProgress(5 + (event.loaded / event.total) * 45, "Отправка области удаления...");
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
      reject(new Error(payload?.error || xhr.responseText || "Ошибка удаления мебели"));
    });
    xhr.addEventListener("error", () => reject(new Error("Сетевая ошибка при удалении мебели")));
    xhr.addEventListener("abort", () => reject(new Error("Запрос удаления мебели прерван")));
    xhr.send(formData);
  });
}

function removeUnknownSceneObjects() {
  const validIds = new Set(furnitureItems.map((item) => item.id));
  sceneObjects = sceneObjects.filter((obj) => validIds.has(obj.furnitureId));
  normalizeLayerOrders();
  if (!sceneObjects.some((obj) => obj.id === activeSceneObjectId)) activeSceneObjectId = sceneObjects[0]?.id || null;
}

function applyRoomFromBlob(blob, filename = "room.jpg") {
  selectedRoomFile = new File([blob], filename, { type: blob.type || "image/jpeg" });
  if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
  selectedRoomUrl = URL.createObjectURL(blob);
  roomPreview.src = selectedRoomUrl;
  const roomSignature = getRoomFileSignature(selectedRoomFile);
  if (cachedAutoSaveRoomSignature !== roomSignature) {
    cachedAutoSaveRoomDataUrl = "";
    cachedAutoSaveRoomSignature = "";
  }
  markStateDirty();
  updateEmptyHint();
  updateCursorHintVisibility(false);
}

async function loadFurnitureCatalog() {
  setStatus("Загрузка каталога мебели...");
  const response = await fetch("/api/furniture");
  if (!response.ok) throw new Error("Не удалось получить каталог мебели");
  const data = await response.json();
  furnitureItems = data.items || [];
  if (!furnitureItems.some((item) => item.id === selectedFurnitureId)) selectedFurnitureId = furnitureItems[0]?.id || "";
  removeUnknownSceneObjects();
  renderCategoryTabs();
  renderFurnitureGrid();
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  setStatus("Каталог загружен");
}

function resetSceneState() {
  sceneObjects = [];
  activeSceneObjectId = null;
  manualLayerOrdering = false;
  hideSnapGuides();
  clearRemoveSelection();
  clearMaskCanvas();
  setRemoveMode(false);
  coordsText.textContent = "Точка не выбрана";
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  updateRemoveButtonsState();
  updateQuickActionButtons();
}

function handleRoomFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
    selectedRoomUrl = "";
    selectedRoomFile = null;
    roomPreview.removeAttribute("src");
    resetSceneState();
    updateEmptyHint();
    updateCursorHintVisibility(false);
    return;
  }
  (async () => {
    try {
      if (file.size > MAX_INPUT_ROOM_FILE_BYTES) {
        setStatus("Файл слишком большой. Сжимаю изображение...");
      }
      const preparedFile = await compressRoomImageFile(file);
      pushHistory();
      applyRoomFromBlob(preparedFile, preparedFile.name || "room.jpg");
      sceneObjects = [];
      activeSceneObjectId = null;
      manualLayerOrdering = false;
      coordsText.textContent = "Перетащи мебель на сцену";
      resetResult();
      renderSceneObjects();
      renderLayersPanel();
      updateRenderButtonState();
      updateRemoveButtonsState();
      updateUndoRedoButtons();
      updateCursorHintVisibility(false);
      if (preparedFile !== file) {
        const kbBefore = Math.round(file.size / 1024);
        const kbAfter = Math.round(preparedFile.size / 1024);
        setStatus(`Фото сжато: ${kbBefore}KB -> ${kbAfter}KB. Перетащи мебель на сцену.`);
      } else {
        setStatus("Фото загружено. Перетащи мебель из каталога на сцену.");
      }
    } catch (error) {
      console.error(error);
      setStatus(`Ошибка загрузки фото: ${error.message}`, true);
      roomImageInput.value = "";
    }
  })();
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
  addSceneObject(selectedFurnitureId, point.x, point.y, active?.scale || 1, active?.rotationDeg || 0);
  updateCursorHintVisibility(!cursorHint.hidden);
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
  if (event.dataTransfer) furnitureId = event.dataTransfer.getData("text/furniture-id");
  furnitureId = furnitureId || selectedFurnitureId;
  if (!furnitureId) return;
  const point = eventToNormalized(event.clientX, event.clientY, true) || { x: 0.5, y: 0.82 };
  const active = getActiveSceneObject();
  addSceneObject(furnitureId, point.x, point.y, active?.scale || 1, active?.rotationDeg || 0);
  updateCursorHintVisibility(!cursorHint.hidden);
}

function handleRemovePointerDown(event) {
  if (!isRemoveMode || !selectedRoomFile || isRendering) return;
  const point = eventToNormalized(event.clientX, event.clientY, false);
  if (!point) return;
  if (removeModeTool === "rect") {
    pushHistory();
    isSelectingRemoveArea = true;
    removeSelectionStart = { x: point.x, y: point.y };
    removeSelection = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    drawRemoveSelectionBox(removeSelection);
    updateRemoveButtonsState();
    return;
  }
  if (removeModeTool === "brush" || removeModeTool === "eraser") {
    pushHistory();
    isPaintingMask = true;
    lastMaskPoint = point;
    paintMaskLine(point, point, removeModeTool === "eraser");
  }
}

function handleRemovePointerMove(event) {
  if (!isRemoveMode || !selectedRoomFile || isRendering) return;
  const point = eventToNormalized(event.clientX, event.clientY, true);
  if (!point) return;
  if (removeModeTool === "rect" && isSelectingRemoveArea && removeSelectionStart) {
    removeSelection = {
      x1: removeSelectionStart.x,
      y1: removeSelectionStart.y,
      x2: point.x,
      y2: point.y,
    };
    drawRemoveSelectionBox(removeSelection);
    updateRemoveButtonsState();
    return;
  }
  if ((removeModeTool === "brush" || removeModeTool === "eraser") && isPaintingMask && lastMaskPoint) {
    paintMaskLine(lastMaskPoint, point, removeModeTool === "eraser");
    lastMaskPoint = point;
  }
}

function handleRemovePointerUp() {
  if (!isRemoveMode) return;
  if (removeModeTool === "rect") {
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
    return;
  }
  isPaintingMask = false;
  lastMaskPoint = null;
  if (removeModeTool === "eraser" && maskNeedsRecount) {
    recomputeMaskDirtyFromCanvas();
    maskNeedsRecount = false;
  }
  updateRemoveButtonsState();
}

async function handleConfirmRemove() {
  if (!isRemoveMode || !selectedRoomFile || isRendering) return;
  const hasRect = Boolean(removeSelection);
  const hasMask = maskDirty;
  if (!hasRect && !hasMask) return;
  isRendering = true;
  updateRenderButtonState();
  updateRemoveButtonsState();
  setRenderProgress(1, "Запуск удаления мебели...");
  const previousRoomUrl = selectedRoomUrl;
  const formData = new FormData();
  formData.append("room_image", selectedRoomFile);
  if (hasMask) formData.append("remove_mask_data_url", maskCanvasToDataUrl());
  if (hasRect) {
    const x1 = Math.min(removeSelection.x1, removeSelection.x2);
    const y1 = Math.min(removeSelection.y1, removeSelection.y2);
    const x2 = Math.max(removeSelection.x1, removeSelection.x2);
    const y2 = Math.max(removeSelection.y1, removeSelection.y2);
    formData.append("remove_box", JSON.stringify({ x1, y1, x2, y2 }));
  }
  try {
    const data = await sendRemoveRequest(formData);
    if (!data?.result_image_url) throw new Error("Не удалось получить результат удаления");
    resultImage.src = data.result_image_url;
    downloadLink.href = data.result_image_url;
    downloadLink.setAttribute("download", `room-clean-${Date.now()}.jpg`);
    downloadLink.hidden = false;
    const newRoomResponse = await fetch(data.result_image_url);
    if (!newRoomResponse.ok) throw new Error("Не удалось загрузить обновлённое фото комнаты");
    const blob = await newRoomResponse.blob();
    pushHistory();
    applyRoomFromBlob(blob, selectedRoomFile?.name || "room-clean.jpg");
    sceneObjects = [];
    activeSceneObjectId = null;
    manualLayerOrdering = false;
    renderSceneObjects();
    renderLayersPanel();
    updateRenderButtonState();
    updateUndoRedoButtons();
    showCompare(previousRoomUrl, data.result_image_url);
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
  updateCursorHintVisibility(!cursorHint.hidden);
}

async function handleRender() {
  if (!selectedRoomFile || !sceneObjects.length || isRendering) return;
  isRendering = true;
  updateRenderButtonState();
  updateRemoveButtonsState();
  setRenderProgress(1, "Запуск нейросети...");
  resetResult();
  const previousRoomUrl = selectedRoomUrl;
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
    showCompare(previousRoomUrl, data.result_image_url);
    setStatus(`Готово! Режим: ${data.provider}`);
  } catch (error) {
    console.error(error);
    setRenderProgress(renderProgressValue, "Ошибка нейросети");
    setStatus(`Ошибка: ${error.message}`, true);
  } finally {
    isRendering = false;
    updateRenderButtonState();
    updateRemoveButtonsState();
  }
}

async function handleFurnitureUpload() {
  const name = (newFurnitureName.value || "").trim();
  const category = (newFurnitureCategory.value || "custom").trim();
  const imageFile = newFurnitureImage.files?.[0];
  if (!name) return setUploadStatus("Введи название предмета", true);
  if (!imageFile) return setUploadStatus("Выбери файл PNG/JPG/WEBP", true);
  uploadFurnitureBtn.disabled = true;
  setUploadStatus("Загружаю предмет...");
  const formData = new FormData();
  formData.append("name", name);
  formData.append("category", category || "custom");
  formData.append("furniture_image", imageFile);
  formData.append("prompt", `A realistic ${name} in modern interior style`);
  try {
    const response = await fetch("/api/furniture/upload", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить предмет");
    await loadFurnitureCatalog();
    selectedFurnitureId = data.item.id;
    renderFurnitureGrid();
    newFurnitureName.value = "";
    newFurnitureImage.value = "";
    setUploadStatus(`Добавлено: ${data.item.name}`);
    setStatus(`Добавлено: ${data.item.name}. Перетащи предмет на сцену.`);
    setProjectDirty(true);
  } catch (error) {
    console.error(error);
    setUploadStatus(`Ошибка: ${error.message}`, true);
  } finally {
    uploadFurnitureBtn.disabled = false;
  }
}

function handleClear() {
  if (isRendering) return;
  pushHistory();
  roomImageInput.value = "";
  if (selectedRoomUrl) URL.revokeObjectURL(selectedRoomUrl);
  selectedRoomUrl = "";
  selectedRoomFile = null;
  roomPreview.removeAttribute("src");
  resetSceneState();
  resetResult();
  updateEmptyHint();
  updateUndoRedoButtons();
  setProjectDirty(true);
  updateCursorHintVisibility(false);
  setStatus("Сцена очищена");
}

async function handleSaveProject() {
  if (!selectedRoomFile) {
    setStatus("Сначала загрузи фото комнаты", true);
    return;
  }
  const roomDataUrl = await fileToDataUrl(selectedRoomFile);
  const project = getCurrentProjectPayload(roomDataUrl);
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `project-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setProjectDirty(false);
  setStatus("Проект сохранён в JSON");
}

async function handleLoadProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (isRendering) return;
  try {
    const text = await file.text();
    const project = JSON.parse(text);
    pushHistory();
    await applyLoadedProject(project, false);
    persistAutoSavedProject();
    setProjectDirty(false);
    setStatus("Проект загружен");
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка загрузки проекта: ${error.message}`, true);
  } finally {
    loadProjectInput.value = "";
  }
}

async function applyLoadedProject(project, fromAutosave = false) {
  if (!project || typeof project !== "object") {
    throw new Error("Некорректный формат проекта");
  }
  if (!project?.room?.data_url) {
    throw new Error("В файле проекта нет изображения комнаты");
  }
  const roomFile = await dataUrlToFile(
    project.room.data_url,
    project.room.name || "room-loaded.jpg",
    project.room.type || "image/jpeg"
  );
  applyRoomFromBlob(roomFile, roomFile.name);
  sceneObjects = Array.isArray(project.scene_objects) ? project.scene_objects.map((obj) => ({ ...obj })) : [];
  activeSceneObjectId = project.active_scene_object_id || sceneObjects[0]?.id || null;
  manualLayerOrdering = Boolean(project.manual_layer_ordering);
  selectedFurnitureId = project.selected_furniture_id || selectedFurnitureId;
  selectedCategory = project.selected_category || selectedCategory;
  searchQuery = (project.search_query || searchQuery).toLowerCase();
  searchInput.value = searchQuery;
  const loadedRemoveTool = String(project.remove_mode_tool || "");
  removeModeTool = ["rect", "brush", "eraser"].includes(loadedRemoveTool) ? loadedRemoveTool : "rect";
  uidCounter = Math.max(uidCounter, ...sceneObjects.map((obj) => Number(String(obj.id || "").replace(/[^\d]/g, "")) || 1)) + 1;
  removeUnknownSceneObjects();
  renderCategoryTabs();
  renderFurnitureGrid();
  setRemoveMode(false);
  resetResult();
  clearMaskCanvas();
  if (project.remove_mask_data_url) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Не удалось загрузить маску из проекта"));
      img.src = project.remove_mask_data_url;
    });
    resizeMaskCanvas();
    const ctx = removeMaskCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, removeMaskCanvas.width, removeMaskCanvas.height);
      ctx.drawImage(img, 0, 0, removeMaskCanvas.width, removeMaskCanvas.height);
      maskDirty = true;
    }
  }
  renderSceneObjects();
  renderLayersPanel();
  updateRenderButtonState();
  updateRemoveButtonsState();
  updateUndoRedoButtons();
  updateQuickActionButtons();
  setProjectDirty(false);
  updateCursorHintVisibility(false);
  if (!fromAutosave) updateOnboardingVisibility();
}

roomImageInput.addEventListener("change", handleRoomFileChange);
canvasSurface.addEventListener("click", handleCanvasClick);
canvasSurface.addEventListener("pointerenter", (event) => {
  if (!selectedRoomFile || isRendering) return;
  updateCursorHintPosition(event.clientX, event.clientY);
  updateCursorHintVisibility(true);
});
canvasSurface.addEventListener("pointermove", (event) => {
  if (cursorHint.hidden) return;
  updateCursorHintPosition(event.clientX, event.clientY);
});
canvasSurface.addEventListener("pointerleave", () => updateCursorHintVisibility(false));
canvasSurface.addEventListener("pointerdown", handleRemovePointerDown);
canvasSurface.addEventListener("pointermove", handleRemovePointerMove);
canvasSurface.addEventListener("pointerup", handleRemovePointerUp);
canvasSurface.addEventListener("pointercancel", handleRemovePointerUp);
canvasSurface.addEventListener("dragover", (event) => {
  if (!selectedRoomFile || isRemoveMode) return;
  event.preventDefault();
  canvasSurface.classList.add("drop-active");
});
canvasSurface.addEventListener("dragleave", () => canvasSurface.classList.remove("drop-active"));
canvasSurface.addEventListener("drop", handleCanvasDrop);

layersList.addEventListener("dragover", (event) => {
  if (!layerDragSourceId) return;
  event.preventDefault();
  const lastRow = layersList.lastElementChild;
  if (!(lastRow instanceof HTMLElement)) return;
  setLayerDropTarget(lastRow.dataset.layerId, false);
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});
layersList.addEventListener("drop", (event) => {
  if (!layerDragSourceId || !layerDropTargetId) return;
  event.preventDefault();
  pushHistory();
  const changed = reorderLayerByDrag(layerDragSourceId, layerDropTargetId, layerDropBefore);
  clearLayerDragState();
  if (changed) {
    resetResult();
    renderSceneObjects();
    setStatus("Порядок слоёв обновлён");
  }
  renderLayersPanel();
  updateUndoRedoButtons();
});

renderBtn.addEventListener("click", handleRender);
clearBtn.addEventListener("click", handleClear);
undoBtn.addEventListener("click", undoHistory);
redoBtn.addEventListener("click", redoHistory);
saveProjectBtn.addEventListener("click", handleSaveProject);
loadProjectInput.addEventListener("change", handleLoadProject);
duplicateObjectBtn.addEventListener("click", duplicateActiveObject);
deleteObjectBtn.addEventListener("click", deleteActiveObject);
centerObjectBtn.addEventListener("click", centerActiveObject);
resetSizeBtn.addEventListener("click", resetActiveObjectScale);

modeInsertBtn.addEventListener("click", () => {
  if (isRendering) return;
  setRemoveMode(false);
  setStatus("Режим вставки: перетащи мебель на сцену.");
  updateCursorHintVisibility(!cursorHint.hidden);
});
modeRemoveBtn.addEventListener("click", () => {
  if (isRendering) return;
  if (!selectedRoomFile) {
    setStatus("Сначала загрузи фото комнаты, затем включай удаление.", true);
    return;
  }
  setRemoveMode(true);
  updateCursorHintVisibility(!cursorHint.hidden);
});
removeRectBtn.addEventListener("click", () => {
  removeModeTool = "rect";
  updateRemoveToolButtons();
  setStatus("Инструмент: прямоугольник.");
});
removeBrushBtn.addEventListener("click", () => {
  removeModeTool = "brush";
  updateRemoveToolButtons();
  setStatus("Инструмент: кисть.");
});
removeEraserBtn.addEventListener("click", () => {
  removeModeTool = "eraser";
  updateRemoveToolButtons();
  setStatus("Инструмент: ластик.");
});
clearMaskBtn.addEventListener("click", () => {
  if (!isRemoveMode || isRendering) return;
  pushHistory();
  clearMaskCanvas();
  setStatus("Маска очищена");
  updateUndoRedoButtons();
});
confirmRemoveBtn.addEventListener("click", handleConfirmRemove);
cancelRemoveBtn.addEventListener("click", handleCancelRemove);
uploadFurnitureBtn.addEventListener("click", handleFurnitureUpload);
searchInput.addEventListener("input", (event) => {
  searchQuery = (event.target.value || "").trim().toLowerCase();
  renderFurnitureGrid();
});

compareSlider.addEventListener("input", updateCompareUI);
hideOnboardingBtn.addEventListener("click", dismissOnboardingForever);

roomPreview.addEventListener("load", () => {
  updateEmptyHint();
  resizeMaskCanvas();
  renderSceneObjects();
  renderLayersPanel();
  updateQuickActionButtons();
  if (isRemoveMode && removeSelection) drawRemoveSelectionBox(removeSelection);
});

window.addEventListener("resize", () => {
  resizeMaskCanvas();
  renderSceneObjects();
  updateQuickActionButtons();
  if (isRemoveMode && removeSelection) drawRemoveSelectionBox(removeSelection);
});

updateEmptyHint();
hideSnapGuides();
hideCompare();
renderLayersPanel();
updateModeUI();
updateOnboardingVisibility();
updateUndoRedoButtons();
updateRemoveButtonsState();
loadFurnitureCatalog()
  .then(() => restoreAutoSavedProject())
  .then(() => startAutoSaveTimer())
  .catch((error) => {
    console.error(error);
    setStatus(error.message, true);
  });
