// background.js - Service Worker
// Conecta con el servidor local de OCR (EasyOCR)

const DEFAULT_SERVER_URL = 'http://localhost:5000';

// --- Inicializacion ---
chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension Traductor Manhwa instalada:", details.reason);
    chrome.storage.sync.get(['isEnabled', 'targetLanguage', 'serverUrl'], (result) => {
        if (result.isEnabled === undefined) {
            chrome.storage.sync.set({ isEnabled: false });
        }
        if (result.targetLanguage === undefined) {
            chrome.storage.sync.set({ targetLanguage: 'es' });
        }
        if (result.serverUrl === undefined) {
            chrome.storage.sync.set({ serverUrl: DEFAULT_SERVER_URL });
        }
    });
});

// --- Escuchar mensajes del content script ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'processImage') {
        handleProcessImage(request.imageData, request.targetLang)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
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
            method: 'GET',
            timeout: 5000
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

// --- Procesar imagen ---
async function handleProcessImage(imageBase64, targetLang) {
    const serverUrl = await getServerUrl();

    // Llamar al servidor local de OCR
    const response = await fetch(`${serverUrl}/ocr`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image: imageBase64,
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

console.log("Background script iniciado - Traductor Manhwa v2.0 (EasyOCR)");
