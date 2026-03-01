/**
 * Server Diagnostics Route
 * 
 * Advanced monitoring endpoints for stress testing and debugging:
 * 
 *   GET  /api/diagnostics/snapshot        → Point-in-time server health
 *   GET  /api/diagnostics/mongodb         → MongoDB deep diagnostics
 *   POST /api/diagnostics/stress-test     → Timed snapshot collection during load
 *   POST /api/diagnostics/socket-stress   → Long-lived socket connection test
 * 
 * IMPORTANT: These endpoints expose sensitive server info.
 * Only enable in staging/test environments!
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import v8 from 'v8';
import os from 'os';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

interface DiagnosticSnapshot {
    timestamp: string;
    cpu: {
        userMs: number;
        systemMs: number;
        percentEstimate: number;
    };
    memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
        rssMB: number;
        heapUsedMB: number;
        heapTotalMB: number;
    };
    v8Heap: {
        totalHeapSize: number;
        usedHeapSize: number;
        heapSizeLimit: number;
        totalPhysicalSize: number;
        mallocedMemory: number;
        usedPercent: number;
    };
    eventLoopLagMs: number;
    sockets: {
        activeConnections: number;
    };
    mongodb: {
        poolSize: number;
        readyState: string;
    };
    process: {
        uptimeSeconds: number;
        pid: number;
        nodeVersion: string;
    };
    os: {
        loadAvg: number[];
        totalMemMB: number;
        freeMemMB: number;
        cpus: number;
    };
}

/**
 * Measure event loop lag — how long the event loop is blocked
 */
function measureEventLoopLag(): Promise<number> {
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        setImmediate(() => {
            const end = process.hrtime.bigint();
            resolve(Number(end - start) / 1_000_000); // Convert to ms
        });
    });
}

/**
 * Get MongoDB connection ready state as human-readable string
 */
function getMongoReadyState(): string {
    const states: Record<number, string> = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
    };
    return states[mongoose.connection.readyState] || 'unknown';
}

/**
 * Collect a single diagnostic snapshot
 */
