# Squad Reel Studio

A festival reel studio with a real FFmpeg export pipeline. Choose one of seven styles, record or upload three shots, customize the edit, then preview and download a vertical 720 × 1280 H.264/AAC MP4. Regenerate from the same footage without recording again.

Visitor entry: `/festival`. The ordinary creator entry remains at `/`. Staff controls are at `/operator`, the projector screen at `/display`, and privacy information at `/privacy`.

## Run locally

Requirements: Node.js 20.9+; FFmpeg/FFprobe with libx264, AAC, drawtext and xfade; Arial Bold on Windows or DejaVu Sans Bold on Linux. FFmpeg is configured with `FFMPEG_PATH`, `FFPROBE_PATH` and optional `FFMPEG_FONT`.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000/festival`. The repository bundles original synthetic sample clips and seven real rendered previews. Recreate them with `npm run generate:samples` and `npm run generate:previews`. They contain no participant footage or copyrighted soundtrack.

Camera access requires HTTPS or localhost. A phone visiting a laptop's HTTP LAN address cannot use browser recording; gallery upload and the phone-camera file-input fallback remain available according to browser capabilities. Camera recordings intentionally do not request a microphone. Uploaded clips can retain their original audio.

Copy `.env.example` to `.env.local` only when configuring paths and limits. No external AI credential is required. Operator routes stay disabled until a random `OPERATOR_SECRET` of at least 32 characters is configured. The optional leaderboard defaults to disabled.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:api
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

`npm test` runs eight unit/API tests, renders all seven styles from the same sample clips, checks dimensions/H.264/AAC/30fps/duration/covers and distinct output hashes, decodes every MP4 fully, then renders original-audio/customization fixtures including unsafe punctuation handled as literal text.

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

The Director, Editor, Hook, Caption and Cover roles are deterministic modules. They do not use or claim an LLM. No generative-video service, external analytics, paid provider or synthetic substitution for visitor footage is involved. Beat Sync uses a defined visual timing grid; no licensed soundtrack or automatic beat detection is bundled.

## Architecture

- `src/components/studio.tsx` and `src/hooks/use-camera.ts`: shared creator workflow and owned media-stream lifecycle.
- `src/lib/presets`, `creative`, `ai`: declarative edit configuration, safe deterministic guidance and completion rules.
- `src/app/api/uploads`, `src/lib/video`: bounded validation, decode/normalization, rendering and cover extraction.
- `src/lib/jobs/queue.ts`: process-wide bounded queue with input snapshots, persistence and recovery.
- `src/lib/storage` and `src/lib/server`: configured private disk, serialized atomic records, session/operator capabilities and range streaming.
- `src/lib/festival`: consent records, approved public playlist, curated leaderboard and aggregate metrics.
- `src/instrumentation.ts`: startup recovery and every-minute cleanup.
- `scripts/serve.mjs`: long-running production HTTP server and bounded shutdown.
- `deploy/RUNBOOK.md`: deployment, operation, privacy boundaries, rollback and real-device launch gates.

Build artifacts are isolated: development uses `.next`, production `.next-production`, API tests `.next-api-test`. Generated Next type files are not tracked; stable framework references are in `src/types/next.d.ts`.

## Privacy and limitations

Session IDs are locators, not standalone credentials. A separate HTTP-only cookie authorizes original clips, drafts and jobs. Retrieval tokens permit only one finished reel and expire in at most six hours or with the reel; they never grant editing or original footage. Public screening requires an explicit submission and operator approval, with a separate reuse choice. Staff must confirm guardian permission for minors; the app records attestation, not verified age.

The default session lifetime is 24 hours. Startup and every-minute cleanup operate while the host is running, protect active jobs, and resume after downtime. Deletion is not guaranteed while the host is offline. Backups need their own retention policy. Download counts measure requests; operational counters are not unique-visitor analytics.

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
