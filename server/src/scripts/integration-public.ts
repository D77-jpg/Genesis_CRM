/** Privileged operator CLI; never prints public payloads, storage keys or signed URLs. */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { IntegrationPublicResource, IntegrationRateLimit } from '../models/IntegrationPublicResource';
import { publishIntegrationResource, revokeIntegrationResource } from '../services/integration-publication.service';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf('--' + name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('Missing option');
    return args[index + 1];
  };
  await connectDatabase();
  try {
    if (command === 'indexes') {
      // createIndexes adds only the new collections' declared indexes, never drops old indexes.
      await IntegrationPublicResource.createIndexes();
      await IntegrationRateLimit.createIndexes();
    } else {
      const projectId = z.string().regex(/^[a-f\d]{24}$/i).parse(value('project'));
      const sourceId = z.string().regex(/^[a-f\d]{24}$/i).parse(value('source'));
      const kind = z.enum(['product', 'company', 'playbook', 'knowledge']).parse(value('kind'));
      if (command === 'publish') {
        if (!args.includes('--reviewed') || !args.includes('--file')) throw Error('Review and payload file required');
        const payload = JSON.parse(await readFile(value('file'), 'utf8'));
        await publishIntegrationResource({ projectId, sourceId, kind, payload, reviewed: true });
      } else if (command === 'revoke') await revokeIntegrationResource(projectId, kind, sourceId);
      else throw Error('Unknown command');
    }
    console.log('Integration public resource operation completed');
  } finally { await disconnectDatabase(); }
}
void main().catch(() => { console.error('Integration public resource operation failed; check command, source scope and reviewed payload'); process.exitCode = 1; });
