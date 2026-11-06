# C5 OAuth / OIDC 部署与验证

本功能是 CRM 身份提供端。GlobalSite 按同目录 integration-v1.openapi.yaml 实现服务端客户端后，才能提供登录入口。产品同步、询盘推送继续使用 C2 服务凭证；不要把两类密钥混用。

## 部署顺序

1. 使用 Node >=22.12；CI 与现有 server Dockerfile 使用 Node 22。Mongo 必须支持事务（副本集或支持事务的集群）。
2. 通过现有迁移入口部署迁移 011：在本仓执行 npm --prefix server run migrate。由部署人员使用其既有安全环境注入配置；本文和本次开发不读取或改写 server/.env。迁移仅建新 OAuth 模型索引，不重命名已有集合。
3. 准备专用 RSA keyring，建议 3072 位。文件格式为 JWKS 的 keys 数组：当前 kid 对应私钥 JWK，旧 kid 可保留公钥 JWK；alg=RS256、use=sig。使用受控密钥管理工具生成，私钥挂载为只读 secret，不放 git、日志或截图。
4. 配置示例文件中的 OIDC_ENABLED、OIDC_ISSUER、OIDC_PUBLIC_WEB_ORIGIN、OIDC_SIGNING_KEYRING_PATH、OIDC_ACTIVE_KEY_ID。OIDC_ISSUER 是公开 CRM origin + /oidc；OIDC_PUBLIC_WEB_ORIGIN 是授权页 origin。生产必须 HTTPS，OIDC_ALLOW_LOOPBACK=false。
5. 先部署并保持 OIDC_ENABLED=false。确认迁移和代理后再启用；密钥/索引/事务能力不足时新端点返回 503，原 CRM 登录与 Integration API 保持可用。
6. 平台管理员重新登录（若启用邮件两步验证，则完成验证码），进入“登录应用登记”登记官方 GlobalSite：每环境独立 clientId/secret，精确同主机回调与最小允许 scope。secret 只显示一次，保存到本站服务端的安全配置；关闭后无法找回，可轮换。
7. 使用同一公开 origin 检查 /oidc/.well-known/openid-configuration 与 /oidc/jwks。确认实际 issuer、所有端点、S256、RS256、pairwise。JWKS 不含私钥。测试客户端以授权码 + PKCE 验收后再上线本站登录入口。

部署人员须把私钥路径挂载到 server 容器；compose.yaml 仅传递可选配置，不自动创建或复制密钥。按现有部署方式提供 secret bind mount 或 secret manager。Worker 不需签发 OIDC 令牌，不需要访问签名私钥。

## 代理与日志

- 本仓 web/nginx.conf 已补 /oidc 路由；Vite dev/preview 也代理 /oidc。授权页禁缓存且 no-referrer。
- 生产 TLS 入口必须覆盖调用者的 X-Forwarded-For / X-Forwarded-Proto，后端不能直接暴露给不可信网络。既有 Node 只信任一跳代理。
- **现有 web 容器在 8080 提供 HTTP，并把自身 $scheme 传给后端。若 TLS 在外层终止，外层应把 /oidc/ 直接代理给同网络内 CRM server:5000，并设置可信的 https 转发协议；或由运维配置经过审查的可信代理链。** 不得把任意客户端传来的 X-Forwarded-Proto 当作 HTTPS。否则安全 Cookie 会拒绝签发，表现为 OAuth 不可用。
- TLS 入口对 /oidc/、/oauth/authorize、/api/auth/oauth/ 禁止完整 URL/query 与请求头/body 日志；对 /api/oauth/clients 禁止 body 日志。关闭 APM/错误采样中的 Authorization、Cookie、code、state、nonce、verifier、secret、token。所有层都必须执行，不能只改应用日志。
- 登录客户端回调也须 no-store / no-referrer；回调后立即清理 code/state URL，不加载第三方脚本。

## 本地开发

