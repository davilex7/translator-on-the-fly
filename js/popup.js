// popup.js
// Lógica para la ventana emergente (popup)

// --- Elementos del DOM ---
const toggleSwitch = document.getElementById('toggle');
const statusText = document.getElementById('status');
const languageSelect = document.getElementById('language-select');
const progressSection = document.getElementById('progress-section');
const progressStatus = document.getElementById('progress-status');
const progressBar = document.getElementById('progress-bar');


// --- Cargar estado inicial y preferencias ---
document.addEventListener('DOMContentLoaded', () => {
    // Cargar el estado guardado (activado/desactivado)
    chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
        const isEnabled = result.isEnabled || false; // Valor por defecto: desactivado
        // Asegurarse de que el idioma por defecto exista en el select
        const defaultLang = 'es';
        const targetLanguage = result.targetLanguage && languageSelect.querySelector(`option[value="${result.targetLanguage}"]`)
                             ? result.targetLanguage
                             : defaultLang;

        toggleSwitch.checked = isEnabled;
        statusText.textContent = `Estado: ${isEnabled ? 'Activado' : 'Desactivado'}`;
        languageSelect.value = targetLanguage;

        // Si está activado, podríamos querer mostrar el progreso si hay una operación en curso
        // (requiere comunicación desde content.js o background.js)
    });
});

// --- Event Listener para el Switch ---
toggleSwitch.addEventListener('change', () => {
    const isEnabled = toggleSwitch.checked;

    // Guardar el nuevo estado
    chrome.storage.sync.set({ isEnabled: isEnabled }, () => {
        console.log(`Traducción ${isEnabled ? 'activada' : 'desactivada'}`);
        statusText.textContent = `Estado: ${isEnabled ? 'Activado' : 'Desactivado'}`;

        // Enviar mensaje al content script para que actúe
        sendMessageToContentScript({
            action: "toggleTranslation",
            payload: isEnabled
        });
    });
});

// --- Event Listener para el Selector de Idioma ---
languageSelect.addEventListener('change', () => {
    const selectedLanguage = languageSelect.value;
    chrome.storage.sync.set({ targetLanguage: selectedLanguage }, () => {
        console.log(`Idioma destino cambiado a: ${selectedLanguage}`);
        // Si la traducción está activa, enviar mensaje para actualizar idioma
        if (toggleSwitch.checked) {
             sendMessageToContentScript({
                 action: "setLanguage",
                 payload: selectedLanguage
             });
        }
    });
});

// --- Función para enviar mensajes al Content Script ---
function sendMessageToContentScript(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("No se pudo enviar mensaje al content script:", chrome.runtime.lastError.message);
                    // Podrías mostrar un error en el popup si es relevante
                    // statusText.textContent = "Error: Recarga la página.";
                } else {
                    console.log("Respuesta del content script:", response);
                    // Procesar respuesta si es necesario (ej. actualizar UI del popup)
                    if (response && response.status === 'processing') {
                        showProgress('Iniciando OCR...', 0);
                    }
                }
            });
        } else {
            console.warn("No se pudo obtener la pestaña activa.");
            // statusText.textContent = "Error: No hay pestaña activa.";
        }
    });
}

// --- Escuchar mensajes del Content Script (para actualizaciones de progreso) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Asegurarse de que el mensaje viene del content script de la pestaña activa (opcional pero bueno)
     if (sender.tab && request.type === 'PROGRESS_UPDATE') {
        console.log('Mensaje de progreso recibido:', request.payload);
        const { status, progress } = request.payload;
        showProgress(status, progress);
        // Podríamos enviar una respuesta si el content script la espera
        // sendResponse({ received: true });
    } else if(sender.tab && request.type === 'PROCESS_COMPLETE') {
        console.log('Proceso completado según content script');
        hideProgress();
        statusText.textContent = `Estado: Activado (Completado)`;
    } else if(sender.tab && request.type === 'PROCESS_ERROR') {
        console.error('Error en el proceso según content script:', request.payload);
        hideProgress();
        statusText.textContent = `Estado: Error (${request.payload.shortMessage || 'ver consola'})`;
    }

    // Mantener el canal abierto para respuestas asíncronas si es necesario
    // return true;
});


// --- Funciones para mostrar/ocultar progreso ---
function showProgress(statusMsg, progressPercent) {
    progressStatus.textContent = statusMsg;
    // Asegurar que el porcentaje está entre 0 y 100
    const clampedProgress = Math.max(0, Math.min(100, progressPercent));
    progressBar.style.width = `${clampedProgress}%`;
    progressSection.classList.remove('hidden');
}

function hideProgress() {
    progressSection.classList.add('hidden');
     // Restaurar estado normal si es necesario
    chrome.storage.sync.get(['isEnabled'], (result) => {
       statusText.textContent = `Estado: ${result.isEnabled ? 'Activado' : 'Desactivado'}`;
    });
}
