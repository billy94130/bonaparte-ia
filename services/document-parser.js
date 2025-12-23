/**
 * BONAPARTE IA - Service Document Parser
 * Parse PDF, TXT files and extract text using pdfjs-dist
 */

const path = require('path');

// Dynamically import pdfjs-dist (ES module)
let pdfjsLib = null;

async function initPdfJs() {
    if (!pdfjsLib) {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib = pdfjs;
    }
    return pdfjsLib;
}

/**
 * Parse a PDF file and extract text using pdfjs-dist
 */
async function parsePDF(buffer) {
    try {
        console.log('📖 Début parsing PDF avec pdfjs-dist...');

        const pdfjs = await initPdfJs();

        // Convert buffer to Uint8Array
        const uint8Array = new Uint8Array(buffer);

        // Load PDF document
        const loadingTask = pdfjs.getDocument({ data: uint8Array });
        const pdf = await loadingTask.promise;

        console.log(`📄 PDF chargé: ${pdf.numPages} pages`);

        let fullText = '';

        // Extract text from each page
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        console.log(`✅ PDF parsé: ${pdf.numPages} pages, ${fullText.length} caractères`);

        if (fullText.trim().length === 0) {
            return '[Le PDF semble être une image scannée - pas de texte extractible. Veuillez copier-coller le contenu.]';
        }

        return fullText;
    } catch (error) {
        console.error('❌ Erreur parsing PDF:', error.message);
        return `[Erreur lecture PDF: ${error.message}]`;
    }
}

/**
 * Parse a TXT file
 */
function parseTXT(buffer) {
    return buffer.toString('utf-8');
}

/**
 * Parse uploaded document based on type
 */
async function parseDocument(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    const buffer = file.buffer;

    console.log(`📄 Parsing document: ${file.originalname} (${ext})`);

    switch (ext) {
        case '.pdf':
            return await parsePDF(buffer);
        case '.txt':
            return parseTXT(buffer);
        case '.doc':
        case '.docx':
            return `[Document Word: ${file.originalname} - Veuillez copier-coller le texte ou convertir en PDF.]`;
        default:
            return `[Format non supporté: ${ext}]`;
    }
}

/**
 * Parse multiple documents and combine their text
 */
async function parseDocuments(files) {
    if (!files || files.length === 0) {
        return '';
    }

    const results = [];

    for (const file of files) {
        const text = await parseDocument(file);
        if (text && text.trim()) {
            results.push(`\n--- Contenu de ${file.originalname} ---\n${text}`);
        }
    }

    return results.join('\n');
}

module.exports = {
    parseDocument,
    parseDocuments,
    parsePDF,
    parseTXT
};
