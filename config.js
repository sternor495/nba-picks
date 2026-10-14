// Firebase web config (public by design; access is controlled by firestore.rules).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4XNqZ7a1wDAYrbCvznthQGMga9KRmAls",
  authDomain: "hoops-standings.firebaseapp.com",
  projectId: "hoops-standings",
  storageBucket: "hoops-standings.firebasestorage.app",
  messagingSenderId: "37148472744",
  appId: "1:37148472744:web:f7d3b26702d2f6747f199d",
};

// Picks lock at the end of October: Sat Oct 31, 2026, 11:59 PM ET (Nov 1 03:59 UTC).
// If you change this, change the same number in firestore.rules.
window.LOCK_AT = 1793505540000;

// ESPN season id for 2026-27 (ESPN names a season by the year it ends).
window.SEASON = 2027;

// The group everyone is in automatically.
window.MAIN_GROUP = { id: 'main', name: 'Top 10 Main Group' };
