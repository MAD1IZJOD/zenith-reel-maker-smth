# Squad Reel Studio

Squad Reel Studio is a local, mobile-first festival reel maker. A visitor chooses a style, follows a deterministic three-shot Director, records or uploads clips, customizes the edit, then receives a real vertical H.264/AAC MP4 and selectable cover images rendered with FFmpeg.

The core workflow is:

`Welcome → preset → Director → record/upload → review → customize → render → preview/download/regenerate`

No paid AI provider is required. The Director, Editor, Hook, Captions, and Cover behaviours are intentionally deterministic preset rules, not an LLM integration.

## Local setup

Prerequisites:

- Node.js 20+
- FFmpeg 6+ and FFprobe on `PATH` (or configured with environment variables)

```powershell
npm install
npm run generate:samples
npm run dev
```

Open `http://localhost:3000`. Camera use requires HTTPS or localhost. If access is denied or unavailable, gallery upload remains available.

Copy `.env.example` to `.env.local` only when changing paths, file size limits, or retention:

```text
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
RETENTION_HOURS=24
MAX_UPLOAD_MB=80
```

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:api
npm run build
```

`npm test` runs deterministic unit tests, renders all seven presets from the same sample clips, validates each 720×1280 H.264/AAC MP4 and three extracted covers, then proves that captions, hook, shot order, style, and original-audio mode alter a real render. The creative render test produces a local sine-audio fixture; no licensed music is bundled.

`npm run verify:api` starts an isolated Next server and checks invalid/corrupt/oversized uploads, clip replacement, incomplete projects, job lifecycle, cover retrieval, output isolation, regeneration, and session/job recovery after a server restart. It restores the tracked `next-env.d.ts` after the isolated test.

Call `GET /api/health` while the server is running to verify FFmpeg and FFprobe availability.

## Architecture

- `src/app/page.tsx` — mobile workflow and camera lifecycle. Session state is saved to the server and recoverable from the `?session=<uuid>` URL.
- `src/lib/presets` — seven declarative editing presets; effects, transitions, cut length, text, and visual treatment are consumed by the renderer.
- `src/lib/creative` and `src/lib/ai/studio.ts` — typed, safe deterministic Director guidance, vibes, hooks, captions, caption styles, shot order, audio mode, and challenge rules.
- `src/app/api/uploads` — media type/size/probe validation and safe individual-shot replacement.
- `src/lib/video/render.ts` — normalizes rotation, size, frame rate, caption style, visual effects, real transitions, original-audio normalization when selected, fast-start MP4 encoding, and three real cover-frame extractions.
- `src/lib/jobs/queue.ts` — bounded single-process queue with durable stages, job metrics, output verification, and unique output names.
- `src/lib/storage/session-storage.ts` — UUID session folders, durable drafts and job records, plus opportunistic retention cleanup.

## Privacy and media handling

- No account or real name is required.
- Session IDs are random UUID bearer tokens. Do not share the browser URL on a public display.
- Uploaded clips are outside `public/` and served only through the session-specific reel endpoint.
- Public-screen and promotional-reuse permissions are separate, unchecked opt-ins and are stored with the local job/session record.
- Generated media is retained according to `RETENTION_HOURS` and cleaned opportunistically on uploads and job creation.
- The app does not bundle copyrighted music. Muted is the default; **Original clip audio** uses available visitor audio only and normalizes its volume.

## Completed prototype capabilities

- Seven distinct 9:16 reel presets with server-side FFmpeg composition.
- Uploads and device-camera recording, front/rear switch when supported, countdown, timer, preview, retake/replacement, error recovery, and camera-track cleanup.
- Deterministic Director with six vibes, simple/advanced detail, editable hooks and captions, four caption styles, accessible shot reordering, and functional challenge Roulette.
- Real job stages, output metrics, render retries, isolated outputs, three downloadable cover candidates, MP4/cover download, native share attempt, post-caption copy, achievements, and alternate-preset regeneration without new footage.
- Server-side session recovery after normal browser refresh, including completed output history and selected cover.

## Known limitations

- Physical-device camera/permission behaviour is **unverified** in this development environment. Before the festival, manually test HTTPS access, each facing camera, recording/stop, retake, permission denial, interrupted recording, and gallery fallback on target Android and iOS devices.
- This is a local demonstration architecture: the queue is single-process and filesystem storage is local. It is not multi-instance infrastructure.
- The UUID is the access capability for local media. A deployed shared service should use authenticated, expiring signed URLs and a persistent consent/audit store.
- There is no bundled soundtrack, beat detection, speech transcription, user account, public gallery, or generative-video provider. Beat Sync uses the preset’s defined visual timing grid.
- Native sharing depends on the visitor browser and Web Share file support; MP4 download is always offered as the fallback.

## Deployment

Use a long-running Node.js host with a writable disk, FFmpeg/FFprobe installed, HTTPS termination, and a scheduled filesystem cleanup process. Do not deploy the in-memory queue and local filesystem storage to a serverless runtime. For multiple workers, replace the queue and storage adapters with a shared durable job system and object storage before claiming production scale.
