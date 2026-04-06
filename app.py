import base64
import io
import json
import os
import re
import uuid
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
ASSETS_DIR = BASE_DIR / "assets"
FURNITURE_DIR = ASSETS_DIR / "furniture"
UPLOADS_DIR = BASE_DIR / "uploads"
GENERATED_DIR = BASE_DIR / "generated"
STATIC_DIR = BASE_DIR / "static"

CATALOG_FILE = FURNITURE_DIR / "catalog.json"
FURNITURE_PACK_FILE = FURNITURE_DIR / "furniture_pack.zip"
PROCESSED_FURNITURE_DIR = GENERATED_DIR / "processed_furniture"

load_dotenv(BASE_DIR / ".env")

GENERATION_PROVIDER = os.getenv("GENERATION_PROVIDER", "mock").strip().lower()
EXTERNAL_AI_WEBHOOK_URL = os.getenv("EXTERNAL_AI_WEBHOOK_URL", "").strip()
EXTERNAL_AI_WEBHOOK_TOKEN = os.getenv("EXTERNAL_AI_WEBHOOK_TOKEN", "").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = (
    os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    or "https://api.openai.com/v1"
)
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1").strip()
OPENAI_FALLBACK_MODEL = os.getenv("OPENAI_FALLBACK_MODEL", "dall-e-2").strip()
OPENAI_IMAGE_SIZE = os.getenv("OPENAI_IMAGE_SIZE", "").strip()
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "").strip()
OPENAI_REFINE_PROMPT = os.getenv(
    "OPENAI_REFINE_PROMPT",
    "Ты редактируешь реальную фотографию комнаты. "
    "ЗАДАЧА: Добавь указанную мебель в выделенную область изображения. "
    "СТРОГИЕ ПРАВИЛА: Не изменяй комнату вообще. Всё вне выделенной области должно "
    "остаться без изменений. Не меняй стены, пол, освещение, предметы и ракурс. "
    "Сохрани оригинальные цвета и свет. "
    "МЕБЕЛЬ: Используй именно ту мебель, которая передана. Не меняй форму, цвет и детали. "
    "Не придумывай новую мебель. "
    "ТРЕБОВАНИЯ: Мебель должна выглядеть реалистично. Подгони размер, перспективу и освещение "
    "под комнату. Итог должен выглядеть как настоящая фотография. "
    "ВАЖНО: Если изменится комната или мебель — результат неправильный.",
).strip()
OPENAI_STRICT_PLACEMENT_PROMPT = os.getenv(
    "OPENAI_STRICT_PLACEMENT_PROMPT",
    "РАЗМЕЩЕНИЕ: Размести мебель строго внутри выделенной области. "
    "Мебель должна стоять на полу (не висеть в воздухе). "
    "Учитывай горизонт и перспективу комнаты. "
    "РЕАЛИЗМ: Добавь естественную тень под мебелью. Мебель должна касаться пола. "
    "Освещение должно совпадать с комнатой. "
    "ЗАПРЕТЫ: Не изменяй дизайн мебели. Не добавляй детали от себя. "
    "Не улучшай и не стилизуй объект. "
    "КОМНАТА: Сохрани исходное изображение без изменений. "
    "Не изменяй геометрию комнаты. Не двигай существующие объекты. "
    "МАСШТАБ: Размер мебели должен быть реалистичным относительно комнаты. "
    "Ориентируйся на стены, двери, окна.",
).strip()
OPENAI_NEGATIVE_PROMPT = os.getenv(
    "OPENAI_NEGATIVE_PROMPT",
    "размыто, плохое качество, другая комната, изменённые стены, изменённый пол, "
    "лишние предметы, неправильная перспектива, странный свет, 3d рендер, мультяшно, "
    "изменённая мебель",
).strip()
OPENAI_PROMPT_MAX_LEN = 980
STRICT_IMAGE_EDIT_POLICY = (
    "Редактируй только мебель в выделенной области. "
    "Не изменяй комнату, стены, пол, освещение, ракурс, существующие объекты."
)
try:
    OPENAI_TIMEOUT_SEC = int((os.getenv("OPENAI_TIMEOUT_SEC", "120") or "120").strip())
