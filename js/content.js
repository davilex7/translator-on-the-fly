// content.js - Script de contenido
// Detecta imagenes, las convierte a base64 y las envia al servidor para OCR/traduccion

console.log("Content script v3.0 (EasyOCR) cargado - Traductor Manhwa");

// --- Configuracion ---
const OVERLAY_CLASS = 'manhwa-translation-overlay';
const MIN_IMAGE_WIDTH = 200;   // Minimo para considerar imagen de manhwa
const MIN_IMAGE_HEIGHT = 200;
const MAX_CONCURRENT = 2;
const PROCESS_DELAY = 500;     // Delay entre imagenes para no saturar

// --- Estado ---
let isTranslationActive = false;
let targetLanguage = 'es';
let processedImages = new Set();
let processingQueue = [];
let activeProcessing = 0;
let stats = { images: 0, blocks: 0 };
let observer = null;

// --- Cargar estado inicial ---
chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
    isTranslationActive = result.isEnabled || false;
    targetLanguage = result.targetLanguage || 'es';
    console.log(`Estado inicial: activo=${isTranslationActive}, idioma=${targetLanguage}`);
    if (isTranslationActive) {
        startTranslationProcess();
    }
});

// --- Listener de mensajes del popup ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Mensaje recibido:", request);

    if (request.action === "toggleTranslation") {
        isTranslationActive = request.payload;
        console.log(`Traduccion ${isTranslationActive ? 'activada' : 'desactivada'}`);

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

// --- Funcion principal ---
async function startTranslationProcess() {
    console.log(`Iniciando proceso de traduccion (idioma: ${targetLanguage})`);
    stats = { images: 0, blocks: 0 };
    processedImages.clear();

    updatePopupProgress("Buscando imagenes...", 10);

    // Buscar imagenes actuales
    await scanAndProcessImages();

    // Observar nuevas imagenes que se anadan al DOM
    startObserver();
}

// --- Escanear y procesar todas las imagenes ---
async function scanAndProcessImages() {
    const images = findAllImages();
    console.log(`Encontradas ${images.length} imagenes en la pagina`);

    if (images.length === 0) {
        updatePopupProgress("No se encontraron imagenes", 100);
        setTimeout(() => updatePopupComplete(), 1000);
        return;
    }

    // Filtrar imagenes ya procesadas y agregar a cola
    const newImages = images.filter(img => !processedImages.has(getImageId(img)));
    console.log(`${newImages.length} imagenes nuevas para procesar`);

    if (newImages.length === 0) {
        updatePopupComplete();
        return;
    }

    // Esperar a que todas las imagenes carguen
    updatePopupProgress("Esperando carga de imagenes...", 15);
    await waitForImagesToLoad(newImages);

    // Procesar
    processingQueue = [...newImages];
    processQueue();
}

// --- Encontrar todas las imagenes ---
function findAllImages() {
    const images = [];

    // 1. Buscar todos los <img>
    document.querySelectorAll('img').forEach(img => {
        if (isValidImage(img)) {
            images.push(img);
        }
    });

    // 2. Buscar imagenes en canvas (algunos sitios renderizan asi)
    document.querySelectorAll('canvas').forEach(canvas => {
        if (canvas.width >= MIN_IMAGE_WIDTH && canvas.height >= MIN_IMAGE_HEIGHT) {
            images.push(canvas);
        }
    });

    // 3. Buscar divs con background-image grandes
    document.querySelectorAll('div, section, article').forEach(el => {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.startsWith('url(')) {
            const rect = el.getBoundingClientRect();
            if (rect.width >= MIN_IMAGE_WIDTH && rect.height >= MIN_IMAGE_HEIGHT) {
                // Marcar elemento con su URL de fondo
                el.dataset.bgImage = bg.slice(5, -2); // Extraer URL
                images.push(el);
            }
        }
    });

    console.log(`Total imagenes encontradas: ${images.length}`);
    return images;
}

// --- Validar si una imagen es valida para procesar ---
function isValidImage(img) {
    // Obtener src real (puede estar en data-src, data-lazy-src, etc.)
    const src = getRealImageSrc(img);
    if (!src) return false;

    // Ignorar imagenes muy pequenas (iconos, avatares, etc.)
    const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;

    // Si tiene dimensiones conocidas, verificar tamano
    if (width > 0 && height > 0) {
        if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
            return false;
        }
    }

    // Ignorar imagenes con clases tipicas de UI
    const classList = img.className.toLowerCase();
    const ignoreClasses = ['avatar', 'icon', 'logo', 'thumb', 'profile', 'emoji', 'ad', 'banner'];
    if (ignoreClasses.some(c => classList.includes(c))) {
        return false;
    }

    // Ignorar imagenes de tracking/ads por URL
    const ignoreDomains = ['google', 'facebook', 'analytics', 'ads', 'pixel', 'tracker'];
    if (ignoreDomains.some(d => src.toLowerCase().includes(d))) {
        return false;
    }

    return true;
}

