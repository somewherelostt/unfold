import assert from "node:assert/strict";
import { mkdtemp, rm, stat, utimes, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { analyzeVideo, frameUrlToPath } from "./analyze.ts";
import { MediaError } from "./errors.ts";
import { looksLikeSpeech, parseTranscript, pickFrameTimes, hasUntimedSpeech } from "./steps.ts";
import { REPO_ROOT, run, speechConfig } from "./util.ts";
import { isPublicAddress, validatePublicReferenceUrl } from "./reference-url.ts";

test("short utterances use confidence and audible evidence instead of a four-word minimum", () => {
  const short = [{ text: "Hello!", start: 0.2, end: 0.6, confidence: 0.9 }];
  assert.equal(looksLikeSpeech(short, 2, [{ db: -20 }]), true);
  assert.equal(looksLikeSpeech([{ ...short[0], confidence: 0.2 }], 2, [{ db: -20 }]), false);
  assert.equal(looksLikeSpeech(short, 2, [{ db: -90 }]), false);
  assert.equal(looksLikeSpeech([{ text: "Thank you.", start: 0, end: 0.5 }], 30), false);
});

test("transcript parsing preserves original script, words and timing and rejects non-speech", () => {
  const words = parseTranscript({ transcription: [
    { text: " नमस्ते", offsets: { from: 0, to: 500 }, tokens: [{ text: " नमस्ते", p: 0.91 }] },
    { text: "!", offsets: { from: 500, to: 510 } },
    { text: "(music)", offsets: { from: 510, to: 1000 } },
    { text: "noise", offsets: { from: 1000, to: 1200 }, no_speech_prob: 0.95 },
  ] });
  assert.equal(words.length, 1);
  assert.equal(words[0].text, "नमस्ते!");
  assert.deepEqual([words[0].start, words[0].end], [0, 0.51]);
  assert.equal(words[0].confidence, 0.91);
});

test("recognized words without timestamps are disclosed rather than assigned invented timing", () => {
  const transcript = { transcription: [{ text: "What's", offsets: { from: 21000, to: 21000 } }, { text: "wrong", offsets: { from: 21000, to: 21000 } }] };
  assert.equal(hasUntimedSpeech(transcript), true);
  assert.deepEqual(parseTranscript(transcript), []);
  assert.equal(hasUntimedSpeech({ transcription: [{ text: "(music)", offsets: { from: 0, to: 0 } }, { text: "?", offsets: { from: 0, to: 0 } }] }), false);
});

test("frame budget keeps actual scene starts before regular grid samples", () => {
  const times = pickFrameTimes(40, [0, 8, 20], 4);
  assert.equal(times.length, 4);
  for (const time of [0.15, 8.15, 20.15]) assert.ok(times.includes(time));
  assert.equal(pickFrameTimes(3, [0], 0).length, 0);
  assert.equal(pickFrameTimes(30, [0, 3, 6, 9, 12, 15], 3).length, 3);
});

test("local frame resolution rejects arbitrary URLs and directory traversal", () => {
  const opts = { mediaDir: "/tmp/owned-media", urlPrefix: "/media/project" };
  assert.equal(frameUrlToPath("/media/project/asset/frames/f.jpg", opts), "/tmp/owned-media/asset/frames/f.jpg");
  for (const url of ["https://example.com/f.jpg", "/media/other/f.jpg", "/media/project/%2e%2e/secret", "/media/project/../../secret"]) assert.throws(() => frameUrlToPath(url, opts), MediaError);
});

test("process cancellation and timeout wait for the process to stop", async () => {
  const controller = new AbortController();
  const processPromise = run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(processPromise, (e: MediaError) => e.code === "CANCELLED");
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 30 }), (e: MediaError) => e.code === "TIMEOUT");
});

test("cancelling a downloader process also stops its decoder child", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "unfold-process-test-"));
  const marker = path.join(root, "orphan-was-running");
  const child = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected'),500)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  try {
    await assert.rejects(run(process.execPath, ["-e", parent], { timeoutMs: 100 }), (e: MediaError) => e.code === "TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 600));
    await assert.rejects(access(marker));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reference links reject private addresses and arbitrary download hosts", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  for (const url of ["http://youtube.com/watch?v=test", "https://127.0.0.1/test", "https://youtube.com.evil.test/a", "https://user:pass@youtube.com/test", "https://youtube.com:8443/test", "https://example.com/video.mp4"]) await assert.rejects(validatePublicReferenceUrl(url), MediaError);
});

test("Hindi and auto never silently use the English-only model", () => {
  const previous = process.env.UNFOLD_STT_MULTILINGUAL_MODEL;
  process.env.UNFOLD_STT_MULTILINGUAL_MODEL = path.join(REPO_ROOT, "services/media/models/ggml-base.en.bin");
  try {
    assert.throws(() => speechConfig("hi"), (e: MediaError) => e.code === "SPEECH_MODEL_MISSING");
    assert.throws(() => speechConfig("auto"), (e: MediaError) => e.code === "SPEECH_MODEL_MISSING");
  } finally {
    if (previous === undefined) delete process.env.UNFOLD_STT_MULTILINGUAL_MODEL;
    else process.env.UNFOLD_STT_MULTILINGUAL_MODEL = previous;
  }
  assert.throws(() => parseTranscript({ model: { multilingual: false }, transcription: [] }, "hi"), (e: MediaError) => e.code === "SPEECH_MODEL_MISSING");
  assert.throws(() => parseTranscript({ model: { multilingual: true }, params: { translate: true } }, "auto"), (e: MediaError) => e.code === "SPEECH_FAILED");
});

test("real local short speech survives analysis and cache is reused only while evidence exists", { skip: !process.env.UNFOLD_MEDIA_REAL_TESTS }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "unfold-media-test-"));
  const input = path.join(REPO_ROOT, "tmp/broll-acceptance/short-utterance.mp4");
  try {
    const opts = { videoId: "short", mediaDir: root, urlPrefix: "/media/test", maxFrames: 3 };
    const first = await analyzeVideo(input, opts);
    assert.equal(first.analysis.hasSpeech, true);
    assert.ok(first.analysis.words.length > 0 && first.analysis.words.length < 4);
    assert.equal((await analyzeVideo(input, opts)).cached, true);
    await rm(frameUrlToPath(first.analysis.frames[0].url, opts));
    assert.notEqual((await analyzeVideo(input, opts)).cached, true);
    const sourceStat = await stat(input);
    await utimes(input, sourceStat.atime, new Date(sourceStat.mtimeMs + 1));
    assert.notEqual((await analyzeVideo(input, opts)).cached, true);
    await utimes(input, sourceStat.atime, sourceStat.mtime);
    await assert.rejects(analyzeVideo(input, { ...opts, maxDurationSec: 1 }), (e: MediaError) => e.code === "DURATION_LIMIT");
  } finally { await rm(root, { recursive: true, force: true }); }
});