except ValueError:
    OPENAI_TIMEOUT_SEC = 120
AUTO_REMOVE_FURNITURE_BG = (
    os.getenv("AUTO_REMOVE_FURNITURE_BG", "true").strip().lower() not in {"0", "false", "no"}
)


def ensure_dirs() -> None:
    for folder in (UPLOADS_DIR, GENERATED_DIR, PROCESSED_FURNITURE_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def load_catalog() -> list[dict]:
    if not CATALOG_FILE.exists():
        return []
    with CATALOG_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_catalog(items: list[dict]) -> None:
    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_FILE.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def rebuild_furniture_pack() -> None:
    import zipfile

    FURNITURE_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(FURNITURE_PACK_FILE, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(FURNITURE_DIR.iterdir()):
            if not path.is_file():
                continue
            if path.name == FURNITURE_PACK_FILE.name:
                continue
            zf.write(path, arcname=path.name)


def make_slug(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return slug or "furniture"


def save_uploaded_furniture_image(upload_file, name_slug: str) -> str:
    image = Image.open(upload_file.stream).convert("RGBA")
    filename = f"{name_slug}-{uuid.uuid4().hex[:8]}.png"
    output_path = FURNITURE_DIR / filename
    image.save(output_path, format="PNG")
    return filename


def get_furniture_item(furniture_id: str) -> dict | None:
    for item in load_catalog():
        if item["id"] == furniture_id:
            return item
    return None


def serialize_furniture_item(item: dict) -> dict:
    data = dict(item)
    asset_file = (item.get("asset_file") or "").strip()
    data["asset_url"] = f"/assets/furniture/{asset_file}" if asset_file else ""
    return data


def allowed_image(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in {".jpg", ".jpeg", ".png", ".webp"}


def _has_meaningful_alpha(image: Image.Image) -> bool:
    if image.mode != "RGBA":
        return False
    alpha = image.getchannel("A")
    extrema = alpha.getextrema()
    if not extrema:
        return False
    return extrema[0] < 245


def _auto_remove_background(image_rgba: Image.Image) -> Image.Image:
    width, height = image_rgba.size
    if width < 3 or height < 3:
        return image_rgba

    marker_color = (255, 0, 255)
    threshold = 26
    working = image_rgba.convert("RGB").copy()
    step = max(6, min(width, height) // 40)
    seeds: set[tuple[int, int]] = set()

    for x in range(0, width, step):
        seeds.add((x, 0))
        seeds.add((x, height - 1))
    for y in range(0, height, step):
        seeds.add((0, y))
        seeds.add((width - 1, y))
    seeds.update(
        {
            (0, 0),
            (width - 1, 0),
            (0, height - 1),
            (width - 1, height - 1),
            (width // 2, 0),
            (width // 2, height - 1),
            (0, height // 2),
            (width - 1, height // 2),
        }
    )

    for seed in seeds:
        try:
            ImageDraw.floodfill(working, seed, marker_color, thresh=threshold)
        except Exception:
            continue

    bg_mask = Image.new("L", (width, height), 0)
    working_px = working.load()
    mask_px = bg_mask.load()
    for y in range(height):
        for x in range(width):
            if working_px[x, y] == marker_color:
                mask_px[x, y] = 255

    bg_pixels = bg_mask.histogram()[255]
    total_pixels = width * height
    if bg_pixels <= int(total_pixels * 0.01):
        return image_rgba

    blur_radius = max(1, min(width, height) // 300)
    soft_bg = bg_mask.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    alpha = soft_bg.point(lambda p: max(0, 255 - p))

    result = image_rgba.copy()
    result.putalpha(alpha)
    return result


def get_processed_furniture_asset(asset_file: Path) -> Path:
    if not asset_file.exists():
        return asset_file
    if not AUTO_REMOVE_FURNITURE_BG:
        return asset_file

    ensure_dirs()
    try:
        version = str(asset_file.stat().st_mtime_ns)
        processed_path = PROCESSED_FURNITURE_DIR / f"{asset_file.stem}-{version}.png"
        if processed_path.exists():
            return processed_path

        source = Image.open(asset_file).convert("RGBA")
        if _has_meaningful_alpha(source):
            processed = source
        else:
            processed = _auto_remove_background(source)

        alpha_bbox = processed.getchannel("A").getbbox()
        if alpha_bbox:
            processed = processed.crop(alpha_bbox)

        processed.save(processed_path, format="PNG")
        return processed_path
    except Exception:
        return asset_file


def _paste_furniture_on_canvas(
    image_rgba: Image.Image,
    furniture: dict,
    x: float,
    y: float,
    add_shadow: bool = True,
    scale: float = 1.0,
    rotation_deg: float = 0.0,
) -> dict:
    width, height = image_rgba.size
    px = int(width * x)
    py = int(height * y)

    asset_file = FURNITURE_DIR / furniture.get("asset_file", "")
    metadata: dict = {"anchor_point": (px, py), "furniture_box": None, "shadow_box": None}
    scale = max(0.5, min(2.0, float(scale)))
    rotation_deg = max(-180.0, min(180.0, float(rotation_deg)))
    if asset_file.exists():
        processed_asset = get_processed_furniture_asset(asset_file)
        overlay = Image.open(processed_asset).convert("RGBA")
        ow, oh = overlay.size
        base_target_w = max(80, min(int(width * 0.28), int(width * 0.6)))
        target_w = max(40, int(base_target_w * scale))
        ratio = target_w / ow
        target_h = max(40, int(oh * ratio))
        overlay = overlay.resize((target_w, target_h), Image.Resampling.LANCZOS)
        if abs(rotation_deg) > 0.05:
            overlay = overlay.rotate(
                -rotation_deg, resample=Image.Resampling.BICUBIC, expand=True
            )
            target_w, target_h = overlay.size

        if add_shadow:
            alpha = overlay.getchannel("A")
            shadow_w = max(40, int(target_w * 1.05))
            shadow_h = max(18, int(target_h * 0.24))
            shadow_alpha = alpha.resize((shadow_w, shadow_h), Image.Resampling.BICUBIC)
            shadow_alpha = shadow_alpha.filter(
                ImageFilter.GaussianBlur(radius=max(4, int(target_w * 0.03)))
            )
            shadow_alpha = shadow_alpha.point(lambda a: int(a * 0.45))
            shadow = Image.new("RGBA", (shadow_w, shadow_h), (0, 0, 0, 0))
            shadow.putalpha(shadow_alpha)
            shadow_x = px - shadow_w // 2
            shadow_y = py - shadow_h // 2
            image_rgba.alpha_composite(shadow, (shadow_x, shadow_y))
            metadata["shadow_box"] = (shadow_x, shadow_y, shadow_x + shadow_w, shadow_y + shadow_h)

        # Anchor the object by its bottom center to the clicked point.
        x1 = px - target_w // 2
        y1 = py - target_h
        image_rgba.paste(overlay, (x1, y1), overlay)
        metadata["furniture_box"] = (x1, y1, x1 + target_w, y1 + target_h)
    else:
        # Fallback marker if asset file is missing.
        image = image_rgba.convert("RGB")
        draw = ImageDraw.Draw(image)
        radius = max(12, min(width, height) // 40)
        draw.ellipse(
            (px - radius, py - radius, px + radius, py + radius),
            fill=(0, 170, 255),
            outline=(255, 255, 255),
            width=3,
        )
        metadata["furniture_box"] = (px - radius, py - radius, px + radius, py + radius)
    return metadata


def _compose_room_with_scene(
    room_path: Path,
    scene_objects: list[dict],
    add_shadow: bool = True,
) -> tuple[Image.Image, list[dict]]:
    image_rgba = Image.open(room_path).convert("RGBA")
    if not scene_objects:
        return image_rgba.convert("RGB"), []

    # Respect explicit layer order from UI (bottom -> top). If equal, keep depth fallback by y.
    ordered = sorted(
        scene_objects,
        key=lambda obj: (int(obj.get("layer_order", 0)), float(obj.get("y", 0))),
    )
    metadata_list: list[dict] = []
    for obj in ordered:
        metadata = _paste_furniture_on_canvas(
            image_rgba=image_rgba,
            furniture=obj["furniture"],
            x=float(obj["x"]),
            y=float(obj["y"]),
            add_shadow=add_shadow,
            scale=float(obj.get("scale", 1.0)),
            rotation_deg=float(obj.get("rotation_deg", 0.0)),
        )
        metadata["scene_object_id"] = obj.get("id")
        metadata["furniture_name"] = obj["furniture"].get("name", "")
        metadata_list.append(metadata)
    return image_rgba.convert("RGB"), metadata_list


def _expand_box(box: tuple[int, int, int, int], margin: int, width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    return (
        max(0, x1 - margin),
        max(0, y1 - margin),
        min(width, x2 + margin),
        min(height, y2 + margin),
    )


def _build_openai_mask(size: tuple[int, int], boxes: list[tuple[int, int, int, int]]) -> Image.Image:
    width, height = size
    mask = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(mask)
    for box in boxes:
        x1, y1, x2, y2 = box
        if x2 <= x1 or y2 <= y1:
            continue
        draw.rectangle((x1, y1, x2, y2), fill=(255, 255, 255, 0))
    return mask


def draw_mock_result(room_path: Path, scene_objects: list[dict]) -> str:
    image, _ = _compose_room_with_scene(room_path, scene_objects, add_shadow=True)
    output_name = f"{uuid.uuid4().hex}.jpg"
    output_path = GENERATED_DIR / output_name
    image.save(output_path, format="JPEG", quality=90)
    return output_name


def call_openai_image_edit(
    room_path: Path,
    scene_objects: list[dict],
) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is empty. Add it to .env for openai mode.")

    image, metadata_list = _compose_room_with_scene(room_path, scene_objects, add_shadow=True)
    width, height = image.size
    boxes: list[tuple[int, int, int, int]] = []
    for metadata in metadata_list:
        for key in ("furniture_box", "shadow_box"):
            box = metadata.get(key)
            if box:
                boxes.append(_expand_box(box, margin=32, width=width, height=height))

    if not boxes:
        px, py = (width // 2, height // 2)
        if metadata_list:
            px, py = metadata_list[0].get("anchor_point", (width // 2, height // 2))
        fallback_box = (
            max(0, px - 120),
            max(0, py - 160),
            min(width, px + 120),
            min(height, py + 80),
        )
        boxes.append(fallback_box)

    mask = _build_openai_mask(image.size, boxes)

    image_bytes = io.BytesIO()
    image.save(image_bytes, format="PNG")
    image_bytes.seek(0)

    mask_bytes = io.BytesIO()
    mask.save(mask_bytes, format="PNG")
    mask_bytes.seek(0)

    prompt_parts = [OPENAI_REFINE_PROMPT.strip(), OPENAI_STRICT_PLACEMENT_PROMPT.strip()]
    furniture_prompts: list[str] = []
    furniture_names: list[str] = []
    rotations: list[str] = []
    for obj in scene_objects:
        furniture = obj["furniture"]
        furniture_names.append(furniture.get("name", "item"))
        p = (furniture.get("prompt") or "").strip()
        if p:
            furniture_prompts.append(p)
        rotations.append(f"{float(obj.get('rotation_deg', 0.0)):.1f}deg")
    if furniture_prompts:
        prompt_parts.append(f"Furniture details: {'; '.join(furniture_prompts[:6])}")
    prompt_parts.append(f"Objects: {', '.join(furniture_names[:6])}.")
    prompt_parts.append(f"Requested object rotations: {', '.join(rotations[:6])}.")
    prompt_parts.append("Do not move furniture position. Keep room geometry unchanged.")
    if OPENAI_NEGATIVE_PROMPT:
        prompt_parts.append(f"Negative prompt: {OPENAI_NEGATIVE_PROMPT}")
    prompt = " ".join(part for part in prompt_parts if part)
    if len(prompt) > OPENAI_PROMPT_MAX_LEN:
        # Keep critical instruction priority while respecting provider prompt limits.
        essential_parts = [
            STRICT_IMAGE_EDIT_POLICY,
            f"Objects: {', '.join(furniture_names[:6])}.",
            "Do not move furniture position. Keep room geometry unchanged.",
        ]
        if OPENAI_NEGATIVE_PROMPT:
            essential_parts.append(f"Negative prompt: {OPENAI_NEGATIVE_PROMPT}")
        prompt = " ".join(part for part in essential_parts if part)
    if len(prompt) > OPENAI_PROMPT_MAX_LEN:
        prompt = prompt[:OPENAI_PROMPT_MAX_LEN]

    endpoint = f"{OPENAI_BASE_URL.rstrip('/')}/images/edits"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    files = {
        "image": ("composite.png", image_bytes.getvalue(), "image/png"),
        "mask": ("mask.png", mask_bytes.getvalue(), "image/png"),
    }

    def _request_with_model(model_name: str) -> tuple[requests.Response, str]:
        data = {
            "model": model_name,
            "prompt": prompt,
            "response_format": "b64_json",
            "n": "1",
        }
        if OPENAI_IMAGE_SIZE:
            data["size"] = OPENAI_IMAGE_SIZE
        if OPENAI_IMAGE_QUALITY and model_name != "dall-e-2":
            # The quality parameter is for GPT Image models.
            data["quality"] = OPENAI_IMAGE_QUALITY
        response = requests.post(
            endpoint,
            headers=headers,
            data=data,
            files=files,
            timeout=OPENAI_TIMEOUT_SEC,
        )
        return response, model_name

    primary_model = OPENAI_IMAGE_MODEL or "gpt-image-1"
    response, used_model = _request_with_model(primary_model)

    if response.status_code >= 400:
        try:
            err = response.json()
            message = str(err.get("error", {}).get("message") or err)
        except Exception:
            message = response.text

        can_fallback = (
            OPENAI_FALLBACK_MODEL
            and OPENAI_FALLBACK_MODEL != used_model
            and (
                "must be 'dall-e-2'" in message.lower()
                or "does not have access" in message.lower()
                or "model_not_found" in message.lower()
            )
        )
        if not can_fallback:
            raise ValueError(f"OpenAI image edit failed: {message}")

        response, used_model = _request_with_model(OPENAI_FALLBACK_MODEL)
        if response.status_code >= 400:
            try:
                err2 = response.json()
                message2 = str(err2.get("error", {}).get("message") or err2)
            except Exception:
                message2 = response.text
            raise ValueError(
                f"OpenAI image edit failed on '{primary_model}' and fallback "
                f"'{OPENAI_FALLBACK_MODEL}': {message2}"
            )

    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        payload = response.json()
        data_list = payload.get("data") or []
        if not data_list:
            raise ValueError("OpenAI returned empty data list.")
        first = data_list[0]
        if "b64_json" in first:
            result_bytes = base64.b64decode(first["b64_json"])
        elif "url" in first:
            image_resp = requests.get(first["url"], timeout=OPENAI_TIMEOUT_SEC)
            image_resp.raise_for_status()
            result_bytes = image_resp.content
        else:
            raise ValueError("OpenAI response missing b64_json/url image field.")
    else:
        result_bytes = response.content

    output_name = f"{uuid.uuid4().hex}.jpg"
    output_path = GENERATED_DIR / output_name
    result_image = Image.open(io.BytesIO(result_bytes)).convert("RGB")
    result_image.save(output_path, format="JPEG", quality=92)
    return output_name


def call_external_webhook(
    room_path: Path,
    scene_objects: list[dict],
) -> str:
    if not EXTERNAL_AI_WEBHOOK_URL:
        raise ValueError(
            "EXTERNAL_AI_WEBHOOK_URL is empty. Set it in .env for webhook mode."
        )

    room_bytes = room_path.read_bytes()
    payload_objects: list[dict] = []
    for obj in scene_objects:
        furniture = obj["furniture"]
        furniture_file = FURNITURE_DIR / furniture["asset_file"]
        furniture_bytes = furniture_file.read_bytes() if furniture_file.exists() else b""
        payload_objects.append(
            {
                "furniture_id": furniture["id"],
                "furniture_name": furniture["name"],
                "placement": {
                    "x": float(obj["x"]),
                    "y": float(obj["y"]),
                    "scale": float(obj.get("scale", 1.0)),
                    "rotation_deg": float(obj.get("rotation_deg", 0.0)),
                    "layer_order": int(obj.get("layer_order", 0)),
                },
                "furniture_asset_base64": base64.b64encode(furniture_bytes).decode("utf-8"),
                "furniture_prompt": furniture.get("prompt", ""),
            }
        )

    first = payload_objects[0] if payload_objects else {}
    payload = {
        # Extended payload with full scene for multi-object placement.
        "scene_objects": payload_objects,
        "room_image_base64": base64.b64encode(room_bytes).decode("utf-8"),
        # Backward compatible keys based on first object.
        "furniture_id": first.get("furniture_id"),
        "furniture_name": first.get("furniture_name"),
        "placement": first.get("placement"),
        "furniture_asset_base64": first.get("furniture_asset_base64"),
        "furniture_prompt": first.get("furniture_prompt"),
    }
    headers = {"Content-Type": "application/json"}
    if EXTERNAL_AI_WEBHOOK_TOKEN:
        headers["Authorization"] = f"Bearer {EXTERNAL_AI_WEBHOOK_TOKEN}"

    response = requests.post(
        EXTERNAL_AI_WEBHOOK_URL,
        json=payload,
        headers=headers,
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()

    if "result_image_base64" in data:
        image_data = base64.b64decode(data["result_image_base64"])
    elif "result_image_url" in data:
        image_resp = requests.get(data["result_image_url"], timeout=120)
        image_resp.raise_for_status()
        image_data = image_resp.content
    else:
        raise ValueError(
            "Webhook response must include result_image_base64 or result_image_url."
        )

    output_name = f"{uuid.uuid4().hex}.jpg"
    output_path = GENERATED_DIR / output_name
    output_path.write_bytes(image_data)
    return output_name


app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/furniture", methods=["GET"])
def api_furniture():
    items = [serialize_furniture_item(item) for item in load_catalog()]
    return jsonify({"items": items})


@app.route("/api/furniture/upload", methods=["POST"])
def api_upload_furniture():
    FURNITURE_DIR.mkdir(parents=True, exist_ok=True)

    image_file = request.files.get("furniture_image")
    name = (request.form.get("name") or "").strip()
    category = (request.form.get("category") or "custom").strip().lower() or "custom"
    prompt = (request.form.get("prompt") or "").strip()

    if not name:
        return jsonify({"error": "name is required"}), 400
    if not image_file or not image_file.filename:
        return jsonify({"error": "furniture_image file is required"}), 400
    if not allowed_image(image_file.filename):
        return jsonify({"error": "Only jpg, jpeg, png, webp are allowed"}), 400

    name_slug = make_slug(name)
    item_id = f"{name_slug}-{uuid.uuid4().hex[:8]}"

    try:
        asset_file = save_uploaded_furniture_image(image_file, name_slug)
    except Exception as exc:
        return jsonify({"error": f"Failed to read image file: {exc}"}), 400

    item = {
        "id": item_id,
        "name": name,
        "category": category,
        "asset_file": asset_file,
        "prompt": prompt or f"A realistic {name} in modern interior style",
    }
    items = load_catalog()
    items.append(item)
    save_catalog(items)
    rebuild_furniture_pack()

    return jsonify({"item": item})


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify(
        {
            "ok": True,
            "provider": GENERATION_PROVIDER,
            "openai_configured": bool(OPENAI_API_KEY),
        }
    )


@app.route("/api/render", methods=["POST"])
def api_render():
    ensure_dirs()
    room_file = request.files.get("room_image")
    scene_objects_raw = (request.form.get("scene_objects") or "").strip()

    if not room_file or not room_file.filename:
        return jsonify({"error": "room_image file is required"}), 400
    if not allowed_image(room_file.filename):
        return jsonify({"error": "Only jpg, jpeg, png, webp are allowed"}), 400

    scene_objects_input: list[dict]
    if scene_objects_raw:
        try:
            parsed = json.loads(scene_objects_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "scene_objects must be valid JSON array"}), 400
        if not isinstance(parsed, list) or len(parsed) == 0:
            return jsonify({"error": "scene_objects must be a non-empty array"}), 400
        scene_objects_input = parsed
    else:
        # Backward-compatible single-object format.
        furniture_id = (request.form.get("furniture_id") or "").strip()
        x_raw = (request.form.get("x") or "").strip()
        y_raw = (request.form.get("y") or "").strip()
        scale_raw = (request.form.get("scale") or "1").strip()
        rotation_raw = (
            (request.form.get("rotation_deg") or request.form.get("rotation") or "0").strip()
        )
        if not furniture_id:
            return jsonify({"error": "furniture_id is required"}), 400
        scene_objects_input = [
            {
                "furniture_id": furniture_id,
                "x": x_raw,
                "y": y_raw,
                "scale": scale_raw,
                "rotation_deg": rotation_raw,
            }
        ]

    if len(scene_objects_input) > 6:
        return jsonify({"error": "scene can contain at most 6 objects"}), 400

    scene_objects: list[dict] = []
    for idx, raw_obj in enumerate(scene_objects_input):
        if not isinstance(raw_obj, dict):
            return jsonify({"error": f"scene_objects[{idx}] must be object"}), 400

        furniture_id = str(raw_obj.get("furniture_id") or "").strip()
        if not furniture_id:
            return jsonify({"error": f"scene_objects[{idx}].furniture_id is required"}), 400

        furniture = get_furniture_item(furniture_id)
        if not furniture:
            return jsonify({"error": f"Unknown furniture_id at scene_objects[{idx}]"}), 400

        try:
            x = float(raw_obj.get("x"))
            y = float(raw_obj.get("y"))
            scale = float(raw_obj.get("scale", 1))
            rotation_deg = float(raw_obj.get("rotation_deg", raw_obj.get("rotation", 0)))
            layer_order = int(raw_obj.get("layer_order", idx))
        except (TypeError, ValueError):
            return jsonify(
                {
                    "error": f"scene_objects[{idx}] x, y, scale, rotation_deg must be numbers"
                }
            ), 400

        if x < 0 or x > 1 or y < 0 or y > 1:
            return jsonify({"error": f"scene_objects[{idx}] x and y must be in range 0..1"}), 400
        if scale < 0.5 or scale > 2.0:
            return jsonify({"error": f"scene_objects[{idx}] scale must be in range 0.5..2.0"}), 400
        if rotation_deg < -180 or rotation_deg > 180:
            return jsonify(
                {"error": f"scene_objects[{idx}] rotation_deg must be in range -180..180"}
            ), 400
        if layer_order < 0 or layer_order > 5:
            return jsonify(
                {"error": f"scene_objects[{idx}] layer_order must be in range 0..5"}
            ), 400

        scene_objects.append(
            {
                "id": raw_obj.get("id", f"obj-{idx}"),
                "furniture_id": furniture_id,
                "furniture": furniture,
                "x": x,
                "y": y,
                "scale": scale,
                "rotation_deg": rotation_deg,
                "layer_order": layer_order,
            }
        )

    room_ext = Path(room_file.filename).suffix.lower()
    upload_name = f"{uuid.uuid4().hex}{room_ext}"
    upload_path = UPLOADS_DIR / upload_name
    room_file.save(upload_path)

    try:
        if GENERATION_PROVIDER == "webhook":
            output_name = call_external_webhook(upload_path, scene_objects)
        elif GENERATION_PROVIDER == "openai":
            output_name = call_openai_image_edit(upload_path, scene_objects)
        else:
            output_name = draw_mock_result(upload_path, scene_objects)
    except Exception as exc:
        return jsonify({"error": f"Generation failed: {exc}"}), 500

    return jsonify(
        {
            "result_image_url": f"/generated/{output_name}",
            "provider": GENERATION_PROVIDER,
        }
    )


@app.route("/generated/<path:filename>")
def generated_file(filename: str):
    return send_from_directory(GENERATED_DIR, filename)


@app.route("/assets/furniture/<path:filename>")
def furniture_asset_file(filename: str):
    return send_from_directory(FURNITURE_DIR, filename)


if __name__ == "__main__":
    ensure_dirs()
    app.run(host="0.0.0.0", port=5000, debug=True)
