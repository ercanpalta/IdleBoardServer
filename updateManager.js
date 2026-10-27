const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const SERVER_REPO = 'ercanpalta/IdleBoardServer';
const CLIENT_REPO = 'ercanpalta/IdleBoardClient';

let lastKnownClientVersion = '1.0.0';

let updateCache = {
    server: null,
    client: null,
    lastChecked: 0
};
const UPDATE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika
let serverUpdateInProgress = false;

function setLastKnownClientVersion(version) {
    if (version && typeof version === 'string') {
        lastKnownClientVersion = version.trim();
    }
}

function getLastKnownClientVersion() {
    return lastKnownClientVersion;
}

function getServerVersion(rootDir) {
    try {
        const pkgPath = path.join(rootDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return pkg.version || '1.0.0';
        }
    } catch (e) {
        console.warn('[Güncelleme] package.json okunamadı:', e.message);
    }
    return '1.0.0';
}

function parseSemver(v) {
    if (!v) return [0, 0, 0];
    const clean = String(v).replace(/^v/i, '').trim();
    const parts = clean.split('.').map(n => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function isNewerVersion(remoteVer, currentVer) {
    const [rMaj, rMin, rPat] = parseSemver(remoteVer);
    const [cMaj, cMin, cPat] = parseSemver(currentVer);
    if (rMaj !== cMaj) return rMaj > cMaj;
    if (rMin !== cMin) return rMin > cMin;
    return rPat > cPat;
}

async function fetchLatestRelease(repo) {
    // 404 (henüz release yok) null döner; ağ/HTTP hataları fırlatılır ki önbellek ezilmesin.
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'IdleBoard-Updater/1.0',
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`GitHub API HTTP ${res.status} (${repo})`);
    }
    return await res.json();
}

async function checkAllUpdates(rootDir, getConnectedClientCount, force = false) {
    const now = Date.now();
    if (!force && updateCache.lastChecked && (now - updateCache.lastChecked < UPDATE_CACHE_TTL_MS)) {
        return buildUpdateStatusResponse(rootDir, getConnectedClientCount);
    }

    const results = await Promise.allSettled([
        fetchLatestRelease(SERVER_REPO),
        fetchLatestRelease(CLIENT_REPO)
    ]);
    const [serverRes, clientRes] = results;
    if (serverRes.status === 'fulfilled') updateCache.server = serverRes.value;
    if (clientRes.status === 'fulfilled') updateCache.client = clientRes.value;

    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.warn('[Güncelleme] Güncelleme sorgulama hatası:', r.reason && r.reason.message));
    // Hata durumunda önbelleği geçersiz kılmadan 1 dk sonra tekrar dene
    updateCache.lastChecked = failed.length
        ? now - Math.max(0, UPDATE_CACHE_TTL_MS - 60 * 1000)
        : now;

    return buildUpdateStatusResponse(rootDir, getConnectedClientCount);
}

