@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   Servidor OCR Manhwa - Iniciando...
echo ========================================
echo.

REM Verificar si Python esta instalado
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python no esta instalado.
    echo Descargalo desde: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Crear entorno virtual si no existe
if not exist "venv" (
    echo Creando entorno virtual...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo ERROR: No se pudo crear el entorno virtual.
        pause
        exit /b 1
    )
)

REM Activar entorno virtual
call venv\Scripts\activate.bat

REM Instalar dependencias si es necesario
pip show easyocr >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo Instalando dependencias...
    echo Esto puede tardar varios minutos la primera vez.
    echo.
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ERROR: No se pudieron instalar las dependencias.
        pause
        exit /b 1
    )
)

echo.
echo Iniciando servidor en http://localhost:5000
echo Presiona Ctrl+C para detener
echo.

python app.py

pause
