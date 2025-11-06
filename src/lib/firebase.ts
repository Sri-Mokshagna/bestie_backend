import admin from 'firebase-admin';
import { logger } from './logger';

export function initializeFirebase() {
  try {
    // Validate required environment variables
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Missing required Firebase environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY'
      );
    }

    // Handle different private key formats
    // 1. Replace escaped newlines with actual newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
    
    // 2. If the key doesn't have proper headers, add them
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----\n`;
    }

    // 3. Ensure proper line breaks (some environments might have issues)
    // Remove any extra whitespace and ensure consistent formatting
    privateKey = privateKey
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    // Add back the proper structure
    if (!privateKey.endsWith('\n')) {
      privateKey += '\n';
    }

    logger.info(
      `Initializing Firebase Admin SDK... (projectId: ${projectId}, privateKeyLength: ${privateKey.length})`
    );

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey,
        clientEmail,
      }),
    });

    logger.info('✅ Firebase Admin initialized successfully');
  } catch (error) {
    logger.error({ error }, '❌ Failed to initialize Firebase Admin');
    logger.error('Please check your Firebase environment variables:');
    logger.error('- FIREBASE_PROJECT_ID');
    logger.error('- FIREBASE_CLIENT_EMAIL');
    logger.error('- FIREBASE_PRIVATE_KEY (ensure it includes BEGIN/END markers)');
    throw error;
  }
}

export { admin };
