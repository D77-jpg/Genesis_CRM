// Only usable with this suite's disposable MongoMemoryServer database.
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/s1_isolated_fictional(?:\?|$)/.test(process.env.S1_TEST_URI || '')) throw Error('Isolated test URI required');
require('tsx/cjs');
const mongoose = require('mongoose');
const { processKnowledgeDocument } = require('../../../src/services/knowledge/document.service.ts');
mongoose.connect(process.env.S1_TEST_URI).then(() => processKnowledgeDocument(process.env.S1_TEST_JOB))
  .then(() => mongoose.disconnect()).catch(() => { process.exitCode = 1; });
