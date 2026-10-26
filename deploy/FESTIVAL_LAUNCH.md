# Festival launch: Create from clips

Measured on the stall laptop (AMD Ryzen AI 7 350, 16 threads, 23 GB RAM, Windows 11, Node 24, FFmpeg 8.1) on 2026-10-27, after commit 336ac41. **No physical phone has been tested yet.** Everything below marked *emulated* used Chrome with phone profiles and a synthetic camera.

## What runs at the festival

**Create from clips only:** three shots → seven styles → director guidance → customize → MP4 → download, with retakes, regeneration and the QR retrieval link.

**Podcast to reels is switched off**, not deleted. `PODCAST_MODE=off` hides it: the landing shows "Unavailable here today", `/podcast` explains this, and every podcast API answers 404 before doing any work.

To re-enable it on a host where `npm run verify:feature-gate` shows the transcription environment loading, remove `PODCAST_MODE=off`. The default `auto` then enables it only if faster-whisper actually loads.

## Start the stall (Windows, no Docker)

```powershell
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File deploy\start-festival.ps1 -Mode local    # laptop only / backup demo
powershell -ExecutionPolicy Bypass -File deploy\start-festival.ps1 -Mode lan      # phones on the same Wi-Fi
powershell -ExecutionPolicy Bypass -File deploy\start-festival.ps1 -Mode tunnel -ConfirmPublic   # public HTTPS
```

In every mode the launcher:
- turns podcast mode and the local AI model off;
- sets `OPERATOR_LOCAL_ONLY=true`, so `/operator`, `/api/operator` and `/api/ai/*` answer only to `http://localhost` on the laptop;
- keeps data in `D:\zenith-festival-data` (24 h retention);
- generates the operator secret once into that folder, without printing it;
- allows two concurrent renders.

Verified: `local` and `lan` modes, and the tunnel refusing to start without `-ConfirmPublic`. Tunnel mode has **not** been run, because it publishes the laptop; see below.

## Getting phones onto it: options

