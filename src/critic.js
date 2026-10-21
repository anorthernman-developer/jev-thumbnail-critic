import { MODEL, PRICE_PER_MTOK_USD } from "../shared/typesafe.js";
import { isVideoId, watchUrl } from "../shared/video-id.js";

export { watchUrl, isVideoId };

export const LOW_CONF = 0.5;
export const NOUL_UNSURE = [0.35, 0.65];
export const INVERT = new Set(["clutter", "text_over_busy", "text_density"]);

/** Base weights from the Python critic, before dropping on_brand. */
export const BASE_WEIGHTS = {
  thumbnail: {
    readability: 0.25,
    contrast: 0.15,
    clutter: 0.15,
    focal_point: 0.1,
    legible_phone: 0.1,
    text_over_busy: 0.05,
    face: 0.1,
    on_brand: 0.1,
  },
  slide: {
    readability: 0.2,
    contrast: 0.15,
    clutter: 0.15,
    text_density: 0.2,
    focal_point: 0.1,
    legible_phone: 0.1,
    text_over_busy: 0.05,
    on_brand: 0.05,
  },
};

export const QUESTION_LABELS = {
  readability: "Headline readability",
  contrast: "Contrast",
  clutter: "Clutter",
  focal_point: "Clear focal point",
  legible_phone: "Text legible on a phone",
  text_over_busy: "Text over a busy background",
  face: "Large expressive face",
  text_density: "Text density",
  on_brand: "On brand",
};

export const FIX_LABELS = {
  headline_too_small: "Headline too small",
  low_contrast: "Low contrast",
  too_much_text: "Too much text",
  cluttered_layout: "Cluttered layout",
  no_focal_point: "No focal point",
  nothing_major: "Nothing major",
  no_face: "No expressive face",
  off_brand: "Off brand",
};

/**
 * Brand-free mode drops on_brand and renormalises, matching critic.py --no-brand.
 * This app always calls it with brand=false.
 */
export function weightsFor(kind, brand = false) {
  const source = BASE_WEIGHTS[kind];
  if (!source) throw new Error(`Unknown kind: ${kind}`);
  const weights = { ...source };
  if (!brand) delete weights.on_brand;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const out = {};
  for (const [key, value] of Object.entries(weights)) out[key] = value / total;
  return out;
}

export function buildQuestions(kind, withBox = true) {
  const noun = kind === "thumbnail" ? "thumbnail" : "slide";
  const questions = {
    readability: {
      type: "score",
      instructions: `How readable is the main headline text in \`image\` if this ${noun} were shown small, about 320 pixels wide, on a phone screen?`,
      criteria: [
        "There is no headline, or it would be illegible at that size",
        "Readable only with effort: small, thin, or low-contrast letters",
        "Mostly readable, but some words would blur or get lost",
        "Instantly readable: large, heavy, high-contrast letters",
      ],
    },
    clutter: {
      type: "score",
      instructions: `How visually cluttered is \`image\` as a ${noun}?`,
      criteria: [
        "Clean: one or two elements with plenty of empty space",
        "Some elements competing, but the layout is still orderly",
        "Busy: many elements, shapes or text blocks competing for attention",
        "Chaotic: the eye has nowhere to rest",
      ],
    },
    contrast: {
      type: "score",
      instructions:
        "How strong is the contrast between the text and whatever is directly behind it in `image`?",
      criteria: [
        "Very weak: text colour is close to its background",
        "Weak: text is noticeably faint against the background",
        "Good: text stands out clearly",
        "Excellent: text is dark-on-light or light-on-dark with strong separation",
      ],
    },
    focal_point: {
      type: "noul",
      instructions: "Does `image` have one clear focal point that a viewer would look at first?",
    },
    legible_phone: {
      type: "noul",
      instructions: "Would all of the important text in `image` be legible on a phone screen?",
    },
    text_over_busy: {
      type: "noul",
      instructions:
        "Does text in `image` sit on top of a busy, patterned or photographic background that makes it harder to read?",
    },
  };

  const fixes = {
    headline_too_small: "The headline is too small or too thin to read quickly.",
    low_contrast: "Text does not stand out enough from its background.",
    too_much_text: "There are too many words.",
    cluttered_layout: "Too many competing elements; the layout needs simplifying.",
    no_focal_point: "Nothing clearly draws the eye first.",
    nothing_major: `The ${noun} already works well; only minor polish needed.`,
  };

  if (kind === "thumbnail") {
    questions.face = {
      type: "score",
      instructions: "How strongly does `image` feature a human face showing emotion?",
      criteria: [
        "No human face",
        "A face is present but small or neutral",
        "A large face showing clear emotion",
      ],
    };
    fixes.no_face = "It would benefit from a large, expressive human face.";
  } else if (kind === "slide") {
    questions.text_density = {
      type: "score",
      instructions: "How much text is on the slide in `image`?",
      criteria: [
        "A short headline and a few words at most",
        "A headline plus a few short bullets or labels",
        "Several paragraphs or many bullets",
        "A wall of text that an audience could not read while listening",
      ],
    };
  } else {
    throw new Error(`Unknown kind: ${kind}`);
  }

  questions.main_fix = {
    type: "choice",
    instructions: `Which single change would most improve \`image\` as a ${noun}?`,
    criteria: fixes,
  };

  if (withBox) {
    questions.has_headline = {
      type: "noul",
      instructions: "Is there a headline or title text in `image`?",
    };
    questions.headline_box = {
      type: "box",
      instructions: "the main headline or title text in `image`",
    };
  }

  return questions;
}

