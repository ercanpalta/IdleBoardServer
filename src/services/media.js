const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const cfg = require('../config');
const state = require('../state');

// Multer Dosya Yükleme Ayarları
// Medya Metadata Yönetimi (Video süreleri ve özellikleri)
const MEDIA_METADATA_FILE = path.join(cfg.DATA_DIR, 'media-metadata.json');

function loadMediaMetadata() {
    if (fs.existsSync(MEDIA_METADATA_FILE)) {
        try {
            state.mediaMetadata = JSON.parse(fs.readFileSync(MEDIA_METADATA_FILE, 'utf8'));
        } catch (e) {
            state.mediaMetadata = {};
        }
    }
}

function saveMediaMetadata() {
    try {
        fs.writeFileSync(MEDIA_METADATA_FILE, JSON.stringify(state.mediaMetadata, null, 2), 'utf8');
    } catch (e) {}
}

loadMediaMetadata();

// MP4 Duration Parser (Harici kütüphane gerektirmeyen, doğrudan atom tabanlı hızlı ve hassas ayrıştırıcı)
function parseMp4Duration(filePath) {
    let fd = null;
    try {
        const stats = fs.statSync(filePath);
        fd = fs.openSync(filePath, 'r');
        let offset = 0;
        const buf = Buffer.alloc(16);

        while (offset < stats.size - 8) {
            const bytesRead = fs.readSync(fd, buf, 0, 16, offset);
            if (bytesRead < 8) break;
            let size = buf.readUInt32BE(0);
            const type = buf.toString('ascii', 4, 8);
            let headerSize = 8;

            if (size === 1) { // 64-bit atom boyutu
                if (bytesRead < 16) break;
                size = Number(buf.readBigUInt64BE(8));
                headerSize = 16;
            } else if (size === 0) { // Dosya sonuna kadar uzanan atom
                size = stats.size - offset;
            }

            if (size < headerSize) break;

            if (type === 'moov') {
                // moov atomu bulundu, içeriğindeki mvhd başlığını oku
                const moovBufSize = Math.min(size - headerSize, 10 * 1024 * 1024);
                const moovBuf = Buffer.alloc(moovBufSize);
                fs.readSync(fd, moovBuf, 0, moovBufSize, offset + headerSize);

                let subOffset = 0;
                while (subOffset < moovBuf.length - 8) {
                    const subSize = moovBuf.readUInt32BE(subOffset);
                    if (subSize <= 0) break;
                    const subType = moovBuf.toString('ascii', subOffset + 4, subOffset + 8);
                    if (subType === 'mvhd') {
                        const version = moovBuf.readUInt8(subOffset + 8);
                        if (version === 0) {
                            const timescale = moovBuf.readUInt32BE(subOffset + 20);
                            const duration = moovBuf.readUInt32BE(subOffset + 24);
                            if (timescale > 0) return Math.round((duration / timescale) * 100) / 100;
                        } else if (version === 1) {
                            const timescale = moovBuf.readUInt32BE(subOffset + 28);
                            const duration = Number(moovBuf.readBigUInt64BE(subOffset + 32));
                            if (timescale > 0) return Math.round((duration / timescale) * 100) / 100;
                        }
                    }
                    subOffset += subSize;
                }
                break;
            }
            offset += size;
        }
    } catch (e) {
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
    return null;
}

// Medya Metadata Kendini Onarma ve Disk Eşitleme
function syncMediaMetadataWithDisk() {
    let changed = false;
    try {
        if (!fs.existsSync(cfg.IMAGES_DIR)) return;
        const files = fs.readdirSync(cfg.IMAGES_DIR);
        const diskVideoFiles = new Set(files.filter(f => isVideoFile(f)));

        // 1. Yetim (diskte artık bulunmayan) kayıtları temizle
        for (const f of Object.keys(state.mediaMetadata)) {
            if (!diskVideoFiles.has(f)) {
                delete state.mediaMetadata[f];
                changed = true;
            }
        }

        // 2. Diskteki videoların sürelerini doğrula ve eksik/hatalı olanları onar
        for (const f of diskVideoFiles) {
            const fullPath = path.join(cfg.IMAGES_DIR, f);
            const currentMeta = state.mediaMetadata[f];
            const currentDur = currentMeta ? currentMeta.duration : null;

            // Süre yoksa veya tam 30 ise (eski varsayılan değer şüphesi) tekrar ayrıştır
            if (!currentDur || currentDur <= 0 || currentDur === 30) {
                const parsed = parseMp4Duration(fullPath);
                if (parsed && parsed > 0) {
                    const finalDur = Math.min(MAX_VIDEO_DURATION_SEC, Math.max(0.5, parsed));
                    state.mediaMetadata[f] = {
                        ...(currentMeta || {}),
                        duration: finalDur,
                        isVideo: true,
                        size: fs.statSync(fullPath).size,
                        verifiedAt: new Date().toISOString()
                    };
                    changed = true;
                }
            }
        }

        if (changed) {
            saveMediaMetadata();
        }
    } catch (e) {
        console.error('[!] syncMediaMetadataWithDisk hatası:', e.message);
    }
}

const MAX_VIDEO_DURATION_SEC = 60; // Maksimum 60 saniye video süresi

syncMediaMetadataWithDisk();

const MAX_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB maksimum dosya boyutu

const supportedMediaTypes = {
    '.jpg': { mimeType: 'image/jpeg', format: 'jpeg', isVideo: false },
    '.jpeg': { mimeType: 'image/jpeg', format: 'jpeg', isVideo: false },
    '.png': { mimeType: 'image/png', format: 'png', isVideo: false },
    '.webp': { mimeType: 'image/webp', format: 'webp', isVideo: false },
    '.mp4': { mimeType: 'video/mp4', format: 'mp4', isVideo: true }
};

const supportedImageTypes = supportedMediaTypes;

function isVideoFile(fileNameOrPath) {
    if (!fileNameOrPath || typeof fileNameOrPath !== 'string') return false;
    return path.extname(fileNameOrPath).toLowerCase() === '.mp4';
}

function isSupportedMedia(fileNameOrPath) {
    if (!fileNameOrPath || typeof fileNameOrPath !== 'string') return false;
    const ext = path.extname(fileNameOrPath).toLowerCase();
    return Boolean(supportedMediaTypes[ext]);
}

function isSupportedImage(fileNameOrPath) {
    return isSupportedMedia(fileNameOrPath);
}

function getMediaDuration(fileName) {
    if (!fileName) return state.slideIntervalSec;
    if (isVideoFile(fileName)) {
        if (state.mediaMetadata[fileName] && typeof state.mediaMetadata[fileName].duration === 'number' && state.mediaMetadata[fileName].duration > 0) {
            return Math.min(MAX_VIDEO_DURATION_SEC, Math.max(0.5, Math.round(state.mediaMetadata[fileName].duration * 100) / 100));
        }
        const filePath = path.join(cfg.IMAGES_DIR, fileName);
        if (fs.existsSync(filePath)) {
            const parsed = parseMp4Duration(filePath);
            if (parsed && parsed > 0) {
                const finalDur = Math.min(MAX_VIDEO_DURATION_SEC, Math.max(0.5, Math.round(parsed * 100) / 100));
                state.mediaMetadata[fileName] = {
                    duration: finalDur,
                    isVideo: true,
                    size: fs.statSync(filePath).size,
                    updatedAt: new Date().toISOString()
                };
                saveMediaMetadata();
                return finalDur;
            }
        }
        return 30; // fallback if unparseable
    }
    return state.slideIntervalSec;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, cfg.IMAGES_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        const prefix = ext === '.mp4' ? 'vid' : 'img';
        cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = supportedMediaTypes[ext];
        if (!type || file.mimetype !== type.mimeType) {
            const err = new Error('INVALID_FILE_TYPE');
            err.code = 'INVALID_FILE_TYPE';
            return cb(err, false);
        }
        cb(null, true);
    }
});

