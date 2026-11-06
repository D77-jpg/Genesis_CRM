// Test-only preload: never read server/.env or use real uploads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
require('../node_modules/dotenv').config=()=>({parsed:{}});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'globalcrm-isolated-'));process.env.UPLOAD_DIR=root;
process.on('exit',()=>{const t=path.resolve(root);if(path.dirname(t)===path.resolve(os.tmpdir())&&path.basename(t).startsWith('globalcrm-isolated-'))fs.rmSync(t,{recursive:true,force:true});});
