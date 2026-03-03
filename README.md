# YouTube Comment Bot (DeepSeek)

✅ Onboarding web: upload **Google OAuth client secret JSON** + connect YouTube channel  
✅ Auto-renew tokens (refresh token)  
✅ Worker: polls new comments and replies using DeepSeek  
⚠️ YouTube **does not provide an official API to “heart”/react** to comments. You can only reply/moderate via Data API.

## Requirements
- Node.js 20+ recommended
- A Google Cloud OAuth Client (Web application) with **YouTube Data API v3 enabled**
- DeepSeek API key

## Quick start (yarn)
```bash
yarn
cp .env.example .env
yarn migrate
yarn dev
# in another terminal:
yarn worker
```

Open:
- http://localhost:3000

## OAuth JSON upload flow
1) Go to **/setup** and upload your `client_secret_*.json`
2) The app will show you the required redirect URI: `BASE_URL/oauth2/callback`
   - That URI must be added in Google Cloud Console (Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs).
3) Click **Connect channel**. Grant permission.
4) You get a **Manage Link** (connection key) to manage/disable the bot.

## Notes / Limitations
- Replies are idempotent: each comment is replied once (tracked in SQLite).
- The worker uses `commentThreads.list(allThreadsRelatedToChannelId=...)` and `comments.insert` for replies.
