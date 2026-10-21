import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";
import "@fontsource/inter/latin-ext-800.css";
import "./styles.css";
import examples from "./data/videos.json";
import {
  INVERT,
  QUESTION_LABELS,
  analyse,
  buildCritiqueForm,
  flagForAnswer,
  fixLabel,
  formatCost,
  formatViews,
  isVideoId,
  parseVideoIds,
  scoreLevel,
  showHeadlineBox,
  sortItems,
  topChoices,
  watchUrl,
  weightsFor,
} from "./critic.js";
import { isPngOrJpeg, prepareImage } from "./images.js";
import { qrCanvas } from "./qr.js";
import { downloadShareCard } from "./share.js";
import { forgetRememberedKey, loadRememberedKey, saveRememberedKey } from "./storage.js";

const MAX_ITEMS = 20;
const CONCURRENCY = 2;
const FLAG_LABELS = {
  ...QUESTION_LABELS,
  main_fix: "Fix first",
  has_headline: "Has a headline",
  headline_box: "Headline box",
};

const state = {
  items: [],
  searchHits: [],
};

const cards = new Map();
let seq = 0;
let abort = null;

const app = document.querySelector("#app");

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "hidden") node.hidden = Boolean(value);
    else if (key === "disabled") node.disabled = Boolean(value);
    else if (key === "checked") node.checked = Boolean(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of (Array.isArray(children) ? children : [children]).flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function appUrl() {
  return `${location.origin}/`;
}

function setError(message) {
  const el = document.getElementById("form-error");
  el.textContent = message || "";
  el.hidden = !message;
}

function setStatus(message) {
  document.getElementById("status").textContent = message || "";
}

function uploadKind() {
  return document.querySelector("input[name='upload-kind']:checked")?.value === "slide" ? "slide" : "thumbnail";
}

function weightCard(kind, title) {
  const weights = weightsFor(kind, false);
  return h("article", { class: "panel weight-card" }, [
    h("h2", {}, title),
    h(
      "ul",
      { class: "weights" },
      Object.entries(weights).map(([key, value]) =>
        h("li", {}, [
          h("span", {}, `${QUESTION_LABELS[key] || key}${INVERT.has(key) ? " · inverted" : ""}`),
          h("strong", {}, value.toFixed(3)),
        ]),
      ),
    ),
  ]);
}

function thumbImg(id, alt) {
  const img = h("img", {
    alt,
    src: `/api/thumbnail?id=${encodeURIComponent(id)}`,
    loading: "lazy",
    decoding: "async",
  });
  img.addEventListener("error", () => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = "1";
    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  });
  return img;
}

function friendlyFlag(flag) {
  const splitAt = flag.indexOf(": ");
  if (splitAt === -1) return flag;
  const key = flag.slice(0, splitAt);
  const rest = flag.slice(splitAt + 2);
  return `${FLAG_LABELS[key] || key.replaceAll("_", " ")}: ${rest}`;
}

function buildCard(item) {
  const img = item.videoId
    ? thumbImg(item.videoId, item.title)
    : h("img", { alt: item.title, src: item.displayUrl });
  const box = h("div", { class: "hbox", hidden: true });
  const score = h("div", { class: "score-badge", hidden: true });
  const pending = h("div", { class: "pending", hidden: true }, "Scoring");
  const rank = h("p", { class: "rankline" });
  const title = h("h3", { class: "title" });
  const channel = h("p", { class: "channel" });
  const fix = h("p", { class: "fix" });
  const also = h("p", { class: "also" });
  const flags = h("ul", { class: "flags" });
  const subs = h("div", { class: "subs" });
  const boxNote = h("p", { class: "box-note" });
  const error = h("p", { class: "card-error", hidden: true });
  const tokens = h("p", { class: "tokens" });
  const share = h("button", { type: "button", class: "ghost", disabled: true }, "Download share card");
  const remove = h("button", { type: "button", class: "ghost" }, "Remove");
  share.addEventListener("click", async () => {
    try {
      await downloadShareCard(item, appUrl());
    } catch (err) {
      setError(err.message || "Could not download the share card.");
    }
  });
  remove.addEventListener("click", () => {
    if (item.status === "running") return;
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    state.items = state.items.filter((entry) => entry !== item);
    renderBoard();
  });

  let qrRow = null;
  if (item.videoId) {
    const url = watchUrl(item.videoId);
    const canvas = qrCanvas(url, 96);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `QR code linking to ${url}`);
    qrRow = h("div", { class: "qr-row" }, [
      canvas,
      h("div", { class: "qr-copy" }, [
        h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Watch video"),
        h("span", { class: "hint" }, url),
      ]),
    ]);
  }

  const article = h("article", { class: "card" }, [
    h("div", { class: "thumb" }, [img, box, score, pending]),
    h("div", { class: "card-body" }, [
      rank,
      title,
      channel,
      fix,
      also,
      error,
      flags,
      subs,
      boxNote,
      qrRow,
      tokens,
      h("div", { class: "actions" }, [share, remove]),
    ]),
  ]);
  article._refs = { img, box, score, pending, rank, title, channel, fix, also, flags, subs, boxNote, error, tokens, share, remove };
  return article;
}

