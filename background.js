// background.js
// Service Worker para tareas de fondo

// Este script se ejecuta en segundo plano. Útil para:
// - Inicializar estado al instalar/actualizar.
// - Escuchar eventos del navegador (ej. cambio de pestaña, finalización de navegación).
// - Orquestar comunicación compleja (aunque para este caso, popup <-> content es suficiente).
// - Realizar llamadas a APIs externas si es necesario (ej. API de traducción).

// --- Evento de Instalación/Actualización ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extensión Traductor Manga instalada/actualizada.", details.reason);
  // Inicializar valores por defecto en chrome.storage si no existen
  chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
    if (result.isEnabled === undefined) {
      chrome.storage.sync.set({ isEnabled: false });
      console.log("Estado 'isEnabled' inicializado a false.");
    }
    if (result.targetLanguage === undefined) {
      chrome.storage.sync.set({ targetLanguage: 'es' });
      console.log("Idioma 'targetLanguage' inicializado a 'es'.");
    }
  });

  // Podrías abrir una página de bienvenida en la instalación
  // if (details.reason === 'install') {
  //   chrome.tabs.create({ url: 'welcome.html' });
  // }
});

// --- Escuchar mensajes (si fuera necesario comunicarse con el background script) ---
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   console.log("Mensaje recibido en background script:", request);
//   if (request.action === "getApiKey") {
//     // Ejemplo: Devolver una clave API almacenada de forma segura (no recomendado directamente)
//     // sendResponse({ apiKey: "..." });
//   }
//   // return true; // Si la respuesta es asíncrona
// });


// --- Ejemplo: Escuchar cambios en la URL de la pestaña activa ---
// Podría usarse para reactivar/limpiar la traducción al navegar
/*
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Comprobar si la URL cambió y la carga está completa
  if (changeInfo.url && changeInfo.status === 'complete') {
    console.log(`Navegación a nueva URL detectada: ${changeInfo.url}`);
    // Podríamos enviar un mensaje al content script de esa pestaña para que
    // re-evalúe si debe estar activo o limpie overlays antiguos.
    chrome.storage.sync.get(['isEnabled'], (result) => {
        if(result.isEnabled) {
             console.log("Enviando mensaje de 'reset' al content script debido a navegación.");
             chrome.tabs.sendMessage(tabId, { action: "resetOnNavigate" })
                 .catch(err => console.log("Content script aún no listo o cerrado.")); // Es común que falle si la pestaña se está recargando
        }
    });
  }
});
*/

console.log("Background script (Service Worker) iniciado.");
