# Admin Login 500 Error - Debugging Guide

## Current Error
```
Status: 500 Internal Server Error
Response: { "error": "Internal server error" }
```

## Most Likely Causes

### 1. **Firebase Private Key Issue (MOST LIKELY)**
The DECODER error we saw earlier suggests Firebase Admin SDK cannot parse the private key in production.

**Check Production Logs for:**
```
Firebase createCustomToken error: error:1E08010C:DECODER routines::unsupported
```

**Solution:**
1. Go to Render Dashboard → Your Service → Environment
2. Check `FIREBASE_PRIVATE_KEY` variable
3. It should look like this (one line with `\n` for newlines):
   ```
   "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n"
   ```
4. **Common mistakes:**
   - Missing BEGIN/END markers
   - Actual line breaks instead of `\n`
   - Extra spaces or quotes
   - Not escaping the newlines

**How to fix:**
1. Download your Firebase service account JSON from Firebase Console
2. Copy the `private_key` value EXACTLY as it appears (with `\n`)
3. Paste into Render environment variable
4. Click Save Changes
5. Redeploy

### 2. **Admin User Not Created in Production Database**

**Check if admin exists:**
```bash
# Connect to your production MongoDB and run:
db.users.findOne({ "profile.email": "admin@bestie.local", role: "admin" })
```

**Solution - Create Admin User:**
```bash
# Option A: Run seed script in production
npm run seed:admin

# Option B: Set environment variables in Render and run seed script
ADMIN_EMAIL=admin@bestie.local
ADMIN_PASSWORD=YourSecurePassword123!
ADMIN_PHONE=+919876543210

# Then trigger the seed script via Render shell or add to build command
```

### 3. **Firebase Not Initialized**

**Check Production Logs for:**
```
❌ Failed to initialize Firebase Admin
Missing required Firebase environment variables
```

**Solution:**
Ensure all three Firebase variables are set in Render:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## Step-by-Step Debugging

### Step 1: Check Production Logs
1. Go to Render Dashboard → Your Service → Logs
2. Look for errors during server startup
3. Look for errors when you attempt login

**What to look for:**
```
✅ Good:
- "Firebase Admin initialized successfully"
- "Server running on port 3000"

❌ Bad:
- "Failed to initialize Firebase Admin"
- "Firebase createCustomToken error"
- "DECODER routines::unsupported"
```

### Step 2: Verify Environment Variables
In Render Dashboard → Environment tab, verify:

```bash
# Required for Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"

# Required for Database
MONGODB_URI=mongodb+srv://...

# Admin credentials (for seeding)
ADMIN_EMAIL=admin@bestie.local
ADMIN_PASSWORD=YourSecurePassword
ADMIN_PHONE=+919876543210
```

### Step 3: Run Admin Seed Script
If admin user doesn't exist in production:

1. Add to Render build command:
   ```bash
   npm run build && npm run seed:admin
   ```

2. Or run manually via Render Shell:
   ```bash
   npm run seed:admin
   ```

### Step 4: Test with Updated Logging
After redeploying with the updated code, the logs will show:
- Exact Firebase error message
- Whether Firebase initialization succeeded
- Detailed error during token creation

## Quick Fix Commands

### 1. Rebuild and Redeploy
```bash
# Locally
npm run build

# Then push to trigger Render deployment
git add .
git commit -m "Fix Firebase authentication"
git push
```

### 2. Create Admin User Manually (MongoDB)
```javascript
// Connect to production MongoDB
use bestie

// Create admin user
db.users.insertOne({
  phone: "+919876543210",
  role: "admin",
  coinBalance: 0,
  profile: {
    email: "admin@bestie.local",
    name: "Administrator"
  },
  password: "$2b$10$YourHashedPasswordHere", // Use bcrypt to hash
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
})
```

### 3. Generate Password Hash
```bash
# Run this locally to generate password hash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('YourPassword123!', 10).then(h => console.log(h))"
```

## Testing After Fix

### 1. Test Admin Login via Postman
```http
POST https://your-app.onrender.com/api/auth/admin/login
Content-Type: application/json

{
  "email": "admin@bestie.local",
  "password": "YourPassword123!"
}
```

### 2. Expected Success Response
```json
{
  "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "...",
    "phone": "+919876543210",
    "role": "admin",
    "coinBalance": 0,
    "profile": {
      "email": "admin@bestie.local",
      "name": "Administrator"
    },
    "status": "active"
  }
}
```

### 3. Check Logs for Success
```
Initializing Firebase Admin SDK... (projectId: your-project, privateKeyLength: 1704)
✅ Firebase Admin initialized successfully
```

## Common Error Messages and Solutions

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `DECODER routines::unsupported` | Invalid private key format | Fix `FIREBASE_PRIVATE_KEY` format |
| `Invalid credentials` | Wrong email/password or user doesn't exist | Run seed script or check credentials |
| `Account is not active` | User status is not 'active' | Update user status in database |
| `Missing required Firebase environment variables` | Env vars not set | Set all three Firebase variables |
| `Failed to generate authentication token` | Firebase SDK error | Check Firebase private key and project ID |

## Still Not Working?

1. **Share production logs** - Copy the relevant error logs from Render
2. **Verify Firebase project** - Ensure Firebase project ID matches between mobile app and backend
3. **Check MongoDB connection** - Verify database is accessible and admin user exists
4. **Test locally first** - Set same environment variables locally and test

## Contact Points
- Check Render logs: https://dashboard.render.com/
- Check Firebase Console: https://console.firebase.google.com/
- Check MongoDB Atlas: https://cloud.mongodb.com/
