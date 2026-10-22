import assert from "node:assert/strict";
import test from "node:test";
import { IMAGES_HEADER, MODEL, SYSTEM_ONE_URL } from "../shared/typesafe.js";
import {
  INVERT,
  LOW_CONF,
  NOUL_UNSURE,
  analyse,
  buildCritiqueForm,
  buildQuestions,
  buildSystemOneBody,
  estimateCost,
  extractVideoId,
  formatCost,
  parseVideoIds,
  showHeadlineBox,
  sortItems,
  weightsFor,
} from "../src/critic.js";
import { MAX_SIDE, MIN_SIDE, fitSize } from "../src/images.js";
import { forgetRememberedKey, loadRememberedKey, saveRememberedKey } from "../src/storage.js";

function legend(count) {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), `level ${i}`]));
}

function score(value, top, confidence = 0.9) {
  return { type: "score", score: value, confidence, legend: legend(top + 1) };
}

function answers(overrides = {}) {
  return {
    readability: score(3, 3),
    clutter: score(0, 3),
    contrast: score(3, 3),
    focal_point: { type: "noul", noul: 1 },
    legible_phone: { type: "noul", noul: 1 },
    text_over_busy: { type: "noul", noul: 0 },
    face: score(2, 2),
    main_fix: { type: "choice", choice: "nothing_major", confidence: 0.9, probabilities: { nothing_major: 0.9 } },
    has_headline: { type: "noul", noul: 0.9 },
    headline_box: { type: "box", confidence: 0.9, box: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.3 } },
    ...overrides,
  };
}

