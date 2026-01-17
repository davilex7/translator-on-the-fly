# -*- coding: utf-8 -*-
"""
Servidor local de OCR para la extension Traductor de Manhwa.
Usa EasyOCR para detectar texto coreano/japones en imagenes.

Version 3.0:
- Agrupa texto cercano en bocadillos para mejor traduccion
- Filtra SFX (efectos de sonido) automaticamente
"""

import base64
import io
import os
import math
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import easyocr

# --- Configuracion ---
app = Flask(__name__)
CORS(app)

# Configuracion de filtrado y agrupacion
MIN_CONFIDENCE = 0.3          # Confianza minima para considerar texto
MIN_TEXT_LENGTH = 1           # Longitud minima de texto
MAX_SFX_LENGTH = 3            # Texto <= a esto puede ser SFX
SFX_ASPECT_RATIO = 4.0        # Ratio aspecto extremo = probable SFX
GROUP_DISTANCE_FACTOR = 2.0   # Factor para distancia de agrupacion

# Inicializar EasyOCR
print("Cargando modelos de EasyOCR (puede tardar la primera vez)...")
reader = easyocr.Reader(['ko', 'en'], gpu=False)
print("Modelos cargados correctamente.")

# --- API de traduccion MyMemory ---
MYMEMORY_API_URL = "https://api.mymemory.translated.net/get"


def translate_text(text, target_lang, source_lang='ko'):
    """Traduce texto usando MyMemory API (gratuita)."""
    if not text or not text.strip():
        return ""

    import requests
    params = {
        'q': text,
        'langpair': f'{source_lang}|{target_lang}'
    }

    try:
        response = requests.get(MYMEMORY_API_URL, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        if data.get('responseStatus') == 200:
            translated = data.get('responseData', {}).get('translatedText', text)
            if translated.upper().startswith('SUBJECT? '):
                translated = translated[9:]
            return translated.strip()
        return text
    except Exception as e:
        print(f"Error en traduccion: {e}")
        return text


def is_likely_sfx(block, image_width, image_height):
    """
    Determina si un bloque de texto es probablemente un SFX.

    Caracteristicas de SFX:
    - Texto muy corto (1-3 caracteres)
    - Bounding box con aspect ratio extremo
    - Baja confianza
    - Posicion en bordes de la imagen
    """
    text = block['text']
    bbox = block['bbox']
    confidence = block.get('confidence', 1.0)

    width = bbox['x1'] - bbox['x0']
    height = bbox['y1'] - bbox['y0']

    if width <= 0 or height <= 0:
        return True

    aspect_ratio = max(width, height) / min(width, height)

    # Texto muy corto con aspect ratio extremo = SFX
    if len(text) <= MAX_SFX_LENGTH:
        if aspect_ratio > SFX_ASPECT_RATIO:
            return True
        # Texto corto con baja confianza
        if confidence < 0.5:
            return True

    # Texto de un solo caracter aislado casi siempre es SFX
    if len(text) == 1 and confidence < 0.7:
        return True

    return False


def get_block_center(block):
    """Obtiene el centro de un bloque."""
    bbox = block['bbox']
    cx = (bbox['x0'] + bbox['x1']) / 2
    cy = (bbox['y0'] + bbox['y1']) / 2
    return cx, cy


def get_block_height(block):
    """Obtiene la altura de un bloque."""
    bbox = block['bbox']
    return bbox['y1'] - bbox['y0']


def distance_between_blocks(block1, block2):
    """Calcula la distancia entre los centros de dos bloques."""
    cx1, cy1 = get_block_center(block1)
    cx2, cy2 = get_block_center(block2)
    return math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2)


def blocks_are_horizontally_aligned(block1, block2, tolerance=0.5):
    """Verifica si dos bloques estan alineados horizontalmente (misma linea)."""
    bbox1 = block1['bbox']
    bbox2 = block2['bbox']

    h1 = bbox1['y1'] - bbox1['y0']
    h2 = bbox2['y1'] - bbox2['y0']
    avg_height = (h1 + h2) / 2

    # Los centros Y deben estar cerca
    cy1 = (bbox1['y0'] + bbox1['y1']) / 2
    cy2 = (bbox2['y0'] + bbox2['y1']) / 2

    return abs(cy1 - cy2) < avg_height * tolerance


def merge_blocks(blocks):
    """Fusiona una lista de bloques en uno solo."""
    if not blocks:
        return None
    if len(blocks) == 1:
        return blocks[0].copy()

    # Ordenar por posicion X para texto de izquierda a derecha
    # O por posicion Y si estan en lineas diferentes
    sorted_blocks = sorted(blocks, key=lambda b: (b['bbox']['y0'], b['bbox']['x0']))

    # Fusionar texto
    lines = []
    current_line = []
    last_y = None

    for block in sorted_blocks:
        cy = (block['bbox']['y0'] + block['bbox']['y1']) / 2
        height = block['bbox']['y1'] - block['bbox']['y0']

        if last_y is None or abs(cy - last_y) < height * 0.7:
            # Misma linea
            current_line.append(block)
        else:
            # Nueva linea
            if current_line:
                # Ordenar por X
                current_line.sort(key=lambda b: b['bbox']['x0'])
                line_text = ' '.join(b['text'] for b in current_line)
                lines.append(line_text)
            current_line = [block]

        last_y = cy

    # Agregar ultima linea
    if current_line:
        current_line.sort(key=lambda b: b['bbox']['x0'])
        line_text = ' '.join(b['text'] for b in current_line)
        lines.append(line_text)

    merged_text = ' '.join(lines)

    # Fusionar bounding boxes
    x0 = min(b['bbox']['x0'] for b in blocks)
    y0 = min(b['bbox']['y0'] for b in blocks)
    x1 = max(b['bbox']['x1'] for b in blocks)
    y1 = max(b['bbox']['y1'] for b in blocks)

    # Promedio de confianza
    avg_confidence = sum(b.get('confidence', 0.9) for b in blocks) / len(blocks)

    return {
        'text': merged_text,
        'bbox': {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1},
        'confidence': avg_confidence
    }


