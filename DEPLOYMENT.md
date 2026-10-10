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
Mem0 identities and consent live in ignored `.zirumi/memory-identities.json`.
Persist that backend storage securely across restarts; use one backend process or
a shared authenticated identity store before scaling. Public cookies require
Secure/HTTPS, authenticated account binding and per-user abuse controls. The
current HttpOnly SameSite local cookie is a local-demo identity, not a complete
public account system.

Nothing was deployed publicly during this work. See PHASE3_REPORT.md for the
final local verification result. All six configured keys stay server-side; no
provider balance or free-credit allowance is promised.
