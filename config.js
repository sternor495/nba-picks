// Firebase web config (Project settings → Your apps → Web app → Config).
// While this is null the site runs in single-browser demo mode.
window.FIREBASE_CONFIG = null;

// Picks lock at the end of October: Sat Oct 31, 2026, 11:59 PM ET (Nov 1 03:59 UTC).
// If you change this, change the same number in firestore.rules.
window.LOCK_AT = 1793505540000;

// ESPN season id for 2026-27 (ESPN names a season by the year it ends).
window.SEASON = 2027;

// The group everyone is in automatically.
window.MAIN_GROUP = { id: 'main', name: 'Top 10 Main Group' };
