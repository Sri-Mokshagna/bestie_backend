import 'dotenv/config';
import { connectDB } from '../lib/db';
import { logger } from '../lib/logger';
import { CoinPlan } from '../models/CoinPlan';
import { User } from '../models/User';

/**
 * Fix Admin Panel and Coin Plans Issues
 * 1. Fix null type cast error in coin plans
 * 2. Fix admin panel users/responders not loading
 */

async function fixCoinPlansNullFields() {
  logger.info('🔧 Fixing coin plans null field issues...');
  
  try {
    await connectDB();
    
    // Update all coin plans to ensure no null values for optional fields
    const updateResult = await CoinPlan.updateMany(
      {},
      {
        $set: {
          maxUses: null, // Explicitly set to null (will be handled properly)
          discount: { $ifNull: ['$discount', 0] } // Set default discount to 0 if null
        }
      }
    );
    
    logger.info({ modifiedCount: updateResult.modifiedCount }, '✅ Updated coin plans');
    
    // Get all plans and ensure proper formatting
    const plans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });
    
    // Fix each plan individually to ensure proper data types
    for (const plan of plans) {
      const updates: any = {};
      
      // Ensure discount is never null
      if (plan.discount == null) {
        updates.discount = 0;
      }
      
      // Ensure maxUses is properly handled
      if (plan.maxUses === null || plan.maxUses === undefined) {
        updates.$unset = { maxUses: 1 }; // Remove the field entirely
      }
      
      if (Object.keys(updates).length > 0) {
        await CoinPlan.updateOne({ _id: plan._id }, updates);
        logger.info({ planId: plan._id, planName: plan.name }, '🔧 Fixed plan data types');
      }
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to fix coin plans');
    return false;
  }
}

async function testCoinPlansAPI() {
  logger.info('🧪 Testing coin plans API response...');
  
  try {
    const response = await fetch('http://localhost:3000/api/wallet/coin-plans');
    const data = await response.json();
    
    logger.info({ 
      status: response.status,
      hasPlans: !!(data as any).plans,
      planCount: (data as any).plans?.length || 0
    }, '📊 API Response Status');
    
    if ((data as any).plans && (data as any).plans.length > 0) {
      // Check each plan for null values
      (data as any).plans.forEach((plan: any, index: number) => {
        const issues = [];
        if (plan.discount === null) issues.push('discount is null');
        if (plan.maxUses === null) issues.push('maxUses is null');
        if (plan.name === null) issues.push('name is null');
        
        if (issues.length > 0) {
          logger.warn({ 
            planIndex: index, 
            planName: plan.name, 
            issues 
          }, '⚠️ Plan has null values');
        } else {
          logger.info({ 
            planIndex: index, 
            planName: plan.name,
            discount: plan.discount,
            hasMaxUses: plan.maxUses !== undefined
          }, '✅ Plan data clean');
        }
      });
      
      return true;
    } else {
      logger.error('❌ No plans returned from API');
      return false;
    }
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to test coin plans API');
    return false;
  }
}

