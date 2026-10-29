const test = require('node:test');
const assert = require('node:assert');

process.env.ALLOWED_HOSTS = 'kiosk.example.org';
const { isAllowedHost } = require('../src/middleware/security');

test('Host kontrolu IP, localhost ve yerel adlari kabul eder', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '192.168.1.20', '[::1]:3000', 'idleboard', 'kiosk.local:3000', 'nas.lan', 'kiosk.example.org:3000', undefined]) {
        assert.strictEqual(isAllowedHost(host), true, String(host));
    }
});

test('Host kontrolu DNS rebinding adreslerini reddeder', () => {
    for (const host of ['evil.com', 'evil.com:3000', 'rebind.attacker.net', 'a b', '']) {
        if (host === '') continue;
        assert.strictEqual(isAllowedHost(host), false, host);
    }
});
