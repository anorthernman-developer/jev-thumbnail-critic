import QRCode from "qrcode";

/** Draw a QR code into an existing canvas context. Synchronous, no extra canvas. */
export function drawQr(ctx, text, x, y, size, { dark = "#141414", light = "#ffffff" } = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = 2;
  const cells = count + quiet * 2;
  const cell = size / cells;
  ctx.fillStyle = light;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = dark;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(col, row)) {
        ctx.fillRect(x + (col + quiet) * cell, y + (row + quiet) * cell, cell + 0.4, cell + 0.4);
      }
    }
  }
  return qr;
}

export function qrCanvas(text, cssSize = 128) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  drawQr(ctx, text, 0, 0, cssSize);
  return canvas;
}
