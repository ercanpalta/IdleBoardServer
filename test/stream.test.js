const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const auth = require('../src/services/auth');
const state = require('../src/state');
const streamRouter = require('../src/routes/stream');

test('Stream pin korumasi: Sabitleme etkinken unpin olmadan sonraki ve onceki gecis reddedilir', async (t) => {
    const app = express();
    app.use(express.json());
    app.use(streamRouter);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const token = auth.registerToken();

    t.after(() => {
        state.isImagePinned = false;
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
});
