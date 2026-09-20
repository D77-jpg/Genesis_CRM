// Some Windows Node 24 hosts intermittently fail os.userInfo() with ENOMEM
// before tsx starts. Keep test tooling deterministic without affecting app code.
const os = require('node:os');
const original = os.userInfo;
os.userInfo = (...args) => {
  try { return original(...args); }
  catch { return { uid: -1, gid: -1, username: process.env.USERNAME || 'test', homedir: process.env.USERPROFILE || '', shell: null }; }
};
