// Isolated demo: temporary CRM database/storage, fictional accounts only.
import express from 'express';
import { join } from 'node:path';
import { inquiryFixture } from './fixtures/integration-inquiry';
async function main() {
    const f = await inquiryFixture(), port = Number(process.env.J1_CRM_PORT ?? 5091), origin = 'http://127.0.0.1:' + port;
    const env = (await import('../src/config/env')).default;
    env.corsOrigins.push(origin);
    const host = express();
    host.use((req, res, next) => req.path.startsWith('/api/') ? f.app(req, res, next) : next());
    host.use(express.static(join(__dirname, '../../web/dist')));
    host.get('*', (_req, res) => res.sendFile(join(__dirname, '../../web/dist/index.html')));
    const server = host.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'j1_crm_fixture_ready', url: origin, projectId: String(f.project._id) })));
    const worker = await import('../src/services/integration-inquiry-worker.service');
    worker.startInquiryAttachmentWorker();
    const stop = async () => { worker.stopInquiryAttachmentWorker(); await new Promise<void>(r => server.close(() => r())); await f.cleanup(); process.exit(0); };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
}
void main().catch(() => { console.error('J1 CRM fixture failed'); process.exit(1); });
