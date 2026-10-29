# Security review — 29 October 2026

This is a source review and local integration test of the reel studio on `main`, starting from `94d741e`. It covers the 32 API route files, session and operator access, uploads and downloads, FFmpeg input handling, the local model and transcription queues, private registrations/CSV export, dependency advisories, and the Vercel-to-laptop deployment configuration. It is not an independent penetration test or an audit of the Vercel, GitHub, Cloudflare, Windows, or router accounts.

## Findings fixed

| Severity | Finding and evidence | Fix |
| --- | --- | --- |
| High | The locked Zod release was within the affected range of [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), which permits excessive resource use for certain constrained arrays. `npm audit` reported one high severity advisory before the update. | Upgraded Zod to `^4.6.7` in `fb48c6b`. `npm audit --audit-level=low` now reports zero known vulnerabilities. |
| Medium | JSON API routes used unbounded `request.json()`/`request.text()`. An anonymous caller could make the server buffer a large body before validation. | `243f179` adds byte and time limits while streaming all JSON request bodies. The default is 64 KiB, registration and operator login 4 KiB, transcript import 4 MiB. Missing or false `Content-Length` is tested. |
| Medium | Repeated public health/readiness checks could launch FFmpeg and FFprobe processes; each private clip fetch also probed the already-normalized video. This made cheap requests consume process slots. | `ecbb932` coalesces and briefly caches health checks and serves validated clip files without probing on every fetch. |
| Medium | FFprobe accepted a concat manifest disguised as an uploaded video before the later container check. That allowed media processing to read a referenced sibling file during probing. No data exfiltration or code execution was demonstrated. | `5faf679` limits FFmpeg/FFprobe to local file protocol and self-contained media formats at each untrusted input. Regression tests confirm the disguised manifest is rejected while normal MP4 works. |
| Medium | Alternate IPv6 transition-address forms passed the private-address check for public media imports. This could bypass the first SSRF check. | `541875d` rejects mapped, NAT64 and Teredo transition ranges for literal URLs and DNS results. Connection-time DNS checks remain active. |
| Medium | Media download timeouts did not include DNS/headers, and rejected HTTP responses were drained. A slow or endless server could hold sockets and bandwidth. | `9b9e0dc` applies one deadline to the complete transfer, destroys rejected responses, caps bytes while streaming, and removes partial files after streams close. |
| Medium | Concurrent imports checked the two-import limit before asynchronous record creation, so multiple requests could all pass admission. Transcription admission had a similar queue race; model generation could build an unbounded queue. | `bb4069f` reserves import slots synchronously, serializes transcription admission, and caps local model requests at four pending. Upload and model burst regressions pass. |
| Low | A completed podcast batch ZIP recalculated CRCs across every reel on each request without its own request limit. Repeated authenticated requests could consume disk and CPU. | `770ea26` limits archive requests to six per network key per minute. The batch ZIP integrity and authorization test passes. |
| Low | `.gitignore` only covered a few environment-file names, leaving other common private `.env*` variants easy to add accidentally. | `e4f574c` ignores `.env*` except the documented `.env.example` and adds `npm run verify:security`. A current tracked-file pattern scan found no credential material; two URL-shaped matches were intentional negative tests. This scan does not cover historical commits. |

## Controls checked

Session access uses a random 256-bit browser secret in an HttpOnly, SameSite=Strict cookie. The server stores only its hash, checks session ownership for private media/jobs/sources, and expires access after the configured retention period. Operator access requires a separate secret and signed cookie; with `OPERATOR_LOCAL_ONLY=true`, operator and local model routes return 404 through the public tunnel. State-changing API routes check cross-origin browser requests. Streaming uploads have byte, process, and concurrency limits. Public reels require explicit opt-in and operator approval; share links have independent random, expiring, revocable tokens.

Registration records contain name and email and are kept for 30 days by default. The CSV API requires local operator access and prefixes spreadsheet formula-like cells. The local export command writes to the ignored private data directory with restrictive file permissions. Expired source records are removed by the scheduled cleanup, but previously exported CSV files and external backups require separate manual deletion.

The deployment uses Vercel as a redirect and a single long-running Node/FFmpeg process on this laptop. The studio listens on `127.0.0.1`; Cloudflare Tunnel supplies public HTTPS. Two obsolete port-3200 tunnels and their old server were stopped during this review. The untrusted media decoder is still a native FFmpeg process with the laptop account's OS permissions; the protocol/container restrictions reduce exposure but do not constitute a process sandbox.

The patched build was restarted on the laptop. After the expired tunnel was replaced, Vercel Production `STUDIO_ORIGIN` was updated and deployment `HujsnV6PbHJE5eoXMkorY54JMf4v` became Ready. A public request through `https://zenith-reel-maker-smth.vercel.app` reached the new studio and returned 200 for the home page, health, and readiness; the private operator CSV route returned 404.

The final laptop build was rebuilt in its normal `.next-production` directory after the archive limit was added. `a9a98a7` excludes ignored runtime data and build backups from TypeScript's broad source scan, so generated files outside the source tree cannot break later checks.

## Remaining risks and operating requirements

- Anonymous users can still consume the bounded upload and render capacity and local disk. Keep request limits, rate limits, disk space, and process metrics under review; a managed edge abuse-control layer would improve resilience.
- Cloudflare quick tunnels have temporary addresses and no uptime guarantee. This laptop, its network, the Node server, and the tunnel must remain running. A lost tunnel requires a new URL in `STUDIO_ORIGIN` and a Vercel production redeploy. A named tunnel and stable domain or an always-on host would remove this recurring outage mode.
- The current JSON/file store and its queue locks are single-process. Do not run two studio servers against the same `DATA_DIR`; use a transactional store and cross-process locking before scaling out.
- Keep FFmpeg, Python/Whisper, Node, Next.js, and other dependencies patched. `npm audit` covers npm packages, not the system media binaries or ML models. Keep the studio process and `DATA_DIR` on a minimally privileged account, and back up registration data securely.
- A broad Content Security Policy has not been added because this Next.js app's scripts and styles need a compatible nonce/build policy. The existing no-store, no-referrer, no-sniff and frame-deny headers are present, but a tested CSP would add browser defense in depth.

## Verification performed

- `npm run verify:security`: 30 tests passed, including authorization, private CSV, request limits, SSRF and download safety, media decoding, and queue admission.
- `npm test`: 63 unit/server tests passed, followed by all seven preset renders and a customized render.
- `npm run lint` and `npm run typecheck`: passed.
- Production Next.js build: passed. `npm run verify:api` exercised a separate test server, private media boundaries, three-clip generation, operator review, sharing, concurrency, and interrupted-job recovery.
- The focused podcast batch test passed after the archive request limit was added; the production build, lint, and typecheck passed afterward.
- `npm audit --audit-level=low`: zero known npm vulnerabilities at review time.

Use `npm run verify:security`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm audit --audit-level=low` before shipping a security-sensitive change. Report new vulnerabilities to the repository owner privately, without posting tokens, visitor data, or exploit details in public issues.
