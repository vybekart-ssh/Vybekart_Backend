const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'assets');
const dest = path.join(__dirname, '..', 'dist', 'assets');

if (!fs.existsSync(src)) {
  console.warn('copy-invoice-assets: no assets/ folder — skipping');
  process.exit(0);
}

fs.cpSync(src, dest, { recursive: true });
console.log(`copy-invoice-assets: copied ${src} -> ${dest}`);
