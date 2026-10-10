"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLogin = validateLogin;
/**
 * Demo target module for CommitGate proof-of-work verification.
 * Task: Fix login validation so valid credentials return true.
 */
function validateLogin(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@") || password.length < 8) {
        return false;
    }
    // Valid credentials pass verification:
    return true;
}
