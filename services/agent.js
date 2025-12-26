/**
 * BONAPARTE IA - Agent V14 - Claude Sonnet 4.5
 * Avec chargement dynamique des documentations Format/Ton
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { TONS, VIDEO_TYPES, PHOTO_SUMMARY_PROMPT, CONVERSATION_PROMPT, SCRIPT_COMPLET_PROMPT, LOOP_DEFINITION } = require('../prompts/system');
const visionService = require('./vision');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5-20250929';

// Chemins vers les documentations
const DOCS_PATH = path.join(__dirname, '..', 'docs');

/**
 * Charge la documentation pour un format donné
 */
function loadFormatDoc(formatId) {
    const formatMap = {
        'teaser': 'TEASER.md',
        'reel': 'REEL.md',
        'loop': 'LOOP.md',
        'signature': 'SIGNATURE.md'
    };
    const filename = formatMap[formatId] || 'SIGNATURE.md';
    const filepath = path.join(DOCS_PATH, 'formats', filename);

    try {
        if (fs.existsSync(filepath)) {
            console.log(`📄 Chargement doc format: ${filename}`);
            return fs.readFileSync(filepath, 'utf-8');
        }
    } catch (e) {
        console.error(`Erreur chargement ${filename}:`, e.message);
    }
    return '';
}

/**
 * Charge la documentation pour un ton donné
 */
function loadTonDoc(tonId) {
    const tonMap = {
        'prestige': 'PRESTIGE.md',
        'dynamique': 'DYNAMIQUE.md',
        'original': 'ORIGINAL.md'
    };
    const filename = tonMap[tonId] || 'PRESTIGE.md';
    const filepath = path.join(DOCS_PATH, 'tons', filename);

    try {
        if (fs.existsSync(filepath)) {
            console.log(`📄 Chargement doc ton: ${filename}`);
            return fs.readFileSync(filepath, 'utf-8');
        }
    } catch (e) {
        console.error(`Erreur chargement ${filename}:`, e.message);
    }
    return '';
}

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
        return { message_utilisateur: `Je vous écoute. Dites-moi ce que vous souhaitez.`, config: { route: 'conversation' } };
    }

    session.conversationHistory = session.conversationHistory || [];
    session.additionalInfos = session.additionalInfos || [];
    session.conversationCount = (session.conversationCount || 0) + 1;

    session.conversationHistory.push({ role: 'user', content: message.trim() });

    try {
        // Contexte du bien
        const propertyContext = `
Bien: ${session.property.description || 'Propriété de prestige'}
Analyse: ${session.photoSummary ? 'Photos analysées' : 'En cours'}
Infos ajoutées: ${session.additionalInfos.join(', ') || 'Aucune'}
`;

        const historyText = session.conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'IA'}: ${m.content}`).join('\n');

        // Prompt intelligent qui laisse l'IA décider
        const conversationPrompt = `Tu es Bonaparte IA, expert en scripts vidéo Instagram pour l'immobilier.

CONTEXTE DU BIEN :
${propertyContext}

HISTORIQUE :
${historyText}

MESSAGE DE L'UTILISATEUR : "${message.trim()}"

---

Tu dois répondre naturellement à l'utilisateur.

ANALYSE SON INTENTION :
- S'il ajoute une info sur le bien → note-la et demande s'il y a autre chose
- S'il veut passer à la génération/configuration/choisir format/ton → réponds "SHOW_CONFIG" (exactement ce mot seul)
- S'il pose une question → réponds naturellement
- S'il n'a plus rien à ajouter → propose de passer à la configuration

