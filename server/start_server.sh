#!/bin/bash

echo "========================================"
echo "  Servidor OCR Manhwa - Iniciando..."
echo "========================================"
echo ""

# Verificar si Python esta instalado
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python3 no esta instalado."
    echo "Instalalo con: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# Ir al directorio del script
cd "$(dirname "$0")"

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "Creando entorno virtual..."
    python3 -m venv venv
fi

# Activar entorno virtual
source venv/bin/activate

# Instalar dependencias si es necesario
if ! python -c "import easyocr" 2>/dev/null; then
    echo "Instalando dependencias (esto puede tardar unos minutos)..."
    pip install -r requirements.txt
fi

echo ""
echo "Iniciando servidor..."
echo ""
python app.py
