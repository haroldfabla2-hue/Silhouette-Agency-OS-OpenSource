
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'test_write.txt');
fs.writeFileSync(file, 'Hello World');
console.log('Wrote to ' + file);
