import { Router, Request, Response } from 'express';
import { Payment, PaymentStatus } from '../models/Payment';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Payment Initiation Page
 * Renders the Cashfree payment checkout
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
        'Payment order was not found. It may have expired.'
      ));
    }

    // Check if payment is already completed
    if (payment.status === PaymentStatus.SUCCESS) {
      return res.redirect(`/payment/success?orderId=${orderId}`);
    }

    // Get the payment session ID from gateway response
    const paymentSessionId = payment.gatewayResponse?.payment_session_id;

    if (!paymentSessionId) {
      logger.error({ orderId, gatewayResponse: payment.gatewayResponse }, 'Payment session ID not found');
      return res.status(500).send(renderErrorPage(
        'Payment Session Error',
        'Unable to load payment session. Please try again from the app.'
      ));
    }

    // Detect environment based on credentials
    const appId = process.env.CASHFREE_APP_ID || '';
    const isProduction = !appId.includes('TEST') && process.env.NODE_ENV === 'production';
    const environment = isProduction ? 'production' : 'sandbox';

    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment,
      amount: payment.amount,
    }, 'Serving payment page');

    res.send(renderPaymentPage({
      orderId,
      paymentSessionId,
      environment,
      amount: payment.amount,
    }));

  } catch (error) {
    logger.error({ error }, 'Error in payment initiation');
    res.status(500).send(renderErrorPage('Server Error', 'An unexpected error occurred.'));
  }
});

/**
 * Payment Success Page
 */
router.get('/success', (req: Request, res: Response) => {
  try {
    const { orderId, order_id } = req.query;
    const finalOrderId = (orderId || order_id || '') as string;

    logger.info({ orderId: finalOrderId }, 'Payment redirect - success');

    const deepLink = `bestie://payment/success?orderId=${finalOrderId}`;

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container { text-align: center; padding: 2rem; max-width: 400px; }
            .icon { font-size: 4rem; margin-bottom: 1rem; }
            h1 { margin: 0 0 1rem 0; font-size: 1.5rem; }
            p { margin: 0.5rem 0; opacity: 0.9; }
            .button {
              display: inline-block;
              margin-top: 1.5rem;
              padding: 0.75rem 2rem;
              background: white;
              color: #667eea;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✅</div>
            <h1>Payment Successful!</h1>
            <p>Your coins have been added to your account.</p>
            <p>Redirecting to app...</p>
            <a href="${deepLink}" class="button">Open Bestie App</a>
          </div>
          <script>
            setTimeout(() => { window.location.href = '${deepLink}'; }, 1500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment success redirect');
    res.status(500).send('Error processing payment redirect');
  }
});

/**
 * Payment Failure Page
 */
router.get('/failure', (req: Request, res: Response) => {
  try {
    const { orderId, order_id } = req.query;
    const finalOrderId = (orderId || order_id || '') as string;

    logger.info({ orderId: finalOrderId }, 'Payment redirect - failure');

    const deepLink = `bestie://payment/failure?orderId=${finalOrderId}`;

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
            }
            .container { text-align: center; padding: 2rem; max-width: 400px; }
            .icon { font-size: 4rem; margin-bottom: 1rem; }
            h1 { margin: 0 0 1rem 0; font-size: 1.5rem; }
            p { margin: 0.5rem 0; opacity: 0.9; }
            .button {
              display: inline-block;
              margin-top: 1.5rem;
              padding: 0.75rem 2rem;
              background: white;
              color: #f5576c;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">❌</div>
            <h1>Payment Failed</h1>
            <p>Your payment could not be processed.</p>
            <p>Redirecting to app...</p>
            <a href="${deepLink}" class="button">Open Bestie App</a>
          </div>
          <script>
            setTimeout(() => { window.location.href = '${deepLink}'; }, 1500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment failure redirect');
    res.status(500).send('Error processing payment redirect');
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
}): string {
  const { orderId, paymentSessionId, environment, amount } = options;

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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .container { text-align: center; padding: 2rem; max-width: 400px; }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .amount { font-size: 2.5rem; font-weight: bold; margin: 1rem 0; }
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
          margin-top: 1rem;
        }
        .pay-btn:disabled { opacity: 0.7; cursor: not-allowed; }
        .status { margin-top: 1rem; font-size: 0.9rem; }
        .secure-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 2rem;
          font-size: 0.85rem;
          opacity: 0.8;
        }
        .error { background: rgba(255,0,0,0.2); padding: 1rem; border-radius: 8px; margin-top: 1rem; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">🔒</div>
        <h1>Secure Payment</h1>
        <div class="amount">₹${amount}</div>
        
        <button class="pay-btn" id="pay-btn" onclick="startPayment()">
          Pay ₹${amount}
        </button>
        
        <div class="status" id="status">Click to proceed with payment</div>
        
        <div class="secure-badge">
          🔐 Secured by Cashfree Payments
        </div>
      </div>
      
      <script>
        const SESSION_ID = "${paymentSessionId}";
        const MODE = "${environment}";
        
        function setStatus(msg) {
          document.getElementById('status').textContent = msg;
        }
        
        function showError(msg) {
          document.getElementById('status').innerHTML = '<div class="error">' + msg + '</div>';
          document.getElementById('pay-btn').disabled = false;
          document.getElementById('pay-btn').textContent = 'Retry Payment';
        }
        
        function startPayment() {
          var btn = document.getElementById('pay-btn');
          btn.disabled = true;
          btn.textContent = 'Processing...';
          setStatus('Opening payment gateway...');
          
          if (typeof Cashfree === 'undefined') {
            showError('Payment system failed to load. Please refresh the page.');
            return;
          }
          
          try {
            var cashfree = Cashfree({ mode: MODE });
            cashfree.checkout({
              paymentSessionId: SESSION_ID,
              redirectTarget: "_self"
            }).catch(function(err) {
              console.error('Checkout error:', err);
              showError('Payment failed: ' + (err.message || 'Unknown error'));
            });
          } catch(e) {
            console.error('Exception:', e);
            showError('Unable to process payment. Please try again.');
          }
        }
        
        // Check if SDK loaded
        setTimeout(function() {
          if (typeof Cashfree === 'undefined') {
            setStatus('Loading payment system...');
          }
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
      <title>Error - Bestie</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
        }
        .container { text-align: center; padding: 2rem; max-width: 400px; }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { margin: 0 0 1rem 0; font-size: 1.5rem; }
        p { margin: 0.5rem 0; opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⚠️</div>
        <h1>${title}</h1>
        <p>${message}</p>
      </div>
    </body>
    </html>
  `;
}

export default router;
