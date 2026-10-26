# Stage 2 engineering report

Measured 26–27 October 2026 on the development laptop (AMD Ryzen AI 7 350, 16 threads, 23.3 GB RAM, Radeon 860M, no NVIDIA GPU; Windows 11; Node 24.18; FFmpeg 8.1.2; Ollama 0.35 with `qwen3:8b`; faster-whisper 1.2.1 `base`, CPU int8). Base: `2e0d5c0`. Every number comes from a command run in this sprint; local artifacts are in ignored `data/`.

Fixtures (local only, never committed):
- LibriVox *The Art of War* (Sun Tzu), public domain: chapters 1–2 (8:26) and chapters 9–10 (14:42).
- *Tears of Steel* excerpts (Blender Foundation, CC-BY 3.0): a 62 s dialogue scene and three short clips.

**Verdict: FULL TWO-STAGE PRODUCT VERIFIED** for the local single-host product. Both modes run end to end, and Podcast to Reels has produced three real, independently accessible MP4s from one recording, through the API and through the browser UI.

Not verified:
- Physical phones (camera recording and playback).
- Public HTTPS deployment.
- Platform-link import (yt-dlp is not integrated).
- Live Higgsfield generation.

## A. Product status

**Mode A, Create from clips.** Pick one of seven styles, record or upload three moments, optionally ask the Director, then generate.
- The Director uses local Qwen (32.5 s) or transparent rules.
- Rendering is a validated edit plan compiled to one FFmpeg pass:
  - measured auto-trim and per-style pacing;
  - curated transitions and one consistent grade;
  - libass typography with title cards, or word-highlighted speech captions;
  - ducked original music;
  - Fast 720×1280 or Quality 1080×1920.
- After export: preview, download, remix, regenerate. Festival, retrieval, consent and operator features are unchanged.

**Mode B, Podcast to reels.** Upload a file or paste a direct link, choose clip length and focus, then:
1. Real-stage analysis: preparing, transcribing with true progress, finding highlights.
2. Review three highlights: editable titles and hooks, previews, trim, replace.
3. Choose a style: Minimal Podcast, Cinematic Quote, Contextual B-Roll, or Original video.
4. Generate three reels.
5. Gallery: per-reel status, preview, download (`zenith-reel-0N.mp4`), copy post caption, regenerate, retitle, retry, and a ZIP of finished reels.

## B. Podcast pipeline

1. **Input:** a streamed upload or a direct public media link.
   - SSRF defences: private, loopback, link-local, metadata and mapped IPv6 ranges are refused; standard ports only; no credentials; every redirect is re-validated; private targets are refused again at connect time against DNS rebinding.
   - Rights confirmation is required.
   - The file is probed and decoded at start, middle and end before use.
   - Platform pages are refused with guidance to upload instead.
2. **Transcription:** faster-whisper (CPU int8, VAD, measured word timestamps) in an isolated worker.
   - Progress is the seconds of audio actually processed.
   - Results are cached per source and reused when the same bytes are imported again (SHA-256).
   - SRT, WebVTT and JSON import never invents word timing.
3. **Candidates:** sentence units and cohesion-based topic boundaries; windows of the chosen length.
   - Windows padded into silence and never cutting a word; mostly-silent windows rejected.
   - Transparent editorial rubric; sponsor, intro, disclaimer, list-fragment, back-reference and topic-straddle penalties.
   - Non-maximum suppression to a shortlist of 12.
4. **Ranking:** local Qwen scores the top 6 through aliases `c1`–`c6`, constrained by a schema enum, so it cannot invent candidates.
   - It may suggest 8-word hooks; a hook is rejected if it adds numbers or shares no real words with the speech.
   - Model score (60%) and rubric (40%) are blended. If Qwen is offline, slow, out of memory or invalid, the heuristic is used and the reason recorded.
   - The model is unloaded immediately afterwards.
5. **Selection:** maximal marginal relevance gives three non-overlapping, lexically diverse moments.
   - Roles (attention, takeaway, story) are assigned; titles use the speaker's own words.
   - Post captions are marked as excerpts.
   - With fewer than three viable moments, a notice says so.
