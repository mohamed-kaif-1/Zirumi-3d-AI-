# Mem0 long-term memory

Keep MEM0_API_KEY only in the ignored backend `.env`. Restart `npm run server`
after changing keys. The hosted JavaScript SDK is pinned to `mem0ai` 3.3.1.
The project `.npmrc` selects legacy peer resolution because this SDK declares an
unused native SQLite peer for its separate local/OSS module; the app uses only
the hosted client. A normal initial install failed under Windows application
control/native build restrictions. No native policy bypass was attempted.

The SDK's public add/getAll/search/get/delete/deleteAll operations use a pinned,
tested transport subclass. It disables SDK telemetry/automatic initialization,
restricts requests to the official HTTPS API, discards upstream error bodies,
bounds JSON, propagates cancellation and enforces 15-second deadlines. There
are no automatic billed retries. The readonly account check succeeded; remaining
plan quotas/credit balance are unknown.

Open **Memory settings** in the conversation header. Memory starts off for every
new browser identity. Enable it, choose a preference category, enter a short
non-sensitive value, and press **Remember preference**. Only that approved fact
is stored; raw audio, complete conversations and every chat sentence are never
automatically saved. MEM0_API_KEY and the reserved MEMORY_ENABLED environment
setting cannot opt a user in: per-browser consent is authoritative.

**View remembered information** displays saved preferences. Delete one entry or
use **Clear Memory**, then explicitly confirm deletion of all preferences for
this browser identity. Turning Memory off stops both saving and retrieval while
allowing you to view/delete old preferences. Clearing chat clears session context
and leaves long-term preferences intact. Character switching shares this identity's
preferences; it does not change memory ownership.

A random 256-bit HttpOnly, SameSite=Strict cookie authenticates the local browser
identity. The backend stores only its hash, an opaque Mem0 user ID and consent in
ignored `.zirumi/memory-identities.json`, using serialized atomic writes. Keep
that file when restarting or restoring the backend. The file contains no API key
or conversation text. Clearing cookies loses access to that browser identity;
there is no account-login/recovery flow in this local app. Public deployment still
requires proper account authentication, Secure cookies and HTTPS as described in
DEPLOYMENT.md; this local identity flow is not advertised as public multi-user hosting.

Every provider operation uses the server-resolved user plus app_id=zirumi.
Frontend user IDs are never accepted. Individual deletion checks ownership before
deleting; clearing never uses wildcard or project-wide deletion. Relevant search
returns at most three facts of at most 500 characters each and verifies their
user/app ownership and score. The threshold uses the documented default 0.1:
a real matching subject scored 0.2365 and was initially discarded by 0.35.
Retrieved data is labelled untrusted and cannot provide client-owned system roles.
When Mem0 fails, chat continues with completed session turns and a visible notice.

```powershell
npm test
npm run lint
npm run build
# Real isolated fixture: one short preference, three Groq recalls, then cleanup.
node scripts/browser-phase2-live.mjs
```

The live helper uses a new browser identity and cleans only that test identity's
preferences. Do not run it repeatedly without checking account quotas. Unit tests
use synthetic responses and test scoped requests, privacy isolation, consent,
restart persistence, deduplication, deletion, cancellation and unavailable memory.

Official references: [JavaScript quickstart](https://docs.mem0.ai/platform/quickstart),
[explicit add](https://docs.mem0.ai/api-reference/memory/add-memories),
[scoped list](https://docs.mem0.ai/api-reference/memory/get-memories),
[search](https://docs.mem0.ai/api-reference/memory/search-memories),
[individual deletion](https://docs.mem0.ai/api-reference/memory/delete-memory),
[scoped deletion](https://docs.mem0.ai/api-reference/memory/delete-memories).
