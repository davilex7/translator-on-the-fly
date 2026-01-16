// content.js - Script de contenido
// Detecta imágenes, las convierte a base64 y las envía al background para OCR/traducción

console.log("Content script v2.0 (Local Vision API) cargado - Traductor Manhwa");

// --- Configuración ---
const OVERLAY_CLASS = 'manhwa-translation-overlay';
const MIN_IMAGE_WIDTH = 100;
const MIN_IMAGE_HEIGHT = 100;
const MAX_CONCURRENT = 2;

// --- Estado ---
let isTranslationActive = false;
let targetLanguage = 'es';
let processingQueue = [];
let activeProcessing = 0;
let stats = { images: 0, blocks: 0 };

// --- Cargar estado inicial ---
chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
    isTranslationActive = result.isEnabled || false;
    targetLanguage = result.targetLanguage || 'es';
    console.log(`Estado inicial: ${isTranslationActive}, Idioma: ${targetLanguage}`);
    if (isTranslationActive) {
        startTranslationProcess();
    }
});

// --- Listener de mensajes del popup ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Mensaje recibido:", request);

    if (request.action === "toggleTranslation") {
        isTranslationActive = request.payload;
        console.log(`Traducción ${isTranslationActive ? 'activada' : 'desactivada'}`);

        if (isTranslationActive) {
            startTranslationProcess();
            sendResponse({ status: "processing" });
        } else {
            stopTranslationProcess();
            sendResponse({ status: "stopped" });
        }
        return true;
    }

    if (request.action === "setLanguage") {
        targetLanguage = request.payload;
        console.log(`Idioma cambiado a: ${targetLanguage}`);

        if (isTranslationActive) {
            stopTranslationProcess();
            startTranslationProcess();
            sendResponse({ status: "reprocessing" });
        } else {
            sendResponse({ status: "languageSet" });
        }
        return true;
    }
});

// --- Función principal ---
async function startTranslationProcess() {
    console.log(`Iniciando proceso de traducción (idioma: ${targetLanguage})`);
    stats = { images: 0, blocks: 0 };

    updatePopupProgress("Buscando imagenes...", 10);

    // Buscar imágenes válidas
    const images = findValidImages();
    console.log(`Encontradas ${images.length} imagenes validas`);

    if (images.length === 0) {
        updatePopupComplete();
        return;
    }

    // Crear cola de procesamiento
    processingQueue = [...images];
    const totalImages = processingQueue.length;
    let processedCount = 0;

    updatePopupProgress(`Procesando 0/${totalImages}...`, 20);

    // Procesar cola con concurrencia limitada
    const processNext = async () => {
        while (processingQueue.length > 0 && activeProcessing < MAX_CONCURRENT && isTranslationActive) {
            activeProcessing++;
            const img = processingQueue.shift();

            try {
                await processImage(img);
                stats.images++;
            } catch (error) {
                console.error(`Error procesando imagen:`, error);
            }

            processedCount++;
            activeProcessing--;

            const progress = 20 + (processedCount / totalImages) * 70;
            updatePopupProgress(`Procesando ${processedCount}/${totalImages}...`, progress);

            // Continuar con la siguiente
            if (processingQueue.length > 0 && isTranslationActive) {
                processNext();
            }
        }

        // Verificar si terminamos
        if (activeProcessing === 0 && processingQueue.length === 0) {
            console.log(`Proceso completado. Imagenes: ${stats.images}, Bloques: ${stats.blocks}`);
            updatePopupComplete();
        }
    };

    // Iniciar procesamiento paralelo
    for (let i = 0; i < MAX_CONCURRENT && processingQueue.length > 0; i++) {
        processNext();
    }
}

// --- Buscar imágenes válidas ---
function findValidImages() {
    const allImages = document.querySelectorAll('img');
    const validImages = [];

    for (const img of allImages) {
        // Saltar si ya procesada
        if (img.dataset.manhwaProcessed) continue;

        // Verificar visibilidad
        if (img.offsetParent === null) continue;

        // Verificar tamaño
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) continue;

        // Verificar que está cargada
        if (!img.complete) continue;

        validImages.push(img);
    }

    return validImages;
}

// --- Procesar una imagen ---
async function processImage(img) {
    // Marcar como procesada
    img.dataset.manhwaProcessed = 'true';

    try {
        // Convertir imagen a base64
        const imageBase64 = await imageToBase64(img);

        if (!imageBase64) {
            console.warn('No se pudo convertir imagen a base64');
            return;
        }

        // Enviar al background para OCR + traducción
        const response = await chrome.runtime.sendMessage({
            action: 'processImage',
            imageData: imageBase64,
            targetLang: targetLanguage
        });

        if (!response.success) {
            throw new Error(response.error || 'Error desconocido');
        }

        const { blocks } = response.data;

        if (blocks && blocks.length > 0) {
            console.log(`Recibidos ${blocks.length} bloques para imagen`);
            createOverlaysForImage(img, blocks);
            stats.blocks += blocks.length;
        }

    } catch (error) {
        console.error('Error en processImage:', error);
        // Si es error de API Key, notificar
        if (error.message.includes('API Key')) {
            updatePopupError('API Key', error.message);
        }
    }
}

