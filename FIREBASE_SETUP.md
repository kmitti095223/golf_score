# Firebase Setup

The app stores golf rounds and par settings in Firestore under the current anonymous Firebase user. Existing browser data is copied to Firestore when that user's rounds collection is empty; existing par settings are copied when the cloud settings document is missing.

1. In Firebase Console, open project `golfscore-6fa24` and create a Firestore Database.
2. In Authentication > Sign-in method, enable **Anonymous**.
3. Publish the contents of `firestore.rules` in Firestore Database > Rules.
4. Serve the app from HTTPS or localhost so the Firebase Web SDK can load and connect.

Anonymous accounts are separate for each browser profile. To share data across devices or recover it after clearing browser data, add a persistent sign-in method and link it to the anonymous account.
