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

// 5. Yayın Akışı Kontrol API'leri
router.get('/api/stream/status', auth.requireAuth, (req, res) => {
    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const images = media.listImageFiles(files);
        const availableImages = new Set(images);
        const selectedList = images.filter(fileName => state.selectedImageFiles.has(fileName));
        const activeImage = state.lastBroadcast.fileName && availableImages.has(state.lastBroadcast.fileName)
            ? state.lastBroadcast.fileName
            : (selectedList.length > 0 ? selectedList[0] : null);

        const isVid = activeImage ? media.isVideoFile(activeImage) : false;
        const activeDuration = activeImage ? media.getMediaDuration(activeImage) : settings.getSlideIntervalSec();

        res.json({
            isPaused: state.isPlaybackPaused,
            isPinned: state.isImagePinned,
            currentImage: activeImage,
            totalSelected: selectedList.length,
            selectedImages: selectedList,
            slideInterval: settings.getSlideIntervalSec(),
            activeDuration: activeDuration,
            mediaDuration: activeDuration,
            isVideo: isVid,
            slideshowOrder: settings.getSlideshowOrder(),
            connectedClients: broadcast.getConnectedClientCount(),
            latestBroadcastAt: state.lastBroadcast.time || null,
            metadata: state.mediaMetadata,
            nextMedia: playlist.buildNextMediaPayload(activeImage)
        });
    });
});

router.post('/api/stream/pin', auth.requireAuth, (req, res) => {
    if (state.slideshowOrder === 'random') {
        if (req.body && req.body.disableShuffle) {
            settings.setSlideshowOrder('sequential');
            activity.logActivity('settings', 'Slayt sıralaması güncellendi', 'Görsel sabitleme için sıralı döngüye geçildi');
            console.log('[i] Görsel sabitleme için karışık çalma kapatıldı.');
        } else {
            return res.status(400).json({
                success: false,
                isRandomOrder: true,
                error: 'Görseli sabitlemek için karışık çalma modunu kapatmanız gerekmektedir.'
            });
        }
    }
    state.isImagePinned = true;
    if (state.slideshowTimer) {
        clearInterval(state.slideshowTimer);
        state.slideshowTimer = null;
    }
    broadcast.broadcastToAll({
        tip: 'pin_control',
        isPinned: true,
        fileName: state.lastBroadcast.fileName,
        isVideo: state.lastBroadcast.fileName ? media.isVideoFile(state.lastBroadcast.fileName) : false
    });
    broadcast.broadcastStreamStatus({ isPinned: true });
    activity.logActivity('stream', 'Görsel sabitlendi', `"${state.lastBroadcast.fileName || 'Görsel'}" ekranda sabit tutuluyor`);
    console.log(`[📌 Yayın] Görsel ekranda sabitlendi: ${state.lastBroadcast.fileName}`);
    res.json({ success: true, isPinned: true });
});

function unpinStream(reason = 'Slayt döngüsü devam ediyor') {
    state.isImagePinned = false;
    state.lastBroadcast.time = Date.now();
    slideshow.restartSlideshowTimer();
    broadcast.broadcastToAll({
        tip: 'pin_control',
        isPinned: false,
        fileName: state.lastBroadcast.fileName,
        isVideo: state.lastBroadcast.fileName ? media.isVideoFile(state.lastBroadcast.fileName) : false
    });
    broadcast.broadcastStreamStatus({ isPinned: false });
    activity.logActivity('stream', 'Sabitleme kaldırıldı', reason);
    console.log(`[▶️ Yayın] Görsel sabitlemesi kaldırıldı (${reason}).`);
}

router.post('/api/stream/unpin', auth.requireAuth, (req, res) => {
    unpinStream('Slayt döngüsü devam ediyor');
    res.json({ success: true, isPinned: false });
});

router.post('/api/stream/toggle-pin', auth.requireAuth, (req, res) => {
    if (!state.isImagePinned && state.slideshowOrder === 'random') {
        if (req.body && req.body.disableShuffle) {
            settings.setSlideshowOrder('sequential');
            activity.logActivity('settings', 'Slayt sıralaması güncellendi', 'Görsel sabitleme için sıralı döngüye geçildi');
            console.log('[i] Görsel sabitleme için karışık çalma kapatıldı.');
        } else {
            return res.status(400).json({
                success: false,
                isRandomOrder: true,
                error: 'Görseli sabitlemek için karışık çalma modunu kapatmanız gerekmektedir.'
            });
        }
    }
    state.isImagePinned = !state.isImagePinned;
    if (state.isImagePinned) {
        if (state.slideshowTimer) {
            clearInterval(state.slideshowTimer);
            state.slideshowTimer = null;
        }
        activity.logActivity('stream', 'Görsel sabitlendi', `"${state.lastBroadcast.fileName || 'Görsel'}" ekranda sabit tutuluyor`);
        console.log(`[📌 Yayın] Görsel ekranda sabitlendi: ${state.lastBroadcast.fileName}`);
    } else {
        state.lastBroadcast.time = Date.now();
        slideshow.restartSlideshowTimer();
        activity.logActivity('stream', 'Sabitleme kaldırıldı', 'Slayt döngüsü devam ediyor');
        console.log('[▶️ Yayın] Görsel sabitlemesi kaldırıldı, slayt akışı devam ediyor.');
    }
    broadcast.broadcastToAll({
        tip: 'pin_control',
        isPinned: state.isImagePinned,
        fileName: state.lastBroadcast.fileName,
        isVideo: state.lastBroadcast.fileName ? media.isVideoFile(state.lastBroadcast.fileName) : false
    });
    broadcast.broadcastStreamStatus({ isPinned: state.isImagePinned });
    res.json({ success: true, isPinned: state.isImagePinned });
});

