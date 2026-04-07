import base64
import hmac
import io
import json
import os
import re
import threading
import time
import uuid
from queue import Queue
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from werkzeug.exceptions import RequestEntityTooLarge


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
try:
    FILE_TTL_HOURS = int((os.getenv("FILE_TTL_HOURS", "48") or "48").strip())
except ValueError:
    FILE_TTL_HOURS = 48
try:
    CLEANUP_INTERVAL_SEC = int((os.getenv("CLEANUP_INTERVAL_SEC", "900") or "900").strip())
except ValueError:
    CLEANUP_INTERVAL_SEC = 900
try:
    JOB_RETENTION_HOURS = int((os.getenv("JOB_RETENTION_HOURS", "24") or "24").strip())
except ValueError:
    JOB_RETENTION_HOURS = 24
try:
    MAX_UPLOAD_MB = int((os.getenv("MAX_UPLOAD_MB", "25") or "25").strip())
except ValueError:
    MAX_UPLOAD_MB = 25
try:
    RATE_LIMIT_WINDOW_SEC = int((os.getenv("RATE_LIMIT_WINDOW_SEC", "60") or "60").strip())
except ValueError:
    RATE_LIMIT_WINDOW_SEC = 60
try:
    RATE_LIMIT_MAX_REQUESTS = int(
        (
            os.getenv(
                "API_RATE_LIMIT_PER_MINUTE",
                os.getenv(
                    "RATE_LIMIT_PER_MIN",
                    os.getenv("RATE_LIMIT_MAX_REQUESTS", "240"),
                ),
            )
            or "240"
        ).strip()
    )
except ValueError:
    RATE_LIMIT_MAX_REQUESTS = 240
API_AUTH_TOKEN = os.getenv("API_AUTH_TOKEN", "").strip()
API_AUTH_HEADER = "X-API-Token"
MAX_UPLOAD_BYTES = max(1, MAX_UPLOAD_MB) * 1024 * 1024
ALLOWED_IMAGE_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/octet-stream",
}
SENSITIVE_PATHS = {
    "/api/furniture/upload",
    "/api/render",
    "/api/remove-furniture",
}

CATALOG_CACHE_LOCK = threading.Lock()
CATALOG_CACHE_MTIME_NS: int | None = None
CATALOG_CACHE_ITEMS: list[dict] = []
CATALOG_CACHE_LOADED = False


class SceneObjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    furniture_id: str = Field(min_length=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    scale: float = Field(default=1, ge=0.5, le=2.0)
    rotation_deg: float = Field(default=0, ge=-180, le=180)
    layer_order: int = Field(default=0, ge=0, le=5)


class RemoveBoxInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self):
        if not (self.x1 < self.x2 and self.y1 < self.y2):
            raise ValueError("remove_box must satisfy x1 < x2 and y1 < y2")
        if (self.x2 - self.x1) < 0.01 or (self.y2 - self.y1) < 0.01:
            raise ValueError("remove_box is too small")
        return self


class FurnitureItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    category: str
    asset_file: str
    prompt: str
    asset_url: str


class FurnitureListResponse(BaseModel):
    items: list[FurnitureItemResponse]


class FurnitureUploadResponse(BaseModel):
    item: FurnitureItemResponse


class HealthResponse(BaseModel):
    ok: bool
    provider: str
    openai_configured: bool


class RemoveFurnitureResponse(BaseModel):
    result_image_url: str
    provider: str


class RenderQueuedResponse(BaseModel):
    job_id: str
    status: str = "queued"


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = Field(ge=0, le=100)
    message: str = ""
    provider: str
    result_image_url: str = ""
    error: str = ""
    created_at: float | None = None
    updated_at: float | None = None
    scene_count: int = 0


def _validation_error_response(exc: ValidationError, prefix: str):
    first = (exc.errors() or [{}])[0]
    loc = ".".join(str(x) for x in first.get("loc", [])) or "payload"
    msg = first.get("msg") or "invalid data"
    return jsonify({"error": f"{prefix}.{loc}: {msg}"}), 400


