// content.js
// Llama al backend y maneja la respuesta con bloques de texto y coordenadas.
// Ajustes menores en estilos de overlay.

console.log("Content script v1.9 (Overlay Style Adjust) cargado - Traductor Manga");

let isTranslationActive = false;
let targetLanguage = 'es';
const OVERLAY_CLASS = 'manga-translation-overlay';
// !!! REEMPLAZA 'tu-servicio-ocr' CON EL NOMBRE REAL DE TU SERVICIO EN RENDER !!!
const BACKEND_URL = "https://my-ocr-server.onrender.com/ocr-translate";

// --- Cargar estado inicial ---
chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
    isTranslationActive = result.isEnabled || false;
    targetLanguage = result.targetLanguage || 'es';
    console.log(`Estado inicial: ${isTranslationActive}, Idioma: ${targetLanguage}`);
    if (isTranslationActive) {
        startTranslationProcess();
    }
});

// --- Listener de mensajes ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Mensaje recibido en content script:", request);
    if (request.action === "toggleTranslation") {
        isTranslationActive = request.payload;
        console.log(`Traducción ${isTranslationActive ? 'activada' : 'desactivada'}.`);
        if (isTranslationActive) {
            startTranslationProcess();
            sendResponse({ status: "processing_backend" });
        } else {
            stopTranslationProcess();
            sendResponse({ status: "stopped" });
        }
        return true;
    } else if (request.action === "setLanguage") {
        targetLanguage = request.payload;
        console.log(`Idioma destino: ${targetLanguage}`);
        if (isTranslationActive) {
            stopTranslationProcess();
            startTranslationProcess();
            sendResponse({ status: "languageSet_reprocessing_backend" });
        } else {
            sendResponse({ status: "languageSet_inactive" });
        }
        return true;
    }
});

// --- Función para llamar al Backend ---
// (Sin cambios respecto a v1.6)
async function getOcrAndTranslationFromBackend(imageUrl, lang) {
    if (!BACKEND_URL || BACKEND_URL.includes("tu-servicio-ocr")) {
        console.error("!!! ERROR: La URL del backend no está configurada correctamente en content.js !!!");
        updatePopupError("Error Configuración", "URL del backend no configurada.");
        return null;
    }
    console.log(`Llamando al backend: ${BACKEND_URL} para ${imageUrl}`);
    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({ imageUrl: imageUrl, targetLang: lang })
        });
        if (!response.ok) {
            let errorMsg = `Error del servidor: ${response.status}`;
            try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
            console.error(`Error en respuesta del backend (${response.status}): ${errorMsg}`);
            throw new Error(errorMsg);
        }
        const data = await response.json();
        console.log(`Respuesta del backend recibida para ${imageUrl}:`, data);
        return data;
    } catch (error) {
        console.error(`Error al llamar al backend para ${imageUrl}:`, error);
        return null;
    }
}


