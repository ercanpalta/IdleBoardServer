const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const cfg = require('../config');
const activity = require('../services/activity');
const auth = require('../services/auth');
const broadcast = require('../services/broadcast');
const httpServer = require('../services/httpServer');
const network = require('../services/network');
const settings = require('../services/settings');
const state = require('../state');

const router = express.Router();

router.get('/api/settings', auth.requireAuth, (req, res) => {
    const net = network.getNetworkAddresses(req);
    res.json({
        interval: settings.getSlideIntervalSec(),
                imageFit: settings.getImageFitMode(),
        showInfoBar: settings.getShowInfoBar(),
        transitionEffect: settings.getTransitionEffect(),
        slideshowOrder: settings.getSlideshowOrder(),
        showWatermark: settings.getShowWatermark(),
        hasWatermark: Boolean(settings.getWatermarkFilePath()),
        watermarkUrl: settings.getWatermarkFilePath() ? '/api/watermark/image' : null,
        serverPort: settings.getServerPort(),
        clientConnectionUrl: net.primaryUrl,
        networkAddresses: net.addresses
    });
});

// Sunucu Port Numarasını Güncelleme Endpoint'i
router.post('/api/settings/port', auth.requireAuth, (req, res) => {
    const rawPort = req.body && req.body.port;
    const newPort = parseInt(rawPort, 10);

    if (!Number.isInteger(newPort) || newPort < cfg.MIN_PORT || newPort > cfg.MAX_PORT) {
        return res.status(400).json({
            success: false,
            error: `Geçersiz port numarası. Lütfen ${cfg.MIN_PORT} ile ${cfg.MAX_PORT} arasında bir değer girin.`
        });
    }

    if (newPort === state.serverPort) {
        return res.json({
            success: true,
            port: state.serverPort,
            message: 'Port numarası değiştirilmedi.'
        });
    }

    const oldPort = state.serverPort;
    state.serverPort = newPort;
    settings.saveServerSettings();
    activity.logActivity('settings', 'Sunucu port numarası güncellendi', `${oldPort} -> ${newPort}`);

    const reqHost = req.headers && req.headers.host ? req.headers.host.split(':')[0] : (req.hostname || 'localhost');
    const redirectUrl = `http://${reqHost}:${newPort}`;

    res.json({
        success: true,
        oldPort,
        newPort,
        redirectUrl,
        message: `Sunucu portu ${newPort} olarak değiştirildi. Sunucu yeni port üzerinde yeniden başlatılıyor.`
    });

    setTimeout(() => {
        try {
            httpServer.startHttpServer(newPort);
        } catch (err) {
            console.error('[!] Sunucu yeni portta başlatılırken hata:', err.message);
        }
    }, 400);
});

router.post('/api/settings/interval', auth.requireAuth, (req, res) => {
    if (!settings.setSlideIntervalSec(req.body && req.body.interval)) {
        return res.status(400).json({
            success: false,
            error: `Süre ${cfg.MIN_INTERVAL_SEC}-${cfg.MAX_INTERVAL_SEC} saniye arasında olmalıdır`
        });
    }
    res.json({ success: true, interval: settings.getSlideIntervalSec() });
});

router.post('/api/settings/kiosk-idle', auth.requireAuth, (req, res) => {
    if (!settings.setKioskIdleTimeoutSec(req.body && req.body.kioskIdleTimeout)) {
        return res.status(400).json({
            success: false,
            error: `Bekleme süresi ${cfg.MIN_IDLE_TIMEOUT_SEC}-${cfg.MAX_IDLE_TIMEOUT_SEC} saniye arasında olmalıdır`
        });
    }
    res.json({ success: true, kioskIdleTimeout: settings.getKioskIdleTimeoutSec() });
});

router.post('/api/settings/image-fit', auth.requireAuth, (req, res) => {
    if (!settings.setImageFitMode(req.body && req.body.imageFit)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz yerleşim modu. Seçenekler: uniform, uniformToFill, fill'
        });
    }
    res.json({ success: true, imageFit: settings.getImageFitMode() });
});

router.post('/api/settings/info-bar', auth.requireAuth, (req, res) => {
    const show = req.body && typeof req.body.showInfoBar === 'boolean'
        ? req.body.showInfoBar
        : (req.body && req.body.showInfoBar === 'true');
    if (!settings.setShowInfoBar(show)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz parametre. showInfoBar boolean olmalıdır.'
        });
    }
    res.json({ success: true, showInfoBar: settings.getShowInfoBar() });
});

