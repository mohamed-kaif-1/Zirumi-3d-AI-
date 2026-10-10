# Sarvam language routes

The existing application remains in `echo-avatar-day1/Zirumi`. Start the backend
with `npm run server` and frontend with `npm run dev`. Open Settings → Conversation
language. English uses Deepgram → Groq → Cartesia. Tamil, Hindi and Indian English
use Sarvam → Groq → Sarvam. Memory consent applies across characters and languages.
Language changes cancel capture, synthesis and unfinished replies; session history
stays intact. No automatic language detection or error-triggered provider switch
is enabled. Previously displayed English replies require selecting English again
to replay them in their original language.

Backend-only configuration:

```dotenv
SARVAM_API_KEY=
SARVAM_STT_MODEL=saaras:v4
SARVAM_TTS_MODEL_TA=bulbul:v3
SARVAM_TTS_MODEL_HI=bulbul:v4-flash
SARVAM_TTS_MODEL_EN=bulbul:v4-flash
GROQ_CHAT_MODEL=openai/gpt-oss-20b
GROQ_CHAT_MODEL_TA=
GROQ_CHAT_MODEL_HI=
GROQ_CHAT_MODEL_EN=
```

Blank Groq locale overrides use the configured primary Groq model. Setting an
override is an explicit alternative model path; the backend checks actual account
access before generation. It never translates an English fallback invisibly.
Tamil/Hindi replies must contain predominantly native script before playback.
This detects wrong-language output; it does not prove linguistic accuracy.

| Character | Tamil: v3 | Hindi: v4 Flash | Indian English: v4 Flash |
| --- | --- | --- | --- |
| Aira | `roopa` | `roopa_hi_companion` | `aparna_en_companion` |
| Luna | `ritu` | `ritu_hi_social_lively` | `ritu_en_reels` |
| Mira | `kavitha` | `kavya_hi_conversational` | `ishita_en_customer` |
| Zyra | `neha` | `shreya_hi_conversational` | `sanchita_en_social` |

The official v4 Flash Tamil catalog currently contains male personas. Tamil is
explicitly configured with documented v3 feminine voices. This is a configuration
choice, not an automatic fallback. Voice identities differ from English Cartesia.
Optional `SARVAM_VOICE_AIRA_TA`, etc. follow the character/locale suffixes
`AIRA/LUNA/MIRA/ZYRA` and `TA/HI/EN`; assignments must belong to the configured
curated model/catalog and remain distinct. Hindi/Indian English can explicitly
select v3 with its documented short speaker names. Tamil v4 is rejected by this
feminine-voice configuration.

STT sends multipart audio to `/speech-to-text`, with the exact selected BCP-47
language and model. Saaras v3 adds `mode=transcribe`; v4 uses default native
transcription. Browser recordings stop at 30 seconds and 5 MB. A mismatched
detected language produces an actionable error. Silent recordings create no turn.
TTS sends one text to `/text-to-speech`, with language, model, speaker, pace,
temperature and PCM WAV output at 44,100 Hz. Requests over 2,500 characters are
rejected locally. Responses must contain a bounded, valid base64 PCM WAV; generated
audio remains ephemeral. Existing audio/RMS animation owns playback and cleanup.

Status endpoints accept `?language=ta-IN`, `hi-IN`, or `en-IN`. Chat/TTS JSON accepts
the optional validated `language`; recorded upload uses `X-Zirumi-Language`.
English requests retain their existing contract. Client-provided provider, model,
speaker and system-role overrides remain rejected. Metadata distinguishes configured
catalog assignments from successful actual synthesis.

Verify locally with `npm test`, `npm run lint`, and `npm run build`. Live browser
checks use `node scripts/browser-phase3-live.mjs ta-IN` (then Hindi/Indian English),
with Playwright installed in the existing temporary verification runner. They
require the temporary, non-sensitive speech fixtures documented in the report.
They consume real credits and should not be repeatedly run without reason.
Local speech rate limits remain 10/minute; run browser cases sequentially.

Account balances and billing limits are unknown; check each provider dashboard.
No billing bypass, automatic paid retries, physical microphone claims or human
voice-quality certification are implied. Public hosting still requires the
authenticated HTTPS proxy and persistent identity storage in DEPLOYMENT.md.

Primary references checked on 2026-10-10:

- [Sarvam native transcription](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe)
- [Sarvam synthesis API](https://docs.sarvam.ai/api-reference/text-to-speech/convert)
- [Sarvam model-specific speaker catalog](https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices)
- [Sarvam authentication](https://docs.sarvam.ai/api-reference/authentication)
