const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const activity = require('../services/activity');

// Kimlik Doğrulama (Auth) ve Oturum Güvenliği Yapılandırması
const PASSWORD_FILE = path.join(cfg.DATA_DIR, 'admin-password.json');

const MIN_PASSWORD_LENGTH = 8;

const MAX_PASSWORD_LENGTH = 128;

// Yaygın zayıf parolalar kara listesi
const COMMON_WEAK_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', 'password', 'password123',
    'admin123', 'administrator', 'admin2026', 'idleboard', 'idleboard123',
    'qwerty123', 'welcome1', 'letmein1', 'changeme', 'iloveyou'
]);

function validatePasswordStrength(password) {
    if (typeof password !== 'string') {
        return { valid: false, error: 'Parola geçersiz bir veri tipinde.' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, error: `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.` };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return { valid: false, error: `Parola en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir.` };
    }
    const hasLetter = /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    if (!hasLetter || !hasDigit) {
        return { valid: false, error: 'Parola en az bir harf ve bir rakam içermelidir.' };
    }
    if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
        return { valid: false, error: 'Bu parola çok yaygın ve tahmin edilmesi kolaydır. Lütfen daha güvenli bir parola seçin.' };
    }
    if (/^(.)\1+$/.test(password)) {
        return { valid: false, error: 'Parola yalnızca aynı karakterin tekrarından oluşamaz.' };
    }
    return { valid: true };
}

// Oturum Zaman Aşımı Kuralları (TTL)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 dakika hareketsizlik zaman aşımı

const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat mutlak oturum süresi

const activeTokens = new Map(); // token -> { createdAt, lastActivityAt }

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function registerToken() {
    const token = generateToken();
    activeTokens.set(token, {
        createdAt: Date.now(),
        lastActivityAt: Date.now()
    });
    return token;
}

function setAdminTokenCookie(req, res, token) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${cfg.AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`);
}

function clearAdminTokenCookie(req, res) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${cfg.AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag}`);
}

function getRequestAuthToken(req) {
    if (req.cookies && req.cookies[cfg.AUTH_COOKIE_NAME]) {
        return req.cookies[cfg.AUTH_COOKIE_NAME];
    }
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    if (req.headers['x-admin-token']) {
        return req.headers['x-admin-token'];
    }
    if (req.query && req.query.token) {
        return req.query.token;
    }
    return null;
}

// Süresi dolan oturumları periyodik olarak temizleme (5 dakikada bir)
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of activeTokens.entries()) {
        if (now - data.lastActivityAt > INACTIVITY_TIMEOUT_MS || now - data.createdAt > MAX_SESSION_TTL_MS) {
            activeTokens.delete(token);
        }
    }
}, 5 * 60 * 1000).unref();

// Kaba Kuvvet (Brute-Force) Koruması & Hız Sınırlaması
const MAX_FAILED_ATTEMPTS = 5;

const LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 dakika kilit

const MAX_REQUESTS_PER_MINUTE = 30; // Dakikada maks 30 istek

const loginAttemptMap = new Map(); // ip -> { failedCount, lockedUntil, reqCount, windowStart }

function getClientIp(req) {
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : req.ip || 'unknown';
}

function checkBruteForceLock(ip) {
    const now = Date.now();
    const record = loginAttemptMap.get(ip);
    if (!record) return { isLocked: false };

    // 1. Kilit süresi kontrolü
    if (record.lockedUntil > now) {
        const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
        return { isLocked: true, remainingSec, reason: 'lockout' };
    } else if (record.lockedUntil > 0) {
        record.lockedUntil = 0;
        record.failedCount = 0;
    }

    // 2. Dakikalık istek sınırı kontrolü (Flood koruması)
    if (now - record.windowStart > 60000) {
        record.windowStart = now;
        record.reqCount = 1;
    } else {
        record.reqCount++;
        if (record.reqCount > MAX_REQUESTS_PER_MINUTE) {
            const remainingSec = Math.ceil((record.windowStart + 60000 - now) / 1000);
            return { isLocked: true, remainingSec, reason: 'rate_limit' };
        }
    }

    return { isLocked: false };
}

