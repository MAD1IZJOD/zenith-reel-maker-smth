# Zenith Agentic Reel Maker

A festival reel studio with a real FFmpeg export pipeline. Choose one of seven styles, record or upload three shots, customize the edit, then preview and download a vertical H.264/AAC MP4: Fast (720 × 1280) or Quality (1080 × 1920). Regenerate from the same footage without recording again. A second mode, **Podcast to reels** (`/podcast`), turns one long recording into three captioned 9:16 reels: it transcribes locally, finds three distinct moments, and renders each in a faceless or original-video style with word-highlighted captions, ready to download individually or as a ZIP.

**Three shots. Infinite stories.** Stage 1 replaced the renderer with a validated Edit Decision List compiled into one FFmpeg pass: measured auto-trim, per-style pacing, curated transitions, consistent colour grades, libass typography with bundled open fonts, word-highlighted speech captions from real timestamps, and speech-safe audio mixing. Creative planning uses a local Qwen model when one can run and transparent rules otherwise. See `deploy/STAGE1_REPORT.md` and `deploy/STAGE2_REPORT.md`.

Visitor entry: `/festival`. The ordinary creator entry remains at `/`. Staff controls are at `/operator`, the projector screen at `/display`, and privacy information at `/privacy`.

## Run locally

Requirements: Node.js 20.9+; FFmpeg/FFprobe (5.1 or newer) with libx264, AAC, libass (`subtitles`), xfade, colortemperature and sidechaincompress. Typography uses the OFL fonts bundled in `public/fonts` (licences alongside). FFmpeg is configured with `FFMPEG_PATH` and `FFPROBE_PATH`. Optional: Ollama with a Qwen model for creative planning, and Python 3.11/3.12 for local transcription (below).

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000/festival`. The repository bundles original synthetic sample clips and seven real rendered previews. Recreate them with `npm run generate:samples` and `npm run generate:previews`. They contain no participant footage or copyrighted soundtrack.

Camera access requires HTTPS or localhost. A phone visiting a laptop's HTTP LAN address cannot use browser recording; gallery upload and the phone-camera file-input fallback remain available according to browser capabilities. Camera recordings intentionally do not request a microphone. Uploaded clips can retain their original audio.

Copy `.env.example` to `.env.local` only when configuring paths and limits. No external AI credential is required; every model runs locally and everything falls back to deterministic behaviour when it cannot. Operator routes stay disabled until a random `OPERATOR_SECRET` of at least 32 characters is configured. The optional leaderboard defaults to disabled.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:api
npm run verify:remix
npm run verify:beats
npm run verify:finishing
npm run verify:aesthetics   # 18 real exports: black frames, geometry, audio, ending; contact sheets
npm run benchmark:render    # measured timings on this machine
npm run fixtures:fetch      # optional CC-BY real-footage fixtures (Tears of Steel)
npm run verify:transcription && npm run verify:highlights && npm run verify:speech
npm run verify:qwen         # live local model check; reports a fallback honestly
npm run verify:url-ingest   # real public-domain link import through the SSRF guards
npm run verify:discovery    # highlight selection on a real recording
npm run verify:faceless     # every faceless style and caption look, objective checks + contact sheets
npm run verify:podcast      # one recording -> three reels, timings, warm re-style, ZIP
npm run build
npx playwright install chromium
npm run verify:browser
```

Browser tests automatically prefer installed stable Chrome (then Edge) on Windows. Stable Chrome is the verified recording environment. You can select a channel explicitly:

```powershell
$env:PLAYWRIGHT_CHANNEL = "chrome" # msedge is also configurable
npm run verify:browser
```

The browser test uses generated Y4M footage as a synthetic camera feed through native getUserMedia and MediaRecorder. That verifies browser recording and upload integration, **not physical Android/iOS hardware**. Headless browser builds can lack recording/capture support even when ordinary playback works. Do not mistake a headless capability failure for a successful camera test.

`npm test` runs twelve unit/API tests, renders all seven styles from the same sample clips, checks dimensions/H.264/AAC/30fps/duration/covers and distinct output hashes, decodes every MP4 fully, then renders original-audio/customization fixtures including unsafe punctuation handled as literal text.

