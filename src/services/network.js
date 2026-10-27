const os = require('os');
const dgram = require('dgram');
const settings = require('../services/settings');

function getNetworkAddresses(req) {
    const port = settings.getServerPort();
    const addresses = [];
    const interfaces = os.networkInterfaces();

    // Sadece gerçek fiziksel/ağ bağdaştırıcılarının IPv4 adreslerini al
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({
                    name,
                    ip: iface.address,
                    url: `http://${iface.address}:${port}/events`,
                    isPrimary: false,
                    isNetwork: true
                });
            }
        }
    }

    // Yerel ağ IP'lerini (192.168.x, 10.x) başa al
    addresses.sort((a, b) => {
        const isLanA = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.ip);
        const isLanB = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b.ip);
        if (isLanA && !isLanB) return -1;
        if (!isLanA && isLanB) return 1;
        return 0;
    });

    // İstemci her zaman başka bir makinedeymiş gibi kabul edilir:
    // İlk gerçek ağ kartı IP'si birincil adrestir.
    if (addresses.length > 0) {
        addresses[0].isPrimary = true;
    } else {
        // Yalnızca hiçbir ağ kartı bulunamazsa yerel 127.0.0.1 adresini ekle
        addresses.push({
            name: 'Yerel (127.0.0.1)',
            ip: '127.0.0.1',
            url: `http://127.0.0.1:${port}/events`,
            isPrimary: true,
            isNetwork: false
        });
    }

    const primary = addresses.find(a => a.isPrimary) || addresses[0];

    return {
        port,
        primaryUrl: primary.url,
        primaryIp: primary.ip,
        addresses
    };
}

const DISCOVERY_PORT = 38899;

let udpDiscoverySocket = null;

function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push(net.address);
            }
        }
    }
    return addresses;
}

function startUdpDiscoveryServer(httpPort) {
    if (udpDiscoverySocket) {
        try { udpDiscoverySocket.close(); } catch (e) {}
        udpDiscoverySocket = null;
    }

    try {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        sock.on('message', (msg, rinfo) => {
            const str = msg.toString().trim();
            if (str.startsWith('IDLEBOARD_DISCOVER') || str.startsWith('IDLEBOARD_PING')) {
                const localIps = getLocalIpAddresses();
                const primaryIp = localIps.length > 0 ? localIps[0] : '127.0.0.1';
                const actualPort = Number(httpPort) || 3000;

                const responseObj = {
                    service: 'idleboard-server',
                    version: '1.0',
                    httpPort: actualPort,
                    primaryIp: primaryIp,
                    allIps: localIps,
                    serverUrl: `http://${primaryIp}:${actualPort}`,
                    eventsUrl: `http://${primaryIp}:${actualPort}/events`,
                    hostname: os.hostname()
                };

                const responseBuf = Buffer.from(JSON.stringify(responseObj));
                sock.send(responseBuf, 0, responseBuf.length, rinfo.port, rinfo.address, (err) => {
                    if (!err) {
                        console.log(`[📡 Keşif] İstemciye (${rinfo.address}:${rinfo.port}) sunucu adresi bildirildi: ${responseObj.serverUrl}`);
                    }
                });
            }
        });

        sock.on('error', (err) => {
            console.warn('[⚠️ Keşif Servisi]', err.message);
        });

        sock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
            try { sock.setBroadcast(true); } catch (e) {}
            console.log(`📡 Keşif Servisi:       Aktif (UDP ${DISCOVERY_PORT} - Otomatik Bulma)`);
        });

        udpDiscoverySocket = sock;
    } catch (err) {
        console.warn('[⚠️ Keşif Servisi Başlatılamadı]:', err.message);
    }
}

Object.assign(module.exports, {
    getNetworkAddresses,
    startUdpDiscoveryServer,
});
