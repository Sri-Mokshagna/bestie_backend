/**
 * End-to-End Call Load Test
 * 
 * Simulates the FULL call lifecycle at scale:
 *   initiate → accept → confirm → (wait) → end
 * 
 * Tests at: 2000, 3000, 4000, 5000, 10000, 15000, 20000, 25000 concurrent call pairs.
 * Each "concurrent user" = one call pair (1 user + 1 responder).
 * So 2000 users = 1000 simultaneous call pairs.
 * 
 * Results stored in memory + exposed via /api/load-test/results.
 * 
 * IMPORTANT: This bypasses auth and uses the DB service layer directly.
 * Only enable in staging/test environments, NOT in production!
 * 
 * Endpoints:
 *   POST /api/load-test/run?users=2000      → Start a test
 *   GET  /api/load-test/results              → Get all results
 *   GET  /api/load-test/results/csv          → Download results as CSV
 *   GET  /api/load-test/status               → Current test status
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Call, CallType, CallStatus } from '../../models/Call';
import { User, UserRole, UserStatus } from '../../models/User';

const router = Router();

// ─── Types ──────────────────────────────────────────────────────────────────

interface StepTiming {
    step: string;
    latencyMs: number;
    success: boolean;
    error?: string;
}

interface CallTestResult {
    callIndex: number;
    userId: string;
    responderId: string;
    callId?: string;
    steps: StepTiming[];
    totalLatencyMs: number;
    success: boolean;
    error?: string;
}

interface LoadTestResult {
    testId: string;
    startedAt: string;
    completedAt?: string;
    targetUsers: number;
    actualCallPairs: number;
    concurrencyBatchSize: number;
    status: 'running' | 'completed' | 'failed';

    // Aggregated stats
    summary?: {
        totalCalls: number;
        successfulCalls: number;
        failedCalls: number;
        successRate: string;

        // Per-step stats
        steps: Record<string, {
            meanMs: number;
            minMs: number;
            maxMs: number;
            p95Ms: number;
            successRate: string;
        }>;

        // Overall
        totalMeanMs: number;
        totalMinMs: number;
        totalMaxMs: number;
        totalP95Ms: number;
    };

    // Individual results (for CSV export)
    results: CallTestResult[];
}

// ─── State ──────────────────────────────────────────────────────────────────

const testResults: LoadTestResult[] = [];
let currentTest: LoadTestResult | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

async function timedStep<T>(
    stepName: string,
    fn: () => Promise<T>
): Promise<{ result?: T; timing: StepTiming }> {
    const start = process.hrtime.bigint();
    try {
        const result = await fn();
        const end = process.hrtime.bigint();
        return {
            result,
            timing: {
                step: stepName,
                latencyMs: parseFloat((Number(end - start) / 1_000_000).toFixed(2)),
                success: true,
            },
        };
    } catch (error: any) {
        const end = process.hrtime.bigint();
        return {
            timing: {
                step: stepName,
                latencyMs: parseFloat((Number(end - start) / 1_000_000).toFixed(2)),
                success: false,
                error: error.message?.substring(0, 200),
            },
        };
    }
}

// ─── Test User Management ───────────────────────────────────────────────────

async function createTestUsers(count: number): Promise<{ users: string[]; responders: string[] }> {
    const userIds: string[] = [];
    const responderIds: string[] = [];

    // Create users and responders in batches
    const batchSize = 100;
    const pairsNeeded = Math.ceil(count / 2);

    for (let batch = 0; batch < pairsNeeded; batch += batchSize) {
        const batchEnd = Math.min(batch + batchSize, pairsNeeded);
        const userDocs = [];
        const responderDocs = [];

        for (let i = batch; i < batchEnd; i++) {
            const userId = new mongoose.Types.ObjectId();
            const responderId = new mongoose.Types.ObjectId();

            userDocs.push({
                _id: userId,
                firebaseUid: `load_test_user_${i}_${Date.now()}`,
                displayName: `LoadTestUser${i}`,
                email: `loadtest_user_${i}_${Date.now()}@test.com`,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                coinBalance: 100000, // Plenty of coins for testing
                isOnline: true,
            });

            responderDocs.push({
                _id: responderId,
                firebaseUid: `load_test_resp_${i}_${Date.now()}`,
                displayName: `LoadTestResponder${i}`,
                email: `loadtest_resp_${i}_${Date.now()}@test.com`,
                role: UserRole.RESPONDER,
                status: UserStatus.ACTIVE,
                coinBalance: 0,
                isOnline: true,
                isAvailableForAudioCall: true,
                isAvailableForVideoCall: true,
            });

            userIds.push(userId.toString());
            responderIds.push(responderId.toString());
        }

        await User.insertMany(userDocs, { ordered: false }).catch(() => { });
        await User.insertMany(responderDocs, { ordered: false }).catch(() => { });
    }

    return { users: userIds, responders: responderIds };
}

async function cleanupTestUsers(userIds: string[], responderIds: string[]) {
    await User.deleteMany({ _id: { $in: [...userIds, ...responderIds] } }).catch(() => { });
}

// ─── Core Test Runner ───────────────────────────────────────────────────────

async function runSingleCallTest(
    index: number,
    userId: string,
    responderId: string
): Promise<CallTestResult> {
    const result: CallTestResult = {
        callIndex: index,
        userId,
        responderId,
        steps: [],
        totalLatencyMs: 0,
        success: false,
    };

    const overallStart = process.hrtime.bigint();

    try {
        // STEP 1: Create call document directly (bypass business logic validation for load test)
        const roomId = `load_test_${index}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

        const { result: call, timing: createTiming } = await timedStep('1_create_call', async () => {
            const callDoc = await Call.create({
                userId: new mongoose.Types.ObjectId(userId),
                responderId: new mongoose.Types.ObjectId(responderId),
                type: CallType.AUDIO,
                zegoRoomId: roomId,
                status: CallStatus.RINGING,
                initialCoinBalance: 100000,
                maxDurationSeconds: 600,
            });
            return callDoc;
        });
        result.steps.push(createTiming);

        if (!call || !createTiming.success) {
            result.error = createTiming.error || 'Failed to create call';
            return result;
        }

        result.callId = call._id.toString();

        // STEP 2: Accept call (update status to connecting)
        const { timing: acceptTiming } = await timedStep('2_accept_call', async () => {
            await Call.findByIdAndUpdate(call._id, {
                status: CallStatus.CONNECTING,
            });
        });
        result.steps.push(acceptTiming);

        if (!acceptTiming.success) {
            result.error = acceptTiming.error;
            return result;
        }

        // STEP 3: Confirm connection (update to active + set startTime)
        const { timing: confirmTiming } = await timedStep('3_confirm_call', async () => {
            await Call.findByIdAndUpdate(call._id, {
                status: CallStatus.ACTIVE,
                startTime: new Date(),
                scheduledEndTime: new Date(Date.now() + 600000), // 10 min max
            });
        });
        result.steps.push(confirmTiming);

        if (!confirmTiming.success) {
            result.error = confirmTiming.error;
            return result;
        }

        // STEP 4: Get call status (simulates status polling during call)
        const { timing: statusTiming } = await timedStep('4_get_status', async () => {
            await Call.findById(call._id);
        });
        result.steps.push(statusTiming);

        // STEP 5: End call (update status + calculate duration)
        const { timing: endTiming } = await timedStep('5_end_call', async () => {
            await Call.findByIdAndUpdate(call._id, {
                status: CallStatus.ENDED,
                endTime: new Date(),
                durationSeconds: 5, // Simulated 5 second call
                coinsCharged: 1,
            });
        });
        result.steps.push(endTiming);

        if (!endTiming.success) {
            result.error = endTiming.error;
            return result;
        }

        // STEP 6: Cleanup — delete test call document
        const { timing: cleanupTiming } = await timedStep('6_cleanup', async () => {
            await Call.findByIdAndDelete(call._id);
        });
        result.steps.push(cleanupTiming);

        result.success = true;
    } catch (error: any) {
        result.error = error.message?.substring(0, 200);
    }

    const overallEnd = process.hrtime.bigint();
    result.totalLatencyMs = parseFloat((Number(overallEnd - overallStart) / 1_000_000).toFixed(2));

    return result;
}

async function runLoadTest(targetUsers: number): Promise<LoadTestResult> {
    const testId = `test_${targetUsers}_${Date.now()}`;
    const callPairs = Math.floor(targetUsers / 2);
    // Process in batches to avoid overwhelming MongoDB connection pool
    const batchSize = Math.min(callPairs, 200);

    const test: LoadTestResult = {
        testId,
        startedAt: new Date().toISOString(),
        targetUsers,
        actualCallPairs: callPairs,
        concurrencyBatchSize: batchSize,
        status: 'running',
        results: [],
    };

    currentTest = test;
    testResults.push(test);

    console.log(`\n🚀 LOAD TEST STARTED: ${targetUsers} users (${callPairs} call pairs) in batches of ${batchSize}`);

    try {
        // Step 1: Create test users
        console.log(`📦 Creating ${callPairs} user-responder pairs...`);
        const { users, responders } = await createTestUsers(targetUsers);
        console.log(`✅ Created ${users.length} users + ${responders.length} responders`);

        // Step 2: Run call tests in concurrent batches
        for (let batchStart = 0; batchStart < callPairs; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, callPairs);
            const batchPromises: Promise<CallTestResult>[] = [];

            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(runSingleCallTest(i, users[i], responders[i]));
            }

            const batchResults = await Promise.all(batchPromises);
            test.results.push(...batchResults);

            const completedSoFar = test.results.length;
            const successSoFar = test.results.filter(r => r.success).length;
            console.log(`  Batch ${Math.floor(batchStart / batchSize) + 1}: ${batchResults.filter(r => r.success).length}/${batchResults.length} success | Total: ${completedSoFar}/${callPairs} (${successSoFar} success)`);
        }

        // Step 3: Cleanup test users
        console.log(`🧹 Cleaning up test users...`);
        await cleanupTestUsers(users, responders);

        // Step 4: Compute summary stats
        test.summary = computeTestSummary(test.results);
        test.status = 'completed';
        test.completedAt = new Date().toISOString();

        console.log(`\n✅ LOAD TEST COMPLETED: ${targetUsers} users`);
        console.log(`   Success rate: ${test.summary.successRate}`);
        console.log(`   Mean latency: ${test.summary.totalMeanMs}ms`);
        console.log(`   P95 latency:  ${test.summary.totalP95Ms}ms`);
        console.log(`   Max latency:  ${test.summary.totalMaxMs}ms`);

    } catch (error: any) {
        test.status = 'failed';
        test.completedAt = new Date().toISOString();
        console.error(`❌ LOAD TEST FAILED: ${error.message}`);
    }

    currentTest = null;
    return test;
}

function computeTestSummary(results: CallTestResult[]) {
    const successful = results.filter(r => r.success);
    const totalLatencies = results.map(r => r.totalLatencyMs).filter(l => l > 0);

    // Per-step stats
    const stepNames = ['1_create_call', '2_accept_call', '3_confirm_call', '4_get_status', '5_end_call', '6_cleanup'];
    const steps: Record<string, any> = {};

    for (const stepName of stepNames) {
        const stepLatencies = results
            .flatMap(r => r.steps.filter(s => s.step === stepName))
            .map(s => s.latencyMs);

        const stepSuccessCount = results
            .flatMap(r => r.steps.filter(s => s.step === stepName && s.success))
            .length;

        if (stepLatencies.length > 0) {
            const sum = stepLatencies.reduce((a, b) => a + b, 0);
            steps[stepName] = {
                meanMs: parseFloat((sum / stepLatencies.length).toFixed(2)),
                minMs: Math.min(...stepLatencies),
                maxMs: Math.max(...stepLatencies),
                p95Ms: percentile(stepLatencies, 95),
                successRate: ((stepSuccessCount / stepLatencies.length) * 100).toFixed(1) + '%',
            };
        }
    }

    return {
        totalCalls: results.length,
        successfulCalls: successful.length,
        failedCalls: results.length - successful.length,
        successRate: ((successful.length / results.length) * 100).toFixed(1) + '%',
        steps,
        totalMeanMs: totalLatencies.length > 0
            ? parseFloat((totalLatencies.reduce((a, b) => a + b, 0) / totalLatencies.length).toFixed(2))
            : 0,
        totalMinMs: totalLatencies.length > 0 ? Math.min(...totalLatencies) : 0,
        totalMaxMs: totalLatencies.length > 0 ? Math.max(...totalLatencies) : 0,
        totalP95Ms: percentile(totalLatencies, 95),
    };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/load-test/run?users=2000
 * Start a load test with the specified number of users.
 * Allowed values: 2000, 3000, 4000, 5000, 10000
 */