Sois bref (2-3 phrases max), naturel, et vouvoie toujours.
Utilise uniquement les informations fournies.`;

        let aiResponse = await callClaude(conversationPrompt, 300);
        aiResponse = formatText(aiResponse);

        // Si l'IA détecte que l'utilisateur veut passer à la config
        if (aiResponse.includes('SHOW_CONFIG') || aiResponse.trim() === 'SHOW_CONFIG') {
            session.readyForConfig = true;
            return handleConfiguration(session, '');
        }

        // Sinon, ajouter aux infos si c'est pertinent (pas juste une question)
        if (!message.trim().endsWith('?')) {
            session.additionalInfos.push(message.trim());
        }

        session.conversationHistory.push({ role: 'assistant', content: aiResponse });

        return { message_utilisateur: aiResponse, config: { route: 'conversation' } };
    } catch (error) {
        console.error('Erreur:', error);
        return { message_utilisateur: `Je vous écoute. Que souhaitez-vous faire ?`, config: { route: 'conversation' } };
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

    // On retourne juste la route - pas de message texte, le frontend affichera le panel
    return {
        message_utilisateur: '',  // Pas de message
        config: { route: 'configuration', settings: session.config }
    };
}

async function handleGeneration(session, message) {
    console.log('🎬 Génération avec Claude Sonnet 4.5...');

    const analysis = session.property.analysis || {};
    const description = session.property.description || '';
    const tonConfig = TONS.find(t => t.id === session.config.ton) || TONS[0];
    const formatConfig = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];
    const city = extractCity(description);
    const loopEnabled = session.config.loop === true || session.config.type_video === 'loop';

    // Charger les documentations dynamiquement
    const formatDoc = loadFormatDoc(session.config.type_video || 'signature');
    const tonDoc = loadTonDoc(session.config.ton || 'prestige');

    console.log(`📋 Format: ${formatConfig.name} | Ton: ${tonConfig.name} | Loop: ${loopEnabled}`);

    const userInfo = session.additionalInfos?.length > 0 ? session.additionalInfos.join('\n') : 'Aucune';

    // Construire le contexte complet du bien
    const propertyInfo = `
Ville: ${city || '⚠️ NON PRÉCISÉE - Si le script mentionne une localisation, utilise UNIQUEMENT ce qui est fourni dans la description'}
Description complète: ${description}
Analyse photos: ${JSON.stringify(analysis, null, 2)}
Standing: ${analysis.standing || 'Luxe'}
`;

    // LOOP ENDING - uniquement le connecteur
    const loopEnding = loopEnabled
        ? `[SÉQUENCE FINALE - CONNECTEUR]
Texte : "...[connecteur seul: parce que / lorsque / là où]"
Visuel : Transition vers le premier plan

🔁 REBOUCLE → "[Connecteur capitalisé] [phrase d'ouverture]"

⚠️ La fin = UNIQUEMENT le connecteur (3-5 mots max). PAS de phrase complète.`
        : `[SÉQUENCE FINALE]
Texte : "[Phrase de clôture + prix si disponible]"
Visuel : Plan final sur le bien`;

    // RANDOM SEED pour forcer la variété (0-9)
    const randomSeed = Date.now() % 10;
    console.log(`🎲 SEED créativité: ${randomSeed}`);

    // Construire le prompt avec les documentations
    let prompt = `${SCRIPT_COMPLET_PROMPT}

═══════════════════════════════════════════════════════════════════
DOCUMENTATION FORMAT : ${formatConfig.name}
═══════════════════════════════════════════════════════════════════

${formatDoc}

═══════════════════════════════════════════════════════════════════
DOCUMENTATION TON : ${tonConfig.name}
═══════════════════════════════════════════════════════════════════

${tonDoc}

═══════════════════════════════════════════════════════════════════
CONTEXTE DE GÉNÉRATION
═══════════════════════════════════════════════════════════════════

🎲 SEED CRÉATIVITÉ: ${randomSeed} (utilise ce nombre pour varier tes choix)
📋 FORMAT: ${formatConfig.name} (${formatConfig.duration})
🎨 TON: ${tonConfig.name}
🔄 LOOP: ${loopEnabled ? 'OUI - Utilise le format LOOP avec connecteur final' : 'NON'}

INFORMATIONS DU BIEN:
${propertyInfo}

INFOS AJOUTÉES PAR L'AGENT:
${userInfo}

${loopEnabled ? LOOP_DEFINITION : ''}

STRUCTURE DE FIN:
${loopEnding}

═══════════════════════════════════════════════════════════════════
🎵 MUSIQUE - CHOISIS PARMI CETTE BANQUE
═══════════════════════════════════════════════════════════════════

CHOISIS UNE musique qui correspond VRAIMENT à l'ambiance du bien.
Utilise le SEED ${randomSeed} pour varier ton choix (ne choisis pas toujours la même).

