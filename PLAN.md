# Free video meetings app: plan (2026-11-18)

Kleider: decentralized "zoom"/"google meet": background replacement, boards, chats, multi-user calls, recording,
no 1-hour limit (his mom pays Meet premium for that). Web (incl. iPhone browsers), Android, PC; intuitive, simple.

## Shape (to verify with sources before building)
- Browser-first (WebRTC works in Safari on iOS): one web app; Android = Play listing wrapping the web app
  (Trusted Web Activity), PC = installable web app (+ a desktop wrapper later if needed).
- Rooms by link, no accounts: meet.jurisgames.com/<words>. Name typed once, remembered.
- Signaling: Cloudflare Worker + Durable Object per room (WebSocket), on jurisgames.com (Kleider OK'd routing).
- Media: small calls = direct mesh (P2P). Bigger calls need a forwarding unit: options to research
  (a) Cloudflare Realtime SFU free tier, (b) a participant's desktop app acting as forwarder (like tasklist's
  desktop relays), (c) mesh with lower video for >4. TURN for strict NATs (Cloudflare TURN).
- Features: chat (data channel), whiteboard (shared canvas over data channel), screen share, background blur /
  replace (MediaPipe selfie segmentation, Apache-2.0, runs in Safari), local recording (MediaRecorder: the
  recorder's own device, no server, no limit), hand raise, reactions, mute all/host controls kept minimal.
- No time limits, no accounts, free, open source.

## Sources checked
- Cloudflare Realtime (SFU + TURN) pricing page, last updated 2026-09-22: $0.05/GB egress, first 1,000 GB/month
  free, shared by SFU and TURN. Estimate: 5 people x 1 h, each receiving 4 streams at ~1 Mbps = ~9 GB/hour,
  so ~110 such call-hours a month free. Over that it bills his account: the app must keep a hard monthly
  budget (counted in the room Durable Object) and fall back to direct mesh when near it. Never let it overspend.
