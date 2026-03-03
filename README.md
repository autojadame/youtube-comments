# YouTube + Meta Comment Bot (DeepSeek)

This project extends your existing Meta OAuth onboarding flow and adds a **YouTube OAuth** flow for a **comment auto-reply bot**.

## What it does

- **YouTube**: connect a channel via OAuth (offline/refresh token), poll new comments, generate replies with **DeepSeek**, and post replies.
- **Meta (Facebook/Instagram)**: keep your current connect + asset mapping flow and add a **polling comment bot**:
  - Facebook Page comments: reply + like
  - Instagram comments: reply (official IG Graph API does not expose a "like comment" endpoint)

## Requirements

- Node.js **LTS recommended** (Node 20 is a safe target for `sqlite3`).
- SQLite.

## Setup

1) Install

```bash
yarn
```

2) Configure env

```bash
cp .env.example .env
```

Fill:
- `DEEPSEEK_API_KEY`
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`
- `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`

3) Migrate DB

```bash
yarn migrate
```

4) Run web app

```bash
yarn dev
```

5) Run worker

```bash
yarn worker
```

## URLs

- Home: `http://localhost:3000/`
- YouTube connect: `/youtube/connect`
- Meta connect: `/meta/connect`

## Notes

- YouTube comment hearts are **not available** via the official YouTube Data API.
- This bot is **polling-based** (no webhooks). If you want near real-time, add Pub/Sub + YouTube notifications.