async function collectSnapshot(io?: any): Promise<DiagnosticSnapshot> {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const heapStats = v8.getHeapStatistics();
    const lagMs = await measureEventLoopLag();

    // CPU percent estimate (user + system microseconds / uptime seconds)
    const uptimeSec = process.uptime();
    const totalCpuMs = (cpu.user + cpu.system) / 1000;
    const cpuPercent = uptimeSec > 0 ? (totalCpuMs / (uptimeSec * 1000)) * 100 : 0;

    return {
        timestamp: new Date().toISOString(),
        cpu: {
            userMs: Math.round(cpu.user / 1000),
            systemMs: Math.round(cpu.system / 1000),
            percentEstimate: parseFloat(cpuPercent.toFixed(2)),
        },
        memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
            rssMB: parseFloat((mem.rss / 1024 / 1024).toFixed(2)),
            heapUsedMB: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(2)),
            heapTotalMB: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(2)),
        },
        v8Heap: {
            totalHeapSize: heapStats.total_heap_size,
            usedHeapSize: heapStats.used_heap_size,
            heapSizeLimit: heapStats.heap_size_limit,
            totalPhysicalSize: heapStats.total_physical_size,
            mallocedMemory: heapStats.malloced_memory,
            usedPercent: parseFloat(
                ((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(2)
            ),
        },
        eventLoopLagMs: parseFloat(lagMs.toFixed(2)),
        sockets: {
            activeConnections: io?.engine?.clientsCount ?? -1,
        },
        mongodb: {
            poolSize: (mongoose.connection as any)?.client?.topology?.s?.pool?.totalConnectionCount ?? -1,
            readyState: getMongoReadyState(),
        },
        process: {
            uptimeSeconds: parseFloat(uptimeSec.toFixed(2)),
            pid: process.pid,
            nodeVersion: process.version,
        },
        os: {
            loadAvg: os.loadavg().map(v => parseFloat(v.toFixed(2))),
            totalMemMB: parseFloat((os.totalmem() / 1024 / 1024).toFixed(2)),
            freeMemMB: parseFloat((os.freemem() / 1024 / 1024).toFixed(2)),
            cpus: os.cpus().length,
        },
    };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/diagnostics/snapshot
 * Point-in-time server health snapshot
 */
router.get('/snapshot', async (_req: Request, res: Response) => {
    try {
        const snapshot = await collectSnapshot();

        // Add red flag analysis
        const redFlags: string[] = [];
        if (snapshot.memory.rssMB > 400) redFlags.push(`⚠️ High RSS memory: ${snapshot.memory.rssMB}MB`);
        if (snapshot.v8Heap.usedPercent > 80) redFlags.push(`⚠️ V8 heap pressure: ${snapshot.v8Heap.usedPercent}%`);
        if (snapshot.eventLoopLagMs > 50) redFlags.push(`⚠️ Event loop lag: ${snapshot.eventLoopLagMs}ms`);
        if (snapshot.cpu.percentEstimate > 80) redFlags.push(`⚠️ High CPU: ${snapshot.cpu.percentEstimate}%`);

        res.json({
            snapshot,
            redFlags: redFlags.length > 0 ? redFlags : ['✅ All metrics within normal range'],
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/diagnostics/mongodb
 * MongoDB deep diagnostics — locks, ops, connections, storage
 */
router.get('/mongodb', async (_req: Request, res: Response) => {
    try {
        const db = mongoose.connection.db;
        if (!db) {
            return res.status(503).json({ error: 'MongoDB not connected' });
        }

        // Get server status (includes lock info, opcounters, connections)
        const serverStatus = await db.admin().command({ serverStatus: 1 });

        // Get database stats
        const dbStats = await db.stats();

        // Extract the most useful diagnostics
        const diagnostics = {
            server: {
                host: serverStatus.host,
                version: serverStatus.version,
                uptimeSeconds: serverStatus.uptime,
                uptimeHours: parseFloat((serverStatus.uptime / 3600).toFixed(2)),
            },
            connections: {
                current: serverStatus.connections?.current ?? -1,
                available: serverStatus.connections?.available ?? -1,
                totalCreated: serverStatus.connections?.totalCreated ?? -1,
                utilizationPercent: serverStatus.connections?.current && serverStatus.connections?.available
                    ? parseFloat(
                        ((serverStatus.connections.current /
                            (serverStatus.connections.current + serverStatus.connections.available)) * 100
                        ).toFixed(2)
                    )
                    : -1,
            },
            locks: {
                globalLock: {
                    totalTimeMs: serverStatus.globalLock?.totalTime
                        ? Math.round(serverStatus.globalLock.totalTime / 1000)
                        : -1,
                    currentQueue: {
                        total: serverStatus.globalLock?.currentQueue?.total ?? 0,
                        readers: serverStatus.globalLock?.currentQueue?.readers ?? 0,
                        writers: serverStatus.globalLock?.currentQueue?.writers ?? 0,
                    },
                    activeClients: {
                        total: serverStatus.globalLock?.activeClients?.total ?? 0,
                        readers: serverStatus.globalLock?.activeClients?.readers ?? 0,
                        writers: serverStatus.globalLock?.activeClients?.writers ?? 0,
                    },
                },
            },
            opcounters: {
                insert: serverStatus.opcounters?.insert ?? 0,
                query: serverStatus.opcounters?.query ?? 0,
                update: serverStatus.opcounters?.update ?? 0,
                delete: serverStatus.opcounters?.delete ?? 0,
                getmore: serverStatus.opcounters?.getmore ?? 0,
                command: serverStatus.opcounters?.command ?? 0,
            },
            network: {
                bytesInMB: serverStatus.network?.bytesIn
                    ? parseFloat((serverStatus.network.bytesIn / 1024 / 1024).toFixed(2))
                    : -1,
                bytesOutMB: serverStatus.network?.bytesOut
                    ? parseFloat((serverStatus.network.bytesOut / 1024 / 1024).toFixed(2))
                    : -1,
                numRequests: serverStatus.network?.numRequests ?? -1,
            },
            storage: {
                dataSize: dbStats.dataSize,
                storageSize: dbStats.storageSize,
                indexSize: dbStats.indexSize,
                dataSizeMB: parseFloat(((dbStats.dataSize || 0) / 1024 / 1024).toFixed(2)),
                collections: dbStats.collections,
                indexes: dbStats.indexes,
            },
            memory: {
                residentMB: serverStatus.mem?.resident ?? -1,
                virtualMB: serverStatus.mem?.virtual ?? -1,
            },
        };

        // Red flags
        const redFlags: string[] = [];
        const queue = diagnostics.locks.globalLock.currentQueue;
        if (queue.total > 10) redFlags.push(`⚠️ Lock queue: ${queue.total} ops waiting (readers: ${queue.readers}, writers: ${queue.writers})`);
        if (diagnostics.connections.utilizationPercent > 80) redFlags.push(`⚠️ Connection utilization: ${diagnostics.connections.utilizationPercent}%`);

        res.json({
            diagnostics,
            redFlags: redFlags.length > 0 ? redFlags : ['✅ MongoDB healthy'],
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/diagnostics/stress-test
 * Collect diagnostic snapshots over time while server is under load.
 * 
 * Query params:
 *   ?durationSec=60    — How long to collect snapshots (default: 60)
 *   ?intervalMs=2000    — Interval between snapshots (default: 2000)
 * 
 * Run this WHILE running a load test (POST /api/load-test/run?users=5000)
 * to see how server resources change under pressure.
 */
router.post('/stress-test', async (req: Request, res: Response) => {
    const durationSec = parseInt(req.query.durationSec as string) || 60;
    const intervalMs = parseInt(req.query.intervalMs as string) || 2000;

    if (durationSec > 300) {
        return res.status(400).json({ error: 'Max duration is 300 seconds (5 minutes)' });
    }

    // Respond immediately
    const testId = `diag_${Date.now()}`;
    res.json({
        message: `Stress diagnostics started: collecting snapshots every ${intervalMs}ms for ${durationSec}s`,
        testId,
        retrieveAt: `/api/diagnostics/stress-test/${testId}`,
    });

    // Collect snapshots in background
    const snapshots: DiagnosticSnapshot[] = [];
    const mongoSnapshots: any[] = [];
    const startTime = Date.now();

    const timer = setInterval(async () => {
        try {
            const snapshot = await collectSnapshot();
            snapshots.push(snapshot);

            // Also grab MongoDB lock info
            const db = mongoose.connection.db;
            if (db) {
                try {
                    const status = await db.admin().command({ serverStatus: 1 });
                    mongoSnapshots.push({
                        timestamp: new Date().toISOString(),
                        lockQueueTotal: status.globalLock?.currentQueue?.total ?? 0,
                        lockQueueReaders: status.globalLock?.currentQueue?.readers ?? 0,
                        lockQueueWriters: status.globalLock?.currentQueue?.writers ?? 0,
                        activeReaders: status.globalLock?.activeClients?.readers ?? 0,
                        activeWriters: status.globalLock?.activeClients?.writers ?? 0,
                        connections: status.connections?.current ?? 0,
                    });
                } catch { /* ignore if serverStatus fails */ }
            }
        } catch { /* ignore snapshot failures */ }
    }, intervalMs);

    // Stop after duration
    setTimeout(() => {
        clearInterval(timer);

        // Analyze results
        const analysis = analyzeStressResults(snapshots, mongoSnapshots);

        // Store results for retrieval
        stressTestResults.set(testId, {
            testId,
            durationSec,
            intervalMs,
            snapshotCount: snapshots.length,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
            snapshots,
            mongoSnapshots,
            analysis,
        });

        console.log(`📊 Diagnostics ${testId} completed: ${snapshots.length} snapshots collected`);
    }, durationSec * 1000);
});

// Store stress test results in memory
const stressTestResults = new Map<string, any>();

/**
 * GET /api/diagnostics/stress-test/:testId
 * Retrieve results of a completed stress diagnostic.
 */
router.get('/stress-test/:testId', (req: Request, res: Response) => {
    const result = stressTestResults.get(req.params.testId);
    if (!result) {
        return res.status(404).json({
            error: 'Test not found or still running',
            availableTests: Array.from(stressTestResults.keys()),
        });
    }
    res.json(result);
});

/**
 * Analyze stress test snapshots for red flags
 */
function analyzeStressResults(snapshots: DiagnosticSnapshot[], mongoSnapshots: any[]) {
    if (snapshots.length < 2) {
        return { error: 'Not enough snapshots to analyze' };
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    // Memory growth analysis
    const memoryGrowthMB = last.memory.rssMB - first.memory.rssMB;
    const heapGrowthMB = last.memory.heapUsedMB - first.memory.heapUsedMB;
    const memoryGrowthPercent = first.memory.rssMB > 0
        ? parseFloat(((memoryGrowthMB / first.memory.rssMB) * 100).toFixed(2))
        : 0;

    // CPU analysis
    const cpuValues = snapshots.map(s => s.cpu.percentEstimate);
    const avgCpu = parseFloat((cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length).toFixed(2));
    const maxCpu = Math.max(...cpuValues);

    // Event loop lag analysis
    const lagValues = snapshots.map(s => s.eventLoopLagMs);
    const avgLag = parseFloat((lagValues.reduce((a, b) => a + b, 0) / lagValues.length).toFixed(2));
    const maxLag = parseFloat(Math.max(...lagValues).toFixed(2));
    const p95Lag = parseFloat(percentile(lagValues, 95).toFixed(2));

    // V8 heap pressure
    const heapPressureValues = snapshots.map(s => s.v8Heap.usedPercent);
    const avgHeapPressure = parseFloat(
        (heapPressureValues.reduce((a, b) => a + b, 0) / heapPressureValues.length).toFixed(2)
    );

    // MongoDB lock contention
    const maxLockQueue = mongoSnapshots.length > 0
        ? Math.max(...mongoSnapshots.map(s => s.lockQueueTotal))
        : 0;
    const avgLockQueue = mongoSnapshots.length > 0
        ? parseFloat(
            (mongoSnapshots.map(s => s.lockQueueTotal).reduce((a: number, b: number) => a + b, 0) / mongoSnapshots.length).toFixed(2)
        )
        : 0;

    // Memory timeline (for charting)
    const memoryTimeline = snapshots.map(s => ({
        timestamp: s.timestamp,
        rssMB: s.memory.rssMB,
        heapUsedMB: s.memory.heapUsedMB,
    }));

    // CPU timeline
    const cpuTimeline = snapshots.map(s => ({
        timestamp: s.timestamp,
        cpuPercent: s.cpu.percentEstimate,
        eventLoopLagMs: s.eventLoopLagMs,
    }));

    // Red flags
    const redFlags: string[] = [];

    if (memoryGrowthPercent > 50) {
        redFlags.push(`🔴 MEMORY LEAK: RSS grew ${memoryGrowthMB.toFixed(1)}MB (${memoryGrowthPercent}%) — likely memory leak`);
    } else if (memoryGrowthPercent > 20) {
        redFlags.push(`🟡 Memory growth: RSS grew ${memoryGrowthMB.toFixed(1)}MB (${memoryGrowthPercent}%) — monitor closely`);
    }

    if (maxCpu > 90) {
        redFlags.push(`🔴 CPU THROTTLING: Peak CPU ${maxCpu}% — burstable instance likely throttled`);
    } else if (maxCpu > 70) {
        redFlags.push(`🟡 High CPU: Peak ${maxCpu}% — approaching throttle threshold`);
    }

    if (maxLag > 100) {
        redFlags.push(`🔴 EVENT LOOP BLOCKED: Max lag ${maxLag}ms — requests are queuing`);
    } else if (maxLag > 50) {
        redFlags.push(`🟡 Event loop lag: Max ${maxLag}ms — some blocking detected`);
    }

    if (avgHeapPressure > 80) {
        redFlags.push(`🔴 GC PRESSURE: Avg heap usage ${avgHeapPressure}% — frequent garbage collection likely`);
    } else if (avgHeapPressure > 60) {
        redFlags.push(`🟡 Heap pressure: Avg ${avgHeapPressure}% — GC may cause latency spikes`);
    }

    if (maxLockQueue > 10) {
        redFlags.push(`🔴 MONGODB CONTENTION: Max lock queue ${maxLockQueue} — operations waiting for locks`);
    } else if (maxLockQueue > 5) {
        redFlags.push(`🟡 MongoDB lock queue: Max ${maxLockQueue} — some contention detected`);
    }

    if (heapGrowthMB > 100) {
        redFlags.push(`🔴 HEAP GROWTH: Heap grew ${heapGrowthMB.toFixed(1)}MB — possible memory leak in JS objects`);
    }

    return {
        summary: {
            durationSec: snapshots.length > 1
                ? parseFloat(((new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000).toFixed(1))
                : 0,
            totalSnapshots: snapshots.length,
        },
        memory: {
            startRssMB: first.memory.rssMB,
            endRssMB: last.memory.rssMB,
            growthMB: parseFloat(memoryGrowthMB.toFixed(2)),
            growthPercent: memoryGrowthPercent,
            startHeapUsedMB: first.memory.heapUsedMB,
            endHeapUsedMB: last.memory.heapUsedMB,
            heapGrowthMB: parseFloat(heapGrowthMB.toFixed(2)),
        },
        cpu: {
            avgPercent: avgCpu,
            maxPercent: maxCpu,
            throttlingDetected: maxCpu > 90,
        },
        eventLoop: {
            avgLagMs: avgLag,
            maxLagMs: maxLag,
            p95LagMs: p95Lag,
        },
        gcPressure: {
            avgHeapUsedPercent: avgHeapPressure,
            maxHeapUsedPercent: parseFloat(Math.max(...heapPressureValues).toFixed(2)),
        },
        mongodbLocks: {
            avgLockQueue: avgLockQueue,
            maxLockQueue: maxLockQueue,
            lockContentionDetected: maxLockQueue > 5,
        },
        timelines: {
            memory: memoryTimeline,
            cpu: cpuTimeline,
            mongoLocks: mongoSnapshots.map(s => ({
                timestamp: s.timestamp,
                lockQueue: s.lockQueueTotal,
                activeReaders: s.activeReaders,
                activeWriters: s.activeWriters,
            })),
        },
        redFlags: redFlags.length > 0 ? redFlags : ['✅ All metrics within normal range during test'],
    };
}

/**
 * POST /api/diagnostics/socket-stress
 * Test long-lived socket connections impact on server resources.
 * 
 * Query params:
 *   ?count=500          — Number of fake connections to simulate (default: 100)
 *   ?durationSec=30     — How long to hold connections (default: 30)
 * 
 * NOTE: This simulates socket memory overhead, not actual Socket.IO connections.
 * For real socket testing, use a separate client-side load tool.
 */
router.post('/socket-stress', async (req: Request, res: Response) => {
    const count = Math.min(parseInt(req.query.count as string) || 100, 2000);
    const durationSec = Math.min(parseInt(req.query.durationSec as string) || 30, 120);

    const testId = `socket_${Date.now()}`;

    // Snapshot BEFORE
    const before = await collectSnapshot();

    // Simulate socket-like memory overhead
    // Each real Socket.IO connection uses ~50-200KB of memory
    // We allocate buffers to simulate this overhead
    const fakeConnections: Buffer[] = [];
    const connectionSize = 64 * 1024; // 64KB per "connection" (conservative estimate)

    res.json({
        message: `Socket stress test started: ${count} simulated connections for ${durationSec}s`,
        testId,
        retrieveAt: `/api/diagnostics/socket-stress/${testId}`,
    });

    try {
        // Allocate simulated connections
        for (let i = 0; i < count; i++) {
            fakeConnections.push(Buffer.alloc(connectionSize));
        }

        // Snapshot DURING (connections active)
        const during = await collectSnapshot();

        // Hold connections for the specified duration, taking snapshots
        const holdSnapshots: DiagnosticSnapshot[] = [during];

        const holdInterval = setInterval(async () => {
            holdSnapshots.push(await collectSnapshot());
        }, 5000); // Every 5 seconds

        setTimeout(async () => {
            clearInterval(holdInterval);

            // Snapshot just before releasing
            const beforeRelease = await collectSnapshot();
            holdSnapshots.push(beforeRelease);

            // Release simulated connections
            fakeConnections.length = 0;

            // Force GC if available
            if (global.gc) {
                global.gc();
            }

            // Wait a moment for GC
            await new Promise(r => setTimeout(r, 2000));

            // Snapshot AFTER
            const after = await collectSnapshot();

            const memoryPerConnectionKB = count > 0
                ? parseFloat(((during.memory.rssMB - before.memory.rssMB) / count * 1024).toFixed(2))
                : 0;

            const result = {
                testId,
                simulatedConnections: count,
                connectionSizeKB: connectionSize / 1024,
                durationSec,
                before: {
                    rssMB: before.memory.rssMB,
                    heapUsedMB: before.memory.heapUsedMB,
                    eventLoopLagMs: before.eventLoopLagMs,
                },
                during: {
                    rssMB: during.memory.rssMB,
                    heapUsedMB: during.memory.heapUsedMB,
                    eventLoopLagMs: during.eventLoopLagMs,
                },
                after: {
                    rssMB: after.memory.rssMB,
                    heapUsedMB: after.memory.heapUsedMB,
                    eventLoopLagMs: after.eventLoopLagMs,
                },
                analysis: {
                    memoryDeltaDuringMB: parseFloat((during.memory.rssMB - before.memory.rssMB).toFixed(2)),
                    memoryPerConnectionKB,
                    memoryReleasedMB: parseFloat((during.memory.rssMB - after.memory.rssMB).toFixed(2)),
                    eventLoopImpactMs: parseFloat((during.eventLoopLagMs - before.eventLoopLagMs).toFixed(2)),
                    memoryFullyRecovered: after.memory.rssMB <= before.memory.rssMB * 1.05, // Within 5%
                },
                holdTimeline: holdSnapshots.map(s => ({
                    timestamp: s.timestamp,
                    rssMB: s.memory.rssMB,
                    heapUsedMB: s.memory.heapUsedMB,
                    eventLoopLagMs: s.eventLoopLagMs,
                })),
                redFlags: [] as string[],
            };

            // Red flags
            if (memoryPerConnectionKB > 200) {
                result.redFlags.push(`🔴 High memory per connection: ${memoryPerConnectionKB}KB (expected <200KB)`);
            }
            if (!result.analysis.memoryFullyRecovered) {
                result.redFlags.push(`🟡 Memory not fully recovered after releasing connections (possible leak)`);
            }
            if (result.analysis.eventLoopImpactMs > 50) {
                result.redFlags.push(`🟡 Event loop degraded by ${result.analysis.eventLoopImpactMs}ms during connections`);
            }

            if (result.redFlags.length === 0) {
                result.redFlags.push('✅ Socket stress handled well');
            }

            socketStressResults.set(testId, result);
            console.log(`📊 Socket stress ${testId} completed: ${count} connections, ${memoryPerConnectionKB}KB each`);
        }, durationSec * 1000);
    } catch (error: any) {
        fakeConnections.length = 0;
        socketStressResults.set(testId, { error: error.message });
    }
});

// Store socket stress test results
const socketStressResults = new Map<string, any>();

/**
 * GET /api/diagnostics/socket-stress/:testId
 * Retrieve results of a completed socket stress test.
 */
router.get('/socket-stress/:testId', (req: Request, res: Response) => {
    const result = socketStressResults.get(req.params.testId);
    if (!result) {
        return res.status(404).json({
            error: 'Test not found or still running',
            availableTests: Array.from(socketStressResults.keys()),
        });
    }
    res.json(result);
});

/**
 * GET /api/diagnostics/list
 * List all available diagnostic test results.
 */
router.get('/list', (_req: Request, res: Response) => {
    res.json({
        stressTests: Array.from(stressTestResults.keys()),
        socketStressTests: Array.from(socketStressResults.keys()),
    });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

export default router;
