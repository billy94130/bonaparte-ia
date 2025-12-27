/**
 * BONAPARTE IA - Backend API
 * Version restaurée
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Services
const cloudinaryService = require('./services/cloudinary');
const visionService = require('./services/vision');
const agentService = require('./services/agent');
const documentParser = require('./services/document-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir les fichiers statiques
app.use(express.static(__dirname));

// Route principale - servir le chatbot
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chatbot-bonaparte-v2.html'));
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// =====================================================
// STOCKAGE DES SESSIONS EN MÉMOIRE
// =====================================================
const sessions = new Map();

function getOrCreateSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            id: sessionId,
            createdAt: new Date(),
            property: {
                description: '',
                imageUrls: [],
                analysis: null
            },
            config: {
                ton: 'chaleureux',
                type_video: 'signature',
                loop: false
            },
            messages: [],
            additionalInfos: [],
            conversationHistory: [],
            conversationCount: 0
        });
    }
    return sessions.get(sessionId);
}

// Nettoyer les sessions de plus de 24h
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.createdAt.getTime() > 24 * 60 * 60 * 1000) {
            sessions.delete(id);
            console.log(`🗑️ Session ${id} expirée`);
        }
    }
}, 60 * 60 * 1000);

// =====================================================
// ROUTES API
// =====================================================

/**
 * POST /api/session/create
 */
app.post('/api/session/create', (req, res) => {
    const sessionId = uuidv4();
    const session = getOrCreateSession(sessionId);

    console.log(`✨ Nouvelle session: ${sessionId}`);

    res.json({
        success: true,
        session_id: sessionId,
        message: "Session créée"
    });
});

/**
 * POST /api/bien/upload
 */