// --- Obtener src real de imagen (maneja lazy loading) ---
function getRealImageSrc(img) {
    // Orden de prioridad para obtener el src
    return img.src ||
           img.dataset.src ||
           img.dataset.lazySrc ||
           img.dataset.original ||
           img.dataset.srcset?.split(' ')[0] ||
           img.getAttribute('data-src') ||
           img.getAttribute('data-lazy-src') ||
           img.getAttribute('data-original') ||
           null;
}

// --- Generar ID unico para imagen ---
function getImageId(element) {
    if (element.tagName === 'IMG') {
        return getRealImageSrc(element) || element.outerHTML.substring(0, 100);
    } else if (element.tagName === 'CANVAS') {
        return `canvas-${element.offsetLeft}-${element.offsetTop}-${element.width}x${element.height}`;
    } else {
        return element.dataset.bgImage || element.outerHTML.substring(0, 100);
    }
}

// --- Esperar a que las imagenes carguen ---
function waitForImagesToLoad(images) {
    const promises = images.map(img => {
        return new Promise((resolve) => {
            if (img.tagName !== 'IMG') {
                resolve();
                return;
            }

            if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
            }

            // Esperar carga
            const timeout = setTimeout(() => resolve(), 10000); // Max 10s
            img.addEventListener('load', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            img.addEventListener('error', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });

            // Forzar carga si tiene data-src pero no src
            const realSrc = getRealImageSrc(img);
            if (realSrc && !img.src) {
                img.src = realSrc;
            }
        });
    });

    return Promise.all(promises);
}

// --- Procesar cola de imagenes ---
async function processQueue() {
    const totalImages = processingQueue.length + stats.images;

    while (processingQueue.length > 0 && isTranslationActive) {
        if (activeProcessing >= MAX_CONCURRENT) {
            await sleep(100);
            continue;
        }

        const element = processingQueue.shift();
        const imageId = getImageId(element);

        if (processedImages.has(imageId)) continue;
        processedImages.add(imageId);

        activeProcessing++;
        processElement(element).finally(() => {
            activeProcessing--;
            stats.images++;

            const progress = 20 + (stats.images / totalImages) * 70;
            updatePopupProgress(`Procesando ${stats.images}/${totalImages}...`, progress);
        });

        await sleep(PROCESS_DELAY);
    }

    // Esperar a que terminen las activas
    while (activeProcessing > 0) {
        await sleep(100);
    }

    if (processingQueue.length === 0) {
        console.log(`Proceso completado. Imagenes: ${stats.images}, Bloques: ${stats.blocks}`);
        updatePopupComplete();
    }
}

// --- Procesar un elemento (img, canvas, o div con bg) ---
async function processElement(element) {
    try {
        let imageBase64;

        if (element.tagName === 'IMG') {
            // Verificar tamano real
            if (element.naturalWidth < MIN_IMAGE_WIDTH || element.naturalHeight < MIN_IMAGE_HEIGHT) {
                console.log(`Imagen muy pequena: ${element.naturalWidth}x${element.naturalHeight}`);
                return;
            }
            imageBase64 = await imageToBase64(element);
        } else if (element.tagName === 'CANVAS') {
            imageBase64 = canvasToBase64(element);
        } else if (element.dataset.bgImage) {
            imageBase64 = await fetchImageAsBase64(element.dataset.bgImage);
        }

        if (!imageBase64) {
            console.warn('No se pudo obtener base64 de:', element);
            return;
        }

        console.log(`Enviando imagen al servidor (${Math.round(imageBase64.length/1024)}KB)...`);

        // Enviar al background para OCR + traduccion
        const response = await chrome.runtime.sendMessage({
            action: 'processImage',
            imageData: imageBase64,
            targetLang: targetLanguage
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Sin respuesta del servidor');
        }

        const { blocks } = response.data;

        if (blocks && blocks.length > 0) {
            console.log(`Recibidos ${blocks.length} bloques de texto`);
            createOverlaysForElement(element, blocks);
            stats.blocks += blocks.length;
        } else {
            console.log('No se detecto texto en la imagen');
        }

    } catch (error) {
        console.error('Error procesando elemento:', error.message);
    }
}

// --- Convertir imagen a base64 ---
function imageToBase64(img) {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve(dataUrl.split(',')[1]);
        } catch (error) {
            // Error CORS - intentar fetch
            console.warn('Error canvas (CORS), intentando fetch...');
            const src = getRealImageSrc(img);
            if (src) {
                fetchImageAsBase64(src).then(resolve);
            } else {
                resolve(null);
            }
        }
    });
}

