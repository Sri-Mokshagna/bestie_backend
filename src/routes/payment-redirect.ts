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
    }, 'Serving Drop component payment page');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Complete Payment</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem;
            text-align: center;
          }
          .header h1 {
            font-size: 1.3rem;
            margin-bottom: 0.5rem;
          }
          .header .order-id {
            font-size: 0.85rem;
            opacity: 0.9;
          }
          #payment-container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            min-height: 400px;
          }
          .loading {
            text-align: center;
            padding: 3rem 1rem;
          }
          .spinner {
            width: 50px;
            height: 50px;
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
          .error {
            background: #fee;
            border: 1px solid #fcc;
            color: #c33;
            padding: 1.5rem;
            margin: 2rem;
            border-radius: 8px;
            text-align: center;
          }
          .retry-btn {
            display: inline-block;
            margin-top: 1rem;
            padding: 0.75rem 2rem;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🔒 Secure Payment</h1>
          <div class="order-id">Order ID: ${orderId}</div>
        </div>

        <div id="payment-container">
          <div class="loading">
            <div class="spinner"></div>
            <p>Loading payment options...</p>
          </div>
        </div>

        <script>
          const SESSION_ID = "${paymentSessionId}";
          const MODE = "${isTestMode ? 'sandbox' : 'production'}";
          
          console.log('Payment Drop page loaded');
          console.log('Session ID:', SESSION_ID.substring(0, 20) + '...');
          console.log('Mode:', MODE);
          
          function showError(msg) {
            document.getElementById('payment-container').innerHTML = 
              '<div class="error">' +
              '<strong>Payment Error</strong><br>' +
              msg +
              '<br><button class="retry-btn" onclick="location.reload()">Retry</button>' +
              '</div>';
          }
          
          window.addEventListener('load', function() {
            setTimeout(function() {
              try {
                if (typeof Cashfree === 'undefined') {
                  showError('Payment gateway failed to load. Please check your connection and try again.');
                  return;
                }
                
                console.log('Initializing Cashfree Drop component...');
                const cashfree = Cashfree({ mode: MODE });
                
                const dropConfig = {
                  paymentSessionId: SESSION_ID,
                  redirectTarget: "_self"
                };
                
                console.log('Rendering Drop component...');
                cashfree.drop(document.getElementById("payment-container"), dropConfig)
                  .then(function(drop) {
                    console.log('Drop component rendered successfully');
                  })
                  .catch(function(error) {
                    console.error('Drop component error:', error);
                    showError('Failed to load payment options. ' + (error.message || 'Please try again.'));
                  });
                  
              } catch (error) {
                console.error('Exception:', error);
                showError('An unexpected error occurred. Please try again.');
              }
            }, 500);
          });
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
    <!DOCTYPE HTML>
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
