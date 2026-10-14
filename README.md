# Hoops Oracle

Predict the 2026-27 NBA season with friends: conference top 10s, win totals, and a starting five's stat lines. Static site (GitHub Pages) + Firebase Firestore. Live scoring pulls from ESPN's public feeds.

- `config.js`: Firebase config, lock time, season
- `firestore.rules`: paste into Firebase console → Firestore → Rules
- `data.js`: teams + player pool (generated from ESPN, 2026-10-14)
