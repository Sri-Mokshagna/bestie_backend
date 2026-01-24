const fs = require('fs');

const content = fs.readFileSync('src/lib/cashfree.ts', 'utf8');

const oldCode = `        // Add VPA if it's a UPI transfer
        if (data.beneficiaryVpa && data.transferMode === 'upi') {
          payload.beneficiary_details.beneficiary_vpa = data.beneficiaryVpa;
        }`;

const newCode = `        // V2 requires VPA inside beneficiary_instrument_details for UPI transfers
        if (data.beneficiaryVpa && data.transferMode === 'upi') {
          payload.beneficiary_details.beneficiary_instrument_details = {
            vpa: data.beneficiaryVpa, // V2: vpa (not beneficiary_vpa)
          };
        }`;

const updated = content.replace(oldCode, newCode);

if (updated === content) {
    console.log('⚠️ NO MATCH - trying alternative');
    process.exit(1);
} else {
    fs.writeFileSync('src/lib/cashfree.ts', updated);
    console.log('✅ Fixed VPA nesting in beneficiary_instrument_details');
}
