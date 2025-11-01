import admin from 'firebase-admin';
import { logger } from './logger';

export function initializeFirebase() {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });

    logger.info('Firebase Admin initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Firebase Admin');
    throw error;
  }
}

export { admin };