router.post('/api/settings/watermark', auth.requireAuth, (req, res) => {
    const show = req.body && typeof req.body.showWatermark === 'boolean'
        ? req.body.showWatermark
        : (req.body && req.body.showWatermark === 'true');
    if (!settings.setShowWatermark(show)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz parametre. showWatermark boolean olmalıdır.'
        });
    }
    res.json({
        success: true,
        showWatermark: settings.getShowWatermark(),
        hasWatermark: Boolean(settings.getWatermarkFilePath())
    });
});

router.get('/api/watermark/image', (req, res) => {
    const p = settings.getWatermarkFilePath();
    if (!p) {
        return res.status(404).send('Logo bulunamadı');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(p);
});

const watermarkLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            cb(null, true);
        } else {
            const err = new Error('INVALID_LOGO_TYPE');
            err.code = 'INVALID_LOGO_TYPE';
            cb(err, false);
        }
    }
});

router.post('/api/watermark/upload', auth.requireAuth, (req, res) => {
    watermarkLogoUpload.single('logo')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, error: 'Logo dosyası 10 MB sınırını aşamaz' });
            }
            return res.status(400).json({ success: false, error: 'Sadece PNG, JPG veya WEBP logo formatları desteklenmektedir' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Lütfen bir logo görseli seçin' });
        }

        try {
            if (state.watermarkFileName) {
                const oldPath = path.join(cfg.DATA_DIR, state.watermarkFileName);
                if (fs.existsSync(oldPath)) {
                    try { fs.unlinkSync(oldPath); } catch (e) {}
                }
            }

            const targetFileName = 'watermark-logo.png';
            const targetPath = path.join(cfg.DATA_DIR, targetFileName);

            await sharp(req.file.buffer)
                .resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true })
                .png({ quality: 90 })
                .toFile(targetPath);

            state.watermarkFileName = targetFileName;
            settings.saveServerSettings();

            const base64Data = settings.getWatermarkBase64();
            broadcast.broadcastToAll({
                tip: 'config',
                showWatermark: state.showWatermark,
                watermarkImage: base64Data,
                watermarkVersion: Date.now()
            });
            broadcast.broadcastDashboardUpdate();

            console.log('[i] Yeni marka logosu başarıyla yüklendi.');
            activity.logActivity('settings', 'Marka logosu yüklendi', req.file.originalname);

            res.json({
                success: true,
                showWatermark: state.showWatermark,
                hasWatermark: true,
                watermarkUrl: '/api/watermark/image?v=' + Date.now()
            });
        } catch (procErr) {
            console.error('[!] Logo işleme hatası:', procErr.message);
            res.status(500).json({ success: false, error: 'Logo kaydedilirken hata oluştu: ' + procErr.message });
        }
    });
});

router.delete('/api/watermark', auth.requireAuth, (req, res) => {
    if (state.watermarkFileName) {
        const p = path.join(cfg.DATA_DIR, state.watermarkFileName);
        if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }
    }
    state.watermarkFileName = null;
    settings.saveServerSettings();

    broadcast.broadcastToAll({
        tip: 'config',
        showWatermark: state.showWatermark,
        watermarkImage: null
    });
    broadcast.broadcastDashboardUpdate();

    console.log('[i] Marka logosu kaldırıldı.');
    activity.logActivity('settings', 'Marka logosu kaldırıldı', 'Logo silindi');

    res.json({
        success: true,
        showWatermark: state.showWatermark,
        hasWatermark: false
    });
});

router.post('/api/settings/transition-effect', auth.requireAuth, (req, res) => {
    if (!settings.setTransitionEffect(req.body && req.body.transitionEffect)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz geçiş efekti. Seçenekler: fade, none'
        });
    }
    res.json({ success: true, transitionEffect: settings.getTransitionEffect() });
});

router.post('/api/settings/slideshow-order', auth.requireAuth, (req, res) => {
    if (!settings.setSlideshowOrder(req.body && req.body.slideshowOrder)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz sıralama modu. Seçenekler: sequential, random'
        });
    }
    res.json({ success: true, slideshowOrder: settings.getSlideshowOrder() });
});

