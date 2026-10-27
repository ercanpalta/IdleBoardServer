const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const cfg = require('../config');
const broadcast = require('../services/broadcast');
const media = require('../services/media');
const playlist = require('../services/playlist');
const slideshow = require('../services/slideshow');
const state = require('../state');

function startWatcher() {
    // Chokidar Dosya İzleyici (images/ klasörünü dinamik izler)
    const watcher = chokidar.watch(cfg.IMAGES_DIR, {
        ignored: /(^|[\/\\])\../, // .gitkeep, gizli dosyaları yoksay
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 500,
            pollInterval: 100
        }
    });

    watcher
        .on('add', (filePath) => {
            if (!media.isSupportedImage(filePath)) return;
            const fileName = path.basename(filePath);
            console.log(`[📁 Watcher] Klasöre yeni görsel eklendi: ${fileName}`);
            media.generateThumbnail(fileName).catch(() => {});

            // Web paneli galerisini anında güncellemesi için bilgilendir
            broadcast.broadcastToAll({
                tip: 'gallery_update',
                action: 'add',
                fileName
            });
            broadcast.broadcastDashboardUpdate();

            if (state.selectedImageFiles.has(fileName)
                && (state.lastBroadcast.fileName !== fileName || (Date.now() - state.lastBroadcast.time > 1500))) {
                slideshow.broadcastImage(fileName);
                slideshow.restartSlideshowTimer();
            }
        })
        .on('unlink', (filePath) => {
            if (!media.isSupportedImage(filePath)) return;
            const fileName = path.basename(filePath);
            console.log(`[🗑️ Watcher] Klasörden görsel silindi: ${fileName}`);
            const thumbPath = path.join(cfg.THUMBNAILS_DIR, fileName);
            if (fs.existsSync(thumbPath)) {
                try { fs.unlinkSync(thumbPath); } catch (e) {}
            }

            if (state.selectedImageFiles.has(fileName)) {
                try {
                    playlist.saveSelectedImages([...state.selectedImageFiles].filter(selected => selected !== fileName));
                } catch (error) {
                    console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
                }
            }

            // Web paneli galerisini anında güncellemesi için bilgilendir
            broadcast.broadcastToAll({
                tip: 'gallery_update',
                action: 'unlink',
                fileName
            });
            if (state.lastBroadcast.fileName === fileName) {
                state.lastBroadcast = { fileName: null, time: 0 };
            }
            if (state.selectedImageFiles.size === 0) {
                broadcast.clearCurrentBroadcast();
            } else {
                broadcast.broadcastDashboardUpdate();
            }

            // Slayt indeksini güvenli sınıra çek
            fs.readdir(cfg.IMAGES_DIR, (err, files) => {
                if (err || !files) return;
                const remaining = media.listImageFiles(files);
                if (remaining.length === 0) {
                    state.currentImageIndex = 0;
                } else if (state.currentImageIndex >= remaining.length) {
                    state.currentImageIndex = 0;
                }
            });
        })
        .on('error', (err) => {
            console.error('[⚠️ Watcher Hatası]:', err);
        });
    return watcher;
}

module.exports = { startWatcher };
