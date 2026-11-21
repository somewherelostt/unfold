# Auth + key storage setup

Unfold's sign-in (email magic link + 6-digit code) and per-user API key storage run on a hosted Postgres + auth provider.
For the hackathon demo this is **off**: `UNFOLD_DEV_NO_AUTH=1` keeps the app in local demo mode (no sign-in, keys held encrypted in server memory).
The steps below are only needed to turn real sign-in on later.

## 1. Database
Create a project with the auth provider, then run all of
`db/migrations/20261122000000_api_keys.sql` in its SQL editor.
It creates `public.api_keys` with row-level security (users only see and change their own rows).

## 2. Auth settings
- **Site URL**: your deployed URL, or `http://localhost:3000` while developing.
- **Redirect URLs**: `http://localhost:3000/**` and `https://<your-domain>/**`.
- Email sign-in enabled, "Confirm email" on.
- Magic Link and Confirm signup email templates must include the code so the OTP box works:
  ```html
  <p><a href="{{ .ConfirmationURL }}">Sign in to Unfold</a></p>
  <p>Or enter this code: <strong>{{ .Token }}</strong></p>
  ```

## 3. Env vars
Put these in `apps/web/.env.local` (the web app reads env files from `apps/web`, not the repo root) and in your host's env settings:
```
NEXT_PUBLIC_UNFOLD_AUTH_URL=      # project URL
NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY= # public (anon) key
UNFOLD_AUTH_SERVICE_KEY=          # secret key, server only
UNFOLD_ENCRYPTION_KEY=            # openssl rand -hex 32 (64 hex chars; keep it stable)
NEXT_PUBLIC_SITE_URL=             # optional, used for the magic-link redirect
CEREBRAS_API_KEY=                 # optional server fallback when a user hasn't added a key
GPU_API_KEY=                      # optional fallback for the speed comparison
```
Remove `UNFOLD_DEV_NO_AUTH` and restart `pnpm dev`. Changing `UNFOLD_ENCRYPTION_KEY` later makes saved keys unreadable.

## 4. Check it
1. `/login` → email → link or code → lands on `/app`.
2. `/settings` → save a Cerebras key → **Test key** says the Kimi model is available.
3. The `api_keys` table shows only ciphertext / iv / tag / last4.

## For other code
- `getUser()` / `requireUser()` from `@/lib/auth/server` (route handlers: `const u = await requireUser(); if (u instanceof Response) return u;`).
- `getUserApiKey(userId, "cerebras" | "gpu")` from `@/lib/auth/api-keys` → user's key, else env fallback, else null.
- Sign out: `<form action="/auth/signout" method="post">` or `SignOutButton` from `src/app/(auth)/_components/sign-out-button.tsx`.
