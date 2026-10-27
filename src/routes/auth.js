const express = require('express');
const activity = require('../services/activity');
const auth = require('../services/auth');

const router = express.Router();

// Kimlik Doğrulama (Auth) API'leri
router.get('/api/auth/status', (req, res) => {
    res.json({
        passwordConfigured: auth.isPasswordConfigured(),
        hasSecurityQuestion: auth.isSecurityQuestionConfigured()
    });
});

router.get('/api/auth/security-questions', (req, res) => {
    res.json({ questions: auth.SECURITY_QUESTIONS });
});

router.post('/api/auth/setup', (req, res) => {
    const { password, passwordConfirmation, securityQuestionId, securityAnswer } = req.body || {};
    if (auth.isPasswordConfigured()) {
        return res.status(409).json({ success: false, error: 'Yönetici parolası zaten belirlenmiş.' });
    }
    const validation = auth.validatePasswordStrength(password);
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: validation.error
        });
    }
    if (password !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Parola tekrarı eşleşmiyor.' });
    }
    if (!securityQuestionId || !auth.SECURITY_QUESTIONS.some(q => q.id === Number(securityQuestionId))) {
        return res.status(400).json({ success: false, error: 'Lütfen geçerli bir güvenlik sorusu seçin.' });
    }
    if (!securityAnswer || typeof securityAnswer !== 'string' || securityAnswer.trim().length < 2 || !auth.normalizeSecurityAnswer(securityAnswer)) {
        return res.status(400).json({ success: false, error: 'Güvenlik sorusu yanıtı en az 2 karakter olmalıdır.' });
    }

    auth.savePassword(password, Number(securityQuestionId), securityAnswer.trim());
    auth.activeTokens.clear();
    const token = auth.registerToken();
    auth.setAdminTokenCookie(req, res, token);
    activity.logActivity('security', 'İlk kurulum tamamlandı', 'Yönetici parolası ve güvenlik sorusu belirlendi');
    res.json({ success: true, token });
});

router.get('/api/auth/reset-password/question', (req, res) => {
    const config = auth.readPasswordConfig();
    if (!config || !config.securityQuestionId || !config.securityAnswerHash) {
        return res.json({
            configured: false,
            error: 'Bu sistemde tanımlı bir güvenlik sorusu bulunamadı. Lütfen sunucu terminalinden "npm run reset-password" komutunu kullanarak parolanızı sıfırlayın.'
        });
    }
    res.json({
        configured: true
    });
});

router.post('/api/auth/reset-password', (req, res) => {
    const clientIp = auth.getClientIp(req);
    const lock = auth.checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({
            success: false,
            error: `Çok fazla deneme yapıldı. Lütfen ${lock.remainingSec} saniye bekleyin.`,
            retryAfter: lock.remainingSec
        });
    }

    const config = auth.readPasswordConfig();
    if (!config || !config.securityQuestionId || !config.securityAnswerHash) {
        return res.status(400).json({
            success: false,
            error: 'Bu sistemde tanımlı bir güvenlik sorusu bulunmamaktadır. Sunucu terminalinden "npm run reset-password" komutunu kullanabilirsiniz.'
        });
    }

    const { securityQuestionId, answer, newPassword, passwordConfirmation } = req.body || {};
    if (!securityQuestionId) {
        return res.status(400).json({ success: false, error: 'Lütfen belirlediğiniz güvenlik sorusunu seçin.' });
    }
    if (!answer || typeof answer !== 'string') {
        return res.status(400).json({ success: false, error: 'Güvenlik sorusu yanıtı boş olamaz.' });
    }

    const isQuestionMatch = Number(securityQuestionId) === Number(config.securityQuestionId);
    const isAnswerMatch = auth.verifySecurityAnswer(answer, config.securityAnswerSalt, config.securityAnswerHash);

    if (!isQuestionMatch || !isAnswerMatch) {
        const failResult = auth.recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Güvenlik sorusu seçimi veya yanıtı hatalı!${hint}` });
    }

    auth.recordSuccessfulLogin(clientIp);

    const validation = auth.validatePasswordStrength(newPassword);
    if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
    }
    if (newPassword !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Yeni parola tekrarı eşleşmiyor.' });
    }

    auth.savePassword(newPassword);
    auth.activeTokens.clear();
    activity.logActivity('security', 'Yönetici parolası güvenlik sorusu ile sıfırlandı', `IP: ${clientIp}`);
    res.json({ success: true, message: 'Yönetici parolanız başarıyla sıfırlandı. Yeni parolanızla giriş yapabilirsiniz.' });
});

router.get('/api/auth/security-question/current', auth.requireAuth, (req, res) => {
    const config = auth.readPasswordConfig();
    if (!config || !config.securityQuestionId || !config.securityAnswerHash) {
        return res.json({ configured: false });
    }
    const question = auth.SECURITY_QUESTIONS.find(q => q.id === config.securityQuestionId);
    res.json({
        configured: true,
        questionId: config.securityQuestionId,
        questionText: question ? question.text : ''
    });
});

router.post('/api/auth/security-question', auth.requireAuth, (req, res) => {
    const clientIp = auth.getClientIp(req);
    const lock = auth.checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({ success: false, error: `Çok fazla deneme yapıldı. Lütfen ${lock.remainingSec} saniye bekleyin.` });
    }

    const { currentPassword, securityQuestionId, securityAnswer } = req.body || {};
    if (typeof currentPassword !== 'string' || !auth.verifyPassword(currentPassword)) {
        const failResult = auth.recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Mevcut parola hatalı.${hint}` });
    }
    auth.recordSuccessfulLogin(clientIp);

    if (!securityQuestionId || !auth.SECURITY_QUESTIONS.some(q => q.id === Number(securityQuestionId))) {
        return res.status(400).json({ success: false, error: 'Geçersiz güvenlik sorusu seçimi.' });
    }
    if (!securityAnswer || typeof securityAnswer !== 'string' || securityAnswer.trim().length < 2 || !auth.normalizeSecurityAnswer(securityAnswer)) {
        return res.status(400).json({ success: false, error: 'Güvenlik sorusu yanıtı en az 2 karakter olmalıdır.' });
    }

    auth.saveSecurityQuestion(Number(securityQuestionId), securityAnswer.trim());
    activity.logActivity('security', 'Güvenlik sorusu güncellendi', `Soru ID: ${securityQuestionId}`);
    res.json({ success: true, message: 'Güvenlik sorusu başarıyla güncellendi.' });
});

