const fs = require('fs');

// Read the file
const content = fs.readFileSync('src/lib/cashfree.ts', 'utf8');
const lines = content.split('\n');

// Remove lines 208-274 (0-indexed: 207-273)
const newLines = [
    ...lines.slice(0, 207),
    ...lines.slice(274)
];

// Write back
fs.writeFileSync('src/lib/cashfree.ts', newLines.join('\n'));

console.log('✅ Deleted lines 208-274 (old OAuth methods)');
console.log('✅ V2 methods remain at new line positions');
