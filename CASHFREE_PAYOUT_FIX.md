# Cashfree Payout Issue Resolution

## Problem Identified

The payout functionality was failing with the error:
```
"Token is not valid" (status: 403)
```

This occurred during the transfer step after beneficiaries were successfully created.

## Root Cause Analysis

1. **Authentication Method Mismatch**: The Cashfree Payout V2 API requires Basic authentication using Client ID and Client Secret, but the original code was using custom headers (`X-Client-Id`, `X-Client-Secret`).

2. **Missing Environment Variables**: The `.env` file had empty values for:
   - `CASHFREE_PAYOUT_CLIENT_ID`
   - `CASHFREE_PAYOUT_CLIENT_SECRET`

## Solution Applied

### 1. Fixed Authentication Headers

Updated the `getPayoutHeaders()` method in `src/lib/cashfree.ts`:

**Before:**
```typescript
return {
  'Content-Type': 'application/json',
  'X-Client-Id': config.clientId,
  'X-Client-Secret': config.clientSecret,
};
```

**After:**
```typescript
const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
return {
  'Content-Type': 'application/json',
  'Authorization': `Basic ${credentials}`,
};
```

### 2. Updated Configuration Status

Changed authentication method description from "Direct Client ID/Secret" to "Basic Authentication".

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

## How It Works Now

1. **Beneficiary Creation**: Creates recipient details in Cashfree system
2. **Transfer Request**: Uses Basic authentication to initiate money transfer
3. **Status Tracking**: Monitors transfer status and updates database

## Testing

A test script `src/scripts/test_cashfree_auth_fix.ts` has been created to verify the authentication fix.

## Verification Steps

1. Update your environment variables with valid Cashfree payout credentials
2. Restart your server
3. Test the payout functionality
4. Monitor logs for successful transfer requests

The authentication error should now be resolved, and transfers should proceed successfully.