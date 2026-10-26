# Squad Reel Studio

A local, production-minded festival reel maker. Visitors choose one of seven structured presets, capture or upload three real clips, then receive a true 720 × 1280 H.264 MP4 rendered on the server with FFmpeg.

## Quick start

Prerequisites: Node.js 20+ and FFmpeg 6+ with `ffprobe` available in `PATH`. On Windows, use a static FFmpeg build and restart the terminal after adding it to `PATH`. Three small MP4 demo clips are bundled; `generate:samples` recreates them if you want fresh local test assets.

```powershell
npm install
npm run generate:samples
npm run dev
```

Open `http://localhost:3000`. Camera access on phones requires HTTPS or localhost; the gallery upload flow remains available if permission is denied.

## Verify the local pipeline

```powershell
npm run typecheck
npm run lint
npm test
npm run generate:samples
npm run smoke:render
npm run build
```

Check the installed video dependencies with `Invoke-RestMethod http://localhost:3000/api/health`. It reports a non-200 result when FFmpeg or FFprobe cannot be started.

`npm test` runs the preset unit test and renders all seven presets from the same three sample clips, verifying nonempty 720×1280 H.264 MP4s plus cover images. Run `npm run verify:api` for the isolated-server check of upload validation, job lifecycle, server-restart recovery, output retrieval, and regeneration. Test outputs are written to `data/sessions/<random-session>/` and are intentionally not committed.

## Architecture

- `src/app/page.tsx` is the mobile-first flow: Welcome → Preset → Three shots → Review → Render → Preview/download.
- `src/lib/presets` contains seven declarative style configurations; render behavior is determined by those values rather than copied functions.
- `src/app/api/uploads` validates the declared media type, size, actual FFprobe metadata, and duration before storing an input.
- `src/lib/jobs/queue.ts` is a bounded, one-render-at-a-time local job queue. It reports real stages: queued, validating, preparing, rendering, finalizing, completed, and failed. Job and consent records are written to `data/jobs/`, so completed jobs survive a server restart; interrupted renders are made retryable failures rather than remaining stuck.
- `src/lib/video/render.ts` normalizes all source videos to vertical 720×1280/30fps, applies preset color/effect filters and xfade transitions, adds title text, then produces a fast-start H.264 MP4. Inputs are intentionally muted; no unlicensed music is packaged.
- `src/lib/storage/session-storage.ts` uses random UUID session tokens and opportunistically deletes expired session folders and job records when uploads or jobs are submitted. Retention defaults to 24 hours and is configurable. The browser retains the current workflow in session storage to recover from an ordinary refresh without exposing it to the next kiosk visitor.

## Privacy and consent

Nothing is public by default. The review step uses separate, unchecked opt-ins for festival-screen playback and promotional reuse, and asks the creator to confirm permission for recorded faces. This demo records consent only within the browser session; connect a persistent consent store before operating a real public screen.

## Environment

Copy `.env.example` to `.env.local` only if paths or limits need changing. No cloud service or paid AI credential is required. The “Director”, “Editor”, “Hook”, “Captions”, and “Cover” behavior currently uses transparent preset rules; it is not presented as an LLM integration.

## Deployment

Deploy to a long-running Node host with a writable temporary disk, FFmpeg/FFprobe installed, HTTPS termination, and a periodic filesystem cleanup job. Do **not** deploy this in-memory queue or filesystem storage to a serverless function: jobs and files will be lost between instances. For multi-instance deployment, replace the queue and storage adapters with durable shared services and put generated media behind authenticated, expiring URLs.

## Completed features

- Seven visibly distinct FFmpeg presets, title overlays, effects, transitions, vertical normalization, and regeneration from the same uploaded shots.
- Explicit camera request, front/back switch, countdown, recording timer, playback, retake, upload fallback, and cleanup of camera tracks.
- Server validation, metadata probing, real render-job stages, download URL, sample clips, challenge roulette, observable creator badges, and separate consent controls.

## Known limitations

- Camera behavior needs testing on the actual target phones; it cannot be verified from this development environment. Manual test: open over HTTPS, choose each facing camera, record/stop all three shots, verify their playback, retake Shot 2, deny permission once, and confirm the gallery upload remains usable.
- The one-process queue and local filesystem are deliberate demo architecture, not multi-machine production infrastructure.
- Audio is intentionally muted in output so the app does not ship copyrighted music. User audio is not mixed at this stage.
- Big-screen and promotional permissions are captured in the local page state only; a production festival needs persisted audit records and staff controls.
