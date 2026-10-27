const network = require('./network');

let serverInstance = null;

function startHttpServer(port) {
    const { app } = require('../app');

    if (serverInstance) {
        try {
            serverInstance.close();
            console.log('[i] Eski sunucu dinleyicisi kapatıldı.');
        } catch (e) {}
    }

    serverInstance = app.listen(port, () => {
        console.log('================================================');
        console.log(`🚀 Yönetim Paneli:       http://localhost:${port}`);
        console.log(`📡 SSE Stream Adresi:   http://localhost:${port}/events`);
        console.log('👀 Chokidar Watcher:     Aktif (images/ izleniyor)');
        console.log('🔒 Parola Koruması:      Aktif');
        console.log('================================================');
    });

    serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[!] Port ${port} kullanımda! Başka bir uygulama tarafından kullanılıyor.`);
        } else {
            console.error(`[!] Sunucu dinleme hatası (${port}):`, err.message);
        }
    });

    network.startUdpDiscoveryServer(port);
    return serverInstance;
}

module.exports = { startHttpServer };