// --- Convertir imagen a base64 ---
function imageToBase64(img) {
    return new Promise((resolve) => {
        try {
            // Crear canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Usar dimensiones naturales
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            // Dibujar imagen
            ctx.drawImage(img, 0, 0);

            // Obtener base64 (sin el prefijo data:image/...)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const base64 = dataUrl.split(',')[1];

            resolve(base64);
        } catch (error) {
            // Error de CORS - intentar con fetch
            console.warn('Error canvas (CORS?), intentando fetch:', error.message);
            fetchImageAsBase64(img.src).then(resolve).catch(() => resolve(null));
        }
    });
}

// --- Fetch imagen como base64 (para evitar CORS) ---
async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error fetch imagen:', error);
        return null;
    }
}

// --- Crear overlays para una imagen ---
function createOverlaysForImage(img, blocks) {
    let container = img.parentElement;
    if (!container) return;

    // Asegurar posicionamiento relativo del contenedor
    const containerPos = getComputedStyle(container).position;
    if (containerPos === 'static') {
        container.style.position = 'relative';
    }

    const imgRect = img.getBoundingClientRect();
    if (imgRect.width === 0 || imgRect.height === 0) return;

    // Calcular factores de escala
    const scaleX = imgRect.width / img.naturalWidth;
    const scaleY = imgRect.height / img.naturalHeight;

    console.log(`Creando ${blocks.length} overlays (escala: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)})`);

    blocks.forEach((block) => {
        // Validar bloque
        if (!block || !block.bbox || !block.translatedText) return;
        if (block.bbox.x1 <= block.bbox.x0 || block.bbox.y1 <= block.bbox.y0) return;

        const overlay = document.createElement('div');
        overlay.classList.add(OVERLAY_CLASS);

        // Calcular posición y tamaño
        const top = img.offsetTop + block.bbox.y0 * scaleY;
        const left = img.offsetLeft + block.bbox.x0 * scaleX;
        const width = (block.bbox.x1 - block.bbox.x0) * scaleX;
        const height = (block.bbox.y1 - block.bbox.y0) * scaleY;

        // Estilos del overlay
        overlay.style.cssText = `
            position: absolute;
            top: ${top}px;
            left: ${left}px;
            width: ${Math.max(20, width)}px;
            min-height: ${Math.max(16, height)}px;
            background-color: rgba(255, 255, 255, 0.95);
            border: 1px solid #ccc;
            padding: 2px 4px;
            font-size: ${calculateFontSize(block.translatedText, width, height)}px;
            font-family: Arial, sans-serif;
            color: #000;
            z-index: 99999;
            text-align: center;
            overflow: hidden;
            line-height: 1.2;
            pointer-events: none;
            box-sizing: border-box;
            border-radius: 3px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            word-break: break-word;
        `;

        overlay.textContent = block.translatedText;
        container.appendChild(overlay);
    });
}

// --- Calcular tamaño de fuente óptimo ---
function calculateFontSize(text, width, height) {
    const baseSize = 14;
    const minSize = 8;
    const maxSize = 18;

    // Área disponible
    const area = (width - 8) * (height - 4);
    const charCount = text.length;

    // Estimar tamaño basado en área por caracter
    const areaPerChar = area / charCount;
    let fontSize = Math.sqrt(areaPerChar) * 0.9;

    // Limitar al rango permitido
    fontSize = Math.max(minSize, Math.min(maxSize, fontSize));

    return Math.round(fontSize);
}

// --- Detener traducción ---
function stopTranslationProcess() {
    console.log("Deteniendo proceso y limpiando overlays");
    isTranslationActive = false;
    processingQueue = [];

    // Eliminar overlays
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());

    // Limpiar marcas de procesado
    document.querySelectorAll('img[data-manhwa-processed]').forEach(img => {
        img.removeAttribute('data-manhwa-processed');
    });

    hidePopupProgress();
}

// --- Comunicación con popup ---
function updatePopupProgress(statusMsg, progressPercent) {
    chrome.runtime.sendMessage({
        type: 'PROGRESS_UPDATE',
        payload: { status: statusMsg, progress: progressPercent }
    }).catch(() => {});
}

function updatePopupError(shortMessage, detail) {
    console.error(`Error: ${shortMessage}`, detail);
    chrome.runtime.sendMessage({
        type: 'PROCESS_ERROR',
        payload: { shortMessage, detail }
    }).catch(() => {});
}

function updatePopupComplete() {
    chrome.runtime.sendMessage({
        type: 'PROCESS_COMPLETE',
        payload: { stats }
    }).catch(() => {});
}

function hidePopupProgress() {
    chrome.runtime.sendMessage({
        type: 'PROGRESS_HIDE'
    }).catch(() => {});
}
