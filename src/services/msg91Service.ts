import axios from 'axios';

// MSG91 credentials — set these as environment variables on Render
const AUTH_KEY = process.env.MSG91_AUTH_KEY ?? '';
// Template ID: 69c207670616db272c0a1770 (from MSG91 dashboard → OTP → Template ID)
const TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID ?? '';
const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

/**
 * MSG91 OTP Service — Direct API v5
 * Required env vars:
 *   MSG91_AUTH_KEY     = 502821TSU3X1LsvCA69c20959P1
 *   MSG91_TEMPLATE_ID  = 69c207670616db272c0a1770
 */
export const msg91Service = {
  /**
   * Send OTP via MSG91.
   * @param phone E.164 format, e.g. +919876543210
   */
  async sendOtp(phone: string): Promise<void> {
    if (!AUTH_KEY) throw new Error('MSG91_AUTH_KEY environment variable is not set');

    const mobile = phone.replace(/^\+/, '');
    console.log(`📱 [MSG91] Sending OTP to: ${mobile}`);

    const res = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      null,
      {
        params: {
          authkey: AUTH_KEY,
          ...(TEMPLATE_ID ? { template_id: TEMPLATE_ID } : {}),
          mobile,
          otp_expiry: OTP_EXPIRY_MINUTES,
          otp_length: OTP_LENGTH,
        },
        timeout: 10000,
      }
    );

    console.log(`📱 [MSG91] Send OTP response:`, JSON.stringify(res.data));

    if (res.data?.type !== 'success') {
      throw new Error(`MSG91 sendOtp failed: ${JSON.stringify(res.data)}`);
    }

    console.log(`✅ [MSG91] OTP sent successfully to ${mobile}`);
  },

  /**
   * Verify OTP via MSG91.
   * Correct format: GET /api/v5/otp/verify?otp=xxx&mobile=yyy
   * with authkey in the request header.
   * @param phone E.164 format, e.g. +919876543210
   * @param otp   6-digit OTP entered by user
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    if (!AUTH_KEY) throw new Error('MSG91_AUTH_KEY environment variable is not set');

    const mobile = phone.replace(/^\+/, '');
    console.log(`🔐 [MSG91] Verifying OTP — mobile: ${mobile}, authkey_length: ${AUTH_KEY.length}`);

    const res = await axios.get('https://control.msg91.com/api/v5/otp/verify', {
      headers: {
        authkey: AUTH_KEY,
        'content-type': 'application/json',
      },
      params: {
        otp,
        mobile,
      },
      timeout: 10000,
    });

    console.log(`🔐 [MSG91] Verify OTP response:`, JSON.stringify(res.data));

    const isValid = res.data?.type === 'success';
    if (!isValid) {
      console.warn(`⚠️ [MSG91] Verify failed — code: ${res.data?.code}, message: ${res.data?.message}`);
    }
    console.log(`${isValid ? '✅' : '❌'} [MSG91] OTP ${isValid ? 'verified' : 'invalid'}`);

    return isValid;
  },
};
