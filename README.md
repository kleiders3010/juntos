# Juntos: free video calls for everyone

Video calls in the browser, on phones (iPhone and Android) and computers. No account, no time limit, nothing to
install, open source.

**Use it:** https://meet.jurisgames.com · **Android app:** [Google Play](https://play.google.com/store/apps/details?id=com.jurisgames.juntos) or [Juntos.apk](https://github.com/kleiders3010/juntos/releases/latest) ·
[Privacy](https://meet.jurisgames.com/privacy)

- **Start a call** and send the link. People type their name and join.
- Background blur or a picture behind you (runs on your own device).
- Chat, screen sharing, raise a hand, reactions.
- Whoever starts the call is its host: mute one person or everyone, remove someone, lock the call so newcomers ask to join and the host lets them in. If the host leaves, whoever is waiting comes in.
- A shared whiteboard with no edges: pen in three sizes, rectangles, circles, arrows, text, an eraser and undo; move and zoom your own view (pinch or Ctrl + scroll to zoom; two fingers, scrolling or the hand to move); make it big with everyone small floating over it.
- Set how loud you hear each person, from silent to 300 % for someone quiet (only on your device, remembered).
- Record the call on your own device as an MP4 (everyone sees that you are recording). Landscape, with whoever is talking (or a shared screen) big and the others small, or everyone the same size; reactions, raised hands and chat can show in the video. No upload, no limit.

## How it works
Audio, video, chat and the board go directly between the people in the call (WebRTC). A tiny Cloudflare Worker
(`worker/`) only introduces people to each other when they join a room. Per room it keeps only a hash of the host's key and whether the call is locked, deleted a month after the room was last used.

## Run locally
    cd worker && npx wrangler dev --port 8787
    # serve web/ with any static server that falls back to index.html, then open
    # http://localhost:8080/?signal=ws://127.0.0.1:8787

License: Apache-2.0. Background segmentation: MediaPipe (Apache-2.0, vendored in `web/vendor/mediapipe`, see its NOTICE.md). MP3 sound in Firefox recordings: lamejs (LGPL-3.0, vendored unchanged in `web/vendor/lamejs` with its full source `lame.all.js`; replace it with any build of lamejs).

The Worker reads one optional secret, `TURN_KEY` (a Cloudflare TURN key, set with `wrangler secret put`), for people behind strict networks; without it calls still work on most networks.
