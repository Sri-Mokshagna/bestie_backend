# 🚨 QUICK FIX: Admin Login 500 Error

## Immediate Actions (Do These Now)

### 1️⃣ Run Diagnostic Script Locally
```bash
cd d:\Dost\bestie\server
npm run diagnose:firebase
```
This will tell you exactly what's wrong with your Firebase configuration.

### 2️⃣ Check Production Logs in Render
1. Go to: https://dashboard.render.com/
2. Select your service
3. Click "Logs" tab
4. Look for these errors:
   - `DECODER routines::unsupported` → Firebase private key issue
   - `Invalid credentials` → Admin user doesn't exist
   - `Failed to initialize Firebase` → Environment variables missing

### 3️⃣ Fix Firebase Private Key in Render

**The Problem:** Your `FIREBASE_PRIVATE_KEY` is likely malformed.

**The Solution:**
1. Download Firebase service account JSON:
   - Go to: https://console.firebase.google.com/
   - Project Settings → Service Accounts
   - Click "Generate New Private Key"

2. Open the JSON file and copy the `private_key` value EXACTLY:
   ```json
   "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADA...\n-----END PRIVATE KEY-----\n"
   ```

3. In Render Dashboard → Environment:
   - Find `FIREBASE_PRIVATE_KEY`
   - Paste the ENTIRE value (including quotes and `\n`)
   - Should look like: `"-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n"`
   - Click "Save Changes"

4. Redeploy (Render will auto-redeploy after env change)

### 4️⃣ Create Admin User in Production

**Option A: Via Render Shell**
```bash
# In Render Dashboard → Shell tab
npm run seed:admin
```

**Option B: Set Environment Variables First**
In Render Dashboard → Environment, add:
```
ADMIN_EMAIL=admin@bestie.local
ADMIN_PASSWORD=YourSecurePassword123!
ADMIN_PHONE=+919876543210
```
Then run: `npm run seed:admin`

**Option C: Add to Build Command**
In Render Dashboard → Settings → Build Command:
```bash
npm install && npm run build && npm run seed:admin
```

## Test After Fix

```bash
# Test via cURL
curl -X POST https://your-app.onrender.com/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bestie.local","password":"YourPassword123!"}'
```

**Expected Success:**
```json
{
  "customToken": "eyJhbGc...",
  "user": { "id": "...", "role": "admin", ... }
}
```

## If Still Failing

Run diagnostic locally and share output:
```bash
npm run diagnose:firebase
```

Check these in Render logs:
- ✅ "Firebase Admin initialized successfully"
- ✅ "Server running on port"
- ❌ Any errors with "Firebase" or "DECODER"

## Most Common Issues (90% of cases)

1. **Firebase private key has actual line breaks** instead of `\n`
   - Fix: Copy from JSON file with `\n` preserved

2. **Missing BEGIN/END markers** in private key
   - Fix: Include full key with markers

3. **Admin user doesn't exist** in production database
   - Fix: Run `npm run seed:admin`

4. **Wrong Firebase project** (mobile app vs backend mismatch)
   - Fix: Verify `FIREBASE_PROJECT_ID` matches mobile app's Firebase project
