import { Router, Request, Response } from 'express';
import { Payment, PaymentStatus } from '../models/Payment';
import { logger } from '../lib/logger';
import { cashfreeService } from '../lib/cashfree';

const router = Router();

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
    const paymentSessionId = payment.gatewayResponse?.payment_session_id;

    if (!paymentSessionId) {
      logger.error({ orderId, gatewayResponse: payment.gatewayResponse }, 'Payment session ID not found');
      
      // Try to refresh the order status from Cashfree
      try {
        const orderStatus = await cashfreeService.getPaymentStatus(orderId);
        if (orderStatus?.payment_session_id) {
          // Update the payment record with the session ID
          payment.gatewayResponse = { ...payment.gatewayResponse, ...orderStatus };
          await payment.save();
          
          // Redirect to self to use the new session ID
          return res.redirect(`/payment/initiate?orderId=${orderId}`);
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to refresh payment session');
      }
      
      return res.status(500).send(renderErrorPage(
        'Payment Session Expired',
        'Your payment session has expired or is invalid. Please go back to the app and try again.'
      ));
    }

    // Determine environment (sandbox vs production)
    const appId = process.env.CASHFREE_APP_ID || '';
    const secretKey = process.env.CASHFREE_SECRET_KEY || '';
    const isTestMode = appId.includes('TEST') || secretKey.includes('_test_') || secretKey.includes('test');
    const environment = isTestMode ? 'sandbox' : 'production';

    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment,
      amount: payment.amount,
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
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Complete Payment - Bestie</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          min-height: 100vh;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1.5rem;
          text-align: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header h1 {
          font-size: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .header .order-info {
          font-size: 0.85rem;
          opacity: 0.9;
        }
        .header .amount {
          font-size: 1.5rem;
          font-weight: bold;
          margin-top: 0.5rem;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 1rem;
        }
        #payment-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          min-height: 300px;
          margin-top: 1rem;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        .loading {
          text-align: center;
        }
        .spinner {
          width: 48px;
          height: 48px;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 1rem;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .pay-btn {
          display: inline-block;
          padding: 1rem 3rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-size: 1.1rem;
          font-weight: 600;
          text-decoration: none;
          margin-top: 1rem;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .pay-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .pay-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .error-box {
          background: #fee;
          border: 1px solid #fcc;
          color: #c33;
          padding: 1.5rem;
          margin: 1rem;
          border-radius: 8px;
          text-align: center;
        }
        .error-box h3 { margin-bottom: 0.5rem; }
        .retry-btn {
          display: inline-block;
          margin-top: 1rem;
          padding: 0.75rem 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 1rem;
          text-decoration: none;
        }
        .retry-btn:hover { opacity: 0.9; }
        .secure-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 1rem;
          color: #666;
          font-size: 0.85rem;
        }
        .secure-badge svg {
          width: 16px;
          height: 16px;
        }
        .payment-info {
          text-align: center;
          color: #666;
          margin-bottom: 1rem;
        }
        .payment-info p {
          margin: 0.5rem 0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🔒 Secure Payment</h1>
        <div class="amount">₹${amount}</div>
        <div class="order-info">${planName}</div>
      </div>

      <div class="container">
        <div id="payment-container">
          <div class="loading" id="loading-state">
            <div class="spinner"></div>
            <p>Preparing payment...</p>
          </div>
          <div id="payment-ready" style="display: none; text-align: center;">
            <div class="payment-info">
              <p>You are about to pay</p>
              <p style="font-size: 2rem; font-weight: bold; color: #333;">₹${amount}</p>
              <p>for ${planName}</p>
            </div>
            <button class="pay-btn" id="pay-button" onclick="startPayment()">
              Pay ₹${amount}
            </button>
          </div>
        </div>
        
        <div class="secure-badge">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
          </svg>
          Secured by Cashfree Payments
        </div>
      </div>

      <script>
        const SESSION_ID = "${paymentSessionId}";
        const ORDER_ID = "${orderId}";
        const MODE = "${environment}";
        let cashfreeInstance = null;
        
        console.log('[Payment] Page loaded, Mode:', MODE);
        
        function showError(title, message) {
          document.getElementById('payment-container').innerHTML = 
            '<div class="error-box">' +
            '<h3>' + title + '</h3>' +
            '<p>' + message + '</p>' +
            '<button class="retry-btn" onclick="location.reload()">Retry</button>' +
            '</div>';
        }
        
        function showPayButton() {
          document.getElementById('loading-state').style.display = 'none';
          document.getElementById('payment-ready').style.display = 'block';
        }
        
        function startPayment() {
          const btn = document.getElementById('pay-button');
          btn.disabled = true;
          btn.textContent = 'Processing...';
          
          try {
            if (!cashfreeInstance) {
              cashfreeInstance = Cashfree({ mode: MODE });
            }
            
            // Use checkout() for redirect-based payment (more reliable)
            cashfreeInstance.checkout({
              paymentSessionId: SESSION_ID,
              redirectTarget: "_self"
            }).then(function(result) {
              console.log('[Payment] Checkout result:', result);
              if (result.error) {
                showError('Payment Failed', result.error.message || 'Payment was not completed.');
              }
              if (result.paymentDetails) {
                console.log('[Payment] Payment completed:', result.paymentDetails);
              }
            }).catch(function(error) {
              console.error('[Payment] Checkout error:', error);
              showError('Payment Error', error?.message || 'Something went wrong. Please try again.');
            });
          } catch (error) {
            console.error('[Payment] Exception:', error);
            showError('Payment Error', 'Unable to process payment. Please try again.');
          }
        }
        
        function initPayment() {
          try {
            if (typeof Cashfree === 'undefined') {
              console.error('[Payment] Cashfree SDK not loaded');
              showError('Loading Error', 'Payment system failed to load. Please check your internet connection and refresh.');
              return;
            }
            
            console.log('[Payment] Cashfree SDK loaded successfully');
            cashfreeInstance = Cashfree({ mode: MODE });
            
            // Show the pay button
            showPayButton();
              
          } catch (error) {
            console.error('[Payment] Init error:', error);
            showError('Initialization Error', 'Unable to initialize payment. Please refresh and try again.');
          }
        }
        
        // Initialize after SDK loads
        if (document.readyState === 'complete') {
          setTimeout(initPayment, 500);
        } else {
          window.addEventListener('load', function() {
            setTimeout(initPayment, 500);
          });
        }
        
        // Fallback: retry after 3 seconds if still loading
        setTimeout(function() {
          var loadingEl = document.getElementById('loading-state');
          if (loadingEl && loadingEl.style.display !== 'none') {
            console.log('[Payment] Fallback initialization...');
            initPayment();
          }
        }, 3000);
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