test("brand-free thumbnail weights match the published 3-decimal figures and sum to 1", () => {
  const weights = weightsFor("thumbnail", false);
  assert.equal(weights.on_brand, undefined);
  assert.equal(weights.readability.toFixed(3), "0.278");
  assert.equal(weights.contrast.toFixed(3), "0.167");
  assert.equal(weights.clutter.toFixed(3), "0.167");
  assert.equal(weights.focal_point.toFixed(3), "0.111");
  assert.equal(weights.legible_phone.toFixed(3), "0.111");
  assert.equal(weights.text_over_busy.toFixed(3), "0.056");
  assert.equal(weights.face.toFixed(3), "0.111");
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test("slide weights drop on_brand and still sum to 1", () => {
  const weights = weightsFor("slide", false);
  assert.equal(weights.on_brand, undefined);
  assert.equal(weights.text_density.toFixed(3), "0.211");
  assert.equal(weights.readability.toFixed(3), "0.211");
  assert.equal(weights.contrast.toFixed(3), "0.158");
  assert.equal(weights.focal_point.toFixed(3), "0.105");
  assert.equal(weights.text_over_busy.toFixed(3), "0.053");
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  const branded = weightsFor("slide", true);
  assert.ok(branded.on_brand > 0);
  assert.ok(Math.abs(Object.values(branded).reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("a clean thumbnail scores 100 and a fully cluttered one scores less", () => {
  const perfect = analyse({ answers: answers() }, "thumbnail");
  assert.ok(Math.abs(perfect.overall - 100) < 1e-9);
  assert.deepEqual(perfect.flags, []);
  const messy = analyse({ answers: answers({ clutter: score(3, 3) }) }, "thumbnail");
  assert.ok(messy.overall < perfect.overall);
});

test("mixed signals use the reference weights, inversions, and confidence flags", () => {
  const result = analyse({
    answers: answers({
      readability: score(1.5, 3, 0.4),
      clutter: score(3, 3, 0.9),
      contrast: score(2, 3, 0.8),
      focal_point: { type: "noul", noul: 0.5 },
      legible_phone: { type: "noul", noul: 0.9 },
      text_over_busy: { type: "noul", noul: 0.4 },
      face: score(1, 2, 0.2),
      main_fix: { type: "choice", choice: "cluttered_layout", confidence: 0.4, probabilities: {} },
      has_headline: { type: "noul", noul: 0.9 },
      headline_box: { type: "box", confidence: 0.4, box: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.4 } },
    }),
  }, "thumbnail");

  const expected = 100 * (
    0.5 * (0.25 / 0.9) +
    (2 / 3) * (0.15 / 0.9) +
    0 * (0.15 / 0.9) +
    0.5 * (0.1 / 0.9) +
    0.9 * (0.1 / 0.9) +
    0.6 * (0.05 / 0.9) +
    0.5 * (0.1 / 0.9)
  );
  assert.ok(Math.abs(result.overall - expected) < 1e-9, String(result.overall));
  assert.deepEqual(result.flags, [
    "readability: low confidence (0.40)",
    "focal_point: model unsure (p=0.50)",
    "text_over_busy: model unsure (p=0.40)",
    "face: low confidence (0.20)",
    "main_fix: low confidence (0.40)",
    "headline_box: low confidence (0.40)",
  ]);
});

test("confidence and noul bands are inclusive only on the inside of each rule", () => {
  assert.equal(LOW_CONF, 0.5);
  assert.deepEqual(NOUL_UNSURE, [0.35, 0.65]);
  const atHalf = analyse({ answers: answers({ readability: score(3, 3, 0.5) }) }, "thumbnail");
  assert.deepEqual(atHalf.flags, []);
  const justUnder = analyse({ answers: answers({ readability: score(3, 3, 0.49) }) }, "thumbnail");
  assert.equal(justUnder.flags[0], "readability: low confidence (0.49)");
  const edge = analyse({ answers: answers({ focal_point: { type: "noul", noul: 0.35 } }) }, "thumbnail");
  assert.equal(edge.flags[0], "focal_point: model unsure (p=0.35)");
  const outside = analyse({ answers: answers({ focal_point: { type: "noul", noul: 0.34 } }) }, "thumbnail");
  assert.deepEqual(outside.flags, []);
});

test("text density is inverted for slides", () => {
  const light = analyse({
    answers: {
      ...answers(),
      text_density: score(0, 3),
      face: undefined,
    },
  }, "slide");
  const wall = analyse({
    answers: {
      ...answers(),
      text_density: score(3, 3),
      face: undefined,
    },
  }, "slide");
  assert.ok(light.overall > wall.overall);
  assert.ok(INVERT.has("text_density"));
});

test("questions are one parallel System One batch on jev-preview, without a brand judgment", () => {
  const thumbnail = buildQuestions("thumbnail");
  assert.equal(Object.keys(thumbnail).length, 10);
  assert.equal(thumbnail.readability.type, "score");
  assert.match(thumbnail.readability.instructions, /320 pixels wide/);
  assert.equal(thumbnail.contrast.criteria[0], "Very weak: text colour is close to its background");
  assert.equal(thumbnail.focal_point.type, "noul");
  assert.equal(thumbnail.legible_phone.type, "noul");
  assert.equal(thumbnail.text_over_busy.type, "noul");
  assert.equal(thumbnail.face.criteria.length, 3);
  assert.equal(thumbnail.main_fix.type, "choice");
  assert.deepEqual(Object.keys(thumbnail.main_fix.criteria), [
    "headline_too_small",
    "low_contrast",
    "too_much_text",
    "cluttered_layout",
    "no_focal_point",
    "nothing_major",
    "no_face",
  ]);
  assert.equal(thumbnail.has_headline.type, "noul");
  assert.equal(thumbnail.headline_box.type, "box");
  assert.equal(thumbnail.headline_box.instructions, "the main headline or title text in `image`");
  assert.equal(thumbnail.on_brand, undefined);
  assert.equal(thumbnail.main_fix.criteria.off_brand, undefined);

  const slide = buildQuestions("slide");
  assert.equal(slide.text_density.criteria.length, 4);
  assert.equal(slide.face, undefined);
  assert.equal(slide.main_fix.criteria.no_face, undefined);

  const body = buildSystemOneBody("thumbnail", "img-test");
  assert.equal(body.model, MODEL);
  assert.equal(MODEL, "jev-preview");
  assert.equal(body.state.image, "img-test");
  assert.equal(body.state.kind, "YouTube/LinkedIn thumbnail");
  assert.equal("brand" in body.state, false);
  assert.deepEqual(body.assets["img-test"], { type: "image", part: "image" });
  assert.equal(SYSTEM_ONE_URL, "https://api.typesafe.ai/v1/systemone");
  assert.equal(IMAGES_HEADER, "TypeSafe-Danger-Zone-Images");
});

test("the multipart body puts the JSON request part before the image", async () => {
  const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const { form, payload, ref } = buildCritiqueForm("slide", jpeg);
  const request = new Request("https://example.test/api/critique", { method: "POST", body: form });
  const raw = await request.text();
  const requestAt = raw.indexOf('name="request"');
  const imageAt = raw.indexOf('name="image"');
  assert.ok(requestAt !== -1 && imageAt !== -1 && requestAt < imageAt);
  assert.match(raw, /application\/json/);
  assert.match(raw, /image\/jpeg/);
  assert.equal(payload.model, "jev-preview");
  assert.equal(payload.assets[ref].part, "image");
  assert.equal(payload.state.kind, "presentation slide");
  assert.equal(payload.questions.headline_box.type, "box");
});

test("headline box is hidden when the model is not sure there is a headline", () => {
  const shown = answers();
  assert.equal(showHeadlineBox(shown), true);
  assert.equal(showHeadlineBox({ ...shown, has_headline: { type: "noul", noul: 0.49 } }), false);
  assert.equal(showHeadlineBox({ ...shown, headline_box: { type: "box", confidence: 0.2, box: { left: 0.8, top: 0.1, right: 0.2, bottom: 0.4 } } }), false);
});

test("YouTube urls and bare ids parse, and other hosts do not", () => {
  const samples = [
    "J5KTpq7hVn4",
    "https://www.youtube.com/watch?v=J5KTpq7hVn4",
    "https://youtu.be/J5KTpq7hVn4?t=12",
    "https://www.youtube.com/shorts/J5KTpq7hVn4",
    "https://www.youtube.com/embed/J5KTpq7hVn4",
    "https://www.youtube.com/live/J5KTpq7hVn4",
    "https://m.youtube.com/watch?v=J5KTpq7hVn4&t=3s",
    "https://www.youtube-nocookie.com/embed/J5KTpq7hVn4",
    "<https://www.youtube.com/watch?v=-yKALFS5ewY>",
  ];
  for (const sample of samples) {
    const id = sample.includes("-yKAL") ? "-yKALFS5ewY" : "J5KTpq7hVn4";
    assert.equal(extractVideoId(sample), id, sample);
  }
  assert.equal(extractVideoId("https://example.com/watch?v=J5KTpq7hVn4"), null);
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=short"), null);
  assert.equal(extractVideoId("not a video"), null);
  const parsed = parseVideoIds("J5KTpq7hVn4\nhttps://youtu.be/J5KTpq7hVn4, -yKALFS5ewY nope");
  assert.deepEqual(parsed.ids, ["J5KTpq7hVn4", "-yKALFS5ewY"]);
  assert.deepEqual(parsed.unknown, ["nope"]);
});

test("results rank by score and leave unscored items after them", () => {
  const items = [
    { status: "ready", result: null, n: 1 },
    { status: "done", result: { overall: 40 }, n: 2 },
    { status: "error", result: null, error: "x", n: 3 },
    { status: "done", result: { overall: 90 }, n: 4 },
  ];
  assert.deepEqual(sortItems(items).map((item) => item.n), [4, 2, 1, 3]);
});

test("cost uses input tokens only at $0.042 per million", () => {
  assert.equal(estimateCost(1_000_000), 0.042);
  assert.equal(formatCost(10_000), "$0.00042");
  assert.equal(estimateCost(0), 0);
});

test("images are fitted inside 280 to 1568 on every side", () => {
  for (const [width, height] of [[2000, 2000], [100, 80], [4000, 100], [10, 5000], [1280, 720], [50, 50]]) {
    const fit = fitSize(width, height);
    assert.ok(fit.width >= MIN_SIDE && fit.height >= MIN_SIDE, `${width}x${height} -> ${fit.width}x${fit.height}`);
    assert.ok(fit.width <= MAX_SIDE && fit.height <= MAX_SIDE);
    assert.ok(fit.width * fit.height >= MIN_SIDE * MIN_SIDE);
    assert.ok(fit.width * fit.height <= MAX_SIDE * MAX_SIDE);
    assert.ok(fit.offsetX >= 0 && fit.offsetY >= 0);
  }
  assert.throws(() => fitSize(0, 10));
});

test("the remembered key is optional localStorage and failures stay quiet", () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  };
  assert.equal(loadRememberedKey(storage), "");
  saveRememberedKey(storage, "test-key-not-real");
  assert.equal(loadRememberedKey(storage), "test-key-not-real");
  forgetRememberedKey(storage);
  assert.equal(loadRememberedKey(storage), "");
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(loadRememberedKey(broken), "");
  assert.doesNotThrow(() => saveRememberedKey(broken, "x"));
  assert.doesNotThrow(() => forgetRememberedKey(broken, "x"));
});