6. **Render:** one validated EDL per reel in the existing bounded queue, at most three per session.
   - Each reel has a unique render id, interval, plan, output path, caption track and status.
   - Jobs are idempotent and restart-safe; a failure affects only its own reel.
7. **Download:** private range playback, attachment downloads and a streaming ZIP of only the completed reels. Sources can't be deleted while their reels render.

## C. Qwen integration

| Item | Result |
| --- | --- |
| Runtime / model | Ollama 0.35 at `127.0.0.1:11434`, `qwen3:8b` (Q4_K_M, about 5.9 GB loaded), CPU (`size_vram` 0) |
| Measured speed | Cold load 9.2 s; output about 6 tokens/s; prompt about 45 tokens/s |
| Highlight ranking | 35.0 s (8.4 min source) and 39.5 s / 52.2 s (14.7 min source), live |
| Clip Director plan | 32.5 s live |
| Fallback | Transparent rules or heuristic, with the reason shown, whenever the model is offline, out of memory (`bad_alloc` occurred repeatedly earlier in the sprint), invalid or slower than `CREATIVE_MODEL_TIMEOUT_MS` (default 75 s) |
| Memory | Ollama peaks at about 5.7 GB during ranking. A resident model caused real FFmpeg out-of-memory (`ENOMEM`) failures, fixed by unloading immediately after use (`keep_alive: 0`, serialized with generation) |

## D. Three generated reels (real outputs)

From the 14:42 public-domain recording (`art_of_war_09-10`), Minimal Podcast, Clean captions, After Hours soundtrack ducked under speech, Fast profile, live Qwen ranking:

| Reel | Source interval | Duration | Style | Captions | Audio | Output path | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 (takeaway) | 431.2–476.8 s | 45.6 s | Minimal Podcast | Clean, word-highlighted | Speech + ducked music, AAC | `data/demo/art_of_war_09-10_sun_tzu_64kb-minimal/zenith-reel-01.mp4` | H.264 720×1280, AAC, 5.98 MB, objective checks pass |
| 2 (attention) | 727.1–765.9 s | 38.8 s | Minimal Podcast | Clean | Speech + music | `…/zenith-reel-02.mp4` | H.264 720×1280, AAC, 5.15 MB |
| 3 (story) | 810.9–855.5 s | 44.6 s | Minimal Podcast | Clean | Speech + music | `…/zenith-reel-03.mp4` | H.264 720×1280, AAC, 5.83 MB |

The same recordings were also rendered as Cinematic Quote (`data/demo/art_of_war_01-02_sun_tzu_64kb-cinematic/`) and through the browser test (Cinematic Quote, Creator Pop captions).

Hooks and titles (faithful to the reading):
- Reel 1: "When the soldiers have become attached to you" / "Soldiers must be treated in the first instance with humanity"
- Reel 2: "Then you must fight even though the ruler forbid it" / "Then you must not fight even at the ruler's bidding". Both clauses are spoken in this passage.
- Reel 3: "If we know the enemy is not open to attack" / "We have still only gone halfway towards victory"

The ZIP of all three is CRC-verified in `tests/server/podcast-batch.test.ts`.

## E. Aesthetic quality

What is actually implemented in the reels:
- **Faceless compositions:**
  - Minimal: a moving gradient plus a waveform drawn from the actual audio, which is flat during pauses.
  - Cinematic: warm graded abstract colour field with vignette (a 1/16-scale blur of footage, so no one is recognisable).
  - B-roll: the visitor's own clips with dissolves, or spoken keywords drifting faintly as motion graphics.
- **Text:** a persistent title in the speaker's words, an opening hook, centred word-highlighted captions (1.3× larger in faceless layouts, since no face needs avoiding), safe-area margins and a progress bar.
- **Audio:** speech loudness-normalised to about −14 to −18 dB RMS in exports; optional original soundtracks duck under speech.

Evidence from rendered outputs:
- Contact sheets in `data/aesthetics/faceless/`, `data/demo/*/zenith-reel-0N.jpg` and `data/aesthetics/timing/opt-review.jpg`; gallery screenshots in `data/browser-results/podcast-*`.
- Objective checks pass on every export: no black intervals, exact 9:16 with 1:1 SAR, 30 fps, duration within 0.15 s, a non-blank ending (dark-but-titled frames allowed), audible audio.