// --- Canvas a base64 ---
function canvasToBase64(canvas) {
    try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        return dataUrl.split(',')[1];
    } catch (e) {
        return null;
    }
}

// --- Fetch imagen como base64 ---
async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url, { mode: 'cors' });
        const blob = await response.blob();

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error fetch imagen:', error);
        return null;
    }
}

// --- Crear overlays para un elemento ---
function createOverlaysForElement(element, blocks) {
    let container = element.parentElement;
    if (!container) return;

    // Asegurar posicionamiento relativo
    const containerPos = getComputedStyle(container).position;
    if (containerPos === 'static') {
        container.style.position = 'relative';
    }

    // Obtener dimensiones
    let naturalWidth, naturalHeight, displayWidth, displayHeight, offsetTop, offsetLeft;

    if (element.tagName === 'IMG') {
        naturalWidth = element.naturalWidth;
        naturalHeight = element.naturalHeight;
        displayWidth = element.offsetWidth;
        displayHeight = element.offsetHeight;
        offsetTop = element.offsetTop;
        offsetLeft = element.offsetLeft;
    } else {
        const rect = element.getBoundingClientRect();
        naturalWidth = displayWidth = rect.width;
        naturalHeight = displayHeight = rect.height;
        offsetTop = element.offsetTop;
        offsetLeft = element.offsetLeft;
    }

    if (displayWidth === 0 || displayHeight === 0) return;

    const scaleX = displayWidth / naturalWidth;
    const scaleY = displayHeight / naturalHeight;

    console.log(`Creando ${blocks.length} overlays (escala: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)})`);

    blocks.forEach((block) => {
        if (!block || !block.bbox || !block.translatedText) return;
        if (block.bbox.x1 <= block.bbox.x0 || block.bbox.y1 <= block.bbox.y0) return;

        const overlay = document.createElement('div');
        overlay.classList.add(OVERLAY_CLASS);

        const top = offsetTop + block.bbox.y0 * scaleY;
        const left = offsetLeft + block.bbox.x0 * scaleX;
        const width = (block.bbox.x1 - block.bbox.x0) * scaleX;
        const height = (block.bbox.y1 - block.bbox.y0) * scaleY;

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

// --- Calcular tamano de fuente optimo ---
function calculateFontSize(text, width, height) {
    const minSize = 8;
    const maxSize = 16;

    const area = (width - 8) * (height - 4);
    const charCount = text.length;
    const areaPerChar = area / charCount;
    let fontSize = Math.sqrt(areaPerChar) * 0.85;

    return Math.round(Math.max(minSize, Math.min(maxSize, fontSize)));
}

// --- Observador de mutaciones para imagenes dinamicas ---
function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
        if (!isTranslationActive) return;

        let newImages = [];

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                // Si es una imagen
                if (node.tagName === 'IMG' && isValidImage(node)) {
                    newImages.push(node);
                }

                // Buscar imagenes dentro del nodo anadido
                if (node.querySelectorAll) {
                    node.querySelectorAll('img').forEach(img => {
                        if (isValidImage(img)) {
                            newImages.push(img);
                        }
                    });
                }
            });

            // Tambien detectar cambios de src en imagenes existentes
            if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                const img = mutation.target;
                if (img.tagName === 'IMG' && isValidImage(img)) {
                    // Resetear procesamiento si cambio el src
                    const imageId = getImageId(img);
                    if (!processedImages.has(imageId)) {
                        newImages.push(img);
                    }
                }
            }
        });

        if (newImages.length > 0) {
            console.log(`Detectadas ${newImages.length} nuevas imagenes`);
            // Esperar un poco para que carguen
            setTimeout(async () => {
                await waitForImagesToLoad(newImages);
                processingQueue.push(...newImages);
                if (activeProcessing === 0) {
                    processQueue();
                }
            }, 1000);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-src']
    });

    console.log('Observador de mutaciones iniciado');
}

// --- Detener traduccion ---
function stopTranslationProcess() {
    console.log("Deteniendo proceso y limpiando overlays");
    isTranslationActive = false;
    processingQueue = [];

    if (observer) {
        observer.disconnect();
        observer = null;
    }

    // Eliminar overlays
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());

    // Limpiar estado
    processedImages.clear();

    hidePopupProgress();
}

// --- Utilidades ---
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Comunicacion con popup ---
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
