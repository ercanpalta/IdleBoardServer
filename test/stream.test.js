const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const auth = require('../src/services/auth');
const state = require('../src/state');
const settings = require('../src/services/settings');
const streamRouter = require('../src/routes/stream');
const settingsRouter = require('../src/routes/settings');

test('Stream pin korumasi: Sabitleme etkinken unpin olmadan sonraki ve onceki gecis reddedilir', async (t) => {
    const app = express();
    app.use(express.json());
    app.use(streamRouter);
    app.use(settingsRouter);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const token = auth.registerToken();

    t.after(() => {
        state.isImagePinned = false;
        settings.setSlideshowOrder('sequential');
        auth.activeTokens.delete(token);
        server.close();
    });

    // 1. Sabitleme etkinken /api/stream/next cagrisi (unpin parametresi yok)
    state.isImagePinned = true;
    const resBlockedNext = await fetch(`${baseUrl}/api/stream/next`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        }
    });

    assert.strictEqual(resBlockedNext.status, 400);
    const bodyBlockedNext = await resBlockedNext.json();
    assert.strictEqual(bodyBlockedNext.success, false);
    assert.strictEqual(bodyBlockedNext.isPinned, true);
    assert.strictEqual(bodyBlockedNext.error, 'Sonraki medyaya geçmek için pini kaldırmanız gerekmektedir.');
    assert.strictEqual(state.isImagePinned, true);

    // 2. Sabitleme etkinken /api/stream/prev cagrisi (unpin parametresi yok)
    const resBlockedPrev = await fetch(`${baseUrl}/api/stream/prev`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        }
    });

    assert.strictEqual(resBlockedPrev.status, 400);
    const bodyBlockedPrev = await resBlockedPrev.json();
    assert.strictEqual(bodyBlockedPrev.success, false);
    assert.strictEqual(bodyBlockedPrev.isPinned, true);
    assert.strictEqual(bodyBlockedPrev.error, 'Önceki medyaya geçmek için pini kaldırmanız gerekmektedir.');
    assert.strictEqual(state.isImagePinned, true);

    // 3. unpin: true gonderildiginde pini kaldirarak gecise izin verilir
    await fetch(`${baseUrl}/api/stream/next`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        },
        body: JSON.stringify({ unpin: true })
    });

    assert.strictEqual(state.isImagePinned, false, 'unpin: true ile sonraki medyaya gecildiginde pin kaldirilmis olmalidir');

    // 4. Pin etkinken karisik calma moduna gecis denenirse (unpin yok) reddedilir
    state.isImagePinned = true;
    settings.setSlideshowOrder('sequential');
    const resBlockedShuffle = await fetch(`${baseUrl}/api/settings/slideshow-order`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        },
        body: JSON.stringify({ slideshowOrder: 'random' })
    });

    assert.strictEqual(resBlockedShuffle.status, 400);
    const bodyBlockedShuffle = await resBlockedShuffle.json();
    assert.strictEqual(bodyBlockedShuffle.success, false);
    assert.strictEqual(bodyBlockedShuffle.isPinned, true);
    assert.strictEqual(bodyBlockedShuffle.error, 'Karışık çalma moduna geçmek için pini kaldırmanız gerekmektedir.');
    assert.strictEqual(state.isImagePinned, true);
    assert.strictEqual(state.slideshowOrder, 'sequential');

    // 5. Pin etkinken karisik calma moduna unpin: true ile gecilirse izin verilir
    const resAllowedShuffle = await fetch(`${baseUrl}/api/settings/slideshow-order`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        },
        body: JSON.stringify({ slideshowOrder: 'random', unpin: true })
    });

    assert.strictEqual(resAllowedShuffle.status, 200);
    assert.strictEqual(state.isImagePinned, false);
    assert.strictEqual(state.slideshowOrder, 'random');

    // 6. Karisik calma modu etkinken gorsel sabitlenmek istenirse (disableShuffle yok) reddedilir
    const resBlockedPin = await fetch(`${baseUrl}/api/stream/toggle-pin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        }
    });

    assert.strictEqual(resBlockedPin.status, 400);
    const bodyBlockedPin = await resBlockedPin.json();
    assert.strictEqual(bodyBlockedPin.success, false);
    assert.strictEqual(bodyBlockedPin.isRandomOrder, true);
    assert.strictEqual(bodyBlockedPin.error, 'Görseli sabitlemek için karışık çalma modunu kapatmanız gerekmektedir.');
    assert.strictEqual(state.isImagePinned, false);

    // 7. Karisik calma modu etkinken disableShuffle: true ile sabitleme yapilirsa izin verilir
    const resAllowedPin = await fetch(`${baseUrl}/api/stream/toggle-pin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
        },
        body: JSON.stringify({ disableShuffle: true })
    });

    assert.strictEqual(resAllowedPin.status, 200);
    assert.strictEqual(state.slideshowOrder, 'sequential');
    assert.strictEqual(state.isImagePinned, true);
});
