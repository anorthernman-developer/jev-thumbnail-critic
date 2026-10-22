import { fixLabel, showHeadlineBox } from "./critic.js";
import { watchUrl } from "../shared/video-id.js";
import { drawQr } from "./qr.js";

export function containRect(srcWidth, srcHeight, x, y, width, height) {
  const scale = Math.min(width / srcWidth, height / srcHeight);
  const drawWidth = srcWidth * scale;
  const drawHeight = srcHeight * scale;
  return {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    w: drawWidth,
    h: drawHeight,
  };
}

export function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxLines < 1) return [];
  const lines = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index];
    index += 1;
    while (index < words.length && ctx.measureText(`${line} ${words[index]}`).width <= maxWidth) {
      line = `${line} ${words[index]}`;
      index += 1;
    }
    const more = index < words.length;
    if (lines.length === maxLines - 1 && more) line = `${line}…`;
    lines.push(trimToWidth(ctx, line, maxWidth));
  }
  return lines;
}

function trimToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.endsWith("…") ? trimmed : `${trimmed}…`;
}

export function paintShareCard(ctx, options) {
  const width = options.width || 1200;
  const height = options.height || 760;
  const image = options.image;
  ctx.fillStyle = "#F4F1E9";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.fillStyle = "#141414";
  ctx.font = "800 22px Inter, Helvetica, sans-serif";
  const kicker = options.rank ? `JEV THUMBNAIL CRITIC  ·  #${options.rank}` : "JEV THUMBNAIL CRITIC";
  ctx.fillText(kicker, 36, 32);

  const frame = { x: 36, y: 84, w: 720, h: 405 };
  ctx.fillStyle = "#141414";
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  if (image?.width && image?.height) {
    const dest = containRect(image.width, image.height, frame.x, frame.y, frame.w, frame.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, dest.x, dest.y, dest.w, dest.h);
    if (options.box) {
      ctx.strokeStyle = "#00E5FF";
      ctx.lineWidth = 4;
      ctx.strokeRect(
        dest.x + options.box.left * dest.w,
        dest.y + options.box.top * dest.h,
        (options.box.right - options.box.left) * dest.w,
        (options.box.bottom - options.box.top) * dest.h,
      );
    }
  }

  ctx.fillStyle = options.rank === 1 ? "#CC2018" : "#141414";
  ctx.font = "800 92px Inter, Helvetica, sans-serif";
  const score = String(Math.round(options.score));
  ctx.fillText(score, 788, 96);
  ctx.fillStyle = "#3f3c38";
  ctx.font = "600 22px Inter, Helvetica, sans-serif";
  ctx.fillText("/ 100", 788, 196);

  ctx.fillStyle = "#3f3c38";
  ctx.font = "700 14px Inter, Helvetica, sans-serif";
  ctx.fillText("FIX FIRST", 788, 248);
  ctx.fillStyle = "#141414";
  ctx.font = "700 28px Inter, Helvetica, sans-serif";
  const fixLines = wrapLines(ctx, options.fix || "", 360, 3);
  fixLines.forEach((line, i) => ctx.fillText(line, 788, 272 + i * 34));

  ctx.fillStyle = "#141414";
  ctx.font = "700 26px Inter, Helvetica, sans-serif";
  const titleLines = wrapLines(ctx, options.title || "Untitled", 720, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 36, 508 + i * 32));

  if (options.channel) {
    ctx.fillStyle = "#3f3c38";
    ctx.font = "600 18px Inter, Helvetica, sans-serif";
    ctx.fillText(options.channel, 36, 508 + titleLines.length * 32 + 6);
  }

  const qrSize = 168;
  const qrX = 788;
  const qrY = 470;
  drawQr(ctx, options.qrText, qrX, qrY, qrSize);
  ctx.fillStyle = "#141414";
  ctx.font = "700 16px Inter, Helvetica, sans-serif";
  ctx.fillText(options.qrCaption || "", qrX, qrY + qrSize + 10);
  ctx.fillStyle = "#3f3c38";
  ctx.font = "600 14px Inter, Helvetica, sans-serif";
  const linkLines = wrapLines(ctx, options.qrLink || options.qrText, 360, 2);
  linkLines.forEach((line, i) => ctx.fillText(line, qrX, qrY + qrSize + 32 + i * 18));

  ctx.fillStyle = "#3f3c38";
  ctx.font = "600 14px Inter, Helvetica, sans-serif";
  ctx.fillText("Brand-free score · TypeSafe Jev", 36, height - 36);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not draw the share card."));
    image.src = url;
  });
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export the share card."))), "image/png");
  });
}

export function shareFilename(item) {
  const score = Math.round(item.result?.overall ?? 0);
  const base = item.videoId || item.title || "image";
  const slug = String(base).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "image";
  return `jev-thumbnail-critic-${slug}-${score}.png`;
}

export async function downloadShareCard(item, appUrl) {
  if (!item.result || !item.displayUrl) throw new Error("Score this image before downloading a card.");
  const image = await loadImage(item.displayUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const ctx = canvas.getContext("2d");
  const answers = item.result.answers;
  const box = showHeadlineBox(answers) ? answers.headline_box.box : null;
  const video = Boolean(item.videoId);
  paintShareCard(ctx, {
    image,
    title: item.title,
    channel: item.channel || "",
    score: item.result.overall,
    fix: fixLabel(answers.main_fix?.choice),
    rank: item.rank || null,
    box,
    qrText: video ? watchUrl(item.videoId) : appUrl,
    qrCaption: video ? "Watch on YouTube" : "Open the critic",
    qrLink: video ? watchUrl(item.videoId) : appUrl,
  });
  const blob = await canvasToPng(canvas);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = shareFilename(item);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
