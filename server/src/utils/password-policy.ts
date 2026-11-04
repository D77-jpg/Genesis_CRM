/**
 * Password policy for locally managed accounts.
 *
 * The login path intentionally does not enforce this policy: existing accounts
 * with legacy passwords must still be able to sign in and rotate them.
 * New accounts and password resets use this policy.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'admin',
  'admin123',
  'administrator',
  'welcome',
  'welcome1',
  'letmein',
  'changeme',
  'change-me',
  'qwerty',
  'qwerty123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  'abc123',
  'iloveyou',
  'genesis',
  'ironhue',
  'velaturo',
]);

/**
 * Return user-facing policy violations. An empty array means the password is
 * acceptable. Keep this list deterministic so the API and UI can agree.
 */
export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push(`密码最多 ${PASSWORD_MAX_LENGTH} 位`);
  }

  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    issues.push('密码过于常见，请使用不容易被猜到的密码');
  }
  if (/(.)\1{3,}/.test(password)) {
    issues.push('密码不能包含连续重复字符');
  }
  if (/(password|admin|qwerty|letmein|welcome)/i.test(password)) {
    issues.push('密码不能包含常见弱密码词');
  }

  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (categories < 3) {
    issues.push('密码需包含大小写字母、数字、符号中的至少三类');
  }

  return issues;
}

export function isValidPassword(password: string): boolean {
  return passwordPolicyIssues(password).length === 0;
}
