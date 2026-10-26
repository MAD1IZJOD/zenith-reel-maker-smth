# Emergency product stabilization

Date: 2026-10-27. Verified on the local production build (`npm run build` + `node scripts/serve.mjs`), Windows 11, Chrome stable via Playwright. No hosting was purchased and no paid model or Higgsfield request was made.

## What was wrong

The automated suites passed, but they check that each step works, not how the product feels. Walking the real journey in a real browser (`scripts/ux-audit.mjs`) at 360, 375, 390, 414, 1280 and 1440 px with real CC BY footage exposed problems that no test covered:

| Problem | Evidence | Fix (commit) |
| --- | --- | --- |
| Pages hung after loading; later requests stalled | Landing took 16 s to settle. A draft-save response body was never read, so Chrome held the connection open until a 15 s abort. Browsers allow 6 connections per host, so unread replies starved later requests | Read every small JSON reply to the end (`settle`, `ping`) — 5682084 |
| A 404 on every page | No favicon | `src/app/icon.svg` — 5682084 |
| The next action was off-screen | Primary buttons below the fold on record, review, customize and preview at phone widths, and on record, review and customize at 1280/1440 | Fixed bars on phones; two-column record and review and a sticky Generate bar on laptops — 96aa398 |
| Shot thumbnails could stay black | Paused `preload=metadata` clips paint no frame on iOS Safari | `#t=0.1` media fragment (`posterFrame`) — 96aa398 |
| 3 px sideways scroll at 360 px | The premiere consent `<select>` sized itself to its longest option | Selects are constrained to their field — 96aa398 |
| Small touch targets | Review "Replace" 56×16 px, footer links 18 px tall, privacy link 12 px tall | 44 px minimum — 96aa398 |
| Style previews looked the same | Seven synthetic test-pattern clips | Real-footage previews (Tears of Steel, CC BY 3.0, credited) — 04598af, f27abfb |
| **Reels exported silent** | Default audio was "Silent reel", and the choice sits in the Beat Lab tab: −70 LUFS | Default to the original studio soundtrack — ef56878 |
| Landscape clips looked tiny | The foreground filled 40% of the frame height | Creator clips fill 56% (a near-square centre) — a2d7ac3 |
| Caption cards hard to read | libass sizes by line height, so cards rendered about 30% smaller than designed, with a 3 px outline lost over bright scenes | Cards 1.3× larger with a heavier soft outline — d2cd6ca |

## Measured results (local production build)

Journey timings, from the last full audit at all six widths:

| Step | Time |
| --- | --- |
| Landing settles | 1.04–1.14 s (was 16 s) |
| Each 7 s upload, validated and normalized | 2.4–2.9 s |
| Review thumbnails painted | 0.17–0.28 s |
| Generate | 2.6 s |
| Playback ready | under 0.1 s |
| Download | 0.2–0.4 s |
| Regenerate | about 3.0 s |

Final audit findings:
- No console errors, page errors or HTTP errors at any width.
- The only failed requests are video loads aborted when the element is replaced (benign).
- No primary action below the fold, no horizontal overflow and no offscreen controls at any width.

Before/after artifacts are written to ignored `data/` paths and are reproducible with `npx tsx scripts/quality-sample.ts <label>`.

| Comparison | Before | After |
| --- | --- | --- |
| Audio | −70 LUFS (silent) | −15.7 LUFS, −1.1 dBFS peak, about 0.4 s more render time |
| Landscape foreground | 41% of frame height | 58% (`data/aesthetics/landscape-before-after.jpg`) |
| Caption card | Thin and small | 1.3× larger, readable over bright footage (`data/aesthetics/caption-before-after.jpg`) |

