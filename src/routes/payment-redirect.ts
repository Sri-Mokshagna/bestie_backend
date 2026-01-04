import { Router, Request, Response } from 'express';
import { cashfreeService } from '../lib/cashfree';
import { Payment } from '../models/Payment';
import { logger } from '../lib/logger';

const router = Router();

router.get('/initiate', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.query;

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).send('Order ID is required');
    }

    logger.info({ orderId }, 'Payment initiation request');

    // Get the payment details from the database
    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      logger.error({ orderId }, 'Payment not found for initiation');
      return res.status(404).send('Payment order not found');
    }

    // Check if we have the payment session ID from the gateway response
    const paymentSessionId = payment.gatewayResponse?.payment_session_id;

    if (!paymentSessionId) {
      logger.error({ orderId, gatewayResponse: payment.gatewayResponse }, 'Payment session ID not found in gateway response');
      return res.status(500).send('Payment session not initialized properly');
    }

    // Determine the environment
    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;

    // Check if credentials indicate test mode
    const isTestMode = appId?.includes('TEST') ||
      secretKey?.includes('_test_') ||
      secretKey?.includes('test');

    const baseUrl = isTestMode
      ? 'https://sandbox.cashfree.com/pg'
      : 'https://api.cashfree.com/pg';

    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment: isTestMode ? 'sandbox' : 'production'
    }, 'Redirecting to Cashfree payment page');

    // Get the Cashfree order details to check status
    try {
      const cashfreeStatus = await cashfreeService.getPaymentStatus(orderId);

      // If payment is already processed, redirect to appropriate page
      if (cashfreeStatus.order_status && cashfreeStatus.order_status !== 'ACTIVE') {
        const redirectUrl = cashfreeStatus.order_status === 'PAID'
          ? `/payment/success?orderId=${orderId}`
          : `/payment/failure?orderId=${orderId}`;
        return res.redirect(redirectUrl);
      }
    } catch (error) {
      logger.warn({ orderId, error }, 'Could not check payment status, proceeding with payment initiation');
    }

    // Send HTML page that uses Cashfree's Drop-in checkout
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Processing Payment...</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 2rem;
            max-width: 400px;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
            margin: 0 auto 1rem;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          h1 {
            margin: 0 0 1rem 0;
            font-size: 1.5rem;
          }
          p {
            margin: 0.5rem 0;
            opacity: 0.9;
          }
          .error {
            background: rgba(255, 0, 0, 0.2);
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h1>Redirecting to Payment Gateway</h1>
          <p>Setting up your secure payment...</p>
          <p>Order ID: ${orderId}</p>
          <div id="error-message" class="error" style="display: none;"></div>
        </div>
        <script>
          const cashfree = Cashfree({
            mode: "${isTestMode ? 'sandbox' : 'production'}"
          });

          const paymentSessionId = "${paymentSessionId}";
          const orderId = "${orderId}";

          // Initialize checkout
          cashfree.checkout({
            paymentSessionId: paymentSessionId,
            redirectTarget: "_self"
          }).then(function(result) {
            if (result.error) {
              console.error('Payment initialization error:', result.error);
              document.getElementById('error-message').style.display = 'block';
              document.getElementById('error-message').textContent = 'Error: ' + result.error.message;
              document.querySelector('.spinner').style.display = 'none';
            }
            if (result.redirect) {
              console.log('Payment will be redirected');
            }
          }).catch(function(error) {
            console.error('Cashfree checkout error:', error);
            document.getElementById('error-message').style.display = 'block';
            document.getElementById('error-message').textContent = 'Failed to initialize payment. Please try again.';
            document.querySelector('.spinner').style.display = 'none';
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment initiation');
    res.status(500).send('Error processing payment initiation');
  }
});

/**
 * Payment redirect handler
 * This endpoint receives the redirect from Cashfree and redirects to the mobile app deep link
 */
router.get('/success', (req: Request, res: Response) => {
  try {
    const { orderId } = req.query;

    logger.info({ orderId }, 'Payment redirect - success');

    // Redirect to mobile app deep link
    const deepLink = `bestie://payment/success?orderId=${orderId || ''}`;

    // Send HTML that redirects to deep link and shows a fallback message
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
              margin: 0 0 1rem 0;
              font-size: 1.5rem;
            }
            p {
              margin: 0.5rem 0;
              opacity: 0.9;
            }
            .button {
              display: inline-block;
              margin-top: 1.5rem;
              padding: 0.75rem 2rem;
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
            .footer {
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              padding: 1rem;
              text-align: center;
              font-size: 0.75rem;
              opacity: 0.8;
              background: rgba(0, 0, 0, 0.1);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✅</div>
            <h1>Payment Successful!</h1>
            <p>Your payment has been processed successfully.</p>
            <p>Redirecting to app...</p>
            <a href="${deepLink}" class="button">Open Bestie App</a>
          </div>
          <div class="footer">
            &copy; 2025 Varshith Vegetables and Fruits Private Limited. All rights reserved.
          </div>
          <script>
            // Attempt automatic redirect
            setTimeout(() => {
              window.location.href = '${deepLink}';
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment success redirect');
    res.status(500).send('Error processing payment redirect');
  }
});

router.get('/failure', (req: Request, res: Response) => {
  try {
    const { orderId } = req.query;

    logger.info({ orderId }, 'Payment redirect - failure');

    // Redirect to mobile app deep link
    const deepLink = `bestie://payment/failure?orderId=${orderId || ''}`;

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
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
              margin: 0 0 1rem 0;
              font-size: 1.5rem;
            }
            p {
              margin: 0.5rem 0;
              opacity: 0.9;
            }
            .button {
              display: inline-block;
              margin-top: 1.5rem;
              padding: 0.75rem 2rem;
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
            .footer {
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              padding: 1rem;
              text-align: center;
              font-size: 0.75rem;
              opacity: 0.8;
              background: rgba(0, 0, 0, 0.1);
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
          <div class="footer">
            &copy; 2025 Varshith Vegetables and Fruits Private Limited. All rights reserved.
          </div>
          <script>
            // Attempt automatic redirect
            setTimeout(() => {
              window.location.href = '${deepLink}';
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment failure redirect');
    res.status(500).send('Error processing payment redirect');
  }
});

export default router;
