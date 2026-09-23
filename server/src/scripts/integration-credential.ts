/**
 * 集成服务凭证管理脚本（Integration API v1）
 * ------------------------------------------------------------------
 * 用法（在 server/ 目录下）：
 *   npm run integration:credential -- create --name "AutoForceAI 本地" \
 *       --project <projectId> [--project <projectId2>] \
 *       --scopes customers:upsert,outcomes:read,stats:read,quotations:read [--expires 2027-01-01]
 *   npm run integration:credential -- list
 *   npm run integration:credential -- rotate --id <credentialId>
 *   npm run integration:credential -- revoke --id <credentialId>
 *
 * 安全约定：原始 token 只在 create / rotate 时打印一次，请立即妥善保存。
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { createLogger } from '../config/logger';
import { INTEGRATION_SCOPES } from '../constants';
import { IntegrationCredential, Project } from '../models';
import {
  createCredential,
  revokeCredential,
  rotateCredential,
} from '../services/integration-credential.service';

const logger = createLogger('integration-credential');

interface ParsedArgs {
  command: string;
  options: Map<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = '', ...rest] = argv;
  const options = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  return { command, options };
}

function one(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.[0];
}

function many(args: ParsedArgs, key: string): string[] {
  return args.options.get(key) ?? [];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await connectDatabase();

  try {
    switch (args.command) {
      case 'create': {
        const name = one(args, 'name');
        const projects = many(args, 'project');
        const scopesRaw = one(args, 'scopes');
        if (!name) throw new Error('缺少 --name');
        if (projects.length === 0) throw new Error('缺少 --project <projectId>（可多次指定）');
        // 便捷写法：--project default 解析为系统默认项目
        const resolvedProjects = await Promise.all(
          projects.map(async (p) => {
            if (p !== 'default') return p;
            const def = await Project.findOne({ status: 'active' }).sort({ isDefault: -1, createdAt: 1 });
            if (!def) throw new Error('未找到任何启用项目，请先启动一次服务完成项目初始化');
            return String(def._id);
          }),
        );
        const scopes = scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [...INTEGRATION_SCOPES];
        const expiresRaw = one(args, 'expires');
        const { credential, token } = await createCredential({
          name,
          projectIds: resolvedProjects,
          scopes,
          expiresAt: expiresRaw ? new Date(expiresRaw) : null,
          note: one(args, 'note'),
        });
        logger.info('凭证已创建', {
          id: String(credential._id),
          name: credential.name,
          scopes: credential.scopes,
          projectIds: credential.projectIds.map(String),
        });
        // 刻意用 console.log：这是管理员唯一一次拿到 token 的机会
        console.log('\n==== 服务凭证 token（仅显示一次，请立即保存） ====');
        console.log(token);
        console.log('================================================\n');
        break;
      }
      case 'list': {
        const rows = await IntegrationCredential.find().sort({ createdAt: -1 });
        if (rows.length === 0) {
          console.log('（暂无集成凭证）');
          break;
        }
        const projects = await Project.find({ _id: { $in: rows.flatMap((r) => r.projectIds) } }).select('name');
        const projectName = new Map(projects.map((p) => [String(p._id), p.name]));
        for (const row of rows) {
          console.log(
            [
              `id=${String(row._id)}`,
              `name=${row.name}`,
              `status=${row.status}`,
              `token=${row.tokenPrefix}…`,
              `scopes=[${row.scopes.join(',')}]`,
              `projects=[${row.projectIds.map((id) => `${projectName.get(String(id)) ?? '?'}(${String(id)})`).join(',')}]`,
              `expiresAt=${row.expiresAt ? row.expiresAt.toISOString() : '-'}`,
              `lastUsedAt=${row.lastUsedAt ? row.lastUsedAt.toISOString() : '-'}`,
            ].join('  '),
          );
        }
        break;
      }
      case 'rotate': {
        const id = one(args, 'id');
        if (!id) throw new Error('缺少 --id <credentialId>');
        const { credential, token } = await rotateCredential(id);
        logger.info('凭证已轮换，旧 token 立即失效', { id: String(credential._id) });
        console.log('\n==== 新 token（仅显示一次，请立即保存） ====');
        console.log(token);
        console.log('==========================================\n');
        break;
      }
      case 'revoke': {
        const id = one(args, 'id');
        if (!id) throw new Error('缺少 --id <credentialId>');
        const credential = await revokeCredential(id);
        logger.info('凭证已撤销', { id: String(credential._id), name: credential.name });
        break;
      }
      default:
        console.log(
          '用法: npm run integration:credential -- <create|list|rotate|revoke> [options]\n' +
            '  create --name <名称> --project <projectId> [--scopes a,b,c] [--expires YYYY-MM-DD]\n' +
            '  list\n' +
            '  rotate --id <credentialId>\n' +
            '  revoke --id <credentialId>',
        );
        process.exitCode = args.command ? 1 : 0;
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  logger.error('执行失败', { message: (error as Error)?.message });
  process.exitCode = 1;
  void disconnectDatabase();
});
