// Node 24 on some Windows hosts can fail os.userInfo() with ENOMEM before
// TypeScript runners initialise. Provide a minimal process-local fallback so
// development and maintenance commands can still start normally.
const os = require('node:os');

const originalUserInfo = os.userInfo;
os.userInfo = (...args) => {
  try {
    return originalUserInfo(...args);
  } catch {
    return {
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || 'windows-user',
      homedir: process.env.USERPROFILE || process.cwd(),
      shell: null,
    };
  }
};