def group_text_blocks(blocks, image_width, image_height):
    """
    Agrupa bloques de texto cercanos en 'bocadillos'.
    Usa clustering basado en distancia espacial.
    """
    if not blocks:
        return []

    if len(blocks) == 1:
        return blocks

    # Calcular distancia maxima para agrupar (proporcional al tamano promedio del texto)
    avg_height = sum(get_block_height(b) for b in blocks) / len(blocks)
    max_group_distance = avg_height * GROUP_DISTANCE_FACTOR

    # Clustering simple: agrupar bloques cercanos
    groups = []
    used = set()

    for i, block in enumerate(blocks):
        if i in used:
            continue

        # Iniciar nuevo grupo
        group = [block]
        used.add(i)

        # Buscar bloques cercanos
        for j, other in enumerate(blocks):
            if j in used:
                continue

            # Verificar distancia con cualquier bloque del grupo
            for grouped_block in group:
                dist = distance_between_blocks(grouped_block, other)

                # Ser mas permisivo si estan alineados horizontalmente
                threshold = max_group_distance
                if blocks_are_horizontally_aligned(grouped_block, other):
                    threshold *= 2  # Mayor tolerancia para misma linea

                if dist < threshold:
                    group.append(other)
                    used.add(j)
                    break

        groups.append(group)

    # Fusionar cada grupo en un solo bloque
    merged_blocks = []
    for group in groups:
        merged = merge_blocks(group)
        if merged:
            merged_blocks.append(merged)

    return merged_blocks


@app.route('/')
def home():
    return jsonify({
        "status": "ok",
        "message": "Servidor OCR Manhwa funcionando",
        "version": "3.0 (EasyOCR + Agrupacion + Filtro SFX)"
    })


@app.route('/ocr', methods=['POST', 'OPTIONS'])
def ocr_endpoint():
    """
    Endpoint principal de OCR.
    Recibe: JSON con 'image' (base64) y 'targetLang' (codigo de idioma)
    Devuelve: JSON con 'blocks' (lista de bloques con texto, bbox, translatedText)
    """
    if request.method == 'OPTIONS':
        return '', 200

    try:
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({"error": "Falta el campo 'image' en la peticion"}), 400

        image_base64 = data['image']
        target_lang = data.get('targetLang', 'es')

        # Decodificar imagen
        try:
            image_bytes = base64.b64decode(image_base64)
            image = Image.open(io.BytesIO(image_bytes))

            if image.mode != 'RGB':
                image = image.convert('RGB')
        except Exception as e:
            return jsonify({"error": f"Error decodificando imagen: {str(e)}"}), 400

        image_width, image_height = image.size
        print(f"Procesando imagen ({image_width}x{image_height})...")

        # Ejecutar OCR con EasyOCR
        results = reader.readtext(
            image,
            detail=1,
            paragraph=False,
            min_size=10,
            text_threshold=0.4,
            low_text=0.3
        )

        # Procesar resultados iniciales
        raw_blocks = []

        for result in results:
            bbox_points = result[0]
            text = result[1]
            confidence = result[2] if len(result) > 2 else 0.9

            if not text or not text.strip():
                continue

            if confidence < MIN_CONFIDENCE:
                continue

            if len(text.strip()) < MIN_TEXT_LENGTH:
                continue

            x_coords = [p[0] for p in bbox_points]
            y_coords = [p[1] for p in bbox_points]

            block = {
                "text": text.strip(),
                "bbox": {
                    "x0": int(min(x_coords)),
                    "y0": int(min(y_coords)),
                    "x1": int(max(x_coords)),
                    "y1": int(max(y_coords))
                },
                "confidence": float(confidence)
            }

            raw_blocks.append(block)

        print(f"Detectados {len(raw_blocks)} bloques de texto (antes de filtrar)")

        # Filtrar SFX
        filtered_blocks = [
            b for b in raw_blocks
            if not is_likely_sfx(b, image_width, image_height)
        ]

        sfx_count = len(raw_blocks) - len(filtered_blocks)
        if sfx_count > 0:
            print(f"Filtrados {sfx_count} bloques como SFX")

        # Agrupar texto cercano en bocadillos
        grouped_blocks = group_text_blocks(filtered_blocks, image_width, image_height)
        print(f"Agrupados en {len(grouped_blocks)} bocadillos")

        # Traducir todos los textos
        if grouped_blocks:
            # Traducir cada bocadillo por separado para mejor contexto
            for block in grouped_blocks:
                translated = translate_text(block['text'], target_lang)
                block['translatedText'] = translated

        return jsonify({
            "success": True,
            "blocks": grouped_blocks
        })

    except Exception as e:
        print(f"Error en /ocr: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "ocr": "easyocr", "version": "3.0"})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n{'='*50}")
    print(f"  Servidor OCR Manhwa v3.0")
    print(f"  - Agrupacion de texto en bocadillos")
    print(f"  - Filtrado de SFX")
    print(f"  URL: http://localhost:{port}")
    print(f"  Presiona Ctrl+C para detener")
    print(f"{'='*50}\n")

    app.run(host='0.0.0.0', port=port, debug=False)