`verify:remix` renders two real MP4s from one immutable source snapshot, replaces a current source clip between renders, and verifies that the original snapshot remains unchanged. `verify:beats` measures 3-second and 12-second exports, validates their cut positions and decodes non-silent AAC. `verify:finishing` compares actual decoded frames from independent title, caption, order, typography, visibility and trim changes; it also verifies that a cover-only edit leaves the movie unchanged.

`verify:api` uses isolated `data/api-tests` storage and checks uploads, replacement, three-shot validation, session ownership, byte-range playback, retrieval expiry/revocation, operator authorization, screening consent/approval/removal/revocation, server-computed leaderboard points, bounded multi-session admission, duplicate prevention, mixed orientations/codecs, short clips, completed-job recovery, an interrupted-job fixture, startup cleanup and scheduled cleanup with no HTTP traffic. Allow roughly two minutes for the idle cleanup check.

`verify:browser` runs the production application on port 3102 using isolated `data/browser-tests` storage. It exercises responsive layouts, real upload/render/playback/download, retrieval in another browser context, consent and operator display controls, refresh/network recovery, regeneration, synthetic recording/retake/cleanup and denied-camera upload fallback. Test videos and screenshots stay under ignored `data/`.

## What is implemented

- Seven configuration-driven edits: Main Character Entry, Beat Sync, Glow Up, Plot Twist, Retro Cam, Squad Montage and Movie Trailer.
- Real browser camera lifecycle, capability/MIME negotiation, countdown, timer, stop, retake, camera switch, interruption recovery and gallery/native-camera fallback.
- Size, container, extension, media-probe and actual decode validation; uploads normalize rotation, frame rate and aspect ratio into a playable H.264 preview. Short clips are padded with a held final frame during rendering.
- Vibes, editable titles/hooks/captions, caption style, shot ordering, original-audio normalization, real transitions and three extracted covers.
- Bounded rendering and upload admission, job-specific clip snapshots, durable stages, retries, unique outputs and explicit restart recovery.
- Private browser session credentials, expiring/revocable reel-only QR retrieval, streaming range responses and attachment downloads.
- Festival entry, safe challenge guidance, transparent server-validated Reel Battle completion points, an opt-in curated-nickname daily leaderboard behind a flag.
- Separate screening/reuse consent, adult/guardian attestation, staff approval before public playback, visitor revocation and protected operator controls.
- Public display that falls back to clearly labeled sample edits and shows only a public creator QR.
- Startup/periodic retention cleanup, readiness checks, operational counters, production launcher with draining, container and HTTPS proxy examples.

The Director, Editor, Hook, Caption and Cover roles are deterministic modules. They do not use or claim an LLM. No generative-video service, external analytics, paid provider or synthetic substitution for visitor footage is involved. Beat Lab includes two original synthesized soundtracks: Neon Steps (120 BPM) and After Hours (90 BPM). The waveform measures the actual audio file; beat positions come from its defined composition grid. No automatic beat detection is claimed. Regenerate the tracks with `npm run generate:audio`.

## Create, compare and finish

1. Choose a preset. Select the three storyboard frames for their real filming instructions. Keyboard, touch and reduced-motion navigation use the same controls.
2. Record or upload each shot. Shot Coach reports source size, duration, orientation and a few brightness samples. At most two suggestions appear; imperfect but valid clips remain usable.
3. Review the clips, then open **Customize reel**. Finishing Studio separates Titles, Captions, Shots, Beat Lab and Cover into contextual panels. Original footage stays intact.
4. In Beat Lab choose silent output, original clip sound, or an original studio track. Preset rhythm preserves the preset; Auto, Energetic and Cinematic use four, two and eight beats per segment; Custom supports 1–6 seconds per segment. Timeline markers show transition starts. Browser source preview is guidance, not a simulation of all FFmpeg effects.
5. Generate and inspect the actual MP4 and three extracted covers. **Open Remix Lab** renders another style from that output's immutable source snapshot, retains both files, and supports independent playback, downloads and a saved favorite. On phones switch between the Original and Remix panels; desktop also offers synchronized starts.
6. **Open Finishing Studio** returns to your editable current project. Adjust title timing, typography, closing title, captions, shot order/start offsets, or cover title/default moment; generate a new export to apply changes.

Opening titles run for 1–4 seconds, shortened if necessary to avoid the last 1.5-second closing title. Shot starts must leave at least 0.5 seconds of source footage; shorter remaining footage is held to fill the chosen edit. Standard export is 720 × 1280/30fps H.264/AAC only. There is no pretend high-quality export control.

