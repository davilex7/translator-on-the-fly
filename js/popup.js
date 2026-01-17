// popup.js - Logica para la ventana emergente

// --- Elementos del DOM ---
const toggleSwitch = document.getElementById('toggle');
const statusText = document.getElementById('status');
const sourceLanguageSelect = document.getElementById('source-language-select');
const languageSelect = document.getElementById('language-select');
const progressSection = document.getElementById('progress-section');
const progressStatus = document.getElementById('progress-status');
const progressBar = document.getElementById('progress-bar');
const serverStatusDot = document.getElementById('server-status-dot');
const serverStatusText = document.getElementById('server-status-text');
const serverUrlInput = document.getElementById('server-url');
const saveUrlBtn = document.getElementById('save-url-btn');
const checkServerBtn = document.getElementById('check-server-btn');
const statsSection = document.getElementById('stats-section');
const statsImages = document.getElementById('stats-images');
const statsBlocks = document.getElementById('stats-blocks');

// --- Estado ---
let serverOnline = false;

// --- Cargar estado inicial ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['isEnabled', 'sourceLanguage', 'targetLanguage', 'serverUrl'], (result) => {
        const isEnabled = result.isEnabled || false;
        const sourceLanguage = result.sourceLanguage || 'ko';
        const targetLanguage = result.targetLanguage || 'es';
        const serverUrl = result.serverUrl || 'http://localhost:5000';

        toggleSwitch.checked = isEnabled;
        sourceLanguageSelect.value = sourceLanguage;
        languageSelect.value = targetLanguage;
        serverUrlInput.value = serverUrl;

        // Verificar estado del servidor al abrir
        checkServerStatus();
    });
});

// --- Verificar estado del servidor ---
async function checkServerStatus() {
    setServerStatus('checking', 'Verificando conexion...');

    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkServer' });

        if (response.success && response.data.online) {
            serverOnline = true;
            setServerStatus('online', 'Conectado (EasyOCR)');
            toggleSwitch.disabled = false;
            updateStatusText();
        } else {
            serverOnline = false;
            const errorMsg = response.data?.error || response.error || 'No disponible';
            setServerStatus('offline', 'Desconectado: ' + errorMsg);
            toggleSwitch.disabled = true;
            toggleSwitch.checked = false;
            statusText.textContent = 'Inicia el servidor para comenzar';
        }
    } catch (error) {
        serverOnline = false;
        setServerStatus('offline', 'Error: ' + error.message);
        toggleSwitch.disabled = true;
        toggleSwitch.checked = false;
        statusText.textContent = 'Inicia el servidor para comenzar';
    }
}

function setServerStatus(status, text) {
    serverStatusDot.className = 'status-dot ' + status;
    serverStatusText.textContent = text;
}

// --- Guardar URL del servidor ---
saveUrlBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    if (!url) return;

    // Limpiar URL (quitar / final si existe)
    const cleanUrl = url.replace(/\/+$/, '');
    serverUrlInput.value = cleanUrl;

    chrome.storage.sync.set({ serverUrl: cleanUrl }, () => {
        checkServerStatus();
    });
});

// --- Boton verificar servidor ---
checkServerBtn.addEventListener('click', () => {
    checkServerStatus();
});

// --- Toggle de traduccion ---
toggleSwitch.addEventListener('change', () => {
    if (!serverOnline) {
        toggleSwitch.checked = false;
        statusText.textContent = 'Servidor no disponible';
        return;
    }

    const isEnabled = toggleSwitch.checked;

    chrome.storage.sync.set({ isEnabled: isEnabled }, () => {
        updateStatusText();

        sendMessageToContentScript({
            action: "toggleTranslation",
            payload: isEnabled
        });
    });
});

// --- Cambio de idioma origen ---
sourceLanguageSelect.addEventListener('change', () => {
    const selectedSourceLanguage = sourceLanguageSelect.value;
    chrome.storage.sync.set({ sourceLanguage: selectedSourceLanguage }, () => {
        if (toggleSwitch.checked) {
            sendMessageToContentScript({
                action: "setSourceLanguage",
                payload: selectedSourceLanguage
            });
        }
    });
});

// --- Cambio de idioma destino ---
languageSelect.addEventListener('change', () => {
    const selectedLanguage = languageSelect.value;
    chrome.storage.sync.set({ targetLanguage: selectedLanguage }, () => {
        if (toggleSwitch.checked) {
            sendMessageToContentScript({
                action: "setLanguage",
                payload: selectedLanguage
            });
        }
    });
});

// --- Funciones auxiliares ---
function updateStatusText() {
    if (!serverOnline) {
        statusText.textContent = 'Inicia el servidor para comenzar';
    } else if (toggleSwitch.checked) {
        statusText.textContent = 'Estado: Activado';
    } else {
        statusText.textContent = 'Estado: Desactivado';
    }
}

function sendMessageToContentScript(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                // Ignorar errores de conexion - es normal si el content script no esta cargado
                void chrome.runtime.lastError;
            });
        }
    });
}

// --- Escuchar mensajes del Content Script ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender.tab) {
        if (request.type === 'PROGRESS_UPDATE') {
            const { status, progress } = request.payload;
            showProgress(status, progress);
        } else if (request.type === 'PROCESS_COMPLETE') {
            hideProgress();
            statusText.textContent = 'Estado: Completado';
            if (request.payload && request.payload.stats) {
                showStats(request.payload.stats);
            }
        } else if (request.type === 'PROCESS_ERROR') {
            hideProgress();
            statusText.textContent = 'Error: ' + (request.payload.shortMessage || 'Ver consola');
            statusText.classList.add('text-red-500');
            setTimeout(() => {
                statusText.classList.remove('text-red-500');
                updateStatusText();
            }, 5000);
        }
    }
});

function showProgress(statusMsg, progressPercent) {
    progressStatus.textContent = statusMsg;
    const clampedProgress = Math.max(0, Math.min(100, progressPercent));
    progressBar.style.width = clampedProgress + '%';
    progressSection.classList.remove('hidden');
    statsSection.classList.add('hidden');
}

function hideProgress() {
    progressSection.classList.add('hidden');
}

function showStats(stats) {
    if (stats.images > 0 || stats.blocks > 0) {
        statsImages.textContent = stats.images || 0;
        statsBlocks.textContent = stats.blocks || 0;
        statsSection.classList.remove('hidden');
    }
}
