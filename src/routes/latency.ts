/**
 * Latency Report Route
 * 
 * Provides two endpoints:
 * 
 * GET /api/latency/stats?minutes=60
 *   → JSON summary with mean, min, max, P50, P95, P99 + per-endpoint breakdown
 * 
 * GET /api/latency/csv?minutes=60
 *   → Downloads a CSV file with all individual request latencies
 */

import { Router, Request, Response } from 'express';
import {
    getLatencyRecords,
    computeLatencyStats,
    computePerEndpointStats,
} from '../middleware/latencyTracker';

const router = Router();

/**
 * GET /api/latency/stats
 * Returns JSON latency statistics for the last N minutes (default: 60).
 */
router.get('/stats', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const records = getLatencyRecords(minutes);
    const overall = computeLatencyStats(records);
    const perEndpoint = computePerEndpointStats(records);

    // Group by status code
    const byStatus: Record<string, number> = {};
    for (const r of records) {
        const bucket = `${Math.floor(r.statusCode / 100)}xx`;
        byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    }

    res.json({
        periodMinutes: minutes,
        collectedFrom: records.length > 0 ? records[0].timestamp : null,
        collectedTo: records.length > 0 ? records[records.length - 1].timestamp : null,
        overall,
        statusCodeDistribution: byStatus,
        slowestEndpoints: perEndpoint.slice(0, 20), // Top 20 slowest by P95
    });
});

/**
 * GET /api/latency/csv
 * Downloads all individual latency records as a CSV file.
 */
router.get('/csv', (req: Request, res: Response) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const records = getLatencyRecords(minutes);

    // CSV header
    const header = 'timestamp,method,path,statusCode,latencyMs,userAgent';

    // CSV rows — escape commas in path and userAgent
    const rows = records.map(r => {
        const escapedPath = `"${(r.path || '').replace(/"/g, '""')}"`;
        const escapedUA = `"${(r.userAgent || '').replace(/"/g, '""')}"`;
        return `${r.timestamp},${r.method},${escapedPath},${r.statusCode},${r.latencyMs},${escapedUA}`;
    });

    const csv = [header, ...rows].join('\n');

    // Generate filename with current timestamp
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `latency_report_${now}_last${minutes}min.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

export default router;
