import axios from 'axios';

const AUTH_KEY = process.env.MSG91_AUTH_KEY ?? '';
// Template ID is optional — if not set, MSG91 uses its default OTP template
const TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID ?? '';
const SENDER_ID = process.env.MSG91_SENDER_ID ?? 'BESTIE';
const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

/**
 * MSG91 OTP Service
 * Handles OTP send and verify via MSG91 API v5.
 * Required env var: MSG91_AUTH_KEY
 * Optional env vars: MSG91_TEMPLATE_ID (default template used if absent), MSG91_SENDER_ID
 */
export const msg91Service = {
  /**
   * Send OTP to a phone number via MSG91.
   * @param phone E.164 format, e.g. +919876543210
   */
  async sendOtp(phone: string): Promise<void> {
    if (!AUTH_KEY) throw new Error('MSG91_AUTH_KEY environment variable is not set');
    // MSG91 expects mobile without leading '+', e.g. 919876543210
    const mobile = phone.replace(/^\+/, '');

    console.log(`📱 [MSG91] Sending OTP to: ${mobile}`);

    const res = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      null, // no request body for this endpoint
      {
        params: {
          authkey: AUTH_KEY,
          ...(TEMPLATE_ID ? { template_id: TEMPLATE_ID } : {}),
          mobile,
          sender: SENDER_ID,
          otp_expiry: OTP_EXPIRY_MINUTES,
          otp_length: OTP_LENGTH,
        },
        timeout: 10000,
      }
    );

    console.log(`📱 [MSG91] Send OTP response:`, res.data);

    if (res.data?.type !== 'success') {
      throw new Error(`MSG91 sendOtp failed: ${JSON.stringify(res.data)}`);
    }

    console.log(`✅ [MSG91] OTP sent successfully to ${mobile}`);
  },

  /**
   * Verify OTP entered by user against MSG91.
   * @param phone E.164 format, e.g. +919876543210
   * @param otp   6-digit OTP entered by user
   * @returns true if OTP is valid, false otherwise
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    if (!AUTH_KEY) throw new Error('MSG91_AUTH_KEY environment variable is not set');

    const mobile = phone.replace(/^\+/, '');

    console.log(`🔐 [MSG91] Verifying OTP for: ${mobile}`);

    const res = await axios.get('https://control.msg91.com/api/v5/otp/verify', {
      headers: {
        authkey: AUTH_KEY,
      },
      params: {
        mobile,
        otp,
      },
      timeout: 10000,
    });

    console.log(`🔐 [MSG91] Verify OTP response:`, res.data);

    const isValid = res.data?.type === 'success';
    console.log(`${isValid ? '✅' : '❌'} [MSG91] OTP verification: ${isValid ? 'valid' : 'invalid'}`);

    return isValid;
  },
};
