// Run locally: node ops/generate-secrets.mjs. Paste into SERVER environment variables.
// Never upload this output to GitHub or share it in a chat/screenshot.
import {createECDH,randomBytes} from 'node:crypto';
const curve=createECDH('prime256v1');curve.generateKeys();
console.log('APP_ACCESS_PASSWORD='+randomBytes(24).toString('base64url'));
console.log('CRON_SECRET='+randomBytes(32).toString('base64url'));
console.log('VAPID_PUBLIC_KEY='+curve.getPublicKey().toString('base64url'));
console.log('VAPID_PRIVATE_KEY='+curve.getPrivateKey().toString('base64url'));
console.log('VAPID_SUBJECT=mailto:REPLACE_WITH_YOUR_WORK_EMAIL');
