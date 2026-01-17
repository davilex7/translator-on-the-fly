# -*- coding: utf-8 -*-
"""
Servidor local de OCR para la extension Traductor de Manhwa.
Usa EasyOCR para detectar texto coreano/japones en imagenes.
"""

import base64
import io
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import easyocr

# --- Configuracion ---
app = Flask(__name__)
CORS(app)  # Permitir peticiones desde la extension

# Inicializar EasyOCR (carga el modelo una sola vez)
print("Cargando modelos de EasyOCR (puede tardar la primera vez)...")
reader = easyocr.Reader(['ko', 'en'], gpu=False)  # ko=coreano, en=ingles
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
        response = requests.get(MYMEMORY_API_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get('responseStatus') == 200:
            translated = data.get('responseData', {}).get('translatedText', text)
            # Limpiar prefijos conocidos
            if translated.upper().startswith('SUBJECT? '):
                translated = translated[9:]
            return translated.strip()
        return text
    except Exception as e:
        print(f"Error en traduccion: {e}")
        return text


@app.route('/')
def home():
    return jsonify({
        "status": "ok",
        "message": "Servidor OCR Manhwa funcionando",
        "version": "2.0 (EasyOCR)"
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

            # Convertir a RGB si es necesario
            if image.mode != 'RGB':
                image = image.convert('RGB')
        except Exception as e:
            return jsonify({"error": f"Error decodificando imagen: {str(e)}"}), 400

        # Ejecutar OCR con EasyOCR
        print(f"Procesando imagen ({image.width}x{image.height})...")
        results = reader.readtext(
            image,
            detail=1,          # Devolver coordenadas
            paragraph=False,   # Sin agrupar (devuelve 3 valores)
            min_size=10,       # Tamano minimo de texto
            text_threshold=0.5 # Umbral de confianza
        )

        # Procesar resultados
        blocks = []
        texts_to_translate = []

        for result in results:
            # EasyOCR devuelve (bbox, text, confidence)
            bbox_points = result[0]
            text = result[1]
            confidence = result[2] if len(result) > 2 else 0.9

            if not text or not text.strip():
                continue

            # Convertir bbox de puntos a x0,y0,x1,y1
            x_coords = [p[0] for p in bbox_points]
            y_coords = [p[1] for p in bbox_points]

            bbox = {
                "x0": int(min(x_coords)),
                "y0": int(min(y_coords)),
                "x1": int(max(x_coords)),
                "y1": int(max(y_coords))
            }

            blocks.append({
                "text": text.strip(),
                "bbox": bbox,
                "confidence": float(confidence)
            })
            texts_to_translate.append(text.strip())

        print(f"Detectados {len(blocks)} bloques de texto")

        # Traducir todos los textos de una vez
        if texts_to_translate:
            full_text = '\n'.join(texts_to_translate)
            translated_full = translate_text(full_text, target_lang)
            translated_lines = translated_full.split('\n')

            for i, block in enumerate(blocks):
                if i < len(translated_lines):
                    block['translatedText'] = translated_lines[i].strip()
                else:
                    block['translatedText'] = block['text']

        return jsonify({
            "success": True,
            "blocks": blocks
        })

    except Exception as e:
        print(f"Error en /ocr: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint para verificar que el servidor esta funcionando."""
    return jsonify({"status": "healthy", "ocr": "easyocr"})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n{'='*50}")
    print(f"  Servidor OCR Manhwa iniciado")
    print(f"  URL: http://localhost:{port}")
    print(f"  Presiona Ctrl+C para detener")
    print(f"{'='*50}\n")

    app.run(host='0.0.0.0', port=port, debug=False)
