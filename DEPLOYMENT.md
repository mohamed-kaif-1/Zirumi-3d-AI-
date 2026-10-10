# Deployment

The current setup is local: Vite on loopback port 5173 (preview 4173) proxies
`/api` to the Node backend on loopback port 3001. A static `dist` upload alone
does not provide the API backend. Node 22.12+ is required. Preserve `.env` outside
the public frontend bundle and use server-side secrets on any future host.

For public hosting, use an HTTPS reverse proxy with an authenticated backend,
exact allowed origins and per-user abuse controls. The current loopback backend
is not a public multi-user server. `ZIRUMI_ALLOWED_ORIGINS` accepts exact HTTPS
origins; the proxy must preserve a permitted loopback Host when forwarding.
Microphones require HTTPS or localhost. Application-wide local rate limits and
two concurrent provider requests currently bound usage; they do not replace
authentication or per-user production limits.

Phase 1 uses push-to-talk HTTP uploads and buffered REST audio. WebSocket STT
and streamed playback are not enabled. Before adding or deploying them, verify
host support for long-lived connections, proxy idle timeouts and WebSockets.
Mem0 and Sarvam deployment is gated on preceding live acceptance checks.

Nothing was deployed publicly during this work. See PHASE1_REPORT.md for the
current readiness result and missing credentials/voice verification.
