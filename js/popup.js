// popup.js - Lógica para la ventana emergente

// --- Elementos del DOM ---
const toggleSwitch = document.getElementById('toggle');
const statusText = document.getElementById('status');
const languageSelect = document.getElementById('language-select');
const progressSection = document.getElementById('progress-section');
const progressStatus = document.getElementById('progress-status');
const progressBar = document.getElementById('progress-bar');
const apiKeyInput = document.getElementById('api-key');
const saveApiKeyBtn = document.getElementById('save-api-key');
const apiKeyStatus = document.getElementById('api-key-status');
const apiStatusIndicator = document.getElementById('api-status-indicator');
const statsSection = document.getElementById('stats-section');
const statsImages = document.getElementById('stats-images');
const statsBlocks = document.getElementById('stats-blocks');

// --- Estado ---
let hasApiKey = false;

// --- Cargar estado inicial ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['isEnabled', 'targetLanguage', 'visionApiKey'], (result) => {
        const isEnabled = result.isEnabled || false;
        const targetLanguage = result.targetLanguage || 'es';

        // Verificar si hay API Key configurada
        hasApiKey = !!(result.visionApiKey && result.visionApiKey.trim());

        updateApiKeyUI(hasApiKey);

        toggleSwitch.checked = isEnabled;
        toggleSwitch.disabled = !hasApiKey;
        languageSelect.value = targetLanguage;

        updateStatusText(isEnabled, hasApiKey);

        // Mostrar parcialmente la API Key si existe
        if (hasApiKey) {
            const key = result.visionApiKey;
            apiKeyInput.placeholder = key.substring(0, 8) + '...' + key.substring(key.length - 4);
        }
    });
});

// --- Guardar API Key ---
saveApiKeyBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        showApiKeyMessage('Introduce una API Key valida', 'error');
        return;
    }

    if (!apiKey.startsWith('AIza')) {
        showApiKeyMessage('La API Key debe comenzar con "AIza"', 'error');
        return;
    }

    // Guardar la API Key
    chrome.storage.sync.set({ visionApiKey: apiKey }, () => {
        hasApiKey = true;
        updateApiKeyUI(true);
        toggleSwitch.disabled = false;
        apiKeyInput.value = '';
        apiKeyInput.placeholder = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
        showApiKeyMessage('API Key guardada correctamente', 'success');
        updateStatusText(toggleSwitch.checked, true);
    });
});

// --- Toggle de traducción ---
toggleSwitch.addEventListener('change', () => {
    if (!hasApiKey) {
        toggleSwitch.checked = false;
        showApiKeyMessage('Configura primero tu API Key', 'error');
        return;
    }

    const isEnabled = toggleSwitch.checked;

    chrome.storage.sync.set({ isEnabled: isEnabled }, () => {
        updateStatusText(isEnabled, hasApiKey);

        sendMessageToContentScript({
            action: "toggleTranslation",
            payload: isEnabled
        });
    });
});

// --- Cambio de idioma ---
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
function updateApiKeyUI(configured) {
    if (configured) {
        apiStatusIndicator.classList.remove('not-configured');
        apiStatusIndicator.classList.add('configured');
    } else {
        apiStatusIndicator.classList.remove('configured');
        apiStatusIndicator.classList.add('not-configured');
    }
}

function showApiKeyMessage(message, type) {
    apiKeyStatus.textContent = message;
    apiKeyStatus.className = 'text-xs mt-1 ' + (type === 'error' ? 'text-red-500' : 'text-green-500');
    setTimeout(() => {
        apiKeyStatus.textContent = '';
    }, 3000);
}

function updateStatusText(isEnabled, hasKey) {
    if (!hasKey) {
        statusText.textContent = 'Configura tu API Key para comenzar';
    } else if (isEnabled) {
        statusText.textContent = 'Estado: Activado';
    } else {
        statusText.textContent = 'Estado: Desactivado';
    }
}

function sendMessageToContentScript(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("No se pudo enviar mensaje:", chrome.runtime.lastError.message);
                } else {
                    console.log("Respuesta:", response);
                }
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
                updateStatusText(toggleSwitch.checked, hasApiKey);
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
