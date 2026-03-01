import { Router, Request, Response } from 'express';
import { Payment, PaymentStatus } from '../models/Payment';
import { User } from '../models/User';
import { CoinPlan } from '../models/CoinPlan';
import { logger } from '../lib/logger';
import { cashfreeService } from '../lib/cashfree';
import { coinService } from '../services/coinService';
import { TransactionType } from '../models/Transaction';

const router = Router();

/**
 * Debug endpoint to check payment environment configuration
 */
router.get('/debug/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const payment = await Payment.findOne({ orderId });

    const appId = process.env.CASHFREE_APP_ID || '';
    const secretKey = process.env.CASHFREE_SECRET_KEY || '';
    const hasCredentials = appId.length > 0 && secretKey.length > 0;
    const hasTestMarkers = appId.includes('TEST') || secretKey.includes('_test_') || secretKey.includes('test');

    // Also fetch order status from Cashfree
    let cashfreeOrderStatus = null;
    let cashfreeError = null;
    if (payment?.cashfreeOrderId) {
      try {
        cashfreeOrderStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
      } catch (e: any) {
        cashfreeError = e.message;
      }
    }

    res.json({
      orderId,
      paymentFound: !!payment,
      storedEnvironment: payment?.gatewayResponse?._cashfree_environment || 'NOT_STORED',
      paymentSessionId: payment?.gatewayResponse?.payment_session_id || 'NONE',
      sessionIdLength: payment?.gatewayResponse?.payment_session_id?.length || 0,
      directCheckoutUrl: payment?.gatewayResponse?._direct_checkout_url || 'NOT_STORED',
      credentials: {
        hasCredentials,
        hasTestMarkers,
        appIdPrefix: appId.substring(0, 15) || '(empty)',
        detectedEnvironment: (!hasCredentials || hasTestMarkers) ? 'sandbox' : 'production',
      },
      paymentStatus: payment?.status,
      cashfreeOrderStatus,
      cashfreeError,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper function to recreate a payment session when the original expires
 * Creates a new Cashfree order with the same details
 */
async function recreatePaymentSession(payment: any): Promise<string | null> {
  try {
    // Fetch user and plan details
    const user = await User.findById(payment.userId);
    if (!user) {
      logger.error({ userId: payment.userId }, 'User not found for payment session recreation');
      return null;
    }

    // Get plan details if available
    let planName = 'Coin Pack';
    if (payment.planId) {
      const plan = await CoinPlan.findById(payment.planId);
      if (plan) {
        planName = plan.name;
      }
    }

    const serverUrl = process.env.SERVER_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://bestie-backend-prod.onrender.com'
        : 'http://localhost:3000');

    // Generate customer email
    const customerEmail = user.profile?.email || `user_${user.phone?.replace(/\+/g, '')}@bestie.app`;

    // Create a new order with Cashfree using the same order ID
    // Note: We use a new order ID since Cashfree doesn't allow reusing order IDs
    const newOrderId = `${payment.orderId}_R${Date.now().toString(36)}`;

    logger.info({
      originalOrderId: payment.orderId,
      newOrderId,
      amount: payment.amount
    }, 'Creating new Cashfree order for expired session');

    const result = await cashfreeService.createOrderAndGetLink({
      orderId: newOrderId,
      amount: payment.amount,
      currency: 'INR',
      customerDetails: {
        customerId: payment.userId.toString(),
        customerName: user.profile?.name || 'Bestie User',
        customerEmail,
        customerPhone: user.phone || '',
      },
      returnUrl: `${serverUrl}/pay/success`,  // CLEAN - no query params!
      notifyUrl: `${serverUrl}/api/payments/webhook`,
    });

    // Update payment record with new session info
    payment.cashfreeOrderId = result.order.order_id;
    payment.gatewayResponse = result.order;
    await payment.save();

    logger.info({
      orderId: payment.orderId,
      newCashfreeOrderId: result.order.order_id,
      hasSessionId: !!result.order.payment_session_id
    }, 'Successfully recreated payment session');

    return result.order.payment_session_id;
  } catch (error: any) {
    logger.error({
      error: error.message,
      orderId: payment.orderId
    }, 'Failed to recreate payment session');
    return null;
  }
}

/**
 * Payment Initiation - Cashfree JS SDK
 * Renders a page that uses Cashfree SDK to open checkout
 * Per Cashfree support: Must use SDK, not direct URL append
 */
router.get('/initiate', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.query;

    if (!orderId || typeof orderId !== 'string') {
      logger.warn('Payment initiation without orderId');
      return res.status(400).send(renderErrorPage(
        'Missing Order ID',
        'Order ID is required to process payment. Please try again from the app.'
      ));
    }

    logger.info({ orderId }, 'Payment initiation request');

    // Find the payment record
    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      logger.error({ orderId }, 'Payment not found');
      return res.status(404).send(renderErrorPage(
        'Order Not Found',
        `Payment order "${orderId}" was not found. It may have expired or been cancelled.`
      ));
    }

    // Check if payment is already completed
    if (payment.status === PaymentStatus.SUCCESS) {
      logger.info({ orderId }, 'Payment already completed - redirecting to success');
      return res.redirect(`/pay/success?orderId=${orderId}`);
    }

    // Get the payment session ID from gateway response
    let paymentSessionId = payment.gatewayResponse?.payment_session_id;

    // Check if payment session is still valid by getting fresh status from Cashfree
    // This helps identify if the session has expired even if stored in DB
    if (paymentSessionId) {
      try {
        const orderStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
        logger.info({ orderId: payment.orderId, cashfreeOrderId: payment.cashfreeOrderId, orderStatus: orderStatus?.order_status }, 'Checking current order status from Cashfree');

        // If Cashfree says the order is expired or terminated, even though we have a session ID,
        // we need to recreate the order
        if (orderStatus?.order_status === 'EXPIRED' || orderStatus?.order_status === 'TERMINATED') {
          logger.info({ orderId: payment.orderId, status: orderStatus.order_status }, 'Order has expired on Cashfree side - recreating payment session');
          const newSessionId = await recreatePaymentSession(payment);
          if (newSessionId) {
            paymentSessionId = newSessionId;
          }
        } else if (!orderStatus?.payment_session_id) {
          // If Cashfree doesn't have a session ID anymore, recreate
          logger.info({ orderId: payment.orderId }, 'No session ID from Cashfree - recreating payment session');
          const newSessionId = await recreatePaymentSession(payment);
          if (newSessionId) {
            paymentSessionId = newSessionId;
          }
        }
      } catch (statusErr: any) {
        logger.warn({ err: statusErr.message, orderId: payment.orderId }, 'Could not get fresh status from Cashfree, using stored session ID');
        // Continue with stored session ID if status check fails
      }
    }

    // If no session ID, try to refresh or recreate
    if (!paymentSessionId) {
      logger.warn({ orderId, gatewayResponse: payment.gatewayResponse }, 'Payment session ID not found - attempting to recover');

      try {
        const orderStatus = await cashfreeService.getPaymentStatus(orderId);
        if (orderStatus?.payment_session_id) {
          payment.gatewayResponse = { ...payment.gatewayResponse, ...orderStatus };
          await payment.save();
          paymentSessionId = orderStatus.payment_session_id;
          logger.info({ orderId }, 'Recovered payment session from Cashfree');
        } else if (orderStatus?.order_status === 'EXPIRED' || orderStatus?.order_status === 'TERMINATED') {
          logger.info({ orderId, status: orderStatus.order_status }, 'Order expired - creating new order');
          const newSessionId = await recreatePaymentSession(payment);
          if (newSessionId) {
            paymentSessionId = newSessionId;
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message, orderId }, 'Failed to refresh payment session');
        try {
          const newSessionId = await recreatePaymentSession(payment);
          if (newSessionId) {
            paymentSessionId = newSessionId;
          }
        } catch (recreateErr: any) {
          logger.error({ err: recreateErr.message, orderId }, 'Failed to recreate payment session');
        }
      }
    }

    if (!paymentSessionId) {
      logger.error({ orderId }, 'Unable to obtain valid payment session');
      return res.status(500).send(renderErrorPage(
        'Payment Session Expired',
        'Your payment session has expired or is invalid. Please go back to the app and try again.'
      ));
    }

    // Determine environment
    let environment: 'sandbox' | 'production' = 'sandbox';

    if (payment.gatewayResponse?._cashfree_environment) {
      environment = payment.gatewayResponse._cashfree_environment;
    } else {
      const appId = process.env.CASHFREE_APP_ID || '';
      const secretKey = process.env.CASHFREE_SECRET_KEY || '';
      const hasCredentials = appId.length > 0 && secretKey.length > 0;
      const hasTestMarkers = appId.includes('TEST') || secretKey.includes('_test_') || secretKey.includes('test');
      environment = (!hasCredentials || hasTestMarkers) ? 'sandbox' : 'production';
    }

    logger.info({
      orderId,
      sessionIdLength: paymentSessionId.length,
      environment,
      amount: payment.amount,
    }, 'Rendering Cashfree SDK checkout page');

    // CRITICAL: Remove restrictive CSP headers for mobile WebView
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('X-Content-Type-Options');

    // Set proper headers for WebView compatibility
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Use Cashfree JS SDK to open checkout (per Cashfree support)
    res.send(renderCashfreeSDKPage({
      orderId,
      paymentSessionId,
      environment,
      amount: payment.amount,
    }));

  } catch (error) {
    logger.error({ error }, 'Error in payment initiation');
    res.status(500).send(renderErrorPage(
      'Server Error',
      'An unexpected error occurred. Please try again later.'
    ));
  }
});

