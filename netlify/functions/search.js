import { isVideoId } from "../../shared/video-id.js";
import { json, readCapped, youtubeHost } from "./_shared/http.js";

const INNERTUBE = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const MAX_BYTES = 2 * 1024 * 1024;
const RESULT_LIMIT = 8;

export function textOf(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text || "").join("");
  return "";
}

export function extractVideos(data, limit = RESULT_LIMIT) {
  const found = [];
  const seen = new Set();
  walk(data);
  return found;

  function walk(node, depth = 0) {
    if (!node || found.length >= limit || depth > 40) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const video = node.videoRenderer;
    if (video && isVideoId(video.videoId) && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      found.push({
        id: video.videoId,
        title: clean(textOf(video.title), 140),
        channel: clean(textOf(video.ownerText) || textOf(video.longBylineText), 80),
      });
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
}

export function extractVideosFromHtml(html, limit = RESULT_LIMIT) {
  const found = [];
  const seen = new Set();
  const pattern = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let match = pattern.exec(html);
  while (match && found.length < limit) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      found.push({ id: match[1], title: "", channel: "" });
    }
    match = pattern.exec(html);
  }
  return found;
}

function clean(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function cleanQuery(raw) {
  const query = clean(raw, 80);
  if (!query) return null;
  return query;
}

async function youtubeText(url, init) {
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  const host = youtubeHost(response.url || url);
  if (host !== "youtube.com") {
    await response.body?.cancel();
    throw new Error("unexpected host");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buf = await readCapped(response, MAX_BYTES);
  return new TextDecoder().decode(buf);
}

export default async function search(req) {
  if (req.method !== "GET") return json(405, { error: "Use GET." });
  const query = cleanQuery(new URL(req.url).searchParams.get("q"));
  if (!query) return json(400, { error: "Enter a search term." });

  try {
    const raw = await youtubeText(INNERTUBE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20241001.00.00",
            hl: "en",
            gl: "US",
          },
        },
        query,
      }),
    });
    let results = [];
    try {
      results = extractVideos(JSON.parse(raw));
    } catch {
      results = [];
    }
    if (!results.length) {
      const page = await youtubeText(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`,
        { headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0" } },
      );
      results = extractVideosFromHtml(page);
    }
    if (!results.length) {
      return json(502, { error: "YouTube search returned nothing. Paste a video URL instead." });
    }
    return json(200, { results }, { "cache-control": "public, max-age=300" });
  } catch {
    return json(502, { error: "YouTube search is unavailable right now. Paste a video URL instead." });
  }
}

export const config = {
  path: "/api/search",
};
