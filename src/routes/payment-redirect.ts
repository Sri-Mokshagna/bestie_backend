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

    // Create a mobile-friendly payment page
    // Use iframe embedding for better mobile compatibility
    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment: isTestMode ? 'sandbox' : 'production'
    }, 'Serving payment page');

    // Construct the Cashfree checkout URL that can be used in iframe
    const cashfreeCheckoutUrl = `${baseUrl}/checkout?payment_session_id=${paymentSessionId}`;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Complete Payment</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f5f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .header {
            background: white;
            padding: 1rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
          }
          .header h1 {
            font-size: 1.2rem;
            color: #333;
            margin-bottom: 0.5rem;
          }
          .header p {
            font-size: 0.85rem;
            color: #666;
          }
          .iframe-container {
            flex: 1;
            position: relative;
            overflow: hidden;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
          .alt-action {
            padding: 1rem;
            background: white;
            text-align: center;
            border-top: 1px solid #e0e0e0;
          }
          .button {
            display: inline-block;
            padding: 0.75rem 2rem;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            font-size: 1rem;
          }
          .button:active {
            opacity: 0.8;
          }
          .order-id {
            margin-top: 0.5rem;
            font-size: 0.75rem;
            color: #999;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🔒 Secure Payment</h1>
          <p>Please complete your payment below</p>
          <div class="order-id">Order ID: ${orderId}</div>
        </div>

        <div class="iframe-container" id="paymentFrame">
          <iframe
            id="cashfreeFrame"
            src="${cashfreeCheckoutUrl}"
            allow="payment"
            sandbox="allow-same-origin allow-scripts allow-forms allow-top-navigation allow-popups"
            loading="eager">
          </iframe>
        </div>

        <div class="alt-action">
          <p style="font-size: 0.85rem; color: #666; margin-bottom: 0.75rem;">
            Having trouble? Try opening in browser
          </p>
          <a href="${cashfreeCheckoutUrl}" class="button" target="_blank" rel="noopener">
            Open in Browser
          </a>
        </div>

        <script>
          // Handle iframe load errors
          const iframe = document.getElementById('cashfreeFrame');
          const timeout = setTimeout(function() {
            // If iframe hasn't loaded after 10 seconds, suggest browser
            console.warn('Iframe loading timeout');
          }, 10000);

          iframe.onload = function() {
            clearTimeout(timeout);
            console.log('Payment frame loaded successfully');
          };

          iframe.onerror = function() {
            clearTimeout(timeout);
            console.error('Failed to load payment frame');
            alert('Please click "Open in Browser" button below to complete payment');
          };
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
