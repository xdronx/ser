const roomImageInput = document.getElementById("roomImageInput");
const roomPreview = document.getElementById("roomPreview");
const marker = document.getElementById("marker");
const coordsText = document.getElementById("coordsText");
const furnitureSelect = document.getElementById("furnitureSelect");
const renderBtn = document.getElementById("renderBtn");
const statusText = document.getElementById("statusText");
const resultImage = document.getElementById("resultImage");
const downloadLink = document.getElementById("downloadLink");

const newFurnitureName = document.getElementById("newFurnitureName");
const newFurnitureCategory = document.getElementById("newFurnitureCategory");
const newFurnitureImage = document.getElementById("newFurnitureImage");
const uploadFurnitureBtn = document.getElementById("uploadFurnitureBtn");
const uploadStatusText = document.getElementById("uploadStatusText");

let selectedFile = null;
let selectedPoint = null;

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#dc2626" : "#4b5563";
}

function setUploadStatus(text, isError = false) {
  uploadStatusText.textContent = text;
  uploadStatusText.style.color = isError ? "#dc2626" : "#4b5563";
}

function updateRenderButtonState() {
  const canRender = selectedFile && selectedPoint && furnitureSelect.value;
  renderBtn.disabled = !canRender;
}

async function loadFurnitureCatalog() {
  setStatus("Загрузка каталога мебели...");
  const response = await fetch("/api/furniture");
  if (!response.ok) {
    throw new Error("Не удалось получить список мебели");
  }

  const data = await response.json();
  const items = data.items || [];
  furnitureSelect.innerHTML = "";

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} (${item.category || "без категории"})`;
    furnitureSelect.appendChild(option);
  }

  if (items.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Нет мебели в каталоге";
    furnitureSelect.appendChild(option);
  }

  setStatus("Каталог загружен");
  updateRenderButtonState();
}

async function handleFurnitureUpload() {
  const name = (newFurnitureName.value || "").trim();
  const category = (newFurnitureCategory.value || "custom").trim();
  const imageFile = newFurnitureImage.files?.[0];

  if (!name) {
    setUploadStatus("Введите название предмета", true);
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
      throw new Error(data.error || "Не удалось добавить предмет");
    }

    await loadFurnitureCatalog();
    furnitureSelect.value = data.item.id;
    newFurnitureName.value = "";
    newFurnitureImage.value = "";
    setUploadStatus(`Добавлено: ${data.item.name}`);
    setStatus(`Выбран новый предмет: ${data.item.name}`);
    updateRenderButtonState();
  } catch (error) {
    console.error(error);
    setUploadStatus(`Ошибка загрузки: ${error.message}`, true);
  } finally {
    uploadFurnitureBtn.disabled = false;
  }
}

function handleRoomFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    selectedFile = null;
    selectedPoint = null;
    roomPreview.removeAttribute("src");
    marker.hidden = true;
    coordsText.textContent = "Точка не выбрана";
    updateRenderButtonState();
    return;
  }

  selectedFile = file;
  selectedPoint = null;
  marker.hidden = true;
  coordsText.textContent = "Точка не выбрана";
  roomPreview.src = URL.createObjectURL(file);
  setStatus("Фото загружено. Кликни точку установки мебели.");
  updateRenderButtonState();
}

function handlePreviewClick(event) {
  if (!selectedFile || !roomPreview.src) {
    return;
  }

  const rect = roomPreview.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  selectedPoint = {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };

  marker.hidden = false;
  marker.style.left = `${selectedPoint.x * 100}%`;
  marker.style.top = `${selectedPoint.y * 100}%`;
  coordsText.textContent = `Выбрана точка: x=${selectedPoint.x.toFixed(3)}, y=${selectedPoint.y.toFixed(3)}`;
  setStatus("Точка выбрана, можно генерировать");
  updateRenderButtonState();
}

async function handleRender() {
  if (!selectedFile || !selectedPoint || !furnitureSelect.value) {
    return;
  }

  setStatus("Отправляю данные на генерацию...");
  renderBtn.disabled = true;
  resultImage.removeAttribute("src");
  downloadLink.hidden = true;

  const formData = new FormData();
  formData.append("room_image", selectedFile);
  formData.append("furniture_id", furnitureSelect.value);
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
    setStatus(`Готово! Режим генерации: ${data.provider}`);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка: ${error.message}`, true);
  } finally {
    updateRenderButtonState();
  }
}

roomImageInput.addEventListener("change", handleRoomFileChange);
roomPreview.addEventListener("click", handlePreviewClick);
furnitureSelect.addEventListener("change", updateRenderButtonState);
renderBtn.addEventListener("click", handleRender);
uploadFurnitureBtn.addEventListener("click", handleFurnitureUpload);

loadFurnitureCatalog().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