BANQUE DE MUSIQUES (avec liens YouTube fonctionnels) :
- "Nuvole Bianche" - Ludovico Einaudi → https://www.youtube.com/watch?v=xyY4IZ3JDFE (élégante, contemplative)
- "Experience" - Ludovico Einaudi → https://www.youtube.com/watch?v=_VONMdDDPUQ (émouvante, cinéma)
- "River Flows in You" - Yiruma → https://www.youtube.com/watch?v=7maJOI3QMu0 (douce, romantique)
- "Time" - Hans Zimmer → https://www.youtube.com/watch?v=RxabLA7UQ9k (épique, immersive)
- "Comptine d'un autre été" - Yann Tiersen → https://www.youtube.com/watch?v=NvryolGa19A (poétique)
- "Sunset Lover" - Petit Biscuit → https://www.youtube.com/watch?v=wuCK-oiE3rM (moderne, aérienne)
- "Intro" - The xx → https://www.youtube.com/watch?v=xMV6l2y67rk (minimaliste, élégante)
- "Coastline" - Hollow Coves → https://www.youtube.com/watch?v=a3dMPc2w3sA (méditerranéenne)
- "On The Nature Of Daylight" - Max Richter → https://www.youtube.com/watch?v=rVN1B-tUpgs (profonde)
- "Arrival of the Birds" - The Cinematic Orchestra → https://www.youtube.com/watch?v=MqoANESQ4cQ (majestueuse)

⚠️ CHOISIS celle qui correspond le mieux au bien ET varie ton choix à chaque génération !
⚠️ UTILISE LE LIEN YOUTUBE EXACT de la musique choisie !
`;

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
    const lower = (message || '').toLowerCase().trim();

    // ===============================================
    // 0. NOUVEAUX MÉDIAS (IMAGES OU DOCUMENTS) → PRIORITÉ ABSOLUE
    // ===============================================
    const hasNewDocs = session.property.newDocumentUploaded;
    const hasNewImages = session.property.newImageUploaded;

    if (hasNewDocs || hasNewImages) {
        // Reset flags
        session.property.newDocumentUploaded = false;
        session.property.newImageUploaded = false;

        const docNames = session.property.documentsNames?.join(', ') || '';
        const docContent = session.property.documentsText || '';
        const imageUrls = session.property.imageUrls || [];
        const userIntent = message?.trim() || '';

        // Si nouvelles images, les analyser avec Vision
        if (hasNewImages && imageUrls.length > 0) {
            console.log('🔍 Analyse des nouvelles images post-génération...');

            try {
                // Analyser seulement les dernières images (max 3)
                const newImageUrls = imageUrls.slice(-3);
                const imageAnalysis = await visionService.analyzeProperty(newImageUrls, userIntent || 'Décris cette image');

                // Construire une réponse basée sur l'analyse
                const analysisContext = JSON.stringify(imageAnalysis, null, 2);

                const prompt = `Tu es Bonaparte IA. L'utilisateur vient d'envoyer ${newImageUrls.length} nouvelle(s) photo(s) et demande: "${userIntent || 'regarde cette image'}"

ANALYSE DES IMAGES:
${analysisContext}

SCRIPT ACTUEL:
${session.generatedScript?.substring(0, 800) || '(pas de script)'}

INSTRUCTIONS:
1. Décris ce que tu vois sur la/les photo(s) - sois précis et descriptif
2. Si l'utilisateur pose une question, réponds-y directement
3. Propose comment intégrer ces visuels dans le script si pertinent
4. Sois conversationnel et naturel (max 4-5 lignes)`;

                let response = await callClaude(prompt, 400);
                response = formatText(response);
                return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };

            } catch (error) {
                console.error('❌ Erreur analyse images:', error);
                // Fallback si erreur
                return {
                    message_utilisateur: `J'ai bien reçu les nouvelles images mais je n'ai pas pu les analyser. Peux-tu me décrire ce que tu veux que je voie ?`,
                    config: { route: 'post_generation', script_generated: true }
                };
            }
        }

        // Si seulement des documents
        if (hasNewDocs && docContent) {
            const prompt = `Tu es Bonaparte IA. L'utilisateur vient d'uploader un document après avoir généré un script.

NOUVEAU DOCUMENT: ${docNames}
CONTENU DU DOCUMENT:
${docContent.substring(0, 3000)}

MESSAGE DE L'UTILISATEUR: "${userIntent || '(aucun message)'}" 

SCRIPT ACTUEL:
${session.generatedScript?.substring(0, 1000) || '(pas de script)'}

