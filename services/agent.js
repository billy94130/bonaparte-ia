/**
 * BONAPARTE IA - Agent V13 - Claude Sonnet 4.5
 */

const Anthropic = require('@anthropic-ai/sdk');
const { TONS, VIDEO_TYPES, PHOTO_SUMMARY_PROMPT, CONVERSATION_PROMPT, SCRIPT_COMPLET_PROMPT, LOOP_DEFINITION } = require('../prompts/system');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5-20250929';

async function processMessage(session, message) {
    const phase = determinePhase(session);
    console.log(`📋 Phase: ${phase}`);

    switch (phase) {
        case 'waiting_images': return handleWaitingImages();
        case 'waiting_analysis': return handleWaitingAnalysis(session);
        case 'photo_summary': return handlePhotoSummary(session);
        case 'conversation': return handleConversation(session, message);
        case 'configuration': return handleConfiguration(session, message);
        case 'generation': return handleGeneration(session, message);
        case 'post_generation': return handlePostGeneration(session, message);
        default: return { message_utilisateur: 'Erreur', config: { route: 'error' } };
    }
}

function determinePhase(session) {
    // Sécurité : initialiser property si undefined
    if (!session.property) {
        session.property = { description: '', imageUrls: [], analysis: null };
    }
    if (!session.property.imageUrls) {
        session.property.imageUrls = [];
    }

    if (session.property.imageUrls.length === 0) return 'waiting_images';
    if (!session.property.analysis) return 'waiting_analysis';
    if (!session.photoSummaryDone) return 'photo_summary';
    if (!session.readyForConfig) return 'conversation';
    if (!session.configValidated) return 'configuration';
    if (!session.generatedScript) return 'generation';
    return 'post_generation';
}

function handleWaitingImages() {
    return { message_utilisateur: `Envoyez les photos avec une description.`, config: { route: 'waiting_images' } };
}

function handleWaitingAnalysis(session) {
    return { message_utilisateur: `${session.property.imageUrls.length} photos reçues. Analyse...`, config: { route: 'analyzing' } };
}

async function callClaude(prompt, maxTokens = 2000) {
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
    });
    return response.content[0].text;
}

async function handlePhotoSummary(session) {
    console.log('🎯 handlePhotoSummary appelé');

    // Sécurité
    if (!session.property) session.property = { description: '', imageUrls: [], analysis: null };

    const analysis = session.property.analysis || {};
    const description = session.property.description || '';

    console.log('📄 Description:', description.substring(0, 100) + '...');
    console.log('📊 Analysis keys:', Object.keys(analysis));

    const prompt = PHOTO_SUMMARY_PROMPT
        .replace('{ANALYSIS}', JSON.stringify(analysis, null, 2))
        .replace('{DESCRIPTION}', description);

    console.log('📝 Prompt length:', prompt.length);

    try {
        console.log('🤖 Appel Claude Sonnet pour résumé...');
        let summary = await callClaude(prompt, 1500);
        console.log('✅ Réponse Claude reçue:', summary ? summary.substring(0, 100) + '...' : 'VIDE');

        summary = formatText(summary);

        session.photoSummary = summary;
        session.photoSummaryDone = true;
        session.additionalInfos = [];
        session.conversationHistory = [];
        session.conversationCount = 0;

        return { message_utilisateur: summary, config: { route: 'conversation' } };
    } catch (error) {
        console.error('❌ Erreur handlePhotoSummary:', error);
        session.photoSummaryDone = true;
        session.additionalInfos = [];
        session.conversationHistory = [];
        session.conversationCount = 0;
        return { message_utilisateur: `Photos analysées. Autre chose à ajouter ?`, config: { route: 'conversation' } };
    }
}

