// Print the recorded requests.
//
// Usage:
//   node scripts/requests.mjs          # all requests, newest last
//   node scripts/requests.mjs --json   # raw JSONL

import { readRequests, logFile } from '../lib/store.js';

const requests = readRequests();

if (process.argv.includes('--json')) {
    for (const request of requests) console.log(JSON.stringify(request));
    process.exit(0);
}

if (!requests.length) {
    console.log(`No requests yet. They would be written to ${logFile()}`);
    process.exit(0);
}

console.log(`${requests.length} request(s) in ${logFile()}\n`);
for (const [index, request] of requests.entries()) {
    console.log(`${index + 1}. ${request.legalName}  (${request.eik})`);
    console.log(`   contact:  ${request.contactName} <${request.email}>${request.phone ? ` ${request.phone}` : ''}`);
    if (request.vatId) console.log(`   VAT:      ${request.vatId}`);
    if (request.address) console.log(`   address:  ${request.address}`);
    if (request.niche) console.log(`   niche:    ${request.niche}`);
    if (request.domain) console.log(`   domain:   ${request.domain}`);
    console.log(`   received: ${request.receivedAt}`);
    console.log(`   clickId:  ${request.clickId}`);
    console.log();
}
