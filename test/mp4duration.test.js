const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = require('../src/services/media');

function box(type, ...payloads) {
    const body = Buffer.concat(payloads);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, body]);
}

function u32(...vals) {
    const b = Buffer.alloc(vals.length * 4);
    vals.forEach((v, i) => b.writeUInt32BE(v, i * 4));
    return b;
}

function writeTemp(name, buf) {
    const p = path.join(os.tmpdir(), `${name}-${process.pid}.mp4`);
    fs.writeFileSync(p, buf);
    return p;
}

const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
const mvhd = box('mvhd', u32(0, 0, 0, 1000, 0), Buffer.alloc(80));
const tkhd = box('tkhd', u32(0, 0, 0, 1, 0, 0), Buffer.alloc(60));
const mdhd = box('mdhd', u32(0, 0, 0, 90000, 0), Buffer.alloc(4));
const trak = box('trak', tkhd, box('mdia', mdhd));
const trex = box('trex', u32(0, 1, 1, 3000, 0, 0));

function moof(sampleCount, withDurations) {
    const tfhd = box('tfhd', u32(0x020000, 1));
    const trunFlags = withDurations ? 0x100 : 0;
    const samples = withDurations
        ? Buffer.concat(Array.from({ length: sampleCount }, () => u32(3000)))
        : Buffer.alloc(0);
    const trun = box('trun', u32(trunFlags, sampleCount), samples);
    return box('moof', box('traf', tfhd, trun));
}

test('parseMp4Duration reads regular mvhd duration', () => {
    const mvhdSimple = box('mvhd', u32(0, 0, 0, 1000, 12500), Buffer.alloc(80));
    const p = writeTemp('plain', Buffer.concat([ftyp, box('moov', mvhdSimple, trak)]));
    assert.strictEqual(media.parseMp4Duration(p), 12.5);
    fs.unlinkSync(p);
});

test('parseMp4Duration sums fragment sample durations when mvhd duration is 0', () => {
    const moov = box('moov', mvhd, trak, box('mvex', trex));
    const p = writeTemp('frag', Buffer.concat([ftyp, moov, moof(30, true), moof(30, true)]));
    assert.strictEqual(media.parseMp4Duration(p), 2);
    fs.unlinkSync(p);
});

test('parseMp4Duration uses trex default duration and mehd', () => {
    const moov = box('moov', mvhd, trak, box('mvex', trex));
    const p = writeTemp('fragdef', Buffer.concat([ftyp, moov, moof(90, false)]));
    assert.strictEqual(media.parseMp4Duration(p), 3);
    fs.unlinkSync(p);

    const mehd = box('mehd', u32(0, 7000));
    const moov2 = box('moov', mvhd, trak, box('mvex', mehd, trex));
    const p2 = writeTemp('mehd', Buffer.concat([ftyp, moov2]));
    assert.strictEqual(media.parseMp4Duration(p2), 7);
    fs.unlinkSync(p2);
});

test('parseMp4Duration returns null for garbage', () => {
    const p = writeTemp('junk', Buffer.alloc(64, 7));
    assert.ok(!media.parseMp4Duration(p));
    fs.unlinkSync(p);
});

test('inspectMp4VideoCodec detects avc1 and hvc1', () => {
    const avc1Entry = box('avc1', Buffer.alloc(78));
    const stsdAvc = box('stsd', u32(0, 1), avc1Entry);
    const trakAvc = box('trak', tkhd, box('mdia', mdhd, box('minf', box('stbl', stsdAvc))));
    const pAvc = writeTemp('codec-avc', Buffer.concat([ftyp, box('moov', trakAvc)]));
    assert.strictEqual(media.inspectMp4VideoCodec(pAvc), 'avc1');
    fs.unlinkSync(pAvc);

    const hvc1Entry = box('hvc1', Buffer.alloc(78));
    const stsdHvc = box('stsd', u32(0, 1), hvc1Entry);
    const trakHvc = box('trak', tkhd, box('mdia', mdhd, box('minf', box('stbl', stsdHvc))));
    const pHvc = writeTemp('codec-hvc', Buffer.concat([ftyp, box('moov', trakHvc)]));
    assert.strictEqual(media.inspectMp4VideoCodec(pHvc), 'hvc1');
    fs.unlinkSync(pHvc);
});