function buildUpdateStatusResponse(rootDir, getConnectedClientCount) {
    const curServerVer = getServerVersion(rootDir);
    const curClientVer = lastKnownClientVersion || '1.0.0';

    let serverInfo = {
        currentVersion: curServerVer,
        latestVersion: curServerVer,
        hasUpdate: false,
        releaseName: '',
        releaseNotes: '',
        publishedAt: null,
        downloadUrl: null,
        htmlUrl: null
    };

    if (updateCache.server && updateCache.server.tag_name) {
        const remoteVer = updateCache.server.tag_name.replace(/^v/i, '');
        const hasUpdate = isNewerVersion(remoteVer, curServerVer);
        let dlUrl = null;
        let dlDigest = null;
        if (Array.isArray(updateCache.server.assets) && updateCache.server.assets.length > 0) {
            const zipAsset = updateCache.server.assets.find(a => a.name.endsWith('.zip'));
            if (zipAsset) {
                dlUrl = zipAsset.browser_download_url;
                dlDigest = typeof zipAsset.digest === 'string' ? zipAsset.digest : null;
            }
        }
        if (!dlUrl) {
            dlUrl = updateCache.server.zipball_url || null;
        }

        serverInfo = {
            currentVersion: curServerVer,
            latestVersion: remoteVer,
            hasUpdate,
            releaseName: updateCache.server.name || updateCache.server.tag_name,
            releaseNotes: updateCache.server.body || '',
            publishedAt: updateCache.server.published_at,
            downloadUrl: dlUrl,
            downloadDigest: dlDigest,
            htmlUrl: updateCache.server.html_url
        };
    }

    let clientInfo = {
        currentVersion: curClientVer,
        latestVersion: curClientVer,
        hasUpdate: false,
        releaseName: '',
        releaseNotes: '',
        publishedAt: null,
        downloadUrl: null,
        htmlUrl: null,
        connectedClientCount: typeof getConnectedClientCount === 'function' ? getConnectedClientCount() : 0
    };

    if (updateCache.client && updateCache.client.tag_name) {
        const remoteVer = updateCache.client.tag_name.replace(/^v/i, '');
        const hasUpdate = isNewerVersion(remoteVer, curClientVer);
        let dlUrl = null;
        if (Array.isArray(updateCache.client.assets) && updateCache.client.assets.length > 0) {
            const clientAsset = updateCache.client.assets.find(a => a.name.toLowerCase().includes('client') && a.name.endsWith('.zip'))
                || updateCache.client.assets.find(a => a.name.endsWith('.zip'));
            if (clientAsset) dlUrl = clientAsset.browser_download_url;
        }

        clientInfo = {
            currentVersion: curClientVer,
            latestVersion: remoteVer,
            hasUpdate,
            releaseName: updateCache.client.name || updateCache.client.tag_name,
            releaseNotes: updateCache.client.body || '',
            publishedAt: updateCache.client.published_at,
            downloadUrl: dlUrl,
            htmlUrl: updateCache.client.html_url,
            connectedClientCount: typeof getConnectedClientCount === 'function' ? getConnectedClientCount() : 0
        };
    }

    return {
        success: true,
        server: serverInfo,
        client: clientInfo,
        lastChecked: updateCache.lastChecked
    };
}

function isTrustedDownloadUrl(url, repo) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname === 'github.com'
            && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`);
    } catch (e) {
        return false;
    }
}

async function downloadFile(url, destPath) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'IdleBoard-Updater/1.0' },
        redirect: 'follow'
    });
    if (!res.ok) {
        throw new Error(`İndirme başarısız: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

