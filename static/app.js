const roomImageInput = document.getElementById("roomImageInput");
const roomPreview = document.getElementById("roomPreview");
const roomPreviewWrap = document.getElementById("roomPreviewWrap");
const marker = document.getElementById("marker");
const coordsText = document.getElementById("coordsText");
const furnitureSelect = document.getElementById("furnitureSelect");
const renderBtn = document.getElementById("renderBtn");
const statusText = document.getElementById("statusText");
const resultImage = document.getElementById("resultImage");
const downloadLink = document.getElementById("downloadLink");

let selectedFile = null;
let selectedPoint = null; // normalized coordinates in [0..1]

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#dc2626" : "#4b5563";
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
  furnitureSelect.innerHTML = "";

  for (const item of data.items || []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} (${item.category || "без категории"})`;
    furnitureSelect.appendChild(option);
  }

  if (!furnitureSelect.value) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Нет мебели в каталоге";
    furnitureSelect.appendChild(option);
  }
  setStatus("Каталог загружен");
  updateRenderButtonState();
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

loadFurnitureCatalog().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
