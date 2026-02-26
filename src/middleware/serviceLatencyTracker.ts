/**
 * Service-Level Latency Tracker
 * 
 * Automatically captures per-service latencies:
 *   - MongoDB:   Every Mongoose query (find, save, update, aggregate, etc.)
 *   - External:  Every axios HTTP call (Zego, Firebase, Cashfree, etc.)
 * 
 * Data is stored in a 1-hour ring buffer, same as the request-level tracker.
 * 
 * Setup:
 *   1. Call setupMongooseLatencyTracking() AFTER mongoose.connect()
 *   2. Call setupAxiosLatencyTracking(axiosInstance) for each axios instance
 *      OR call setupGlobalAxiosTracking() to patch all axios calls
 */

import mongoose from 'mongoose';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ServiceLatencyRecord {
    timestamp: string;         // ISO 8601
    service: string;           // 'mongodb' | 'zego' | 'firebase' | 'cashfree' | 'external'
    operation: string;         // 'find' | 'POST /api/v2/rooms' | 'sendMulticast'
    collection?: string;       // MongoDB collection name (e.g., 'calls', 'users')
    latencyMs: number;         // Duration in milliseconds
    success: boolean;          // Whether the operation succeeded
    url?: string;              // External API URL (for HTTP calls)
}

// ─── Buffer ─────────────────────────────────────────────────────────────────

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const serviceBuffer: ServiceLatencyRecord[] = [];

// Auto-prune every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - MAX_AGE_MS;
    while (serviceBuffer.length > 0 && new Date(serviceBuffer[0].timestamp).getTime() < cutoff) {
        serviceBuffer.shift();
    }
}, 5 * 60 * 1000);

function addRecord(record: ServiceLatencyRecord) {
    serviceBuffer.push(record);
}

/**
 * Call this ONCE after mongoose.connect() to track all DB queries.
 * Uses Mongoose's debug callback — captures every query with zero type issues.
 */
export function setupMongooseLatencyTracking(): void {
    // Track active query start times
    const queryTimers = new Map<string, bigint>();
    let queryCounter = 0;

    // Monkey-patch mongoose.Query.prototype.exec to wrap every query
    const originalExec = mongoose.Query.prototype.exec;
    mongoose.Query.prototype.exec = async function (this: any, ...args: any[]) {
        const queryId = `q_${++queryCounter}`;
        const start = process.hrtime.bigint();
        const operation = this.op || 'unknown';
        const collectionName = this.mongooseCollection?.collectionName || this.model?.collection?.collectionName || 'unknown';

        try {
            const result = await originalExec.apply(this, args);
            const end = process.hrtime.bigint();
            const latencyMs = parseFloat((Number(end - start) / 1_000_000).toFixed(2));

            addRecord({
                timestamp: new Date().toISOString(),
                service: 'mongodb',
                operation,
                collection: collectionName,
                latencyMs,
                success: true,
            });

            return result;
        } catch (error) {
            const end = process.hrtime.bigint();
            const latencyMs = parseFloat((Number(end - start) / 1_000_000).toFixed(2));

            addRecord({
                timestamp: new Date().toISOString(),
                service: 'mongodb',
                operation,
                collection: collectionName,
                latencyMs,
                success: false,
            });

            throw error;
        }
    } as any;

    // Also track .save() calls via schema plugin (save is a document method, not a query)
    mongoose.plugin((schema) => {
        schema.pre('save', function (this: any) {
            (this as any)._serviceLatencyStart = process.hrtime.bigint();
        });

        schema.post('save', function (this: any) {
            const start = (this as any)._serviceLatencyStart;
            if (!start) return;

            const end = process.hrtime.bigint();
            const latencyMs = parseFloat((Number(end - start) / 1_000_000).toFixed(2));
            const collectionName = (this as any).constructor?.collection?.collectionName || 'unknown';

            addRecord({
                timestamp: new Date().toISOString(),
                service: 'mongodb',
                operation: 'save',
                collection: collectionName,
                latencyMs,
                success: true,
            });
        });
    });

    console.log('📊 MongoDB latency tracking enabled (all queries + saves will be timed)');
}

// ─── External HTTP Tracking (Axios Interceptors) ────────────────────────────

/**
 * Classify an external URL into a service name.
 */
function classifyService(url: string): string {
    if (!url) return 'external';
    const lower = url.toLowerCase();

    if (lower.includes('zego')) return 'zego';
    if (lower.includes('firebase') || lower.includes('fcm.googleapis.com') || lower.includes('google')) return 'firebase';
    if (lower.includes('cashfree')) return 'cashfree';
    if (lower.includes('admob')) return 'admob';

    return 'external';
}

// Extend axios config type to carry start time
interface TimedAxiosConfig extends InternalAxiosRequestConfig {
    _serviceLatencyStart?: bigint;
}