function fillSubs(container, item) {
  container.replaceChildren();
  if (!item.result) return;
  for (const [key, weight] of Object.entries(item.result.weights)) {
    const answer = item.result.answers[key];
    const points = 100 * weight * item.result.parts[key];
    const bits = [];
    if (answer?.type === "score") {
      const top = Math.max(...Object.keys(answer.legend || {}).map(Number));
      bits.push(`${Number(answer.score).toFixed(2)} / ${top}`);
      const level = scoreLevel(answer);
      if (level) bits.push(level);
    } else if (answer?.type === "noul") {
      bits.push(`p(yes) ${Number(answer.noul).toFixed(2)}`);
    }
    bits.push(`weight ${weight.toFixed(3)}`);
    if (INVERT.has(key)) bits.push("inverted");
    container.append(
      h("div", { class: flagForAnswer(key, answer) ? "sub low" : "sub" }, [
        h("span", { class: "name" }, QUESTION_LABELS[key] || key),
        h("strong", {}, points.toFixed(1)),
        h("span", { class: "meta" }, bits.join(" · ")),
      ]),
    );
  }
}

function fillCard(article, item, rank) {
  const refs = article._refs;
  item.rank = rank;
  article.classList.toggle("is-first", rank === 1);
  if (refs.img.src !== item.displayUrl && item.displayUrl) {
    if (!item.videoId || item.displayUrl.startsWith("blob:")) refs.img.src = item.displayUrl;
  }
  if (item.videoId && !item.displayUrl.startsWith("blob:") && !refs.img.getAttribute("src")) {
    refs.img.src = item.displayUrl;
  }
  refs.img.alt = item.title || "Thumbnail";
  refs.pending.hidden = item.status !== "running";
  refs.rank.textContent = rank
    ? `#${rank} · ${item.result.overall.toFixed(1)} / 100 · ${item.kind}`
    : item.status === "running"
      ? `Scoring · ${item.kind}`
      : item.kind;
  refs.title.textContent = item.title || "Untitled";
  const views = formatViews(item.views);
  refs.channel.textContent = [item.channel, views].filter(Boolean).join(" · ");
  refs.error.hidden = !item.error;
  refs.error.textContent = item.error || "";

  if (!item.result) {
    refs.score.hidden = true;
    refs.fix.textContent = "";
    refs.also.textContent = "";
    refs.flags.replaceChildren();
    refs.subs.replaceChildren();
    refs.box.hidden = true;
    refs.boxNote.textContent = "";
    refs.tokens.textContent = "";
    refs.share.disabled = true;
    refs.remove.hidden = item.status === "running";
    return;
  }

  refs.score.hidden = false;
  refs.score.textContent = String(Math.round(item.result.overall));
  const choice = item.result.answers.main_fix;
  const tops = topChoices(choice, 3);
  refs.fix.textContent = `Fix first · ${fixLabel(choice?.choice)}`;
  refs.also.textContent = tops.length
    ? tops.map(([name, probability]) => `${fixLabel(name)} ${Math.round(probability * 100)}%`).join(" · ")
    : "";
  refs.flags.replaceChildren(...item.result.flags.map((flag) => h("li", {}, friendlyFlag(flag))));
  fillSubs(refs.subs, item);

  const box = showHeadlineBox(item.result.answers) ? item.result.answers.headline_box.box : null;
  if (box && item.preparedBlob) {
    refs.box.hidden = false;
    refs.box.style.left = `${box.left * 100}%`;
    refs.box.style.top = `${box.top * 100}%`;
    refs.box.style.width = `${(box.right - box.left) * 100}%`;
    refs.box.style.height = `${(box.bottom - box.top) * 100}%`;
    const confidence = item.result.answers.headline_box.confidence;
    refs.boxNote.textContent = `Cyan outline · headline box${typeof confidence === "number" ? ` · ${Math.round(confidence * 100)}% sure` : ""}`;
  } else {
    refs.box.hidden = true;
    refs.boxNote.textContent = item.result.answers.has_headline
      ? "No clear headline, so the box stays hidden."
      : "";
  }

  const usage = item.result.usage || {};
  const dims = item.sentWidth ? `${item.sentWidth}×${item.sentHeight} · ` : "";
  refs.tokens.textContent = `${item.result.model || "jev-preview"} · ${dims}${Number(usage.input_tokens || 0).toLocaleString()} in / ${Number(usage.output_tokens || 0).toLocaleString()} out · est. ${formatCost(usage.input_tokens)}`;
  refs.share.disabled = false;
  refs.remove.hidden = item.status === "running";
}