## Verification

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm test`: 56 unit tests plus render verification pass.
- `npm run verify:api`: passes.
- `npx playwright test`: 13 of 13 pass, including the Podcast to Reels end-to-end flow (three reels, previews, downloads, ZIP, title edit, refresh recovery).
- `npm run build`: passes.
- Real MP4 downloads verified at 360 and 1440 px: 720×1280, H.264/AAC, 8 s, playable.

## Physical device checklist (not yet done; cannot be simulated)

Run this on real hardware on the festival network, against the deployed HTTPS URL:

1. **iPhone (Safari, iOS 17+) and a mid-range Android (Chrome)**, both in portrait. Do the full journey: preset → shot plan → **Open camera** → allow permission → record three shots → review → customize → Generate → play → Download → Share.
2. **Camera**: permission prompt appears once; front/back flip works; the countdown and REC indicator are visible; a 3–8 s recording uploads; a denied permission offers upload instead.
3. **"Use phone camera"** (native capture) on both phones. Upload an existing gallery video, including a landscape one and a 4K HEVC iPhone clip.
4. **Thumbnails** on the review screen show a frame on iOS, not black.
5. **Fixed bottom buttons** do not sit under the iOS home indicator or Android gesture bar, and stay visible when the keyboard opens on the customize Titles tab.
6. **Playback**: sound plays (soundtrack default) once the user taps play; volume is comfortable on the phone speaker; no clipping.
7. **Download**: on iOS the file goes to Files/Photos; on Android to Downloads; it plays in the native player. Share sheet opens.
8. **Retrieval QR**: scan from a second phone; it opens only that reel.
9. **Network**: repeat one journey on venue Wi-Fi and one on 4G; note the upload time for a 30 MB clip.
10. **Concurrency**: five phones generating at once; confirm the queue message and that no request fails.
11. **Podcast to Reels** on a laptop against the deployed host (see blocker 1).
12. **Accessibility**: VoiceOver/TalkBack can reach every button; reduced-motion setting removes the storyboard motion.

## Creator registration — prerequisites only (not implemented)

**Current data model.** There is no database. State is JSON files under `DATA_DIR`, written atomically with single-process locks (`src/lib/server/store.ts`):
- `sessions/<uuid>/`: clips, drafts, renders.
- `jobs/`: render jobs.
- `access/`: hashed session secrets.
- `premieres/` and `settings/`: festival records.

Everything expires after `RETENTION_HOURS` (default 24). Locks and rate limits are in memory, so the service must run as **one instance**.

**Session ownership.** Each reel session is a random UUID plus a 256-bit secret, kept in an HttpOnly cookie `srs-<id>`, with only its SHA-256 stored (`src/lib/server/security.ts`). Ownership is "this browser", not a person: clearing cookies or switching phones loses access, except through the retrieval link/QR.

**Operator authorization.** One shared `OPERATOR_SECRET` (32+ chars). Operators sign in to an HMAC-signed 8-hour cookie (`src/lib/server/operator.ts`). There are no individual operator accounts, roles or audit trail.

**What registration would require before any code is written:**
1. **Persistent store**: a real database (for example Postgres) with migrations, backups and a retention job. Accounts must outlive the 24 h media retention, and the JSON store is single-host.
2. **Identity**: email magic link or OAuth. No passwords to store. Link existing session UUIDs to an account only after an explicit claim action.
3. **Consent design**, reviewed by the organizers:
   - a lawful basis for each purpose (account, festival screening, promotion);
   - a minimal field list (email only to start);
   - versioned consent records like the existing `consentVersion: "festival-v1"`;
   - withdrawal and deletion flows;
   - a published privacy notice update.
4. **Under-18 visitors**: decide a minimum age for self-registration (13–16 depending on jurisdiction under GDPR/COPPA-style rules). Below it, require verifiable parent or guardian consent or no account at all. Never collect date of birth beyond an age-band confirmation. Keep the current per-reel guardian confirmation for anyone shown on screen.
5. **Operator accounts**: replace the shared secret with named operator logins and roles (moderator, display), with an audit log of approvals and revocations.
6. **Security review**: rate limits move out of memory; sign-in is protected against enumeration and brute force.

No personal data collection was added during this stabilization.

## Deployment readiness

- **Ready**: `Dockerfile`, `compose.yaml` and `deploy/Caddyfile` exist and are coherent:
  - the image runs a health check on `/api/ready`;
  - captions use bundled OFL fonts from `public/fonts`, which are inside the image;
  - Caddy terminates TLS with a 90 MB body limit and a 240 s response timeout, keeps no access log and sets security headers;
  - a single instance is configured with one concurrent render by default.
- **Not verified**: Docker is not installed on this machine, so the image was not built here. No public host exists yet.

## Launch blockers

1. **Podcast to Reels cannot transcribe in the container.** The image has no Python, faster-whisper or `workers/`. The app fails honestly with a 503 ("The transcription environment is not installed"), but the feature is unusable there until the image adds `python3`, a venv with `faster-whisper==1.2.1`, `workers/transcribe.py`, `TRANSCRIBE_PYTHON`, and a pre-downloaded `base` model (about 145 MB). Alternatively, launch with Podcast mode hidden.
2. **No deployed HTTPS host.** Camera capture (`getUserMedia`) requires HTTPS on phones, so the camera path cannot be tested on real devices until one exists.
3. **The physical device checklist above has not been run.**
4. **Single-instance only**, by design: in-memory locks and rate limits. Size the host for the expected queue (one render about 2.6 s at 720p on this CPU; measure on the target host).
5. **Local Qwen is optional and off** in the container (rules planner used). That's fine for launch; just don't advertise AI planning there.

## Verdict

**CONDITIONAL GO** for the clip-to-reel festival flow. It works end to end, quickly and without errors at every tested width on the local production build. The conditions are blockers 2 and 3 (deploy behind HTTPS and pass the device checklist), plus blocker 1 or hiding Podcast mode.

The product is **not** festival-ready until the intended deployment and the mobile workflow have been verified on real phones.
