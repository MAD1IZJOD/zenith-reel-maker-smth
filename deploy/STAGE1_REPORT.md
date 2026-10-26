# Stage 1 engineering report

Measured on 26 October 2026 on the development laptop (AMD Ryzen AI 7 350, 16 threads, 23.3 GB RAM, Radeon 860M, no NVIDIA GPU; Windows 11; Node 24.18; FFmpeg 8.1.2). Base: `26d0d1d`. Every number below comes from a command run in this session; local artifacts live under ignored `data/`.

**Verdict: STAGE 1 PARTIALLY COMPLETE.** Every Stage 1 deliverable is implemented and verified except live Qwen inference. The Qwen3 8B model is installed and discovered, but it cannot load on this machine while other applications hold about 41 GB of committed memory (`bad_alloc`, 1.4–2.7 GB free). The adapter, validation and fallback are tested against mock runtimes; live Qwen output has not been observed.

## A. Before versus after

The baseline was rendered with the previous engine from real footage (Tears of Steel excerpts, CC-BY 3.0, Blender Foundation; local fixtures only) and inspected frame by frame.

| Why the old reels looked unpolished | What changed |
| --- | --- |
| Uploads were letterboxed to 720 × 1280 at ingest and the original was deleted, so landscape footage became a thin strip with about 60% black frame. | Uploads keep their aspect ratio in a ≤1080p mezzanine. Portrait footage fills the frame; landscape sits on a soft blurred fill (`fit-blur`) instead of black bars. |
| The title appeared twice (title and a small duplicate hook), a style label ("CINEMATIC", "HIGH ENERGY") and "ZENITH AGENTIC REEL MAKER PRESENTS" stayed on every frame, and captions were small boxed Arial. | libass typography with bundled OFL fonts (Poppins, Anton, DM Serif Display, Bebas Neue, VT323). One opening hook, per-shot title cards after it, and a closing title in the last beat. No permanent labels or branding. Social safe areas are enforced. |
| Cuts always started at second 0; fixed equal durations; `fadeblack` transitions; Beat Sync ended on a black frame. | Measured auto-trim (motion and speech activity, avoiding mid-word starts), per-style pacing, curated transitions (cut, dissolve, whip, flash accent, push), no black-frame transitions. The harness checks every export for black frames and blank endings. |
| Heavy `eq`/channel-mixer looks (yellow Retro cast), static framing. | Six restrained grades applied once over the timeline, plus gentle push-ins and drifts disabled for low-resolution sources. |
| Three encodes (upload, per-shot, final) and separate cover passes. | One FFmpeg pass renders the MP4 and three covers. |

Visual evidence: `data/aesthetics/baseline/*` (old engine), `data/aesthetics/<timestamp>/*` (18 new exports), `data/aesthetics/before-after.jpg`, `data/aesthetics/highlights/*`, `data/aesthetics/speech-captions/*`. Objective checks are automated; the aesthetic improvement itself is a human judgement made from these contact sheets.

## B. Qwen discovery

| Item | Finding |
| --- | --- |
| Runtime | Ollama 0.35.0, `C:\Users\madhavan\AppData\Local\Programs\Ollama\ollama.exe`, serving on `127.0.0.1:11434` |
| Model | `qwen3:8b` (8.2B, Q4_K_M, 5.2 GB, 40,960 context, completion/tools/thinking). Also installed: `nomic-embed-text`. |
| Other runtimes | No LM Studio (`:1234`) or llama.cpp (`:8080`). Port 8000 is an unrelated Python web dashboard. WSL Ubuntu is installed but stopped. |
| Health | Listed and discoverable; **generation fails**: `failed to allocate buffer for kv cache` / `std::bad_alloc`, both GPU-default and CPU-only (`num_gpu: 0`). |
| Inference latency | Not measurable: the model never loaded. Fallback decision time measured at 1.2–1.9 s end to end. |
| Memory | 1.4–2.7 GB free physical RAM during the session; commit charge near 52/56.8 GB, held by pre-existing user applications (none were started or stopped by this work). |
| Fallback | `rulesPlan`: vibe-based pacing, transitions and grade, motion-aware payoff ordering for Trailer and Plot Twist, preset hooks. |

To use Qwen: close memory-heavy applications so about 6 GB is free, then run `npm run verify:qwen` (or `verify:qwen -- --require`). Configuration: `CREATIVE_MODEL_PROVIDER`, `CREATIVE_MODEL_URL`, `CREATIVE_MODEL`, `CREATIVE_MODEL_TIMEOUT_MS`.

