/**
 * Latency Tracker Middleware
 * 
 * Records response time for every API request in an in-memory ring buffer.
 * Data is kept for the last 1 hour and automatically pruned.
 * 
 * Usage: app.use(latencyTracker) — add BEFORE routes, AFTER bodyparser.
 */

import { Request, Response, NextFunction } from 'express';

export interface LatencyRecord {
    timestamp: string;       // ISO 8601
    method: string;          // GET, POST, PUT, DELETE
    path: string;            // /api/calls/initiate
    statusCode: number;      // 200, 404, 500...
    latencyMs: number;       // Response time in milliseconds
    userAgent?: string;      // Client user agent
}

// In-memory buffer — stores up to 1 hour of records
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const latencyBuffer: LatencyRecord[] = [];

// Prune old entries every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - MAX_AGE_MS;
    while (latencyBuffer.length > 0 && new Date(latencyBuffer[0].timestamp).getTime() < cutoff) {
        latencyBuffer.shift();
    }
}, 5 * 60 * 1000);

/**
 * Express middleware — call app.use(latencyTracker) before routes.
 */
export function latencyTracker(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint(); // nanosecond precision

    // Hook into response finish event
    res.on('finish', () => {
        const end = process.hrtime.bigint();
        const durationNs = Number(end - start);
        const latencyMs = parseFloat((durationNs / 1_000_000).toFixed(2)); // ns → ms, 2 decimal places

        const record: LatencyRecord = {
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.originalUrl || req.url,
            statusCode: res.statusCode,
            latencyMs,
            userAgent: req.headers['user-agent']?.substring(0, 100), // Truncate long UAs
        };

        latencyBuffer.push(record);
    });

    next();
}

/**
 * Get all latency records from the last N minutes (default: 60).
 */
export function getLatencyRecords(lastMinutes: number = 60): LatencyRecord[] {
    const cutoff = Date.now() - (lastMinutes * 60 * 1000);
    return latencyBuffer.filter(r => new Date(r.timestamp).getTime() >= cutoff);
}

/**
 * Compute latency statistics from a set of records.
 */
export function computeLatencyStats(records: LatencyRecord[]) {
    if (records.length === 0) {
        return {
            totalRequests: 0,
            meanLatencyMs: 0,
            minLatencyMs: 0,
            maxLatencyMs: 0,
            p50LatencyMs: 0,
            p95LatencyMs: 0,
            p99LatencyMs: 0,
        };
    }

    const latencies = records.map(r => r.latencyMs).sort((a, b) => a - b);
    const sum = latencies.reduce((acc, val) => acc + val, 0);

    const percentile = (arr: number[], p: number) => {
        const index = Math.ceil((p / 100) * arr.length) - 1;
        return arr[Math.max(0, index)];
    };

    return {
        totalRequests: latencies.length,
        meanLatencyMs: parseFloat((sum / latencies.length).toFixed(2)),
        minLatencyMs: latencies[0],
        maxLatencyMs: latencies[latencies.length - 1],
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        p99LatencyMs: percentile(latencies, 99),
    };
}

/**
 * Compute per-endpoint breakdown.
 */
export function computePerEndpointStats(records: LatencyRecord[]) {
    const groups: Record<string, LatencyRecord[]> = {};

    for (const r of records) {
        // Normalize path: strip query params and IDs (e.g., /api/calls/abc123 → /api/calls/:id)
        const normalizedPath = r.path
            .split('?')[0]                                    // Remove query string
            .replace(/\/[a-f0-9]{24}/g, '/:id')               // MongoDB ObjectIds
            .replace(/\/[0-9a-f-]{36}/g, '/:uuid');           // UUIDs

        const key = `${r.method} ${normalizedPath}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    }

    return Object.entries(groups)
        .map(([endpoint, recs]) => ({
            endpoint,
            ...computeLatencyStats(recs),
        }))
        .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs); // Slowest P95 first
}