Human judgement is still required for final acceptance. "Ready to post" in the UI means a valid, finished file, not a guarantee of reach.

## F. Performance (measured)

| Stage | 8.4 min recording (Cinematic, 15–30 s clips) | 14.7 min recording (Minimal, 30–45 s clips) |
| --- | --- | --- |
| Ingestion (copy, probe, decode check, hash) | 0.3 s | 0.5 s |
| Ingestion over the network (archive.org link, 4 MB) | 31 s | — |
| Transcription (Whisper base, CPU) | 26.0 s (earlier runs 28–38 s) | 40.2 s (earlier run 54.5 s) |
| AI selection (Qwen ranking, live) | 35.9 s | 41.0 s |
| Three reels rendered | 14.5 s (15.9–19.7 s reels) | 15.8 s (38.8–45.6 s reels) |
| First reel ready | 4.3 s after Generate | 5.6 s after Generate |
| Total, source to three reels | ≈ 77 s | ≈ 97 s |
| Warm re-style (cached analysis) | analysis 15 ms, render 6.6 s | analysis 14 ms, render 29.8 s (Cinematic) |
| Peak RAM | Ollama 5.7 GB during ranking; FFmpeg 0.7 GB | Ollama 5.7 GB; FFmpeg 1.2 GB |

- Faceless backgrounds are now rendered at quarter resolution. On a 45 s reel this took Minimal from 14.7 s to 5.8 s, Cinematic from 36.6 s to 13.5 s, and the b-roll fallback to 11.9 s.
- **Mode A:** Generate to downloadable takes 2.7 s (Fast) and 13.8 s (Quality); the 30–45 s target is met.
- **Mode B:** no universal 45 s guarantee is claimed for long recordings. Transcription plus model ranking dominate (about 1 minute for 8–15 minute sources); rendering three reels takes about 15 s.
- The Whisper worker's memory could not be sampled reliably: the venv launcher hides the interpreter process, so readings of about 20 MB are not credible.

## G. Higgsfield

| Item | Status |
| --- | --- |
| Adapter | `src/lib/providers/higgsfield.ts` against the documented Kling 4.0 video-edit API: estimate, submit, status, cancel, output, presigned upload |
| Supported operation | Prompted video edit of one source video (3–30 s, 720p/1080p, 9:16 among aspect ratios), asynchronous by request id |
| Access verified | **No.** No API credential is configured; website plans and API billing are separate |
| Billable generation | **None performed** |
| Cost | Successful requests are charged per model/parameters (estimate endpoint returns USD); `failed`/`nsfw` free; cancelled queued requests refunded; outputs kept 7 days |
| Limitations | Disabled by default; needs explicit spend authorization and visitor consent to upload footage; never used for trimming, captions or audio; not exposed in the UI |

## H. Security

- **Ownership:** sessions are owned through an HTTP-only secret cookie (stored as a hash), and every source, transcript, highlight, batch, reel and ZIP route requires it.
- **Isolation:** another visitor gets 401 (wrong cookie) or 404 (own session, foreign ids); tested in `podcast-batch.test.ts` and `sources.test.ts`. Ids are random UUIDs, paths are resolved server-side from job records, and the browser never sees filesystem paths or source URLs as tokens.
- **Links:** handled by the SSRF guards in B, and the downloader is tested with re-validated redirects and size, media-type and redirect limits.
- **Uploads:** they bypass Next.js middleware, which used to truncate bodies at 10 MB, and enforce the same origin check themselves.
- **Cleanup:** sessions, sources, transcripts, batches and reels expire with the session; cleanup protects active jobs. Expired reels report "expired" rather than failing silently.
- **External providers:** consent is kept separate for any of them.

## I. Tests (executed in this sprint)