Design: server-side only; discovery via `/api/tags` or `/v1/models`; `think: false` with a JSON schema and strict Zod validation; trusted enums only; text cleaned; no shell or filter strings accepted; one generation at a time; cache keyed by endpoint and prompt; a 25 s timeout. Planning happens from the Style panel ("Ask the Director") before Generate, so exports never wait on the model.

## C. Rendering engine

- **EDL** (`src/lib/edit/edl.ts`): versioned and Zod-validated: sources, segments (source, start, duration, speed 0.75–1.5, crop, focus, motion), transitions, grade, title and caption styles, overlays, word-timed caption groups, accents, audio plan, cover. It rejects missing sources, invalid durations, overlong edits, out-of-range text and caption timing, and non-9:16 canvases. It is serialized next to each export (`edl-reel-<id>.json`); identical inputs produce identical EDLs and FFmpeg arguments (tested).
- **Planner** (`planner.ts`): style recipes per preset (beats, transitions, motion, grade, caption and title styles), Beat Lab grids, pacing scale, manual or automatic trim, speech-preserving speed rules, safe text placement, and a single-source highlight planner for Stage 2.
- **Compiler** (`src/lib/video/compile.ts`): per-segment demuxer trims; cover/fit-blur framing; push-in, pull-out and drift; cut/concat or xfade (`fade`, `slideleft`, `zoomin`); flash accents; one grade; libass; covers selected from the same graph; Fast `veryfast` CRF 21 at 720p, Quality `medium` CRF 18 at 1080p with lanczos and light sharpening.
- **Captions** (`ass.ts`, `captions/grouping.ts`): five looks (Clean Creator, Cinematic, High Energy, Minimal, Podcast Pop); balanced two-line wrapping; long-word scaling; per-word highlight events from real timestamps only. Without a transcript, title cards are used and nothing imitates speech timing.
- **Audio**: original sound with matched crossfades; soundtrack; clip sound plus soundtrack with sidechain ducking; fades; `loudnorm` to −14 LUFS integrated; limiter. Exports measured −14.1 to −17.7 dB RMS. Muted exports keep a silent AAC track.

## D. Performance

Server-side processing; network upload excluded. Source: `npm run benchmark:render` (`data/benchmarks/benchmark-2026-10-26T14-55-20-187Z.json`). Planning is the rules planner (Qwen unavailable).

| Input | Preset | Profile | Planning | Render | Total | Output | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 s | Main Character (cold, first) | Fast | 9 ms | 2.8 s | 3.2 s | 720 × 1280 | ok |
| 10 s | Main Character | Fast | 3 ms | 2.7 s | 3.0 s | 720 × 1280 | ok |
| 10 s | Main Character | Quality | 2 ms | 10.8 s | 11.4 s | 1080 × 1920 | ok |
| 10 s | Beat Sync | Fast / Quality | 2 ms | 2.0 / 8.2 s | 2.2 / 8.8 s | 720p / 1080p | ok |
| 10 s | Movie Trailer | Fast / Quality | 2 ms | 2.8 / 12.1 s | 3.5 / 12.6 s | 720p / 1080p | ok |
| 20 s | Main Character | Fast / Quality | 2 ms | 2.7 / 9.5 s | 2.9 / 9.7 s | 720p / 1080p | ok |
| 20 s | Beat Sync | Fast / Quality | 2 ms | 2.1 / 9.2 s | 2.9 / 9.7 s | 720p / 1080p | ok |
| 20 s | Movie Trailer | Fast / Quality | 2 ms | 2.8 / 12.5 s | 2.9 / 13.3 s | 720p / 1080p | ok |
| 20 s | Movie Trailer via job queue, Generate → downloadable | Fast | 2 ms | 3.3 s | **3.6 s** | 720 × 1280 | ok |
| 20 s | Movie Trailer via job queue, Generate → downloadable | Quality | 2 ms | 11.6 s | **11.8 s** | 1080 × 1920 | ok |

- Upload processing (mezzanine and analysis, three clips): 4.7 s for 10 s of input, 8.5 s for 20 s.
- Speech captions, three 6.5 s spoken shots: first export 13.0 s (9.0 s transcription), regeneration 4.0 s (cached).
- Peak FFmpeg memory: 0.5–0.76 GB Fast, 1.07–1.47 GB Quality.
- Before tuning, the same benchmark measured 4.05 s (Fast) and 17.9 s (Quality) end to end. The old engine took 4.4–10.9 s for Fast-equivalent 720p exports.
- `h264_amf` was tested: no speed gain (2.9 vs 2.7 s), 46% larger files, SSIM 0.987 against libx264. It is not used.
- The remaining bottleneck is the Quality profile's 1080p x264 `medium` encode.