router.post('/run', async (req: Request, res: Response) => {
    if (currentTest) {
        return res.status(409).json({
            error: 'A test is already running',
            currentTest: {
                testId: currentTest.testId,
                targetUsers: currentTest.targetUsers,
                progress: `${currentTest.results.length}/${currentTest.actualCallPairs} pairs completed`,
            },
        });
    }

    const targetUsers = parseInt(req.query.users as string) || 2000;
    const allowedValues = [2000, 3000, 4000, 5000, 10000, 15000, 20000, 25000];

    if (!allowedValues.includes(targetUsers)) {
        return res.status(400).json({
            error: `Invalid user count. Allowed values: ${allowedValues.join(', ')}`,
        });
    }

    // Safety check: only in non-production
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
            error: 'Load tests are not allowed in production environment',
        });
    }

    // Start test in background — respond immediately
    res.json({
        message: `Load test started for ${targetUsers} users (${Math.floor(targetUsers / 2)} call pairs)`,
        testId: `test_${targetUsers}_${Date.now()}`,
        targetUsers,
        estimatedDurationMinutes: Math.ceil(targetUsers / 2000) * 2,
        checkResultsAt: '/api/load-test/results',
        checkStatusAt: '/api/load-test/status',
    });

    // Run test async (don't await — it runs in background)
    runLoadTest(targetUsers).catch(err => {
        console.error('Load test error:', err);
    });
});

