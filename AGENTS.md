<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Neon is the only database, reached exclusively through the Lovable Neon connector gateway (`src/lib/neon.ts`: `sql`, `neon()`, `GatewayPool`; keys `LOVABLE_API_KEY` + `NEON_API_KEY`), never a direct connection string. Schema changes are idempotent `db/NN_*.sql` files; runtime `create table if not exists` safety nets go through `runSchemaEnsure`. Why: the connection string stays in Lovable; gateway calls are stateless so cross-request transactions do not exist.
- Login ON rout.be (Better Auth, `better-auth.server.ts`) and login VIA rout.be (OIDC provider, `src/lib/oauth/*`) never share config; provider env vars use the `ROUT_PROVIDER_*` prefix. Why: one role must not break the other.
- Sign-in tiles always render; unconfigured providers show a notice. OAuth callbacks for a provider with missing credentials are refused before Better Auth is created with `provider_not_configured` (400) plus a server warning (`api_/auth/$.ts` + `isProviderConfigured`). Why: missing keys must never hide options or crash auth.
- Public profile visibility (`publicProfile`, `timelineVisible` in `display_prefs`) is enforced server-side in the public profile/timeline functions. Why: client checks leak data.
- Influencer/business verification hands out names through the `approved_handles` whitelist (db/45); users claim exactly one via `claimApprovedHandle`. Why: the admin approves names, never types them.
- Bluesky/Mastodon accounts without a provider-verified email are created or linked only after a hashed 6-digit email code (`fediverse-otp.server.ts`, db/46). Why: typed emails allow takeover.
- Birthdates live in the separate `user_birthdates` table (db/48), written only via `saveMyBirthdate`; verification returns `birthdate_required` until present. Why: keeps legal data out of mass-assignment paths.
- Every env var name is documented in `ENVIRONMENT.md` (+ `.env.example`); provider env lookups go through `envAny()` aliases in `better-auth.server.ts` (incl. `<PROVIDER>_OAUTH_CLIENT_*`); the auth secret resolves via `resolveAuthSecret()` with a derived fallback. Why: one findable list; a missing variable never breaks all sign-ins.
- A failed provider-status check on the sign-in screen means unknown (buttons still try), never "all inactive". Why: a flaky status call must not disable logins.
- Every sign-in method returns through `/auth/continue`; destinations and tour drafts use HttpOnly cookies, never URLs. Tour drafts apply only to new accounts; taken handles fall back to onboarding. Why: zero-hop redirects, no token leakage, existing members never overwritten. Auth emails use `sendLocalizedEmail` with static template IDs and non-blocking dispatch so provider outages never break sign-in.
- Bot checks run only via self-hosted ALTCHA proof-of-work (`altcha.server.ts`, single-use via `altcha_used` db/54); `api_/auth/$.ts` refuses email auth flows with `altcha_invalid` (400) before Better Auth runs. Why: no third-party bot service, no tracking.
- Community stats are live counts; reviews show only when `approved` (db/65); empty sections hide. Approving a verification cancels that user's other open same-tier requests (`verification-dedupe.ts`). Why: no fake social proof or duplicate work.
- Vercel builds use nitro's `vercel` preset (auto via `VERCEL`); the sandbox forces cloudflare, so test with sandbox env vars unset.
- Third-party images on public pages load only via `/api/public/proxy-image` (host allowlist in `src/lib/image-proxy-rules.ts`). Why: visitors' IPs must never reach third-party image hosts.
- Hub connections live in `user_integrations` (db/73) with a per-row Pro/Social/Both audience; `verified` is set only server-side when the handle matches a sign-in identity. Why: typed handles must never look proven.
- Total reach is summed only from Connections Hub rows (`user_integrations`, db/74): open platforms auto-fetch, others use a per-integration manual count; never social_links or placeholders. Why: the number must reflect what the member actually connected.
- Emailed action links (review, booking) only confirm on GET, change on POST; status mails send fire-and-forget. Why: scanners open links; mail failures never block actions.
- 2FA/passkeys: Better Auth `twoFactor` + `@better-auth/passkey`, tables in `neon_auth` (db/77). Why: no custom crypto.
- Uploaded user files are tracked in `user_assets` (db/80) with retention set server-side by `asset-retention.ts`; expired rows are purged by `/api/public/cron/cleanup-assets`. Why: storage never grows without an owner or an end date.
