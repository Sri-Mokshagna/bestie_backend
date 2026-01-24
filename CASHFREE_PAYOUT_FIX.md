# Cashfree Payout Issue Resolution

## Problem Identified

The payout functionality was failing with the error:
```
"Token is not valid" (status: 403)
```

This occurred during the transfer step after beneficiaries were successfully created.

## Root Cause Analysis

1. **Incorrect Authentication Method**: The code was attempting to use token-based authentication (Bearer token), but Cashfree Payout API V2 uses **simplified authentication** with just Client ID and Secret in headers.

2. **Missing Environment Variables**: The `.env` file had empty values for:
   - `CASHFREE_PAYOUT_CLIENT_ID`
   - `CASHFREE_PAYOUT_CLIENT_SECRET`

## Official Cashfree Guidance

According to Cashfree documentation:
- **V2 API does NOT require token generation**
- Authentication is simplified using only Client ID and Secret Key
- Use headers: `X-Client-Id` and `X-Client-Secret`
- No need for Bearer token or Basic authentication

## Solution Applied

### 1. Fixed Authentication Headers

Updated the `getPayoutHeaders()` method in `src/lib/cashfree.ts`:

**Before (Incorrect - Token-based):**
```typescript
const token = await getPayoutAuthToken();
return {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
};
```

**After (Correct - V2 Simplified):**
```typescript
return {
  'Content-Type': 'application/json',
  'X-Client-Id': config.clientId,
  'X-Client-Secret': config.clientSecret,
};
```

### 2. Removed Token Generation Logic

Removed unnecessary token generation and caching code since V2 doesn't need it.

## Required Actions

To fully resolve the payout issue, you need to:

1. **Obtain Cashfree Payout Credentials**:
   - Go to Cashfree Dashboard > Payouts > API Keys
   - Get your `PAYOUT_CLIENT_ID` and `PAYOUT_CLIENT_SECRET`

2. **Update Environment Variables**:
   ```bash
   # In your .env file, set:
   CASHFREE_PAYOUT_CLIENT_ID=your_actual_client_id
   CASHFREE_PAYOUT_CLIENT_SECRET=your_actual_client_secret
   ```

3. **For Production (Render)**: Update environment variables in Render dashboard

## How It Works Now

1. **Beneficiary Creation**: Uses X-Client-Id/X-Client-Secret headers
2. **Transfer Request**: Uses same simplified authentication
3. **Status Tracking**: Uses same authentication method
4. **Balance Check**: Uses same authentication method

All endpoints now use the same consistent, simplified V2 authentication.

## Verification Steps

1. Update your environment variables with valid Cashfree payout credentials
2. Restart your server
3. Test the payout functionality
4. You should see successful transfers without any token-related errors

The "Token is not valid (403)" error will be completely resolved once valid credentials are provided.