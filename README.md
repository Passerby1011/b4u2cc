# cc-proxy

[![Deno](https://img.shields.io/badge/deno-v2.0+-00ADD8?logo=deno)](https://deno.land/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 Deno 的智能 AI 代理服务器，让不支持工具调用的 AI 模型也能完美支持 Claude Code。

## 🎯 核心功能

**cc-proxy** 通过"提示词注入 + XML 标签模拟"机制，将 Claude API 的工具调用能力赋予任何支持文本补全的 AI 模型：

- ✅ **工具调用模拟** - 将工具定义转换为 XML 格式提示词，让模型输出结构化工具调用
- ✅ **多协议支持** - 支持 OpenAI 和 Anthropic 两种上游协议，自动适配转换
- ✅ **思考模式** - 完美支持思维链（Thinking）模式，提升推理质量
- ✅ **多渠道路由** - 使用 `渠道名+模型名` 格式，灵活切换不同的上游服务
- ✅ **流式响应** - 完整的 SSE 流式处理，实时返回结果
- ✅ **Token 计数** - 精确的 tiktoken 本地计数，支持 Claude API 集成

## 🚀 快速开始

### 环境要求

- **Deno**: 2.0.0+ ([安装指南](https://deno.land/manual/getting_started/installation))
- **Docker** (可选): 用于容器化部署

### 方式一：Docker Compose（推荐）

1. **克隆项目**

```bash
git clone https://github.com/Passerby1011/cc-proxy.git
cd cc-proxy
```

2. **配置环境变量**

编辑 `docker-compose.yml` 文件，修改以下配置：

```yaml
environment:
  # 上游 API 配置
  UPSTREAM_BASE_URL: https://api.openai.com/v1/chat/completions
  UPSTREAM_API_KEY: sk-your-upstream-key-here

  # 客户端访问密钥（用于验证客户端请求）
  CLIENT_API_KEY: your-client-key-here

  # API Key 透传（设置为 true 使用客户端传入的 Key）
  PASSTHROUGH_API_KEY: "false"

  # 可选：多渠道配置
  # CHANNEL_1_NAME: openai
  # CHANNEL_1_BASE_URL: https://api.openai.com/v1/chat/completions
  # CHANNEL_1_API_KEY: sk-xxx
```

3. **启动服务**

```bash
docker-compose up -d

# 查看日志
docker-compose logs -f
```

4. **测试服务**

```bash
# 健康检查
curl http://localhost:3456/healthz

# 测试工具调用
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-client-key-here" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "tools": [{"name": "calculate", "description": "Perform calculation", "input_schema": {"type": "object", "properties": {"expr": {"type": "string"}}}}],
    "max_tokens": 1024
  }'
```

### 方式二：本地运行

1. **克隆项目**

```bash
git clone https://github.com/Passerby1011/cc-proxy.git
cd cc-proxy/deno-proxy
```

2. **配置环境变量**

```bash
# 基础配置
export UPSTREAM_BASE_URL=https://api.openai.com/v1/chat/completions
export UPSTREAM_API_KEY=sk-your-key-here
export PORT=3456

# 可选：渠道配置
export CHANNEL_1_NAME=openai
export CHANNEL_1_BASE_URL=https://api.openai.com/v1/chat/completions
export CHANNEL_1_API_KEY=sk-xxx
export CHANNEL_1_PROTOCOL=openai
```

3. **启动服务**

```bash
deno run --allow-net --allow-env --allow-read=. --allow-write=logs src/main.ts
```

### 方式三：Deno Deploy

一键部署到 Deno Deploy 云平台：

```bash
# 安装 deployctl
deno install -gArf jsr:@deno/deployctl

# 登录
deployctl login

# 部署
deployctl deploy --project=cc-proxy deno-proxy/src/main.ts
```

详细步骤请参考 [Deno Deploy 部署指南](docs/deno-deployment-guide.md)。

## ⚙️ 配置说明

### 渠道配置（推荐方式）

使用渠道配置可以同时管理多个上游服务，通过环境变量定义：

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `CHANNEL_{n}_NAME` | 是 | 渠道标识符，用于 `渠道名+模型名` 格式 |
| `CHANNEL_{n}_BASE_URL` | 是 | 上游 API 地址 |
| `CHANNEL_{n}_API_KEY` | 否 | 上游 API 密钥（可由客户端透传） |
| `CHANNEL_{n}_PROTOCOL` | 否 | 协议类型：`openai` 或 `anthropic`，默认自动识别 |

**配置示例**：

```bash
# 渠道 1: OpenAI
export CHANNEL_1_NAME=openai
export CHANNEL_1_BASE_URL=https://api.openai.com/v1/chat/completions
export CHANNEL_1_API_KEY=sk-xxx
export CHANNEL_1_PROTOCOL=openai

# 渠道 2: Anthropic
export CHANNEL_2_NAME=claude
export CHANNEL_2_BASE_URL=https://api.anthropic.com/v1/messages
export CHANNEL_2_API_KEY=sk-ant-xxx
export CHANNEL_2_PROTOCOL=anthropic

# 渠道 3: 本地模型
export CHANNEL_3_NAME=local
export CHANNEL_3_BASE_URL=http://localhost:8000/v1/chat/completions
export CHANNEL_3_PROTOCOL=openai
```

**客户端使用**：

配置好渠道后，在请求中使用 `渠道名+模型名` 格式：

```json
{
  "model": "openai+gpt-4o",
  "messages": [...]
}
```

或者：

```json
{
  "model": "claude+claude-3-5-sonnet-20241022",
  "messages": [...]
}
```

> 💡 **提示**: 如果不带 `+` 号，默认使用第一个配置的渠道。

### 传统配置（向后兼容）

如果只需要一个上游服务，可以使用传统的环境变量配置：

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `UPSTREAM_BASE_URL` | 是 | - | 上游 API 地址 |
| `UPSTREAM_API_KEY` | 否 | - | 上游 API 密钥 |
| `UPSTREAM_PROTOCOL` | 否 | `openai` | 上游协议类型 |

### 全局配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3456` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `LOG_LEVEL` | `info` | 日志级别 (debug, info, warn, error) |
| `CLIENT_API_KEY` | - | 代理服务器访问密钥，用于验证客户端 |
| `PASSTHROUGH_API_KEY` | `false` | 是否将客户端 Key 透传给上游 |
| `TOKEN_MULTIPLIER` | `1.0` | Token 计费倍数，支持 "1.2x", "120%" |
| `MAX_REQUESTS_PER_MINUTE` | `60` | 每分钟最大请求数 |
| `TIMEOUT_MS` | `120000` | 上游请求超时时间（毫秒） |
| `CLAUDE_API_KEY` | - | Claude API 密钥，用于精确 Token 计数 |

## 🏗️ 架构设计

cc-proxy 采用流水线架构，分为四个核心层：

```
Claude Code 客户端 (Anthropic 格式请求)
          ↓
┌─────────────────────────────────┐
│  1. 请求增强 (Enrichment)        │
│     - 工具定义 → XML 提示词      │
│     - 历史消息文本化             │
│     - 生成触发信号               │
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│  2. 协议转换 (Translation)       │
│     - 映射到 OpenAI/Anthropic    │
│     - 渠道路由                   │
└─────────────┬───────────────────┘
              ↓
上游 AI 服务 (返回 XML 标签的纯文本流)
          ↓
┌─────────────────────────────────┐
│  3. 流式解析 (Stream Parsing)    │
│     - 检测触发信号               │
│     - 提取 XML 工具调用          │
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│  4. 响应重建 (Reconstruction)    │
│     - 生成标准 Claude SSE        │
│     - Tool use/result 封装       │
└─────────────┬───────────────────┘
              ↓
Claude Code 客户端 (tool_use 消息)
```

详细架构说明请参考 [架构文档](docs/pipeline.md)。

## 📡 API 端点

### POST /v1/messages

Claude Code 兼容的消息端点，支持工具调用。

**请求示例**：

```bash
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-client-key" \
  -d '{
    "model": "openai+gpt-4o",
    "messages": [
      {"role": "user", "content": "What is the weather in SF?"}
    ],
    "tools": [{
      "name": "get_weather",
      "description": "Get current weather",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": {"type": "string"}
        },
        "required": ["city"]
      }
    }],
    "max_tokens": 1024
  }'
```

**响应**: SSE 流式响应，包含 `message_start`, `content_block_start`, `content_block_delta`, `message_stop` 等事件。

### POST /v1/messages/count_tokens

Token 计数端点，用于估算请求的 token 消耗。

**响应示例**：

```json
{
  "input_tokens": 135,
  "output_tokens": null
}
```

### GET /healthz

健康检查端点。

**响应**：

```json
{
  "status": "ok"
}
```

## 🔧 故障排除

### 工具不触发

**可能原因**：
- 模型指令遵循能力较弱
- `max_tokens` 设置过小
- 上下文长度不足

**解决方案**：
- 使用指令能力更强的模型（GPT-4、Claude 3.5）
- 增加 `max_tokens` 至 1024 以上
- 检查日志中的触发信号识别情况

### 协议报错

**可能原因**：
- `CHANNEL_n_PROTOCOL` 与 `BASE_URL` 不匹配
- 端点地址配置错误

**解决方案**：
- Anthropic 协议使用 `/v1/messages` 端点
- OpenAI 协议使用 `/v1/chat/completions` 端点
- 检查上游响应状态码

### Token 计数不准确

**解决方案**：
- 配置 `CLAUDE_API_KEY` 使用官方 API
- 调整 `TOKEN_MULTIPLIER` 补偿差异
- 参考 [Token 计数文档](docs/TOKEN_COUNTING.md)

## 📚 文档

- 📘 [架构设计](docs/pipeline.md) - 详细的架构设计和工作流程
- 📗 [开发计划](docs/deno-server-plan.md) - 项目开发路线图
- 📙 [使用示例](docs/deno-server-examples.md) - 端到端请求响应示例
- 📕 [运维手册](docs/deno-server-runbook.md) - 运维操作指南
- 🔢 [Token 计数](docs/TOKEN_COUNTING.md) - Token 计数功能详解
- 🚀 [部署指南](docs/deno-deployment-guide.md) - 完整的部署指南

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Anthropic](https://www.anthropic.com/) - Claude API
- [Deno](https://deno.land/) - 现代化运行时
- 所有贡献者

---

**Made with ❤️ by the cc-proxy team**