// --- Función principal para iniciar la traducción ---
// (Sin cambios respecto a v1.6)
async function startTranslationProcess() {
    console.log(`Iniciando proceso con Backend al idioma: ${targetLanguage}`);
    updatePopupProgress("Buscando imágenes...", 25);
    const images = document.querySelectorAll('img');
    console.log(`Encontradas ${images.length} imágenes.`);
    if (images.length === 0) { updatePopupComplete(); return; }
    let processedCount = 0;
    let errorOccurred = false;
    let overlaysCreatedCount = 0;
    let successfulOcrCount = 0;
    const MAX_CONCURRENT_REQUESTS = 1;
    const imageQueue = [];
    for (const img of images) {
        let isPotentiallyValid = false;
         try {
            if (img.offsetParent !== null && (img.complete || img.src)) {
                 if (img.complete && (img.naturalWidth < 50 || img.naturalHeight < 30)) {} else { isPotentiallyValid = true; }
            }
         } catch(e) {}
         if (isPotentiallyValid && !img.dataset.ocrOverlay) { imageQueue.push(img); }
    }
    const totalImagesToProcess = imageQueue.length;
    console.log(`Se intentarán procesar ${totalImagesToProcess} imágenes válidas.`);
    if (totalImagesToProcess === 0) { updatePopupComplete(); return; }
    let activeRequests = 0;
    const processQueue = async () => {
        while (imageQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
            activeRequests++;
            const img = imageQueue.shift();
            try {
                if (!img.complete) {
                    console.log(` -> Esperando carga de ${img.src}`);
                    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`No se pudo cargar: ${img.src}`)); });
                    console.log(` -> Carga completa de ${img.src}`);
                    if (img.naturalWidth < 50 || img.naturalHeight < 30) {
                         console.log(` -> Imagen ${img.src} demasiado pequeña post-carga. Saltando.`);
                         processedCount++; activeRequests--; if (imageQueue.length > 0) processQueue(); continue;
                     }
                }
            } catch (loadError) {
                console.warn(` -> Error cargando imagen ${img.src || '(sin src)'}:`, loadError.message);
                processedCount++; activeRequests--; if (imageQueue.length > 0) processQueue(); continue;
            }
            updatePopupProgress(`Procesando ${processedCount + 1}/${totalImagesToProcess}...`, 30 + (processedCount / totalImagesToProcess) * 60);
            getOcrAndTranslationFromBackend(img.src, targetLanguage)
                .then(result => {
                    if (result && result.blocks && Array.isArray(result.blocks) && result.blocks.length > 0) {
                        console.log(`%c${result.blocks.length} bloques recibidos para ${img.src}`, 'color: purple; font-weight: bold;');
                        successfulOcrCount++;
                        img.dataset.ocrOverlay = 'true';
                        createOverlaysForImage(img, result.blocks);
                        overlaysCreatedCount += result.blocks.length;
                    } else {
                         console.warn(`Backend no devolvió bloques útiles para ${img.src}`);
                         img.dataset.ocrOverlay = 'true';
                    }
                })
                .catch(err => {
                    errorOccurred = true;
                    console.error(`Error en fetch/procesamiento para ${img.src}:`, err);
                    img.dataset.ocrOverlay = 'true';
                    if (!errorOccurred) { updatePopupError("Error Backend", err.message || "Fallo de conexión"); }
                })
                .finally(() => {
                    processedCount++; activeRequests--;
                    if (imageQueue.length > 0) { processQueue(); }
                    else if (activeRequests === 0) { finalizeProcessing(overlaysCreatedCount, successfulOcrCount, errorOccurred); }
                });
        } // Fin while
        if (imageQueue.length === 0 && activeRequests === 0) { finalizeProcessing(overlaysCreatedCount, successfulOcrCount, errorOccurred); }
    }; // Fin processQueue
    processQueue();
} // Fin startTranslationProcess

// --- Función para finalizar y actualizar estado ---
function finalizeProcessing(overlayCount, successCount, hadErrors) {
     console.log(`Fin del procesamiento con Backend. Overlays creados: ${overlayCount} (Éxitos OCR: ${successCount})`);
     if (!hadErrors) { console.log("Proceso con Backend completado."); updatePopupComplete(); }
     else { updatePopupError("Finalizado con errores", "Hubo errores durante la comunicación o el OCR/Traducción."); }
}


