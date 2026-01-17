@echo off
echo ========================================
echo   Servidor OCR Manhwa - Iniciando...
echo ========================================
echo.

REM Verificar si Python esta instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no esta instalado.
    echo Descargalo desde: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Crear entorno virtual si no existe
if not exist "venv" (
    echo Creando entorno virtual...
    python -m venv venv
)

REM Activar entorno virtual
call venv\Scripts\activate.bat

REM Instalar dependencias si es necesario
if not exist "venv\Lib\site-packages\easyocr" (
    echo Instalando dependencias (esto puede tardar unos minutos)...
    pip install -r requirements.txt
)

echo.
echo Iniciando servidor...
echo.
python app.py

pause
