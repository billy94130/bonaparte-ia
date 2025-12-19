/**
 * BONAPARTE IA - Service Vision
 * Analyse des photos avec Claude Haiku 3.5
 */

const Anthropic = require('@anthropic-ai/sdk');
const cloudinaryService = require('./cloudinary');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Sélectionner les meilleures images
 */
function selectBestImages(imageUrls) {
    const maxImages = 10;
    if (imageUrls.length <= maxImages) return imageUrls;

    const selected = [];
    const step = Math.floor(imageUrls.length / maxImages);
    for (let i = 0; i < maxImages; i++) {
        const index = Math.min(i * step, imageUrls.length - 1);
        selected.push(imageUrls[index]);
    }
    return selected;
}

/**
 * Convertir URL en base64
 */
async function urlToBase64(url) {
    try {
        const optimizedUrl = cloudinaryService.getVisionOptimizedUrl(url);
        const response = await fetch(optimizedUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const contentType = response.headers.get('content-type') || 'image/jpeg';

        return {
            type: 'base64',
            media_type: contentType,
            data: base64
        };
    } catch (error) {
        console.error('❌ Erreur conversion:', error);
        throw error;
    }
}

/**
 * Analyser les images
 */
async function analyzeProperty(imageUrls, description = '') {
    console.log(`👁️ Analyse Vision de ${imageUrls.length} images...`);

    const selectedUrls = selectBestImages(imageUrls);
    console.log(`📸 ${selectedUrls.length} images sélectionnées`);

    console.log('🔄 Conversion en base64...');
    const imageContents = await Promise.all(
        selectedUrls.map(async (url) => ({
            type: 'image',
            source: await urlToBase64(url)
        }))
    );

    const analysisPrompt = `Tu es un expert en immobilier de prestige.
Analyse ces ${selectedUrls.length} photos d'un bien immobilier.

${description ? `Description fournie: "${description}"` : ''}

Génère une analyse au format JSON:

{
  "pieces_identifiees": ["salon", "cuisine", "chambre"],
  "materiaux": ["parquet", "marbre", "pierre"],
  "luminosite": "excellente / bonne / moyenne",
  "vues": "mer / jardin / ville / montagne" ou null,
  "standing": "ultra-luxe / luxe / haut de gamme",
  "points_forts": ["vue mer panoramique", "grands volumes"],
  "ambiance": "contemporain / classique / moderne"
}

Réponds UNIQUEMENT avec le JSON.`;

    console.log('🤖 Appel Claude Vision...');

    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        messages: [
            {
                role: 'user',
                content: [
                    ...imageContents,
                    { type: 'text', text: analysisPrompt }
                ]
            }
        ]
    });

    const responseText = response.content[0].text;

    try {
        let cleanJson = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const analysis = JSON.parse(cleanJson);

        console.log('✅ Analyse Vision terminée');

        return {
            ...analysis,
            images_analysees: selectedUrls.length,
            images_totales: imageUrls.length,
            timestamp: new Date().toISOString()
        };

    } catch (parseError) {
        console.error('⚠️ Erreur parsing JSON');

        return {
            pieces_identifiees: [],
            materiaux: [],
            luminosite: 'bonne',
            vues: null,
            standing: 'luxe',
            points_forts: [],
            ambiance: 'contemporain',
            raw_response: responseText,
            images_analysees: selectedUrls.length,
            images_totales: imageUrls.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = {
    analyzeProperty,
    selectBestImages,
    MODEL
};
