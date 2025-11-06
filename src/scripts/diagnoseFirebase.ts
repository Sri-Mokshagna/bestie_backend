import 'dotenv/config';

/**
 * Diagnostic script to check Firebase configuration
 * Run: npx tsx src/scripts/diagnoseFirebase.ts
 */

console.log('🔍 Firebase Configuration Diagnostic\n');
console.log('=' .repeat(60));

// Check environment variables
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

console.log('\n1. Environment Variables Check:');
console.log('   FIREBASE_PROJECT_ID:', projectId ? '✅ Set' : '❌ Missing');
console.log('   FIREBASE_CLIENT_EMAIL:', clientEmail ? '✅ Set' : '❌ Missing');
console.log('   FIREBASE_PRIVATE_KEY:', privateKey ? '✅ Set' : '❌ Missing');

if (!projectId || !clientEmail || !privateKey) {
  console.log('\n❌ Missing required environment variables!');
  console.log('   Please set all three Firebase variables in your .env file');
  process.exit(1);
}

console.log('\n2. Private Key Format Check:');
console.log('   Length:', privateKey.length, 'characters');
console.log('   Has BEGIN marker:', privateKey.includes('BEGIN PRIVATE KEY') ? '✅' : '❌');
console.log('   Has END marker:', privateKey.includes('END PRIVATE KEY') ? '✅' : '❌');
console.log('   Has escaped newlines (\\n):', privateKey.includes('\\n') ? '✅' : '⚠️  (might be actual newlines)');

// Check for common issues
const issues: string[] = [];

if (!privateKey.includes('BEGIN PRIVATE KEY')) {
  issues.push('Missing BEGIN PRIVATE KEY marker');
}

if (!privateKey.includes('END PRIVATE KEY')) {
  issues.push('Missing END PRIVATE KEY marker');
}

if (privateKey.includes('\n') && !privateKey.includes('\\n')) {
  issues.push('Contains actual newlines instead of escaped \\n');
}

if (privateKey.trim().length < 1600) {
  issues.push('Private key seems too short (should be ~1700 characters)');
}

console.log('\n3. Issues Detected:');
if (issues.length === 0) {
  console.log('   ✅ No obvious issues detected');
} else {
  issues.forEach((issue, i) => {
    console.log(`   ${i + 1}. ❌ ${issue}`);
  });
}

console.log('\n4. Attempting Firebase Initialization:');
try {
  const admin = require('firebase-admin');
  
  let processedKey = privateKey.replace(/\\n/g, '\n');
  
  if (!processedKey.includes('BEGIN PRIVATE KEY')) {
    processedKey = `-----BEGIN PRIVATE KEY-----\n${processedKey}\n-----END PRIVATE KEY-----\n`;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      privateKey: processedKey,
      clientEmail,
    }),
  });

  console.log('   ✅ Firebase Admin SDK initialized successfully!');
  
  // Test creating a custom token
  console.log('\n5. Testing Custom Token Creation:');
  admin.auth().createCustomToken('test-user-id')
    .then(() => {
      console.log('   ✅ Custom token creation successful!');
      console.log('\n' + '='.repeat(60));
      console.log('✅ All checks passed! Firebase is configured correctly.');
      console.log('='.repeat(60));
      process.exit(0);
    })
    .catch((error: any) => {
      console.log('   ❌ Custom token creation failed!');
      console.log('   Error:', error.message);
      console.log('   Code:', error.code);
      console.log('\n' + '='.repeat(60));
      console.log('❌ Firebase configuration has issues.');
      console.log('='.repeat(60));
      process.exit(1);
    });

} catch (error: any) {
  console.log('   ❌ Firebase initialization failed!');
  console.log('   Error:', error.message);
  if (error.stack) {
    console.log('\n   Stack trace:');
    console.log('   ' + error.stack.split('\n').slice(0, 5).join('\n   '));
  }
  console.log('\n' + '='.repeat(60));
  console.log('❌ Firebase configuration has critical issues.');
  console.log('='.repeat(60));
  process.exit(1);
}
