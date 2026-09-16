# AirDrop-Lite 点对点快传

一个可完全自托管的浏览器端文件快传工具。双方通过 6 位临时取件码配对，文件优先通过 WebRTC 点对点直传；直连失败时自动使用同一 Docker 容器内的 coturn 中继。项目不依赖 Cloudflare，文件也不会写入应用服务器、数据库或对象存储。

## 功能

- 6 位临时房间码、分享链接和本地生成二维码
- 接收方打开分享链接后自动连接并开始下载
- 32 KiB 分块传输和 DataChannel 背压控制
- 自动识别点对点直连或 TURN 中继
- 接收端 SHA-256 完整性校验，结果回传双方
- 等待房间 10 分钟过期，活动会话最长 2 小时
- 临时 TURN 凭据、角色令牌和按 IP 限流
- 单文件最大 100 MB

## 架构

```text
外部 HTTPS 反向代理
        │
        ▼
单个 Docker 容器
├── Node.js：React 静态站 + 房间 API + WebSocket 信令
└── coturn：STUN/TURN 中继

发送方浏览器 ═══ WebRTC DataChannel ═══ 接收方浏览器
                    │
              直连失败时经 coturn
```

Node 服务只转发 SDP/ICE 信令，不接收文件名、哈希或文件二进制。使用 TURN 时，coturn 转发 WebRTC 的 DTLS 加密流量，但服务器仍可观察连接元数据与流量大小。

房间和限流状态只保存在内存中。容器重启会清空所有临时房间，这符合当前临时传输语义；此部署模式不支持多个容器副本。

## Docker 部署

要求：一台具有固定公网 IPv4 的服务器、一个解析到该服务器的域名，以及 Docker Compose。网站应由 Nginx、Caddy、Traefik 或 NAS 反向代理提供 HTTPS；代理必须支持 WebSocket。

### 1. 配置

```bash
cp .env.docker.example .env
openssl rand -hex 32
```

编辑 `.env`：

```env
ALLOWED_ORIGINS=https://airdrop.example.com
TURN_HOST=airdrop.example.com
TURN_EXTERNAL_IP=203.0.113.10
TURN_SECRET=<上一步生成的随机值>
TURN_REALM=airdrop.example.com
```

- `ALLOWED_ORIGINS` 是浏览器访问网站时的完整 HTTPS origin；多个域名用逗号分隔。
- `TURN_HOST` 必须从公网客户端解析到部署机器。
- `TURN_EXTERNAL_IP` 必须是 Docker 宿主机的公网 IPv4。
- `TURN_SECRET` 至少 24 个字符，只在 Node 与 coturn 之间共享，浏览器只会收到两小时有效的临时凭据。

### 2. 开放端口

在云防火墙、安全组、宿主机防火墙和 NAT 路由器中开放或转发：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| `8080` | TCP | 网站/API，通常只允许反向代理访问 |
| `3478` | TCP + UDP | STUN/TURN |
| `49160-49200` | UDP | TURN relay 端口范围 |

若服务器位于 NAT 后，必须把上述 TURN 端口映射到 Docker 宿主机，并确保 `TURN_EXTERNAL_IP` 填写 NAT 的公网地址。

### 3. 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f airdrop-lite
```

反向代理将 `https://airdrop.example.com` 转发到 `http://127.0.0.1:8080`。需要保留原始 `Host`，并传递 `X-Forwarded-For`；常见反向代理的 WebSocket 配置同样适用于 `/api/rooms/*/ws`。

健康检查地址为 `GET /healthz`。它验证 Node 服务可用；实际部署后还应从外网不同网络各传输一次文件，确认页面显示“本站 TURN”时中继端口也可用。

## 本地开发

要求 Node.js 20 或更高。

```bash
npm install
cp .env.example .env.local
npm run dev:all
```

前端默认位于 `http://localhost:3000`，Node 信令服务位于 `http://localhost:8080`。本地未启动 coturn 时仍可测试房间、信令和可直连的 WebRTC 场景；完整 TURN 回退请使用 Docker 部署方式。

运行全部检查：

```bash
npm run check
docker build -t airdrop-lite:local .
```

## 安全与运行边界

- 默认按来源 IP 限制 10 分钟内创建 10 次、加入 30 次；连续 10 次无效房间码会封禁 1 小时。
- 启用外部反向代理时固定设置 `TRUST_PROXY=true`，不要让 8080 端口直接暴露给不受信任的客户端，否则其可伪造转发 IP。
- 默认 ICE policy 为 `all`，浏览器优先直连，失败后才选择 relay candidate。
- 房间码用于发现，192 位角色令牌用于 WebSocket 鉴权；持有分享链接即视为获得接收权限。
- 双方必须保持页面打开；刷新、长期进入后台或网络切换会终止会话。
- 当前版本没有断点续传、多文件、目录、一对多、离线下载或多实例扩容。

## 项目结构

```text
components/          二维码等前端组件
services/p2p/        API、WebRTC 会话、哈希与传输协议
server/src/          自托管房间 API、WebSocket 信令与 TURN 凭据
views/               发送与接收状态机
docker/              单容器进程入口
tests/               协议与信令单元/集成测试
```

## License

[MIT](LICENSE)