/**
 * Render Cashfree JS SDK checkout page
 * Mobile-optimized: Auto-executes SDK immediately, proper meta tags
 */
function renderCashfreeSDKPage(options: {
  orderId: string;
  paymentSessionId: string;
  environment: 'sandbox' | 'production';
  amount: number;
}): string {
  const { paymentSessionId, environment, amount } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no">
  <title>Payment - Bestie</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px 30px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
      width: 100%;
    }
    h2 { 
      color: #333; 
      margin: 0 0 10px 0; 
      font-size: 24px;
      font-weight: 600;
    }
    .amount { 
      font-size: 32px; 
      color: #667eea; 
      font-weight: bold; 
      margin: 20px 0; 
    }
    .status { 
      color: #666; 
      margin: 15px 0; 
      font-size: 15px; 
      line-height: 1.5;
    }
    .loader {
      margin: 20px auto;
      width: 40px;
      height: 40px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .error { 
      color: #c62828; 
      font-size: 14px; 
      margin-top: 20px; 
      padding: 15px;
      background: #ffebee;
      border-radius: 8px;
      display: none;
    }
    .retry-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 30px;
      border-radius: 25px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 15px;
      display: none;
    }
    .retry-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Bestie Payment</h2>
    <div class="amount">₹${amount}</div>
    <p class="status" id="status">Opening payment gateway...</p>
    <div class="loader" id="loader"></div>
    <div class="error" id="error"></div>
    <button class="retry-btn" id="retryBtn">Retry Payment</button>
  </div>

  <!-- Load Cashfree SDK -->
  <script src="https://sdk.cashfree.com/js/v3/cashfree.js" async></script>
  
  <script>
    (function() {
      'use strict';
      
      const SESSION_ID = "${paymentSessionId}";
      const ENV = "${environment}";
      let attemptCount = 0;
      const MAX_ATTEMPTS = 3;
      
      const statusEl = document.getElementById('status');
      const errorEl = document.getElementById('error');
      const loaderEl = document.getElementById('loader');
      const retryBtn = document.getElementById('retryBtn');
      
      function showError(msg) {
        console.error('[Payment Error]', msg);
        if (statusEl) statusEl.textContent = 'Payment Error';
        if (errorEl) {
          errorEl.textContent = msg;
          errorEl.style.display = 'block';
        }
        if (loaderEl) loaderEl.style.display = 'none';
        if (retryBtn && attemptCount < MAX_ATTEMPTS) {
          retryBtn.style.display = 'block';
        }
      }
      
      function startPayment() {
        attemptCount++;
        console.log('[Payment] Starting payment, attempt:', attemptCount);
        
        if (statusEl) statusEl.textContent = 'Connecting to payment gateway...';
        if (errorEl) errorEl.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (loaderEl) loaderEl.style.display = 'block';
        
        try {
          if (typeof Cashfree === 'undefined') {
            throw new Error('Cashfree SDK not loaded. Please check your internet connection.');
          }
          
          console.log('[Payment] Initializing Cashfree SDK');
          console.log('[Payment] Environment:', ENV);
          console.log('[Payment] Session ID length:', SESSION_ID.length);
          
          const cashfree = Cashfree({ mode: ENV });
          
          console.log('[Payment] Opening checkout...');
          cashfree.checkout({
            paymentSessionId: SESSION_ID,
            redirectTarget: "_self"
          }).then(function(result) {
            console.log('[Payment] Checkout completed:', result);
          }).catch(function(error) {
            console.error('[Payment] Checkout error:', error);
            showError('Failed to open payment page: ' + (error.message || 'Unknown error'));
          });
          
        } catch (e) {
          console.error('[Payment] Exception:', e);
          showError(e.message || 'An unexpected error occurred');
        }
      }
      
      // Retry button handler
      if (retryBtn) {
        retryBtn.onclick = function() {
          if (attemptCount < MAX_ATTEMPTS) {
            startPayment();
          }
        };
      }
      
      // Auto-start when SDK loads
      function initWhenReady() {
        if (typeof Cashfree !== 'undefined') {
          console.log('[Payment] SDK loaded, starting payment');
          setTimeout(startPayment, 100); // Small delay for stability
        } else {
          console.log('[Payment] Waiting for SDK to load...');
          setTimeout(initWhenReady, 100);
        }
      }
      
      // Start initialization check
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenReady);
      } else {
        initWhenReady();
      }
      
      // Timeout fallback
      setTimeout(function() {
        if (loaderEl && loaderEl.style.display !== 'none') {
          showError('Payment gateway took too long to respond. Please try again.');
        }
      }, 15000); // 15 second timeout
      
    })();
  </script>