def _parse_scene_objects_from_request(scene_objects_raw: str, form_data):
    if scene_objects_raw:
        try:
            parsed = json.loads(scene_objects_raw)
        except json.JSONDecodeError:
            return None, (jsonify({"error": "scene_objects must be valid JSON array"}), 400)
        if not isinstance(parsed, list) or len(parsed) == 0:
            return None, (jsonify({"error": "scene_objects must be a non-empty array"}), 400)
        raw_items = parsed
    else:
        furniture_id = (form_data.get("furniture_id") or "").strip()
        x_raw = (form_data.get("x") or "").strip()
        y_raw = (form_data.get("y") or "").strip()
        scale_raw = (form_data.get("scale") or "1").strip()
        rotation_raw = (
            (form_data.get("rotation_deg") or form_data.get("rotation") or "0").strip()
        )
        if not furniture_id:
            return None, (jsonify({"error": "furniture_id is required"}), 400)
        raw_items = [
            {
                "furniture_id": furniture_id,
                "x": x_raw,
                "y": y_raw,
                "scale": scale_raw,
                "rotation_deg": rotation_raw,
            }
        ]
    if len(raw_items) > 6:
        return None, (jsonify({"error": "scene can contain at most 6 objects"}), 400)
    validated: list[SceneObjectInput] = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return None, (jsonify({"error": f"scene_objects[{idx}] must be object"}), 400)
        payload = dict(raw)
        if "rotation_deg" not in payload and "rotation" in payload:
            payload["rotation_deg"] = payload.get("rotation")
        payload.setdefault("layer_order", idx)
        payload.setdefault("id", f"obj-{idx}")
        try:
            validated.append(SceneObjectInput.model_validate(payload))
        except ValidationError as exc:
            return None, _validation_error_response(exc, f"scene_objects[{idx}]")
    return validated, None


def _parse_remove_box(remove_box_raw: str):
    try:
        payload = json.loads(remove_box_raw)
    except json.JSONDecodeError:
        return None, (jsonify({"error": "remove_box must be valid JSON object"}), 400)
    if not isinstance(payload, dict):
        return None, (jsonify({"error": "remove_box must be object"}), 400)
    try:
        box = RemoveBoxInput.model_validate(payload)
    except ValidationError as exc:
        return None, _validation_error_response(exc, "remove_box")
    return (box.x1, box.y1, box.x2, box.y2), None


