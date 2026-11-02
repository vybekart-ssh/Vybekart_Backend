# Lighter (HLS) copies of live archives — run on your PC

Makes 720p / 480p / 240p versions of every archive so the app can switch quality with the
viewer's network. The original HD video in storage is **never changed**.

New lives recorded with the latest app are processed by the seller's phone automatically; this
tool is for older archives (and any the phone could not finish).

## One-time setup (Windows)

1. Install FFmpeg: download the "release essentials" build from <https://www.gyan.dev/ffmpeg/builds/>,
   unzip to `C:\ffmpeg`, and add `C:\ffmpeg\bin` to PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`).
   Check: `ffmpeg -version`.
2. In `Vybekart_Backend`, run `npm install` once.
3. Copy `scripts/hls/.env.hls.example` to `scripts/hls/.env.hls` and fill in the admin email and
   password you use for the Master console.

## Run

```powershell
cd D:\Vybekart\Vybekart_Backend
npm run hls:process -- --dry-run   # see what is pending
npm run hls:process                # process everything pending (oldest first)
npm run hls:process -- --limit 5   # just 5
npm run hls:process -- --only <streamId>
```

The tool uploads straight to Supabase Storage through the backend — nothing to drag by hand.
Files land in `<replay bucket>/vybekart-replays/hls/<streamId>/` (`master.m3u8`, `v720.*`,
`v480.*`, `v240.*`). It is safe to stop and run again: finished archives are skipped, failed ones
are retried. Archives a seller's phone is still working on are skipped for 6 hours (`--force` to
override).

Roughly: a 1-hour live takes 15–40 minutes on a normal laptop and uploads ~1.2× the original size.
