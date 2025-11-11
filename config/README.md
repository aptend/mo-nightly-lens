# 配置文件说明

## app-config.json

这是项目的主配置文件，需要手动创建并填写相应的值。

### 配置结构

```json
{
  "github": {
    "token": "GitHub Personal Access Token",
    "apiBase": "GitHub API 基础 URL（可选）",
    "session": {
      "cookies": {
        "user_session": "浏览器会话 Cookie（可选）",
        "_gh_sess": "GitHub 会话 Cookie（可选）"
      },
      "proxyUrl": "代理 URL（可选）"
    }
  },
  "aiSummaries": {
    "provider": "AI 服务提供商（可选，默认 dashscope）",
    "apiKey": "AI API 密钥（可选）",
    "apiBase": "AI API 基础 URL（可选）",
    "model": "AI 模型名称（可选，默认 qwen-max）",
    "enabled": "是否启用 AI 摘要（可选，布尔值）",
    "summaries": {
      "model": "摘要模型名称（可选）",
      "enabled": "是否启用摘要（可选，布尔值）"
    }
  }
}
```

### 字段说明

#### GitHub 配置 (`github`)

- **`token`** (必需)
  - GitHub Personal Access Token
  - 需要至少 `repo` 和 `actions:read` 权限
  - 获取方式：GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
  - 格式：`ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

- **`apiBase`** (可选)
  - GitHub API 基础 URL
  - 默认值：`https://api.github.com`
  - 如果使用 GitHub Enterprise，请修改为对应的 API 地址

- **`session.cookies`** (可选)
  - 浏览器会话 Cookies，用于下载前端页面中的日志
  - 如果只需要使用 GitHub API，可以不填写
  - `download-step-log` 脚本和浏览器扩展中的 Step Log 功能需要此配置
  - 获取方式：
    1. 登录 GitHub
    2. 打开浏览器开发者工具（F12）
    3. 在 Application/Storage → Cookies → https://github.com 中找到
    4. 复制 `user_session` 和 `_gh_sess` 的值

- **`session.proxyUrl`** (可选)
  - 代理服务器 URL
  - 如果需要通过代理访问 GitHub，填写代理地址
  - 格式：`http://proxy.example.com:8080` 或 `https://proxy.example.com:8080`
  - 如果不需要代理，可以留空或删除此字段

#### AI 摘要配置 (`aiSummaries`)

- **`provider`** (可选)
  - AI 服务提供商
  - 默认值：`dashscope`（阿里云通义千问）
  - 当前仅支持 `dashscope`

- **`apiKey`** (可选)
  - AI API 密钥
  - 如果不需要 AI 摘要功能，可以不填写
  - Dashscope API Key 获取方式：https://dashscope.console.aliyun.com/

- **`apiBase`** (可选)
  - AI API 基础 URL
  - 默认值：`https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation`
  - 通常不需要修改

- **`model`** (可选)
  - AI 模型名称
  - 默认值：`qwen-max`
  - 可选值：`qwen-max`, `qwen-plus`, `qwen-turbo` 等

- **`enabled`** (可选)
  - 是否启用 AI 摘要功能
  - 默认值：`false`
  - 设置为 `true` 以启用 AI 摘要

- **`summaries`** (可选)
  - 摘要子配置
  - `model`: 摘要模型名称（可选）
  - `enabled`: 是否启用摘要（可选）

### 快速开始

1. 复制样例文件：
   ```bash
   cp config/app-config.json.example config/app-config.json
   ```

2. 编辑 `config/app-config.json`，至少填写以下必需字段：
   - `github.token`: 你的 GitHub Personal Access Token

3. （可选）如果需要使用 AI 摘要功能：
   - 填写 `aiSummaries.apiKey`
   - 设置 `aiSummaries.enabled` 为 `true`

4. （可选）如果需要下载页面日志：
   - 填写 `github.session.cookies.user_session`
   - 填写 `github.session.cookies._gh_sess`

### 注意事项

- ⚠️ **安全提示**：`app-config.json` 包含敏感信息，已被添加到 `.gitignore`，不会被提交到 Git 仓库
- 🔑 **Token 权限**：确保 GitHub Token 具有足够的权限（至少需要 `repo` 和 `actions:read`）
- 🌐 **代理配置**：如果在中国大陆使用，可能需要配置代理才能访问 GitHub API
- 📝 **Cookie 有效期**：浏览器 Cookies 会过期，如果下载日志失败，可能需要重新获取 Cookies

### 环境变量覆盖

可以通过环境变量覆盖配置文件路径：

- `DAILY_CHECK_CONFIG_PATH`: 指定配置文件路径
- `DAILYCHECK_CONFIG_PATH`: 指定配置文件路径（兼容旧版本）

示例：
```bash
export DAILY_CHECK_CONFIG_PATH=/path/to/custom-config.json
node scripts/fetch-failure-report.js
```