仅开发/测试可 OIDC_ALLOW_LOOPBACK=true，使用精确 127.0.0.1 或 [::1]，不开放任意内网。推荐从 Vite 的单一 origin 访问，例如：

- OIDC_ISSUER=http://127.0.0.1:5173/oidc
- OIDC_PUBLIC_WEB_ORIGIN=http://127.0.0.1:5173
- 既有 CORS_ORIGIN 包含 http://127.0.0.1:5173。
- 本机 API 默认在 5000；Vite 把 /api 和 /oidc 转发给它。C5 私有代理保留实际 Origin，用于 CSRF 校验。
- 注册客户端回调必须是开发客户端的精确地址与端口；生产客户端不共享这些地址或密钥。

## 使用方规则

GlobalSite 登录入口另做，本仓提供模拟服务端客户端与真实浏览器测试。

- 必须从服务端发起交换，scope 至少 openid，默认 profile crm.context；email 可选。
- 如申请 offline_access，授权请求必须含 prompt=consent。用户仍需单独勾选“保持登录”；不勾选会明确记为拒绝，不签发 refresh token，也不会循环索要权限。
- 每次新登录都显示确认页，显式选择项目；原 CRM 登录证据在 10 分钟以内可复用，过期重新走既有密码/邮件 OTP。协议自己的 Cookie 不充当另一套登录凭证。
- 每次使用单独随机 state/nonce/verifier，S256；验证 callback issuer、ID Token 签名/issuer/audience/nonce/时效与 userinfo.sub。
- 不按邮箱自动绑定，不继承 CRM 管理权限，不自动加入已有本站组织。
- refresh 串行轮换；未知结果重新登录。旧令牌重用会撤销整个本次登录 family。
- 本站外部登录会话每次受保护请求在线检查 userinfo；无刷新授权时 access token 到期重新登录。CRM 网络故障暂停此登录通道，不能当作仍然有效。
- 撤销只影响身份登录；C2 服务凭证、本站独立账号与已同步业务数据另行管理。

## 运维与测试

个人“已授权应用”页按用户/组织隔离，viewer 也可撤销自己的授权；不能撤销别人。管理员可停用/调整应用或轮换 secret（UI 默认旧密钥立即失效；API 可选择最长 24 小时宽限）。安全配置/项目/组织变化均在 code、refresh、userinfo 在线复查。

限流采用现有每 IP 边界加新增 Mongo OAuthRateBucket 共享计数：授权每 IP 30/分钟、每客户端 300；token 每 IP 60、每客户端 120；userinfo 每 IP 300、每客户端+用户 300。未知客户端仍受进程级 IP 边界限制。新私有管理路由每 IP 20/分钟。多副本共用数据库计数，不需要新增 Redis 服务。429 带 Retry-After。独立业务 API 的限流与行为不变。

测试命令（CRM 根目录）：

- npm run typecheck / npm run build / npm run lint
- npm --prefix server run test:oauth
- npm --prefix server run test:oauth-ui（先构建 web，需要 Playwright Chromium）
- npm --prefix server run test:integration / test:security / test:health / test:p3
- node scripts/check-integration-contract.cjs
- npm --prefix server audit --omit=dev --audit-level=high

测试使用隔离虚构账户、临时签名 keyring 和 Mongo 副本集；不读取真实 server/.env、server/uploads。截图仅在一次性 secret 弹窗关闭后进行。安全测试不输出 secret/code/token；UI 测试的回调也仅使用显式开发 loopback，不访问第三方系统。

清理依赖 Mongo TTL。已消费 code/refresh 摘要保留到 family 绝对到期+7天；短期 access 记录同样保守保留用于 family 撤销与诊断。AuditLog 沿用现有审计保留策略，建议部署端至少保留 180 天；不会自动删除历史审计或用户资料。

上线前仍需提供正式 issuer、本站回调地址和安全挂载的 keyring。这些是部署配置，不是将真实密钥提交到仓库的要求。
