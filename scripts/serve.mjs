import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import critique from "../netlify/functions/critique.js";
import search from "../netlify/functions/search.js";
import thumbnail from "../netlify/functions/thumbnail.js";
import video from "../netlify/functions/video.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT || 4173);
const csp = "default-src 'self'; img-src 'self' blob: data: https://i.ytimg.com https://*.ytimg.com; media-src 'none'; connect-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const routes = {
  "/api/critique": critique,
  "/api/thumbnail": thumbnail,
  "/api/search": search,
  "/api/video": video,
};

async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = `http://${req.headers.host || "127.0.0.1"}${req.url}`;
  return new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

async function sendFile(res, filePath) {
  const data = await readFile(filePath);
  const type = types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": data.length,
    "x-content-type-options": "nosniff",
    "content-security-policy": csp,
    "x-frame-options": "DENY",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://local");
    const handler = routes[url.pathname];
    if (handler) {
      const response = await handler(await toRequest(req), {});
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const buf = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, headers);
      res.end(buf);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const requested = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(root, requested));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let target = filePath;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = path.join(target, "index.html");
    } catch {
      if (requested === "/" || requested === "/index.html") target = path.join(root, "index.html");
      else {
        res.writeHead(404).end("Not found");
        return;
      }
    }
    if (req.method === "HEAD") {
      res.writeHead(200).end();
      return;
    }
    await sendFile(res, target);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "Server error");
  }
});

try {
  await stat(path.join(root, "index.html"));
} catch {
  console.error("dist/index.html is missing. Run npm run build first.");
  process.exit(1);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`http://127.0.0.1:${port}`);
});
