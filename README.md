# b4u2cc - Claude Code 代理服务器

b4u2cc 是一个基于 Deno 的代理服务器，用于将 Claude Code 的请求转换为兼容 OpenAI 格式的请求，使 Claude Code 能够与不支持原生工具调用的上游模型进行交互。

## 项目概述

本项目主要包含 `deno-proxy` 服务，它负责在 Claude Code 和 OpenAI（或其他无工具模式的 Chat API）之间建立桥梁，通过以下方式实现无缝对接：

- 将 Claude Code 的 SSE 流转换为上游兼容格式
- 插入必要的日志与格式转换
- 确保客户端无需感知上游差异

## 核心功能

### 🔄 协议转换
- **Claude → OpenAI**: 将 Anthropic Claude Messages API 请求转换为 OpenAI chat/completions 格式
- **OpenAI → Claude**: 将上游响应转换回 Claude Code 兼容的 SSE 流格式
- **工具调用支持**: 通过提示词注入实现工具调用，即使上游不支持原生 function calling

### 🛠️ 工具调用机制
- 动态生成触发信号，识别工具调用边界
- 将工具定义转换为系统提示词
- 解析上游文本中的工具调用描述
- 支持多工具调用和流式解析

### 🧠 思考模式
- 支持 Claude 的思考模式（thinking mode）
- 将思考内容转换为 `<thinking>` 标签格式
- 在响应中正确处理思考块和文本块的顺序

### 📊 Token 计数
- 集成 Claude 官方 `/v1/messages/count_tokens` API
- 本地 tiktoken 实现作为备用方案
- 支持通过 `TOKEN_MULTIPLIER` 调整计费倍数
- 提供 `/v1/messages/count_tokens` 端点

### 📝 日志系统
- 结构化日志记录请求全过程
- 支持多级别日志（debug、info、warn、error）
- 可完全禁用日志以提高性能
- 请求 ID 跟踪，便于调试

### 🔑 API Key 透传
- 支持将客户端 API key 直接透传给上游 API
- 通过 `PASSTHROUGH_API_KEY=true` 启用
- 客户端可以使用自己的 API key 而不是代理配置的密钥
- 适用于多用户场景，每个用户使用自己的上游账户

### 🔀 渠道+模型名透传
- 支持 `渠道名+模型名` 格式，如 `elysiver+claude-sonnet-4-5-20250929`
- 自动根据渠道名选择上游配置，将模型名透传给上游 API
- 简化配置，只需配置渠道的 base URL 和 API key
- 支持动态模型选择，无需为每个模型创建单独配置

 ## 快速开始

### 环境要求
- Deno 1.40+ 
- 可访问的上游 OpenAI 兼容 API

### 安装与运行

1. 克隆仓库
```bash
git clone <repository-url>
cd b4u2cc
```

2. 配置环境变量
```bash
# 必需配置
export UPSTREAM_BASE_URL="http://your-upstream-api/v1/chat/completions"
export UPSTREAM_API_KEY="your-upstream-api-key"

# 可选配置
export PORT=3456
export HOST=0.0.0.0
export CLIENT_API_KEY="your-client-api-key"  # 客户端认证密钥
export TIMEOUT_MS=120000
export MAX_REQUESTS_PER_MINUTE=10
export TOKEN_MULTIPLIER=1.0
```

3. 启动服务
```bash
cd deno-proxy
deno run --allow-net --allow-env src/main.ts
```

4. 验证服务
```bash
curl http://localhost:3456/healthz
```

## 详细配置

### 环境变量说明

