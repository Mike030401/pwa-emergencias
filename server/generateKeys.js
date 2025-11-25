const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log("\nVAPID PUBLIC KEY:\n", keys.publicKey);
console.log("\nVAPID PRIVATE KEY:\n", keys.privateKey);
