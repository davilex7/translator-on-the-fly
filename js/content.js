// content.js - Script de contenido
// Detecta imagenes y envia sus URLs al background para procesamiento

console.log("Content script v4.1 (Lazy-load support) cargado - Traductor de Imagenes");

// --- Configuracion ---
const OVERLAY_CLASS = 'manhwa-translation-overlay';
const WRAPPER_CLASS = 'manhwa-translation-wrapper';
const MIN_IMAGE_DIMENSION = 50;   // Reducido para aceptar mas imagenes
const MIN_IMAGE_AREA = 10000;     // Reducido para aceptar mas imagenes (ej. 100x100)
const MAX_CONCURRENT = 2;
const PROCESS_DELAY = 500;

// --- Estado ---
let isTranslationActive = false;
let sourceLanguage = 'ko';
let targetLanguage = 'es';
let processedImages = new Set();
let processingQueue = [];
let activeProcessing = 0;
let stats = { images: 0, blocks: 0 };
let observer = null;
let intersectionObserver = null;

// --- Cargar estado inicial ---
chrome.storage.sync.get(['isEnabled', 'sourceLanguage', 'targetLanguage'], (result) => {
    isTranslationActive = result.isEnabled || false;
    sourceLanguage = result.sourceLanguage || 'ko';
    targetLanguage = result.targetLanguage || 'es';
    console.log(`Estado inicial: activo=${isTranslationActive}, origen=${sourceLanguage}, destino=${targetLanguage}`);
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
        console.log(`Idioma destino cambiado a: ${targetLanguage}`);

        if (isTranslationActive) {
            stopTranslationProcess();
            startTranslationProcess();
            sendResponse({ status: "reprocessing" });
        } else {
            sendResponse({ status: "languageSet" });
        }
        return true;
    }

    if (request.action === "setSourceLanguage") {
        sourceLanguage = request.payload;
        console.log(`Idioma origen cambiado a: ${sourceLanguage}`);

        if (isTranslationActive) {
            stopTranslationProcess();
            startTranslationProcess();
            sendResponse({ status: "reprocessing" });
        } else {
            sendResponse({ status: "sourceLanguageSet" });
        }
        return true;
    }
});

// --- Funcion principal ---
async function startTranslationProcess() {
    console.log(`Iniciando proceso de traduccion (origen: ${sourceLanguage}, destino: ${targetLanguage})`);
    stats = { images: 0, blocks: 0 };
    processedImages.clear();

    updatePopupProgress("Buscando imagenes...", 10);

    await scanAndProcessImages();
    startObserver();
    startIntersectionObserver();  // Para imagenes lazy-load
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

    const newImages = images.filter(img => !processedImages.has(getImageId(img)));
    console.log(`${newImages.length} imagenes nuevas para procesar`);

    if (newImages.length === 0) {
        updatePopupComplete();
        return;
    }

    updatePopupProgress("Esperando carga de imagenes...", 15);
    await waitForImagesToLoad(newImages);

    processingQueue = [...newImages];
    processQueue();
}

// --- Encontrar todas las imagenes ---
function findAllImages() {
    const images = [];

    document.querySelectorAll('img').forEach(img => {
        if (isValidImage(img)) {
            images.push(img);
        }
    });

    console.log(`Total imagenes validas: ${images.length}`);
    return images;
}

// --- Validar si una imagen es valida para procesar ---
function isValidImage(img) {
    const src = getRealImageSrc(img);
    if (!src) return false;

    // Ignorar data URLs (ya estan en base64, probablemente son iconos)
    if (src.startsWith('data:')) return false;

    // Ignorar imagenes ya procesadas (tienen wrapper)
    if (img.parentElement && img.parentElement.classList.contains(WRAPPER_CLASS)) {
        return false;
    }

    const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;

    if (width > 0 && height > 0) {
        const maxDimension = Math.max(width, height);
        const area = width * height;

        if (maxDimension < MIN_IMAGE_DIMENSION || area < MIN_IMAGE_AREA) {
            return false;
        }
    }

    // Solo ignorar elementos claramente no-contenido (iconos, avatares, anuncios)
    const classList = (img.className || '').toLowerCase();
    const ignoreClasses = ['icon', 'avatar', 'emoji', 'ad-', 'ads-'];
    if (ignoreClasses.some(c => classList.includes(c))) {
        return false;
    }

    // Ignorar dominios de tracking/anuncios
    const ignoreDomains = ['analytics', 'ads.', 'pixel', 'tracker', 'doubleclick'];
    if (ignoreDomains.some(d => src.toLowerCase().includes(d))) {
        return false;
    }

    return true;
}