#### 单上游配置（向后兼容）
| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `UPSTREAM_BASE_URL` | 是* | - | 上游 OpenAI 兼容 API 地址 |
| `UPSTREAM_API_KEY` | 否 | - | 上游 API 密钥 |
| `UPSTREAM_MODEL` | 否 | - | 强制覆盖请求中的模型名称 |
| `CLIENT_API_KEY` | 否 | - | 客户端认证密钥 |
| `PORT` | 否 | 3456 | 服务监听端口 |
| `HOST` | 否 | 0.0.0.0 | 服务监听地址 |
| `TIMEOUT_MS` | 否 | 120000 | 请求超时时间（毫秒） |
| `AGGREGATION_INTERVAL_MS` | 否 | 35 | SSE 聚合间隔（毫秒） |
| `MAX_REQUESTS_PER_MINUTE` | 否 | 10 | 每分钟最大请求数 |
| `TOKEN_MULTIPLIER` | 否 | 1.0 | Token 计数倍数 |
| `CLAUDE_API_KEY` | 否 | - | Claude API 密钥（用于精确 token 计数） |
| `LOG_LEVEL` | 否 | info | 日志级别（debug/info/warn/error） |
| `LOGGING_DISABLED` | 否 | false | 是否完全禁用日志 |
| `PASSTHROUGH_API_KEY` | 否 | false | 是否将客户端 API key 透传给上游 |

 #### 多上游配置（新）
支持配置多组上游，每组包含以下四个环境变量，索引从1开始递增：

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `UPSTREAM_CONFIG_{n}_BASE_URL` | 是* | - | 第 n 组上游 API 地址 |
| `UPSTREAM_CONFIG_{n}_API_KEY` | 否 | - | 第 n 组上游 API 密钥 |
| `UPSTREAM_CONFIG_{n}_REQUEST_MODEL` | 是* | - | 第 n 组实际请求的模型名 |
| `UPSTREAM_CONFIG_{n}_NAME_MODEL` | 是* | - | 第 n 组客户端使用的模型名（唯一） |

**注意**：
- 如果配置了多组上游，则单上游配置（`UPSTREAM_BASE_URL` 等）将被忽略。
- 客户端请求的 `model` 字段必须与某个 `NAME_MODEL` 匹配，否则将使用单上游配置（如果存在）或报错。
- 模型名称在配置中必须唯一。
- 带 * 的变量在对应配置组中为必需。

**示例**：
```bash
# 配置两组上游
UPSTREAM_CONFIG_1_BASE_URL=https://api.openai.com/v1/chat/completions
UPSTREAM_CONFIG_1_API_KEY=sk-...
UPSTREAM_CONFIG_1_REQUEST_MODEL=claude-sonnet-4.5
UPSTREAM_CONFIG_1_NAME_MODEL=w1-claude-sonnet-4.5

UPSTREAM_CONFIG_2_BASE_URL=https://api.anthropic.com/v1/messages
UPSTREAM_CONFIG_2_API_KEY=sk-ant-...
UPSTREAM_CONFIG_2_REQUEST_MODEL=claude-sonnet-4.5
UPSTREAM_CONFIG_2_NAME_MODEL=w2-claude-sonnet-4.5
```

#### 渠道配置（推荐）
支持配置多个渠道，通过 `渠道名+模型名` 格式动态选择上游和模型：

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `CHANNEL_{n}_NAME` | 是* | - | 第 n 个渠道的名称（唯一标识） |
| `CHANNEL_{n}_BASE_URL` | 是* | - | 第 n 个渠道的 API 地址 |
| `CHANNEL_{n}_API_KEY` | 否 | - | 第 n 个渠道的 API 密钥 |

**优势**：
- 只需配置渠道，无需为每个模型创建配置
- 客户端可以使用任意模型名，自动透传给上游
- 支持快速切换不同上游服务
- 配置简洁，易于管理

**示例**：
```bash
# 配置两个渠道
CHANNEL_1_NAME=elysiver
CHANNEL_1_BASE_URL=https://api.elysiver.com/v1/chat/completions
CHANNEL_1_API_KEY=sk-elysiver-...

CHANNEL_2_NAME=openrouter
CHANNEL_2_BASE_URL=https://openrouter.ai/api/v1/chat/completions
CHANNEL_2_API_KEY=sk-or-...

# 客户端使用
# model: "elysiver+claude-sonnet-4-5-20250929"
# model: "openrouter+anthropic/claude-3.5-sonnet"
```

 ### Token 倍数格式

