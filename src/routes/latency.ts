/**
 * Latency Report Route
 * 
 * Endpoints:
 * 
 * GET /api/latency/stats?minutes=60
 *   → JSON: overall stats + per-endpoint + per-service breakdown
 * 
 * GET /api/latency/csv?minutes=60
 *   → CSV: all individual request latencies
 * 
 * GET /api/latency/services?minutes=60
 *   → JSON: per-service stats (MongoDB, Zego, Firebase, Cashfree)
 * 
 * GET /api/latency/services/csv?minutes=60
 *   → CSV: all individual service-level latencies
 */

import { Router, Request, Response } from 'express';
import {
    getLatencyRecords,
    computeLatencyStats,
    computePerEndpointStats,
} from '../middleware/latencyTracker';
import {
    getServiceLatencyRecords,
    computeServiceStats,
    computeServiceOperationStats,
} from '../middleware/serviceLatencyTracker';

const router = Router();

/**
 * GET /api/latency/stats
 * Full stats: overall + per-endpoint + per-service summary.
 */
router.get('/stats', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;

    // Request-level stats
    const requestRecords = getLatencyRecords(minutes);
    const overall = computeLatencyStats(requestRecords);
    const perEndpoint = computePerEndpointStats(requestRecords);

    // Service-level stats
    const serviceRecords = getServiceLatencyRecords(minutes);
    const perService = computeServiceStats(serviceRecords);
    const perOperation = computeServiceOperationStats(serviceRecords);

    // Status code distribution
    const byStatus: Record<string, number> = {};
    for (const r of requestRecords) {
        const bucket = `${Math.floor(r.statusCode / 100)}xx`;
        byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    }

    res.json({
        periodMinutes: minutes,
        collectedFrom: requestRecords.length > 0 ? requestRecords[0].timestamp : null,
        collectedTo: requestRecords.length > 0 ? requestRecords[requestRecords.length - 1].timestamp : null,

        // Overall API latency
        overall,
        statusCodeDistribution: byStatus,

        // Per-service breakdown (MongoDB, Zego, Firebase, Cashfree)
        perService,

        // Top 20 slowest API endpoints by P95
        slowestEndpoints: perEndpoint.slice(0, 20),

        // Top 20 slowest service operations (e.g., mongodb find on 'calls')
        slowestOperations: perOperation.slice(0, 20),
    });
});

/**
 * GET /api/latency/services
 * Detailed per-service stats only.
 */
router.get('/services', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const records = getServiceLatencyRecords(minutes);
    const perService = computeServiceStats(records);
    const perOperation = computeServiceOperationStats(records);

    res.json({
        periodMinutes: minutes,
        totalServiceCalls: records.length,

        // Summary per service
        perService,

        // All operations sorted by P95 (slowest first)
        allOperations: perOperation,
    });
});

/**
 * GET /api/latency/csv
 * Download all request-level latency records as CSV.
 */
router.get('/csv', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const records = getLatencyRecords(minutes);

    const header = 'timestamp,method,path,statusCode,latencyMs,userAgent';
    const rows = records.map(r => {
        const escapedPath = `"${(r.path || '').replace(/"/g, '""')}"`;
        const escapedUA = `"${(r.userAgent || '').replace(/"/g, '""')}"`;
        return `${r.timestamp},${r.method},${escapedPath},${r.statusCode},${r.latencyMs},${escapedUA}`;
    });

    const csv = [header, ...rows].join('\n');
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `request_latency_${now}_last${minutes}min.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

/**
 * GET /api/latency/services/csv
 * Download all service-level latency records as CSV.
 */
router.get('/services/csv', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const records = getServiceLatencyRecords(minutes);

    const header = 'timestamp,service,operation,collection,latencyMs,success,url';
    const rows = records.map(r => {
        const escapedOp = `"${(r.operation || '').replace(/"/g, '""')}"`;
        const escapedUrl = `"${(r.url || '').replace(/"/g, '""')}"`;
        return `${r.timestamp},${r.service},${escapedOp},${r.collection || ''},${r.latencyMs},${r.success},${escapedUrl}`;
    });

    const csv = [header, ...rows].join('\n');
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `service_latency_${now}_last${minutes}min.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

export default router;
