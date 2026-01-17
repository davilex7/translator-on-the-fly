# Traductor de Imágenes

**Extensión de Chrome para traducir texto en imágenes en tiempo real**

Detecta y traduce automáticamente texto en imágenes web usando OCR (Reconocimiento Óptico de Caracteres) y superpone las traducciones directamente sobre las imágenes originales.

---

## Tabla de Contenidos

- [Características](#características)
- [Guía de Usuario](#guía-de-usuario)
  - [Requisitos](#requisitos)
  - [Instalación](#instalación)
  - [Uso](#uso)
  - [Solución de Problemas](#solución-de-problemas)
- [Documentación Técnica](#documentación-técnica)
  - [Arquitectura](#arquitectura)
  - [Estructura del Proyecto](#estructura-del-proyecto)
  - [Componentes](#componentes)
  - [Flujo de Datos](#flujo-de-datos)
  - [API del Servidor](#api-del-servidor)
  - [Configuración Avanzada](#configuración-avanzada)
  - [Desarrollo](#desarrollo)

---

## Características

| Característica | Descripción |
|----------------|-------------|
| **Multi-idioma** | Soporta Coreano, Japonés, Inglés y Español como idiomas de origen |
| **OCR Local** | Procesamiento 100% local usando EasyOCR - sin enviar datos a servicios externos |
| **Gratuito** | No requiere APIs de pago ni suscripciones |
| **Tiempo Real** | Traduce imágenes mientras navegas |
| **Detección Automática** | Encuentra imágenes automáticamente, incluyendo las cargadas dinámicamente |
| **Filtrado Inteligente** | Filtra efectos de sonido (SFX) y agrupa texto en bocadillos |
| **Sin CORS** | Bypass de restricciones CORS mediante Service Worker |

---

# Guía de Usuario

## Requisitos

### Software Necesario

1. **Google Chrome** (versión 88 o superior)
2. **Python 3.8+** con pip
3. **~2GB de espacio en disco** (para modelos de OCR)
4. **4GB+ de RAM** recomendado

### Verificar Python

```bash
python --version
# o en algunos sistemas:
python3 --version
```

Si no tienes Python, descárgalo desde [python.org](https://www.python.org/downloads/)

---

## Instalación

### Paso 1: Descargar el Proyecto

```bash
git clone <url-del-repositorio>
cd translator-on-the-fly
```

O descarga y extrae el ZIP del repositorio.

### Paso 2: Instalar Dependencias de Python

**Windows:**
```bash
cd server
pip install -r requirements.txt
```

**Linux/Mac:**
```bash
cd server
pip3 install -r requirements.txt
```

> **Nota:** La primera instalación descargará los modelos de EasyOCR (~500MB). Esto puede tardar varios minutos.

### Paso 3: Instalar la Extensión en Chrome

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa el **Modo de desarrollador** (esquina superior derecha)
3. Haz clic en **Cargar descomprimida**
4. Selecciona la carpeta del proyecto (donde está `manifest.json`)

La extensión aparecerá en tu barra de herramientas.

---

## Uso

### 1. Iniciar el Servidor OCR

**Windows:** Doble clic en `server/start_server.bat`

**Linux/Mac:**
```bash
cd server
chmod +x start_server.sh
./start_server.sh
```

Verás un mensaje como:
```
==================================================
  Servidor OCR v4.0 - Multi-idioma
  - Idiomas: Coreano, Japones, Ingles, Espanol
  URL: http://localhost:5000
==================================================
```

> **Primera ejecución:** El servidor tardará más en iniciar mientras descarga los modelos de idioma.

### 2. Configurar la Extensión

1. Haz clic en el icono de la extensión en Chrome
2. Verifica que el servidor muestre **"Conectado (EasyOCR)"**
3. Selecciona el **idioma de origen** (el idioma del texto en las imágenes)
4. Selecciona el **idioma de destino** (al que quieres traducir)

### 3. Traducir

1. Navega a cualquier página web con imágenes que contengan texto
2. Activa el interruptor **"Activar traducción"**
3. Las traducciones aparecerán superpuestas sobre las imágenes

### 4. Desactivar

- Desactiva el interruptor para ocultar las traducciones
- Las traducciones se eliminan y la página vuelve a su estado original

---

## Solución de Problemas

### El servidor no conecta

| Problema | Solución |
|----------|----------|
| "Desconectado" en el popup | Verifica que el servidor esté ejecutándose en la terminal |
| Puerto ocupado | Cambia el puerto en la configuración o cierra otras aplicaciones |
| Firewall bloqueando | Permite conexiones a `localhost:5000` |

### No se detectan imágenes

- Asegúrate de que las imágenes estén completamente cargadas
- Verifica que las imágenes tengan al menos 50x50 píxeles
- Algunas imágenes protegidas no pueden ser procesadas

### Traducciones incorrectas

- Verifica que has seleccionado el idioma de origen correcto
- El OCR funciona mejor con texto claro y bien definido
- Textos estilizados o con efectos pueden no reconocerse bien

### Error "Invalid input type"

- Reinicia el servidor Python
- Asegúrate de tener la última versión del código

### Alto consumo de memoria

- El servidor carga múltiples modelos de idioma (~1.5GB total)
- Cierra el servidor cuando no lo uses
- Considera usar solo los idiomas que necesites (requiere modificar código)

---

# Documentación Técnica

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         NAVEGADOR                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Popup     │◄──►│  Background │◄──►│   Content Script    │  │
│  │  (popup.js) │    │   (SW)      │    │   (content.js)      │  │
│  └─────────────┘    └──────┬──────┘    └──────────┬──────────┘  │
│                            │                       │             │
│                            │ fetch (no CORS)       │ DOM         │
│                            ▼                       ▼             │
│                     ┌─────────────┐         ┌───────────┐        │
│                     │   Imagen    │         │  Overlays │        │
│                     │   (base64)  │         │   HTML    │        │
│                     └──────┬──────┘         └───────────┘        │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP POST
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SERVIDOR LOCAL (Python)                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Flask     │───►│  EasyOCR    │───►│   MyMemory API      │  │
│  │   /ocr      │    │  (3 models) │    │   (traducción)      │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Componentes Principales

| Componente | Tecnología | Función |
|------------|------------|---------|
| **Popup** | HTML/JS | Interfaz de usuario, configuración |
| **Background** | Service Worker | Descarga imágenes (bypass CORS), comunicación |
| **Content Script** | JavaScript | Detecta imágenes, crea overlays |
| **Servidor** | Flask + EasyOCR | OCR y traducción |

---

## Estructura del Proyecto

```
translator-on-the-fly/
├── manifest.json          # Configuración de la extensión
├── background.js          # Service Worker
├── popup.html             # UI del popup
├── js/
│   ├── popup.js           # Lógica del popup
│   └── content.js         # Script inyectado en páginas
├── css/
│   └── tailwind.min.css   # Estilos
├── icons/                 # Iconos de la extensión
└── server/
    ├── app.py             # Servidor Flask + EasyOCR
    ├── requirements.txt   # Dependencias Python
    ├── start_server.bat   # Script inicio Windows
    └── start_server.sh    # Script inicio Linux/Mac
```

---

## Componentes

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "Traductor de Imagenes",
  "version": "4.0.0",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>", "http://localhost:*/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["js/content.js"]
  }]
}
```

**Permisos clave:**
- `<all_urls>`: Permite al Service Worker descargar imágenes de cualquier dominio
- `storage`: Guarda preferencias del usuario
- `scripting`: Inyecta content scripts dinámicamente

### background.js (Service Worker)

**Responsabilidades:**
1. Inicializar configuración por defecto
2. Descargar imágenes de cualquier origen (sin CORS)
3. Enviar imágenes al servidor OCR
4. Retransmitir respuestas al content script

**Mensaje principal:**
```javascript
// Petición
{
  action: 'processImageUrl',
  imageUrl: 'https://example.com/image.jpg',
  sourceLang: 'ko',
  targetLang: 'es'
}

// Respuesta
{
  success: true,
  data: {
    blocks: [
      {
        text: '안녕하세요',
        translatedText: 'Hola',
        bbox: { x0: 10, y0: 20, x1: 100, y1: 50 },
        confidence: 0.95
      }
    ]
  }
}
```

### content.js

**Responsabilidades:**
1. Detectar imágenes en la página (incluyendo lazy-loaded)
2. Filtrar imágenes no relevantes (iconos, ads, etc.)
3. Enviar URLs al background para procesamiento
4. Crear overlays HTML con las traducciones
5. Observar mutaciones DOM para nuevas imágenes

**Configuración de filtrado:**
```javascript
const MIN_IMAGE_DIMENSION = 50;   // px mínimos en cualquier dimensión
const MIN_IMAGE_AREA = 10000;     // área mínima (ej. 100x100)
const MAX_CONCURRENT = 2;         // procesamiento paralelo máximo
const PROCESS_DELAY = 500;        // ms entre procesamientos
```

**Clases CSS ignoradas:**
```javascript
['icon', 'avatar', 'emoji', 'ad-', 'ads-']
```

### server/app.py

**Modelos EasyOCR cargados:**
```python
reader_ko = easyocr.Reader(['ko', 'en'], gpu=False)    # Coreano
reader_ja = easyocr.Reader(['ja', 'en'], gpu=False)    # Japonés
reader_latin = easyocr.Reader(['en', 'es'], gpu=False) # Inglés/Español
```

**Procesamiento de imagen:**
1. Decodificar base64 → PIL Image
2. Convertir a numpy array
3. Ejecutar OCR con el reader apropiado
4. Filtrar SFX (efectos de sonido)
5. Agrupar texto cercano en "bocadillos"
6. Traducir cada grupo con MyMemory API

---

## Flujo de Datos

```
1. Usuario activa traducción
   │
   ▼
2. content.js encuentra imágenes válidas
   │
   ▼
3. Por cada imagen:
   │
   ├─► content.js envía URL al background
   │
   ├─► background.js descarga imagen (bypass CORS)
   │
   ├─► background.js convierte a base64
   │
   ├─► background.js POST a servidor /ocr
   │
   ├─► servidor ejecuta EasyOCR
   │
   ├─► servidor filtra SFX y agrupa texto
   │
   ├─► servidor traduce con MyMemory API
   │
   ├─► servidor retorna bloques con traducciones
   │
   ├─► background.js retorna respuesta
   │
   └─► content.js crea overlays HTML
```

---

## API del Servidor

### GET /health

Verifica estado del servidor.

**Respuesta:**
```json
{
  "status": "healthy",
  "ocr": "easyocr",
  "version": "4.0",
  "languages": ["ko", "ja", "en", "es"]
}
```

### POST /ocr

Procesa una imagen y retorna texto detectado con traducciones.

**Request:**
```json
{
  "image": "<base64-encoded-image>",
  "sourceLang": "ko",
  "targetLang": "es"
}
```

**Response:**
```json
{
  "success": true,
  "blocks": [
    {
      "text": "원본 텍스트",
      "translatedText": "Texto traducido",
      "bbox": {
        "x0": 10,
        "y0": 20,
        "x1": 150,
        "y1": 60
      },
      "confidence": 0.92
    }
  ]
}
```

**Códigos de error:**
| Código | Descripción |
|--------|-------------|
| 400 | Imagen faltante o inválida |
| 500 | Error interno del servidor |

---

## Configuración Avanzada

### Cambiar Puerto del Servidor

**Opción 1:** Variable de entorno
```bash
PORT=8080 python app.py
```

**Opción 2:** En el popup de la extensión, expandir "Configurar URL" y cambiar a `http://localhost:8080`

### Ajustar Filtrado de SFX

En `server/app.py`:
```python
MIN_CONFIDENCE = 0.3          # Confianza mínima (0-1)
MAX_SFX_LENGTH = 3            # Caracteres máximos para considerar SFX
SFX_ASPECT_RATIO = 4.0        # Ratio de aspecto extremo = SFX
GROUP_DISTANCE_FACTOR = 2.0   # Factor de agrupación de texto
```

### Ajustar Filtrado de Imágenes

En `js/content.js`:
```javascript
const MIN_IMAGE_DIMENSION = 50;   // Aumentar para ignorar imágenes pequeñas
const MIN_IMAGE_AREA = 10000;     // Aumentar para ser más restrictivo
const MAX_CONCURRENT = 2;         // Reducir si hay problemas de rendimiento
```

### Usar GPU para OCR

Si tienes una GPU NVIDIA con CUDA:

1. Instalar PyTorch con CUDA:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

2. Modificar `server/app.py`:
```python
reader_ko = easyocr.Reader(['ko', 'en'], gpu=True)
# ... igual para los demás readers
```

---

## Desarrollo

### Requisitos de Desarrollo

- Node.js (opcional, para linting)
- Python 3.8+
- Chrome con modo desarrollador

### Depuración

**Extension (Chrome):**
1. `chrome://extensions/` → "Inspeccionar vistas: service worker"
2. En cualquier página: F12 → Consola (para content.js)
3. Click derecho en popup → "Inspeccionar"

**Servidor:**
```bash
# Ejecutar con debug
FLASK_DEBUG=1 python app.py
```

### Añadir Nuevo Idioma

1. **Servidor** (`app.py`):
```python
# Añadir nuevo reader
reader_zh = easyocr.Reader(['ch_sim', 'en'], gpu=False)

# Añadir al mapeo
READERS = {
    # ... existentes ...
    'zh': reader_zh
}
```

2. **Popup** (`popup.html`):
```html
<option value="zh">Chino</option>
```

3. Reiniciar servidor y recargar extensión.

### Estructura de un Bloque de Texto

```javascript
{
  text: string,           // Texto original detectado
  translatedText: string, // Traducción
  bbox: {
    x0: number,           // Esquina superior izquierda X
    y0: number,           // Esquina superior izquierda Y
    x1: number,           // Esquina inferior derecha X
    y1: number            // Esquina inferior derecha Y
  },
  confidence: number      // Confianza del OCR (0-1)
}
```

### Tests Manuales Recomendados

1. **Página estática:** Verificar detección básica
2. **Scroll infinito:** Verificar MutationObserver
3. **Imágenes lazy-load:** Verificar detección de data-src
4. **Múltiples idiomas:** Cambiar idioma origen y verificar
5. **Desactivar/Activar:** Verificar limpieza de overlays

---

## Limitaciones Conocidas

| Limitación | Descripción |
|------------|-------------|
| **Texto estilizado** | Fuentes muy decorativas pueden no reconocerse |
| **Imágenes protegidas** | Algunas CDN bloquean incluso al Service Worker |
| **Memoria** | ~1.5GB RAM con todos los modelos cargados |
| **Velocidad** | OCR sin GPU es lento en imágenes grandes |
| **MyMemory API** | Límite de 1000 palabras/día en la versión gratuita |

---

## Licencia

Este proyecto es de código abierto. Siéntete libre de usarlo, modificarlo y distribuirlo.

---

## Créditos

- **EasyOCR** - Motor de reconocimiento de texto
- **Flask** - Framework web para el servidor
- **MyMemory** - API de traducción gratuita
- **TailwindCSS** - Estilos del popup
