const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/services/auth');

test('validatePasswordStrength rejects short, weak and letterless passwords', () => {
    assert.strictEqual(auth.validatePasswordStrength('abc1').valid, false);
    assert.strictEqual(auth.validatePasswordStrength('password123').valid, false);
    assert.strictEqual(auth.validatePasswordStrength('abcdefgh').valid, false);
    assert.strictEqual(auth.validatePasswordStrength(12345678).valid, false);
    assert.strictEqual(auth.validatePasswordStrength('Str0ngPass').valid, true);
});

test('normalizeSecurityAnswer collapses case and spacing', () => {
    assert.strictEqual(auth.normalizeSecurityAnswer('  Ankara  '), auth.normalizeSecurityAnswer('ankara'));
});

test('isTokenValid accepts fresh tokens and rejects unknown ones', () => {
    const token = auth.registerToken();
    assert.ok(auth.isTokenValid(token));
    assert.ok(!auth.isTokenValid('does-not-exist'));
    assert.ok(!auth.isTokenValid(undefined));
});

test('isTokenValid removes tokens that exceeded the inactivity timeout', () => {
    const token = auth.registerToken();
    auth.activeTokens.get(token).lastActivityAt = Date.now() - auth.INACTIVITY_TIMEOUT_MS - 1000;
    assert.ok(!auth.isTokenValid(token));
    assert.ok(!auth.activeTokens.has(token));
});

test('isTokenValid removes tokens that exceeded the absolute session TTL', () => {
    const token = auth.registerToken();
    auth.activeTokens.get(token).createdAt = Date.now() - auth.MAX_SESSION_TTL_MS - 1000;
    assert.ok(!auth.isTokenValid(token));
});

test('getClientIp ignores X-Forwarded-For', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '::ffff:10.0.0.5' } };
    assert.strictEqual(auth.getClientIp(req), '::ffff:10.0.0.5');
});