| Command | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Pass |
| `npm test` | **56/56**, plus all 7 presets rendered (H.264/AAC, 720×1280, distinct hashes) and the creative fixture |
| `npm run verify:api` | Pass (video-process peak 2) |
| `verify:remix`, `verify:beats`, `verify:finishing`, `verify:speech` | Pass |
| `verify:aesthetics` | 18/18 clip-mode exports pass objective checks |
| `verify:faceless` | 6/6 faceless and speaker renders pass (all three faceless styles, four caption looks, audio-only and video sources, own b-roll and motion-graphic fallback) |
| `verify:url-ingest` | Real archive.org public-domain link imported via redirect |
| `verify:transcription` | 8.4 min transcribed, 1266 timed words, monotonic progress, same-content reuse |
| `verify:podcast` | Three real reels from 8.4 min and 14.7 min recordings with live Qwen; warm re-style; ZIP |
| `verify:qwen` | Live Director plan from `qwen3:8b` (32.5 s) |
| `npm run build` | Pass |
| `npm run verify:browser` | **13/13** (clip studio, festival, podcast: unsafe links, a real recording to three reels with downloads/ZIP/title edit/refresh, and a large video with only one strong moment) |
| `benchmark:render` | Clip mode: Fast 2.7 s and Quality 13.8 s from Generate to downloadable |

Failed during the sprint and fixed (each fix committed):

| Failure | Fix |
| --- | --- |
| Faceless renders hit FFmpeg `ENOMEM` while Qwen stayed resident | Model released right after use |
| Transcription crashed on a Windows file-lock race in progress writes | Progress writes are best effort |
| Upload analysis exceeded the video-process bound | Single analysis pass |
| Hooks and titles were truncated mid-word | Word-boundary trimming; full sentences split before clause extraction |
| Cinematic Quote was 2.5× slower | Quarter-resolution backgrounds |
| Ranking timed out | Compact aliased request |

Still not tested:
- Physical Android/iOS devices.
- Public HTTPS and QR on a real network.
- Docker/Caddy deployment.

## J. Git

All Stage 2 commits are authored and committed by `Madhavan <175943252+MAD1IZJOD@users.noreply.github.com>`: no AI trailers, no rewritten history, normal fast-forward pushes only.

```
ee63863 feat: verify real link ingestion and reuse transcription work
5767abe feat: implement transcript highlight discovery and ranking
67dc4b7 feat: add faceless podcast compositions and per-reel edit plans
42e74de feat: generate three podcast reels from one source
ff293db feat: implement podcast-to-reels interface and result gallery
cdd746e perf: render faceless backgrounds at quarter resolution
7fc0e67 fix: size local model requests to measured CPU speed
```

This report and the README update form the final documentation commit; its hash and push status are given in the delivery message.

## K. Remaining issues

- **Critical:** none known in the tested local workflows.
- **High:**
  - Live Qwen depends on about 6 GB of free memory. Under memory pressure it falls back (by design), but highlight quality is then heuristic.
  - Long podcasts (60–90 min) were not benchmarked. Expect transcription to scale roughly linearly, about 3–5 min.
- **Medium:**
  - Platform-link import (yt-dlp) is not integrated, deliberately, on licensing and terms grounds; visitors upload their own export instead.
  - Physical-device and public-deployment checks are outstanding.
  - The faithfulness check for model hooks is lexical: it catches invented numbers and unrelated claims, not every subtle reframing.
  - `npm audit` has not been re-run.
- **Low:**
  - Whisper worker memory isn't measurable through the venv launcher.
  - Cinematic Quote on audio-only sources is about 2× slower than Minimal.
  - Qwen ranking on long recordings sees only the top-6 heuristic shortlist.

## L. Final verdict

**FULL TWO-STAGE PRODUCT VERIFIED.**
- **Mode A** (three clips into one edited reel) passes 7-preset regression, 18 aesthetic exports and browser workflows.
- **Mode B** produced three real, independently previewable and downloadable captioned reels from one recording:
  - through the API (`verify:podcast`, with live local Qwen ranking);
  - through the browser UI (`podcast.spec.ts`), with ZIP download, single-reel regeneration and refresh recovery verified.

This verdict covers the local single-host product. It is not a certification of public deployment, physical-device behaviour or platform-link import.