| Path | HTTPS | In-page camera | Cost / account | Verified | Notes |
| --- | --- | --- | --- | --- | --- |
| **LAN** (`-Mode lan`) | No | No; phones use **Use phone camera** (their camera app) or upload | None | Yes (emulated phone over the laptop's Wi-Fi IP: full journey, generate, download) | Many venue Wi-Fi networks block device-to-device traffic. Use the laptop's own **Mobile hotspot** (Windows Settings → Network → Mobile hotspot) and have visitors join it. Works without internet. |
| **Cloudflare quick tunnel** (`-Mode tunnel`) | Yes | Yes | Free, no account; `cloudflared` 2026.9.1 is installed | **No**: needs your go-ahead, since it makes the studio publicly reachable | The address changes every start (the display QR follows it automatically). No uptime guarantee: Cloudflare positions quick tunnels for testing and small demos. Uploads cross the venue's internet uplink. Rate limits use Cloudflare's visitor address (`TRUST_PROXY=cloudflare`). |
| **Cloudflare named tunnel** | Yes | Yes | Free Cloudflare account **plus a domain on Cloudflare** | No | Stable address. Manual steps: `cloudflared tunnel login`, `cloudflared tunnel create zenith`, `cloudflared tunnel route dns zenith studio.<your-domain>`, then run it against `http://127.0.0.1:3000` with `PUBLIC_BASE_URL=https://studio.<your-domain>`, `TRUST_PROXY=cloudflare`, `COOKIE_SECURE=true`, `HOSTNAME=127.0.0.1`. |
| VPS + `compose.yaml` + Caddy | Yes | Yes | Paid server + domain | No | Prepared configs; podcast off by default in compose. Not built: Docker is not installed here. |

Recommendation for a small stall:
1. **LAN via the laptop's hotspot** as the dependable path.
2. **Quick tunnel** only if in-page camera recording matters and the venue internet is good, and only after you authorize it and a phone test passes on it.

Not suited to thousands of simultaneous visitors on any path above: this is one laptop with a single process.

## Capacity (measured, `npm run verify:concurrency`)

- **One reel:** renders in 1.6–2.3 s at 720p, for every preset, on real footage.
- **Eight visitors** uploading three clips each and pressing Generate at once:
  - all 24 uploads done within 17 s;
  - every reel a valid MP4, the last ready 16 s after Generate;
  - peak memory, server plus FFmpeg: about 0.6 GB with one render slot, about 0.85 GB with two.
- **Busy handling:** uploads beyond the two-at-a-time limit wait and retry by themselves. The visitor sees "The studio is busy with other clips. Yours is next in line…", not an error. Renders queue (up to 8 pending) and run in arrival order.
- **Bandwidth:** in tunnel mode every clip crosses the venue uplink (a 5 s phone clip is roughly 5–15 MB).

## Physical phone test procedure (to do: not yet run)

Use one **Android phone (Chrome)** and one **iPhone (Safari)**. Test each path you intend to use, LAN and/or HTTPS, with the server started by the launcher. Write down the phone model, OS version and pass/fail for each step.

1. **Open**: scan the QR on `/display` or type the visitor URL → landing shows *Start Creating*; podcast shows *Unavailable here today*.
2. **Style and plan**: pick a style → *Use this shot plan* → record screen.
3. **Camera permission** (HTTPS only): tap *Open camera* → the browser asks once → allow → live preview appears.
   - On LAN: *Open camera* is absent; *Use phone camera* is the main button.
4. **Preview and flip** (HTTPS only): the preview is upright and fills the frame; *Flip* switches front ↔ back. Note devices with only one camera.
5. **Record**: *Record shot* → 3-2-1 countdown → *REC* timer → *Stop recording* after 3–8 s → the clip plays back in the box with a Shot Coach note.
6. **Retake**: *Retake* → camera/upload choices return → record again.
7. **Phone camera app**: *Use phone camera* opens the native camera; record → *Use video* → the clip uploads.
8. **Upload fallback**: deny camera permission (or use LAN) → *Upload video* → pick a gallery video, including a landscape one → it uploads.
9. **Refresh**: after two shots, pull-to-refresh → both shots are still there.
10. **Network drop**: during the third upload switch on airplane mode → an error with *Retry saved upload* → airplane mode off → *Retry* succeeds.
11. **Generate**: *Review three shots* → *Customize reel* → *Generate MP4* → progress → *Made from your moments.*
12. **Playback**: tap play → video and **soundtrack audible** on the phone speaker; captions readable; colours look natural (four styles encode full-range colour: check they don't look washed out or crushed).
13. **Download**: *Download MP4* → iPhone: saves to Files/Photos; Android: Downloads → plays in the phone's own player with sound.
14. **Regenerate**: *Open Finishing Studio* → change caption style → *Generate MP4* → the new version plays.
15. **Retrieval**: open the reel's QR/retrieval link on a second phone → only that reel opens.
16. **Privacy**: on the phone, `<visitor URL>/operator` shows *Not found*.

Automated *emulated* coverage (passing):
- `tests/browser/phone.spec.ts` covers Pixel 7 and iPhone 14 profiles (Chromium engine, not WebKit). It runs camera open, flip, record, retake, upload fallback, refresh recovery, a network drop with retry, generate, playback, and a download probed as audible 720×1280 H.264. It also runs four visitors uploading at once.
- `npm run verify:lan-phone http://<ip>:<port>` covers the LAN path.

## Backup demonstration (no phones, no network needed)

`-Mode local`, then on the laptop open `http://localhost:3000/festival` → **Try Demo**.
- It loads the bundled original sample shots, runs the **real** pipeline, and labels the result **SAMPLE FOOTAGE · REAL EXPORT**. Measured: about 6 s from Try Demo to a playing reel.
- Visitors can choose styles and customize, then regenerate to see different edits.
- Never present sample shots as a live recording.
- No visitor footage is used or shown, except approved premieres on `/display`.

## Before opening the stall

1. `npm run build` on the laptop. Start with the launcher. Check `/api/ready`.
2. Run the phone procedure above on both phones, on the path you'll use.
3. Open `/display` on the screen and `/operator` on the laptop (sign in with the secret in the data folder).
4. Keep `-Mode local` + **Try Demo** ready as the fallback.