**The 30–45 second target is met** for short prepared inputs on this hardware, in both profiles, with Qwen excluded (it cannot run here). A live Qwen plan would add model time before Generate, not inside the export.

## E. Podcast foundation

- **Inputs:** streamed raw-body upload (MP4, MOV, WebM, MKV, MP3, M4A, WAV, OGG, FLAC, AAC containers; 1 GB / 90 min defaults) and direct public media links. Platform pages are refused with guidance; yt-dlp was evaluated and deliberately not integrated (platform terms, DRM and access-control risk).
- **Ingestion safety:** rights confirmation, SSRF defences (private, loopback, link-local, metadata and mapped IPv6 ranges; standard ports; no credentials; redirects re-validated; connect-time lookup against DNS rebinding), size, time and disk limits, decode validation at start, middle and end, per-session storage and isolation.
- **Fixed while building this:** Next.js truncates request bodies over 10 MB that pass through middleware. Clip uploads above 10 MB were silently cut. Upload routes now bypass middleware and enforce the same origin check themselves. A real 18 MB upload is verified in the browser suite.
- **Transcription:** faster-whisper 1.2.1, `base`, CPU int8, VAD, measured word timestamps, in `.venv-transcribe` (Python 3.12, git-ignored). 62 s of dialogue took 4.8 s (0.08× real time); a repeat request reuses the stored transcript (5 ms). The worker decodes WAV itself because PyAV 19 removed an option faster-whisper 1.2.1 passes. SRT, WebVTT and JSON import are supported without inventing word times.
- **Highlights:** sentence-aligned windows (15–60 s) padded into silence and never cutting a word; a transparent heuristic score labelled as such; overlap-free selection; optional Qwen re-ranking restricted to known candidate ids; API `GET /api/sources/{id}/candidates`.
- **Proof:** `verify:highlights` renders a real highlight as three 9:16 reels with word-highlighted captions (Fast 3.1–3.3 s, Quality 15.1 s, all objective checks pass).

**Remaining for Stage 2:** the three-reel generation workflow and its UI, highlight reel styling or templates, faceless and audio-only compositions, gallery and batch outputs, optional generative effects, and live Qwen ranking once memory allows.

## F. Higgsfield

| Item | Finding |
| --- | --- |
| Documented operations | Kling 4.0 video edit (`POST /kling-video/v4.0/video-edit`: prompt, one source `video_url`, ≤5 reference videos, ≤10 images, duration 3–30 s, 720p/1080p, aspect ratio including 9:16; sources over 30 s are trimmed; 2 GiB per URL), async `request_id`, status (`queued`, `in_progress`, `completed`, `failed`, `nsfw`, `canceled`), cancel, presigned `video/mp4` uploads, cost estimate (`POST /estimate/<model>` returns USD), 7-day output retention, account concurrency limits with `429` and `Retry-After`. |
| Auth | `Authorization: Key <KEY_ID>:<KEY_SECRET>` from console.higgsfield.ai; the docs say never call it from browser code. |
| Billing | Successful requests are charged; `failed` and `nsfw` are free; cancelled queued requests are refunded. The docs do not say whether website subscription credits work with the API. |
| Adapter | `src/lib/providers/higgsfield.ts` implements capabilities, estimate, submit, status, cancel, output and consented upload. Disabled by default; billable calls need `ENABLE_HIGGSFIELD=true`, credentials and an explicit spend authorization. 4 mocked-transport tests. |
| Credentials present | **No** |
| Live generation tested | **No** (no credentials; no paid calls were authorized). |
| Fit for fast rendering | Unsuitable for the 30–45 s path: asynchronous, queued, billed per request, and requires uploading visitor footage to a third party. It suits an opt-in "premium AI style" in Stage 2. |

