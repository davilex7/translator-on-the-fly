// background.js - Service Worker
// Descarga imagenes (sin CORS) y las envia al servidor OCR

const DEFAULT_SERVER_URL = 'http://localhost:5000';

// --- Inicializacion ---
chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension Traductor Manhwa instalada:", details.reason);
    chrome.storage.sync.get(['isEnabled', 'sourceLanguage', 'targetLanguage', 'serverUrl'], (result) => {
        if (result.isEnabled === undefined) {
            chrome.storage.sync.set({ isEnabled: false });
        }
        if (result.sourceLanguage === undefined) {
            chrome.storage.sync.set({ sourceLanguage: 'ko' });
        }
        if (result.targetLanguage === undefined) {
            chrome.storage.sync.set({ targetLanguage: 'es' });
        }
        if (result.serverUrl === undefined) {
            chrome.storage.sync.set({ serverUrl: DEFAULT_SERVER_URL });
        }
    });
});

// --- Escuchar mensajes ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'processImageUrl') {
        // Descargar imagen y procesarla
        handleProcessImageUrl(request.imageUrl, request.sourceLang, request.targetLang)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => {
                // Solo log en modo debug - errores de descarga son comunes y esperados
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'checkServer') {
        checkServerHealth()
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    return false;
});

// --- Obtener URL del servidor ---
function getServerUrl() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['serverUrl'], (result) => {
            resolve(result.serverUrl || DEFAULT_SERVER_URL);
        });
    });
}

// --- Verificar estado del servidor ---
async function checkServerHealth() {
    const serverUrl = await getServerUrl();

    try {
        const response = await fetch(`${serverUrl}/health`, {
            method: 'GET'
        });

        if (response.ok) {
            const data = await response.json();
            return { online: true, ...data };
        }
        return { online: false, error: `HTTP ${response.status}` };
    } catch (error) {
        return { online: false, error: error.message };
    }
}

// --- Descargar imagen y procesarla ---
async function handleProcessImageUrl(imageUrl, sourceLang, targetLang) {
    console.log(`Descargando imagen: ${imageUrl}`);

    // 1. Descargar la imagen (el service worker no tiene restricciones CORS)
    const imageBase64 = await downloadImageAsBase64(imageUrl);

    if (!imageBase64) {
        throw new Error('No se pudo descargar la imagen');
    }

    console.log(`Imagen descargada: ${Math.round(imageBase64.length / 1024)}KB`);

    // 2. Enviar al servidor OCR
    const serverUrl = await getServerUrl();

    const response = await fetch(`${serverUrl}/ocr`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image: imageBase64,
            sourceLang: sourceLang,
            targetLang: targetLang
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.error || 'Error desconocido del servidor');
    }

    return { blocks: data.blocks || [] };
}

// --- Descargar imagen como base64 ---
async function downloadImageAsBase64(url) {
    try {
        const response = await fetch(url);

        if (!response.ok) {
            // Silenciar - errores de descarga son comunes (403, 404, etc.)
            return null;
        }

        const blob = await response.blob();

        // Convertir blob a base64
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                if (dataUrl && dataUrl.includes(',')) {
                    resolve(dataUrl.split(',')[1]);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        // Silenciar - errores de red son comunes
        return null;
    }
}

console.log("Background script iniciado - Traductor v4.0 (Multi-idioma)");
