const state = require('./src/state');
require('./src/app');
const media = require('./src/services/media');
const settings = require('./src/services/settings');
const activity = require('./src/services/activity');
const playlist = require('./src/services/playlist');
const slideshow = require('./src/services/slideshow');
const { startWatcher } = require('./src/services/watcher');
const { startHttpServer } = require('./src/services/httpServer');

playlist.loadSelectedImages();
settings.loadServerSettings();
activity.loadActivityLog();
media.ensureThumbnails();

// Sunucu ilk açıldığında seçili görseller varsa yayını anında başlat
if (state.selectedImageFiles.size > 0 && !state.isPlaybackPaused && !state.isImagePinned) {
    slideshow.slideshowTick();
}

startWatcher();
slideshow.restartSlideshowTimer();

startHttpServer(state.serverPort);