INSTRUCTIONS:
1. Résume brièvement ce que contient le document (2-3 points clés)
2. Explique comment ces infos peuvent améliorer le script
3. Propose de régénérer le script en intégrant ces données
4. Sois concis (max 5-6 lignes)`;

            let response = await callClaude(prompt, 400);
            response = formatText(response);
            return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
        }
    }

    // ===============================================
    // 0.5 MESSAGE VIDE (sans nouveau média)
    // ===============================================
    if (!message || message.trim() === '') {
        return {
            message_utilisateur: '',
            config: { route: 'post_generation', script_generated: true }
        };
    }

    // ===============================================
    // 1. DÉSACTIVER LE LOOP
    // ===============================================
    if (lower.includes('pas de loop') || lower.includes('sans loop') || lower.includes('met pas') ||
        lower.includes('enlève le loop') || lower.includes('enleve le loop') || lower.includes('retire le loop')) {
        session.config.loop = false;
        session.config.type_video = 'signature'; // Passer en signature par défaut
        console.log('🔄 Loop désactivé, passage en format SIGNATURE');
        session.generatedScript = null;
        return handleGeneration(session, message);
    }

    // ===============================================
    // 2. COMMANDES EXPLICITES DE MODIFICATION
    // ===============================================
    const commands = {
        'raccourcir': 'Raccourcis le script. Maximum 4 phrases courtes.',
        'plus court': 'Raccourcis le script. Phrases plus courtes, moins de séquences.',
        'allonger': 'Allonge le script. Double le nombre de séquences.',
        'plus long': 'Allonge le script. Plus de détails sur le bien.',
        'nouvelle version': 'Génère une version complètement différente.',
        'nouveau script': 'Génère une version complètement différente.'
    };

    for (const [key, instruction] of Object.entries(commands)) {
        if (lower.includes(key)) return regenerate(session, instruction);
    }

    // ===============================================
    // 3. CHANGEMENT DE FORMAT EXPLICITE
    // ===============================================
    const formatMatch = lower.match(/format\s+(teaser|reel|signature|loop)/i);
    if (formatMatch || lower.includes('en format') || lower.includes('en teaser') ||
        lower.includes('en reel') || lower.includes('en signature') || lower.includes('en loop')) {
        const format = formatMatch ? formatMatch[1].toLowerCase() :
            lower.includes('teaser') ? 'teaser' :
                lower.includes('reel') ? 'reel' :
                    lower.includes('signature') ? 'signature' :
                        lower.includes('loop') ? 'loop' : null;

        if (format) {
            session.config.type_video = format;
            session.config.loop = (format === 'loop');
            console.log(`🎬 Changement de format vers: ${format}`);
            session.generatedScript = null;
            return handleGeneration(session, message);
        }
    }

    // ===============================================
    // 4. CHANGEMENT DE TON EXPLICITE
    // ===============================================
    const tonPatterns = [
        { pattern: /ton\s+(prestige|dynamique|original)/i, group: 1 },
        { pattern: /(prestige|dynamique|original)\s*$/i, group: 1 },
        { pattern: /en\s+(prestige|dynamique|original)/i, group: 1 },
        { pattern: /avec\s+le\s+ton\s+(prestige|dynamique|original)/i, group: 1 }
    ];

    for (const { pattern, group } of tonPatterns) {
        const match = lower.match(pattern);
        if (match) {
            const newTon = match[group].toLowerCase();
            session.config.ton = newTon;
            console.log(`🎨 Changement de ton vers: ${newTon}`);
            session.generatedScript = null;
            return handleGeneration(session, message);
        }
    }

    // ===============================================
    // 5. QUESTION SUR LE STYLE/FORMAT/TON UTILISÉ
    // ===============================================
    if (lower.includes('style') || lower.includes('c\'etait quoi') || lower.includes('c\'est quoi') ||
        lower.includes('quel format') || lower.includes('quel ton') || lower.includes('quoi le')) {
        const formatConfig = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];
        const tonConfig = TONS.find(t => t.id === session.config.ton) || TONS[0];
        const loopEnabled = session.config.loop === true || session.config.type_video === 'loop';

        return {
            message_utilisateur: `Le script actuel utilise :\n\n📹 **Format** : ${formatConfig.name} (${formatConfig.duration})\n🎨 **Ton** : ${tonConfig.name}\n🔄 **Loop** : ${loopEnabled ? 'OUI' : 'NON'}\n\nVous voulez changer quelque chose ?`,
            config: { route: 'post_generation', script_generated: true }
        };
    }

    // ===============================================
    // 6. FEEDBACK SUR LE HOOK → PROPOSER ALTERNATIVES
    // ===============================================
    if (lower.includes('hook') || lower.includes('ouverture') || lower.includes('début') || lower.includes('accroche')) {
        const prompt = `L'utilisateur veut modifier le hook d'ouverture du script.

