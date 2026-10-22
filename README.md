# Jev Thumbnail Critic

A public, bring-your-own-key critic for YouTube thumbnails and slides. Each image is one [TypeSafe System One](https://docs.typesafe.ai/introduction/quickstart) request to Jev. About ten atomic questions run in parallel, and the page combines them into a 0–100 score.

The live site is [https://jev-thumbnail-critic.netlify.app](https://jev-thumbnail-critic.netlify.app).

## Bring your own key

Paste a TypeSafe API key into the page. It lives in tab memory. **Remember on this device** writes it to `localStorage` under `jev-thumbnail-critic.apiKey` and nowhere else. Closing the tab forgets a key that was not remembered. Clearing the checkbox deletes the saved copy.

This site does not have a TypeSafe account. The key is never committed, never written to a server log, and never stored by the app. The Netlify function `POST /api/critique` reads it from the `X-TypeSafe-Key` header, forwards `Authorization: Bearer …` to `https://api.typesafe.ai/v1/systemone`, and discards it. Image requests also send `TypeSafe-Danger-Zone-Images: true`. Upstream error text is scanned so a key that echoes back is replaced before the response reaches the browser.

You pay TypeSafe, not this site. Input tokens are about $0.042 per million. Output tokens are free. The example set is 15 requests.

Get a key from the [TypeSafe console](https://console.typesafe.ai). The [quick start](https://docs.typesafe.ai/introduction/quickstart) explains the API.

## What a critique sends

One multipart request per image:

- `model` is `jev-preview` (Jev 1.14). Box questions need 1.14. `jev-latest` is Jev 1.13 and cannot locate a headline.
- The image is a single asset in `state`, referenced by every question.
- Scores: headline readability at phone size, clutter, contrast, and a large expressive face (thumbnails) or text density (slides).
- Nouls: one clear focal point, text legible on a phone, text over a busy background, and whether a headline is present.
- A Choice for the single fix to make first.
- A Box around the headline. It is drawn only when the headline Noul is at least 0.50.

The browser resizes and pads each image to 280–1568 px per side and re-encodes a JPEG before the request. YouTube thumbnails are loaded through `GET /api/thumbnail?id=`, which tries `maxresdefault.jpg` and falls back to `hqdefault.jpg`, so the canvas is not tainted. Search uses YouTube's public endpoints and does not need a second key.

## How the score is made

These are the reference `--no-brand` weights from the Python critic, renormalised to 1. The page shows them to 3 decimals.

Thumbnails: readability 0.278, contrast 0.167, clutter 0.167, focal point 0.111, legible on a phone 0.111, text over a busy background 0.056, face 0.111.

Clutter, text on a busy background, and slide text density are inverted, so a higher score is always better. A Score or Choice under 0.50 confidence is flagged. A Noul between 0.35 and 0.65 is flagged as unsure. The headline box uses the same 0.50 line. Flags do not change the number.

There is no brand score. These are other people's thumbnails.

YouTube cards include a QR code and a link to `https://www.youtube.com/watch?v=ID`. **Download share card** saves a PNG of the thumbnail, the score, and that QR. The footer QR opens this app.

## Run it locally

```bash
npm install
npm test
npm run build
npm run serve
```

Open http://127.0.0.1:4173 . `npm test` mocks TypeSafe. It checks the request shape, the weights, and that `/api/critique` returns 401 when the key header is missing.

`npx netlify dev` also works if you want the Netlify dev proxy instead of `scripts/serve.mjs`.

## Deploy

`.github/workflows/deploy.yml` runs the tests and builds on every pull request and on every push to `main`.

- Pull requests get a Netlify preview (`netlify deploy`, including functions).
- Pushes to `main` deploy production (`netlify deploy --prod`) to the site in `NETLIFY_SITE_ID`.

The workflow reads `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` from GitHub Actions secrets. It does not put them in the repo. Merging to `main` is what publishes https://jev-thumbnail-critic.netlify.app.

`[functions.critique] timeout` is 60 seconds. If the Netlify plan rejects that, lower it in `netlify.toml`. A timed-out critique shows an error on the card rather than a partial score.

Image and Box support is still marked preview by TypeSafe. Treat the scores as a second opinion.