async function handleConversation(session, message) {
    if (!message || !message.trim()) {
        return { message_utilisateur: `Ajoute quelque chose ou dis "ok" pour continuer.`, config: { route: 'conversation' } };
    }

    const lower = message.toLowerCase().trim();

    // Phrases EXACTES qui déclenchent le passage à la configuration
    const exactReadyPhrases = [
        'ok', 'non', 'no', 'nope', 'rien', 'prêt', 'go',
        'c\'est bon', 'c\'est tout', 'c\'est top', 'parfait', 'super',
        'non merci', 'rien d\'autre', 'on passe', 'rien à ajouter',
        'non c\'est bon', 'non c\'est tout', 'non rien',
        'c\'est ok', 'tout est bon', 'on y va', 'générer', 'generer'
    ];

    // Vérifier si c'est une validation EXACTE (pas "oui le marbre...")
    const isExactReady = exactReadyPhrases.some(p => lower === p);

    // Si le message contient "oui" mais avec du contenu après → c'est une info à ajouter
    const startsWithYesAndHasContent = (lower.startsWith('oui ') || lower.startsWith('oui,')) && lower.length > 5;

    if (isExactReady && !startsWithYesAndHasContent) {
        session.readyForConfig = true;
        return handleConfiguration(session, '');
    }

    session.conversationHistory = session.conversationHistory || [];
    session.additionalInfos = session.additionalInfos || [];
    session.conversationCount = (session.conversationCount || 0) + 1;

    session.conversationHistory.push({ role: 'user', content: message.trim() });
    session.additionalInfos.push(message.trim());

    try {
        // Construire le contexte du bien pour éviter les hallucinations
        const propertyContext = `
Bien: ${session.property.description || 'Propriété de prestige'}
Analyse: ${session.photoSummary ? 'Photos analysées' : 'En cours'}
Infos ajoutées: ${session.additionalInfos.slice(0, -1).join(', ') || 'Aucune'}
`;

        const historyText = session.conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'IA'}: ${m.content}`).join('\n');
        const conversationPrompt = CONVERSATION_PROMPT
            .replace('{PROPERTY_CONTEXT}', propertyContext)
            .replace('{CONVERSATION_HISTORY}', historyText || '-')
            .replace('{USER_MESSAGE}', message.trim());

        let aiResponse = await callClaude(conversationPrompt, 300);
        aiResponse = formatText(aiResponse);
        session.conversationHistory.push({ role: 'assistant', content: aiResponse });

        if (session.conversationCount >= 3) {
            aiResponse += '\n\nOn passe à la config ? Dis "ok" !';
        }

        return { message_utilisateur: aiResponse, config: { route: 'conversation' } };
    } catch (error) {
        console.error('Erreur:', error);
        return { message_utilisateur: `Intéressant ! Dis "ok" pour continuer.`, config: { route: 'conversation' } };
    }
}

function handleConfiguration(session, message) {
    const lower = (message || '').toLowerCase();
    if (lower.includes('générer') || lower.includes('go') || lower === 'generer') {
        session.configValidated = true;
        return handleGeneration(session, message);
    }

    if (session.pendingConfig) {
        Object.assign(session.config, session.pendingConfig);
        session.pendingConfig = null;
    }

    const ton = TONS.find(t => t.id === session.config.ton) || TONS[0];
    const format = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];

    const infosAdded = session.additionalInfos?.length > 0
        ? `\n\n✅ Infos: ${session.additionalInfos.join(' | ')}`
        : '';

    return {
        message_utilisateur: `**Configuration**

Choisis tes paramètres ci-dessous !${infosAdded}

📹 Format: ${format.name} (${format.duration})
🎨 Ton: ${ton.name}
🔄 Loop: ${session.config.loop ? 'ON' : 'OFF'}

Clique sur **GÉNÉRER** !`,
        config: { route: 'configuration', settings: session.config }
    };
}

async function handleGeneration(session, message) {
    console.log('🎬 Génération avec Claude Sonnet 4.5...');

    const analysis = session.property.analysis || {};
    const description = session.property.description || '';
    const ton = TONS.find(t => t.id === session.config.ton) || TONS[0];
    const format = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];
    const city = extractCity(description);
    const loopEnabled = session.config.loop === true;

    const userInfo = session.additionalInfos?.length > 0 ? session.additionalInfos.join('\n') : 'Aucune';
    const propertyInfo = `Ville: ${city}\nDescription: ${description}\nStanding: ${analysis.standing || 'Luxe'}`;
    const loopSection = loopEnabled ? LOOP_DEFINITION : '';

    // Construire les détails du ton
    const tonDetails = `FONCTION : ${ton.fonction || ton.instructions}
RÈGLES : ${ton.regles || ton.instructions}
EXEMPLE D'OUVERTURE : "${ton.exemple || ''}"`;

    // LOOP ENDING - uniquement le connecteur
    const loopEnding = loopEnabled
        ? `**[FIN - LOOP]**
"...parce que"
*Vidéo: Transition vers le premier plan.*

⚠️ RAPPEL : La fin = UNIQUEMENT le connecteur. PAS une phrase complète. PAS la répétition du début.`
        : `**[FIN]**
"[Phrase de conclusion]"
*Vidéo: Plan final*`;

    // RANDOM SEED pour forcer la variété
    const randomSeed = Date.now() % 10000;

    let prompt = SCRIPT_COMPLET_PROMPT
        .replace(/{RANDOM_SEED}/g, randomSeed.toString())
        .replace(/{PROPERTY_INFO}/g, propertyInfo)
        .replace(/{USER_INFO}/g, userInfo)
        .replace(/{FORMAT_NAME}/g, format.name)
        .replace(/{FORMAT_DURATION}/g, format.duration)
        .replace(/{TON_NAME}/g, ton.name)
        .replace(/{TON_FONCTION}/g, ton.fonction || '')
        .replace(/{TON_REGLES}/g, ton.regles || '')
        .replace(/{TON_INTERDIT}/g, ton.interdit || '')
        .replace(/{TON_EXEMPLE}/g, ton.exemple || '')
        .replace(/{NB_PHRASES}/g, format.phrases)
        .replace(/{LOOP_STATUS}/g, loopEnabled ? 'OUI' : 'NON')
        .replace(/{LOOP_SECTION}/g, loopSection)
        .replace(/{LOOP_ENDING}/g, loopEnding);

    try {
        let script = await callClaude(prompt, 4000);
        script = formatText(script);

        session.generatedScript = script;
        session.generatedAt = new Date().toISOString();

        return { message_utilisateur: script, config: { route: 'script_genere', script_generated: true } };
    } catch (error) {
        console.error('Erreur:', error);
        return { message_utilisateur: `Erreur: ${error.message}`, config: { route: 'error' } };
    }
}