def ensure_dirs() -> None:
    for folder in (UPLOADS_DIR, GENERATED_DIR, PROCESSED_FURNITURE_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def load_catalog() -> list[dict]:
    global CATALOG_CACHE_LOADED, CATALOG_CACHE_MTIME_NS, CATALOG_CACHE_ITEMS
    if not CATALOG_FILE.exists():
        with CATALOG_CACHE_LOCK:
            CATALOG_CACHE_LOADED = True
            CATALOG_CACHE_MTIME_NS = None
            CATALOG_CACHE_ITEMS = []
        return []
    try:
        mtime_ns = CATALOG_FILE.stat().st_mtime_ns
    except OSError:
        return []
    with CATALOG_CACHE_LOCK:
        if CATALOG_CACHE_LOADED and CATALOG_CACHE_MTIME_NS == mtime_ns:
            return [dict(item) for item in CATALOG_CACHE_ITEMS]
        with CATALOG_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        items = data if isinstance(data, list) else []
        CATALOG_CACHE_ITEMS = [dict(item) for item in items]
        CATALOG_CACHE_MTIME_NS = mtime_ns
        CATALOG_CACHE_LOADED = True
        return [dict(item) for item in CATALOG_CACHE_ITEMS]


def save_catalog(items: list[dict]) -> None:
    global CATALOG_CACHE_LOADED, CATALOG_CACHE_MTIME_NS, CATALOG_CACHE_ITEMS
    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_FILE.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        mtime_ns = CATALOG_FILE.stat().st_mtime_ns
    except OSError:
        mtime_ns = None
    with CATALOG_CACHE_LOCK:
        CATALOG_CACHE_ITEMS = [dict(item) for item in items]
        CATALOG_CACHE_MTIME_NS = mtime_ns
        CATALOG_CACHE_LOADED = True


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


def get_catalog_map() -> dict[str, dict]:
    return {item.get("id", ""): item for item in load_catalog() if item.get("id")}


def serialize_furniture_item(item: dict) -> dict:
    data = dict(item)
    asset_file = (item.get("asset_file") or "").strip()
    data["asset_url"] = f"/assets/furniture/{asset_file}" if asset_file else ""
    return data


def allowed_image(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in {".jpg", ".jpeg", ".png", ".webp"}


RATE_LIMIT_LOCK = threading.Lock()
RATE_LIMIT_BUCKETS: dict[str, tuple[float, int]] = {}


def _client_ip() -> str:
    forwarded_for = (request.headers.get("X-Forwarded-For") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    return request.remote_addr or "unknown"


def _rate_limit_key() -> str:
    return f"{_client_ip()}:{request.path}"


def _apply_rate_limit():
    if not request.path.startswith("/api/"):
        return None
    now = time.time()
    key = _rate_limit_key()
    window = max(1, RATE_LIMIT_WINDOW_SEC)
    limit = max(1, RATE_LIMIT_MAX_REQUESTS)
    with RATE_LIMIT_LOCK:
        start_ts, count = RATE_LIMIT_BUCKETS.get(key, (now, 0))
        if (now - start_ts) >= window:
            start_ts, count = now, 0
        count += 1
        RATE_LIMIT_BUCKETS[key] = (start_ts, count)
        # opportunistic cleanup of stale buckets
        if len(RATE_LIMIT_BUCKETS) > 5000:
            stale_before = now - (window * 2)
            for bucket_key, (bucket_start, _) in list(RATE_LIMIT_BUCKETS.items()):
                if bucket_start < stale_before:
                    RATE_LIMIT_BUCKETS.pop(bucket_key, None)
    if count > limit:
        return jsonify(
            {
                "error": "Too many requests",
                "code": "rate_limited",
                "limit": limit,
                "window_sec": window,
            }
        ), 429
    return None


def _extract_request_token() -> str:
    bearer = (request.headers.get("Authorization") or "").strip()
    if bearer.lower().startswith("bearer "):
        return bearer[7:].strip()
    return (request.headers.get(API_AUTH_HEADER) or "").strip()


def _check_auth():
    if not API_AUTH_TOKEN:
        return None
    if request.path not in SENSITIVE_PATHS:
        return None
    token = _extract_request_token()
    if token and hmac.compare_digest(token, API_AUTH_TOKEN):
        return None
    return jsonify({"error": "Unauthorized", "code": "unauthorized"}), 401


def _validate_uploaded_image(upload_file, field_name: str):
    if not upload_file or not upload_file.filename:
        return jsonify({"error": f"{field_name} file is required"}), 400
    if not allowed_image(upload_file.filename):
        return jsonify({"error": "Only jpg, jpeg, png, webp are allowed"}), 400
    mime = str(upload_file.mimetype or upload_file.content_type or "").lower().split(";")[0]
    if mime and mime not in ALLOWED_IMAGE_MIME:
        return jsonify({"error": f"{field_name} has unsupported mime type: {mime}"}), 400
    try:
        pos = upload_file.stream.tell()
    except Exception:
        pos = None
    try:
        data = upload_file.read()
        if not data:
            return jsonify({"error": f"{field_name} is empty"}), 400
        if len(data) > MAX_UPLOAD_BYTES:
            return jsonify({"error": f"{field_name} exceeds {MAX_UPLOAD_MB}MB limit"}), 413
        img = Image.open(io.BytesIO(data))
        img.verify()
    except Exception:
        return jsonify({"error": f"{field_name} is not a valid image"}), 400
    finally:
        try:
            if pos is not None:
                upload_file.stream.seek(pos)
            else:
                upload_file.stream.seek(0)
        except Exception:
            pass
    return None


def _scene_object_to_runtime(item: SceneObjectInput, furniture: dict, fallback_idx: int) -> dict:
    return {
        "id": item.id or f"obj-{fallback_idx}",
        "furniture_id": item.furniture_id,
        "furniture": furniture,
        "x": float(item.x),
        "y": float(item.y),
        "scale": float(item.scale),
        "rotation_deg": float(item.rotation_deg),
        "layer_order": int(item.layer_order),
    }


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


def call_openai_remove_furniture(
    room_path: Path,
    remove_box: tuple[float, float, float, float] | None = None,
    remove_mask_image: bytes | None = None,
) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is empty. Add it to .env for openai mode.")

    image = Image.open(room_path).convert("RGB")
    width, height = image.size
    if remove_mask_image:
        raw_mask = Image.open(io.BytesIO(remove_mask_image)).convert("RGBA")
        if raw_mask.size != image.size:
            raw_mask = raw_mask.resize(image.size, Image.Resampling.BILINEAR)
        alpha = raw_mask.getchannel("A")
        editable = alpha.point(lambda a: 255 if a > 10 else 0)
        if not editable.getbbox():
            raise ValueError("remove mask is empty")
        inverse_alpha = editable.point(lambda p: 255 - p)
        mask = Image.new("RGBA", image.size, (255, 255, 255, 255))
        mask.putalpha(inverse_alpha)
    elif remove_box:
        x1n, y1n, x2n, y2n = remove_box
        target_box = (
            int(width * x1n),
            int(height * y1n),
            int(width * x2n),
            int(height * y2n),
        )
        target_box = _expand_box(target_box, margin=24, width=width, height=height)
        mask = _build_openai_mask(image.size, [target_box])
    else:
        raise ValueError("remove_box or remove_mask_image is required")

    image_bytes = io.BytesIO()
    image.save(image_bytes, format="PNG")
    image_bytes.seek(0)

    mask_bytes = io.BytesIO()
    mask.save(mask_bytes, format="PNG")
    mask_bytes.seek(0)

    prompt = (
        "Ты редактируешь реальную фотографию комнаты. "
        "Удали мебель и следы мебели строго внутри выделенной области маски. "
        "Естественно восстанови фон (пол/стены) в стиле исходного фото. "
        "Не изменяй ничего вне маски. Не добавляй новые объекты."
    )
    if OPENAI_NEGATIVE_PROMPT:
        prompt = f"{prompt} Negative prompt: {OPENAI_NEGATIVE_PROMPT}"
    if len(prompt) > OPENAI_PROMPT_MAX_LEN:
        prompt = prompt[:OPENAI_PROMPT_MAX_LEN]

    endpoint = f"{OPENAI_BASE_URL.rstrip('/')}/images/edits"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    files = {
        "image": ("room.png", image_bytes.getvalue(), "image/png"),
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
            raise ValueError(f"OpenAI remove furniture failed: {message}")

        response, used_model = _request_with_model(OPENAI_FALLBACK_MODEL)
        if response.status_code >= 400:
            try:
                err2 = response.json()
                message2 = str(err2.get("error", {}).get("message") or err2)
            except Exception:
                message2 = response.text
            raise ValueError(
                f"OpenAI remove furniture failed on '{primary_model}' and fallback "
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


def draw_local_remove_furniture(
    room_path: Path,
    remove_box: tuple[float, float, float, float] | None = None,
    remove_mask_image: bytes | None = None,
) -> str:
    image = Image.open(room_path).convert("RGB")
    width, height = image.size

    blur_radius = max(10, min(width, height) // 80)
    blurred = image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    if remove_mask_image:
        raw_mask = Image.open(io.BytesIO(remove_mask_image)).convert("RGBA")
        if raw_mask.size != image.size:
            raw_mask = raw_mask.resize(image.size, Image.Resampling.BILINEAR)
        mask = raw_mask.getchannel("A")
        if not mask.getbbox():
            raise ValueError("remove mask is empty")
        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(6, blur_radius // 2)))
    elif remove_box:
        x1n, y1n, x2n, y2n = remove_box
        box = (
            int(width * x1n),
            int(height * y1n),
            int(width * x2n),
            int(height * y2n),
        )
        box = _expand_box(box, margin=6, width=width, height=height)
        mask = Image.new("L", image.size, 0)
        draw = ImageDraw.Draw(mask)
        draw.rectangle(box, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(6, blur_radius // 2)))
    else:
        raise ValueError("remove_box or remove_mask_image is required")
    result = Image.composite(blurred, image, mask)

    output_name = f"{uuid.uuid4().hex}.jpg"
    output_path = GENERATED_DIR / output_name
    result.save(output_path, format="JPEG", quality=90)
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
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

JOBS_LOCK = threading.Lock()
RENDER_JOBS: dict[str, dict] = {}
RENDER_QUEUE: Queue = Queue()


def _now_ts() -> float:
    return time.time()


def _new_job(scene_count: int) -> tuple[str, dict]:
    job_id = f"job-{uuid.uuid4().hex}"
    created_at = _now_ts()
    job = {
        "id": job_id,
        "status": "queued",  # queued | running | done | error
        "progress": 2,
        "message": "Задача поставлена в очередь",
        "provider": GENERATION_PROVIDER,
        "result_image_url": "",
        "error": "",
        "created_at": created_at,
        "updated_at": created_at,
        "scene_count": int(scene_count),
    }
    return job_id, job


def _update_job(job_id: str, **fields) -> None:
    with JOBS_LOCK:
        job = RENDER_JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = _now_ts()


def _cleanup_expired_files() -> None:
    ttl_sec = max(1, FILE_TTL_HOURS) * 3600
    cutoff = _now_ts() - ttl_sec
    for folder in (UPLOADS_DIR, GENERATED_DIR):
        if not folder.exists():
            continue
        for path in folder.iterdir():
            if not path.is_file():
                continue
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except Exception:
                continue


def _cleanup_old_jobs() -> None:
    cutoff = _now_ts() - max(1, JOB_RETENTION_HOURS) * 3600
    with JOBS_LOCK:
        expired = [job_id for job_id, job in RENDER_JOBS.items() if float(job.get("updated_at", 0)) < cutoff]
        for job_id in expired:
            RENDER_JOBS.pop(job_id, None)


def _cleanup_loop() -> None:
    while True:
        try:
            _cleanup_expired_files()
            _cleanup_old_jobs()
        except Exception:
            pass
        time.sleep(max(60, CLEANUP_INTERVAL_SEC))


def _run_generation(upload_path: Path, scene_objects: list[dict]) -> str:
    if GENERATION_PROVIDER == "webhook":
        return call_external_webhook(upload_path, scene_objects)
    if GENERATION_PROVIDER == "openai":
        return call_openai_image_edit(upload_path, scene_objects)
    return draw_mock_result(upload_path, scene_objects)


def _render_worker_loop() -> None:
    while True:
        job_id, upload_path, scene_objects = RENDER_QUEUE.get()
        try:
            _update_job(job_id, status="running", progress=15, message="Подготовка данных для генерации")
            _update_job(job_id, progress=35, message="Нейросеть обрабатывает изображение")
            output_name = _run_generation(upload_path, scene_objects)
            _update_job(
                job_id,
                status="done",
                progress=100,
                message="Готово",
                result_image_url=f"/generated/{output_name}",
                provider=GENERATION_PROVIDER,
            )
        except Exception as exc:
            _update_job(
                job_id,
                status="error",
                progress=100,
                message="Ошибка генерации",
                error=str(exc),
            )
        finally:
            RENDER_QUEUE.task_done()


BACKGROUND_WORKERS_LOCK = threading.Lock()
BACKGROUND_WORKERS_STARTED = False


def _start_background_workers() -> None:
    global BACKGROUND_WORKERS_STARTED
    with BACKGROUND_WORKERS_LOCK:
        if BACKGROUND_WORKERS_STARTED:
            return
        render_worker = threading.Thread(target=_render_worker_loop, daemon=True, name="render-worker")
        cleanup_worker = threading.Thread(target=_cleanup_loop, daemon=True, name="cleanup-worker")
        render_worker.start()
        cleanup_worker.start()
        BACKGROUND_WORKERS_STARTED = True


def _job_payload(job: dict) -> dict:
    return {
        "job_id": job["id"],
        "status": job["status"],
        "progress": int(job.get("progress", 0)),
        "message": job.get("message", ""),
        "provider": job.get("provider") or GENERATION_PROVIDER,
        "result_image_url": job.get("result_image_url", ""),
        "error": job.get("error", ""),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }


@app.before_request
def _ensure_background_workers_started():
    _start_background_workers()


@app.before_request
def _before_request_security():
    rate_limit_result = _apply_rate_limit()
    if rate_limit_result:
        return rate_limit_result
    auth_result = _check_auth()
    if auth_result:
        return auth_result


@app.errorhandler(RequestEntityTooLarge)
@app.errorhandler(413)
def _handle_request_too_large(_error):
    return (
        jsonify(
            {
                "error": f"Request too large. Max allowed is {MAX_UPLOAD_MB}MB",
                "code": "request_too_large",
            }
        ),
        413,
    )


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/furniture", methods=["GET"])
def api_furniture():
    items = [FurnitureItemResponse.model_validate(serialize_furniture_item(item)).model_dump() for item in load_catalog()]
    return jsonify(FurnitureListResponse(items=items).model_dump())


@app.route("/api/furniture/upload", methods=["POST"])
def api_upload_furniture():
    FURNITURE_DIR.mkdir(parents=True, exist_ok=True)

    image_file = request.files.get("furniture_image")
    name = (request.form.get("name") or "").strip()
    category = (request.form.get("category") or "custom").strip().lower() or "custom"
    prompt = (request.form.get("prompt") or "").strip()

    if not name:
        return jsonify({"error": "name is required"}), 400
    image_validation = _validate_uploaded_image(image_file, "furniture_image")
    if image_validation is not None:
        return image_validation

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

    item_response = FurnitureItemResponse.model_validate(serialize_furniture_item(item)).model_dump()
    return jsonify(FurnitureUploadResponse(item=item_response).model_dump())


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify(
        {
            "ok": True,
            "provider": GENERATION_PROVIDER,
            "openai_configured": bool(OPENAI_API_KEY),
        }
    )


@app.route("/api/remove-furniture", methods=["POST"])
def api_remove_furniture():
    ensure_dirs()
    room_file = request.files.get("room_image")
    remove_box_raw = (request.form.get("remove_box") or "").strip()
    remove_mask_file = request.files.get("remove_mask")

    room_validation = _validate_uploaded_image(room_file, "room_image")
    if room_validation is not None:
        return room_validation
    if not remove_box_raw and not remove_mask_file:
        return jsonify({"error": "remove_box or remove_mask is required"}), 400

    remove_box_model, remove_box_error = _parse_remove_box(remove_box_raw)
    if remove_box_error:
        return remove_box_error
    remove_box = (
        (remove_box_model.x1, remove_box_model.y1, remove_box_model.x2, remove_box_model.y2)
        if remove_box_model
        else None
    )

    remove_mask_bytes: bytes | None = None
    if remove_mask_file and remove_mask_file.filename:
        mask_validation = _validate_uploaded_image(remove_mask_file, "remove_mask")
        if mask_validation is not None:
            return mask_validation
        try:
            remove_mask_bytes = remove_mask_file.read()
        except Exception:
            return jsonify({"error": "failed to read remove_mask file"}), 400
        if not remove_mask_bytes:
            return jsonify({"error": "remove_mask is empty"}), 400

    room_ext = Path(room_file.filename).suffix.lower()
    upload_name = f"{uuid.uuid4().hex}{room_ext}"
    upload_path = UPLOADS_DIR / upload_name
    room_file.save(upload_path)

    provider = "local-inpaint"
    try:
        if OPENAI_API_KEY:
            output_name = call_openai_remove_furniture(
                upload_path,
                remove_box=remove_box,
                remove_mask_image=remove_mask_bytes,
            )
            provider = "openai-inpaint"
        else:
            output_name = draw_local_remove_furniture(
                upload_path,
                remove_box=remove_box,
                remove_mask_image=remove_mask_bytes,
            )
    except Exception as exc:
        if OPENAI_API_KEY:
            try:
                output_name = draw_local_remove_furniture(
                    upload_path,
                    remove_box=remove_box,
                    remove_mask_image=remove_mask_bytes,
                )
                provider = "local-inpaint-fallback"
            except Exception:
                return jsonify({"error": f"Remove furniture failed: {exc}"}), 500
        else:
            return jsonify({"error": f"Remove furniture failed: {exc}"}), 500

    return jsonify(
        RemoveFurnitureResponse(
            result_image_url=f"/generated/{output_name}",
            provider=provider,
        ).model_dump()
    )


@app.route("/api/render", methods=["POST"])
def api_render():
    ensure_dirs()
    room_file = request.files.get("room_image")

    room_validation = _validate_uploaded_image(room_file, "room_image")
    if room_validation is not None:
        return room_validation

    scene_object_models, parse_error = _parse_scene_objects_from_request(
        (request.form.get("scene_objects") or "").strip(),
        request.form,
    )
    if parse_error:
        return parse_error
    if not scene_object_models:
        return jsonify({"error": "scene_objects must be a non-empty array"}), 400

    catalog_map = get_catalog_map()
    scene_objects: list[dict] = []
    for idx, obj in enumerate(scene_object_models):
        furniture_id = obj.furniture_id
        furniture = catalog_map.get(furniture_id)
        if not furniture:
            return jsonify({"error": f"Unknown furniture_id at scene_objects[{idx}]"}), 400

        scene_objects.append(
            {
                "id": obj.id or f"obj-{idx}",
                "furniture_id": furniture_id,
                "furniture": furniture,
                "x": obj.x,
                "y": obj.y,
                "scale": obj.scale,
                "rotation_deg": obj.rotation_deg,
                "layer_order": obj.layer_order,
            }
        )

    room_ext = Path(room_file.filename).suffix.lower()
    upload_name = f"{uuid.uuid4().hex}{room_ext}"
    upload_path = UPLOADS_DIR / upload_name
    room_file.save(upload_path)

    job_id, job = _new_job(len(scene_objects))
    with JOBS_LOCK:
        RENDER_JOBS[job_id] = job
    RENDER_QUEUE.put((job_id, upload_path, scene_objects))
    return jsonify(RenderQueuedResponse(job_id=job_id, status="queued").model_dump()), 202


@app.route("/generated/<path:filename>")
def generated_file(filename: str):
    return send_from_directory(GENERATED_DIR, filename)


@app.route("/api/jobs/<job_id>", methods=["GET"])
def api_job_status(job_id: str):
    with JOBS_LOCK:
        job = RENDER_JOBS.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        payload = JobStatusResponse(
            job_id=str(job.get("id", "")),
            status=str(job.get("status", "")),
            progress=int(job.get("progress", 0)),
            message=str(job.get("message", "")),
            provider=str(job.get("provider", GENERATION_PROVIDER)),
            result_image_url=str(job.get("result_image_url", "")),
            error=str(job.get("error", "")),
            created_at=float(job.get("created_at", 0)),
            updated_at=float(job.get("updated_at", 0)),
            scene_count=int(job.get("scene_count", 0)),
        )
        return jsonify(payload.model_dump())


@app.route("/assets/furniture/<path:filename>")
def furniture_asset_file(filename: str):
    return send_from_directory(FURNITURE_DIR, filename)


if __name__ == "__main__":
    ensure_dirs()
    _cleanup_expired_files()
    threading.Thread(target=_render_worker_loop, daemon=True, name="render-worker").start()
    threading.Thread(target=_cleanup_loop, daemon=True, name="files-cleanup-worker").start()
    app.run(host="0.0.0.0", port=5000, debug=True)