// --- Función para crear overlays ---
function createOverlaysForImage(imageElement, blocks) {
    let container = imageElement.parentElement;
    if (!container) return;
    const containerPos = getComputedStyle(container).position;
    if (containerPos === 'static') { container.style.position = 'relative'; }
    const imgRect = imageElement.getBoundingClientRect();
    if (imgRect.width === 0 || imgRect.height === 0) return;

    console.log(`  -> Creando ${blocks.length} overlays para ${imageElement.src}`);

    blocks.forEach((block, index) => {
        if (!block || !block.bbox || block.bbox.x1 <= block.bbox.x0 || block.bbox.y1 <= block.bbox.y0 || !block.translatedText) {
            return; // Saltar si falta información o texto
        }
        const overlay = document.createElement('div');
        overlay.classList.add(OVERLAY_CLASS);
        // *** AJUSTE: Estilos más discretos ***
        overlay.style.cssText = `
            position: absolute;
            background-color: rgba(255, 255, 255, 0.95) !important; /* Fondo casi opaco */
            border: 1px solid #bbb !important; /* Borde gris claro */
            padding: 1px 3px !important; /* Padding reducido */
            font-size: 12px !important; /* Fuente más pequeña */
            font-family: Arial, sans-serif !important;
            font-weight: normal; /* Peso normal */
            color: black !important;
            z-index: 99999 !important;
            text-align: center !important;
            overflow: hidden !important;
            line-height: 1.15 !important; /* Line-height ajustado */
            pointer-events: none !important;
            box-sizing: border-box !important;
            border-radius: 2px; /* Menos redondeado */
            box-shadow: 0 1px 2px rgba(0,0,0,0.1); /* Sombra más sutil */
            /* white-space: nowrap !important; */ /* Permitir saltos si es necesario */
        `;
        const scaleX = imgRect.width / imageElement.naturalWidth;
        const scaleY = imgRect.height / imageElement.naturalHeight;
        const top = imageElement.offsetTop + block.bbox.y0 * scaleY;
        const left = imageElement.offsetLeft + block.bbox.x0 * scaleX;
        let width = (block.bbox.x1 - block.bbox.x0) * scaleX;
        let height = (block.bbox.y1 - block.bbox.y0) * scaleY;

        // Añadir un pequeño margen interno al calcular tamaño para que no se pegue al borde
        width = Math.max(8, width + 2); // Ancho mínimo + margen
        height = Math.max(8, height + 2); // Alto mínimo + margen

        overlay.style.top = `${top - 1}px`; // Ajustar ligeramente posición
        overlay.style.left = `${left - 1}px`;
        overlay.style.width = `${width}px`;
        overlay.style.minHeight = `${height}px`; // Mínimo alto

        overlay.textContent = block.translatedText;

         // Ajuste de fuente (si es muy largo el texto para el ancho)
         const approxCharWidth = 6; // Ajustado por fuente más pequeña
         const availableWidth = width - 6; // Restar padding
         if (availableWidth > 5 && block.translatedText.length * approxCharWidth > availableWidth) {
             const newSize = Math.max(7, Math.min(12, Math.floor(12 * (availableWidth / (block.translatedText.length * approxCharWidth)))));
             overlay.style.fontSize = `${newSize}px`;
             overlay.style.lineHeight = '1.1'; // Ajustar line-height si la fuente es muy pequeña
         }

        container.appendChild(overlay);
    });
}

// --- Función para detener la traducción ---
// (Sin cambios)
function stopTranslationProcess() {
    console.log("Deteniendo proceso y limpiando overlays.");
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll('img[data-ocrOverlay="true"]').forEach(img => img.removeAttribute('data-ocrOverlay'));
    hidePopupProgress();
}

// --- Funciones de comunicación con Popup (sin cambios) ---
function updatePopupProgress(statusMsg, progressPercent) {
    chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', payload: { status: statusMsg, progress: progressPercent } }).catch(err => {});
}
function updatePopupError(shortMessage, detail) {
     console.error(`Popup Error: ${shortMessage}`, detail);
     chrome.runtime.sendMessage({ type: 'PROCESS_ERROR', payload: { shortMessage: shortMessage, detail: detail } }).catch(err => {});
}
function updatePopupComplete() {
     console.log("Popup Update: Proceso completado.");
     chrome.runtime.sendMessage({ type: 'PROCESS_COMPLETE' }).catch(err => {});
}
function hidePopupProgress() {}