Script actuel:
${session.generatedScript}

Message utilisateur: "${message}"

INSTRUCTIONS:
1. Propose 3 NOUVEAUX hooks d'ouverture différents (court, moyen, long)
2. Demande lequel il préfère
3. Sois bref et conversationnel

Format de réponse:
Je peux vous proposer ces alternatives :

- **Hook A** : "[court - 3-5 mots]"
- **Hook B** : "[moyen - 6-10 mots]"
- **Hook C** : "[long - phrase complète]"

Lequel vous préférez ?`;

        let response = await callClaude(prompt, 400);
        response = formatText(response);
        return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
    }

    // ===============================================
    // 7. FEEDBACK COURT → UTILISER CLAUDE POUR COMPRENDRE
    // ===============================================
    // Au lieu d'un menu générique, on laisse Claude interpréter directement
    if (message.length < 60) {
        const formatConfig = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];
        const tonConfig = TONS.find(t => t.id === session.config.ton) || TONS[0];

        const prompt = `Tu es Bonaparte IA. L'utilisateur a généré un script et donne maintenant un feedback court.

Script actuel (format ${formatConfig.name}, ton ${tonConfig.name}):
${session.generatedScript?.substring(0, 1500)}

Feedback utilisateur: "${message}"

INSTRUCTIONS STRICTES:
- Comprends le feedback même s'il est vague ("pas top", "bof", "trop long", "en rajoute trop", etc.)
- Si l'utilisateur dit "trop" de quelque chose → propose de réduire/simplifier
- Si l'utilisateur dit "pas assez" → propose d'enrichir
- Si c'est négatif sans précision → propose 2-3 axes d'amélioration concrets
- NE JAMAIS afficher un menu générique avec des tirets
- Réponds de façon conversationnelle, comme un humain
- Maximum 3-4 phrases
- Termine en proposant une action concrète`;

        let response = await callClaude(prompt, 350);
        response = formatText(response);
        return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
    }

    // ===============================================
    // 8. QUESTION SUR LA MUSIQUE
    // ===============================================
    if (lower.includes('musique') || lower.includes('pourquoi cette')) {
        const prompt = `L'utilisateur pose une question sur le script ou la musique.

Script actuel: ${session.generatedScript}

Question: "${message}"

Réponds en 2-3 phrases maximum. Explique ton choix de musique ou propose des alternatives si demandé.
Sois conversationnel et propose d'autres options si l'utilisateur n'est pas convaincu.
Exemples de musiques alternatives à proposer selon le style du bien.`;

        let response = await callClaude(prompt, 300);
        response = formatText(response);
        return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
    }

    // ===============================================
    // 9. QUESTION GÉNÉRALE → CONVERSATION
    // ===============================================
    if (lower.includes('?') || lower.includes('pourquoi') || lower.includes('tu penses') || lower.includes('tu en penses')) {
        const prompt = `L'utilisateur pose une question ou demande ton avis sur le script.

Script actuel: ${session.generatedScript}

Message: "${message}"

