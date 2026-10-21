import assert from "node:assert/strict";
import test from "node:test";
import thumbnail, { jpegSize } from "../netlify/functions/thumbnail.js";
import search, { extractVideos, extractVideosFromHtml } from "../netlify/functions/search.js";
import video from "../netlify/functions/video.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jpeg(width, height) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x0b,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01,
    0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

test("jpegSize reads the SOF marker", () => {
  assert.deepEqual(jpegSize(jpeg(480, 360)), { width: 480, height: 360 });
  assert.deepEqual(jpegSize(jpeg(120, 90)), { width: 120, height: 90 });
  assert.equal(jpegSize(Uint8Array.from([1, 2, 3])), null);
});

test("thumbnails fall back from a missing maxres image to hqdefault and reject bad ids", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("maxresdefault")) return new Response(jpeg(120, 90), { status: 404 });
    return new Response(jpeg(480, 360), { status: 200 });
  };
  const bad = await thumbnail(new Request("http://local/api/thumbnail?id=../etc/passwd"));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);

  const ok = await thumbnail(new Request("http://local/api/thumbnail?id=J5KTpq7hVn4"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), jpeg(480, 360));
  assert.deepEqual(calls, [
    "https://i.ytimg.com/vi/J5KTpq7hVn4/maxresdefault.jpg",
    "https://i.ytimg.com/vi/J5KTpq7hVn4/hqdefault.jpg",
  ]);
});

test("a large maxres thumbnail is returned without a second fetch", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(jpeg(1280, 720), { status: 200 });
  };
  const ok = await thumbnail(new Request("http://local/api/thumbnail?id=-yKALFS5ewY"));
  assert.equal(ok.status, 200);
  assert.deepEqual(jpegSize(new Uint8Array(await ok.arrayBuffer())), { width: 1280, height: 720 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/i\.ytimg\.com\/vi\/-yKALFS5ewY\/maxresdefault\.jpg$/);
});

test("search parses videoRenderer results and never fetches the visitor's text as a URL", async () => {
  const fixture = {
    contents: {
      section: [{
        videoRenderer: {
          videoId: "J5KTpq7hVn4",
          title: { runs: [{ text: "Multi-agent workflows" }] },
          ownerText: { runs: [{ text: "Visual Studio Code" }] },
        },
      }, {
        videoRenderer: { videoId: "J5KTpq7hVn4", title: { simpleText: "duplicate" } },
      }],
    },
  };
  assert.deepEqual(extractVideos(fixture), [{
    id: "J5KTpq7hVn4",
    title: "Multi-agent workflows",
    channel: "Visual Studio Code",
  }]);
  assert.deepEqual(extractVideosFromHtml('{"videoId":"CST89O0Ecy8"}{"videoId":"CST89O0Ecy8"}', 8), [
    { id: "CST89O0Ecy8", title: "", channel: "" },
  ]);

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  const res = await search(new Request("http://local/api/search?q=https%3A%2F%2Fevil.example%2Fsecret"));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.results[0].id, "J5KTpq7hVn4");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.youtube.com/youtubei/v1/search?prettyPrint=false");
  assert.match(calls[0].body, /evil\.example/);
  assert.equal(calls[0].url.includes("evil.example"), false);
});

test("search falls back to the results page and rejects an empty query", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("youtubei")) return new Response(JSON.stringify({ contents: {} }), { status: 200 });
    return new Response('prefix "videoId":"8plAml8U0_8" suffix', { status: 200 });
  };
  const empty = await search(new Request("http://local/api/search?q=%20%20"));
  assert.equal(empty.status, 400);
  const res = await search(new Request("http://local/api/search?q=copilot"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).results[0].id, "8plAml8U0_8");
  assert.match(calls.at(-1), /^https:\/\/www\.youtube\.com\/results\?search_query=copilot/);
});

test("video details come from oEmbed and the embed HTML is not returned", async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/www\.youtube\.com\/oembed\?/);
    assert.match(String(url), /J5KTpq7hVn4/);
    return new Response(JSON.stringify({
      title: "Multi-agent workflows in VS Code",
      author_name: "Visual Studio Code",
      html: "<iframe src='https://evil.example/x'></iframe>",
    }), { status: 200 });
  };
  const res = await video(new Request("http://local/api/video?id=J5KTpq7hVn4"));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.title, "Multi-agent workflows in VS Code");
  assert.equal(payload.channel, "Visual Studio Code");
  assert.equal(payload.watchUrl, "https://www.youtube.com/watch?v=J5KTpq7hVn4");
  assert.equal("html" in payload, false);

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("no");
  };
  const bad = await video(new Request("http://local/api/video?id=short"));
  assert.equal(bad.status, 400);
  assert.equal(called, false);
});
