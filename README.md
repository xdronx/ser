# MVP: мебель в фото комнаты

Простой MVP для твоей идеи:

- есть заранее загруженный набор мебели (5 штук),
- пользователь загружает фото комнаты,
- указывает точку на фото, где будет стоять мебель,
- приложение отправляет данные в генератор (mock или внешний AI API),
- получает итоговую картинку.

---

## Что уже готово в этом проекте

- Backend на `Flask` (`app.py`)
- Frontend (страница с кнопками и загрузкой) в `static/`
- Каталог мебели: `assets/furniture/catalog.json`
- 5 заранее загруженных PNG:
  - `chair.png`
  - `sofa.png`
  - `table.png`
  - `lamp.png`
  - `bed.png`
- Архив набора: `assets/furniture/furniture_pack.zip`

---

## Варианты режима генерации

Есть 3 режима:

1. `mock` (по умолчанию)  
   Локальная генерация: накладывает мебель и тень на фото комнаты.

2. `openai`  
   Локальная композиция + дообработка через OpenAI Image API для более органичного результата
   (свет/цвет/тень и интеграция в интерьер).

3. `webhook`  
   Отправляет изображение комнаты + выбранную мебель + координаты в твой внешний AI API.

---

## Шаг 1. Открой проект в терминале

Если ты уже в папке проекта, пропусти.

```bash
cd /workspace
```

---

## Шаг 2. Установи зависимости

```bash
python3 -m pip install --user -r requirements.txt
```

---

## Шаг 3. Создай файл `.env`

Скопируй шаблон:

```bash
cp .env.example .env
```

Открой `.env` и оставь пока так:

```env
GENERATION_PROVIDER=mock
EXTERNAL_AI_WEBHOOK_URL=
EXTERNAL_AI_WEBHOOK_TOKEN=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_SIZE=
OPENAI_IMAGE_QUALITY=
OPENAI_TIMEOUT_SEC=120
OPENAI_REFINE_PROMPT=Blend the furniture naturally into the room. Preserve geometry and placement. Keep realistic contact shadows on the floor and match lighting and color tone.
OPENAI_NEGATIVE_PROMPT=blurry, low quality, different room, changed walls, changed floor, extra objects, wrong perspective, odd lighting, 3d render, cartoon, changed furniture
```

---

## Шаг 4. Запусти сайт

```bash
python3 app.py
```

После запуска увидишь адрес, обычно:

`http://127.0.0.1:5000`

Открой его в браузере.

---

## Шаг 5. Куда нажимать в интерфейсе (очень подробно)

1. В блоке **"Фото комнаты"** нажми кнопку выбора файла и загрузи фото квартиры/комнаты.
2. В поле **"Мебель"** выбери один из 5 предметов.
3. Кликни мышкой по месту на фото, где должна стоять мебель.
4. Нажми кнопку **"Сгенерировать"**.
5. Справа в блоке **"Результат"** появится картинка.
6. Нажми **"Скачать результат"**, чтобы сохранить файл.

---

## Как добавить свои реальные предметы (без Explorer)

Теперь в интерфейсе есть блок **"Добавить свою мебель"**.  
Это удобно, если сложно работать с файловой панелью.

Сделай так:

1. В поле **"Название нового предмета"** введи, например:
   - `Стул`
   - `Стул 2`
   - `Стол`
   - `Стол 2`
2. В поле **"Категория"** укажи:
   - для стульев: `chair`
   - для столов: `table`
3. В поле **"PNG/JPG предмета"** выбери файл картинки предмета.
4. Нажми **"Добавить предмет"**.
5. После успешной загрузки предмет автоматически появится в выпадающем списке мебели.
6. Повтори для остальных предметов.

После добавления работай как обычно:
- загрузи фото комнаты,
- кликни точку,
- нажми **"Сгенерировать"**.

---

## Подключение реальной нейросети по API (режим webhook)

Когда у тебя будет URL внешнего сервиса:

1. Открой `.env`
2. Поставь:

```env
GENERATION_PROVIDER=webhook
EXTERNAL_AI_WEBHOOK_URL=https://your-ai-endpoint.example.com/generate
EXTERNAL_AI_WEBHOOK_TOKEN=your_token_if_needed
```