app.post('/api/bien/upload', upload.array('images', 15), async (req, res) => {
    try {
        const { session_id } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'session_id requis' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Aucune image fournie' });
        }

        const session = getOrCreateSession(session_id);

        console.log(`📷 Upload de ${req.files.length} images`);

        const uploadResults = await cloudinaryService.uploadMultiple(req.files);
        const newUrls = uploadResults.map(r => r.url);

        // Ajouter les nouvelles images aux existantes (au lieu de remplacer)
        const existingUrls = session.property.imageUrls || [];
        session.property.imageUrls = [...existingUrls, ...newUrls];

        // Flag pour signaler de nouvelles images APRÈS l'analyse initiale
        // (peu importe si le script a été généré ou non)
        if (session.photoSummaryDone) {
            session.property.newImageUploaded = true;
            session.property.newImageCount = newUrls.length;
            console.log(`📌 Flag newImageUploaded activé (${newUrls.length} nouvelles images après analyse)`);
        }

        console.log(`✅ ${uploadResults.length} images uploadées (total: ${session.property.imageUrls.length})`);

        res.json({
            success: true,
            session_id,
            images_count: uploadResults.length,
            total_images: session.property.imageUrls.length,
            urls: session.property.imageUrls
        });

    } catch (error) {
        console.error('❌ Erreur upload:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/bien/documents - Upload et parse des documents (PDF, TXT, DOC)
 */
app.post('/api/bien/documents', upload.array('documents', 10), async (req, res) => {
    try {
        const { session_id } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'session_id requis' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Aucun document fourni' });
        }

        const session = getOrCreateSession(session_id);

        console.log(`📄 Upload de ${req.files.length} documents`);

        // Parse all documents and extract text
        const documentsText = await documentParser.parseDocuments(req.files);

        // Store in session
        session.property.documentsText = documentsText;
        session.property.documentsCount = req.files.length;
        session.property.documentsNames = req.files.map(f => f.originalname);

        // Flag pour signaler de nouveaux documents APRÈS l'analyse initiale
        // (peu importe si le script a été généré ou non)
        if (session.photoSummaryDone) {
            session.property.newDocumentUploaded = true;
            console.log(`📌 Flag newDocumentUploaded activé (après analyse)`);
        }

        console.log(`✅ ${req.files.length} documents parsés (${documentsText.length} caractères extraits)`);

        res.json({
            success: true,
            session_id,
            documents_count: req.files.length,
            documents_names: session.property.documentsNames,
            text_length: documentsText.length
        });

    } catch (error) {
        console.error('❌ Erreur documents:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/bien/analyze
 */
app.post('/api/bien/analyze', async (req, res) => {
    try {
        const { session_id, description } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'session_id requis' });
        }

        const session = getOrCreateSession(session_id);

        // Combine user description + parsed documents text
        const documentsText = session.property.documentsText || '';
        const fullDescription = (description || '') + documentsText;

        session.property.description = fullDescription;
        console.log(`📝 Description totale: ${fullDescription.length} caractères`);

        // If we have images, do vision analysis
        if (session.property.imageUrls.length > 0) {
            console.log(`🔍 Analyse Vision de ${session.property.imageUrls.length} images...`);

            const analysis = await visionService.analyzeProperty(
                session.property.imageUrls,
                fullDescription
            );

            session.property.analysis = analysis;
            console.log(`✅ Analyse terminée`);

            res.json({
                success: true,
                session_id,
                analysis,
                message: "Bien analysé avec succès"
            });
        } else {
            // No images - just documents/text
            console.log(`📄 Analyse texte uniquement (pas d'images)`);

            // Create a basic analysis from description
            session.property.analysis = {
                pieces_identifiees: [],
                materiaux: [],
                standing: 'luxe',
                points_forts: [],
                ambiance: 'non analysée (pas de photos)'
            };

            res.json({
                success: true,
                session_id,
                analysis: session.property.analysis,
                message: "Description enregistrée (pas de photos à analyser)"
            });
        }

    } catch (error) {
        console.error('❌ Erreur analyse:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
    try {
        const { session_id, message } = req.body;

        console.log(`💬 Chat reçu - session: ${session_id}, message: ${message?.substring(0, 50)}...`);

        if (!session_id) {
            return res.status(400).json({ error: 'session_id requis' });
        }

        const session = getOrCreateSession(session_id);

        session.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        console.log('🔄 Appel agentService.processMessage...');
        const result = await agentService.processMessage(session, message);
        console.log('✅ Résultat agent:', result?.message_utilisateur?.substring(0, 100));

        session.messages.push({
            role: 'assistant',
            content: result.message_utilisateur,
            timestamp: new Date()
        });

        res.json({
            success: true,
            session_id,
            message: result.message_utilisateur,
            config: result.config
        });

    } catch (error) {
        console.error('❌ Erreur chat:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/config
 */
app.post('/api/config', (req, res) => {
    try {
        const { session_id, ton, type_video, loop } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'session_id requis' });
        }

        const session = getOrCreateSession(session_id);

        if (ton) session.config.ton = ton;
        if (type_video) session.config.type_video = type_video;
        if (typeof loop === 'boolean') session.config.loop = loop;

        session.pendingConfig = { ...session.config };

        console.log(`⚙️ Config mise à jour:`, session.config);

        res.json({
            success: true,
            session_id,
            config: session.config
        });

    } catch (error) {
        console.error('❌ Erreur config:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/session/:id
 */
app.get('/api/session/:id', (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
        return res.status(404).json({ error: 'Session non trouvée' });
    }

    res.json({
        success: true,
        session: {
            id: session.id,
            createdAt: session.createdAt,
            hasImages: session.property.imageUrls.length > 0,
            hasAnalysis: !!session.property.analysis,
            hasScript: !!session.generatedScript,
            config: session.config
        }
    });
});

/**
 * GET /api/export/script/:id
 */
app.get('/api/export/script/:id', (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
        return res.status(404).json({ error: 'Session non trouvée' });
    }

    const exportData = agentService.getScriptForExport(session);

    res.json({
        success: true,
        ...exportData
    });
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =====================================================
// DÉMARRAGE
// =====================================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏛️  BONAPARTE IA - Backend API                               ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                              ║
║                                                                ║
║   ✅ Serveur démarré sur http://localhost:${PORT}                ║
║   ✅ Cloudinary configuré                                       ║
║   ✅ Claude Sonnet 4.5 prêt                                     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
});
