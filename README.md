# InferBench

> Model-serving test suite: Vegeta-driven **load testing** + functional **end-to-end smoke tests** for OpenAI-compatible inference APIs (vLLM, vLLM-omni, gateway proxies, etc.).

Two modes in one web UI, sharing a single API config:

| Mode | What it answers | How |
|------|----------------|-----|
| 🚀 Load Test | "How fast / how stable under load?" | Vegeta attack, QPS × duration, parses report into P50/P95/P99 + throughput |
| 🧪 E2E Smoke | "Does the deployed pipeline actually work?" | One-shot requests through text / image+text / text→audio paths, asserts content |

## Quick Start

```bash
# Prerequisites: Node.js ≥ 18, Vegeta (for load test mode only)
brew install vegeta          # macOS
# or download from https://github.com/tsenart/vegeta/releases

npm install
npm start                    # http://localhost:3001
```

## Supported API Types

Load Test mode builds request bodies for:
- `chat` — OpenAI `/v1/chat/completions`
- `embeddings` — `/v1/embeddings`
- `rerank` — `/rerank`
- `images` — `/v1/images/generations`
- `chat-vision` — image (URL or data URL) + text, returns text
- `chat-audio` — text in, audio out (`modalities: ["audio"]`, exercises omni pipelines)

E2E Smoke mode ships three probes out of the box:
1. **Text** — deterministic prompt + marker assertion
2. **Image + Text** — 8×8 red PNG embedded inline, asserts the reply mentions "red"
3. **Text → Audio** — asserts the response contains a choice with a valid WAV header

No external assets: the image is generated in-process; the audio is validated by RIFF/WAVE magic bytes.

## Project Layout

```
inferbench/
├── server.js                          # Thin entry: mounts routes
├── src/
│   ├── routes/
│   │   ├── health.js                  # /api/health, /api/check-vegeta
│   │   ├── load-test.js               # /api/load-test  (vegeta attack)
│   │   └── e2e-test.js                # /api/e2e-test   (functional probes)
│   ├── builders/                      # Shared: build OpenAI-compat request bodies
│   │   ├── chat.js / embeddings.js / rerank.js / images.js
│   │   ├── multimodal.js              # chat-vision, chat-audio
│   │   └── index.js                   # dispatcher + VALID_API_TYPES
│   ├── probes/                        # E2E assertions
│   │   ├── text.js / image.js / audio.js
│   ├── parsers/
│   │   └── vegeta-report.js
│   └── utils/
│       ├── tiny-png.js                # stdlib 8×8 PNG generator
│       └── wav.js                     # RIFF/WAVE header validator
├── public/
│   ├── index.html                     # Tabs: Load Test / E2E Smoke
│   ├── style.css
│   ├── app.js                         # ES-module entry, no build step
│   └── pages/
│       ├── shared-config.js           # API config form + cURL import
│       ├── load-test.js               # form submit + results rendering
│       └── e2e-test.js                # 3 cards, audio player, image preview
├── tmp/                               # runtime artifacts (vegeta request.json/txt)
├── ai-docs/
└── package.json
```

## Adding a Probe or API Type

**New API type (load test payload):** add a file under `src/builders/`, dispatch in `src/builders/index.js`, add the option to the dropdown in `public/index.html`, and read the new fields in `public/pages/shared-config.js`.

**New E2E probe:** add a file under `src/probes/` exporting an async function, register it in the `PROBES` map in `src/routes/e2e-test.js`, and add a card in `public/index.html` + render logic in `public/pages/e2e-test.js`.

## API Endpoints

- `GET  /api/health`
- `GET  /api/check-vegeta`
- `POST /api/load-test` — `{ apiType, apiUrl, apiKey, model, rate, duration, ...typeParams }`
- `POST /api/e2e-test` — `{ apiUrl, apiKey, model, customHeaders?, probes: ["text","image","audio"] }`

## Notes

- For pods without public internet (common in closed K8s clusters), use `data:image/...;base64,...` URLs in Chat · Vision. `makeSolidPng()` in `src/utils/tiny-png.js` shows the minimal stdlib way to generate one.
- The audio probe looks for `message.audio.data` on any `choice` in the response (vLLM-omni may return audio in `choices[1]` rather than `choices[0]` depending on `modalities` setting).
- `tmp/` is gitignored except for `.gitkeep`.

## License

MIT
