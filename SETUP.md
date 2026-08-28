# Document Vault Setup

## Google Login And Drive

This app uses Google Identity Services for sign-in and Google Drive for file storage. It does not use Firebase Authentication.

Required Google Cloud setup:

1. Open Google Cloud Console.
2. Select the Google Cloud project you want this app to use.
3. Open APIs & Services -> Library.
4. Enable Google Drive API.
5. Open APIs & Services -> OAuth consent screen.
6. Configure the app name, support email, developer contact, and test users if the app is still in testing.
7. Open APIs & Services -> Credentials.
8. Create an OAuth Client ID of type Web application.
9. Add authorized JavaScript origins:
   - `http://localhost:5173`
   - `https://documents-vault.vercel.app`
10. Put the OAuth web client ID in `VITE_GOOGLE_CLIENT_ID` locally and in Vercel.

## OAuth Scope

The app requests:

`openid profile email https://www.googleapis.com/auth/drive.file`

The Drive scope allows the app to create and manage files it creates or files the user explicitly opens with the app. Do not use a client secret, service account key, refresh token, or private key in the React frontend.

## Upload And Storage Flow

1. User signs in with Google through Google Identity Services.
2. The app receives a browser access token for Google Drive.
3. The app creates or locates a `Document Vault` folder in the user's Google Drive.
4. The browser uploads the original file to Google Drive.
5. Document metadata is saved in this browser's local storage.

## Viewer Strategy

PDF and image files are fetched from Google Drive using the authorized token and rendered inside the app as browser blob URLs. Office files require a secure server-side PDF preview pipeline for reliable in-app previews while keeping the original file in Drive.