function registerUpdateRoutes(app, context) {
    const { requireAuth, getClients, getConnectedClientCount, logActivity, rootDir } = context;

    // Durum Sorgulama
    app.get('/api/updates/status', requireAuth, async (req, res) => {
        try {
            const status = await checkAllUpdates(rootDir, getConnectedClientCount, false);
            res.json(status);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Anlık Zorunlu Denetim (Cache Atla)
    app.post('/api/updates/check', requireAuth, async (req, res) => {
        try {
            const status = await checkAllUpdates(rootDir, getConnectedClientCount, true);
            res.json(status);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // İstemci Güncellemesini Başlatma (SSE İle İstemcilere Komut Gönderme)
    app.post('/api/updates/client/apply', requireAuth, async (req, res) => {
        try {
            const status = await checkAllUpdates(rootDir, getConnectedClientCount, false);
            if (!status.client || !status.client.hasUpdate || !status.client.downloadUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'İstemci için geçerli bir güncelleme veya indirme bağlantısı bulunamadı.'
                });
            }

            const targetVersion = status.client.latestVersion;
            const downloadUrl = status.client.downloadUrl;
            if (!isTrustedDownloadUrl(downloadUrl, CLIENT_REPO)) {
                return res.status(400).json({
                    success: false,
                    error: 'İstemci güncelleme bağlantısı güvenilir bir release asset\'i değil; talimat gönderilmedi.'
                });
            }

            const payload = JSON.stringify({
                tip: 'update_command',
                targetVersion,
                downloadUrl
            });

            const clientList = typeof getClients === 'function' ? getClients() : [];
            let count = 0;
            for (const client of clientList) {
                if (!client.isAdmin && client.res) {
                    try {
                        client.res.write(`data: ${payload}\n\n`);
                        count++;
                    } catch (e) {}
                }
            }

            if (typeof logActivity === 'function') {
                logActivity('settings', 'İstemcilere güncelleme talimatı gönderildi', `v${targetVersion} (${count} ekran)`);
            }

            res.json({
                success: true,
                message: `${count} adet ekran istemcisine v${targetVersion} güncelleme talimatı başarıyla iletildi.`,
                targetVersion,
                notifiedClients: count
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Sunucu Kendini Güncelleme (Self-Update)
    app.post('/api/updates/server/apply', requireAuth, async (req, res) => {
        if (serverUpdateInProgress) {
            return res.status(409).json({ success: false, error: 'Bir sunucu güncellemesi zaten devam ediyor.' });
        }
        serverUpdateInProgress = true;
        try {
            const status = await checkAllUpdates(rootDir, getConnectedClientCount, false);
            if (!status.server || !status.server.hasUpdate || !status.server.downloadUrl) {
                serverUpdateInProgress = false;
                return res.status(400).json({
                    success: false,
                    error: 'Sunucu için geçerli bir güncelleme veya indirme bağlantısı bulunamadı.'
                });
            }

            const targetVersion = status.server.latestVersion;
            const downloadUrl = status.server.downloadUrl;

            const digestOk = /^sha256:[0-9a-f]{64}$/i.test(status.server.downloadDigest || '');
            if (!isTrustedDownloadUrl(downloadUrl, SERVER_REPO) || !digestOk) {
                serverUpdateInProgress = false;
                return res.status(400).json({
                    success: false,
                    error: 'Güncelleme paketi güvenilir bir release asset\'i değil veya SHA-256 özeti yok; güncelleme reddedildi.'
                });
            }

            if (typeof logActivity === 'function') {
                logActivity('settings', 'Sunucu güncellemesi başlatıldı', `v${targetVersion}`);
            }

            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idleboard_server_update_'));

            const zipPath = path.join(tempDir, 'update.zip');
            const extractedDir = path.join(tempDir, 'extracted');
            const serverDir = path.resolve(rootDir);
            const currentPid = process.pid;

            console.log(`[Güncelleme] Sunucu v${targetVersion} paketi indiriliyor: ${downloadUrl}`);
            await downloadFile(downloadUrl, zipPath);
            console.log('[Güncelleme] İndirme tamamlandı. Arşiv açılıyor.');

            // GitHub release asset'leri sha256 özeti sağlıyorsa paketi doğrula
            const expectedDigest = status.server.downloadDigest;
            if (expectedDigest && /^sha256:[0-9a-f]{64}$/i.test(expectedDigest)) {
                const actual = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
                if (actual.toLowerCase() !== expectedDigest.slice(7).toLowerCase()) {
                    throw new Error('Güncelleme paketinin SHA-256 özeti eşleşmiyor; güncelleme iptal edildi.');
                }
                console.log('[Güncelleme] SHA-256 doğrulaması başarılı.');
            }

            // Arşivi sunucu kapanmadan önce aç: bozuk/beklenmeyen paket sunucuyu düşürmeden reddedilir
            const extract = process.platform === 'win32'
                ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
                    'Expand-Archive -LiteralPath $env:IB_ZIP -DestinationPath $env:IB_DEST -Force'],
                    { env: { ...process.env, IB_ZIP: zipPath, IB_DEST: extractedDir } })
                : spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractedDir]);
            if (extract.status !== 0) {
                throw new Error('Güncelleme arşivi açılamadı.');
            }

            // GitHub zipball paketleri tek bir üst klasör içerir; içeriği o klasörden kopyala
            let sourceDir = extractedDir;
            const topEntries = fs.readdirSync(extractedDir, { withFileTypes: true });
            if (topEntries.length === 1 && topEntries[0].isDirectory()) {
                sourceDir = path.join(extractedDir, topEntries[0].name);
            }
            if (!fs.existsSync(path.join(sourceDir, 'server.js')) || !fs.existsSync(path.join(sourceDir, 'package.json'))) {
                throw new Error('Güncelleme paketi geçerli bir sunucu paketi değil (server.js/package.json bulunamadı).');
            }
            console.log('[Güncelleme] Güncelleme betiği hazırlanıyor.');

            // Geri dönüş için mevcut kodun yedeğini data klasörüne al (veri dizinleri güncelleme tarafından korunur)
            try {
                const backupDir = path.join(serverDir, 'data', 'update-backup');
                fs.rmSync(backupDir, { recursive: true, force: true });
                fs.mkdirSync(backupDir, { recursive: true });
                for (const entry of ['server.js', 'package.json', 'updateManager.js', 'src', 'public']) {
                    const from = path.join(serverDir, entry);
                    if (fs.existsSync(from)) fs.cpSync(from, path.join(backupDir, entry), { recursive: true });
                }
                console.log('[Güncelleme] Mevcut sürümün yedeği alındı: data/update-backup');
            } catch (backupErr) {
                console.warn('[Güncelleme] Yedek alınamadı, güncelleme yine de sürdürülüyor:', backupErr.message);
            }

            if (process.platform === 'win32') {
                const scriptPath = path.join(tempDir, 'apply_server_update.cmd');
                const scriptContent = `@echo off
chcp 65001 >nul
echo [IdleBoard Sunucu Güncelleyici] Sunucu sürecinin (PID: ${currentPid}) kapanması bekleniyor...
:waitloop
tasklist /fi "PID eq ${currentPid}" | findstr "${currentPid}" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
timeout /t 1 /nobreak >nul

echo [IdleBoard Sunucu Güncelleyici] Dosyalar güncelleniyor (veri ve resim dizinleri korunuyor)...
robocopy "${sourceDir}" "${serverDir}" /E /XD data images thumbnails node_modules .git /XF .env /NFL /NDL /NJH /NJS >nul 2>&1

echo [IdleBoard Sunucu Güncelleyici] Bağımlılıklar denetleniyor...
cd /d "${serverDir}"
call npm install --omit=dev >nul 2>&1

echo [IdleBoard Sunucu Güncelleyici] Sunucu yeniden başlatılıyor...
start "" node server.js

timeout /t 2 /nobreak >nul
rd /s /q "${tempDir}" >nul 2>&1
exit
`;
                fs.writeFileSync(scriptPath, scriptContent, 'utf8');

                res.json({
                    success: true,
                    message: `Sunucu v${targetVersion} güncellemesi başlatıldı. Birkaç saniye içinde sunucu yeniden başlayacaktır.`,
                    targetVersion
                });

                setTimeout(() => {
                    spawn('cmd.exe', ['/c', scriptPath], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    process.exit(0);
                }, 600);
            } else {
                const scriptPath = path.join(tempDir, 'apply_server_update.sh');
                const scriptContent = `#!/bin/sh
while kill -0 ${currentPid} 2>/dev/null; do
    sleep 1
done
sleep 1
rsync -a --exclude "data" --exclude "images" --exclude "thumbnails" --exclude "node_modules" --exclude ".git" --exclude ".env" "${sourceDir}/" "${serverDir}/"
cd "${serverDir}"
npm install --omit=dev
nohup node server.js >/dev/null 2>&1 &
rm -rf "${tempDir}"
`;
                fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

                res.json({
                    success: true,
                    message: `Sunucu v${targetVersion} güncellemesi başlatıldı. Birkaç saniye içinde sunucu yeniden başlayacaktır.`,
                    targetVersion
                });

                setTimeout(() => {
                    spawn('sh', [scriptPath], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    process.exit(0);
                }, 600);
            }
        } catch (err) {
            serverUpdateInProgress = false;
            console.error('[Güncelleme Hatası]', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Sunucu açılışından 4 saniye sonra arka planda güncellemeleri kontrol et
    setTimeout(() => {
        checkAllUpdates(rootDir, getConnectedClientCount, false).catch(() => {});
    }, 4000);
}

module.exports = {
    setLastKnownClientVersion,
    getLastKnownClientVersion,
    registerUpdateRoutes,
    checkAllUpdates
};
