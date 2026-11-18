# Juntos: free video calls for everyone

Video calls in the browser, on phones (iPhone and Android) and computers. No account, no time limit, nothing to
install, open source.

**Use it:** https://meet.jurisgames.com · **Android app:** [Google Play](https://play.google.com/store/apps/details?id=com.jurisgames.juntos) or [Juntos.apk](https://github.com/kleiders3010/juntos/releases/latest) ·
[Privacy](https://meet.jurisgames.com/privacy)

- **Start a call** and send the link. People type their name and join.
- Background blur or a picture behind you (runs on your own device).
- Chat, screen sharing, raise a hand, reactions.
- Layouts, like Meet's: Auto, Tiled, Spotlight (only who's talking) and Sidebar (who's talking big, the others beside); pin someone; hide people with their camera off; your own picture with everyone, small in a corner or hidden. Remembered on your device.
- Whoever starts the call is its host: mute one person or everyone, remove someone, lock the call so newcomers ask to join and the host lets them in. If the host leaves, whoever is waiting comes in.
- A shared whiteboard with no edges: pen in three sizes, rectangles, circles, arrows, text, an eraser and undo; move and zoom your own view (pinch or Ctrl + scroll to zoom; two fingers, scrolling or the hand to move); make it big with everyone small floating over it.
- Sound: check your microphone and speaker before joining (a live level, a test sound, record a few seconds and hear them back); background noise reduction (on, can be turned off); a note when you talk with the microphone off; hold Space to talk while muted.
- Live captions, for people who can't hear: big white-on-black text with the speaker's name, three sizes, remembered. Each person's own browser turns their own voice into text (Chrome, Edge, Safari; Firefox users can still read the others) and only while someone has captions on and the microphone is on. Save everything said as a .txt, also after leaving.
- Polls and Q&A, like Meet's: polls with up to 10 answers (responses without names, show everyone the results or only you and the host, end, delete); questions anyone can ask (anonymously if the host allows), upvote, sort by popular or recent, filter; the host marks answered, hides, deletes, turns questions off or approves each one first. Late joiners catch up. Save it all as a .txt, also after leaving.
- Breakout rooms, like Meet's: the host splits the call into rooms (spread automatically, shuffled or moved one by one), with an optional timer; everyone is invited and joins (or stays), asks for help, returns to the main call; the host joins any room, edits rooms while open and closes them (30 seconds, then everyone is back). Sound, picture and chat stay in each room.
- Shared notes, like the notes a Zoom or Meet call can have: one text everyone writes in at the same time (nothing typed is lost when two people type at once), a meeting notes template (date, who's there, notes, action items), the host can make it "only the host can edit". Late joiners get it all. Copy it or save it as a .txt, also after leaving.
- Draw on a shared screen, like Zoom's annotation: pen, highlighter, a pen that fades by itself, arrows, boxes, text, a pointer everyone sees, an eraser, six colours, undo / redo; the marks stay on the right spot of the shared picture on every screen size. Who shares can let the others draw or not, show who drew, and erase or clear anyone's marks (so can the host); the others erase their own. Save a picture with the drawings; recordings show them. Gone when the sharing stops.
- Small window (picture-in-picture), like Meet's: keep the call over every other window, with who's talking, yourself small, captions, notices and the buttons (mic, camera, hand, captions, back to the call, leave). It can open by itself when you switch tabs. Chrome and Edge on computers; other browsers float the video of who's talking.
- Keyboard: M microphone, V camera (or Meet's Ctrl+D / Ctrl+E), H raise a hand, C chat, ? the list.
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
