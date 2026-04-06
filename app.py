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
OPENAI_IMAGE_SIZE = os.getenv("OPENAI_IMAGE_SIZE", "").strip()
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "").strip()
OPENAI_REFINE_PROMPT = os.getenv(
    "OPENAI_REFINE_PROMPT",
    "Blend the furniture naturally into the room. Preserve geometry and placement. "
    "Keep realistic contact shadows on the floor and match lighting and color tone.",
).strip()
try:
    OPENAI_TIMEOUT_SEC = int((os.getenv("OPENAI_TIMEOUT_SEC", "120") or "120").strip())
except ValueError:
    OPENAI_TIMEOUT_SEC = 120


def ensure_dirs() -> None:
    for folder in (UPLOADS_DIR, GENERATED_DIR):
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


def allowed_image(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in {".jpg", ".jpeg", ".png", ".webp"}


def _compose_room_with_furniture(
    room_path: Path, furniture: dict, x: float, y: float, add_shadow: bool = True
) -> tuple[Image.Image, dict]:
    image_rgba = Image.open(room_path).convert("RGBA")
    width, height = image_rgba.size
    px = int(width * x)
    py = int(height * y)

    asset_file = FURNITURE_DIR / furniture.get("asset_file", "")
    metadata: dict = {"anchor_point": (px, py), "furniture_box": None, "shadow_box": None}
    if asset_file.exists():
        overlay = Image.open(asset_file).convert("RGBA")
        ow, oh = overlay.size
        target_w = max(80, min(int(width * 0.28), int(width * 0.6)))
        scale = target_w / ow
        target_h = max(80, int(oh * scale))
        overlay = overlay.resize((target_w, target_h), Image.Resampling.LANCZOS)

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
        return image, metadata

    return image_rgba.convert("RGB"), metadata


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


def draw_mock_result(room_path: Path, furniture: dict, x: float, y: float) -> str:
    image, metadata = _compose_room_with_furniture(room_path, furniture, x, y, add_shadow=True)
    width, height = image.size
    px, py = metadata["anchor_point"]
    draw = ImageDraw.Draw(image)
    label = f"{furniture['name']}"
    font = ImageFont.load_default()
    try:
        left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
        text_w, text_h = right - left, bottom - top
    except AttributeError:
        text_w, text_h = draw.textsize(label, font=font)
    pad = 6
    bx1 = max(0, px + 8)
    by1 = max(0, py - text_h - 16)
    bx2 = min(width, bx1 + text_w + pad * 2)
    by2 = min(height, by1 + text_h + pad * 2)
    draw.rectangle((bx1, by1, bx2, by2), fill=(20, 20, 20))
    draw.text((bx1 + pad, by1 + pad), label, fill=(255, 255, 255), font=font)

    output_name = f"{uuid.uuid4().hex}.jpg"
    output_path = GENERATED_DIR / output_name
    image.save(output_path, format="JPEG", quality=90)
    return output_name


def call_openai_image_edit(room_path: Path, furniture: dict, x: float, y: float) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is empty. Add it to .env for openai mode.")

    image, metadata = _compose_room_with_furniture(room_path, furniture, x, y, add_shadow=True)
    width, height = image.size
    boxes: list[tuple[int, int, int, int]] = []
    for key in ("furniture_box", "shadow_box"):
        box = metadata.get(key)
        if box:
            boxes.append(_expand_box(box, margin=32, width=width, height=height))

    if not boxes:
        px, py = metadata.get("anchor_point", (width // 2, height // 2))
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

    prompt_parts = [OPENAI_REFINE_PROMPT.strip()]
    furniture_prompt = (furniture.get("prompt") or "").strip()
    if furniture_prompt:
        prompt_parts.append(f"Furniture details: {furniture_prompt}")
    prompt_parts.append("Do not move furniture position. Keep room geometry unchanged.")
    prompt = " ".join(part for part in prompt_parts if part)

    endpoint = f"{OPENAI_BASE_URL.rstrip('/')}/images/edits"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    data = {
        "model": OPENAI_IMAGE_MODEL or "gpt-image-1",
        "prompt": prompt,
        "response_format": "b64_json",
        "n": "1",
    }
    if OPENAI_IMAGE_SIZE:
        data["size"] = OPENAI_IMAGE_SIZE
    if OPENAI_IMAGE_QUALITY:
        data["quality"] = OPENAI_IMAGE_QUALITY

    files = {
        "image": ("composite.png", image_bytes.getvalue(), "image/png"),
        "mask": ("mask.png", mask_bytes.getvalue(), "image/png"),
    }
    response = requests.post(
        endpoint,
        headers=headers,
        data=data,
        files=files,
        timeout=OPENAI_TIMEOUT_SEC,
    )

    if response.status_code >= 400:
        try:
            err = response.json()
            message = err.get("error", {}).get("message") or err
        except Exception:
            message = response.text
        raise ValueError(f"OpenAI image edit failed: {message}")

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


def call_external_webhook(room_path: Path, furniture: dict, x: float, y: float) -> str:
    if not EXTERNAL_AI_WEBHOOK_URL:
        raise ValueError(
            "EXTERNAL_AI_WEBHOOK_URL is empty. Set it in .env for webhook mode."
        )

    room_bytes = room_path.read_bytes()
    furniture_file = FURNITURE_DIR / furniture["asset_file"]
    furniture_bytes = furniture_file.read_bytes() if furniture_file.exists() else b""

    payload = {
        "furniture_id": furniture["id"],
        "furniture_name": furniture["name"],
        "placement": {"x": x, "y": y},
        "room_image_base64": base64.b64encode(room_bytes).decode("utf-8"),
        "furniture_asset_base64": base64.b64encode(furniture_bytes).decode("utf-8"),
        "furniture_prompt": furniture.get("prompt", ""),
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
    return jsonify({"items": load_catalog()})


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
    furniture_id = (request.form.get("furniture_id") or "").strip()
    x_raw = (request.form.get("x") or "").strip()
    y_raw = (request.form.get("y") or "").strip()

    if not room_file or not room_file.filename:
        return jsonify({"error": "room_image file is required"}), 400
    if not allowed_image(room_file.filename):
        return jsonify({"error": "Only jpg, jpeg, png, webp are allowed"}), 400
    if not furniture_id:
        return jsonify({"error": "furniture_id is required"}), 400

    furniture = get_furniture_item(furniture_id)
    if not furniture:
        return jsonify({"error": "Unknown furniture_id"}), 400

    try:
        x = float(x_raw)
        y = float(y_raw)
    except ValueError:
        return jsonify({"error": "x and y must be numbers in range 0..1"}), 400

    if x < 0 or x > 1 or y < 0 or y > 1:
        return jsonify({"error": "x and y must be in range 0..1"}), 400

    room_ext = Path(room_file.filename).suffix.lower()
    upload_name = f"{uuid.uuid4().hex}{room_ext}"
    upload_path = UPLOADS_DIR / upload_name
    room_file.save(upload_path)

    try:
        if GENERATION_PROVIDER == "webhook":
            output_name = call_external_webhook(upload_path, furniture, x, y)
        elif GENERATION_PROVIDER == "openai":
            output_name = call_openai_image_edit(upload_path, furniture, x, y)
        else:
            output_name = draw_mock_result(upload_path, furniture, x, y)
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


if __name__ == "__main__":
    ensure_dirs()
    app.run(host="0.0.0.0", port=5000, debug=True)