function renderBoard() {
  const ordered = sortItems(state.items);
  const board = document.getElementById("board");
  const keep = new Set();
  let rank = 0;
  for (const item of ordered) {
    keep.add(item.localId);
    const itemRank = item.result ? (rank += 1) : null;
    let card = cards.get(item.localId);
    if (!card) {
      card = buildCard(item);
      cards.set(item.localId, card);
    }
    fillCard(card, item, itemRank);
    board.append(card);
  }
  for (const [id, card] of cards) {
    if (keep.has(id)) continue;
    card.remove();
    cards.delete(id);
  }
  document.getElementById("board-empty").hidden = state.items.length > 0;
  document.getElementById("board-heading").textContent = state.items.some((item) => item.result)
    ? "Ranked results"
    : "Queue";
  const critique = document.getElementById("critique");
  if (!abort) critique.disabled = state.items.length === 0;
  const scored = state.items.filter((item) => item.result);
  const input = scored.reduce((sum, item) => sum + Number(item.result.usage?.input_tokens || 0), 0);
  const output = scored.reduce((sum, item) => sum + Number(item.result.usage?.output_tokens || 0), 0);
  document.getElementById("totals").textContent = scored.length
    ? `${scored.length} scored · ${input.toLocaleString()} input tokens · ${output.toLocaleString()} output tokens · est. ${formatCost(input)}. Output tokens are free.`
    : "";
}

function renderSearch() {
  const root = document.getElementById("search-results");
  root.replaceChildren();
  if (!state.searchHits.length) return;
  root.append(
    h("button", {
      type: "button",
      class: "ghost",
      onclick: () => addYouTube(state.searchHits.map((hit) => hit.id), Object.fromEntries(state.searchHits.map((hit) => [hit.id, hit]))),
    }, "Add all"),
    h("ul", { class: "hits" }, state.searchHits.map((hit) => h("li", {}, [
      thumbImg(hit.id, hit.title || hit.id),
      h("div", {}, [h("strong", {}, hit.title || hit.id), h("span", {}, hit.channel || hit.id)]),
      h("button", {
        type: "button",
        class: "ghost",
        onclick: () => addYouTube([hit.id], { [hit.id]: hit }),
      }, "Add"),
    ]))),
  );
}

function addYouTube(ids, meta = {}) {
  let added = 0;
  for (const id of ids) {
    if (!isVideoId(id) || state.items.some((item) => item.videoId === id)) continue;
    if (state.items.length >= MAX_ITEMS) {
      setError(`The list stops at ${MAX_ITEMS} images.`);
      break;
    }
    const known = meta[id] || {};
    const item = {
      localId: (seq += 1),
      source: "youtube",
      videoId: id,
      title: known.title || id,
      channel: known.channel || "",
      views: known.views ?? null,
      kind: "thumbnail",
      displayUrl: `/api/thumbnail?id=${encodeURIComponent(id)}`,
      status: "ready",
      result: null,
      error: "",
    };
    state.items.push(item);
    added += 1;
    if (!known.title) enrich(item);
  }
  renderBoard();
  return added;
}