export function buildSystemOneBody(kind, ref) {
  return {
    model: MODEL,
    state: {
      image: ref,
      kind: kind === "thumbnail" ? "YouTube/LinkedIn thumbnail" : "presentation slide",
    },
    assets: {
      [ref]: { type: "image", part: "image" },
    },
    questions: buildQuestions(kind, true),
  };
}

export function buildCritiqueForm(kind, imageBlob) {
  const ref = `img-${crypto.randomUUID()}`;
  const payload = buildSystemOneBody(kind, ref);
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(payload)], { type: "application/json" }));
  form.append("image", imageBlob, "image.jpg");
  return { form, payload, ref };
}

export function flagForAnswer(key, answer) {
  if (!answer) return null;
  if (
    (answer.type === "score" || answer.type === "choice" || answer.type === "box") &&
    typeof answer.confidence === "number" &&
    answer.confidence < LOW_CONF
  ) {
    return `${key}: low confidence (${answer.confidence.toFixed(2)})`;
  }
  if (
    answer.type === "noul" &&
    typeof answer.noul === "number" &&
    answer.noul >= NOUL_UNSURE[0] &&
    answer.noul <= NOUL_UNSURE[1]
  ) {
    return `${key}: model unsure (p=${answer.noul.toFixed(2)})`;
  }
  return null;
}

function signalValue(key, answer) {
  if (answer.type === "score") {
    const levels = Object.keys(answer.legend || {}).map(Number).filter(Number.isFinite);
    if (!levels.length) throw new Error(`Score ${key} has no legend`);
    const top = Math.max(...levels);
    if (top <= 0) throw new Error(`Score ${key} has no top level`);
    return answer.score / top;
  }
  if (answer.type === "noul") return answer.noul;
  throw new Error(`Cannot score ${key} (${answer.type})`);
}

/**
 * Combine one System One response into a 0–100 score.
 * Weighted questions use the Python rules. The headline box and has_headline
 * answers are flagged with the same thresholds, and they do not change the score.
 */
export function analyse(response, kind, brand = false) {
  const answers = response?.answers;
  if (!answers) throw new Error("Response had no answers");
  const weights = weightsFor(kind, brand);
  const parts = {};
  const flags = [];

  for (const key of Object.keys(weights)) {
    const answer = answers[key];
    if (!answer) throw new Error(`Missing answer for ${key}`);
    let value = signalValue(key, answer);
    const flag = flagForAnswer(key, answer);
    if (flag) flags.push(flag);
    if (INVERT.has(key)) value = 1 - value;
    parts[key] = value;
  }

  const overall = 100 * Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * parts[key], 0);

  for (const key of ["main_fix", "has_headline", "headline_box"]) {
    const flag = flagForAnswer(key, answers[key]);
    if (flag) flags.push(flag);
  }

  return { overall, parts, flags, weights };
}

export function showHeadlineBox(answers) {
  const box = answers?.headline_box?.box;
  if (!box) return false;
  for (const edge of ["left", "top", "right", "bottom"]) {
    if (typeof box[edge] !== "number" || box[edge] < 0 || box[edge] > 1) return false;
  }
  if (!(box.left < box.right && box.top < box.bottom)) return false;
  const headline = answers.has_headline;
  if (headline && typeof headline.noul === "number" && headline.noul < 0.5) return false;
  return true;
}

export function topChoices(answer, count = 3) {
  return Object.entries(answer?.probabilities || {})
    .filter((entry) => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);
}

export function fixLabel(choice) {
  if (FIX_LABELS[choice]) return FIX_LABELS[choice];
  return String(choice || "Unknown").replaceAll("_", " ");
}

export function scoreLevel(answer) {
  if (answer?.type !== "score" || !answer.legend) return "";
  const label = answer.legend[String(Math.round(answer.score))];
  return typeof label === "string" ? label : "";
}

export function estimateCost(inputTokens) {
  return (Number(inputTokens) || 0) / 1e6 * PRICE_PER_MTOK_USD;
}

export function formatCost(inputTokens) {
  return `$${estimateCost(inputTokens).toFixed(5)}`;
}

export function formatViews(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K views`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K views`;
  return `${n} views`;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

export function extractVideoId(input) {
  const raw = String(input || "").trim().replace(/^[<]+|[>.,);]+$/g, "");
  if (!raw) return null;
  if (isVideoId(raw)) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isVideoId(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const fromQuery = url.searchParams.get("v");
  if (isVideoId(fromQuery)) return fromQuery;
  const parts = url.pathname.split("/").filter(Boolean);
  const markers = new Set(["shorts", "embed", "live", "v"]);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (markers.has(parts[i]) && isVideoId(parts[i + 1])) return parts[i + 1];
  }
  return null;
}

export function parseVideoIds(text) {
  const ids = [];
  const unknown = [];
  const seen = new Set();
  for (const chunk of String(text || "").split(/[\s,]+/)) {
    if (!chunk.trim()) continue;
    const id = extractVideoId(chunk);
    if (!id) {
      unknown.push(chunk.trim());
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids, unknown };
}

export function sortItems(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const group = (item) => {
        if (item.result) return 0;
        if (item.status === "running") return 1;
        if (item.status === "error") return 3;
        return 2;
      };
      const ga = group(a.item);
      const gb = group(b.item);
      if (ga !== gb) return ga - gb;
      if (ga === 0 && b.item.result.overall !== a.item.result.overall) {
        return b.item.result.overall - a.item.result.overall;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
