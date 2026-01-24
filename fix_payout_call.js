const fs = require('fs');

// Read file
const content = fs.readFileSync('src/modules/responder/payout.controller.ts', 'utf8');

// Replace the requestPayout call
const oldCode = `          const payoutResponse = await cashfreeService.requestPayout({
            transferId,
            beneId,
            amount: payout.amountINR,
            transferMode: 'upi',
            remarks: \`Bestie payout - \${payout.coins} coins\`,
          });`;

const newCode = `          const payoutResponse = await cashfreeService.requestPayout({
            transferId,
            beneId,
            amount: payout.amountINR,
            transferMode: 'upi',
            remarks: \`Bestie payout - \${payout.coins} coins\`,
            // V2 API requires beneficiary details
            beneficiaryName: user.profile?.name || 'Responder',
            beneficiaryEmail: user.email || \`responder_\${responder._id}@bestie.app\`,
            beneficiaryPhone: user.phone || '9999999999',
            beneficiaryVpa: payout.upiId,
          });`;

const updated = content.replace(oldCode, newCode);

if (updated === content) {
    console.log('⚠️ NO MATCH FOUND - Code was not updated');
    process.exit(1);
} else {
    fs.writeFileSync('src/modules/responder/payout.controller.ts', updated);
    console.log('✅ Updated requestPayout call with beneficiary details');
}
