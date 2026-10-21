import { isVideoId, watchUrl } from "../../shared/video-id.js";
import { json, readCapped, youtubeHost } from "./_shared/http.js";

function clean(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

export default async function video(req) {
  if (req.method !== "GET") return json(405, { error: "Use GET." });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isVideoId(id)) return json(400, { error: "Expected an 11-character YouTube video id." });

  const target = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`;
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    const host = youtubeHost(response.url || target);
    if (host !== "youtube.com") {
      await response.body?.cancel();
      return json(502, { error: "Could not read that video's public title." });
    }
    if (response.status === 404 || response.status === 401) {
      await response.body?.cancel();
      return json(404, { error: "YouTube has no public details for that video." });
    }
    if (!response.ok) {
      await response.body?.cancel();
      return json(502, { error: "Could not read that video's public title." });
    }
    const payload = JSON.parse(new TextDecoder().decode(await readCapped(response, 100_000)));
    return json(
      200,
      {
        id,
        title: clean(payload.title, 180),
        channel: clean(payload.author_name, 80),
        watchUrl: watchUrl(id),
      },
      { "cache-control": "public, max-age=86400" },
    );
  } catch {
    return json(502, { error: "Could not read that video's public title." });
  }
}

export const config = {
  path: "/api/video",
};