async function enrich(item) {
  try {
    const res = await fetch(`/api/video?id=${encodeURIComponent(item.videoId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (item.title === item.videoId && data.title) item.title = data.title;
    if (!item.channel && data.channel) item.channel = data.channel;
    const card = cards.get(item.localId);
    if (card) fillCard(card, item, item.rank || null);
  } catch {
    /* A missing title does not block the critique. */
  }
}

async function addFiles(fileList) {
  for (const file of fileList) {
    if (state.items.length >= MAX_ITEMS) {
      setError(`The list stops at ${MAX_ITEMS} images.`);
      break;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError(`${file.name} is over 15 MB.`);
      continue;
    }
    if (!(await isPngOrJpeg(file))) {
      setError(`${file.name} needs to be a PNG or JPEG.`);
      continue;
    }
    const objectUrl = URL.createObjectURL(file);
    state.items.push({
      localId: (seq += 1),
      source: "upload",
      file,
      title: file.name,
      channel: "",
      kind: uploadKind(),
      displayUrl: objectUrl,
      objectUrl,
      status: "ready",
      result: null,
      error: "",
    });
  }
  renderBoard();
}

async function bytesFor(item, signal) {
  if (item.preparedBlob) return item.preparedBlob;
  let source = item.file;
  if (!source) {
    const res = await fetch(item.displayUrl, { signal });
    if (!res.ok) throw new Error("Could not load that thumbnail.");
    source = await res.blob();
  }
  const prepared = await prepareImage(source);
  if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  item.objectUrl = URL.createObjectURL(prepared.blob);
  item.displayUrl = item.objectUrl;
  item.preparedBlob = prepared.blob;
  item.sentWidth = prepared.width;
  item.sentHeight = prepared.height;
  renderBoard();
  return prepared.blob;
}

async function critiqueOne(item, key, signal) {
  item.result = null;
  item.error = "";
  item.status = "running";
  renderBoard();
  try {
    const blob = await bytesFor(item, signal);
    const { form } = buildCritiqueForm(item.kind, blob);
    const res = await fetch("/api/critique", {
      method: "POST",
      headers: { "X-TypeSafe-Key": key },
      body: form,
      signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const fallback = res.status === 504 || res.status === 502
        ? "The critique timed out. Try again, or raise the Netlify function timeout if the plan allows it."
        : `The critic returned HTTP ${res.status}.`;
      throw new Error(data?.error || fallback);
    }
    const scored = analyse(data, item.kind, false);
    item.result = {
      ...scored,
      answers: data.answers,
      model: data.model,
      usage: data.usage || {},
    };
    item.status = "done";
    return "ok";
  } catch (err) {
    if (signal.aborted || err?.name === "AbortError") {
      item.status = "ready";
      return "abort";
    }
    item.status = "error";
    item.error = err.message || "The critique failed.";
    return "error";
  } finally {
    renderBoard();
  }
}

async function runPool(list, worker) {
  let cursor = 0;
  async function next() {
    while (!abort?.signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      await worker(list[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => next()));
}

async function startCritique() {
  const key = document.getElementById("api-key").value.trim();
  if (!key) {
    setError("Paste your TypeSafe API key. It stays in this browser.");
    document.getElementById("api-key").focus();
    return;
  }
  if (!state.items.length) {
    setError("Add a YouTube video or an image first.");
    return;
  }
  setError("");
  const remember = document.getElementById("remember");
  if (remember.checked) saveRememberedKey(localStorage, key);
  abort = new AbortController();
  const button = document.getElementById("critique");
  button.textContent = "Stop";
  button.disabled = false;
  const queue = state.items.slice();
  let finished = 0;
  let ok = 0;
  setStatus(`Scoring 0 of ${queue.length}…`);
  await runPool(queue, async (item) => {
    const outcome = await critiqueOne(item, key, abort.signal);
    finished += 1;
    if (outcome === "ok") ok += 1;
    if (!abort.signal.aborted) setStatus(`Scoring ${finished} of ${queue.length}…`);
  });
  setStatus(abort.signal.aborted ? `Stopped after ${ok} score${ok === 1 ? "" : "s"}.` : `Scored ${ok} of ${queue.length}.`);
  abort = null;
  button.textContent = "Critique";
  renderBoard();
}

function mountFooter() {
  const url = appUrl();
  const canvas = qrCanvas(url, 128);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `QR code linking to ${url}`);
  document.getElementById("footer-qr").append(
    canvas,
    h("div", {}, [
      h("strong", {}, "QR for this page"),
      h("p", { class: "hint" }, [
        h("a", { href: url }, url),
        " Scan it to open Jev Thumbnail Critic on another device.",
      ]),
    ]),
  );
}

function mount() {
  const keyInput = h("input", {
    id: "api-key",
    type: "password",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: "Paste your TypeSafe API key",
  });
  const remember = h("input", { id: "remember", type: "checkbox" });
  const urlInput = h("textarea", {
    id: "urls",
    placeholder: "https://www.youtube.com/watch?v=…\nor a video id, one per line",
  });
  const searchInput = h("input", {
    id: "search",
    type: "search",
    placeholder: "Search YouTube, no extra key",
    maxlength: "80",
  });
  const fileInput = h("input", {
    id: "file",
    type: "file",
    accept: "image/png,image/jpeg,.png,.jpg,.jpeg",
    multiple: true,
    hidden: true,
  });
  const drop = h("div", { class: "drop" }, [
    h("strong", {}, "Upload PNG or JPEG slides and thumbnails"),
    h("p", { class: "hint" }, "They are resized in your browser to 280–1568 px before anything is sent."),
    h("button", { type: "button", class: "ghost", onclick: () => fileInput.click() }, "Choose images"),
    fileInput,
  ]);

  app.append(
    h("a", { class: "skip", href: "#board" }, "Skip to results"),
    h("header", { class: "wrap head" }, [
      h("p", { class: "kicker" }, "Bring your own TypeSafe key"),
      h("h1", { class: "site-title" }, "Jev Thumbnail Critic"),
      h("p", { class: "lede" }, "Score a YouTube thumbnail or a slide with one System One request. About ten atomic questions run in parallel, and this page turns them into a 0–100 score with the weights below."),
    ]),
    h("div", { class: "wrap stack" }, [
      h("section", { class: "panel stack" }, [
        h("div", { class: "field" }, [
          h("label", { for: "api-key" }, "TypeSafe API key"),
          h("div", { class: "key-row" }, [
            keyInput,
            h("label", { class: "remember" }, [remember, "Remember on this device"]),
            h("button", {
              type: "button",
              class: "ghost",
              onclick: () => {
                keyInput.value = "";
                remember.checked = false;
                forgetRememberedKey(localStorage);
              },
            }, "Clear key"),
          ]),
          h("p", { class: "hint" }, [
            "The key stays in this tab. Remember writes it to localStorage on this browser only. Get a key from the ",
            h("a", { href: "https://console.typesafe.ai", target: "_blank", rel: "noopener noreferrer" }, "TypeSafe console"),
            ".",
          ]),
        ]),
        h("form", {
          class: "field",
          onsubmit: (event) => {
            event.preventDefault();
            const parsed = parseVideoIds(urlInput.value);
            if (!parsed.ids.length) {
              setError(parsed.unknown.length ? "Those didn't look like YouTube video ids." : "Paste a YouTube URL or a video id.");
              return;
            }
            addYouTube(parsed.ids);
            urlInput.value = "";
            setError(parsed.unknown.length ? `Skipped: ${parsed.unknown.slice(0, 3).join(", ")}` : "");
          },
        }, [
          h("label", { for: "urls" }, "YouTube URLs or video ids"),
          urlInput,
          h("div", { class: "toolbar" }, [
            h("button", { type: "submit" }, "Add videos"),
            h("button", {
              type: "button",
              class: "ghost",
              onclick: () => {
                const before = state.items.length;
                addYouTube(examples.map((video) => video.id), Object.fromEntries(examples.map((video) => [video.id, video])));
                setError(state.items.length === before ? "Those example videos are already in the list." : "");
                document.getElementById("board").scrollIntoView({ behavior: "smooth", block: "start" });
              },
            }, "Load example"),
          ]),
        ]),
        h("div", { class: "choice-row" }, [
          h("span", { class: "legend" }, "Score uploads as"),
          h("label", {}, [h("input", { type: "radio", name: "upload-kind", value: "thumbnail", checked: true }), "Thumbnail"]),
          h("label", {}, [h("input", { type: "radio", name: "upload-kind", value: "slide" }), "Slide"]),
        ]),
        drop,
        h("form", {
          class: "field",
          onsubmit: async (event) => {
            event.preventDefault();
            const query = searchInput.value.trim();
            if (!query) return;
            const slot = document.getElementById("search-status");
            slot.textContent = "Searching…";
            state.searchHits = [];
            renderSearch();
            try {
              const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Search failed.");
              state.searchHits = data.results || [];
              slot.textContent = state.searchHits.length ? "" : "No videos found.";
              renderSearch();
            } catch (err) {
              slot.textContent = err.message || "Search failed.";
            }
          },
        }, [
          h("label", { for: "search" }, "YouTube search"),
          h("div", { class: "toolbar" }, [
            searchInput,
            h("button", { type: "submit", class: "ghost" }, "Search"),
          ]),
          h("p", { id: "search-status", class: "hint" }, "Uses YouTube's public search. No Data API key."),
          h("div", { id: "search-results" }),
        ]),
        h("div", { class: "toolbar" }, [
          h("button", { type: "button", id: "critique", disabled: true, onclick: () => (abort ? abort.abort() : startCritique()) }, "Critique"),
          h("button", {
            type: "button",
            class: "ghost",
            onclick: () => {
              if (abort) return;
              for (const item of state.items) if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
              state.items = [];
              renderBoard();
            },
          }, "Clear list"),
        ]),
        h("p", { id: "form-error", role: "alert", hidden: true }),
        h("p", { class: "hint" }, "Each image is one request on your key. The example set is 15 requests. Input is about $0.042 per million tokens, and output tokens are free."),
      ]),
    ]),
  );

  const weights = h("div", { class: "weight-grid" }, [
    weightCard("thumbnail", "Thumbnails"),
    weightCard("slide", "Slides"),
  ]);
  const formula = h("p", { class: "hint" }, "Overall = 100 × sum of weight × signal. Signals are 0–1. A Score is divided by its top level. A Noul is already a probability. Clutter, text on a busy background, and slide text density are inverted (1 − value) so a higher score is always better. These are the reference brand-free weights, renormalised to 1 and shown to 3 decimals. A Score or Choice under 0.50 confidence is flagged. A Noul from 0.35 to 0.65 is flagged as unsure. The headline box uses that same 0.50 line. Flags do not change the number. Requests use jev-preview (Jev 1.14) because Box needs it. jev-latest is Jev 1.13.");
  const weightSection = app.querySelector(".wrap.stack");
  weightSection.append(h("section", { class: "stack" }, [
    h("h2", {}, "How the score is made"),
    weights,
    formula,
  ]));

  app.append(
    h("section", { class: "wrap" }, [
      h("div", { class: "section-head" }, [
        h("h2", { id: "board-heading" }, "Queue"),
      ]),
      h("p", { id: "status", "aria-live": "polite" }),
      h("p", { id: "totals" }),
      h("p", { id: "board-empty", class: "empty" }, "Nothing queued yet. Paste a YouTube link, upload a PNG or JPEG, or load the Copilot example set."),
      h("div", { id: "board", class: "board" }),
    ]),
    h("footer", { class: "wrap footer" }, [
      h("div", { id: "footer-qr", class: "footer-qr" }),
      h("p", {}, "Your API key stays in this page's memory. Remember on this device writes it to localStorage and nowhere else. The /api/critique function reads the key from a request header, forwards it to TypeSafe with TypeSafe-Danger-Zone-Images: true, and does not store or log it. Thumbnails are fetched from i.ytimg.com through /api/thumbnail so the page can read the pixels. Images you critique are sent to TypeSafe with your key. This site does not have a TypeSafe account and does not keep results."),
      h("p", { class: "hint" }, [
        h("a", { href: "https://docs.typesafe.ai/introduction/quickstart" }, "TypeSafe quick start"),
        " · ",
        h("a", { href: "https://docs.typesafe.ai/images" }, "Image requests"),
        " · ",
        h("a", { href: "https://github.com/anorthernman-developer/jev-thumbnail-critic" }, "Source"),
      ]),
    ]),
  );

  const saved = loadRememberedKey(localStorage);
  if (saved) {
    keyInput.value = saved;
    remember.checked = true;
  }
  keyInput.addEventListener("input", () => {
    if (remember.checked) saveRememberedKey(localStorage, keyInput.value.trim());
  });
  remember.addEventListener("change", () => {
    if (remember.checked) saveRememberedKey(localStorage, keyInput.value.trim());
    else forgetRememberedKey(localStorage);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = "";
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("drag");
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  });

  mountFooter();
  renderBoard();
}

mount();
