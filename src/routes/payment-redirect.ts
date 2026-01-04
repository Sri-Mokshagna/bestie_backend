import { Router, Request, Response } from 'express';
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

    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      logger.error({ orderId }, 'Payment not found');
      return res.status(404).send('Payment order not found');
    }

    const paymentSessionId = payment.gatewayResponse?.payment_session_id;

    if (!paymentSessionId) {
      logger.error({ orderId }, 'Payment session ID not found');
      return res.status(500).send('Payment session not initialized');
    }

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const isTestMode = appId?.includes('TEST') || secretKey?.includes('_test_') || secretKey?.includes('test');

    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment: isTestMode ? 'sandbox' : 'production'
    }, 'Serving form-based payment page');

    // Cashfree checkout URL
    const checkoutUrl = isTestMode
      ? 'https://sandbox.cashfree.com/pg/view/order'
      : 'https://www.cashfree.com/pg/view/order';

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting to Payment</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 1rem;
          }
          .container {
            background: white;
            border-radius: 16px;
            padding: 2.5rem;
            max-width: 450px;
            width: 100%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          .icon {
            font-size: 3.5rem;
            margin-bottom: 1.5rem;
            animation: pulse 1.5s ease-in-out infinite;
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
          h1 {
            font-size: 1.6rem;
            color: #333;
            margin-bottom: 1rem;
          }
          .message {
            font-size: 1rem;
            color: #666;
            margin-bottom: 2rem;
          }
          .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 1.5rem auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .order-info {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 8px;
            font-size: 0.85rem;
            color: #666;
            margin-top: 1.5rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">🔒</div>
          <h1>Redirecting to Secure Payment</h1>
          <div class="message">Please wait, you'll be redirected to complete your payment...</div>
          <div class="spinner"></div>
          <div class="order-info">
            <strong>Order ID:</strong> ${orderId}
          </div>
        </div>

        <form id="paymentForm" action="${checkoutUrl}" method="POST" style="display:none;">
          <input type="hidden" name="payment_session_id" value="${paymentSessionId}">
          <input type="hidden" name="order_id" value="${orderId}">
        </form>

        <script>
          console.log('Payment form page loaded');
          console.log('Session ID:', '${paymentSessionId}'.substring(0, 20) + '...');
          console.log('Submitting to:', '${checkoutUrl}');
          
          setTimeout(function() {
            console.log('Submitting payment form...');
            document.getElementById('paymentForm').submit();
          }, 1000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, 'Error in payment initiation');
    res.status(500).send('Error processing payment');
  }
});

router.get('/success', (req: Request, res: Response) => {
  const { orderId } = req.query;
  const deepLink = `bestie://payment/success?orderId=${orderId || ''}`;

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Payment Successful</title>
        <style>
          body {
            font-family: sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
          }
          .container { text-align: center; padding: 2rem; }
          .icon { font-size: 4rem; margin-bottom: 1rem; }
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
          <p>Redirecting to app...</p>
          <a href="${deepLink}" class="button">Open Bestie App</a>
        </div>
        <script>
          setTimeout(() => window.location.href = '${deepLink}', 1000);
        </script>
      </body>
    </html>
  `);
});

router.get('/failure', (req: Request, res: Response) => {
  const { orderId } = req.query;
  const deepLink = `bestie://payment/failure?orderId=${orderId || ''}`;

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Payment Failed</title>
        <style>
          body {
            font-family: sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            margin: 0;
          }
          .container { text-align: center; padding: 2rem; }
          .icon { font-size: 4rem; margin-bottom: 1rem; }
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
          <p>Redirecting to app...</p>
          <a href="${deepLink}" class="button">Open Bestie App</a>
        </div>
        <script>
          setTimeout(() => window.location.href = '${deepLink}', 1000);
        </script>
      </body>
    </html>
  `);
});

export default router;
