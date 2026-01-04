import { Payment, PaymentStatus } from '../models/Payment';
import { cashfreeService } from '../lib/cashfree';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../lib/logger';

/**
 * Parse Cashfree webhook data to extract payment information
 * Handles multiple webhook formats:
 * - PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK (new format)
 * - PAYMENT_LINK_EVENT (legacy format)
 * - ORDER_WEBHOOK (order status updates)
 */
export function parseCashfreeWebhook(webhookData: any): {
    order_id: string;
    payment_status: string;
    payment_method: any;
    cf_payment_id: string;
    ourOrderId: string | null;
} {
    const webhookType = webhookData.type;
    let order_id: string = '';
    let payment_status: string = '';
    let payment_method: any = null;
    let cf_payment_id: string = '';
    let ourOrderId: string | null = null;

    logger.info({ webhookType, rawData: webhookData }, 'Parsing Cashfree webhook');

    if (webhookType === 'PAYMENT_SUCCESS_WEBHOOK' || webhookType === 'PAYMENT_FAILED_WEBHOOK') {
        // New Payment webhook format: data.order.order_id, data.payment.*
        order_id = webhookData.data?.order?.order_id || '';
        payment_status = webhookData.data?.payment?.payment_status || '';
        payment_method = webhookData.data?.payment?.payment_method;
        cf_payment_id = webhookData.data?.payment?.cf_payment_id?.toString() || '';

        // Extract our original order ID from order_tags
        if (webhookData.data?.order?.order_tags?.original_order_id) {
            ourOrderId = webhookData.data.order.order_tags.original_order_id;
        } else if (webhookData.data?.order?.order_tags?.link_id) {
            // Fallback for old format
            const linkId = webhookData.data.order.order_tags.link_id;
            ourOrderId = linkId.replace(/^LINK_/, '');
        }
    } else if (webhookType === 'PAYMENT_LINK_EVENT') {
        // Legacy Payment link webhook: data.order.order_id, data.link_id
        order_id = webhookData.data?.order?.order_id || '';
        payment_status = webhookData.data?.order?.transaction_status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
        payment_method = null;
        cf_payment_id = webhookData.data?.order?.transaction_id?.toString() || '';

        // Extract our original order ID from link_id
        if (webhookData.data?.link_id) {
            const linkId = webhookData.data.link_id;
            ourOrderId = linkId.replace(/^LINK_/, '');
        }
    } else if (webhookType === 'ORDER_WEBHOOK' || webhookType?.includes('ORDER')) {
        // Order status webhook
        order_id = webhookData.data?.order?.order_id || webhookData.order_id || '';
        const orderStatus = webhookData.data?.order?.order_status || webhookData.order_status || '';
        
        // Map order status to payment status
        if (orderStatus === 'PAID') {
            payment_status = 'SUCCESS';
        } else if (orderStatus === 'EXPIRED' || orderStatus === 'TERMINATED') {
            payment_status = 'FAILED';
        } else if (orderStatus === 'ACTIVE') {
            payment_status = 'PENDING';
        } else {
            payment_status = orderStatus;
        }
        
        cf_payment_id = webhookData.data?.payment?.cf_payment_id?.toString() || '';
        
        if (webhookData.data?.order?.order_tags?.original_order_id) {
            ourOrderId = webhookData.data.order.order_tags.original_order_id;
        }
    } else {
        logger.warn({ webhookType, webhookData }, 'Unknown webhook type - attempting to parse');
        
        // Try to extract data from unknown format
        order_id = webhookData.data?.order?.order_id || 
                   webhookData.order_id || 
                   webhookData.data?.order_id || '';
        payment_status = webhookData.data?.payment?.payment_status || 
                        webhookData.payment_status || 
                        webhookData.status || 'UNKNOWN';
        cf_payment_id = webhookData.data?.payment?.cf_payment_id?.toString() || '';
    }

    logger.info({
        webhookType,
        cashfreeOrderId: order_id,
        ourOrderId,
        payment_status,
        cf_payment_id: cf_payment_id?.substring(0, 10) || 'N/A',
    }, '✅ Parsed Cashfree webhook');

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