## G. Tests (executed in this session)

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass |
| `npm test` | 49 unit and server tests plus 7-preset and creative renders. First run: 48/49, one sources-test assertion failed once while a large `git push` ran in parallel. Re-runs, 3 repeated combined runs and the file alone: all pass. Recorded as an unexplained one-off. **Final full run: 49/49 passed, 7 preset renders and the creative fixture passed.** |
| `npm run verify:api` | Pass, after two regressions it caught were fixed (video-process peak bound; mixed-media duration now compared with the planned timeline). Video process peak 2. |
| `verify:remix`, `verify:beats`, `verify:finishing`, `verify:render`, `verify:creative-render` | Pass |
| `verify:aesthetics` | 18/18 exports pass (no black frames, 9:16 with 1:1 SAR, 30 fps, duration within 0.15 s, non-blank ending, audible when requested) |
| `verify:transcription`, `verify:highlights`, `verify:speech` | Pass (real speech, real timestamps) |
| `verify:qwen` | Ran; model unavailable (out of memory), rules fallback reported |
| `npm run build` | Pass (Next.js 15.5.28) |
| `npm run verify:browser` | 12 tests. Full run: 10 passed, 2 failed (a renamed-label test bug, fixed; and a Chrome MediaRecorder probe returning 0 bytes before any app code ran). Festival file re-run: 5/5 pass. **Final full run: 12/12 passed (1.6 min).** |

## H. Git

All commits authored and committed as `Madhavan <175943252+MAD1IZJOD@users.noreply.github.com>`, with no AI trailers, no rewritten history and normal fast-forward pushes only:

```
548d116 feat: implement adaptive cinematic edit engine
0bdf915 feat: integrate local qwen creative planning
39db7dd feat: add director planning, look and export profile controls
ccaa3be feat: establish secure podcast media ingestion
892fdc0 feat: add local transcription and highlight candidates
d3b8379 feat: add create-from-video/podcast workspace
11169bc feat: add word-level speech captions to clip reels
6191a01 feat: add optional higgsfield enhancement adapter
97978f7 perf: benchmark real reel generation and tune encoder threads
77bd6f8 fix: keep upload analysis to one bounded FFmpeg process
52cd925 test: follow the renamed reel name field in the festival workflow
c8736b9 chore: regenerate style previews with the new edit engine
```

The final documentation commit, push result and clean-tree check are reported in the delivery message.

## I. Stage 2 handoff

**Ready to reuse**
- `planHighlightEdit(source, start, end, words, hook, captionStyle, profile, music)` produces a single-source EDL.
- `executeEdl(edl, { sourcePaths, output, workDirectory, coverPrefix })` renders an MP4 plus three covers in one pass.
- `candidateWindows`, `selectNonOverlapping`, `validateCandidate`, `rankCandidates`, `hookFrom`.
- `startTranscription`, `readTranscript`, `transcriptWords`, `importTranscript`; `shotTranscripts` for clips.
- `createSource`, `finishIngest`, `readSource`, `sourceMediaPath`, `downloadMedia`, `parseMediaUrl`.
- `LocalModelProvider.structured`, `planCreative`; `HiggsfieldProvider`.
- `inspectExport` (objective export checks), `prepareFixtureSession`, `fixtureClip`.

**Data schemas:** `edlSchema`, `transcriptSchema`, `highlightCandidateSchema`, `SourceRecord`, `planSchema`.

**APIs**
- `/api/plan`, `/api/ai/health`
- `/api/sources` (GET list, POST link)
- `/api/sources/upload` (PUT stream)
- `/api/sources/{id}` (GET, DELETE)
- `/api/sources/{id}/transcript` (GET, POST transcribe/import)
- `/api/sources/{id}/candidates` (GET, `rank=model`)
- `/api/sources/{id}/media` (private range playback)

**Fixtures:** `npm run fixtures:fetch` (CC-BY Tears of Steel excerpts including a 62 s dialogue); synthetic fallbacks in `scripts/fixtures.ts`.

**To do**
- Three-reel job type: batch three highlight renders. The queue currently allows one active job per session.
- Highlight gallery UI.
- Faceless and audio-only templates: `planHighlightEdit` needs a visual source.
- Per-highlight hook editing.
- Live Qwen once memory allows.
- Optional Higgsfield premium flow with an estimate-then-confirm UI.

**Blockers and risks**
- Qwen memory headroom on this laptop.
- Physical-device camera and public HTTPS remain unverified (unchanged from Phase 5).
- The Quality profile's peak FFmpeg memory is about 1.5 GB.
- Next.js `middlewareClientMaxBodySize` affects any future upload route under the middleware matcher.
- `npm audit` was not re-run in this session.

## J. Verdict

**STAGE 1 PARTIALLY COMPLETE.** The renderer, captions, audio, profiles, ingestion, transcription, highlights, benchmarks and UI are implemented, committed and verified with real exports. The Qwen adapter is complete and tested, but live Qwen inference is blocked by available memory on this machine and has not been observed producing a plan.