router.post('/api/stream/pause', auth.requireAuth, (req, res) => {
    state.isPlaybackPaused = true;
    if (state.slideshowTimer) {
        clearInterval(state.slideshowTimer);
        state.slideshowTimer = null;
    }
    broadcast.broadcastToAll({
        tip: 'stream_control',
        action: 'stop'
    });
    broadcast.broadcastStreamStatus({ isPaused: true });
    activity.logActivity('stream', 'Yayın duraklatıldı', 'Ekranlar bekleme durumuna alındı');
    console.log('[⏸️ Yayın] Yayın durduruldu, istemciler sistem tepsisine alındı.');
    res.json({ success: true, isPaused: true });
});

router.post('/api/stream/resume', auth.requireAuth, (req, res) => {
    state.isPlaybackPaused = false;
    if (!state.isImagePinned) {
        slideshow.restartSlideshowTimer();
    }
    broadcast.broadcastToAll({
        tip: 'stream_control',
        action: 'start'
    });
    broadcast.broadcastStreamStatus({ isPaused: false });
    activity.logActivity('stream', 'Yayın yeniden başlatıldı', 'Canlı görsel akışı devrede');
    if (!state.isImagePinned) {
        slideshow.slideshowTick();
    }
    console.log('[▶️ Yayın] Yayın yeniden başlatıldı.');
    res.json({ success: true, isPaused: false });
});

router.post('/api/stream/next', auth.requireAuth, (req, res) => {
    if (state.isImagePinned) {
        if (req.body && req.body.unpin) {
            unpinStream('Sonraki görsele geçiş için sabitleme kaldırıldı');
        } else {
            return res.status(400).json({
                success: false,
                isPinned: true,
                error: 'Sonraki medyaya geçmek için pini kaldırmanız gerekmektedir.'
            });
        }
    }
    const nextFile = playlist.advanceSlide(1);
    if (!nextFile) {
        return res.status(400).json({ success: false, error: 'Yayında gösterilecek görsel bulunamadı.' });
    }
    broadcast.broadcastStreamStatus({ currentImage: nextFile });
    res.json({ success: true, currentImage: nextFile });
});

router.post('/api/stream/prev', auth.requireAuth, (req, res) => {
    if (state.isImagePinned) {
        if (req.body && req.body.unpin) {
            unpinStream('Önceki görsele geçiş için sabitleme kaldırıldı');
        } else {
            return res.status(400).json({
                success: false,
                isPinned: true,
                error: 'Önceki medyaya geçmek için pini kaldırmanız gerekmektedir.'
            });
        }
    }
    const prevFile = playlist.advanceSlide(-1);
    if (!prevFile) {
        return res.status(400).json({ success: false, error: 'Yayında gösterilecek görsel bulunamadı.' });
    }
    broadcast.broadcastStreamStatus({ currentImage: prevFile });
    res.json({ success: true, currentImage: prevFile });
});

router.post('/api/stream/remove/:name', auth.requireAuth, (req, res) => {
    const fileName = req.params.name;
    if (path.basename(fileName) !== fileName || !media.isSupportedImage(fileName)) {
        return res.status(400).json({ success: false, error: 'Görsel adı geçersiz.' });
    }
    if (!state.selectedImageFiles.has(fileName)) {
        return res.status(400).json({ success: false, error: 'Görsel yayında değil.' });
    }

    const updated = [...state.selectedImageFiles].filter(f => f !== fileName);
    try {
        playlist.saveSelectedImages(updated);
    } catch (error) {
        console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
        return res.status(500).json({ success: false, error: 'Galeri seçimi kaydedilemedi.' });
    }

    if (updated.length === 0) {
        broadcast.clearCurrentBroadcast();
    } else if (state.lastBroadcast.fileName === fileName) {
        playlist.advanceSlide(1);
    }

    activity.logActivity('gallery', 'Görsel yayından kaldırıldı', fileName);

    broadcast.broadcastToAll({
        tip: 'gallery_update',
        action: 'selection_change',
        selectedImages: updated
    });
    broadcast.broadcastStreamStatus({
        selectedImages: updated,
        currentImage: state.lastBroadcast.fileName
    });
    broadcast.broadcastDashboardUpdate();

    console.log(`[🚫 Yayın] Görsel yayından kaldırıldı: ${fileName}`);
    res.json({ success: true, selectedImages: updated });
});

module.exports = router;
