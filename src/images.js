/** TypeSafe accepts PNG/JPEG from 280 to 1568 px on each side. */
export const MIN_SIDE = 280;
export const MAX_SIDE = 1568;

export function fitSize(width, height, minSide = MIN_SIDE, maxSide = MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) throw new Error("Image has no size.");
  let drawWidth = width;
  let drawHeight = height;
  const down = Math.min(1, maxSide / drawWidth, maxSide / drawHeight);
  drawWidth = Math.max(1, Math.round(drawWidth * down));
  drawHeight = Math.max(1, Math.round(drawHeight * down));
  if (Math.min(drawWidth, drawHeight) < minSide) {
    const scale = minSide / Math.min(drawWidth, drawHeight);
    drawWidth = Math.min(maxSide, Math.max(1, Math.round(drawWidth * scale)));
    drawHeight = Math.min(maxSide, Math.max(1, Math.round(drawHeight * scale)));
  }
  const canvasWidth = Math.max(drawWidth, minSide);
  const canvasHeight = Math.max(drawHeight, minSide);
  const fittedWidth = Math.min(drawWidth, canvasWidth);
  const fittedHeight = Math.min(drawHeight, canvasHeight);
  return {
    width: canvasWidth,
    height: canvasHeight,
    drawWidth: fittedWidth,
    drawHeight: fittedHeight,
    offsetX: Math.floor((canvasWidth - fittedWidth) / 2),
    offsetY: Math.floor((canvasHeight - fittedHeight) / 2),
  };
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode that image."))),
      "image/jpeg",
      quality,
    );
  });
}

/** Rotate upright, fit the size limits, and re-encode as a baseline JPEG. */
export async function prepareImage(source) {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const fit = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, fit.offsetX, fit.offsetY, fit.drawWidth, fit.drawHeight);
    let quality = 0.9;
    let blob = await canvasToJpeg(canvas, quality);
    while (blob.size > 3_500_000 && quality > 0.5) {
      quality = Math.round((quality - 0.1) * 10) / 10;
      blob = await canvasToJpeg(canvas, quality);
    }
    if (blob.size > 3_500_000) throw new Error("That image is still too large after resizing.");
    return { blob, width: fit.width, height: fit.height };
  } finally {
    bitmap.close?.();
  }
}

export async function isPngOrJpeg(file) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png || jpeg;
}
