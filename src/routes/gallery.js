const express = require('express');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const activity = require('../services/activity');
const auth = require('../services/auth');
const broadcast = require('../services/broadcast');
const media = require('../services/media');
const playlist = require('../services/playlist');
const settings = require('../services/settings');
const slideshow = require('../services/slideshow');
const state = require('../state');

const router = express.Router();

// 1. Resim Listesi
router.get('/api/images', auth.requireAuth, (req, res) => {
    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Klasör okunamadı" });
        const images = media.listImageFiles(files);
        res.json(images);
    });
});

router.get('/api/gallery', auth.requireAuth, (req, res) => {
    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const images = media.listImageFiles(files);
        res.json({
            images,
            selectedImages: images.filter(fileName => state.selectedImageFiles.has(fileName)),
            metadata: state.mediaMetadata
        });
    });
});

router.get('/api/dashboard-stats', auth.requireAuth, (req, res) => {
    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri istatistikleri okunamadı.' });
        const images = media.listImageFiles(files);
        const availableImages = new Set(images);
        const selectedImages = [...state.selectedImageFiles].filter(fileName => availableImages.has(fileName));
        const latestImage = state.lastBroadcast.fileName && availableImages.has(state.lastBroadcast.fileName)
            ? state.lastBroadcast.fileName
            : null;

        res.json({
            connectedClients: broadcast.getConnectedClientCount(),
            imageCount: images.length,
            selectedImageCount: selectedImages.length,
            slideInterval: settings.getSlideIntervalSec(),
                        imageFit: settings.getImageFitMode(),
            showInfoBar: settings.getShowInfoBar(),
            transitionEffect: settings.getTransitionEffect(),
            slideshowOrder: settings.getSlideshowOrder(),
            latestImage,
            latestBroadcastAt: state.lastBroadcast.time || null,
            uptimeSeconds: Math.floor((Date.now() - cfg.serverStartedAt) / 1000),
            isPaused: state.isPlaybackPaused,
            isPinned: state.isImagePinned,
            recentActivities: state.activityLog.slice(0, 10)
        });
    });
});

router.put('/api/gallery/selection', auth.requireAuth, (req, res) => {
    const requestedImages = req.body && req.body.selectedImages;
    if (!Array.isArray(requestedImages)
        || requestedImages.some(fileName => typeof fileName !== 'string'
            || path.basename(fileName) !== fileName
            || !media.isSupportedImage(fileName))) {
        return res.status(400).json({ success: false, error: 'Görsel seçimi geçersiz.' });
    }

    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const availableImages = new Set(media.listImageFiles(files));
        if (requestedImages.some(fileName => !availableImages.has(fileName))) {
            return res.status(400).json({ success: false, error: 'Seçilen görsellerden bazıları artık mevcut değil.' });
        }

        const selection = [...new Set(requestedImages)];
        try {
            playlist.saveSelectedImages(selection);
        } catch (error) {
            console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
            return res.status(500).json({ success: false, error: 'Galeri seçimi kaydedilemedi.' });
        }
        state.currentImageIndex = 0;
        slideshow.restartSlideshowTimer();
        activity.logActivity('gallery', 'Yayındaki görsel seçimi güncellendi', `${selection.length} görsel yayında`);
        if (selection.length > 0) {
            broadcast.broadcastDashboardUpdate();
            slideshow.slideshowTick();
        } else {
            broadcast.clearCurrentBroadcast();
        }
        res.json({ success: true, selectedImages: selection });
    });
});

module.exports = router;
