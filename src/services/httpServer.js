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

// Yeni portu önce bağlar; başarısız olursa eski dinleyici dokunulmadan kalır.
// Başarıda eski dinleyiciyi kapatan bir fonksiyon döndürür.
async function switchHttpServer(port) {
    const { app } = require('../app');

    const newServer = await new Promise((resolve, reject) => {
        const s = app.listen(port);
        s.once('listening', () => resolve(s));
        s.once('error', reject);
    });

    newServer.on('error', (err) => {
        console.error(`[!] Sunucu dinleme hatası (${port}):`, err.message);
    });

    const oldServer = serverInstance;
    serverInstance = newServer;
    network.startUdpDiscoveryServer(port);
    console.log(`🚀 Yönetim Paneli:       http://localhost:${port}`);

    return () => {
        if (!oldServer) return;
        try {
            oldServer.close();
            if (typeof oldServer.closeAllConnections === 'function') oldServer.closeAllConnections();
            console.log('[i] Eski sunucu dinleyicisi kapatıldı.');
        } catch (e) {}
    };
}

module.exports = { startHttpServer, switchHttpServer };
