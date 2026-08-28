# Document Vault Setup

## Firebase Authentication, Firestore, And Drive

This app uses Firebase Authentication with Google Sign-In, Cloud Firestore for document metadata, and Google Drive for the original document files. It does not use Firebase Storage for documents.

Required Firebase setup:

1. Open Firebase Console for the existing project.
2. Enable Authentication.
3. Enable Google as a sign-in provider.
4. Add Authorized Domains:
   - `localhost`
   - `documents-vault.vercel.app`
5. Enable Cloud Firestore.
6. Publish the rules from `firestore.rules`.

Required Google Cloud setup:

1. Open Google Cloud Console.
2. Select the existing Google Cloud project.
3. Open APIs & Services -> Library.
4. Enable Google Drive API.
5. Open APIs & Services -> OAuth consent screen.
6. Configure the app name, support email, developer contact, and test users if the app is still in testing.
7. Confirm the app audience and OAuth scopes.
8. Add authorized JavaScript origins for the Firebase web OAuth client:
   - `http://localhost:5173`
   - `https://documents-vault.vercel.app`

Because the app uses Firebase `signInWithPopup()`, do not invent manual redirect URIs for the React app.

## OAuth Scope

The app requests:

`https://www.googleapis.com/auth/drive.file`

Firebase requests the basic profile/email authentication scopes automatically. The Drive scope lets Document Vault create and manage files it creates or files the user explicitly opens with the app. This is the minimum practical Drive scope for private app-owned document storage. Do not use a client secret, service account key, refresh token, or private key in the React frontend.

## Vercel Environment Variables

Set these Vite variables locally and in Vercel:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

## Upload And Storage Flow

1. User signs in with Google through Firebase Authentication.
2. Firebase authenticates the user and returns a short-lived Google Drive access token from the Google provider credential.
3. The app creates or locates a `Document Vault` folder in the user's Google Drive.
4. Top-level uploads are placed in category folders under `Document Vault`.
5. The browser uploads the original file to Google Drive.
6. Firestore stores metadata and the Drive file ID.

## Viewer Strategy

PDF and image files are fetched from Google Drive using the authorized token and rendered inside the app as browser blob URLs. Office files require a secure server-side conversion or preview pipeline for reliable in-app previews while keeping the original file private in Drive.
