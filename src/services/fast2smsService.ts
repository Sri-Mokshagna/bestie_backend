import crypto from 'crypto';
import axios from 'axios';

// Fast2SMS credentials — set as environment variable on Render
const API_KEY = process.env.FAST2SMS_API_KEY ?? '';
const DLT_TEMPLATE_ID = process.env.FAST2SMS_DLT_TEMPLATE_ID ?? '';

// DLT-registered (all approved in Fast2SMS DLT Manager + PE-TM binding confirmed)
const SENDER_ID = 'VARSVF';
const ENTITY_ID = '1201177450558185157';

// MUST match EXACTLY what's on Jio DLT portal — lowercase {#var#}, single newlines
const DLT_TEMPLATE = 'Dear Bestie,\n\nYour Login OTP for the bestie app is {#var#}.\n\n-VVF Pvt Ltd';

// Fast2SMS INTERNAL message ID (from support team — NOT the DLT template ID)
// DLT Template ID 1207177496742046216 maps to Fast2SMS message ID 213597
const FAST2SMS_MESSAGE_ID = '213597';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LENGTH = 6;

interface OtpEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

// In-memory OTP store — process-local; replace with Redis if multi-instance
const otpStore = new Map<string, OtpEntry>();

/**
 * Fast2SMS OTP Service — DLT SMS route
 *
 * Required env vars (Render):
 *   FAST2SMS_API_KEY = Dev API key from fast2sms.com/dashboard/dev-api
 *
 * Correct API format confirmed by Fast2SMS support:
 *   message = Fast2SMS internal ID (213597), NOT the DLT template ID
 *   variables_values = OTP followed by pipe character (e.g. "123456|")
 */
export const fast2smsService = {
  async sendOtp(phone: string): Promise<void> {
    if (!API_KEY) throw new Error('FAST2SMS_API_KEY environment variable is not set');

    const mobile = phone.replace(/^\+91/, '').replace(/^\+/, '');
    if (!/^\d{10}$/.test(mobile)) {
      throw new Error(`Invalid Indian mobile number: ${mobile}`);
    }

    const otp = crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();

    otpStore.set(phone, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    console.log(`📱 [Fast2SMS] Sending OTP to: ${mobile}, message_id: ${FAST2SMS_MESSAGE_ID}`);

    let res: any;
    try {
      res = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
        params: {
          authorization: API_KEY,
          route: 'dlt',
          sender_id: SENDER_ID,
          message: FAST2SMS_MESSAGE_ID,  // Fast2SMS internal ID, NOT DLT template ID
          variables_values: `${otp}|`,   // pipe suffix required per Fast2SMS support
          flash: 0,
          numbers: mobile,
        },
        timeout: 10000,
      });
    } catch (err: any) {
      const body = err.response?.data;
      console.error(`❌ [Fast2SMS] HTTP ${err.response?.status} error:`, JSON.stringify(body));
      throw new Error(`Fast2SMS request failed (${err.response?.status}): ${JSON.stringify(body)}`);
    }

    console.log(`📱 [Fast2SMS] Send OTP response:`, JSON.stringify(res.data));

    if (!res.data?.return) {
      throw new Error(`Fast2SMS sendOtp failed: ${JSON.stringify(res.data)}`);
    }

    console.log(`✅ [Fast2SMS] OTP sent successfully to ${mobile}`);
  },

  verifyOtp(phone: string, otp: string): boolean {
    const entry = otpStore.get(phone);

    if (!entry) {
      console.warn(`⚠️ [Fast2SMS] No OTP found for: ${phone}`);
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(phone);
      console.warn(`⚠️ [Fast2SMS] OTP expired for: ${phone}`);
      return false;
    }

    entry.attempts += 1;
    const isValid = entry.otp === otp.trim();

    if (isValid) {
      otpStore.delete(phone);
      console.log(`✅ [Fast2SMS] OTP verified for: ${phone}`);
    } else {
      console.warn(`❌ [Fast2SMS] Invalid OTP for: ${phone} (attempt ${entry.attempts})`);
      if (entry.attempts >= 5) {
        otpStore.delete(phone);
        console.warn(`🚫 [Fast2SMS] OTP invalidated after 5 failed attempts for: ${phone}`);
      }
    }

    return isValid;
  },
};
