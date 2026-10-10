import { validateLogin } from "./validate.ts";

function runTests(): void {
  const validResult = validateLogin("dev@commitgate.local", "hunter222");
  const invalidResult = validateLogin("invalid-email", "short");

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
