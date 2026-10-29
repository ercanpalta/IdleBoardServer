const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cfg = require('../config');
const activity = require('../services/activity');
const auth = require('../services/auth');
const media = require('../services/media');
const playlist = require('../services/playlist');
const slideshow = require('../services/slideshow');
const state = require('../state');

const router = express.Router();

// Küçük Önizleme (Thumbnail) Servisi
router.get('/thumbnails/:name', async (req, res) => {
    const fileName = req.params.name;
    if (path.basename(fileName) !== fileName || !media.isSupportedMedia(fileName)) {
        return res.status(400).send('Geçersiz dosya');
    }

    const origPath = path.join(cfg.IMAGES_DIR, fileName);
    if (!fs.existsSync(origPath)) {
        return res.status(404).send('Medya bulunamadı');
    }

    if (media.isVideoFile(fileName)) {
        // Gerçek video kapak görseli varsa JPEG olarak döndür
        const coverCandidates = [
            path.join(cfg.THUMBNAILS_DIR, fileName + '.jpg'),
            path.join(cfg.THUMBNAILS_DIR, fileName.replace(/\.mp4$/i, '.jpg')),
            path.join(cfg.THUMBNAILS_DIR, fileName)
        ];
        for (const candidate of coverCandidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.sendFile(candidate);
            }
        }

        // Kapak görseli henüz oluşturulmadıysa SVG şablonuna düş
        const meta = state.mediaMetadata[fileName];
        const durSec = meta && meta.duration ? Math.round(meta.duration) : null;
        const durText = durSec ? `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}` : 'MP4';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <circle cx="160" cy="80" r="30" fill="#2563eb" fill-opacity="0.9"/>
  <polygon points="153,68 173,80 153,92" fill="#ffffff"/>
  <rect x="110" y="128" width="100" height="26" rx="13" fill="#020617" stroke="#334155"/>
  <text x="160" y="145" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" text-anchor="middle">▶ ${durText}</text>
</svg>`.trim();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=10');
        return res.send(svg);
    }

    const thumbPath = path.join(cfg.THUMBNAILS_DIR, fileName);
    if (fs.existsSync(thumbPath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(thumbPath);
    }

    try {
        await media.generateThumbnail(fileName);
        if (fs.existsSync(thumbPath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(thumbPath);
        }
    } catch (err) {
        console.error(`[!] Thumbnail servisi hatası (${fileName}):`, err.message);
    }
    res.sendFile(origPath);
});

// 2. Yeni Resim Yükle (100MB sınır, Magic Bytes doğrulaması, sıfır ağır işlemci yükü)
router.post('/api/upload', auth.requireAuth, (req, res) => {
    media.upload.single('image')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'Dosya boyutu 100 MB sınırını aşıyor.'
                });
            }
            if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({
                    success: false,
                    error: 'Yalnızca JPG, JPEG, PNG ve WebP formatında görseller yüklenebilir.'
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Yükleme hatası: ' + err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Yüklenecek görsel bulunamadı.'
            });
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const expectedType = media.supportedMediaTypes[ext];
        if (!expectedType) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({ success: false, error: 'Desteklenmeyen dosya uzantısı.' });
        }

        // 1. Magic Bytes (Dosya İmzası) Doğrulaması (< 0.1ms, sıfır CPU/RAM yükü)
        const isValidMagic = media.verifyImageMagicBytes(req.file.path, expectedType.format);
        if (!isValidMagic) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({
                success: false,
                error: 'Dosya içeriği geçersiz veya sahte. Dosya başlık imzası medya türüyle uyuşmuyor.'
            });
        }

        if (expectedType.isVideo) {
            // Video Süre Kontrolü (Maksimum 60 Saniye - doğrudan sunucu MP4 atom ayrıştırıcı ile)
            let duration = media.parseMp4Duration(req.file.path);
            if (!duration || isNaN(duration) || duration <= 0) {
                // İstemci süresi güvenilmez: yalnızca makul bir bit hızıyla (<= 12.5 MB/sn) uyumluysa kabul edilir
                const claimed = parseFloat(req.body && req.body.duration);
                if (claimed > 0 && Number.isFinite(claimed) && req.file.size / claimed <= 12.5 * 1024 * 1024) {
                    duration = claimed;
                }
            }

            if (!duration || isNaN(duration) || duration <= 0) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
                return res.status(400).json({
                    success: false,
                    error: 'Video süresi okunamadı. Dosya geçerli bir MP4 olmalıdır.'
                });
            }

            if (duration > media.MAX_VIDEO_DURATION_SEC) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
                return res.status(400).json({
                    success: false,
                    error: `Video süresi maksimum ${media.MAX_VIDEO_DURATION_SEC} saniye olabilir. (Yüklenen video: ${Math.round(duration)} sn)`
                });
            }

            const finalDuration = Math.round(duration * 100) / 100;
            state.mediaMetadata[req.file.filename] = {
                duration: finalDuration,
                isVideo: true,
                size: req.file.size,
                uploadedAt: new Date().toISOString()
            };
            media.saveMediaMetadata();
        } else {
            // Görsel Başlık ve Boyut Doğrulaması (Sharp metadata)
            let metadata;
            try {
                metadata = await sharp(req.file.path).metadata();
            } catch (error) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
                return res.status(400).json({ success: false, error: 'Görsel başlık bilgisi okunamadı veya dosya bozuk.' });
            }

            if (!metadata || metadata.format !== expectedType.format) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
                return res.status(400).json({ success: false, error: 'Dosya uzantısı ile görsel formatı eşleşmiyor.' });
            }

            // Decompression bomb (Piksel taşması) koruması: Maksimum 64 Megapiksel
            if (metadata.width && metadata.height && (metadata.width * metadata.height > 64000000)) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
                return res.status(400).json({
                    success: false,
                    error: 'Görsel çözünürlüğü aşırı yüksek (maksimum 64 megapiksel).'
                });
            }
        }

        // Orijinal dosya olduğu gibi korunur (ağır yeniden sıkıştırma yapılmaz, sistem yorulmaz)
        // Arka planda küçük önizleme (thumbnail) oluşturulur
        media.generateThumbnail(req.file.filename).catch(() => {});
        activity.logActivity('upload', 'Yeni görsel yüklendi', req.file.originalname || req.file.filename);
        res.json({ success: true, fileName: req.file.filename });
    });
});

// Video Kapak Görseli (Thumbnail / Poster) Kaydetme API'si
router.post('/api/media/cover/:name', auth.requireAuth, express.raw({ type: ['image/jpeg', 'image/png'], limit: '10mb' }), (req, res) => {
    const fileName = req.params.name;
    if (path.basename(fileName) !== fileName || !media.isVideoFile(fileName)) {
        return res.status(400).json({ success: false, error: 'Geçersiz video dosyası.' });
    }
    const origPath = path.join(cfg.IMAGES_DIR, fileName);
    if (!fs.existsSync(origPath)) {
        return res.status(404).json({ success: false, error: 'Video dosyası bulunamadı.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: 'Kapak görsel verisi boş veya desteklenmeyen biçimde (JPEG/PNG gerekli).' });
    }
    const isJpeg = req.body[0] === 0xFF && req.body[1] === 0xD8 && req.body[2] === 0xFF;
    const isPng = req.body.length > 8 && req.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    if (!isJpeg && !isPng) {
        return res.status(400).json({ success: false, error: 'Kapak görseli geçerli bir JPEG veya PNG değil.' });
    }

    try {
        const targetPath = path.join(cfg.THUMBNAILS_DIR, fileName + '.jpg');
        fs.writeFileSync(targetPath, req.body);
        return res.json({ success: true, fileName: fileName + '.jpg' });
    } catch (e) {
        return res.status(500).json({ success: false, error: 'Kapak görseli kaydedilemedi.' });
    }
});

// 3. Resim Sil
router.delete('/api/images/:name', auth.requireAuth, (req, res) => {
    if (path.basename(req.params.name) !== req.params.name || !media.isSupportedImage(req.params.name)) {
        return res.status(400).json({ error: 'Görsel adı geçersiz.' });
    }
    const filePath = path.join(cfg.IMAGES_DIR, req.params.name);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        const thumbPath = path.join(cfg.THUMBNAILS_DIR, req.params.name);
        const thumbJpg = path.join(cfg.THUMBNAILS_DIR, req.params.name + '.jpg');
        if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) {}
        }
        if (fs.existsSync(thumbJpg)) {
            try { fs.unlinkSync(thumbJpg); } catch (e) {}
        }
        if (state.mediaMetadata[req.params.name]) {
            delete state.mediaMetadata[req.params.name];
            try { media.saveMediaMetadata(); } catch (e) {}
        }
        if (state.selectedImageFiles.has(req.params.name)) {
            playlist.saveSelectedImages([...state.selectedImageFiles].filter(fileName => fileName !== req.params.name));
        }
        activity.logActivity('delete', 'Görsel silindi', req.params.name);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Dosya bulunamadı" });
});

// 4. Web Panelinden Manuel Tetikleme (Seçilen Resmi Anında Ekrana Bas)
router.post('/api/broadcast/:name', auth.requireAuth, (req, res) => {
    if (!state.selectedImageFiles.has(req.params.name)) {
        return res.status(400).json({ success: false, error: 'Yalnızca seçili görseller yayınlanabilir.' });
    }
    slideshow.broadcastImage(req.params.name);
    slideshow.restartSlideshowTimer();
    activity.logActivity('stream', 'Görsel anlık olarak yayınlandı', req.params.name);
    res.json({ success: true });
});

module.exports = router;