## Local AI, transcription and podcast sources

**Creative model (optional).** With `CREATIVE_MODEL_PROVIDER=auto` the server discovers a Qwen model in Ollama (`http://127.0.0.1:11434`) or an OpenAI-compatible server. It receives measured shot facts (duration, light, motion, speech), never pixels, and must answer with schema-validated JSON choosing from trusted options. Slow, invalid or failed answers, including out-of-memory model loads, fall back to transparent rules. `npm run verify:qwen` shows which one answered. An 8B model needs roughly 6 GB of free memory.

**Transcription (optional).** faster-whisper runs on the CPU from an isolated, git-ignored environment:

```powershell
uv venv --python 3.12 .venv-transcribe
uv pip install --python .venv-transcribe\Scripts\python.exe "faster-whisper==1.2.*"
```

The `base` model (about 145 MB, downloaded to the user's Hugging Face cache on first use) is the default; set `TRANSCRIBE_MODEL` to `tiny`, `small` or an `.en` variant. Transcripts are stored per source and reused. Without the environment, speech captions fall back to title cards and the podcast page offers SRT/WebVTT/JSON import.

**Video/podcast sources.** Upload (streamed to disk, up to `MAX_SOURCE_MB`/`MAX_SOURCE_MINUTES`) or import a direct public media link. Links are restricted to http(s) on standard ports; private, loopback, link-local and metadata addresses are refused, redirects are re-validated and DNS rebinding is blocked at connect time. Video-platform page links (YouTube, Spotify, Instagram, …) are deliberately not downloaded. Every source requires confirmation that the visitor owns it or has permission. If a platform link cannot be imported, upload the file instead.

**Higgsfield (optional, billable).** `src/lib/providers/higgsfield.ts` implements the documented Kling 4.0 video-edit API. It is disabled unless `ENABLE_HIGGSFIELD=true` with API credentials from console.higgsfield.ai, needs an explicit spend authorization per request, and is never part of the fast export path.

## Podcast to reels

1. **Source.** Upload a video or audio file, or paste a direct link. Choose clip length (15-30, 30-45 or 45-60 s) and a focus (educational, motivational, storytelling, business, technology, funny, respectful debate or general). Confirm you may make clips from it.
2. **Analysis.** Real stages only: preparing, transcribing (with the seconds of audio actually processed) and finding highlights. Transcripts and analysis are cached per recording, so changing the look never repeats them.
3. **Highlights.** Candidate windows are computed from sentence boundaries and word timestamps (never cutting a word), scored on a transparent editorial rubric (hook, completeness, takeaway, story, emotion, focus, clean ending, speech density, loudness emphasis, topic coherence) with penalties for sponsor reads, intros, disclaimers and list fragments, then chosen for distinctness. When local Qwen can run, it scores a shortlist through short aliases it cannot invent and may suggest hooks; hooks that add numbers or claims not in the speech are rejected. Titles are the speaker's own words. Fewer than three good moments are reported honestly. Scores are editorial heuristics, not predicted views.
4. **Style.** Minimal Podcast (gradient, waveform drawn from the real audio), Cinematic Quote (abstract colour field from the footage, or a gradient for audio-only sources), Contextual B-Roll (your own clips, or spoken keywords as motion graphics) or Original video. Caption looks: Clean, Creator Pop, Cinematic, Minimal. Optional original soundtracks duck under speech.
5. **Reels.** Three independent render jobs in the bounded queue: completed reels appear as soon as they finish, a failure affects only its reel, and each reel can be retitled, retrimmed, swapped or retried alone. Downloads are named `zenith-reel-01.mp4`...; Download all streams a ZIP of the reels that are actually ready.

Local model memory is released right after ranking or planning so renders never compete with an idle 8B model.

## Architecture

- `src/components/studio.tsx` and `src/hooks/use-camera.ts`: shared creator workflow and owned media-stream lifecycle.
- `src/components/creative`: landing, lazy spatial storyboard, Shot Coach, Remix Lab, Beat Lab, Finishing Studio and honest Agent Crew states.
- `src/hooks/use-studio-motion.ts`: scoped finite GSAP animations, cleanup and reduced-motion media queries. The 3D presentation uses CSS perspective and native video, not WebGL textures; essential controls require no GPU capability detection.
- `src/lib/creative/timeline.ts`: one edit-decision timeline shared by the ruler and FFmpeg; `options.ts` validates submitted settings while restoring legacy drafts with defaults.
- `src/lib/edit`: Edit Decision List schema (`edl.ts`), curated styles and grades (`styles.ts`) and the deterministic planners for clip reels and long-form highlights (`planner.ts`).
- `src/lib/video/compile.ts`, `ass.ts`, `render.ts`, `mezzanine.ts`: EDL to one FFmpeg graph, libass typography and captions, job rendering, and aspect-preserving upload normalization.
- `src/lib/ai/provider.ts`, `creative-planner.ts`: local model discovery, structured output and rules fallback.
- `src/lib/sources`, `transcription`, `highlights`, `providers`: safe ingestion, faster-whisper worker interface (`workers/transcribe.py`), highlight discovery (`discover.ts`) and the optional Higgsfield adapter.
- `src/lib/podcast`: three-reel batches (per-reel jobs, edits, retries) and the streaming ZIP; `src/components/podcast`: the Podcast to reels flow and gallery.
- `src/lib/video/shot-analysis.ts`: source metadata plus up to three small luminance samples; no aesthetic scoring, face recognition or semantic/stability analysis.
- `src/lib/presets`, `creative`, `ai`: declarative edit configuration, safe deterministic guidance and completion rules.
- `src/app/api/uploads`, `src/lib/video`: bounded validation, decode/normalization, rendering and cover extraction.
- `src/lib/jobs/queue.ts`: process-wide bounded queue with input snapshots, persistence and recovery.
- `src/lib/storage` and `src/lib/server`: configured private disk, serialized atomic records, session/operator capabilities and range streaming.
- `src/lib/festival`: consent records, approved public playlist, curated leaderboard and aggregate metrics.
- `src/instrumentation.ts`: startup recovery and every-minute cleanup.
- `scripts/serve.mjs`: long-running production HTTP server and bounded shutdown.
- `deploy/RUNBOOK.md`: deployment, operation, privacy boundaries, rollback and real-device launch gates.
- `deploy/PHASE5_REPORT.md`: Phase 5 feature evidence, test outputs, limitations and commit verification.

Build artifacts are isolated: development uses `.next`, production `.next-production`, API tests `.next-api-test`. Generated Next type files are not tracked; stable framework references are in `src/types/next.d.ts`.

## Privacy and limitations

Session IDs are locators, not standalone credentials. A separate HTTP-only cookie authorizes original clips, drafts and jobs. Retrieval tokens permit only one finished reel and expire in at most six hours or with the reel; they never grant editing or original footage. Public screening requires an explicit submission and operator approval, with a separate reuse choice. Staff must confirm guardian permission for minors; the app records attestation, not verified age.

The default session lifetime is 24 hours. Startup and every-minute cleanup operate while the host is running, protect active jobs, and resume after downtime. Deletion is not guaranteed while the host is offline. Backups need their own retention policy. Download counts measure requests; operational counters are not unique-visitor analytics.

An immutable, private source snapshot is retained per footage revision for Remix Lab and expires with its session. Multiple exports from unchanged footage reuse it; replacing clips creates a new revision on the next export. This consumes extra temporary disk space. Existing pre-Phase-5 reels remain accessible but need one fresh render before source-preserving remix is available. The favorite choice is a private draft preference and does not grant screening consent.

This is **one host and one Node process**, not horizontally scalable infrastructure. Keep render concurrency conservative until measured on the actual host. Do not use shared local storage with multiple app instances or deploy the queue to serverless functions.

Physical phone recording, real public HTTPS/QR access, container execution, projector behavior and capacity on the intended host remain deployment checks. A shared stall browser can retain earlier session cookies/history; use a fresh guest profile per visitor for stronger kiosk privacy.

## Production

```powershell
npm run build
# Configure PUBLIC_BASE_URL, DATA_DIR, OPERATOR_SECRET and HTTPS before public use.
npm start
```

`npm start` is production mode and defaults to secure cookies. For localhost-only production testing, explicitly set `COOKIE_SECURE=false`. Keep it true on the public host.

Use a persistent writable disk and HTTPS reverse proxy. Do not expose the data volume or app port directly. No hosting service or public URL is automatically provisioned.

See [the operational runbook](deploy/RUNBOOK.md) for exact Docker Compose activation, environment variables, health/readiness, shutdown, cleanup, rollback and the Android/iOS checklist.