/**
 * Attach latency tracking interceptors to a specific axios instance.
 */
export function setupAxiosLatencyTracking(instance: AxiosInstance): void {
    // Request interceptor — record start time
    instance.interceptors.request.use((config: TimedAxiosConfig) => {
        config._serviceLatencyStart = process.hrtime.bigint();
        return config;
    });

    // Response interceptor — calculate duration
    instance.interceptors.response.use(
        (response) => {
            const config = response.config as TimedAxiosConfig;
            if (config._serviceLatencyStart) {
                const end = process.hrtime.bigint();
                const latencyMs = parseFloat((Number(end - config._serviceLatencyStart) / 1_000_000).toFixed(2));
                const url = config.url || '';

                addRecord({
                    timestamp: new Date().toISOString(),
                    service: classifyService(url),
                    operation: `${config.method?.toUpperCase()} ${new URL(url, 'http://localhost').pathname}`,
                    latencyMs,
                    success: true,
                    url: url.substring(0, 200), // Truncate long URLs
                });
            }
            return response;
        },
        (error) => {
            const config = error?.config as TimedAxiosConfig;
            if (config?._serviceLatencyStart) {
                const end = process.hrtime.bigint();
                const latencyMs = parseFloat((Number(end - config._serviceLatencyStart) / 1_000_000).toFixed(2));
                const url = config.url || '';

                addRecord({
                    timestamp: new Date().toISOString(),
                    service: classifyService(url),
                    operation: `${config.method?.toUpperCase()} ${new URL(url, 'http://localhost').pathname}`,
                    latencyMs,
                    success: false,
                    url: url.substring(0, 200),
                });
            }
            return Promise.reject(error);
        }
    );
}

/**
 * Track ALL axios calls globally (default axios instance).
 * Call this once at app startup.
 */
export function setupGlobalAxiosTracking(): void {
    setupAxiosLatencyTracking(axios as unknown as AxiosInstance);
    console.log('📊 Global axios latency tracking enabled (Zego, Firebase, Cashfree, etc.)');
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Get all service latency records from the last N minutes.
 */
export function getServiceLatencyRecords(lastMinutes: number = 60): ServiceLatencyRecord[] {
    const cutoff = Date.now() - (lastMinutes * 60 * 1000);
    return serviceBuffer.filter(r => new Date(r.timestamp).getTime() >= cutoff);
}

/**
 * Compute per-service summary stats.
 * Returns: { mongodb: { count, mean, min, max, p95 }, zego: {...}, firebase: {...}, ... }
 */
export function computeServiceStats(records: ServiceLatencyRecord[]) {
    const groups: Record<string, number[]> = {};

    for (const r of records) {
        if (!groups[r.service]) groups[r.service] = [];
        groups[r.service].push(r.latencyMs);
    }

    const result: Record<string, {
        totalCalls: number;
        meanLatencyMs: number;
        minLatencyMs: number;
        maxLatencyMs: number;
        p95LatencyMs: number;
        successRate: string;
    }> = {};

    for (const [service, latencies] of Object.entries(groups)) {
        latencies.sort((a, b) => a - b);
        const sum = latencies.reduce((acc, val) => acc + val, 0);
        const p95Index = Math.ceil(0.95 * latencies.length) - 1;
        const successCount = records.filter(r => r.service === service && r.success).length;

        result[service] = {
            totalCalls: latencies.length,
            meanLatencyMs: parseFloat((sum / latencies.length).toFixed(2)),
            minLatencyMs: latencies[0],
            maxLatencyMs: latencies[latencies.length - 1],
            p95LatencyMs: latencies[Math.max(0, p95Index)],
            successRate: ((successCount / latencies.length) * 100).toFixed(1) + '%',
        };
    }

    return result;
}

/**
 * Compute per-operation breakdown within each service.
 * e.g., mongodb.find on 'calls' collection, mongodb.save on 'users', etc.
 */
export function computeServiceOperationStats(records: ServiceLatencyRecord[]) {
    const groups: Record<string, number[]> = {};

    for (const r of records) {
        const key = r.collection
            ? `${r.service} → ${r.operation} (${r.collection})`
            : `${r.service} → ${r.operation}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r.latencyMs);
    }

    return Object.entries(groups)
        .map(([operation, latencies]) => {
            latencies.sort((a, b) => a - b);
            const sum = latencies.reduce((acc, val) => acc + val, 0);
            const p95Index = Math.ceil(0.95 * latencies.length) - 1;
            return {
                operation,
                totalCalls: latencies.length,
                meanLatencyMs: parseFloat((sum / latencies.length).toFixed(2)),
                minLatencyMs: latencies[0],
                maxLatencyMs: latencies[latencies.length - 1],
                p95LatencyMs: latencies[Math.max(0, p95Index)],
            };
        })
        .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs); // Slowest first
}
