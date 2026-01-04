import { Router, Request, Response } from 'express';
import { Payment, PaymentStatus } from '../models/Payment';
import { User } from '../models/User';
import { CoinPlan } from '../models/CoinPlan';
import { logger } from '../lib/logger';
import { cashfreeService } from '../lib/cashfree';

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
        ? 'https://bestie-backend-zmj2.onrender.com' 
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
      returnUrl: `${serverUrl}/payment/success?orderId=${payment.orderId}`,
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
 * Payment Initiation Page
 * Renders the Cashfree Drop component for payment
 * 
 * This page is shown after order creation and handles:
 * - Loading the payment session from database
 * - Rendering the Cashfree Drop JS SDK
 * - Handling payment completion redirects
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
      return res.redirect(`/payment/success?orderId=${orderId}`);
    }

    // Get the payment session ID from gateway response
    let paymentSessionId = payment.gatewayResponse?.payment_session_id;

    // If no session ID, try to refresh or recreate
    if (!paymentSessionId) {
      logger.warn({ orderId, gatewayResponse: payment.gatewayResponse }, 'Payment session ID not found - attempting to recover');
      
      // Try to get fresh session from Cashfree
      try {
        const orderStatus = await cashfreeService.getPaymentStatus(orderId);
        if (orderStatus?.payment_session_id) {
          payment.gatewayResponse = { ...payment.gatewayResponse, ...orderStatus };
          await payment.save();
          paymentSessionId = orderStatus.payment_session_id;
          logger.info({ orderId }, 'Recovered payment session from Cashfree');
        } else if (orderStatus?.order_status === 'EXPIRED' || orderStatus?.order_status === 'TERMINATED') {
          // Order expired, need to create a new one
          logger.info({ orderId, status: orderStatus.order_status }, 'Order expired - creating new order');
          const newSessionId = await recreatePaymentSession(payment);
          if (newSessionId) {
            paymentSessionId = newSessionId;
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message, orderId }, 'Failed to refresh payment session from Cashfree');
        
        // If Cashfree lookup failed, try to create a new order
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

    // Final check - if still no session, show error
    if (!paymentSessionId) {
      logger.error({ orderId }, 'Unable to obtain valid payment session');
      return res.status(500).send(renderErrorPage(
        'Payment Session Expired',
        'Your payment session has expired or is invalid. Please go back to the app and try again.'
      ));
    }

    // Determine environment - prefer stored environment from order creation
    // This ensures we redirect to the same environment where the session was created
    let environment: 'sandbox' | 'production' = 'sandbox';
    
    // First, check if environment was stored with the order
    if (payment.gatewayResponse?._cashfree_environment) {
      environment = payment.gatewayResponse._cashfree_environment;
      logger.info({ orderId, storedEnvironment: environment }, 'Using stored environment from order');
    } else {
      // Fallback: detect from current credentials
      const appId = process.env.CASHFREE_APP_ID || '';
      const secretKey = process.env.CASHFREE_SECRET_KEY || '';
      
      // If credentials are empty or contain TEST/test markers, use sandbox
      // Only use production if we have non-test credentials
      const hasCredentials = appId.length > 0 && secretKey.length > 0;
      const hasTestMarkers = appId.includes('TEST') || secretKey.includes('_test_') || secretKey.includes('test');
      
      if (!hasCredentials || hasTestMarkers) {
        environment = 'sandbox';
      } else {
        environment = 'production';
      }
      
      logger.info({ 
        orderId, 
        detectedEnvironment: environment, 
        hasCredentials,
        hasTestMarkers,
        appIdPrefix: appId.substring(0, 15) || '(empty)' 
      }, 'Detected environment from credentials (fallback)');
    }

    // Build the checkout URL here for logging
    const cashfreeBaseUrl = environment === 'production' 
      ? 'https://payments.cashfree.com/order' 
      : 'https://payments-test.cashfree.com/order';
    const checkoutUrl = `${cashfreeBaseUrl}/#${paymentSessionId}`;
    
    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 30) + '...',
      fullSessionIdLength: paymentSessionId.length,
      environment,
      amount: payment.amount,
      checkoutUrl: checkoutUrl.substring(0, 80) + '...',
    }, 'Serving payment page');

    // Render the payment page with Cashfree Drop component
    res.send(renderPaymentPage({
      orderId,
      paymentSessionId,
      environment,
      amount: payment.amount,
      planName: (payment as any).planId?.name || 'Coin Pack',
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
 * Payment Success Page
 * Shown after successful payment, redirects to mobile app
 */
router.get('/success', async (req: Request, res: Response) => {
  const { orderId, order_id } = req.query;
  const finalOrderId = (orderId || order_id || '') as string;
  
  logger.info({ orderId: finalOrderId }, 'Payment success redirect');

  // Verify payment status if we have an order ID
  let verifiedStatus = 'unknown';
  if (finalOrderId) {
    try {
      const payment = await Payment.findOne({ 
        $or: [{ orderId: finalOrderId }, { cashfreeOrderId: finalOrderId }]
      });
      if (payment) {
        verifiedStatus = payment.status;
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
        if (cfStatus?.order_status === 'PAID') {
          payment.status = PaymentStatus.SUCCESS;
          await payment.save();
        } else if (cfStatus?.order_status === 'EXPIRED') {
          payment.status = PaymentStatus.FAILED;
          payment.failureReason = 'Payment expired';
          await payment.save();
        }
      } catch (err) {
        logger.warn({ err, orderId }, 'Could not check Cashfree status');
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
  
  // Cashfree hosted checkout URL - works without SDK
  const cashfreeBaseUrl = environment === 'production' 
    ? 'https://payments.cashfree.com/order' 
    : 'https://payments-test.cashfree.com/order';
  const checkoutUrl = `${cashfreeBaseUrl}/#${paymentSessionId}`;
  
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
        .loading {
          display: none;
        }
        .loading.active {
          display: block;
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
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">🔒</div>
        <h1>Secure Payment</h1>
        <div class="amount">₹${amount}</div>
        <div class="plan-name">${planName}</div>
        
        <a href="${checkoutUrl}" class="pay-btn" id="pay-btn" onclick="showLoading()">
          Pay Now
        </a>
        
        <div class="loading" id="loading">
          <span class="spinner"></span> Redirecting to payment...
        </div>
        
        <div class="secure-badge">
          <svg viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
          </svg>
          Secured by Cashfree Payments
        </div>
      </div>
      
      <script>
        function showLoading() {
          document.getElementById('pay-btn').style.display = 'none';
          document.getElementById('loading').classList.add('active');
        }
        
        // Auto-redirect after 1 second for better UX
        setTimeout(function() {
          window.location.href = '${checkoutUrl}';
        }, 1000);
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