// --- Obtener src real de imagen (maneja lazy loading) ---
function getRealImageSrc(img) {
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
    return getRealImageSrc(element) || element.outerHTML.substring(0, 100);
}

// --- Esperar a que las imagenes carguen ---
function waitForImagesToLoad(images) {
    const promises = images.map(img => {
        return new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => resolve(), 10000);
            img.addEventListener('load', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            img.addEventListener('error', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });

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

        const img = processingQueue.shift();
        const imageId = getImageId(img);

        if (processedImages.has(imageId)) continue;
        processedImages.add(imageId);

        activeProcessing++;
        processImage(img).finally(() => {
            activeProcessing--;
            stats.images++;

            const progress = 20 + (stats.images / totalImages) * 70;
            updatePopupProgress(`Procesando ${stats.images}/${totalImages}...`, progress);
        });

        await sleep(PROCESS_DELAY);
    }

    while (activeProcessing > 0) {
        await sleep(100);
    }

    if (processingQueue.length === 0) {
        console.log(`Proceso completado. Imagenes: ${stats.images}, Bloques: ${stats.blocks}`);
        updatePopupComplete();
    }
}

// --- Procesar una imagen ---
async function processImage(img) {
    try {
        // Verificar tamano
        const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
        const area = img.naturalWidth * img.naturalHeight;
        if (maxDim < MIN_IMAGE_DIMENSION || area < MIN_IMAGE_AREA) {
            console.log(`Imagen muy pequena: ${img.naturalWidth}x${img.naturalHeight}`);
            return;
        }

        // Obtener URL de la imagen
        const imageUrl = getRealImageSrc(img);
        if (!imageUrl) {
            console.warn('No se pudo obtener URL de la imagen');
            return;
        }

        console.log(`Procesando imagen: ${imageUrl.substring(0, 80)}...`);

        // Enviar URL al background para descarga y OCR
        const response = await chrome.runtime.sendMessage({
            action: 'processImageUrl',
            imageUrl: imageUrl,
            sourceLang: sourceLanguage,
            targetLang: targetLanguage
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Sin respuesta del servidor');
        }

        const { blocks } = response.data;

        if (blocks && blocks.length > 0) {
            console.log(`Recibidos ${blocks.length} bloques de texto`);
            createOverlaysForImage(img, blocks);
            stats.blocks += blocks.length;
        } else {
            console.log('No se detecto texto en la imagen');
        }

    } catch (error) {
        // Silenciar errores comunes (descarga fallida, imagen no disponible, etc.)
        // Solo mostrar si es un error inesperado del servidor
        if (error.message && !error.message.includes('descargar') && !error.message.includes('Invalid input')) {
            console.warn('Error procesando imagen:', error.message);
        }
    }
}

// --- Crear overlays para una imagen ---
function createOverlaysForImage(img, blocks) {
    // Verificar que la imagen tiene dimensiones
    if (img.offsetWidth === 0 || img.offsetHeight === 0) {
        console.warn('Imagen sin dimensiones visibles, saltando overlays');
        return;
    }

    // Crear wrapper alrededor de la imagen si no existe
    let wrapper = img.parentElement;

    if (!wrapper.classList.contains(WRAPPER_CLASS)) {
        wrapper = document.createElement('div');
        wrapper.classList.add(WRAPPER_CLASS);

        const imgStyle = getComputedStyle(img);
        wrapper.style.cssText = `
            position: relative;
            display: ${imgStyle.display === 'inline' ? 'inline-block' : imgStyle.display};
            width: ${img.offsetWidth}px;
            max-width: 100%;
            margin: ${imgStyle.margin};
        `;

        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);

        img.style.margin = '0';
        img.style.display = 'block';
        img.style.width = '100%';
    }

    // Calcular escala
    const scaleX = img.offsetWidth / img.naturalWidth;
    const scaleY = img.offsetHeight / img.naturalHeight;

    console.log(`Creando ${blocks.length} overlays`);
    console.log(`Imagen: ${img.naturalWidth}x${img.naturalHeight} -> ${img.offsetWidth}x${img.offsetHeight}`);
    console.log(`Escala: ${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);

    blocks.forEach((block, index) => {
        if (!block || !block.bbox || !block.translatedText) return;
        if (block.bbox.x1 <= block.bbox.x0 || block.bbox.y1 <= block.bbox.y0) return;

        const overlay = document.createElement('div');
        overlay.classList.add(OVERLAY_CLASS);

        const top = block.bbox.y0 * scaleY;
        const left = block.bbox.x0 * scaleX;
        const width = (block.bbox.x1 - block.bbox.x0) * scaleX;
        const height = (block.bbox.y1 - block.bbox.y0) * scaleY;

        console.log(`Overlay ${index}: "${block.translatedText.substring(0, 30)}..." @ (${left.toFixed(0)}, ${top.toFixed(0)}) ${width.toFixed(0)}x${height.toFixed(0)}`);

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
            z-index: 1000;
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
        wrapper.appendChild(overlay);
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

// --- Observador de interseccion (para imagenes lazy-load) ---
function startIntersectionObserver() {
    if (intersectionObserver) intersectionObserver.disconnect();

    intersectionObserver = new IntersectionObserver((entries) => {
        if (!isTranslationActive) return;

        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const imageId = getImageId(img);

                // Si ya fue procesada, dejar de observarla
                if (processedImages.has(imageId)) {
                    intersectionObserver.unobserve(img);
                    return;
                }

                // Esperar a que la imagen cargue completamente
                if (img.complete && img.naturalWidth > 0) {
                    processLazyImage(img);
                } else {
                    img.addEventListener('load', () => {
                        processLazyImage(img);
                    }, { once: true });
                }
            }
        });
    }, {
        rootMargin: '200px',  // Empezar a cargar 200px antes de entrar en viewport
        threshold: 0.01
    });

    // Observar todas las imagenes de la pagina
    document.querySelectorAll('img').forEach(img => {
        if (!processedImages.has(getImageId(img))) {
            intersectionObserver.observe(img);
        }
    });

    console.log('Observador de interseccion iniciado (lazy-load)');
}

// --- Procesar imagen lazy-loaded ---
async function processLazyImage(img) {
    if (!isTranslationActive) return;

    const imageId = getImageId(img);
    if (processedImages.has(imageId)) return;

    // Validar que cumple los requisitos
    if (!isValidImage(img)) return;

    // Verificar que tiene dimensiones
    if (img.naturalWidth < MIN_IMAGE_DIMENSION || img.naturalHeight < MIN_IMAGE_DIMENSION) return;
    if (img.naturalWidth * img.naturalHeight < MIN_IMAGE_AREA) return;

    console.log(`Imagen lazy detectada en viewport: ${img.src.substring(0, 60)}...`);

    // Agregar a la cola si no esta ya
    if (!processingQueue.includes(img)) {
        processingQueue.push(img);
        if (activeProcessing === 0) {
            processQueue();
        }
    }
}

// --- Observador de mutaciones ---
function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
        if (!isTranslationActive) return;

        let newImages = [];

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                if (node.tagName === 'IMG' && isValidImage(node)) {
                    newImages.push(node);
                    // Tambien observar con IntersectionObserver
                    if (intersectionObserver) {
                        intersectionObserver.observe(node);
                    }
                }

                if (node.querySelectorAll) {
                    node.querySelectorAll('img').forEach(img => {
                        if (isValidImage(img)) {
                            newImages.push(img);
                            if (intersectionObserver) {
                                intersectionObserver.observe(img);
                            }
                        }
                    });
                }
            });

            if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'src' || mutation.attributeName === 'data-src')) {
                const img = mutation.target;
                if (img.tagName === 'IMG' && isValidImage(img)) {
                    const imageId = getImageId(img);
                    if (!processedImages.has(imageId)) {
                        newImages.push(img);
                    }
                }
            }
        });

        if (newImages.length > 0) {
            console.log(`Detectadas ${newImages.length} nuevas imagenes (MutationObserver)`);
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

    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }

    // Eliminar overlays
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());

    // Deshacer wrappers
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(wrapper => {
        const img = wrapper.querySelector('img');
        if (img) {
            wrapper.parentNode.insertBefore(img, wrapper);
            img.style.margin = '';
            img.style.display = '';
            img.style.width = '';
        }
        wrapper.remove();
    });

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
