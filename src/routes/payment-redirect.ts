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

    logger.info({
      orderId,
      paymentSessionId: paymentSessionId.substring(0, 20) + '...',
      environment: isTestMode ? 'sandbox' : 'production'
    }, 'Serving SDK-based payment page');

    // Send payment page with Cashfree SDK
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Complete Payment</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
          }
          .container {
            background: white;
            border-radius: 16px;
            padding: 2rem;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          .icon {
            font-size: 3rem;
            margin-bottom: 1rem;
          }
          h1 {
            font-size: 1.5rem;
            color: #333;
            margin-bottom: 0.5rem;
          }
          .status {
            font-size: 0.95rem;
            color: #666;
            margin-bottom: 1.5rem;
            min-height: 1.5rem;
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
            margin: 1rem 0;
            font-size: 0.85rem;
            color: #666;
          }
          .error-box {
            background: #fee;
            border: 1px solid #fcc;
            color: #c33;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            display: none;
            font-size: 0.9rem;
          }
          .button {
            display: inline-block;
            padding: 0.75rem 2rem;
            background: #667eea;
            color: white;
            text-decoration: none;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 1rem;
            margin-top: 1rem;
            transition: opacity 0.2s;
          }
          .button:active {
            opacity: 0.8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon" id="icon">🔒</div>
          <h1 id="title">Initializing Payment</h1>
          <div class="status" id="status">Please wait while we set up your secure payment...</div>
          <div class="spinner" id="spinner"></div>
          <div class="order-info">
            <strong>Order ID:</strong> ${orderId}
          </div>
          <div class="error-box" id="error"></div>
          <button class="button" id="retryBtn" onclick="initPayment()" style="display: none;">
            Retry Payment
          </button>
        </div>

        <script>
          const SESSION_ID = "${paymentSessionId}";
          const MODE = "${isTestMode ? 'sandbox' : 'production'}";
          let attempting = false;
          
          function updateUI(icon, title, status, showSpinner, showError, errorMsg) {
            document.getElementById('icon').textContent = icon;
            document.getElementById('title').textContent = title;
            document.getElementById('status').textContent = status;
            document.getElementById('spinner').style.display = showSpinner ? 'block' : 'none';
            document.getElementById('error').style.display = showError ? 'block' : 'none';
            if (showError && errorMsg) {
              document.getElementById('error').innerHTML = errorMsg;
            }
          }
          
          function showRetry() {
            document.getElementById('retryBtn').style.display = 'inline-block';
          }
          
          function hideRetry() {
            document.getElementById('retryBtn').style.display = 'none';
          }
          
          function initPayment() {
            if (attempting) return;
            attempting = true;
            hideRetry();
            updateUI('🔒', 'Initializing Payment', 'Loading Cashfree payment gateway...', true, false);
            
            setTimeout(function() {
              try {
                if (typeof Cashfree === 'undefined') {
                  throw new Error('Payment gateway SDK failed to load. Please check your internet connection.');
                }
                
                updateUI('💳', 'Loading Payment Gateway', 'Connecting to secure payment system...', true, false);
                
                const cashfree = Cashfree({ mode: MODE });
                
                updateUI('💳', 'Redirecting to Payment', 'Please wait, redirecting to payment page...', true, false);
                
                cashfree.checkout({
                  paymentSessionId: SESSION_ID,
                  redirectTarget: "_self"
                }).then(function(result) {
                  if (result.error) {
                    console.error('Cashfree error:', result.error);
                    const errMsg = result.error.message || 'Failed to initialize payment';
                    updateUI('❌', 'Payment Failed', '', false, true, 
                      '<strong>Error:</strong> ' + errMsg + 
                      '<br><small>Please try again or contact support if the issue persists.</small>');
                    showRetry();
                    attempting = false;
                  } else if (result.redirect) {
                    updateUI('✓', 'Redirecting...', 'Taking you to the payment page now', true, false);
                  }
                }).catch(function(error) {
                  console.error('Checkout error:', error);
                  updateUI('❌', 'Payment Failed', '', false, true,
                    '<strong>Error:</strong> ' + (error.message || 'Unknown error') +
                    '<br><small>Please try again.</small>');
                  showRetry();
                  attempting = false;
                });
              } catch (error) {
                console.error('Exception:', error);
                updateUI('❌', 'Payment Failed', '', false, true,
                  '<strong>Error:</strong> ' + error.message +
                  '<br><small>Please try again or contact support.</small>');
                showRetry();
                attempting = false;
              }
            }, 1000);
          }
          
          // Auto-start after page loads
          window.addEventListener('load', function() {
            setTimeout(initPayment, 500);
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

// Success and failure routes remain the same as in original file
router.get('/success', (req: Request, res: Response) => {
  try {
    const { orderId } = req.query;

    logger.info({ orderId }, 'Payment redirect - success');

    const deepLink = `bestie://payment/success?orderId=${orderId || ''}`;

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
              transform: scale(1 .05);
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
