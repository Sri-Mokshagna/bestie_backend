# 📱 OTP Not Received - Complete Troubleshooting Guide

## ⚠️ IMPORTANT: OTP is Sent by Firebase, NOT Your Backend

Your backend **DOES NOT** send OTPs. Firebase Authentication handles OTP sending entirely on the **mobile app side**.

**Flow:**
1. User enters phone number in mobile app
2. Mobile app calls `FirebaseAuth.verifyPhoneNumber()` 
3. **Firebase sends SMS directly to user's phone**
4. User enters OTP in mobile app
5. Mobile app verifies OTP with Firebase
6. Mobile app gets Firebase ID token
7. Mobile app sends ID token to your backend
8. Backend verifies token and creates/updates user

**Your backend only verifies the token AFTER Firebase has already authenticated the user.**

---

## 🔍 Step-by-Step Diagnosis

### Step 1: Check Firebase Console - Phone Auth Enabled

1. Go to: https://console.firebase.google.com/
2. Select your project
3. Navigate to: **Authentication** → **Sign-in method**
4. Find **Phone** provider
5. Ensure it's **ENABLED** ✅

**If disabled:**
- Click on "Phone"
- Toggle "Enable"
- Click "Save"

---

### Step 2: Check Firebase Project Billing

**Firebase requires billing to be enabled for SMS in production.**

1. Go to: https://console.cloud.google.com/
2. Select your Firebase project
3. Go to **Billing**
4. Ensure billing is **enabled** and **active**

**Free Tier Limits:**
- 10 SMS verifications per day (testing only)
- For production, you need a paid plan

**Check Quota Usage:**
1. Go to: https://console.cloud.google.com/
2. Navigate to: **APIs & Services** → **Dashboard**
3. Search for "Identity Toolkit API"
4. Check quota usage

---

### Step 3: Verify Mobile App Configuration

#### Android Configuration

**1. Check `google-services.json`:**
```bash
# Location: android/app/google-services.json
# Verify it matches your Firebase project
```

Open the file and check:
```json
{
  "project_info": {
    "project_id": "your-project-id"  // Must match backend FIREBASE_PROJECT_ID
  }
}
```

**2. Add SHA-1 and SHA-256 Fingerprints:**

For **Debug Build:**
```bash
cd android
./gradlew signingReport

# Copy SHA-1 and SHA-256 from output
```

For **Release Build:**
```bash
keytool -list -v -keystore your-release-key.keystore -alias your-key-alias

# Copy SHA-1 and SHA-256
```

**3. Add Fingerprints to Firebase:**
1. Firebase Console → Project Settings
2. Select your Android app
3. Scroll to "SHA certificate fingerprints"
4. Click "Add fingerprint"
5. Add both SHA-1 and SHA-256
6. Download updated `google-services.json`
7. Replace in your app
8. Rebuild the app

#### iOS Configuration

**1. Check `GoogleService-Info.plist`:**
```bash
# Location: ios/Runner/GoogleService-Info.plist
```

**2. Verify Bundle ID matches Firebase:**
- Firebase Console → Project Settings → iOS app
- Bundle ID should match your Xcode project

---

### Step 4: Test with Firebase Test Phone Numbers

**For Development/Testing (No SMS sent):**

1. Firebase Console → **Authentication** → **Sign-in method**
2. Scroll to **Phone numbers for testing**
3. Add test numbers:
   ```
   Phone Number: +91 1234567890
   Test Code: 123456
   ```
4. Click "Add"

**In your mobile app:**
- Enter the test phone number: `+91 1234567890`
- Firebase will NOT send SMS
- Enter the test code: `123456`
- Should work immediately

---

### Step 5: Check Phone Number Format

**Must be in E.164 format:**

✅ **Correct:**
```
+919876543210
+14155552671
+442071838750
```

❌ **Wrong:**
```
9876543210          // Missing country code
+91 98765 43210     // Has spaces
(987) 654-3210      // Has formatting
```

**In your mobile app code:**
```dart
// Ensure phone number is in E.164 format
String phoneNumber = '+91${phoneController.text.trim()}';
await authService.sendOtp(phoneNumber);
```

---

### Step 6: Check Mobile App Logs

**Add detailed logging in your Flutter app:**

```dart
// In auth_service.dart
Future<void> sendOtp(String phoneNumber) async {
  print('📱 Sending OTP to: $phoneNumber');
  
  await _firebaseAuth.verifyPhoneNumber(
    phoneNumber: phoneNumber,
    verificationCompleted: (credential) async {
      print('✅ Auto-verification completed');
      await _signInWithCredential(credential);
    },
    verificationFailed: (error) {
      print('❌ Verification failed:');
      print('   Error code: ${error.code}');
      print('   Error message: ${error.message}');
      throw Exception('Verification failed: ${error.message}');
    },
    codeSent: (verificationId, forceResendingToken) {
      print('✅ Code sent successfully');
      print('   Verification ID: ${verificationId.substring(0, 20)}...');
      _verificationId = verificationId;
    },
    codeAutoRetrievalTimeout: (verificationId) {
      print('⏱️  Auto-retrieval timeout');
      _verificationId = verificationId;
    },
    timeout: const Duration(seconds: 60),
  );
}
```

**Common Error Codes:**

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `invalid-phone-number` | Phone format wrong | Use E.164 format |
| `too-many-requests` | Rate limit exceeded | Wait or use test numbers |
| `quota-exceeded` | Daily SMS limit reached | Enable billing or wait 24h |
| `app-not-authorized` | SHA fingerprints missing | Add SHA-1/SHA-256 to Firebase |
| `missing-phone-number` | Empty phone number | Validate input |
| `captcha-check-failed` | reCAPTCHA failed | Check app verification settings |

