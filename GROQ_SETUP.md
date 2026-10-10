# Groq setup for ZIRUMI

The user chose **Groq instead of xAI/Grok**. These are different providers and
credentials. Use Groq's API and `GROQ_*` configuration for conversation and
optional legacy transcription. Phase 1 now uses Deepgram for local recorded input;
see PHASE1_SETUP.md. Set DEFAULT_STT_PROVIDER=groq to explicitly select Whisper.
ZIRUMI remains the product brand.

Create a key at [Groq Console](https://console.groq.com/keys) and configure the
existing nested app's ignored backend `.env`:

```dotenv
GROQ_API_KEY=your_groq_key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_CHAT_MODEL=openai/gpt-oss-20b
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_STT_LANGUAGE=
```

Preserve ElevenLabs settings separately. Groq is not used for TTS.
Restart `npm run server`; keep `npm run dev` running. Never put a credential in
frontend source, `VITE_*`, screenshots, committed files or chat. Replace any key
that was disclosed through a message using the provider console.

The account's actual `/models` endpoint must list the selected models. The server
checks this before billable work and caches discovery for five minutes.
`configured` on a health route only means a credential exists; `modelVerified`
means cached account discovery accepted the selected model. Successful chat or
transcription remains the final proof of inference access and quota.

Defaults on this account were chosen from real model discovery:
`openai/gpt-oss-20b` and `whisper-large-v3-turbo`. GPT-OSS uses low reasoning effort,
hidden reasoning and a 2,048-token completion cap. Change `GROQ_CHAT_MODEL` to a
supported account model returned by discovery, then restart the server.
Model-specific reasoning options are omitted for other models. There is no
automatic model substitution, paid search or provider fallback.

Actual endpoints:

- `GET https://api.groq.com/openai/v1/models`
- `POST https://api.groq.com/openai/v1/chat/completions`
- `POST https://api.groq.com/openai/v1/audio/transcriptions`

The browser still uses `/api/chat`, `/api/transcribe` and the existing health
routes. STT is multipart, with the audio file last. The optional language hint is
a two-letter ISO code. Auto-detection is the default. `verbose_json` supplies
text, duration and segment metadata; raw provider data is not forwarded.
The existing WebM/Opus and Ogg recorder formats and PCM/float WAV uploads are supported by
[Groq STT](https://console.groq.com/docs/speech-to-text).

Run the live checks:

```powershell
npm run test:live
node --env-file=.env scripts/smoke-groq.mjs C:\path\known-spoken.webm
```

The first check verifies real models, all four introductions, Kaif recall across
Luna/Mira and safe handling of a deliberately invalid token. The optional audio
argument additionally verifies real STT and generation from its transcript.
Evidence is written to `verification/groq/live-results.json`, with live-provider
flags. Unit and fixture browser results are never evidence of live generation.

Recorded speech can also be checked in the app: choose Settings → Recorded
speech, start the microphone, speak and Stop. Expect one user message, one reply
and released microphone tracks before playback. Silence and permission errors
must not submit a message. Repeated recordings must produce one completed turn
per recording. No microphone is restarted automatically.

Authentication/model-access errors return safe setup failures. Rate limits return
429, balance/permission failures do not retry, offline failures return a safe
connection error, and deadlines/cancellation prevent stale results. Logs contain
latency and allowlisted numeric token usage; cost is recorded only if returned
by the provider, never inferred from a stale price table.

Groq publishes [free-plan limits](https://console.groq.com/docs/rate-limits) for
these models. Account limits still apply. The app never upgrades the account,
changes service tier or falls back to another provider. HTTP 429 is reported
with a bounded numeric Retry-After header when supplied by Groq. Use Try again
after the wait; retries reuse the failed user turn and never start automatically.

Groq connections use an Undici dispatcher with a 60-second cache of successful
DNS resolutions, IPv4-first ordering and automatic address-family selection.
HTTPS hostname and certificate verification stay enabled. DNS failures are not
cached, and provider requests are not replayed. Model discovery has a 15-second
deadline within the existing 45-second request budget. A persistent local DNS or
connectivity outage still needs a working network.
Completed Groq HTTP connections close rather than remaining idle, avoiding reuse
of sockets silently expired by an upstream or local network. This trades some
TLS connection overhead for safer uploads on this connection.

The current repair results and restart commands are in
[GROQ_FREE_REPAIR_REPORT.md](GROQ_FREE_REPAIR_REPORT.md).