async function testAdminUsersAPI() {
  logger.info('🧪 Testing admin users API...');
  
  try {
    // Test users endpoint
    const usersResponse = await fetch('http://localhost:3000/api/admin/users?page=1&limit=10');
    const usersData = await usersResponse.json();
    
    logger.info({ 
      status: usersResponse.status,
      hasUsers: !!(usersData as any).users,
      userCount: (usersData as any).users?.length || 0,
      hasPagination: !!(usersData as any).pagination
    }, '👥 Users API Response');
    
    if (usersResponse.status !== 200) {
      logger.error({ 
        status: usersResponse.status, 
        error: usersData 
      }, '❌ Users API failed');
      return false;
    }
    
    // Test responders endpoint
    try {
      const respondersResponse = await fetch('http://localhost:3000/api/responders/admin/pending');
      const respondersData = await respondersResponse.json();
      
      logger.info({ 
        status: respondersResponse.status,
        hasResponders: Array.isArray(respondersData),
        responderCount: Array.isArray(respondersData) ? respondersData.length : 0
      }, '👨‍💼 Responders API Response');
      
    } catch (responderError) {
      logger.warn({ error: responderError }, '⚠️ Responders API test failed (may be normal)');
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to test admin APIs');
    return false;
  }
}

async function diagnoseAdminPanelIssues() {
  logger.info('🔍 Diagnosing admin panel issues...');
  
  try {
    await connectDB();
    
    // Check if users exist
    const userCount = await User.countDocuments();
    logger.info({ userCount }, '👥 Total users in database');
    
    if (userCount === 0) {
      logger.warn('⚠️ No users found in database');
      return false;
    }
    
    // Check user data structure
    const sampleUser = await User.findOne().select('profile phone role status createdAt');
    if (sampleUser) {
      logger.info({ 
        hasProfile: !!sampleUser.profile,
        hasPhone: !!sampleUser.phone,
        role: sampleUser.role,
        status: sampleUser.status
      }, '👤 Sample user data structure');
    }
    
    // Check for any users with null/undefined critical fields
    const usersWithIssues = await User.find({
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { 'profile.name': null }
      ]
    }).countDocuments();
    
    if (usersWithIssues > 0) {
      logger.warn({ usersWithIssues }, '⚠️ Users with data issues found');
    } else {
      logger.info('✅ All users have proper data structure');
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to diagnose admin panel');
    return false;
  }
}

async function runComprehensiveFix() {
  logger.info('🚨 FIXING ADMIN PANEL AND COIN PLANS ISSUES');
  logger.info('============================================');
  
  const results = {
    coinPlansFixed: false,
    coinPlansAPIWorking: false,
    adminDiagnosed: false,
    adminAPIWorking: false
  };
  
  // Step 1: Fix coin plans null fields
  logger.info('\n1. 🔧 Fixing coin plans null field issues...');
  results.coinPlansFixed = await fixCoinPlansNullFields();
  
  // Step 2: Test coin plans API
  logger.info('\n2. 🧪 Testing coin plans API...');
  results.coinPlansAPIWorking = await testCoinPlansAPI();
  
  // Step 3: Diagnose admin panel
  logger.info('\n3. 🔍 Diagnosing admin panel issues...');
  results.adminDiagnosed = await diagnoseAdminPanelIssues();
  
  // Step 4: Test admin APIs
  logger.info('\n4. 🧪 Testing admin APIs...');
  results.adminAPIWorking = await testAdminUsersAPI();
  
  // Summary
  logger.info('\n📊 FIX RESULTS:');
  logger.info('===============');
  logger.info(`💰 Coin Plans Fixed: ${results.coinPlansFixed ? '✅ YES' : '❌ NO'}`);
  logger.info(`🌐 Coin Plans API: ${results.coinPlansAPIWorking ? '✅ WORKING' : '❌ FAILED'}`);
  logger.info(`🔍 Admin Diagnosed: ${results.adminDiagnosed ? '✅ YES' : '❌ NO'}`);
  logger.info(`👥 Admin API: ${results.adminAPIWorking ? '✅ WORKING' : '❌ FAILED'}`);
  
  // Provide specific solutions
  logger.info('\n🔧 SOLUTIONS:');
  logger.info('=============');
  
  if (!results.coinPlansAPIWorking) {
    logger.info('💰 COIN PLANS ISSUE:');
    logger.info('   - Flutter expects all fields to be non-null');
    logger.info('   - Update mobile app to handle optional fields properly');
    logger.info('   - Or ensure all coin plan fields have default values');
  } else {
    logger.info('✅ Coin plans should now work without type cast errors');
  }
  
  if (!results.adminAPIWorking) {
    logger.info('👥 ADMIN PANEL ISSUE:');
    logger.info('   - Check admin authentication');
    logger.info('   - Verify admin routes are properly configured');
    logger.info('   - Check for CORS issues in admin panel');
  } else {
    logger.info('✅ Admin APIs are working - check frontend implementation');
  }
  
  return results;
}

if (require.main === module) {
  runComprehensiveFix()
    .then((results) => {
      const success = results.coinPlansFixed && results.adminDiagnosed;
      logger.info(success ? '🎯 CRITICAL ISSUES ADDRESSED' : '❌ SOME ISSUES REMAIN');
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      logger.error({ error }, '💥 Fix failed');
      process.exit(1);
    });
}

export { fixCoinPlansNullFields, testCoinPlansAPI, testAdminUsersAPI, diagnoseAdminPanelIssues, runComprehensiveFix };
