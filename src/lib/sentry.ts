import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * Initialize Sentry for error monitoring
 * This is OPTIONAL - app works without it, but you won't have error tracking
 */
export function initializeSentry() {
    // Only initialize if DSN is provided
    const sentryDSN = process.env.SENTRY_DSN;

    if (!sentryDSN) {
        logger.warn('SENTRY_DSN not configured - Error monitoring disabled');
        logger.warn('Add SENTRY_DSN to .env to enable error tracking');
        return;
    }

    try {
        Sentry.init({
            dsn: sentryDSN,
            environment: process.env.NODE_ENV || 'development',

            // Performance Monitoring
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

            // Release tracking
            release: process.env.npm_package_version,

            // Filter sensitive data
            beforeSend(event) {
                // Remove sensitive headers
                if (event.request?.headers) {
                    delete event.request.headers['authorization'];
                    delete event.request.headers['cookie'];
                }

                // Remove sensitive body data
                if (event.request?.data) {
                    const data = event.request.data as any;
                    if (data.password) delete data.password;
                    if (data.token) delete data.token;
                }

                return event;
            },
        });

        logger.info({
            environment: process.env.NODE_ENV,
            release: process.env.npm_package_version,
        }, '✅ Sentry error monitoring initialized');
    } catch (error: any) {
        logger.error({
            error: error.message,
        }, '❌ Failed to initialize Sentry (non-critical)');
    }
}

/**
 * Capture error in Sentry
 * Safe to call even if Sentry not initialized
 */
export function captureError(error: Error, context?: Record<string, any>) {
    try {
        Sentry.captureException(error, {
            extra: context,
        });
    } catch (e) {
        // Silently fail - don't let Sentry errors break the app
        logger.debug('Failed to send error to Sentry (non-critical)');
    }
}

/**
 * Add user context to Sentry
 */
export function setUserContext(userId: string, email?: string) {
    try {
        Sentry.setUser({
            id: userId,
            email,
        });
    } catch (e) {
        // Silently fail
    }
}

/**
 * Clear user context (on logout)
 */
export function clearUserContext() {
    try {
        Sentry.setUser(null);
    } catch (e) {
        // Silently fail
    }
}

export { Sentry };
