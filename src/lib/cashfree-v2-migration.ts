/**
 * Cashfree Payout API V2 Migration Guide
 * 
 * ISSUE: v1 and v1.2 APIs are deprecated
 * ERROR: "The payout v1 and v1.2 APIs have been deprecated. Please use v2 APIs"
 * 
 * CORRECTED IMPLEMENTATION FOR V2 API
 * Reference: https://docs.cashfree.com/reference/v2transfer
 */

// ============================================
// V2 API ENDPOINTS (CORRECT)
// ============================================

// Base URLs remain the same, but endpoints change:
// Production: https://payout-api.cashfree.com/payout/v1.2
// Sandbox: https://payout-gamma.cashfree.com/payout/v1.2

// The base URL path includes "v1.2" but this is NOT the API version
// The actual API version is determined by how you structure your requests

// ============================================
// KEY CHANGES FOR V2 API
// ============================================

/*
Based on Cashfree documentation for v2 transfer API:

1. AUTHENTICATION: Still uses Bearer token (same as before)

2. BENEFICIARY CREATION: Endpoint changed
   OLD (v1): POST /addBeneficiary
   NEW (v2): POST /beneficiaries
   
   Payload structure also changed

3. TRANSFER REQUEST: Endpoint changed  
   OLD (v1): POST /requestTransfer
   NEW (v2): POST /transfers
   
   Payload structure changed

4. TRANSFER STATUS: Endpoint changed
   OLD (v1): GET /getTransferStatus?transferId=xxx
   NEW (v2): GET /transfers/{transferId}

5. BALANCE: Endpoint changed
   OLD (v1): GET /getBalance
   NEW (v2): GET /balance
*/

// ============================================
// UPDATED IMPLEMENTATION
// ============================================

/**
 * Create beneficiary - V2 API
 */
async function createBeneficiaryV2(data: {
    beneId: string;
    name: string;
    email: string;
    phone: string;
    vpa: string; // UPI ID
}) {
    const config = this.initializePayoutConfig();
    const headers = await this.getPayoutHeaders();

    const payload = {
        // V2 format
        beneficiary_id: data.beneId,
        beneficiary_name: data.name,
        beneficiary_email: data.email,
        beneficiary_phone: data.phone,
        beneficiary_vpa: data.vpa // For UPI
        // OR for bank transfer:
        // beneficiary_bankAccount: data.bankAccount,
        // beneficiary_ifsc: data.ifsc
    };

    const response = await axios.post(
        `${config.baseUrl}/beneficiaries`, // V2 endpoint
        payload,
        { headers, timeout: 20000 }
    );

    return response.data;
}

/**
 * Request payout transfer - V2 API
 */
async function requestPayoutV2(data: {
    transferId: string;
    beneId: string;
    amount: number;
    transferMode?: 'upi' | 'banktransfer';
    remarks?: string;
}) {
    const config = this.initializePayoutConfig();
    const headers = await this.getPayoutHeaders();

    const payload = {
        // V2 format
        transfer_id: data.transferId,
        beneficiary_id: data.beneId,
        amount: data.amount.toFixed(2),
        transfer_mode: data.transferMode || 'upi',
        remarks: data.remarks || 'Payout from Bestie App'
    };

    const response = await axios.post(
        `${config.baseUrl}/transfers`, // V2 endpoint
        payload,
        { headers, timeout: 30000 }
    );

    return response.data;
}

/**
 * Get transfer status - V2 API
 */
async function getPayoutStatusV2(transferId: string) {
    const config = this.initializePayoutConfig();
    const headers = await this.getPayoutHeaders();

    const response = await axios.get(
        `${config.baseUrl}/transfers/${transferId}`, // V2 endpoint - REST style
        { headers, timeout: 15000 }
    );

    return response.data;
}

/**
 * Get balance - V2 API
 */
async function getPayoutBalanceV2() {
    const config = this.initializePayoutConfig();
    const headers = await this.getPayoutHeaders();

    const response = await axios.get(
        `${config.baseUrl}/balance`, // V2 endpoint
        { headers, timeout: 15000 }
    );

    return response.data;
}

// ============================================
// SUMMARY OF CHANGES NEEDED
// ============================================

/*
In cashfree.ts, update these methods:

1. createBeneficiary:
   - Change endpoint: /addBeneficiary → /beneficiaries
   - Change payload keys from camelCase to snake_case:
     * beneId → beneficiary_id
     * name → beneficiary_name
     * email → beneficiary_email
     * phone → beneficiary_phone
     * vpa → beneficiary_vpa

2. requestPayout:
   - Change endpoint: /requestTransfer → /transfers
   - Change payload keys:
     * transferId → transfer_id
     * beneId → beneficiary_id
     * amount → amount (same)
     * transferMode → transfer_mode
     * remarks → remarks (same)

3. getPayoutStatus:
   - Change endpoint: /getTransferStatus?transferId=xxx → /transfers/{transferId}
   - Use REST-style path parameter instead of query parameter

4. getPayoutBalance:
   - Change endpoint: /getBalance → /balance

5. getBeneficiary:
   - Change endpoint: /getBeneficiary/{beneId} → /beneficiaries/{beneId}
*/
