import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { IMAGES_HEADER, MAX_PROXY_BYTES, SYSTEM_ONE_URL } from "../shared/typesafe.js";
import critique, { redactSecrets, sanitizeKey } from "../netlify/functions/critique.js";
import { buildCritiqueForm } from "../src/critic.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function call(key, extraHeaders = {}, body = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33])) {
  const headers = {
    "content-type": "multipart/form-data; boundary=testbound",
    ...extraHeaders,
  };
  if (key != null) headers["x-typesafe-key"] = key;
  return critique(new Request("http://local/api/critique", { method: "POST", headers, body }));
}

test("a critique without a key is rejected before any upstream call", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not call TypeSafe");
  };
  const res = await call(null);
  assert.equal(res.status, 401);
  const payload = await res.json();
  assert.match(payload.error, /API key/);
  assert.equal(payload.error.includes("Bearer"), false);
  assert.equal(called, false);
});

test("the proxy forwards the visitor key and the images header, and redacts the key from errors", async () => {
  const key = "test-key-not-real";
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()) });
    return new Response(`{"error":"bad ${key}"}`, { status: 422, headers: { "content-type": "application/json" } });
  };
  const res = await call(`Bearer ${key}`);
  assert.equal(res.status, 422);
  const payload = await res.json();
  assert.equal(JSON.stringify(payload).includes(key), false);
  assert.match(payload.error, /bad \[redacted\]/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, SYSTEM_ONE_URL);
  assert.equal(seen[0].headers.authorization, `Bearer ${key}`);
  assert.equal(seen[0].headers[IMAGES_HEADER.toLowerCase()], "true");
  assert.match(seen[0].headers["content-type"], /multipart\/form-data/);
});

test("a key with a newline is not forwarded", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("ok");
  };
  const headers = new Map([
    ["x-typesafe-key", "secret\r\nX-Injected: 1"],
    ["content-type", "multipart/form-data; boundary=testbound"],
  ]);
  const res = await critique({
    method: "POST",
    headers: { get: (name) => headers.get(name) ?? null },
    arrayBuffer: async () => new Uint8Array(64).buffer,
  });
  assert.equal(res.status, 400);
  assert.equal(called, false);
  assert.equal(sanitizeKey("secret\nnope"), null);
  assert.equal(redactSecrets("see secret-value", "secret-value"), "see [redacted]");
});

test("oversized bodies are refused without calling TypeSafe", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("ok");
  };
  const res = await critique(new Request("http://local/api/critique", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=testbound",
      "x-typesafe-key": "test-key-not-real",
    },
    body: new Uint8Array(MAX_PROXY_BYTES + 1),
  }));
  assert.equal(res.status, 413);
  assert.equal(called, false);
});

test("a successful upstream JSON body is returned unchanged when it has no key", async () => {
  const upstream = {
    model: "jev-1.14.0",
    answers: { readability: { type: "score", score: 2, confidence: 0.8, legend: { 0: "a", 1: "b", 2: "c" } } },
    usage: { input_tokens: 1000, output_tokens: 20 },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(upstream), { status: 200 });
  const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const { form } = buildCritiqueForm("thumbnail", jpeg);
  const incoming = new Request("http://local/api/critique", {
    method: "POST",
    headers: { "x-typesafe-key": "test-key-not-real" },
    body: form,
  });
  const res = await critique(incoming);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), upstream);
});

test("GET and non-multipart posts are rejected", async () => {
  const get = await critique(new Request("http://local/api/critique", { method: "GET" }));
  assert.equal(get.status, 405);
  const post = await critique(new Request("http://local/api/critique", {
    method: "POST",
    headers: { "content-type": "application/json", "x-typesafe-key": "test-key-not-real" },
    body: "{}",
  }));
  assert.equal(post.status, 415);
});

test("function source does not log, and the repo does not contain a committed key", () => {
  const root = path.resolve(import.meta.dirname, "..");
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "dist", ".git"].includes(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }
  for (const file of [...walk(path.join(root, "netlify")), ...walk(path.join(root, "src"))]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /console\.(log|debug|info|warn|error|trace)\b/, file);
    assert.doesNotMatch(text, /TYPESAFE_API_KEY\s*=\s*['"][^'"]+['"]/, file);
  }
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /localStorage/);
  assert.match(readme, /bring-your-own-key|Bring your own key/i);
});
