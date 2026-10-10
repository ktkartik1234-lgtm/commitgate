"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validate_ts_1 = require("./validate.js");
function runTests() {
    const validResult = (0, validate_ts_1.validateLogin)("dev@commitgate.local", "hunter222");
    const invalidResult = (0, validate_ts_1.validateLogin)("invalid-email", "short");
    if (validResult !== true || invalidResult !== false) {
        console.error("FAIL src/auth/validate.test.ts");
        console.error("  Expected: true");
        console.error(`  Received: ${String(validResult)}`);
        process.exit(1);
    }
    console.log("PASS src/auth/validate.test.ts");
    console.log("  ✓ validates login credentials (2ms)");
}
runTests();
