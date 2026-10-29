#!/usr/bin/env node

/**
 * IdleBoard Yönetici Parolası Sıfırlama Aracı (CLI)
 * 
 * Bu betik, terminal veya komut satırı üzerinden yönetici parolasını ve
 * güvenlik sorusunu hızlıca sıfırlamak / güncellemek için kullanılır.
 * 
 * Kullanım:
 *   npm run reset-password
 *   node reset-password.js
 *   node reset-password.js --password "YeniSifre123"
 *   node reset-password.js --clear
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.json');

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const COMMON_WEAK_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', 'password', 'password123',
    'admin123', 'administrator', 'admin2026', 'idleboard', 'idleboard123',
    'qwerty123', 'welcome1', 'letmein1', 'changeme', 'iloveyou'
]);

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

function savePasswordData(password, questionId = null, answer = null) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let existingData = {};
    if (fs.existsSync(PASSWORD_FILE)) {
        try {
            existingData = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
        } catch (e) {}
    }

    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);

    const payload = {
        algorithm: 'scrypt',
        salt: salt.toString('hex'),
        hash: hash.toString('hex'),
        updatedAt: new Date().toISOString()
    };

    if (questionId && answer) {
        const answerSalt = crypto.randomBytes(16);
        const answerHash = crypto.scryptSync(normalizeSecurityAnswer(answer), answerSalt, 64);
        payload.securityQuestionId = Number(questionId);
        payload.securityAnswerSalt = answerSalt.toString('hex');
        payload.securityAnswerHash = answerHash.toString('hex');
    } else if (existingData.securityQuestionId && existingData.securityAnswerHash) {
        payload.securityQuestionId = existingData.securityQuestionId;
        payload.securityAnswerSalt = existingData.securityAnswerSalt;
        payload.securityAnswerHash = existingData.securityAnswerHash;
    }

    const temporaryFile = `${PASSWORD_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, PASSWORD_FILE);
}

function clearPasswordData() {
    if (fs.existsSync(PASSWORD_FILE)) {
        fs.unlinkSync(PASSWORD_FILE);
        return true;
    }
    return false;
}

// Komut satırı argümanları ayrıştırma
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
===========================================================
  IdleBoard Yönetici Parolası Sıfırlama Aracı
===========================================================

Kullanım:
  npm run reset-password             İnteraktif sıfırlama sihirbazı
  node reset-password.js             İnteraktif sıfırlama sihirbazı
  node reset-password.js --clear     Parolayı tamamen siler (Web arayüzünde ilk kurulum ekranı açılır)
  node reset-password.js --password <YeniSifre>
  node reset-password.js --password <YeniSifre> --question <1-10> --answer <Cevap>
  node reset-password.js --list-questions  Güvenlik soruları listesini gösterir
`);
    process.exit(0);
}

if (args.includes('--list-questions')) {
    console.log('\n--- Güvenlik Soruları Listesi ---');
    SECURITY_QUESTIONS.forEach(q => {
        console.log(`[${q.id}] ${q.text}`);
    });
    console.log('');
    process.exit(0);
}

if (args.includes('--clear')) {
    const deleted = clearPasswordData();
    if (deleted) {
        console.log('\n[✓] Yönetici parolası başarıyla temizlendi.');
        console.log('    Web paneline tarayıcıdan girdiğinizde "İlk Kurulum" ekranı açılacaktır.\n');
    } else {
        console.log('\n[!] Zaten tanımlı bir parola dosyası bulunamadı.\n');
    }
    process.exit(0);
}

// Parametrik kullanım (--password "...")
const passIdx = args.indexOf('--password');
if (passIdx !== -1 && args[passIdx + 1]) {
    const rawPass = args[passIdx + 1];
    const val = validatePasswordStrength(rawPass);
    if (!val.valid) {
        console.error(`\n[X] Hata: ${val.error}\n`);
        process.exit(1);
    }

    let qId = null;
    let ans = null;
    const qIdx = args.indexOf('--question');
    const aIdx = args.indexOf('--answer');
    if (qIdx !== -1 && args[qIdx + 1]) {
        qId = parseInt(args[qIdx + 1], 10);
        if (isNaN(qId) || qId < 1 || qId > 10) {
            console.error('\n[X] Hata: Güvenlik sorusu ID 1 ile 10 arasında olmalıdır.\n');
            process.exit(1);
        }
    }
    if (aIdx !== -1 && args[aIdx + 1]) {
        ans = args[aIdx + 1].trim();
        if (ans.length < 2) {
            console.error('\n[X] Hata: Güvenlik sorusu yanıtı en az 2 karakter olmalıdır.\n');
            process.exit(1);
        }
    }

    savePasswordData(rawPass, qId, ans);
    console.log('\n[✓] Yönetici parolası başarıyla güncellendi!');
    if (qId && ans) {
        const qObj = SECURITY_QUESTIONS.find(q => q.id === qId);
        console.log(`[✓] Güvenlik sorusu belirlendi: ${qObj ? qObj.text : qId}`);
    }
    console.log('    Web paneline yeni parolanızla giriş yapabilirsiniz.\n');
    process.exit(0);
}

// İnteraktif Terminal Modu
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runInteractive() {
    console.log('\n===========================================================');
    console.log('       IdleBoard Yönetici Parolası Sıfırlama Aracı         ');
    console.log('===========================================================\n');
    console.log('Bu araç sunucu üzerindeki yönetici parolasını doğrudan sıfırlar.\n');

    let newPassword = '';
    while (true) {
        newPassword = await askQuestion('Yeni yönetici parolası: ');
        if (!newPassword) {
            console.log('[!] Parola boş bırakılamaz.');
            continue;
        }
        const val = validatePasswordStrength(newPassword);
        if (!val.valid) {
            console.log(`[!] Geçersiz parola: ${val.error}`);
            continue;
        }
        break;
    }

    let confirmPassword = '';
    while (true) {
        confirmPassword = await askQuestion('Yeni yönetici parolası (tekrar): ');
        if (confirmPassword !== newPassword) {
            console.log('[!] Parolalar eşleşmiyor! Lütfen tekrar deneyin.');
            continue;
        }
        break;
    }

    console.log('\n--- Güvenlik Sorusu Belirleme ---');
    console.log('Web panelinde "Şifremi Unuttum" seçeneği ile şifre sıfırlayabilmek için');
    console.log('bir güvenlik sorusu ve yanıtı seçebilirsiniz.\n');

    const updateQuestionAns = await askQuestion('Güvenlik sorusu belirlemek / güncellemek istiyor musunuz? (E/h): ');
    let selectedQuestionId = null;
    let selectedAnswer = null;

    if (updateQuestionAns.trim().toLowerCase() === 'e' || updateQuestionAns.trim() === '') {
        console.log('\nLütfen bir soru seçin:');
        SECURITY_QUESTIONS.forEach(q => {
            console.log(`  [${q.id}] ${q.text}`);
        });

        while (true) {
            const rawChoice = await askQuestion('\nSeçiminiz (1-10): ');
            const choice = parseInt(rawChoice.trim(), 10);
            if (!isNaN(choice) && choice >= 1 && choice <= 10) {
                selectedQuestionId = choice;
                break;
            }
            console.log('[!] Lütfen 1 ile 10 arasında geçerli bir numara girin.');
        }

        const chosenQ = SECURITY_QUESTIONS.find(q => q.id === selectedQuestionId);
        console.log(`\nSeçilen soru: "${chosenQ.text}"`);

        while (true) {
            const ansInput = await askQuestion('Güvenlik sorusunun yanıtı: ');
            if (ansInput.trim().length < 2) {
                console.log('[!] Yanıt en az 2 karakter olmalıdır.');
                continue;
            }
            selectedAnswer = ansInput.trim();
            break;
        }
    }

    savePasswordData(newPassword, selectedQuestionId, selectedAnswer);

    console.log('\n-----------------------------------------------------------');
    console.log('[✓] TEBRİKLER! Yönetici parolası başarıyla kaydedildi.');
    if (selectedQuestionId && selectedAnswer) {
        console.log('[✓] Güvenlik sorusu ve yanıtı başarıyla güncellendi.');
    }
    console.log('    Artık web yönetim paneline yeni parolanızla giriş yapabilirsiniz.');
    console.log('-----------------------------------------------------------\n');

    rl.close();
}

runInteractive().catch(err => {
    console.error('\n[X] Beklenmeyen bir hata oluştu:', err);
    rl.close();
    process.exit(1);
});
