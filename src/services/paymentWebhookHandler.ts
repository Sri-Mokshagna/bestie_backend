import { Payment, PaymentStatus } from '../models/Payment';
import { cashfreeService } from '../lib/cashfree';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../lib/logger';

/**
 * Parse Cashfree webhook data to extract payment information
 * Handles both PAYMENT_SUCCESS_WEBHOOK and PAYMENT_LINK_EVENT formats
 */
export function parseCashfreeWebhook(webhookData: any): {
    order_id: string;
    payment_status: string;
    payment_method: any;
    cf_payment_id: string;
    ourOrderId: string | null;
} {
    const webhookType = webhookData.type;
    let order_id: string;
    let payment_status: string;
    let payment_method: any;
    let cf_payment_id: string;
    let ourOrderId: string | null = null;

    if (webhookType === 'PAYMENT_SUCCESS_WEBHOOK' || webhookType === 'PAYMENT_FAILED_WEBHOOK') {
        // Payment webhook structure: data.order.order_id, data.payment.*
        order_id = webhookData.data?.order?.order_id;
        payment_status = webhookData.data?.payment?.payment_status;
        payment_method = webhookData.data?.payment?.payment_method;
        cf_payment_id = webhookData.data?.payment?.cf_payment_id;

        // Extract our original order ID from link_id (format: LINK_ORDER_xxx)
        if (webhookData.data?.order?.order_tags?.link_id) {
            const linkId = webhookData.data.order.order_tags.link_id;
            ourOrderId = linkId.replace(/^LINK_/, '');
        }
    } else if (webhookType === 'PAYMENT_LINK_EVENT') {
        // Payment link webhook structure: data.order.order_id, data.link_id
        order_id = webhookData.data?.order?.order_id;
        payment_status = webhookData.data?.order?.transaction_status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
        payment_method = null;
        cf_payment_id = webhookData.data?.order?.transaction_id;

        // Extract our original order ID from link_id
        if (webhookData.data?.link_id) {
            const linkId = webhookData.data.link_id;
            ourOrderId = linkId.replace(/^LINK_/, '');
        }
    } else {
        throw new Error(`Unknown webhook type: ${webhookType}`);
    }

    logger.info({
        webhookType,
        cashfreeOrderId: order_id,
        ourOrderId,
        payment_status
    }, 'Parsed Cashfree webhook');

    return { order_id, payment_status, payment_method, cf_payment_id, ourOrderId };
}

/**
 * Find payment record by multiple identifiers
 */
export async function findPaymentRecord(cashfreeOrderId: string, ourOrderId: string | null) {
    const searchCriteria: any[] = [
        { cashfreeOrderId: cashfreeOrderId },
        { orderId: cashfreeOrderId }
    ];

    if (ourOrderId) {
        searchCriteria.push({ orderId: ourOrderId });
    }

    const payment = await Payment.findOne({ $or: searchCriteria });

    if (!payment) {
        // Log recent payments for debugging
        const allPayments = await Payment.find({})
            .limit(5)
            .select('orderId cashfreeOrderId')
            .lean();

        logger.error({
            searchedCashfreeOrderId: cashfreeOrderId,
            searchedOurOrderId: ourOrderId,
            recentPayments: allPayments
        }, 'Payment record not found');
    } else {
        logger.info({
            foundPayment: {
                orderId: payment.orderId,
                cashfreeOrderId: payment.cashfreeOrderId
            }
        }, 'Payment record found successfully');
    }

    return payment;
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const isValid = cashfreeService.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
        logger.error({ signature }, 'Invalid webhook signature');
        throw new AppError(400, 'Invalid webhook signature');
    }

    return true;
}