</body>
</html>
  `;
}

/**
 * Payment Success Page
 * Shown after successful payment, redirects to mobile app
 * Also triggers coin credit if not already done
 */
router.get('/success', async (req: Request, res: Response) => {
  const { orderId, order_id } = req.query;
  const finalOrderId = (orderId || order_id || '') as string;

  logger.info({ orderId: finalOrderId }, 'Payment success redirect');

  // Verify payment status and credit coins if needed
  let verifiedStatus = 'unknown';
  if (finalOrderId) {
    try {
      const payment = await Payment.findOne({
        $or: [{ orderId: finalOrderId }, { cashfreeOrderId: finalOrderId }]
      });
      if (payment) {
        verifiedStatus = payment.status;

        // If still pending, check with Cashfree and credit coins
        if (payment.status === PaymentStatus.PENDING) {
          try {
            const cfStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
            logger.info({
              orderId: payment.orderId,
              cashfreeOrderId: payment.cashfreeOrderId,
              cfStatus: cfStatus?.order_status
            }, 'Cashfree status check result on success page');

            if (cfStatus?.order_status === 'PAID') {
              // Credit coins
              await coinService.creditCoins(
                payment.userId.toString(),
                payment.coins,
                TransactionType.PURCHASE,
                { orderId: payment.orderId, description: `Coin purchase - Order ${payment.orderId}` }
              );
              payment.status = PaymentStatus.SUCCESS;
              await payment.save();
              verifiedStatus = PaymentStatus.SUCCESS;
              logger.info({ userId: payment.userId, orderId: payment.orderId, coins: payment.coins }, 'Coins credited via success page');
            }
          } catch (creditErr) {
            logger.warn({ creditErr, orderId: finalOrderId }, 'Could not credit coins on success page');
          }
        } else {
          // Even if not pending, verify Cashfree status to handle webhook failures
          try {
            const cfStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
            logger.info({
              orderId: payment.orderId,
              cashfreeOrderId: payment.cashfreeOrderId,
              currentStatus: payment.status,
              cfStatus: cfStatus?.order_status
            }, 'Cashfree status check for non-pending payment on success page');

            // If Cashfree shows PAID but our system doesn't have it as SUCCESS, credit coins
            if (cfStatus?.order_status === 'PAID' && payment.status !== PaymentStatus.SUCCESS) {
              logger.warn({
                orderId: payment.orderId,
                currentStatus: payment.status,
                cfStatus: cfStatus?.order_status
              }, 'Payment status mismatch on success page - Cashfree shows PAID but our system shows different status');

              try {
                await coinService.creditCoins(
                  payment.userId.toString(),
                  payment.coins,
                  TransactionType.PURCHASE,
                  { orderId: payment.orderId, description: `Coin purchase - Order ${payment.orderId}` }
                );
                payment.status = PaymentStatus.SUCCESS;
                await payment.save();
                verifiedStatus = PaymentStatus.SUCCESS;
                logger.info({ userId: payment.userId, orderId: payment.orderId, coins: payment.coins }, 'Coins credited for mismatched status on success page');
              } catch (creditError) {
                logger.error({ creditError, orderId: finalOrderId }, 'Failed to credit coins for mismatched status on success page');
              }
            }
          } catch (creditErr) {
            logger.warn({ creditErr, orderId: finalOrderId }, 'Could not check Cashfree status for non-pending payment on success page');
          }
        }
      }
    } catch (err) {
      logger.warn({ err, orderId: finalOrderId }, 'Could not verify payment status');
    }
  }

  const deepLink = `bestie://payment/success?orderId=${finalOrderId}&status=${verifiedStatus}`;

  res.send(renderSuccessPage(finalOrderId, deepLink));
});

