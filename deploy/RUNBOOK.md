# Festival operation and deployment

## Architecture and activation status

Use **one** long-running Node process, local FFmpeg/FFprobe, one persistent volume, and an HTTPS reverse proxy. The bounded queue and file locks are process-local. Do not run PM2 cluster mode, multiple containers against this disk, autoscaling, or serverless functions. A distributed queue and shared storage would be a separate phase.

The supplied container/reverse-proxy configuration is prepared for deployment, not an activated hosting service. No domain, VM, TLS certificate or paid service has been provisioned. Docker execution and public phone access must be verified on the deployment host. Local tests do not establish production capacity.

## Development and verification

Install Node 20.9+ (22 LTS recommended), FFmpeg/FFprobe with libx264, AAC, drawtext and xfade, and a usable font. On Windows, install FFmpeg on PATH; Arial Bold is the default font. On Debian, `apt-get install ffmpeg fonts-dejavu-core` provides the runtime dependencies. The application uses Debian's DejaVu Sans Bold path automatically; override `FFMPEG_FONT` for another installation.

```powershell
npm ci
npm run dev
```

Camera access works only on localhost or HTTPS. A phone visiting a laptop's plain HTTP LAN IP cannot use in-page recording; gallery and phone-camera file input remain alternatives, with browser-dependent behavior.

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:api
npm run build
npx playwright install chromium
npm run verify:browser
```

An installed Chrome or Edge can be used without downloading Chromium:

```powershell
$env:PLAYWRIGHT_CHANNEL = "chrome" # or msedge
npm run verify:browser
```

Browser tests start a production server on port 3102 with isolated `data/browser-tests` storage. API tests start an isolated development server on 3101 with `data/api-tests`. Neither test directory contains real visitor media by design. They are ignored by Git. Failed test traces may contain synthetic session capabilities; do not publish them.

Builds use `.next-production`, independently from the development server's `.next` and the API test server's `.next-api-test`. Do not run overlapping builds. `npm run generate:samples` recreates the three original synthetic color/text clips. `npm run generate:previews` renders all seven public previews using only those samples. Do not replace public previews with participant footage.

## Production start without Docker

```powershell
npm ci
npm run build
$env:NODE_ENV = "production"
$env:DATA_DIR = "D:\squad-studio-data"
$env:PUBLIC_BASE_URL = "https://YOUR-CONTROLLED-DOMAIN"
$env:COOKIE_SECURE = "true"
# Set OPERATOR_SECRET through your host's secret environment, never source control.
npm start
```

For a **localhost-only production smoke test**, set `COOKIE_SECURE=false` and use an HTTP localhost `PUBLIC_BASE_URL`. Never use that override for public deployment. `npm start` loads `.env.production` and `.env.local` using Next; environment configuration must be available before startup. A production host needs a service supervisor and automatic restart.

`GET /api/health` checks FFmpeg and FFprobe. `GET /api/ready` additionally checks writable storage, free space (at least 512 MiB), queue initialization and draining state. Neither endpoint exposes paths, credentials or private media.

## Docker and HTTPS on one host

1. Point a domain you control to the host. Permit inbound 80/443. Keep the app's port 3000 inaccessible externally.
2. Install Docker Engine with Compose. Copy `.env.example` to `.env`, set `STUDIO_DOMAIN` to the domain **without a scheme**, and set a random `OPERATOR_SECRET` of at least 32 characters. Do not use a human-chosen short password. For example, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` locally, then put the result in the host's protected environment file.
3. Set `IMAGE_TAG` to a release label. Leave render concurrency at 1 until measured on that host. The leaderboard defaults to disabled; enable only after staff understand its completion-point rules.

```sh
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose exec studio node -e "fetch('http://127.0.0.1:3000/api/ready').then(async r=>{console.log(r.status,await r.text())})"
docker compose logs --tail=50 studio
```

Do not paste `docker compose config` output without `--quiet`: resolved configuration contains the operator credential. The named `studio_data` volume contains private sessions, access hashes, jobs, retrieval records, consent submissions, settings, leaderboard entries and aggregate counts. Do not mount it as a public static directory. Restrict host access and backups accordingly. Operator secrets and TLS data are separate from participant storage.

Caddy automatically terminates HTTPS for the configured real domain. The example deliberately omits access logging because request URLs can contain retrieval tokens. If infrastructure adds logs, redact `/r/*`, `/api/retrieval/*`, cookies and session query parameters. Caddy overwrites the forwarding header before the app trusts it. Do not set `TRUST_PROXY=true` if visitors can reach the app directly. The body limit is 90 MB; the app's default file limit is 80 MiB plus multipart overhead. The app separately bounds reception time, decoding time, dimensions and duration. Proxy configuration follows the official [request-body](https://caddyserver.com/docs/caddyfile/directives/request_body) and [reverse-proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) directives.

## Queue, recovery and shutdown

- Defaults: 1 running render, 8 pending, 2 simultaneous upload validations. Limits are configurable and clamped to safe ranges. Capacity exhaustion returns 429; a staff pause returns 503. Clips remain saved for retry.
- Each accepted job copies all three clips into a job-specific workspace under a session lock. Later retakes cannot alter an in-flight edit. Render intermediates and final output names are unique to the job. Normalization and cover extraction run sequentially per job; encoding uses two threads.
- Duplicate requests with the same saved clip versions, edit and challenge reuse the existing non-failed job, including across process restarts.
- The server runs jobs independently of browser polling. Closing a page does not cancel an accepted render.
- On restart, persisted unfinished jobs become failed with an honest retry message. Incomplete output and workspaces are removed, original clips and completed exports are preserved. Unfinished jobs are not silently reported as complete or automatically replayed.
- The production launcher stops accepting work on SIGTERM/SIGINT, waits up to 180 seconds for active processing, then kills its remaining child processes. Pending jobs are retried by visitors after restart. Compose allows 200 seconds. A forced OS kill cannot drain; startup recovery handles it.
- FFmpeg processes have timeouts; upload normalization allows up to 180 seconds. Polling shows stages, never invented percentages or wait estimates. Upload percentages measure transfer only, followed by a separate preparation state.