Réponds en 2-3 phrases. Sois conversationnel, donne ton avis, propose des idées.
Si l'utilisateur a une suggestion, dis ce que tu en penses et propose de l'intégrer.`;

        let response = await callClaude(prompt, 300);
        response = formatText(response);
        return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
    }

    // ===============================================
    // 10. FEEDBACK DÉTAILLÉ → INTÉGRER ET RÉGÉNÉRER
    // ===============================================
    if (message && message.length > 30) {
        return regenerate(session, `L'utilisateur a donné ce feedback: ${message}`);
    }

    // ===============================================
    // 11. MESSAGE COURT → UTILISER CLAUDE POUR COMPRENDRE
    // ===============================================
    const formatConfig = VIDEO_TYPES.find(t => t.id === session.config.type_video) || VIDEO_TYPES[3];
    const tonConfig = TONS.find(t => t.id === session.config.ton) || TONS[0];

    const prompt = `Tu es Bonaparte IA. L'utilisateur a généré un script et envoie maintenant ce message court.

Script actuel (format ${formatConfig.name}, ton ${tonConfig.name}):
${session.generatedScript}

Message utilisateur: "${message}"

INSTRUCTIONS:
- Comprends ce que l'utilisateur veut (même si c'est vague)
- Si c'est une demande de modification → propose de le faire
- Si c'est une question → réponds directement
- Si c'est incompréhensible → demande une clarification COURTE
- Maximum 2-3 phrases
- Sois direct et utile, pas de menu générique`;

    let response = await callClaude(prompt, 300);
    response = formatText(response);
    return { message_utilisateur: response, config: { route: 'post_generation', script_generated: true } };
}

function extractCity(description) {
    const cities = ['Saint-Gély-du-Fesc', 'Montpellier', 'Mougins', 'Cannes', 'Nice', 'Monaco', 'Paris', 'Lyon', 'Sainte-Maxime', 'Belle-Île', 'Belle-Ile', 'Marseille', 'Bordeaux', 'Toulouse', 'Nantes', 'Biarritz', 'Saint-Tropez', 'Cap Ferret', 'Arcachon', 'La Baule', 'Deauville', 'Megève', 'Courchevel', 'Chamonix'];
    for (const city of cities) {
        if (description.toLowerCase().includes(city.toLowerCase())) return city;
    }
    return null; // Ne pas inventer de localisation - l'IA demandera
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
    const propertyContext = session.property?.analysis?.fullSummary ||
        session.property?.description ||
        '';

    // Inclure les infos ajoutées par l'utilisateur (dont la localisation!)
    const userInfo = session.additionalInfos?.length > 0 ? session.additionalInfos.join('\n') : '';

    const format = VIDEO_TYPES.find(f => f.id === session.config?.type_video) || VIDEO_TYPES[2];
    const ton = TONS.find(t => t.id === session.config?.ton) || TONS[0];
    const loopEnabled = session.config?.loop || false;

    const prompt = `Tu es Bonaparte IA, expert en scripts vidéo immobilier pour Instagram.

CONTEXTE DU BIEN :
${propertyContext}

INFORMATIONS AJOUTÉES PAR L'UTILISATEUR (TRÈS IMPORTANT) :
${userInfo || 'Aucune information supplémentaire'}

FORMAT: ${format.name} (${format.duration}) | TON: ${ton.name} | LOOP: ${loopEnabled ? 'OUI' : 'NON'}

SCRIPT ACTUEL :
${session.generatedScript}

MODIFICATION DEMANDÉE :
${instruction}

═══════════════════════════════════════════════════════════════════
⚠️ RÈGLES ANTI-HALLUCINATION - TRÈS IMPORTANT
═══════════════════════════════════════════════════════════════════

❌ N'INVENTE JAMAIS :
- Une ville/région/localisation non mentionnée par l'utilisateur
- Une surface non fournie  
- Un prix non fourni
- Des caractéristiques non visibles ou non mentionnées

✅ UTILISE UNIQUEMENT les informations fournies dans :
1. Le contexte du bien
2. Les informations ajoutées par l'utilisateur (ci-dessus)
3. Le script actuel

Si une localisation est mentionnée dans "INFORMATIONS AJOUTÉES", UTILISE-LA !

═══════════════════════════════════════════════════════════════════
⚠️ FORMAT OBLIGATOIRE - NE PAS CHANGER LA STRUCTURE
═══════════════════════════════════════════════════════════════════

Tu DOIS utiliser EXACTEMENT cette structure pour CHAQUE séquence :

[SÉQUENCE X]
Texte : "[la phrase]"
Visuel : [indication de plan]

**MUSIQUE SUGGÉRÉE :**
🎵 "[Titre exact]" - [Artiste]

Génère le script modifié :`;

    let script = await callClaude(prompt, 4000);
    script = formatText(script);
    session.generatedScript = script;
    return { message_utilisateur: script, config: { route: 'script_genere', script_generated: true } };
}

function getScriptForExport(session) {
    return { script: session.generatedScript || '', config: session.config, generatedAt: session.generatedAt };
}

module.exports = { processMessage, determinePhase, getScriptForExport };