/**
 * Payment Failure Page
 * Shown after failed payment, redirects to mobile app
 */
router.get('/failure', (req: Request, res: Response) => {
  const { orderId, order_id, error_code, error_description } = req.query;
  const finalOrderId = (orderId || order_id || '') as string;

  logger.info({
    orderId: finalOrderId,
    error_code,
    error_description
  }, 'Payment failure redirect');

  const deepLink = `bestie://payment/failure?orderId=${finalOrderId}&error=${error_code || 'unknown'}`;

  res.send(renderFailurePage(finalOrderId, deepLink, error_description as string));
});

/**
 * Payment Status API
 * Can be used by mobile app to poll for payment status
 */
router.get('/status/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const payment = await Payment.findOne({
      $or: [{ orderId }, { cashfreeOrderId: orderId }]
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    // If still pending, check with Cashfree
    if (payment.status === PaymentStatus.PENDING) {
      try {
        const cfStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
        logger.info({
          orderId: payment.orderId,
          cashfreeOrderId: payment.cashfreeOrderId,
          cfStatus: cfStatus?.order_status
        }, 'Cashfree status check result');

        if (cfStatus?.order_status === 'PAID') {
          // IMPORTANT: Actually credit the coins, not just update status!
          try {
            await coinService.creditCoins(
              payment.userId.toString(),
              payment.coins,
              TransactionType.PURCHASE,
              { orderId: payment.orderId, description: `Coin purchase - Order ${payment.orderId}` }
            );
            payment.status = PaymentStatus.SUCCESS;
            await payment.save();
            logger.info({
              userId: payment.userId,
              orderId: payment.orderId,
              coins: payment.coins
            }, 'Coins credited via status check');
          } catch (creditError) {
            logger.error({ creditError, orderId }, 'Failed to credit coins during status check');
            // Don't update status if coin credit failed
          }
        } else if (cfStatus?.order_status === 'EXPIRED') {
          payment.status = PaymentStatus.FAILED;
          payment.failureReason = 'Payment expired';
          await payment.save();
        }
      } catch (err) {
        logger.warn({ err, orderId }, 'Could not check Cashfree status');
      }
    } else {
      // Even if status is not PENDING, check Cashfree status to handle cases where
      // webhook didn't arrive but payment was successful
      try {
        const cfStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);
        logger.info({
          orderId: payment.orderId,
          cashfreeOrderId: payment.cashfreeOrderId,
          currentStatus: payment.status,
          cfStatus: cfStatus?.order_status
        }, 'Cashfree status check for non-pending payment');

        // If Cashfree shows PAID but our system doesn't have it as SUCCESS, credit coins
        if (cfStatus?.order_status === 'PAID' && payment.status !== PaymentStatus.SUCCESS) {
          logger.warn({
            orderId: payment.orderId,
            currentStatus: payment.status,
            cfStatus: cfStatus?.order_status
          }, 'Payment status mismatch - Cashfree shows PAID but our system shows different status');

          try {
            await coinService.creditCoins(
              payment.userId.toString(),
              payment.coins,
              TransactionType.PURCHASE,
              { orderId: payment.orderId, description: `Coin purchase - Order ${payment.orderId}` }
            );
            payment.status = PaymentStatus.SUCCESS;
            await payment.save();
            logger.info({
              userId: payment.userId,
              orderId: payment.orderId,
              coins: payment.coins
            }, 'Coins credited for mismatched status');
          } catch (creditError) {
            logger.error({ creditError, orderId }, 'Failed to credit coins for mismatched status');
          }
        }
      } catch (err) {
        logger.warn({ err, orderId }, 'Could not check Cashfree status for non-pending payment');
      }
    }

    res.json({
      success: true,
      data: {
        orderId: payment.orderId,
        status: payment.status,
        amount: payment.amount,
        coins: payment.coins,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error checking payment status');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// HTML RENDERING HELPERS
// ============================================

function renderPaymentPage(options: {
  orderId: string;
  paymentSessionId: string;
  environment: 'sandbox' | 'production';
  amount: number;
  planName: string;
}): string {
  const { orderId, paymentSessionId, environment, amount, planName } = options;

  // Direct Cashfree hosted checkout URL - most reliable approach
  const cashfreeBaseUrl = environment === 'production'
    ? 'https://payments.cashfree.com/order'
    : 'https://payments-test.cashfree.com/order';
  const checkoutUrl = `${cashfreeBaseUrl}/#${paymentSessionId}`;

  // Server URL for deep link
  const serverUrl = process.env.SERVER_URL || 'https://bestie-backend-prod.onrender.com';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Complete Payment - Bestie</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .container {
          text-align: center;
          padding: 2rem;
          max-width: 400px;
        }
        .icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        h1 {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .amount {
          font-size: 2.5rem;
          font-weight: bold;
          margin: 1rem 0;
        }
        .plan-name {
          opacity: 0.9;
          margin-bottom: 2rem;
        }
        .pay-btn {
          display: inline-block;
          padding: 1rem 3rem;
          background: white;
          color: #667eea;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-size: 1.2rem;
          font-weight: 600;
          text-decoration: none;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .pay-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        }
        .secure-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 2rem;
          font-size: 0.85rem;
          opacity: 0.8;
        }
        .secure-badge svg {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }
        .status {
          margin-top: 1.5rem;
          font-size: 0.9rem;
        }
        .spinner {
          width: 24px;
          height: 24px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          display: inline-block;
          margin-right: 8px;
          vertical-align: middle;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .hidden { display: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">🔒</div>
        <h1>Secure Payment</h1>
        <div class="amount">₹${amount}</div>
        <div class="plan-name">${planName}</div>
        
        <a href="${checkoutUrl}" class="pay-btn" id="payBtn">Pay Now</a>
        
        <div class="status" id="status"></div>
        
        <div class="secure-badge">
          <svg viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
          </svg>
          Secured by Cashfree Payments
        </div>
      </div>
      
      <script>
        // Show loading state when clicking pay
        document.getElementById('payBtn').addEventListener('click', function(e) {
          document.getElementById('status').innerHTML = '<span class="spinner"></span> Redirecting to Cashfree...';
          this.classList.add('hidden');
        });
        
        // Auto-redirect after 2 seconds
        setTimeout(function() {
          var btn = document.getElementById('payBtn');
          if (btn && !btn.classList.contains('hidden')) {
            document.getElementById('status').innerHTML = '<span class="spinner"></span> Redirecting to Cashfree...';
            btn.classList.add('hidden');
            window.location.href = '${checkoutUrl}';
          }
        }, 2000);
      </script>
    </body>
    </html>
  `;
}

function renderSuccessPage(orderId: string, deepLink: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful - Bestie</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .container {
          text-align: center;
          padding: 2rem;
          max-width: 400px;
        }
        .icon {
          width: 80px;
          height: 80px;
          background: rgba(255,255,255,0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          font-size: 2.5rem;
        }
        h1 {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .order-id {
          font-size: 0.85rem;
          opacity: 0.8;
          margin-bottom: 1rem;
        }
        .message {
          margin-bottom: 1.5rem;
          opacity: 0.9;
        }
        .button {
          display: inline-block;
          padding: 0.875rem 2rem;
          background: white;
          color: #667eea;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        .button:hover {
          transform: scale(1.05);
        }
        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          display: inline-block;
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .redirect-msg {
          margin-top: 1.5rem;
          font-size: 0.85rem;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>Payment Successful!</h1>
        <p class="order-id">Order: ${orderId}</p>
        <p class="message">Your coins have been added to your account.</p>
        <a href="${deepLink}" class="button">Open Bestie App</a>
        <p class="redirect-msg">
          <span class="spinner"></span>
          Redirecting to app...
        </p>
      </div>
      <script>
        // Attempt redirect after a short delay
        setTimeout(function() {
          window.location.href = '${deepLink}';
        }, 1500);
        
        // Fallback: try again after 3 seconds
        setTimeout(function() {
          window.location.href = '${deepLink}';
        }, 3500);
      </script>
    </body>
    </html>
  `;
}

function renderFailurePage(orderId: string, deepLink: string, errorDesc?: string): string {
  const errorMessage = errorDesc || 'Your payment could not be completed.';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Failed - Bestie</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
        }
        .container {
          text-align: center;
          padding: 2rem;
          max-width: 400px;
        }
        .icon {
          width: 80px;
          height: 80px;
          background: rgba(255,255,255,0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          font-size: 2.5rem;
        }
        h1 {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .order-id {
          font-size: 0.85rem;
          opacity: 0.8;
          margin-bottom: 1rem;
        }
        .message {
          margin-bottom: 1.5rem;
          opacity: 0.9;
        }
        .button {
          display: inline-block;
          padding: 0.875rem 2rem;
          background: white;
          color: #f5576c;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        .button:hover {
          transform: scale(1.05);
        }
        .redirect-msg {
          margin-top: 1.5rem;
          font-size: 0.85rem;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">❌</div>
        <h1>Payment Failed</h1>
        <p class="order-id">Order: ${orderId}</p>
        <p class="message">${errorMessage}</p>
        <a href="${deepLink}" class="button">Back to App</a>
        <p class="redirect-msg">Redirecting to app...</p>
      </div>
      <script>
        setTimeout(function() {
          window.location.href = '${deepLink}';
        }, 2000);
      </script>
    </body>
    </html>
  `;
}

function renderErrorPage(title: string, message: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Bestie</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: #f5f5f5;
          color: #333;
        }
        .container {
          text-align: center;
          padding: 2rem;
          max-width: 400px;
        }
        .icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        h1 {
          font-size: 1.5rem;
          margin-bottom: 1rem;
          color: #333;
        }
        .message {
          color: #666;
          margin-bottom: 1.5rem;
          line-height: 1.5;
        }
        .button {
          display: inline-block;
          padding: 0.875rem 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⚠️</div>
        <h1>${title}</h1>
        <p class="message">${message}</p>
        <a href="bestie://home" class="button">Back to App</a>
      </div>
    </body>
    </html>
  `;
}

export default router;