3. Перезапусти сервер:

```bash
python3 app.py
```

### Что отправляет backend во внешний API

`POST` JSON:

- `furniture_id`
- `furniture_name`
- `placement: { x, y }` (координаты от 0 до 1)
- `room_image_base64`
- `furniture_asset_base64`
- `furniture_prompt`

### Что backend ожидает в ответ

Один из двух форматов:

1. `result_image_base64`  
   или
2. `result_image_url`

---

## Проверка, что сервер жив

Открой:

`http://127.0.0.1:5000/api/health`

Должен вернуться JSON с `ok: true`.

---

## Подключение OpenAI API (режим openai)

Чтобы получить более реалистичную интеграцию мебели:

1. Получи API-ключ OpenAI.
2. Открой `.env` и поставь:

```env
GENERATION_PROVIDER=openai
OPENAI_API_KEY=твой_ключ
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_FALLBACK_MODEL=dall-e-2
OPENAI_IMAGE_SIZE=
OPENAI_IMAGE_QUALITY=
OPENAI_TIMEOUT_SEC=120
OPENAI_REFINE_PROMPT=Blend the furniture naturally into the room. Preserve geometry and placement. Keep realistic contact shadows on the floor and match lighting and color tone.
OPENAI_NEGATIVE_PROMPT=blurry, low quality, different room, changed walls, changed floor, extra objects, wrong perspective, odd lighting, 3d render, cartoon, changed furniture
```

3. Перезапусти сервер:

```bash
python3 app.py
```

4. Открой `http://127.0.0.1:5000/api/health` и проверь, что:
- `"provider": "openai"`
- `"openai_configured": true`

Если аккаунт не имеет доступа к `gpt-image-1`, приложение автоматически
попробует fallback-модель `dall-e-2` (настраивается через `OPENAI_FALLBACK_MODEL`).

### Рекомендуемый промт для финальной генерации

Можно сразу использовать такой строгий промт в `.env`:

```env
OPENAI_REFINE_PROMPT=Ты редактируешь реальную фотографию комнаты. ЗАДАЧА: Добавь указанную мебель в выделенную область изображения. СТРОГИЕ ПРАВИЛА: Не изменяй комнату вообще. Всё вне выделенной области должно остаться без изменений. Не меняй стены, пол, освещение, предметы и ракурс. Сохрани оригинальные цвета и свет. МЕБЕЛЬ: Используй именно ту мебель, которая передана. Не меняй форму, цвет и детали. Не придумывай новую мебель. ТРЕБОВАНИЯ: Мебель должна выглядеть реалистично. Подгони размер, перспективу и освещение под комнату. Итог должен выглядеть как настоящая фотография. ВАЖНО: Если изменится комната или мебель — результат неправильный.
OPENAI_NEGATIVE_PROMPT=размыто, плохое качество, другая комната, изменённые стены, изменённый пол, лишние предметы, неправильная перспектива, странный свет, 3d рендер, мультяшно, изменённая мебель
```

Если модель не поддерживает отдельный negative prompt параметр, приложение автоматически
добавит его в текст основного промта как запрет.

### Как это работает внутри

1. Локально собирается базовый композит:
   - мебель ставится в выбранную точку;
   - добавляется контактная тень.
2. Формируется маска области мебели/тени.
3. Этот композит + маска отправляются в OpenAI `/images/edits`.
4. OpenAI делает реалистичную дообработку и возвращает финальное изображение.

---

## Структура проекта

```text
app.py
requirements.txt
.env.example
static/
  index.html
  styles.css
  app.js
assets/
  furniture/
    catalog.json
    chair.png
    sofa.png
    table.png
    lamp.png
    bed.png
    furniture_pack.zip
uploads/
generated/
```

---

## Что делать дальше (следующий шаг MVP)

Если хочешь, в следующем шаге я могу сделать:

1. авторизацию пользователей,
2. историю генераций (галерея),
3. выбор не точки, а зоны (маска),
4. предпросмотр мебели перед генерацией,
5. деплой на сервер (чтобы открыть сайт по ссылке).
