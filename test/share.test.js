import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drawQr } from "../src/qr.js";
import { containRect, paintShareCard, shareFilename, wrapLines } from "../src/share.js";

function fakeCtx() {
  const ops = [];
  const ctx = {
    ops,
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: false,
    fillRect(x, y, w, h) { ops.push(["fillRect", x, y, w, h, this.fillStyle]); },
    fillText(text, x, y) { ops.push(["fillText", text, x, y, this.fillStyle, this.font]); },
    drawImage(...args) { ops.push(["drawImage", ...args]); },
    strokeRect(...args) { ops.push(["strokeRect", ...args, this.strokeStyle]); },
    measureText(text) { return { width: String(text).length * 10 }; },
  };
  return ctx;
}

test("QR modules encode a watch URL", () => {
  const ctx = fakeCtx();
  const qr = drawQr(ctx, "https://www.youtube.com/watch?v=J5KTpq7hVn4", 0, 0, 180);
  assert.ok(qr.modules.size >= 21);
  const dark = ctx.ops.filter((op) => op[0] === "fillRect" && op[5] === "#141414");
  assert.ok(dark.length > 40);
});

test("the share card paints the score, the headline box, and a video QR", () => {
  const ctx = fakeCtx();
  paintShareCard(ctx, {
    image: { width: 1280, height: 720 },
    title: "Multi-agent workflows in VS Code",
    channel: "Visual Studio Code",
    score: 87.4,
    fix: "Cluttered layout",
    rank: 1,
    box: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.45 },
    qrText: "https://www.youtube.com/watch?v=J5KTpq7hVn4",
    qrCaption: "Watch on YouTube",
    qrLink: "https://www.youtube.com/watch?v=J5KTpq7hVn4",
  });
  const text = ctx.ops.filter((op) => op[0] === "fillText").map((op) => op[1]);
  assert.ok(text.includes("87"));
  assert.ok(text.some((line) => line.includes("CLUTTER") || line.includes("Cluttered")));
  assert.ok(text.some((line) => line.includes("JEV THUMBNAIL CRITIC")));
  assert.ok(text.some((line) => line.includes("Watch on YouTube")));
  assert.ok(ctx.ops.some((op) => op[0] === "drawImage"));
  assert.ok(ctx.ops.some((op) => op[0] === "strokeRect" && op.at(-1) === "#00E5FF"));
  assert.equal(shareFilename({ videoId: "J5KTpq7hVn4", result: { overall: 87.4 } }), "jev-thumbnail-critic-j5ktpq7hvn4-87.png");
});

test("lines wrap inside the card width", () => {
  const ctx = fakeCtx();
  const lines = wrapLines(ctx, "one two three four five six", 50, 2);
  assert.ok(lines.length <= 2);
  assert.ok(lines[0].length > 0);
  const fitted = containRect(1280, 720, 0, 0, 720, 405);
  assert.ok(fitted.w <= 720 && fitted.h <= 405);
  assert.ok(Math.abs(fitted.w / fitted.h - 1280 / 720) < 0.02);
});

test("the example file is the 15 Copilot videos", () => {
  const videos = JSON.parse(readFileSync(new URL("../src/data/videos.json", import.meta.url), "utf8"));
  assert.equal(videos.length, 15);
  const ids = videos.map((video) => video.id);
  assert.equal(new Set(ids).size, 15);
  for (const video of videos) {
    assert.match(video.id, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(video.url, `https://www.youtube.com/watch?v=${video.id}`);
    assert.ok(video.title);
    assert.ok(video.channel);
  }
});