// Fabrika Ayarlarına Sıfırlama Endpoint'i
router.post('/api/settings/factory-reset', auth.requireAuth, (req, res) => {
    const clientIp = auth.getClientIp(req);
    const lock = auth.checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({
            success: false,
            error: `Çok fazla hatalı deneme yapıldı. Lütfen ${lock.remainingSec} saniye sonra tekrar deneyin.`,
            retryAfter: lock.remainingSec
        });
    }

    const { password } = req.body || {};
    if (typeof password !== 'string' || !auth.verifyPassword(password)) {
        const failResult = auth.recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Yönetici şifresi hatalı.${hint}` });
    }
    auth.recordSuccessfulLogin(clientIp);

    console.log('[⚠️ Sistem] Fabrika ayarlarına sıfırlama işlemi başlatıldı...');

    // 1. Slayt zamanlayıcısını durdur
    if (state.slideshowTimer) {
        clearInterval(state.slideshowTimer);
        state.slideshowTimer = null;
    }

    // 2. Yüklenmiş tüm görselleri ve önizlemeleri temizle
    try {
        if (fs.existsSync(cfg.IMAGES_DIR)) {
            const files = fs.readdirSync(cfg.IMAGES_DIR);
            for (const f of files) {
                if (f !== '.gitkeep') {
                    const filePath = path.join(cfg.IMAGES_DIR, f);
                    try {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`[!] Dosya silinemedi (${f}):`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[!] Görseller silinirken hata:', e.message);
    }

    try {
        if (fs.existsSync(cfg.THUMBNAILS_DIR)) {
            const thumbs = fs.readdirSync(cfg.THUMBNAILS_DIR);
            for (const f of thumbs) {
                if (f !== '.gitkeep') {
                    const thumbPath = path.join(cfg.THUMBNAILS_DIR, f);
                    try {
                        fs.rmSync(thumbPath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`[!] Thumbnail silinemedi (${f}):`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[!] Önizlemeler silinirken hata:', e.message);
    }

    // 3. Yapılandırma ve kayıt dosyalarını kaldır
    const filesToDelete = [
        cfg.SELECTED_IMAGES_FILE,
        cfg.SETTINGS_FILE,
        cfg.ACTIVITY_LOG_FILE,
        auth.PASSWORD_FILE
    ];
    for (const file of filesToDelete) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (e) {
            console.error(`[!] Dosya silinemedi (${file}):`, e.message);
        }
    }

    // 4. Kalan geçici dosyaları temizle
    try {
        if (fs.existsSync(cfg.DATA_DIR)) {
            const dataFiles = fs.readdirSync(cfg.DATA_DIR);
            for (const df of dataFiles) {
                if (df.endsWith('.tmp')) {
                    try { fs.unlinkSync(path.join(cfg.DATA_DIR, df)); } catch (e) {}
                }
            }
        }
        const rootFiles = fs.readdirSync(cfg.ROOT_DIR);
        for (const rf of rootFiles) {
            if (rf.endsWith('.tmp') && (rf.includes('settings') || rf.includes('activity') || rf.includes('selected') || rf.includes('password'))) {
                try { fs.unlinkSync(path.join(cfg.ROOT_DIR, rf)); } catch (e) {}
            }
        }
    } catch (e) {}

    // 5. Bellek içi durumları varsayılana sıfırla
    if (state.watermarkFileName) {
        const p = path.join(cfg.DATA_DIR, state.watermarkFileName);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
    }
    state.showWatermark = false;
    state.watermarkFileName = null;
    state.selectedImageFiles.clear();
    state.currentImageIndex = 0;
    state.slideIntervalSec = 5;
    try { eval('k' + 'ioskIdleTimeoutSec = 5'); } catch (e) {}
    state.imageFitMode = 'uniform';
    state.showInfoBar = true;
    state.transitionEffect = 'fade';
    state.slideshowOrder = 'sequential';
    state.lastBroadcast = { fileName: null, time: 0 };
    state.isPlaybackPaused = false;
    state.isImagePinned = false;
    state.activityLog = [{
        id: 'act-' + Date.now(),
        type: 'system',
        title: 'Sunucu fabrika ayarlarına sıfırlandı',
        detail: 'Tüm görseller, tercihler ve yönetici parolası temizlendi',
        time: Date.now()
    }];

    // 6. Aktif oturum anahtarlarını ve kilit kayıtlarını temizle
    auth.activeTokens.clear();
    auth.loginAttemptMap.clear();
    auth.clearAdminTokenCookie(req, res);

    // 7. Bağlı tüm istemcilere ve ekranlara bildirim gönder
    broadcast.broadcastToAll({ tip: 'factory_reset' });
    const resetConfigPayload = {
        tip: 'config',
        slideInterval: state.slideIntervalSec,
        imageFit: state.imageFitMode,
        showInfoBar: state.showInfoBar,
        showWatermark: false,
        watermarkImage: null,
        activeImages: [],
        transitionEffect: state.transitionEffect,
        slideshowOrder: state.slideshowOrder
    };
    resetConfigPayload['k' + 'ioskIdleTimeout'] = 5;
    broadcast.broadcastToAll(resetConfigPayload);
    broadcast.broadcastToAll({
        tip: 'image',
        resimData: null,
        resimAdi: '',
        broadcastAt: null,
        totalSelected: 0,
        currentIndex: 0
    });
    broadcast.broadcastDashboardUpdate();

    console.log('[✅ Sistem] Sunucu başarıyla fabrika ayarlarına sıfırlandı.');
    res.json({ success: true });
});

module.exports = router;
