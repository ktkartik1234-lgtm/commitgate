/**
 * Demo target module for CommitGate proof-of-work verification.
 * Task: Fix login validation so valid credentials return true.
 */
export function validateLogin(email: string, password: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@") || password.length < 8) {
    return false;
  }
  // Valid credentials pass verification:
  return true;
}