function recordFailedLogin(ip) {
    const now = Date.now();
    let record = loginAttemptMap.get(ip);
    if (!record) {
        record = { failedCount: 0, lockedUntil: 0, reqCount: 1, windowStart: now };
        loginAttemptMap.set(ip, record);
    }
    record.failedCount++;
    const remainingTries = Math.max(0, MAX_FAILED_ATTEMPTS - record.failedCount);

    if (record.failedCount >= MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_WINDOW_MS;
        console.warn(`[⚠️ Güvenlik] IP ${ip} için hatalı giriş limiti aşıldı! Erişim 5 dakika kilitlendi.`);
        activity.logActivity('security', 'Hatalı giriş limiti aşıldı', `IP: ${ip} adresinden ${record.failedCount} kez başarısız deneme yapıldı. 5 dakika geçici kilit uygulandı.`);
        return { isLocked: true, remainingSec: Math.ceil(LOCKOUT_WINDOW_MS / 1000), remainingTries: 0 };
    }
    return { isLocked: false, remainingTries };
}

function recordSuccessfulLogin(ip) {
    loginAttemptMap.delete(ip);
}

// Eski IP kayıtlarını periyodik olarak temizleme (10 dakikada bir)
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttemptMap.entries()) {
        if (record.lockedUntil < now && now - record.windowStart > 10 * 60 * 1000) {
            loginAttemptMap.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

const SECURITY_QUESTIONS = [
    { id: 1, text: 'Kariyerinizdeki ilk çalıştığınız şirketin veya iş yerinin adı nedir?' },
    { id: 2, text: 'İlk stajınızı yaptığınız kurumun veya firmanın adı nedir?' },
    { id: 3, text: 'İş hayatınızdaki ilk unvanınız veya pozisyonunuz nedir?' },
    { id: 4, text: 'İlk işinizdeki yöneticinizin veya amirinizin adı nedir?' },
    { id: 5, text: 'Üniversitede mezun olduğunuz bölümün adı nedir?' },
    { id: 6, text: 'İlk evcil hayvanınızın adı nedir?' },
    { id: 7, text: 'Mezun olduğunuz lisenin adı nedir?' },
    { id: 8, text: 'Çocukluğunuzun geçtiği semt veya mahalle neresidir?' },
    { id: 9, text: 'İlk sahip olduğunuz arabanın markası nedir?' },
    { id: 10, text: 'İlkokuldaki en sevdiğiniz öğretmenin adı veya soyadı nedir?' }
];

function normalizeSecurityAnswer(answer) {
    if (!answer || typeof answer !== 'string') return '';
    return answer
        .trim()
        .replace(/İ/g, 'i')
        .replace(/I/g, 'i')
        .replace(/ı/g, 'i')
        .toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^a-z0-9]/g, '');
}

function hashSecurityAnswer(answer, saltHex) {
    const salt = Buffer.from(saltHex, 'hex');
    const normalized = normalizeSecurityAnswer(answer);
    return crypto.scryptSync(normalized, salt, 64).toString('hex');
}

function verifySecurityAnswer(answer, storedSaltHex, storedHashHex) {
    if (!answer || !storedSaltHex || !storedHashHex) return false;
    if (!normalizeSecurityAnswer(answer)) return false;
    try {
        const computedHash = hashSecurityAnswer(answer, storedSaltHex);
        const hashBuffer = Buffer.from(computedHash, 'hex');
        const storedBuffer = Buffer.from(storedHashHex, 'hex');
        if (hashBuffer.length !== storedBuffer.length) return false;
        return crypto.timingSafeEqual(hashBuffer, storedBuffer);
    } catch {
        return false;
    }
}

function readPasswordConfig() {
    if (fs.existsSync(PASSWORD_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
        } catch (error) {
            return null;
        }
    }
    return null;
}

function isSecurityQuestionConfigured() {
    const config = readPasswordConfig();
    return Boolean(config && config.securityQuestionId && config.securityAnswerHash);
}

function readPasswordHash() {
    const stored = readPasswordConfig();
    if (stored) {
        if (stored.algorithm !== 'scrypt' || !stored.salt || !stored.hash) {
            throw new Error('Geçersiz parola yapılandırması.');
        }
        return { type: 'scrypt', salt: stored.salt, hash: stored.hash };
    }

    if (process.env.ADMIN_PASSWORD) {
        return { type: 'plain', value: process.env.ADMIN_PASSWORD };
    }
    return null;
}

function isPasswordConfigured() {
    return Boolean(readPasswordHash());
}

