# Document Vault Setup

## Firebase

This app uses Firebase Authentication and Cloud Firestore. It does not use Firebase Storage for documents.

1. In Firebase Console, open project `document-vault-76520`.
2. Enable Authentication -> Sign-in method -> Google.
3. Add your local and production domains to Authentication -> Settings -> Authorized domains.
4. Create Cloud Firestore.
5. Publish the rules in `firestore.rules`.

The Firebase web config belongs in `.env`. These values are public Firebase app identifiers, but `.env` is still ignored so deployments can manage configuration cleanly.

## Google Cloud Console

You mentioned Google Cloud project `vendora-9c81e` with project number `748344090344`. The Firebase config in this app points to Firebase project `document-vault-76520`.

Because this app currently signs in through Firebase Auth for `document-vault-76520`, the Google OAuth token is associated with the Google Cloud project behind `document-vault-76520`. Enable the Google Drive API there first. Enabling Drive API only in `vendora-9c81e` will still produce `accessNotConfigured` until the app is switched to OAuth credentials from that project.

Required Google Cloud setup:

1. Open Google Cloud Console.
2. In the project selector, choose `document-vault-76520`.
3. Open APIs & Services -> Library.
4. Enable Google Drive API.
5. Open APIs & Services -> OAuth consent screen.
6. Configure the app name, support email, developer contact, and test users if the app is still in testing.
7. Open APIs & Services -> Credentials.
8. Confirm the Firebase-created Web client is present, or create an OAuth Client ID of type Web application.
9. Add authorized JavaScript origins:
   - `http://localhost:5173`
   - your production URL
10. Put the OAuth web client ID in `VITE_GOOGLE_CLIENT_ID` when you move to a dedicated Google Identity Services flow.

## OAuth Scope

The app currently requests:

`https://www.googleapis.com/auth/drive.file`

This is narrower than full Drive access. It allows the app to create and manage files it creates or files the user explicitly opens with the app. Do not use a client secret, service account key, refresh token, or private key in the React frontend.

## Upload And Storage Flow

1. User signs in with Google through Firebase Auth.
2. The app requests a Google OAuth access token with the Drive file scope.
3. The app creates or locates a `Document Vault` folder in the user's Google Drive.
4. The browser uploads the original file to Google Drive.
5. Firestore receives only metadata, including `driveFileId`, `driveFolderId`, category, owner, timestamps, and search fields.

## Viewer Strategy

PDF and image files are fetched from Google Drive using the authorized token and rendered inside the app as browser blob URLs. Office files require a secure server-side PDF preview pipeline for reliable in-app previews while keeping the original file in Drive.
