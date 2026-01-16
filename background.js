// background.js - Service Worker
// Maneja las llamadas a Google Vision API y traducción

const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';
const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';

// --- Inicialización ---
chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extensión Traductor Manhwa instalada/actualizada:", details.reason);
    chrome.storage.sync.get(['isEnabled', 'targetLanguage'], (result) => {
        if (result.isEnabled === undefined) {
            chrome.storage.sync.set({ isEnabled: false });
        }
        if (result.targetLanguage === undefined) {
            chrome.storage.sync.set({ targetLanguage: 'es' });
        }
    });
});

// --- Escuchar mensajes del content script ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'processImage') {
        // Procesar imagen: OCR + Traducción
        handleProcessImage(request.imageData, request.targetLang)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Mantener canal abierto para respuesta async
    }
    return false;
});

// --- Procesar imagen completa ---
async function handleProcessImage(imageBase64, targetLang) {
    // 1. Obtener API Key
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('API Key no configurada');
    }

    // 2. Llamar a Vision API
    const ocrBlocks = await callVisionApi(imageBase64, apiKey);

    if (ocrBlocks.length === 0) {
        return { blocks: [] };
    }

    // 3. Traducir los bloques
    const translatedBlocks = await translateBlocks(ocrBlocks, targetLang);

    return { blocks: translatedBlocks };
}

// --- Obtener API Key del storage ---
function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['visionApiKey'], (result) => {
            resolve(result.visionApiKey || null);
        });
    });
}

// --- Llamar a Google Vision API ---
async function callVisionApi(imageBase64, apiKey) {
    const requestBody = {
        requests: [{
            image: {
                content: imageBase64
            },
            features: [{
                type: 'DOCUMENT_TEXT_DETECTION',
                maxResults: 50
            }],
            imageContext: {
                languageHints: ['ko', 'ja', 'zh']
            }
        }]
    };

    const response = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
        throw new Error(`Vision API error: ${errorMsg}`);
    }

    const data = await response.json();
    return parseVisionResponse(data);
}

// --- Parsear respuesta de Vision API ---
function parseVisionResponse(data) {
    const blocks = [];

    if (!data.responses || !data.responses[0]) {
        return blocks;
    }

    const response = data.responses[0];

    if (response.error) {
        throw new Error(response.error.message);
    }

    const annotation = response.fullTextAnnotation;
    if (!annotation || !annotation.pages) {
        return blocks;
    }

    // Iterar páginas -> bloques -> párrafos
    for (const page of annotation.pages) {
        if (!page.blocks) continue;

        for (const block of page.blocks) {
            if (!block.paragraphs) continue;

            for (const paragraph of block.paragraphs) {
                // Reconstruir texto del párrafo
                let paragraphText = '';
                if (paragraph.words) {
                    for (const word of paragraph.words) {
                        if (word.symbols) {
                            const wordText = word.symbols.map(s => s.text).join('');
                            paragraphText += wordText + ' ';
                        }
                    }
                }

                paragraphText = paragraphText.trim();
                if (!paragraphText) continue;

                // Obtener bounding box
                const bbox = getBboxFromVertices(paragraph.boundingBox?.vertices);
                if (!bbox) continue;

                blocks.push({
                    text: paragraphText,
                    bbox: bbox,
                    confidence: paragraph.confidence || 0.9
                });
            }
        }
    }

    return blocks;
}

// --- Convertir vértices a bbox ---
function getBboxFromVertices(vertices) {
    if (!vertices || vertices.length !== 4) {
        return null;
    }

    const xCoords = vertices.map(v => v.x || 0);
    const yCoords = vertices.map(v => v.y || 0);

    return {
        x0: Math.min(...xCoords),
        y0: Math.min(...yCoords),
        x1: Math.max(...xCoords),
        y1: Math.max(...yCoords)
    };
}

// --- Traducir bloques de texto ---
async function translateBlocks(textBlocks, targetLang) {
    const translatedBlocks = [];

    // Extraer textos originales
    const originalTexts = textBlocks.filter(b => b.text).map(b => b.text);

    if (originalTexts.length === 0) {
        return textBlocks.map(block => ({ ...block, translatedText: '' }));
    }

    // Unir todos los textos para una sola llamada a la API
    const fullText = originalTexts.join('\n');
    const translatedFullText = await translateText(fullText, targetLang);

    // Si la traducción falló, usar texto original
    if (!translatedFullText || translatedFullText === fullText) {
        return textBlocks.map(block => ({ ...block, translatedText: block.text || '' }));
    }

    // Separar las traducciones
    const translatedLines = translatedFullText.split('\n');
    let lineIndex = 0;

    for (const block of textBlocks) {
        const newBlock = { ...block };

        if (block.text && lineIndex < translatedLines.length) {
            newBlock.translatedText = translatedLines[lineIndex].trim();
            lineIndex++;
        } else {
            newBlock.translatedText = block.text || '';
        }

        translatedBlocks.push(newBlock);
    }

    return translatedBlocks;
}

// --- Traducir texto con MyMemory API ---
async function translateText(text, targetLang, sourceLang = 'ko') {
    if (!text || !text.trim()) {
        return '';
    }

    const params = new URLSearchParams({
        q: text,
        langpair: `${sourceLang}|${targetLang}`
    });

    try {
        const response = await fetch(`${MYMEMORY_API_URL}?${params}`, {
            method: 'GET',
            headers: {
                'User-Agent': 'ManhwaTranslator/1.0'
            }
        });

        if (!response.ok) {
            console.warn('MyMemory API error:', response.status);
            return text;
        }

        const data = await response.json();

        if (data.responseStatus === 200 && data.responseData?.translatedText) {
            let translated = data.responseData.translatedText;

            // Limpiar prefijos conocidos
            if (translated.toUpperCase().startsWith('SUBJECT? ')) {
                translated = translated.substring(9);
            }

            // Si la traducción es igual al original, devolver original
            if (translated.trim().toLowerCase() === text.trim().toLowerCase()) {
                return text;
            }

            return translated.trim();
        }

        return text;
    } catch (error) {
        console.error('Error en traducción:', error);
        return text;
    }
}

console.log("Background script (Service Worker) iniciado - Traductor Manhwa v1.0");
