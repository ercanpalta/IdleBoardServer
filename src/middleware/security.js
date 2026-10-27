const cors = require('cors');

// İzin Verilen Kaynak (Origin) Denetimi: Yerel ağ, localhost ve aynı kaynak
function isAllowedOrigin(origin, req) {
    if (!origin || origin === 'null') return true;
    try {
        const parsed = new URL(origin);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') return true;
        if (hostname.startsWith('[fe80:') || hostname.startsWith('[fc') || hostname.startsWith('[fd')) return true;
        const reqHost = (req && req.headers && req.headers.host) ? req.headers.host.split(':')[0].toLowerCase() : null;
        if (reqHost && hostname === reqHost) return true;
        if (hostname.endsWith('.local') || !hostname.includes('.')) return true;
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    } catch {
        return false;
    }
    return false;
}

function applySecurity(app) {
    // Sunucu Teknolojisi İmzası Gizleme (Fingerprinting Koruması)
    app.disable('x-powered-by');

    // HTTP Güvenlik Başlıkları & İçerik Güvenlik Politikası (CSP)
    app.use((req, res, next) => {
        // 1. Clickjacking ve Çerçeveleme Koruması
        res.setHeader('X-Frame-Options', 'DENY');

        // 2. MIME-type Tahminini Önleme
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // 3. Referrer Politikası
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

        // 4. Eski Tarayıcılar İçin XSS Filtresi
        res.setHeader('X-XSS-Protection', '1; mode=block');

        // 5. İçerik Güvenlik Politikası (Content Security Policy - CSP)
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "connect-src 'self'",
                "font-src 'self'",
                "media-src 'self'",
                "object-src 'none'",
                "frame-src 'none'",
                "frame-ancestors 'none'",
                "form-action 'self'",
                "base-uri 'self'"
            ].join('; ')
        );

        // 6. Tarayıcı Donanım İzinleri Kısıtlaması (Permissions Policy)
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

        // 7. HTTPS İletişiminde HSTS (Strict-Transport-Security)
        const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
        if (isHttps) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        next();
    });

    // Çerez (Cookie) Ayrıştırma Ara Katmanı
    app.use((req, res, next) => {
        req.cookies = {};
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
            cookieHeader.split(';').forEach(c => {
                const parts = c.split('=');
                if (parts.length >= 2) {
                    const name = parts[0].trim();
                    const value = parts.slice(1).join('=').trim();
                    try {
                        req.cookies[name] = decodeURIComponent(value);
                    } catch (e) {
                        req.cookies[name] = value;
                    }
                }
            });
        }
        next();
    });

    // Güvenli CORS Yapılandırması: Yerel ağ cihazlarına tam izin, harici genel ağlara blokaj
    app.use((req, res, next) => {
        cors({
            origin: (origin, callback) => {
                if (!origin || isAllowedOrigin(origin, req)) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Admin-Token']
        })(req, res, next);
    });

    // Harici Çapraz Kaynak (Cross-Origin / Referer) Engelleme Ara Katmanı
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && !isAllowedOrigin(origin, req)) {
            console.warn(`[⚠️ Güvenlik] Harici Origin isteği engellendi: ${origin} (Hedef: ${req.path})`);
            return res.status(403).json({ success: false, error: 'Erişim engellendi: Harici web sitelerinden yerel sunucuya erişim izni bulunmamaktadır.' });
        }

        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
            const referer = req.headers.referer;
            if (referer && !isAllowedOrigin(referer, req)) {
                console.warn(`[⚠️ Güvenlik] Harici Referer yönlendirmesi engellendi: ${referer} (Hedef: ${req.path})`);
                return res.status(403).json({ success: false, error: 'Erişim engellendi: Harici yönlendirme tespit edildi.' });
            }
        }
        next();
    });
}

module.exports = { applySecurity, isAllowedOrigin };
