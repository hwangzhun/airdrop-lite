# AirDrop-Lite 点对点快传

一个浏览器端文件快传工具。双方通过 6 位临时取件码配对，文件优先通过 WebRTC 点对点直传；直连失败时使用 Cloudflare Realtime TURN 加密中继。网站和 API 通过 Cloudflare Tunnel 暴露，服务器无需开放入站端口或公开源站 IP。

## 功能

- 6 位临时房间码、分享链接和本地生成二维码
- 接收方打开分享链接后自动连接并开始下载
- 32 KiB 分块传输和 DataChannel 背压控制
- 自动识别点对点直连或 Cloudflare TURN 中继
- 接收端 SHA-256 完整性校验，结果回传双方
- 等待房间 10 分钟过期，活动会话最长 2 小时
- Cloudflare 短期 TURN 凭据、角色令牌和按 IP 限流
- 单文件最大 100 MB

## 架构

```text
浏览器
  │ HTTPS / WebSocket
  ▼
Cloudflare 边缘
  │ Cloudflare Tunnel（纯出站连接）
  ▼
Docker Compose
├── cloudflared
└── Go：React 静态站 + 房间 API + WebSocket 信令

发送方浏览器 ═══ WebRTC DataChannel ═══ 接收方浏览器
                    │
             直连失败时经
          Cloudflare Realtime TURN
```

Node.js 只用于本地前端开发和 Docker 的 React 构建阶段；生产运行镜像不包含 Node.js、coturn 或 cloudflared。cloudflared 作为独立 Compose 服务运行。

Go 服务只转发 SDP/ICE 信令，不接收文件名、哈希或文件二进制。Cloudflare TURN 会转发 WebRTC 的 DTLS 加密流量，但 Cloudflare 仍可观察连接元数据和流量大小。

房间和限流状态只保存在内存中；容器重启会清空所有临时房间，且当前不支持多个应用副本。

## Cloudflare 配置

需要一个接入 Cloudflare 的域名、Cloudflare Tunnel、Cloudflare Realtime TURN Key 和 Docker Compose。

### 1. 创建 Tunnel

1. 在 Cloudflare Dashboard 进入 **Networking > Tunnels**，创建远程管理 Tunnel。
2. 复制 Docker 安装命令中 `eyJ...` 开头的 Tunnel Token。
3. 为 Tunnel 添加 Published application：
   - Hostname：`airdrop.example.com`
   - Service type：`HTTP`
   - URL：`airdrop-lite:8080`

`airdrop-lite` 是 Compose 内部服务名，不要填 `localhost`。

### 2. 创建 Realtime TURN Key

在 Cloudflare Dashboard 创建 TURN Key，保存 Key ID 和 API Token。Key 本身不能发给浏览器；Go 服务会通过 Cloudflare API 为每次创建/加入房间生成默认 2 小时有效的短期凭据。

### 3. 配置环境变量

```bash
cp .env.docker.example .env
```

编辑 `.env`：

```env
ALLOWED_ORIGINS=https://airdrop.example.com
CLOUDFLARE_TUNNEL_TOKEN=<Tunnel Token>
CLOUDFLARE_TURN_KEY_ID=<TURN Key ID>
CLOUDFLARE_TURN_API_TOKEN=<TURN API Token>
CLOUDFLARE_TURN_TTL=7200
```

这些 Token 只能保存在服务端，不要提交 `.env` 或将 Token 放入前端环境变量。

### 4. 防火墙

不需要开放任何入站端口。宿主机只需能出站访问 Cloudflare：

- TCP `443`：Cloudflare TURN 凭据 API 和普通 HTTPS
- TCP/UDP `7844`：cloudflared 的 HTTP/2/QUIC Tunnel 连接

### 5. 启动

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f
```

Compose 默认拉取 `hwangzhun/airdrop-lite:v0.0.1-beta.2` 和 `cloudflare/cloudflared:latest`。应用容器只在 Compose 内部暴露 8080，宿主机不发布任何端口。

部署后访问 `https://airdrop.example.com/healthz`，应返回 `{"ok":true}`。还应从两个不同网络传输文件，确认直连和 Cloudflare TURN 回退均可用。

## 本地开发

要求 Node.js 22 或更高、Go 1.26 或更高。

```bash
npm install
cp .env.example .env.local
npm run dev:all
```

前端默认位于 `http://localhost:3000`，Go 信令服务位于 `http://localhost:8080`。本地未配置 Cloudflare TURN Key 时会仅返回 Cloudflare STUN，可测试房间、信令和可直连的 WebRTC 场景。

运行全部检查：

```bash
npm run check
docker build -t airdrop-lite:local .
```

## 安全与运行边界

- 生产模式缺少 Cloudflare TURN Key ID 或 API Token 时，Go 服务会拒绝启动。
- 默认按 Cloudflare Tunnel 传递的来源 IP 限制 10 分钟内创建 10 次、加入 30 次；连续 10 次无效房间码会封禁 1 小时。
- 应用端口只在 Compose 内部可达，`TRUST_PROXY=true` 仅用于信任 cloudflared 传递的 `X-Forwarded-For`。
- 默认 ICE policy 为 `all`，浏览器优先直连，失败后才选择 relay candidate。
- 房间码用于发现，192 位角色令牌用于 WebSocket 鉴权；持有分享链接即视为获得接收权限。
- 双方必须保持页面打开；刷新、长期进入后台或网络切换会终止会话。
- 当前版本没有断点续传、多文件、目录、一对多、离线下载或多实例扩容。

## 项目结构

```text
components/          二维码等前端组件
services/p2p/        API、WebRTC 会话、哈希与传输协议
server/              Go 房间 API、WebSocket 信令与 Cloudflare TURN 凭据
views/               发送与接收状态机
tests/               前端传输工具测试
```

## License

[MIT](LICENSE)