`TOKEN_MULTIPLIER` 支持多种格式：
- 数字：`1.2`
- 带后缀：`1.2x`、`x1.2`
- 百分比：`120%`
- 带引号：`"1.2"`

## API 端点

### `/v1/messages`
处理 Claude Messages API 请求，支持流式响应。

**请求示例**:
```bash
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-client-api-key" \
  -d '{
    "model": "claude-3.5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ],
    "stream": true
  }'
```

### `/v1/messages/count_tokens`
计算请求的 token 数量。

**请求示例**:
```bash
curl -X POST http://localhost:3456/v1/messages/count_tokens \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3.5-sonnet-20241022",
    "messages": [
      {"role": "user", "content": "Hello, world"}
    ]
  }'
```

### `/healthz`
健康检查端点。

## 使用示例

### 基础对话
```bash
./scripts/test-proxy.sh
```

### 思考模式
```bash
./scripts/test-thinking-mode.sh
```

### 通过代理启动 Claude Code
```bash
./scripts/run-claude-via-proxy.sh
```

### API Key 透传模式
```bash
# 启动时启用透传
export PASSTHROUGH_API_KEY=true
export UPSTREAM_BASE_URL="https://api.openai.com/v1/chat/completions"
deno run --allow-net --allow-env src/main.ts

# 客户端使用自己的 API key 请求
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-own-api-key" \
  -d '{
    "model": "gpt-4",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": true
  }'
```

**透传模式说明**：
- 启用 `PASSTHROUGH_API_KEY=true` 后，代理会将客户端的 API key 直接传递给上游
- 如果客户端没有提供 API key，则回退使用配置中的 `UPSTREAM_API_KEY`
- 适合多用户场景，每个用户使用自己的上游账户和配额
- 可以与 `CLIENT_API_KEY` 配合使用，实现双重认证

### 渠道+模型名模式
```bash
# 配置渠道
export CHANNEL_1_NAME=elysiver
export CHANNEL_1_BASE_URL=https://api.elysiver.com/v1/chat/completions
export CHANNEL_1_API_KEY=sk-elysiver-...

export CHANNEL_2_NAME=openrouter
export CHANNEL_2_BASE_URL=https://openrouter.ai/api/v1/chat/completions
export CHANNEL_2_API_KEY=sk-or-...

# 启动服务
deno run --allow-net --allow-env src/main.ts

# 客户端使用渠道+模型名格式
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "elysiver+claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": true
  }'

# 使用另一个渠道
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter+anthropic/claude-3.5-sonnet",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": true
  }'
```

**渠道模式说明**：
- 使用 `渠道名+模型名` 格式（用 `+` 分隔）
- 系统自动根据渠道名选择上游配置
- `+` 后面的模型名会透传给上游 API
- 支持任意模型名，无需预先配置
- 可以快速切换不同上游服务

 ## 架构设计

### 核心组件

1. **请求转换器** (`anthropic_to_openai.ts`)
   - 将 Claude 请求格式转换为 OpenAI 格式
   - 处理角色映射、内容块转换
   - 支持思考模式标签转换

2. **提示词注入器** (`prompt_inject.ts`)
   - 生成工具调用提示词
   - 创建触发信号
   - 构建工具定义 XML

3. **上游调用器** (`upstream.ts`)
   - 处理与上游 API 的通信
   - 支持流式响应
   - 超时和错误处理

4. **响应解析器** (`parser.ts`)
   - 解析上游文本中的工具调用
   - 支持流式解析
   - 处理思考内容

5. **响应转换器** (`openai_to_claude.ts`)
   - 将解析结果转换为 Claude SSE 格式
   - 处理内容块和工具调用块
   - 生成正确的 token 计数

### 工作流程

```
Claude Code 请求
       ↓
   请求验证
       ↓
   格式转换
       ↓
   提示词注入
       ↓
   上游调用
       ↓
   流式解析
       ↓
   响应转换
       ↓
   Claude SSE 响应
```