---

### Step 7: Check App Verification (Android)

Firebase uses **SafetyNet** to verify your app is legitimate.

**If SafetyNet is failing:**

1. Firebase Console → **Authentication** → **Settings**
2. Click on **App Verification** tab
3. **For testing only**, you can disable app verification:
   - Toggle off "Enforce app verification"
   - ⚠️ **NOT recommended for production**

**Better solution:**
- Ensure app is properly signed
- Add correct SHA fingerprints
- Test on real device (not emulator)

---

### Step 8: Check Firebase Project Match

**Backend and Mobile MUST use the same Firebase project:**

**Backend (.env):**
```bash
FIREBASE_PROJECT_ID=your-project-id
```

**Mobile (google-services.json):**
```json
{
  "project_info": {
    "project_id": "your-project-id"  // Must match backend
  }
}
```

**Verify:**
```bash
# In mobile app directory
cat android/app/google-services.json | grep project_id

# Should match your backend .env FIREBASE_PROJECT_ID
```

---

## 🧪 Testing Checklist

### Test 1: Use Firebase Test Phone Number
```
1. Add test number in Firebase Console: +91 1234567890 → 123456
2. In mobile app, enter: +91 1234567890
3. Tap "Send OTP"
4. Should NOT send SMS
5. Enter code: 123456
6. Should authenticate successfully
```

### Test 2: Check Mobile App Logs
```
Look for:
✅ "Code sent successfully"
❌ "Verification failed" with error code
```

### Test 3: Test with Real Number (if billing enabled)
```
1. Use your real phone number in E.164 format
2. Should receive SMS within 30 seconds
3. Enter OTP
4. Should authenticate
```

---

## 🔧 Common Issues & Solutions

### Issue 1: "App Not Authorized"
**Cause:** SHA fingerprints not configured

**Solution:**
```bash
# Get SHA fingerprints
cd android
./gradlew signingReport

# Add to Firebase Console → Project Settings → Android app
# Download new google-services.json
# Rebuild app
```

### Issue 2: "Quota Exceeded"
**Cause:** Exceeded daily SMS limit (10 for free tier)

**Solution:**
- Enable billing in Google Cloud Console
- Or wait 24 hours for quota reset
- Or use test phone numbers

### Issue 3: "Too Many Requests"
**Cause:** Rate limiting (too many attempts)

**Solution:**
- Wait 1-2 hours
- Use different phone number
- Use test phone numbers for development

### Issue 4: "Invalid Phone Number"
**Cause:** Phone number not in E.164 format

**Solution:**
```dart
// Ensure proper format
String phoneNumber = '+${countryCode}${phoneWithoutSpaces}';
// Example: +919876543210
```

### Issue 5: SMS Not Received (No Error)
**Possible Causes:**
- Billing not enabled (production)
- Phone number blocked by carrier
- SMS delayed by carrier (wait 2-3 minutes)
- Wrong phone number entered

**Solution:**
- Check Firebase Console → Authentication → Usage
- Verify billing is enabled
- Try test phone numbers first
- Check phone number is correct

---

## 🚀 Quick Test Script

Add this to your mobile app for debugging:

```dart
// Test Firebase Phone Auth Configuration
Future<void> testFirebasePhoneAuth() async {
  print('🧪 Testing Firebase Phone Auth Configuration...');
  
  try {
    // Test with Firebase test number
    final testPhone = '+911234567890'; // Add this to Firebase Console first
    
    await FirebaseAuth.instance.verifyPhoneNumber(
      phoneNumber: testPhone,
      verificationCompleted: (credential) {
        print('✅ Test successful: Auto-verification completed');
      },
      verificationFailed: (error) {
        print('❌ Test failed:');
        print('   Code: ${error.code}');
        print('   Message: ${error.message}');
      },
      codeSent: (verificationId, token) {
        print('✅ Test successful: Code sent');
        print('   Verification ID: ${verificationId.substring(0, 20)}...');
      },
      codeAutoRetrievalTimeout: (verificationId) {
        print('⏱️  Auto-retrieval timeout (normal)');
      },
      timeout: const Duration(seconds: 30),
    );
  } catch (e) {
    print('❌ Test error: $e');
  }
}
```

---

## 📊 Monitoring & Debugging

### Check Firebase Authentication Usage
1. Firebase Console → **Authentication** → **Usage**
2. View:
   - Phone sign-ins today
   - SMS sent
   - Errors

### Check Google Cloud Logs
1. https://console.cloud.google.com/
2. **Logging** → **Logs Explorer**
3. Filter: `resource.type="identitytoolkit.googleapis.com"`
4. View SMS sending logs and errors

---

## 🆘 Still Not Working?

### Collect This Information:

1. **Mobile app logs** when sending OTP
2. **Firebase error code** (if any)
3. **Phone number format** used
4. **Firebase project ID** (backend vs mobile)
5. **SHA fingerprints** configured (Android)
6. **Billing status** in Google Cloud
7. **Test phone numbers** working or not

### Debug Steps:

1. ✅ Test with Firebase test phone numbers first
2. ✅ Check mobile app logs for error codes
3. ✅ Verify SHA fingerprints (Android)
4. ✅ Confirm billing enabled (production)
5. ✅ Ensure phone format is E.164
6. ✅ Check Firebase project matches backend

---

## 📚 Resources

- [Firebase Phone Auth - Flutter](https://firebase.google.com/docs/auth/flutter/phone-auth)
- [Firebase Authentication Quotas](https://firebase.google.com/docs/auth/limits)
- [SafetyNet API](https://developer.android.com/training/safetynet/attestation)
- [E.164 Phone Format](https://en.wikipedia.org/wiki/E.164)