// Magic Bytes (Dosya İmzası) Doğrulaması (< 0.1ms, sıfır işlemci/RAM yükü)
function verifyImageMagicBytes(filePath, expectedFormat) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(16);
        const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
        if (bytesRead < 8) return false;

        if (expectedFormat === 'jpeg') {
            return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        }
        if (expectedFormat === 'png') {
            return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
                && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
        }
        if (expectedFormat === 'webp') {
            const riff = buffer.toString('ascii', 0, 4);
            const webp = buffer.toString('ascii', 8, 12);
            return riff === 'RIFF' && webp === 'WEBP';
        }
        if (expectedFormat === 'mp4') {
            return buffer.toString('ascii', 4, 8) === 'ftyp';
        }
        return false;
    } catch (e) {
        return false;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

function listImageFiles(files) {
    return (files || []).filter(f => isSupportedImage(f)).sort();
}

const thumbnailJobs = new Map();

// Aynı dosya için eşzamanlı üretimler tek işe birleştirilir
function generateThumbnail(fileName) {
    if (thumbnailJobs.has(fileName)) return thumbnailJobs.get(fileName);
    const job = generateThumbnailInternal(fileName).finally(() => thumbnailJobs.delete(fileName));
    thumbnailJobs.set(fileName, job);
    return job;
}

async function generateThumbnailInternal(fileName) {
    if (isVideoFile(fileName)) return false;
    const origPath = path.join(cfg.IMAGES_DIR, fileName);
    const thumbPath = path.join(cfg.THUMBNAILS_DIR, fileName);
    const ext = path.extname(fileName).toLowerCase();
    // Yarım yazılmış küçük resim sunulmasın diye önce geçici dosyaya yazılır (uzantı sharp'ın biçim seçimi için korunur)
    const tempPath = path.join(cfg.THUMBNAILS_DIR, `.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp${ext}`);

    if (!fs.existsSync(origPath)) return false;

    try {
        let pipeline = sharp(origPath).resize(500, null, { withoutEnlargement: true });
        if (ext === '.png') {
            pipeline = pipeline.png({ quality: 80, compressionLevel: 8 });
        } else if (ext === '.webp') {
            pipeline = pipeline.webp({ quality: 80 });
        } else {
            pipeline = pipeline.jpeg({ quality: 80, progressive: true });
        }
        await pipeline.toFile(tempPath);
        fs.renameSync(tempPath, thumbPath);
        return true;
    } catch (err) {
        try { fs.rmSync(tempPath, { force: true }); } catch (e) {}
        console.error(`[!] Thumbnail oluşturulamadı (${fileName}):`, err.message);
        return false;
    }
}

async function ensureThumbnails() {
    try {
        const files = listImageFiles(fs.readdirSync(cfg.IMAGES_DIR));
        for (const fileName of files) {
            const thumbPath = path.join(cfg.THUMBNAILS_DIR, fileName);
            if (!fs.existsSync(thumbPath)) {
                await generateThumbnail(fileName);
            }
        }
    } catch (err) {
        console.error('[!] ensureThumbnails hatası:', err.message);
    }
}

Object.assign(module.exports, {
    MAX_VIDEO_DURATION_SEC,
    ensureThumbnails,
    generateThumbnail,
    getMediaDuration,
    isSupportedImage,
    isSupportedMedia,
    isVideoFile,
    listImageFiles,
    parseMp4Duration,
    saveMediaMetadata,
    supportedMediaTypes,
    upload,
    verifyImageMagicBytes,
});
