# Firebase Authentication Troubleshooting Guide

## Issue 1: Admin Login Error - `error:1E08010C:DECODER routines::unsupported`

### Root Cause
This error occurs when Firebase Admin SDK cannot parse the private key due to improper formatting or encoding issues in the environment variable.

### Solution

#### Step 1: Get Your Firebase Service Account Key
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** (gear icon) → **Service Accounts**
4. Click **Generate New Private Key**
5. Download the JSON file

#### Step 2: Extract the Private Key
Open the downloaded JSON file. It will look like this:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com",
  ...
}
```

#### Step 3: Set Environment Variables in Production (Render.com)

**Option A: Copy the entire private_key value as-is (RECOMMENDED)**
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

**Important Notes:**
- Keep the `\n` characters - they represent newlines
- Include the quotes around the private key
- Include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers
- The key should be one continuous line with `\n` for newlines

**Option B: If Option A doesn't work, try without BEGIN/END markers**
The updated code will automatically add them:
```bash
FIREBASE_PRIVATE_KEY="MIIEvgIBADANBgkqhkiG9w0BAQEFAASC..."
```

#### Step 4: Verify in Render Dashboard
1. Go to your service in Render
2. Navigate to **Environment** tab
3. Check that `FIREBASE_PRIVATE_KEY` is set correctly
4. The value should show `\n` characters (not actual line breaks)
5. Click **Save Changes** and redeploy

#### Step 5: Check Logs
After redeploying, check your logs for:
```
Initializing Firebase Admin SDK... (projectId: your-project-id, privateKeyLength: XXXX)
✅ Firebase Admin initialized successfully
```

If you see errors, the logs will show:
- Whether BEGIN/END markers are present
- The length of the private key
- Specific error messages

---

## Issue 2: OTP Not Received on Mobile

### Root Cause
OTP sending is handled by **Firebase Authentication** on the client side (mobile app), not by your backend. The backend only verifies the token after Firebase authenticates the user.

### Solution Checklist

#### 1. Enable Phone Authentication in Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Authentication** → **Sign-in method**
4. Enable **Phone** provider
5. Click **Save**

#### 2. Configure Phone Authentication Settings

**For Development/Testing:**
1. In Firebase Console → **Authentication** → **Sign-in method** → **Phone**
2. Scroll to **Phone numbers for testing**
3. Add test phone numbers with test codes:
   ```
   +91 1234567890 → 123456
   ```
4. These numbers will receive the specified code without sending actual SMS

**For Production:**
1. Ensure you have proper billing enabled in Google Cloud Console
2. Firebase has daily SMS quotas - check your usage
3. Verify your app is not hitting rate limits

#### 3. Check Firebase Project Configuration in Mobile App

**Android (`android/app/google-services.json`):**
- Ensure this file is present and matches your Firebase project
- Verify the `project_id` matches your backend configuration

**iOS (`ios/Runner/GoogleService-Info.plist`):**
- Ensure this file is present and matches your Firebase project

#### 4. Verify SHA-1/SHA-256 Fingerprints (Android)

For production builds, you need to add your release key fingerprints:

1. Get your release key fingerprint:
   ```bash
   keytool -list -v -keystore your-release-key.keystore -alias your-key-alias
   ```

2. Add SHA-1 and SHA-256 to Firebase Console:
   - Go to **Project Settings** → **Your apps** → Select Android app
   - Scroll to **SHA certificate fingerprints**
   - Click **Add fingerprint**
   - Add both SHA-1 and SHA-256

3. Download the updated `google-services.json` and replace in your app

#### 5. Check App Verification (Android)

Firebase uses SafetyNet for app verification. If failing:

1. In Firebase Console → **Authentication** → **Settings** → **App Verification**
2. Temporarily disable **App Verification** for testing (NOT recommended for production)
3. Or ensure your app is properly signed and SafetyNet is working

#### 6. Verify Backend Configuration

Ensure your backend's Firebase project matches your mobile app:
```bash
# In Render environment variables
FIREBASE_PROJECT_ID=your-project-id  # Must match mobile app's Firebase project
```

#### 7. Test Phone Number Format

Ensure phone numbers are in E.164 format:
```
✅ Correct: +919876543210
❌ Wrong: 9876543210
❌ Wrong: +91 98765 43210
```

#### 8. Check Firebase Quotas and Billing

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Go to **APIs & Services** → **Dashboard**
4. Check **Identity Toolkit API** quota usage
5. Ensure billing is enabled for production use

#### 9. Debug Mobile App Logs

Check Flutter/mobile app logs for specific errors:
```dart
// In auth_service.dart, the verificationFailed callback shows errors
verificationFailed: (error) {
  print('Verification failed: ${error.message}');
  print('Error code: ${error.code}');
}
```

Common error codes:
- `invalid-phone-number`: Phone number format is wrong
- `too-many-requests`: Rate limit exceeded
- `quota-exceeded`: Daily SMS quota exceeded
- `app-not-authorized`: SHA fingerprints not configured

---

## Quick Verification Steps

### Test Admin Login
```bash
curl -X POST https://your-app.onrender.com/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

Expected success response:
```json
{
  "customToken": "eyJhbGc...",
  "user": { ... }
}
```

### Test Phone OTP (from mobile app)
1. Open mobile app
2. Enter phone number in E.164 format: `+919876543210`
3. Tap "Send OTP"
4. Check mobile app logs for Firebase errors
5. Check if SMS is received (or use test phone numbers)

---

## Additional Resources

- [Firebase Phone Auth Documentation](https://firebase.google.com/docs/auth/flutter/phone-auth)
- [Firebase Admin SDK Setup](https://firebase.google.com/docs/admin/setup)
- [Firebase Authentication Quotas](https://firebase.google.com/docs/auth/limits)
- [SafetyNet API](https://developer.android.com/training/safetynet/attestation)

---

## Still Having Issues?

1. **Check server logs** for detailed Firebase initialization messages
2. **Check mobile app logs** for Firebase authentication errors
3. **Verify environment variables** in Render dashboard
4. **Test with Firebase test phone numbers** first
5. **Ensure Firebase project billing is enabled** for production
