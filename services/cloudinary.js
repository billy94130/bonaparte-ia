/**
 * BONAPARTE IA - Service Cloudinary
 * Upload et gestion des images immobilières
 */

const cloudinary = require('cloudinary').v2;

// Configuration Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload une seule image vers Cloudinary
 * @param {Buffer} buffer - Le buffer de l'image
 * @param {string} filename - Nom du fichier original
 * @returns {Promise<{url: string, publicId: string}>}
 */
async function uploadSingle(buffer, filename) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'bonaparte-ia',
                resource_type: 'image',
                transformation: [
                    { width: 1024, height: 1024, crop: 'limit' }, // Max 1024px
                    { quality: 'auto:good' }, // Qualité optimisée
                    { fetch_format: 'auto' } // Format optimal (WebP si supporté)
                ]
            },
            (error, result) => {
                if (error) {
                    console.error(`❌ Erreur upload ${filename}:`, error);
                    reject(error);
                } else {
                    console.log(`✅ Image uploadée: ${result.public_id}`);
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        width: result.width,
                        height: result.height
                    });
                }
            }
        );

        uploadStream.end(buffer);
    });
}

/**
 * Upload plusieurs images vers Cloudinary
 * @param {Array<{buffer: Buffer, originalname: string}>} files - Fichiers multer
 * @returns {Promise<Array<{url: string, publicId: string}>>}
 */
async function uploadMultiple(files) {
    console.log(`📤 Upload de ${files.length} images vers Cloudinary...`);

    const uploadPromises = files.map((file, index) => {
        return uploadSingle(file.buffer, file.originalname || `image_${index}`);
    });

    const results = await Promise.all(uploadPromises);

    console.log(`✅ ${results.length} images uploadées avec succès`);

    return results;
}

/**
 * Supprimer une image de Cloudinary
 * @param {string} publicId - L'ID public de l'image
 */
async function deleteImage(publicId) {
    try {
        await cloudinary.uploader.destroy(publicId);
        console.log(`🗑️ Image supprimée: ${publicId}`);
    } catch (error) {
        console.error(`❌ Erreur suppression ${publicId}:`, error);
    }
}

/**
 * Obtenir une URL optimisée pour l'analyse Vision
 * (Réduit la taille pour économiser les tokens)
 * @param {string} url - URL originale
 * @returns {string} - URL optimisée
 */
function getVisionOptimizedUrl(url) {
    // Transformer l'URL pour avoir une version plus petite pour Vision
    // Cloudinary permet les transformations via l'URL
    return url.replace('/upload/', '/upload/w_800,h_800,c_limit,q_80/');
}

module.exports = {
    uploadSingle,
    uploadMultiple,
    deleteImage,
    getVisionOptimizedUrl,
    cloudinary
};