/**
 * POST /api/load-test/run-all
 * Run all test levels sequentially: 2000 → 25000.
 * Optional: ?levels=10000,20000,25000 to run specific levels only.
 */
router.post('/run-all', async (req: Request, res: Response) => {
    if (currentTest) {
        return res.status(409).json({ error: 'A test is already running' });
    }

    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not allowed in production' });
    }

    const allLevels = [2000, 3000, 4000, 5000, 10000, 15000, 20000, 25000];
    const customLevels = req.query.levels
        ? (req.query.levels as string).split(',').map(Number).filter(n => allLevels.includes(n))
        : allLevels;

    res.json({
        message: `Running test levels sequentially: ${customLevels.join(', ')}`,
        levels: customLevels,
        checkResultsAt: '/api/load-test/results',
        predictionAt: '/api/load-test/prediction',
    });

    // Run all levels sequentially in background
    (async () => {
        for (const users of customLevels) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Starting test level: ${users} users`);
            console.log(`${'='.repeat(60)}`);
            await runLoadTest(users);
            // Brief pause between test levels to let DB recover
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        console.log('\n✅ ALL LOAD TESTS COMPLETED');
        console.log('📈 View predictions at: /api/load-test/prediction');
    })().catch(err => console.error('Run-all error:', err));
});

/**
 * GET /api/load-test/status
 * Get current test progress.
 */
router.get('/status', (req: Request, res: Response) => {
    if (!currentTest) {
        return res.json({ status: 'idle', message: 'No test currently running' });
    }

    const successSoFar = currentTest.results.filter(r => r.success).length;
    res.json({
        status: 'running',
        testId: currentTest.testId,
        targetUsers: currentTest.targetUsers,
        totalCallPairs: currentTest.actualCallPairs,
        completedPairs: currentTest.results.length,
        successfulSoFar: successSoFar,
        failedSoFar: currentTest.results.length - successSoFar,
        progressPercent: ((currentTest.results.length / currentTest.actualCallPairs) * 100).toFixed(1) + '%',
    });
});

/**
 * GET /api/load-test/results
 * Get all test results (summary only, no individual call data).
 */
router.get('/results', (req: Request, res: Response) => {
    const summaries = testResults.map(t => ({
        testId: t.testId,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        targetUsers: t.targetUsers,
        actualCallPairs: t.actualCallPairs,
        status: t.status,
        summary: t.summary,
    }));

    res.json({
        totalTests: summaries.length,
        tests: summaries,
    });
});

/**
 * GET /api/load-test/results/:testId
 * Get detailed results for a specific test.
 */
router.get('/results/:testId', (req: Request, res: Response) => {
    const test = testResults.find(t => t.testId === req.params.testId);
    if (!test) {
        return res.status(404).json({ error: 'Test not found' });
    }

    res.json(test);
});

/**
 * GET /api/load-test/results/csv/:testId
 * Download CSV with individual call results for a specific test.
 */
router.get('/results/csv/:testId', (req: Request, res: Response) => {
    const test = testResults.find(t => t.testId === req.params.testId);
    if (!test) {
        return res.status(404).json({ error: 'Test not found' });
    }

    // Build CSV with one row per call, columns for each step's latency
    const header = 'callIndex,userId,responderId,callId,success,totalLatencyMs,create_call_ms,accept_call_ms,confirm_call_ms,get_status_ms,end_call_ms,cleanup_ms,error';

    const rows = test.results.map(r => {
        const getStep = (name: string) => r.steps.find(s => s.step === name)?.latencyMs ?? '';
        const error = r.error ? `"${r.error.replace(/"/g, '""')}"` : '';
        return [
            r.callIndex,
            r.userId,
            r.responderId,
            r.callId || '',
            r.success,
            r.totalLatencyMs,
            getStep('1_create_call'),
            getStep('2_accept_call'),
            getStep('3_confirm_call'),
            getStep('4_get_status'),
            getStep('5_end_call'),
            getStep('6_cleanup'),
            error,
        ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const filename = `load_test_${test.testId}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

/**
 * GET /api/load-test/comparison
 * Compare results across all test levels side-by-side.
 */
router.get('/comparison', (req: Request, res: Response) => {
    const completed = testResults.filter(t => t.status === 'completed' && t.summary);

    const comparison = completed.map(t => ({
        targetUsers: t.targetUsers,
        callPairs: t.actualCallPairs,
        successRate: t.summary!.successRate,
        totalCalls: t.summary!.totalCalls,
        successfulCalls: t.summary!.successfulCalls,
        failedCalls: t.summary!.failedCalls,
        overall: {
            meanMs: t.summary!.totalMeanMs,
            minMs: t.summary!.totalMinMs,
            maxMs: t.summary!.totalMaxMs,
            p95Ms: t.summary!.totalP95Ms,
        },
        perStep: t.summary!.steps,
    }));

    res.json({
        totalCompletedTests: comparison.length,
        comparison: comparison.sort((a, b) => a.targetUsers - b.targetUsers),
    });
});

// ─── Exponential Regression & Prediction ────────────────────────────────────

/**
 * Fit exponential curve: y = a * e^(b * x)
 * Uses least-squares on ln(y) = ln(a) + b*x
 */
function fitExponential(points: { x: number; y: number }[]): {
    a: number;
    b: number;
    equation: string;
    rSquared: number;
} {
    if (points.length < 2) {
        return { a: 0, b: 0, equation: 'Not enough data points', rSquared: 0 };
    }

    // Filter out zero/negative y values (can't take log)
    const valid = points.filter(p => p.y > 0);
    if (valid.length < 2) {
        return { a: 0, b: 0, equation: 'Not enough valid data points', rSquared: 0 };
    }

    const n = valid.length;
    const lnY = valid.map(p => Math.log(p.y));
    const X = valid.map(p => p.x);

    // Linear regression on (x, ln(y))
    const sumX = X.reduce((a, b) => a + b, 0);
    const sumLnY = lnY.reduce((a, b) => a + b, 0);
    const sumXLnY = X.reduce((acc, xi, i) => acc + xi * lnY[i], 0);
    const sumX2 = X.reduce((acc, xi) => acc + xi * xi, 0);

    const bCoeff = (n * sumXLnY - sumX * sumLnY) / (n * sumX2 - sumX * sumX);
    const lnA = (sumLnY - bCoeff * sumX) / n;
    const aCoeff = Math.exp(lnA);

    // R² calculation
    const meanLnY = sumLnY / n;
    const ssTotal = lnY.reduce((acc, yi) => acc + (yi - meanLnY) ** 2, 0);
    const ssResidual = lnY.reduce((acc, yi, i) => {
        const predicted = lnA + bCoeff * X[i];
        return acc + (yi - predicted) ** 2;
    }, 0);
    const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    // Format equation nicely
    const equation = `y = ${aCoeff.toFixed(4)} × e^(${bCoeff.toExponential(4)} × x)`;

    return {
        a: parseFloat(aCoeff.toFixed(6)),
        b: parseFloat(bCoeff.toExponential(6)),
        equation,
        rSquared: parseFloat(rSquared.toFixed(6)),
    };
}

/**
 * GET /api/load-test/prediction
 * 
 * Fits an exponential curve y = a·e^(bx) to completed test results.
 * Returns:
 *   - The fitted equation and R² goodness-of-fit
 *   - Actual data points from tests
 *   - Predicted latencies for key user counts (1K → 50K)
 *   - Ready-to-graph data table
 */
router.get('/prediction', (req: Request, res: Response) => {
    const completed = testResults.filter(t => t.status === 'completed' && t.summary);

    if (completed.length < 2) {
        return res.status(400).json({
            error: 'Need at least 2 completed tests to generate prediction',
            completedTests: completed.length,
            hint: 'Run tests at different user levels first: POST /api/load-test/run?users=2000',
        });
    }

    // Collect data points: users → mean latency
    const dataPoints = completed.map(t => ({
        x: t.targetUsers,
        y: t.summary!.totalMeanMs,
    }));

    // Also collect P95 data
    const p95Points = completed.map(t => ({
        x: t.targetUsers,
        y: t.summary!.totalP95Ms,
    }));

    // Also collect max latency data
    const maxPoints = completed.map(t => ({
        x: t.targetUsers,
        y: t.summary!.totalMaxMs,
    }));

    // Fit exponential curves
    const meanFit = fitExponential(dataPoints);
    const p95Fit = fitExponential(p95Points);
    const maxFit = fitExponential(maxPoints);

    // Generate predictions for key user counts
    const predictionLevels = [1000, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000];

    const predictions = predictionLevels.map(users => ({
        users,
        callPairs: Math.floor(users / 2),
        predictedMeanMs: parseFloat((meanFit.a * Math.exp(meanFit.b * users)).toFixed(2)),
        predictedP95Ms: parseFloat((p95Fit.a * Math.exp(p95Fit.b * users)).toFixed(2)),
        predictedMaxMs: parseFloat((maxFit.a * Math.exp(maxFit.b * users)).toFixed(2)),
        isExtrapolated: !completed.some(t => t.targetUsers === users),
    }));

    // Actual test data for comparison
    const actualData = completed
        .sort((a, b) => a.targetUsers - b.targetUsers)
        .map(t => ({
            users: t.targetUsers,
            callPairs: t.actualCallPairs,
            actualMeanMs: t.summary!.totalMeanMs,
            actualP95Ms: t.summary!.totalP95Ms,
            actualMaxMs: t.summary!.totalMaxMs,
            successRate: t.summary!.successRate,
        }));

    // CSV-ready table for easy graphing
    const csvHeader = 'users,callPairs,predictedMeanMs,predictedP95Ms,predictedMaxMs,isExtrapolated';
    const csvRows = predictions.map(p =>
        `${p.users},${p.callPairs},${p.predictedMeanMs},${p.predictedP95Ms},${p.predictedMaxMs},${p.isExtrapolated}`
    );
    const csvTable = [csvHeader, ...csvRows].join('\n');

    res.json({
        equations: {
            mean: {
                equation: meanFit.equation,
                a: meanFit.a,
                b: meanFit.b,
                rSquared: meanFit.rSquared,
                description: 'Predicts average (mean) latency per call lifecycle',
            },
            p95: {
                equation: p95Fit.equation,
                a: p95Fit.a,
                b: p95Fit.b,
                rSquared: p95Fit.rSquared,
                description: 'Predicts 95th percentile latency',
            },
            max: {
                equation: maxFit.equation,
                a: maxFit.a,
                b: maxFit.b,
                rSquared: maxFit.rSquared,
                description: 'Predicts worst-case (max) latency',
            },
        },
        actualData,
        predictions,
        csvTable,
        graphInstructions: {
            xAxis: 'users (concurrent users)',
            yAxis: 'latency (milliseconds)',
            series: [
                'predictedMeanMs — average call lifecycle time',
                'predictedP95Ms — 95th percentile (worst 5% of calls)',
                'predictedMaxMs — absolute worst case',
            ],
            howToUse: [
                'Copy the csvTable field into a .csv file',
                'Import into Google Sheets / Excel',
                'Create a scatter chart with users on X-axis and latency on Y-axis',
                'Or use the equations directly: y = a × e^(b × x)',
            ],
        },
    });
});

/**
 * GET /api/load-test/prediction/csv
 * Download prediction table as CSV for direct import into graphing tools.
 */
router.get('/prediction/csv', (req: Request, res: Response) => {
    const completed = testResults.filter(t => t.status === 'completed' && t.summary);

    if (completed.length < 2) {
        return res.status(400).json({ error: 'Need at least 2 completed tests' });
    }

    const dataPoints = completed.map(t => ({ x: t.targetUsers, y: t.summary!.totalMeanMs }));
    const p95Points = completed.map(t => ({ x: t.targetUsers, y: t.summary!.totalP95Ms }));
    const maxPoints = completed.map(t => ({ x: t.targetUsers, y: t.summary!.totalMaxMs }));

    const meanFit = fitExponential(dataPoints);
    const p95Fit = fitExponential(p95Points);
    const maxFit = fitExponential(maxPoints);

    const levels = [1000, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000];

    // Build CSV with actual + predicted
    const header = 'users,type,meanMs,p95Ms,maxMs';
    const rows: string[] = [];

    // Actual data
    for (const t of completed.sort((a, b) => a.targetUsers - b.targetUsers)) {
        rows.push(`${t.targetUsers},actual,${t.summary!.totalMeanMs},${t.summary!.totalP95Ms},${t.summary!.totalMaxMs}`);
    }

    // Predicted data
    for (const users of levels) {
        const predMean = (meanFit.a * Math.exp(meanFit.b * users)).toFixed(2);
        const predP95 = (p95Fit.a * Math.exp(p95Fit.b * users)).toFixed(2);
        const predMax = (maxFit.a * Math.exp(maxFit.b * users)).toFixed(2);
        rows.push(`${users},predicted,${predMean},${predP95},${predMax}`);
    }

    const csv = [header, ...rows].join('\n');
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `latency_prediction_${now}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

export default router;
