import { IMAGES_HEADER, KEY_HEADER, MAX_PROXY_BYTES, SYSTEM_ONE_URL } from "../../shared/typesafe.js";
import { json } from "./_shared/http.js";

/**
 * Thin proxy to TypeSafe System One.
 * The visitor's key arrives in a header, is forwarded once, and is never logged or stored.
 */

export function sanitizeKey(raw) {
  if (raw == null) return null;
  let key = String(raw).trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  if (!key || key.length > 2000) return null;
  if (/[\u0000-\u001f\u007f]/.test(key)) return null;
  return key;
}

export function redactSecrets(text, key) {
  let out = String(text ?? "");
  if (key) {
    out = out.split(key).join("[redacted]");
  }
  return out.slice(0, 800);
}

function upstreamMessage(status, safeText) {
  let message = `TypeSafe returned HTTP ${status}.`;
  try {
    const parsed = JSON.parse(safeText);
    const detail = parsed.error || parsed.message || parsed.detail;
    if (typeof detail === "string" && detail.trim()) message = detail.trim();
    else if (detail) message = JSON.stringify(detail).slice(0, 400);
  } catch {
    const trimmed = safeText.trim();
    if (trimmed && !trimmed.startsWith("<")) message = trimmed.slice(0, 400);
  }
  if (status === 401) return "TypeSafe rejected that API key.";
  if (status === 413) return "TypeSafe rejected the image as too large.";
  if (status === 429) return "TypeSafe rate limit reached. Wait a moment and try again.";
  return message;
}

export default async function critique(req) {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const rawKey = req.headers.get(KEY_HEADER);
  if (!rawKey || !rawKey.trim()) {
    return json(401, {
      error: "Add your TypeSafe API key in the page. This server does not have one, and it does not store yours.",
    });
  }
  const key = sanitizeKey(rawKey);
  if (!key) return json(400, { error: "That API key has a character the proxy will not forward." });

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json(415, { error: "Expected a multipart request with the image and the System One JSON." });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_PROXY_BYTES) {
    return json(413, { error: "That request is too large. Images are resized in the browser before they are sent." });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_PROXY_BYTES) {
    return json(413, { error: "That request is too large. Images are resized in the browser before they are sent." });
  }
  if (body.byteLength < 32) return json(400, { error: "The critique request was empty." });

  let upstream;
  try {
    upstream = await fetch(SYSTEM_ONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        [IMAGES_HEADER]: "true",
        "Content-Type": contentType,
      },
      body,
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return json(502, { error: "Could not reach TypeSafe. Try again in a moment." });
  }

  const text = await upstream.text();
  const safe = redactSecrets(text, key);
  if (!upstream.ok) return json(upstream.status, { error: upstreamMessage(upstream.status, safe) });

  return new Response(safe, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

export const config = {
  path: "/api/critique",
  method: "POST",
};
