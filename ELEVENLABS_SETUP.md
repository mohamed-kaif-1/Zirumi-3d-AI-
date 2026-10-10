# ZIRUMI character voices

Keep `ELEVENLABS_API_KEY` only in the app's ignored backend `.env`. Never put
credentials in `.env.example`, browser code or a `VITE_` variable. Run the backend
from this nested application directory and restart it after changing credentials.

The three supplied IDs are fixed in the voice registry. Aira's persisted ID is
`default`; the TTS endpoint also accepts `original` as an alias. No model paths,
stored avatar IDs or voice assignments are renamed.

| Character | ID | ElevenLabs voice |
| --- | --- | --- |
| Aira | `default` | `AIRA_VOICE_ID`, or the existing server `ELEVENLABS_VOICE_ID`; unset keeps her saved browser voice |
| Luna | `sky` | `tnSpp4vdxKPjI9w0GnoV` |
| Mira | `nova` | `kPzsL2i3teMYv0FxEYQ6` |
| Zyra | `ember` | `hpp4J3VqNfWAUOO0d1Us` |

Enable Text to Speech on the ElevenLabs key. Enable Voices Read (`voices_read`)
and Models Read (`models_read`) to fetch actual voice names and supported-model
metadata. Missing catalog-read permission is shown separately; an exact registered
voice can still attempt synthesis with its TTS permission. A successful request
must return valid MP3 bytes before it is marked synthesis verified.

The configured model is `eleven_multilingual_v2`, with `mp3_44100_128` output.
The backend uses the [official TTS endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
and [voice metadata endpoint](https://elevenlabs.io/docs/api-reference/voices/get).
See [API key permissions](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys).
Metadata read success is not a guarantee of synthesis quota or account-plan access.

`ELEVENLABS_FALLBACK=none` is the default and the current local setting. An explicit
`browser` setting permits visibly reported fallback for replies only. Cloud
character previews always require actual assigned ElevenLabs audio. Unconfigured
Aira is the intentional exception and retains her existing browser voice.

Start `npm run server` and `npm run dev`, then run:

```powershell
npm run test:voices:live
```

This spends synthesis quota when access is available and writes sanitized evidence
to `verification/permanent-voices/live-elevenlabs-results.json`. It never stores
proprietary generated audio or prints credentials. A nonzero exit indicates at
least one character is pending or unavailable; per-character results explain why.

On 2026-10-10, Zyra's exact voice succeeded through the real backend and browser.
Luna and Mira returned HTTP 402 `payment_required`. Their IDs remain unchanged.
Aira has no configured ElevenLabs ID; her actual Microsoft David browser voice
started and finished in the production UI test. Metadata requests still returned
HTTP 401 `missing_permissions`, so provider voice names are unverified.

After account access changes, retry Preview. Failed metadata expires after 15
seconds; successful metadata is cached for five minutes. Restart after changing
the key or Aira voice ID. Existing generated previews are cached only in the
current page's memory; reload the page after changing server voice configuration.

The backend is local-only, with host/origin guards, bounded requests, ten TTS POST
attempts per minute, two concurrent AI requests, cancellation and deadlines.
If exposed publicly, put it behind authenticated HTTPS and per-account quotas;
the loopback development server is not an authenticated public service.

See [PERMANENT_VOICE_REPORT.md](PERMANENT_VOICE_REPORT.md) for full current evidence.
