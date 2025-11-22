import 'dotenv/config';
import { connectDB } from '../lib/db';
import { logger } from '../lib/logger';
import { User } from '../models/User';
import { CoinPlan } from '../models/CoinPlan';
import { Responder } from '../models/Responder';

/**
 * Fix Flutter Null Type Casting Issues
 * 
 * Flutter Error: "type 'Null' is not a subtype of type 'String' in type cast"
 * 
 * Issues:
 * 1. /api/admin/users - Users have null fields
 * 2. /api/admin/responders - Responders have null fields  
 * 3. /api/wallet/coin-plans - Coin plans have null fields
 */

async function analyzeUserDataStructure() {
  logger.info('🔍 Analyzing user data structure for null fields...');
  
  try {
    await connectDB();
    
    // Get sample users to check data structure
    const users = await User.find().limit(5).select('profile phone role status createdAt');
    
    logger.info({ totalUsers: users.length }, '👥 Sample users found');
    
    for (const user of users) {
      const issues = [];
      
      // Check for null/undefined fields that Flutter expects as strings
      if (!user.profile?.name) issues.push('profile.name is null/undefined');
      if (!user.phone) issues.push('phone is null/undefined');
      if (!user.role) issues.push('role is null/undefined');
      if (!user.status) issues.push('status is null/undefined');
      
      if (issues.length > 0) {
        logger.warn({ 
          userId: user._id, 
          phone: user.phone,
          issues 
        }, '⚠️ User has null fields');
      } else {
        logger.info({ 
          userId: user._id, 
          phone: user.phone,
          hasProfile: !!user.profile?.name
        }, '✅ User data clean');
      }
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to analyze user data');
    return false;
  }
}

async function analyzeResponderDataStructure() {
  logger.info('🔍 Analyzing responder data structure...');
  
  try {
    // Get sample responders
    const responders = await Responder.find().limit(5);
    
    logger.info({ totalResponders: responders.length }, '👨‍💼 Sample responders found');
    
    for (const responder of responders) {
      const issues = [];
      
      // Check for null fields that might cause Flutter issues
      if (!responder.userId) issues.push('userId is null');
      if (!responder.kycStatus) issues.push('kycStatus is null');
      if (!responder.createdAt) issues.push('createdAt is null');
      
      if (issues.length > 0) {
        logger.warn({ 
          responderId: responder._id,
          issues 
        }, '⚠️ Responder has null fields');
      } else {
        logger.info({ 
          responderId: responder._id,
          kycStatus: responder.kycStatus
        }, '✅ Responder data clean');
      }
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to analyze responder data');
    return false;
  }
}

async function fixAllNullFields() {
  logger.info('🔧 Fixing all null fields that cause Flutter issues...');
  
  try {
    await connectDB();
    
    // Fix Users with null profile names
    const usersFixed = await User.updateMany(
      {
        $or: [
          { 'profile.name': { $exists: false } },
          { 'profile.name': null },
          { 'profile.name': '' }
        ]
      },
      [
        {
          $set: {
            'profile.name': {
              $concat: ['User ', { $substr: ['$phone', -4, 4] }]
            }
          }
        }
      ]
    );
    
    logger.info({ modifiedCount: usersFixed.modifiedCount }, '✅ Fixed users with null names');
    
    // Fix Users with null phones (set to empty string)
    const phoneFixed = await User.updateMany(
      { phone: null },
      { $set: { phone: '' } }
    );
    
    logger.info({ modifiedCount: phoneFixed.modifiedCount }, '✅ Fixed users with null phones');
    
    // Fix Coin Plans with null fields
    const coinPlansFixed = await CoinPlan.updateMany(
      {},
      [
        {
          $set: {
            discount: { $ifNull: ['$discount', 0] },
            name: { $ifNull: ['$name', 'Unknown Plan'] },
            // Remove maxUses field if null to avoid Flutter issues
            maxUses: {
              $cond: {
                if: { $eq: ['$maxUses', null] },
                then: '$$REMOVE',
                else: '$maxUses'
              }
            }
          }
        }
      ]
    );
    
    logger.info({ modifiedCount: coinPlansFixed.modifiedCount }, '✅ Fixed coin plans with null fields');
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to fix null fields');
    return false;
  }
}

async function testAPIsForNullValues() {
  logger.info('🧪 Testing APIs for null values that cause Flutter issues...');
  
  try {
    // Test coin plans API
    logger.info('Testing /api/wallet/coin-plans...');
    const coinPlansResponse = await fetch('http://localhost:3000/api/wallet/coin-plans');
    const coinPlansData = await coinPlansResponse.json();
    
    if ((coinPlansData as any).plans) {
      (coinPlansData as any).plans.forEach((plan: any, index: number) => {
        const nullFields = [];
        Object.keys(plan).forEach(key => {
          if (plan[key] === null) nullFields.push(key);
        });
        
        if (nullFields.length > 0) {
          logger.warn({ 
            planIndex: index, 
            planName: plan.name, 
            nullFields 
          }, '⚠️ Coin plan has null fields');
        } else {
          logger.info({ 
            planIndex: index, 
            planName: plan.name 
          }, '✅ Coin plan clean');
        }
      });
    }
    
    // Test admin users API (without auth for structure check)
    logger.info('Testing /api/admin/users structure...');
    const usersResponse = await fetch('http://localhost:3000/api/admin/users');
    
    if (usersResponse.status === 401) {
      logger.info('✅ Admin users API requires authentication (expected)');
    } else if (usersResponse.status === 200) {
      const usersData = await usersResponse.json();
      logger.info({ 
        hasUsers: !!(usersData as any).users,
        userCount: (usersData as any).users?.length || 0
      }, '📊 Admin users API response');
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to test APIs');
    return false;
  }
}

async function generateFlutterFixes() {
  logger.info('📱 Generating Flutter model fixes...');
  
  logger.info('\n🔧 FLUTTER FIXES NEEDED:');
  logger.info('========================');
  
  logger.info('\n1. 💰 COIN PLAN MODEL FIX:');
  logger.info('File: lib/models/coin_plan.dart');
  logger.info('```dart');
  logger.info('class CoinPlan {');
  logger.info('  final String id;');
  logger.info('  final String name;');
  logger.info('  final int priceINR;');
  logger.info('  final int coins;');
  logger.info('  final List<String> tags;');
  logger.info('  final int? maxUses;  // Nullable');
  logger.info('  final int discount;');
  logger.info('  final bool isActive;');
  logger.info('');
  logger.info('  factory CoinPlan.fromJson(Map<String, dynamic> json) {');
  logger.info('    return CoinPlan(');
  logger.info('      id: json[\'_id\'] ?? \'\',');
  logger.info('      name: json[\'name\'] ?? \'Unknown Plan\',');
  logger.info('      priceINR: json[\'priceINR\'] ?? 0,');
  logger.info('      coins: json[\'coins\'] ?? 0,');
  logger.info('      tags: List<String>.from(json[\'tags\'] ?? []),');
  logger.info('      maxUses: json[\'maxUses\'], // Allow null');
  logger.info('      discount: json[\'discount\'] ?? 0,');
  logger.info('      isActive: json[\'isActive\'] ?? true,');
  logger.info('    );');
  logger.info('  }');
  logger.info('}');
  logger.info('```');
  
  logger.info('\n2. 👥 USER MODEL FIX:');
  logger.info('File: lib/models/user.dart');
  logger.info('```dart');
  logger.info('class User {');
  logger.info('  final String id;');
  logger.info('  final String phone;');
  logger.info('  final UserProfile profile;');
  logger.info('  final String role;');
  logger.info('  final String status;');
  logger.info('');
  logger.info('  factory User.fromJson(Map<String, dynamic> json) {');
  logger.info('    return User(');
  logger.info('      id: json[\'_id\'] ?? \'\',');
  logger.info('      phone: json[\'phone\'] ?? \'\',');
  logger.info('      profile: UserProfile.fromJson(json[\'profile\'] ?? {}),');
  logger.info('      role: json[\'role\'] ?? \'user\',');
  logger.info('      status: json[\'status\'] ?? \'active\',');
  logger.info('    );');
  logger.info('  }');
  logger.info('}');
  logger.info('');
  logger.info('class UserProfile {');
  logger.info('  final String name;');
  logger.info('  final String? avatar;');
  logger.info('  final int? age;');
  logger.info('');
  logger.info('  factory UserProfile.fromJson(Map<String, dynamic> json) {');
  logger.info('    return UserProfile(');
  logger.info('      name: json[\'name\'] ?? \'Unknown User\',');
  logger.info('      avatar: json[\'avatar\'],');
  logger.info('      age: json[\'age\'],');
  logger.info('    );');
  logger.info('  }');
  logger.info('}');
  logger.info('```');
  
  logger.info('\n3. 👨‍💼 RESPONDER MODEL FIX:');
  logger.info('File: lib/models/responder.dart');
  logger.info('```dart');
  logger.info('class Responder {');
  logger.info('  final String id;');
  logger.info('  final String userId;');
  logger.info('  final KycStatus kycStatus;');
  logger.info('  final bool isOnline;');
  logger.info('  final double rating;');
  logger.info('  final DateTime createdAt;');
  logger.info('');
  logger.info('  factory Responder.fromJson(Map<String, dynamic> json) {');
  logger.info('    return Responder(');
  logger.info('      id: json[\'_id\'] ?? \'\',');
  logger.info('      userId: json[\'userId\'] ?? \'\',');
  logger.info('      kycStatus: _parseKycStatus(json[\'kycStatus\']),');
  logger.info('      isOnline: json[\'isOnline\'] ?? false,');
  logger.info('      rating: (json[\'rating\'] ?? 0).toDouble(),');
  logger.info('      createdAt: DateTime.tryParse(json[\'createdAt\'] ?? \'\') ?? DateTime.now(),');
  logger.info('    );');
  logger.info('  }');
  logger.info('}');
  logger.info('```');
}

async function runCompleteFix() {
  logger.info('🚨 FIXING FLUTTER NULL TYPE CASTING ISSUES');
  logger.info('==========================================');
  
  const results = {
    userAnalyzed: false,
    responderAnalyzed: false,
    nullFieldsFixed: false,
    apisTestedClean: false
  };
  
  // Step 1: Analyze current data structure
  logger.info('\n1. 🔍 Analyzing user data structure...');
  results.userAnalyzed = await analyzeUserDataStructure();
  
  logger.info('\n2. 🔍 Analyzing responder data structure...');
  results.responderAnalyzed = await analyzeResponderDataStructure();
  
  // Step 2: Fix all null fields
  logger.info('\n3. 🔧 Fixing all null fields...');
  results.nullFieldsFixed = await fixAllNullFields();
  
  // Step 3: Test APIs for remaining null values
  logger.info('\n4. 🧪 Testing APIs for null values...');
  results.apisTestedClean = await testAPIsForNullValues();
  
  // Step 4: Generate Flutter fixes
  logger.info('\n5. 📱 Generating Flutter model fixes...');
  await generateFlutterFixes();
  
  // Summary
  logger.info('\n📊 FIX RESULTS:');
  logger.info('===============');
  logger.info(`🔍 User Analysis: ${results.userAnalyzed ? '✅ DONE' : '❌ FAILED'}`);
  logger.info(`👨‍💼 Responder Analysis: ${results.responderAnalyzed ? '✅ DONE' : '❌ FAILED'}`);
  logger.info(`🔧 Null Fields Fixed: ${results.nullFieldsFixed ? '✅ DONE' : '❌ FAILED'}`);
  logger.info(`🧪 APIs Tested: ${results.apisTestedClean ? '✅ DONE' : '❌ FAILED'}`);
  
  logger.info('\n🎯 NEXT STEPS:');
  logger.info('==============');
  logger.info('1. 📱 Update Flutter models with null-safe code above');
  logger.info('2. 🧪 Test coin plans in mobile app');
  logger.info('3. 👥 Test admin panel users/responders tabs');
  logger.info('4. 🔄 Restart Flutter app to clear any cached data');
  
  return results;
}

if (require.main === module) {
  runCompleteFix()
    .then((results) => {
      const success = results.nullFieldsFixed;
      logger.info(success ? '🎯 BACKEND FIXES APPLIED' : '❌ SOME FIXES FAILED');
      logger.info('📱 FLUTTER MODEL UPDATES NEEDED');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, '💥 Fix failed');
      process.exit(1);
    });
}

export { analyzeUserDataStructure, analyzeResponderDataStructure, fixAllNullFields, testAPIsForNullValues, generateFlutterFixes, runCompleteFix };