Use `/operator` to pause new submissions before maintenance and wait for running jobs to finish. Then use `docker compose stop studio` or stop the supervised process. Do not delete an active job's workspace manually.

## Privacy boundaries

| Capability | What it permits | What it never permits |
| --- | --- | --- |
| Session ID + HTTP-only cookie | Original clip preview, draft edits, own jobs, own retrieval/revocation | Other sessions or operator access |
| Retrieval token | Only one completed reel, until expiry/revocation | Original clips, editing, other renders, screening approval |
| Approved premiere ID | Only an explicitly consented and staff-approved reel | Session workspace or unapproved footage |
| Operator cookie | Queue/status, review consented submissions, approve/remove/pause | Automatic publication of every private reel |

Session cookies are secure in production and same-site strict. Private media is streamed with `no-store`, range support and attachment download responses. Retrieval secrets are 256 random bits and stored only as SHA-256 hashes. Links expire in at most six hours or when the reel expires. Referrer policy prevents forwarding link paths to other sites. No QR on the public display ever includes a private session or reel-retrieval token: it links to `/festival` only.

Premiere submission requires explicit agreement from everyone shown and an adult/guardian attestation. For minors, staff must confirm guardian permission in person before approval. This is an attestation workflow, not age verification or an automatically validated legal release. Promotional reuse is a separate unchecked choice. Visitor revocation blocks future media access and operator reapproval of that revoked submission. It cannot erase copies or a screening that already happened. A new explicit submission requires fresh consent and staff review.

Leaderboard nicknames come from a curated list with an anonymous suffix; free-text names are not accepted. Scores are server-derived: 30 validated clips, 40 successful export, 20 recommended preset, 10 custom title. One daily entry per private session uses its best completed challenge and a distinct completed-challenge count. Ties use score, challenge count and earliest entry. This is not a quality rating, camera penalty, or estimate of virality. No participant media appears on the leaderboard.

Aggregate operational counts contain no session identifiers or contact details. Download counts mean download requests, not proof of completed transfers. Counts can be affected by retries or client intent events and are not unique-person analytics. Detailed render metrics cover retained jobs; daily counters are separate and survive media cleanup.

## Retention and cleanup

`RETENTION_HOURS` defaults to 24. Startup and a once-per-minute in-process timer clean expired sessions, jobs, access records, retrievals, premieres and leaderboard entries. Active render sessions are protected. Cleanup continues with no visitor traffic. Downtime delays deletion until startup; do not promise deletion while the machine is off. Startup recovery clears interrupted work before normal cleanup.

Observe readiness and disk availability before doors open. Investigate the explicit `Scheduled retention cleanup failed` log if present. If using host backups, apply the same retention policy to them; this app cannot delete external backup copies. After the event, stop the app and securely remove the specific participant data volume after verifying its exact identity. Preserve application images separately for rollback. Never run broad deletion commands against a home/workspace root.

## Stall operation

- Visitor entry: `/festival`; ordinary creator entry: `/`.
- Staff-only controls: `/operator`, authenticated server-side with the configured secret. Operator sessions expire after eight hours; rotating the secret invalidates all existing operator cookies.
- Projector/TV: `/display`. Demo previews run with no participants. Participant reels appear only after explicit submission and operator approval. The display refreshes approvals every five seconds; pause and demo-only controls are server-enforced. Browser autoplay may require a tap; videos start muted.
- Shared stall devices: before handing to the next visitor, create a private retrieval link for the previous visitor and choose **Start a new reel**. For strongest shared-device privacy, use a fresh guest browser profile per visitor; ordinary browser history and retained session cookies can restore previous work in that same profile.
- During overload, explain that clips remain saved and ask the visitor to retry. Do not invent a wait estimate. Use the queue view and actual render times to manage admission.

## Launch gate and real-device checklist

Do not open public participation until all of these are executed on the actual host and network:

- HTTPS certificate valid on visitors' phones; no mixed content; secure cookie present after session creation.
- Readiness passes, data volume survives restart, disk has sufficient space, proxy/body limits align.
- Android Chrome and iOS Safari: permission grant/denial, front/rear switching, 3-second countdown, stop, preview, retake, background/interruption, upload and native phone-camera fallback. Confirm no microphone prompt. Record supported browsers and versions.
- Three visitor browsers create distinct sessions; known session/job IDs with the wrong cookie are denied.
- The same three clips export in all seven presets; MP4 preview, seeking, download and regeneration work.
- Scan the creator QR from another physical phone; generate a private retrieval QR and open it in a different phone/browser. Check expiry and revoke.
- Explicit guardian consent is understood by staff. Nothing private appears on `/display`; approval, rejection, removal, pause and revocation work.
- Run a small queue-load test against the deployed host with permission; inspect CPU/RAM, disk, actual render durations and error rate. Adjust admission conservatively. Local results are not a throughput guarantee.
- Keep the optional leaderboard disabled if staff cannot supervise its use.

## Rollback

Tag and keep the last verified image before deploying a change. Pause admission, drain active work, then stop the app. Set the image tag to the previous verified release and run `docker compose up -d --no-build`. Keep the same persistent volume. Recheck readiness, a completed private reel, a demo render, and operator/display privacy before reopening. Never roll back by rewriting Git history. If a future schema change is incompatible with an old image, restore a separately protected compatible data snapshot with the same privacy policy; do not overwrite the only copy of participant media.