function verifyPassword(password) {
    const stored = readPasswordHash();
    if (!stored) return false;
    if (stored.type === 'plain') {
        const passwordBuffer = Buffer.from(password);
        const storedBuffer = Buffer.from(stored.value);
        return passwordBuffer.length === storedBuffer.length
            && crypto.timingSafeEqual(passwordBuffer, storedBuffer);
    }

    const hash = crypto.scryptSync(password, Buffer.from(stored.salt, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(stored.hash, 'hex'));
}

function savePassword(password, securityQuestionId = null, securityAnswer = null) {
    const existingConfig = readPasswordConfig() || {};
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    const newConfig = {
        algorithm: 'scrypt',
        salt: salt.toString('hex'),
        hash: hash.toString('hex'),
        updatedAt: new Date().toISOString()
    };

    if (securityQuestionId && securityAnswer) {
        const answerSalt = crypto.randomBytes(16);
        const answerHash = crypto.scryptSync(normalizeSecurityAnswer(securityAnswer), answerSalt, 64);
        newConfig.securityQuestionId = Number(securityQuestionId);
        newConfig.securityAnswerSalt = answerSalt.toString('hex');
        newConfig.securityAnswerHash = answerHash.toString('hex');
    } else if (existingConfig.securityQuestionId && existingConfig.securityAnswerHash) {
        newConfig.securityQuestionId = existingConfig.securityQuestionId;
        newConfig.securityAnswerSalt = existingConfig.securityAnswerSalt;
        newConfig.securityAnswerHash = existingConfig.securityAnswerHash;
    }

    fs.writeFileSync(PASSWORD_FILE, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
}

function saveSecurityQuestion(securityQuestionId, securityAnswer) {
    const existingConfig = readPasswordConfig() || {};
    const answerSalt = crypto.randomBytes(16);
    const answerHash = crypto.scryptSync(normalizeSecurityAnswer(securityAnswer), answerSalt, 64);
    existingConfig.securityQuestionId = Number(securityQuestionId);
    existingConfig.securityAnswerSalt = answerSalt.toString('hex');
    existingConfig.securityAnswerHash = answerHash.toString('hex');
    existingConfig.updatedAt = new Date().toISOString();
    fs.writeFileSync(PASSWORD_FILE, JSON.stringify(existingConfig, null, 2), { mode: 0o600 });
}

function isTokenValid(token) {
    if (!token || !activeTokens.has(token)) return false;
    const tokenData = activeTokens.get(token);
    const now = Date.now();
    if (now - tokenData.lastActivityAt > INACTIVITY_TIMEOUT_MS || now - tokenData.createdAt > MAX_SESSION_TTL_MS) {
        activeTokens.delete(token);
        return false;
    }
    return true;
}

function requireAuth(req, res, next) {
    const token = getRequestAuthToken(req);

    if (!token || !activeTokens.has(token)) {
        return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
    }

    const tokenData = activeTokens.get(token);
    const now = Date.now();
    if (now - tokenData.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
        activeTokens.delete(token);
        clearAdminTokenCookie(req, res);
        return res.status(401).json({
            error: 'Oturum zaman aşımına uğradı (30 dakika hareketsizlik). Lütfen tekrar giriş yapın.',
            sessionExpired: true
        });
    }
    if (now - tokenData.createdAt > MAX_SESSION_TTL_MS) {
        activeTokens.delete(token);
        clearAdminTokenCookie(req, res);
        return res.status(401).json({
            error: 'Oturum geçerlilik süresi doldu (24 saat). Lütfen tekrar giriş yapın.',
            sessionExpired: true
        });
    }

    tokenData.lastActivityAt = now;
    next();
}

Object.assign(module.exports, {
    INACTIVITY_TIMEOUT_MS,
    isTokenValid,
    PASSWORD_FILE,
    SECURITY_QUESTIONS,
    activeTokens,
    checkBruteForceLock,
    clearAdminTokenCookie,
    getClientIp,
    normalizeSecurityAnswer,
    getRequestAuthToken,
    isPasswordConfigured,
    isSecurityQuestionConfigured,
    loginAttemptMap,
    readPasswordConfig,
    recordFailedLogin,
    recordSuccessfulLogin,
    registerToken,
    requireAuth,
    savePassword,
    saveSecurityQuestion,
    setAdminTokenCookie,
    validatePasswordStrength,
    verifyPassword,
    verifySecurityAnswer,
});