router.post('/api/auth/password', auth.requireAuth, (req, res) => {
    const clientIp = auth.getClientIp(req);
    const lock = auth.checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({
            success: false,
            error: `Çok fazla deneme yapıldı. Lütfen ${lock.remainingSec} saniye bekleyin.`,
            retryAfter: lock.remainingSec
        });
    }

    const { currentPassword, newPassword, passwordConfirmation } = req.body || {};
    if (typeof currentPassword !== 'string' || !auth.verifyPassword(currentPassword)) {
        const failResult = auth.recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Mevcut parola hatalı.${hint}` });
    }
    auth.recordSuccessfulLogin(clientIp);

    if (newPassword === currentPassword) {
        return res.status(400).json({ success: false, error: 'Yeni parola mevcut paroladan farklı olmalıdır.' });
    }
    const validation = auth.validatePasswordStrength(newPassword);
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: validation.error
        });
    }
    if (newPassword !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Yeni parola tekrarı eşleşmiyor.' });
    }

    auth.savePassword(newPassword);
    auth.activeTokens.clear();
    const token = auth.registerToken();
    auth.setAdminTokenCookie(req, res, token);
    activity.logActivity('security', 'Yönetici parolası değiştirildi', 'Tüm aktif oturumlar sonlandırıldı ve yeni parola kaydedildi');
    res.json({ success: true, token });
});

router.post('/api/login', (req, res) => {
    const clientIp = auth.getClientIp(req);
    const lock = auth.checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        const msg = lock.reason === 'lockout'
            ? `Çok fazla hatalı deneme yapıldı. Lütfen ${lock.remainingSec} saniye sonra tekrar deneyin.`
            : `Çok fazla istek gönderildi. Lütfen ${lock.remainingSec} saniye bekleyin.`;
        return res.status(429).json({ success: false, error: msg, retryAfter: lock.remainingSec });
    }

    const { password } = req.body || {};
    if (!auth.isPasswordConfigured()) {
        return res.status(428).json({ success: false, error: 'Önce yönetici parolasını belirleyin.' });
    }
    if (typeof password !== 'string' || !auth.verifyPassword(password)) {
        const failResult = auth.recordFailedLogin(clientIp);
        if (failResult.isLocked) {
            return res.status(429).json({
                success: false,
                error: `Çok fazla hatalı deneme yapıldı. Lütfen ${failResult.remainingSec} saniye sonra tekrar deneyin.`,
                retryAfter: failResult.remainingSec
            });
        }
        const hint = failResult.remainingTries > 0
            ? ` (${failResult.remainingTries} deneme hakkı kaldı)`
            : '';
        return res.status(401).json({ success: false, error: `Hatalı parola!${hint}` });
    }

    auth.recordSuccessfulLogin(clientIp);
    const token = auth.registerToken();
    auth.setAdminTokenCookie(req, res, token);
    console.log(`[🔐 Auth] Yönetim paneline başarılı giriş yapıldı (IP: ${clientIp}).`);
    res.json({ success: true, token });
});

router.get('/api/auth/check', (req, res) => {
    const token = auth.getRequestAuthToken(req);

    if (token && auth.activeTokens.has(token)) {
        const tokenData = auth.activeTokens.get(token);
        const now = Date.now();
        if (now - tokenData.lastActivityAt <= auth.INACTIVITY_TIMEOUT_MS && now - tokenData.createdAt <= auth.MAX_SESSION_TTL_MS) {
            tokenData.lastActivityAt = now;
            return res.json({ authenticated: true });
        }
        auth.activeTokens.delete(token);
        auth.clearAdminTokenCookie(req, res);
    }
    res.status(401).json({ authenticated: false });
});

router.post('/api/logout', (req, res) => {
    const token = auth.getRequestAuthToken(req);

    if (token) {
        auth.activeTokens.delete(token);
    }
    auth.clearAdminTokenCookie(req, res);
    console.log(`[🔒 Auth] Yönetim panelinden çıkış yapıldı.`);
    res.json({ success: true });
});

// REST API'ler (Web Paneli İçin - Parola Korumalı)

module.exports = router;
