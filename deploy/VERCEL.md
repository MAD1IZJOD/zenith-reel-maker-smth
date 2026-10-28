# Vercel entry point with a laptop renderer

The Vercel runtime failed at startup while creating `/var/task/data`. This studio needs a writable persistent disk, FFmpeg, and a long-running Node process for its queue. Moving files to `/tmp` would not provide shared persistent sessions or reliable background renders.

Vercel now sends a temporary HTTP 307 redirect to `STUDIO_ORIGIN`, preserving paths and query strings. Visitors use the HTTPS studio address for the rest of their session, including uploads and downloads. Vercel never initializes the filesystem workers. The build uses Vercel's standard `.next` output; local builds continue using `.next-production`.

## Running now

- Public entry: https://zenith-reel-maker-smth.vercel.app
- Renderer: this laptop, bound to loopback, through Cloudflare Tunnel (launcher default port 3200; the current recovery listener uses 3201).
- New visitor data: `data/hosted-studio`, separate from existing local sessions, with the existing 24-hour retention.
- Operator/model diagnostic routes return 404 to public visitors. Session cookies remain HTTPS-only; cross-origin writes and unauthenticated media reads are rejected.
- Podcast mode uses the laptop's existing transcription availability. No paid service is enabled by this setup.

## Restart after shutdown

From the repository in PowerShell:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File deploy/start-online.ps1
```

The launcher prints its new HTTPS address and saves it in `data/hosting/public-url.txt`. In Vercel project settings, update the **Production** environment variable `STUDIO_ORIGIN` to that address (origin only, no path), then redeploy. Keep the launcher running. If the original tunnel is still running and only Node needs a restart, use `-PublicUrl <existing HTTPS origin>` to keep that tunnel address.

The current recovery session was started separately on port 3201. Its public address is in `data/hosting/public-url.txt` and tunnel log is `data/hosting/tunnel-http2-recovery-20261028.log`. The earlier listener on port 3200 remains running but is not the public destination. Do not launch a second studio on an occupied port. Existing localhost development on port 3000 is independent.

This is temporary laptop hosting. Sleep, shutdown, loss of internet, or stopping the tunnel makes the public studio unavailable. A quick tunnel address changes when its process restarts, and previous browser sessions are bound to the previous origin. Cloudflare also applies its own upload limits; very large podcast recordings may require smaller source files. For uninterrupted hosting, move the existing Docker deployment to a persistent server and change `STUDIO_ORIGIN` to its stable HTTPS address.

## Connection failures after an internet outage

The launcher defaults to HTTP/2 over TCP because the laptop connection repeatedly timed out using QUIC over UDP. Use `-TunnelProtocol auto` or `-TunnelProtocol quic` only when testing another transport. This changes the tunnel connection, not browser HTTPS, and does not keep the site online when the laptop loses internet.

Check `/api/ready` on the active loopback port first (currently `http://127.0.0.1:3201/api/ready`). If it returns `{"status":"ready"}` but the public link fails, inspect the latest tunnel log in `data/hosting`. Connection timeouts can recover without changing the URL. `Unauthorized: Tunnel not found` means the temporary tunnel has expired; retries cannot restore that address. Start a replacement tunnel, restart the studio with its new `-PublicUrl`, then update Vercel's `STUDIO_ORIGIN` and redeploy. Do not change the public URL without restarting the studio: write requests enforce that origin.

A transport change does not prevent quick-tunnel expiration. A persistent named tunnel with a stable hostname is needed to keep the same address across restarts; an always-on host is needed to survive laptop internet outages.

## Verification

```powershell
npm run verify:deployment
node scripts/verify-public.mjs https://zenith-reel-maker-smth.vercel.app
```

The public smoke test creates a fresh session using bundled synthetic footage, checks HTTPS cookies and origin/operator restrictions, uploads three clips, renders a real reel, downloads and probes H.264/AAC at 720 x 1280, and checks byte-range playback and unauthorized access. Its downloaded MP4 stays under ignored `data/hosting/verification`.
