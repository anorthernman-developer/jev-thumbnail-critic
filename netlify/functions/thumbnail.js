import { isVideoId } from "../../shared/video-id.js";
import { json, readCapped, youtubeHost } from "./_shared/http.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 280;

/** Read a JPEG's dimensions from the SOF marker. Returns null if it isn't a JPEG. */
export function jpegSize(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) + bytes[i + 3];
    if (!length) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && i + 9 < bytes.length) {
      return {
        height: (bytes[i + 5] << 8) + bytes[i + 6],
        width: (bytes[i + 7] << 8) + bytes[i + 8],
      };
    }
    i += 2 + length;
  }
  return null;
}

function usable(got) {
  if (!got) return false;
  if (got.size) return got.size.width >= MIN_SIDE && got.size.height >= MIN_SIDE;
  return got.buf.byteLength >= 4000;
}

async function fetchCandidate(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "image/jpeg" },
  });
  const host = youtubeHost(response.url || url);
  if (!host.endsWith("ytimg.com") && !host.endsWith("ggpht.com")) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const buf = await readCapped(response, MAX_BYTES);
  return { buf, size: jpegSize(buf) };
}

export default async function thumbnail(req) {
  if (req.method !== "GET") return json(405, { error: "Use GET." });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isVideoId(id)) return json(400, { error: "Expected an 11-character YouTube video id." });

  const urls = [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ];

  try {
    let chosen = null;
    let fallback = null;
    for (const url of urls) {
      const got = await fetchCandidate(url);
      if (!got) continue;
      if (!fallback || got.buf.byteLength > fallback.buf.byteLength) fallback = got;
      if (usable(got)) {
        chosen = got;
        break;
      }
    }
    chosen = chosen || fallback;
    if (!chosen) return json(404, { error: "YouTube has no thumbnail for that video." });
    return new Response(chosen.buf, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return json(502, { error: "Could not download that YouTube thumbnail." });
  }
}

export const config = {
  path: "/api/thumbnail",
};
