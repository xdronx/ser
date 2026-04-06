import base64
import json
import os
import re
import uuid
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageDraw, ImageFont
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


def draw_mock_result(room_path: Path, furniture: dict, x: float, y: float) -> str:
    image = Image.open(room_path).convert("RGB")
    width, height = image.size
    px = int(width * x)
    py = int(height * y)

    draw = ImageDraw.Draw(image)
    asset_file = FURNITURE_DIR / furniture.get("asset_file", "")
    if asset_file.exists():
        overlay = Image.open(asset_file).convert("RGBA")
        ow, oh = overlay.size
        target_w = max(80, min(int(width * 0.28), int(width * 0.6)))
        scale = target_w / ow
        target_h = max(80, int(oh * scale))
        overlay = overlay.resize((target_w, target_h), Image.Resampling.LANCZOS)

        # Anchor the object by its bottom center to the clicked point.
        x1 = px - target_w // 2
        y1 = py - target_h
        image_rgba = image.convert("RGBA")
        image_rgba.paste(overlay, (x1, y1), overlay)
        image = image_rgba.convert("RGB")
        draw = ImageDraw.Draw(image)
    else:
        # Fallback marker if asset file is missing.
        radius = max(12, min(width, height) // 40)
        draw.ellipse(
            (px - radius, py - radius, px + radius, py + radius),
            fill=(0, 170, 255),
            outline=(255, 255, 255),
            width=3,
        )

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
    return jsonify({"ok": True, "provider": GENERATION_PROVIDER})


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