async function handlePostGeneration(session, message) {
    const lower = (message || '').toLowerCase();

    // Commandes de régénération standard
    const commands = {
        'raccourcir': 'Raccourcis le script. Maximum 4 phrases courtes.',
        'allonger': 'Allonge le script. Double le nombre de séquences.',
        'nouvelle version': 'Génère une version complètement différente.',
        'original': 'Rends le script plus original et créatif.',
        'premium': 'Rends le script plus luxueux et prestigieux.'
    };

    for (const [key, instruction] of Object.entries(commands)) {
        if (lower.includes(key)) return regenerate(session, instruction);
    }

    // Détection de changement de FORMAT
    const formatMatch = lower.match(/format\s+(teaser|reel|signature|loop)/i);
    if (formatMatch || lower.includes('en format')) {
        const format = formatMatch ? formatMatch[1].toLowerCase() :
            lower.includes('teaser') ? 'teaser' :
                lower.includes('reel') ? 'reel' :
                    lower.includes('signature') ? 'signature' :
                        lower.includes('loop') ? 'loop' : null;

        if (format) {
            session.config.type_video = format;
            console.log(`🎬 Changement de format vers: ${format}`);
            // Supprimer le script pour forcer la régénération
            session.generatedScript = null;
            return handleGeneration(session, message);
        }
    }

    // Détection de changement de TON
    const tonMatch = lower.match(/ton\s+(prestige|dynamique|original)/i);
    if (tonMatch || lower.includes('avec le ton')) {
        const ton = tonMatch ? tonMatch[1].toLowerCase() :
            lower.includes('prestige') ? 'prestige' :
                lower.includes('dynamique') ? 'dynamique' :
                    lower.includes('original') ? 'original' : null;

        if (ton) {
            session.config.ton = ton;
            console.log(`🎨 Changement de ton vers: ${ton}`);
            session.generatedScript = null;
            return handleGeneration(session, message);
        }
    }

    // Commandes de régénération explicites
    if (lower.includes('régénère') || lower.includes('regenere') || lower.includes('régénérer') || lower.includes('regenerer')) {
        // Supprimer le script pour forcer la régénération
        session.generatedScript = null;

        // Extraire les retours de l'utilisateur s'il y en a
        const feedback = message.replace(/régénère le script/gi, '').replace(/regenere le script/gi, '').trim();
        if (feedback && feedback.length > 3) {
            return regenerate(session, `Régénère le script avec ces retours: ${feedback}`);
        }
        return handleGeneration(session, message);
    }

    // Si le message contient "avec" c'est probablement des retours
    if (lower.includes('avec ces retours') || lower.includes('et ce style')) {
        return regenerate(session, message);
    }

    // Tout autre message = retours libres
    if (message && message.length > 5) {
        return regenerate(session, `Prends en compte ces retours: ${message}`);
    }

    return { message_utilisateur: `Script prêt ! Utilisez les boutons pour modifier ou donnez-moi vos retours.`, config: { route: 'post_generation', script_generated: true } };
}

function extractCity(description) {
    const cities = ['Saint-Gély-du-Fesc', 'Montpellier', 'Mougins', 'Cannes', 'Nice', 'Monaco', 'Paris', 'Lyon'];
    for (const city of cities) {
        if (description.toLowerCase().includes(city.toLowerCase())) return city;
    }
    return 'Côte d\'Azur';
}

/**
 * Format simple - pas de conversion HTML pour éviter les bugs
 */
function formatText(text) {
    return text
        .replace(/^##\s*/gm, '')
        .replace(/^#\s*/gm, '')
        .replace(/---+/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
}

async function regenerate(session, instruction) {
    const prompt = `Script actuel:\n${session.generatedScript}\n\nModification: ${instruction}`;
    let script = await callClaude(prompt, 4000);
    script = formatText(script);
    session.generatedScript = script;
    return { message_utilisateur: script, config: { route: 'script_genere', script_generated: true } };
}

function getScriptForExport(session) {
    return { script: session.generatedScript || '', config: session.config, generatedAt: session.generatedAt };
}

module.exports = { processMessage, determinePhase, getScriptForExport };
