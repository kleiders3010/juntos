# Juntos: free video calls for everyone

Video calls in the browser, on phones (iPhone and Android) and computers. No account, no time limit, nothing to
install, open source.

- **Start a call** and send the link. People type their name and join.
- Background blur or a picture behind you (runs on your own device).
- Chat, a shared whiteboard, screen sharing, raise a hand, reactions.
- Record the call on your own device (everyone sees that you are recording). No upload, no limit.

## How it works
Audio, video, chat and the board go directly between the people in the call (WebRTC). A tiny Cloudflare Worker
(`worker/`) only introduces people to each other when they join a room; it stores nothing.

## Run locally
    cd worker && npx wrangler dev --port 8787
    # serve web/ with any static server that falls back to index.html, then open
    # http://localhost:8080/?signal=ws://127.0.0.1:8787

License: Apache-2.0. Background segmentation: MediaPipe (Apache-2.0, vendored in `web/vendor/mediapipe`, see its NOTICE.md).

The Worker reads one optional secret, `TURN_KEY` (a Cloudflare TURN key, set with `wrangler secret put`), for people behind strict networks; without it calls still work on most networks.