## 开发与测试

### 运行测试
```bash
cd deno-proxy
deno test --allow-env src
```

### 开发模式
```bash
cd deno-proxy
deno task dev
```

### 日志调试
```bash
# 启用详细日志
LOG_LEVEL=debug deno run --allow-net --allow-env src/main.ts

# 完全禁用日志
LOGGING_DISABLED=true deno run --allow-net --allow-env src/main.ts
```

## 部署指南

### Deno Deploy 一键部署 🚀

最简单的部署方式是使用 Deno Deploy 官方平台：

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=https://github.com/your-username/b4u2cc)

**优势**:
- 无需管理服务器
- 自动扩缩容
- 全球 CDN 分发
- 免费额度充足

**快速部署步骤**:
1. 点击上方 "Deploy on Deno" 按钮
2. 授权 GitHub 访问
3. 配置环境变量（上游 API 地址和密钥）
4. 点击部署，几秒钟后即可访问

详细说明请参考：[Deno 部署指南](docs/deno-deployment-guide.md#deno-deploy-一键部署)

### 其他部署方式

该指南还包含以下部署场景：
- 本地开发环境
- 生产环境 (systemd)
- Docker 容器化
- 云平台部署 (Vercel, Railway, DigitalOcean)
- 性能优化与监控

### 快速部署示例

#### Docker 部署
```bash
# 构建镜像
docker build -t b4u2cc-proxy .

# 运行容器
docker run -d \
  --name b4u2cc-proxy \
  -p 3456:3456 \
  -e UPSTREAM_BASE_URL=http://your-upstream-api/v1/chat/completions \
  -e UPSTREAM_API_KEY=your-api-key \
  b4u2cc-proxy
```

#### 系统服务部署
```bash
# 创建服务文件
sudo tee /etc/systemd/system/b4u2cc.service > /dev/null <<EOF
[Unit]
Description=b4u2cc Proxy Server
After=network.target

[Service]
Type=simple
User=deno
WorkingDirectory=/opt/b4u2cc/deno-proxy
Environment=UPSTREAM_BASE_URL=http://your-upstream-api/v1/chat/completions
Environment=UPSTREAM_API_KEY=your-api-key
Environment=PORT=3456
ExecStart=/usr/bin/deno run --allow-net --allow-env src/main.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
sudo systemctl enable b4u2cc
sudo systemctl start b4u2cc
```

## 故障排除

### 常见问题

1. **上游连接失败**
   - 检查 `UPSTREAM_BASE_URL` 配置
   - 验证网络连接和防火墙设置
   - 确认上游 API 密钥有效

2. **工具调用解析失败**
   - 检查上游模型是否遵循提示词指令
   - 调整 `AGGREGATION_INTERVAL_MS` 参数
   - 启用 debug 日志查看解析过程

3. **Token 计数不准确**
   - 配置 `CLAUDE_API_KEY` 使用官方 API
   - 调整 `TOKEN_MULTIPLIER` 值
   - 对比本地和官方 API 结果

4. **性能问题**
   - 禁用日志：`LOGGING_DISABLED=true`
   - 调整聚合间隔：`AGGREGATION_INTERVAL_MS`
   - 增加超时时间：`TIMEOUT_MS`

### 日志分析

启用详细日志进行调试：
```bash
LOG_LEVEL=debug deno run --allow-net --allow-env src/main.ts
```

关键日志位置：
- 请求转换过程
- 上游 API 调用
- 工具调用解析
- SSE 事件生成

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证。详见 LICENSE 文件。

## 相关文档

- [Deno 部署指南](docs/deno-deployment-guide.md)
- [Deno 服务器示例](docs/deno-server-examples.md)
- [开发计划](docs/deno-server-plan.md)
- [运行指南](docs/deno-server-runbook.md)
- [日志配置](docs/logging-configuration.md)
- [Token 计数](docs/TOKEN_COUNTING.md)
- [流水线说明](docs/pipeline.md)
