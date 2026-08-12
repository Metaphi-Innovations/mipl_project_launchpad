# Metaphi Launchpad Clone

React/Vite clone of `https://metaphi-launchpad.figma.site/`.

## Setup

1. Copy `.env.example` to `.env`.
2. Add your Firebase web app config values.
3. Run:

```bash
npm install
npm run dev
```

The app uses Firestore collections `launchpadApplications` and `launchpadUsers`. On first load or login, it seeds the collections with the default applications and demo admin/user records if they are empty.

If Firebase environment variables are missing, the app falls back to browser local storage for local visual preview only.

Enable **Authentication > Sign-in method > Anonymous** in Firebase, then deploy Firestore rules before saving from the app:

```bash
npm run firebase:login
npm run firebase:rules
```
