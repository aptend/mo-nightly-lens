# GitHub Actions Daily Check

一个 Chrome 扩展 + CLI 工具集，用于分析 `matrixorigin/mo-nightly-regression` 仓库的 GitHub Actions 运行情况，并为排障流程生成结构化的失败报告与日志上下文。

## 主要能力

- 在 GitHub Actions 页面注入 UI，直接展示运行的 namespace 等关键信息
- 调用 GitHub API 拉取 workflow run、job、step，并对失败用例进行聚合
- 自动下载失败 step 的原始日志，提取错误上下文并生成 Grafana 跳转链接
- 支持命令行快速生成 failure report 或提取 namespace，便于故障排查

## 目录结构

```
daily-check/
├── background.js                   # 扩展后台，用于代理网络请求
├── content.js                      # 注入到 GitHub 页面，负责 DOM 抽取与交互
├── manifest.json                   # 浏览器扩展配置
├── config/
│   └── app-config.json             # GitHub API & 会话配置，需手动填写
├── modules/                        # 核心业务模块
│   ├── config/
│   │   └── index.js                # 配置读取与缓存
│   ├── failure-report/             # 失败报告相关逻辑
│   │   ├── service.js              # 聚合 run / job / step 数据
│   │   ├── runner.js               # CLI 封装，负责解析参数/落盘
│   │   ├── job-utils.js            # 判断失败 job/step 的工具
│   │   ├── namespace-resolver.js   # 依据日志解析 namespace
│   │   └── step-log-loader.js      # 带缓存的 step log 拉取器
│   ├── github/
│   │   ├── actions-client.js       # workflow run / job / step 访问封装
│   │   ├── http-client.js          # 基于配置的 REST 请求薄封装
│   │   └── session-client.js       # 浏览器会话代理（下载页面日志）
│   ├── logs/
│   │   ├── context-extractor.js    # 从原始日志中截取错误上下文
│   │   └── step-log-client.js      # 结合会话的 step 日志下载器
│   ├── namespace/
│   │   └── index.js                # Namespace 解析与 Grafana 构建
│   ├── workflow/
│   │   └── extractor.js            # 页面 DOM 提取工具
│   ├── ui-renderer.js              # 插件 UI 渲染逻辑
│   └── utils/
│       └── retry.js                # 网络请求重试与退避策略
├── popup.html / popup.js            # 扩展弹窗，用于配置 token
├── scripts/                        # CLI 工具
│   ├── fetch-failure-report.js     # 生成失败报告（核心入口）
│   ├── fetch-namespace.js          # 获取最新 workflow run 的 namespace
│   ├── download-step-log.js        # 使用 session 下载指定 step 的原始日志
│   └── extract-error-context.js    # 离线解析单个日志文件中的错误上下文
└── reports/                        # CLI 运行输出的 JSON 报告与日志
```

## 关键模块说明

- `content.js`  
  在 GitHub Actions 页面注入 UI，协调 DOM 抽取、API 调用和 namespace 展示。

- `modules/config/index.js`  
  负责解析 `config/app-config.json`（或环境变量指定的配置），集中管理 GitHub Token、API Base、会话 Cookie 与代理设置。

- `modules/core/github/actions-client.js`  
  组合注入式 request 函数，统一封装 workflow run、job 详情、step 列表与分页处理逻辑。
- `modules/adapters/cli/github/`  
  包含 `api-client`、`actions-client`、`session-client` 等 Node 端实现，负责发起 HTTPS 请求、代理配置与 Cookie 会话。

- `modules/core/logs/context-extractor.js`  
  针对标准化格式的日志输出，智能截取关键错误段落并推断时间范围，为 Grafana 链接生成提供时间窗口。
- `modules/adapters/cli/logs/step-log-client.js`  
  使用 GitHub 会话 Cookie 下载具体 step 的日志文本。

- `modules/namespace/index.js`  
  同时提供 `NamespaceExtractor` 与 `fetchNamespaceForLatestRun`，将日志解析、Grafana 链接构建与 API 查询聚合。

- `modules/core/failure-report/`  
  将 actions 客户端、日志提取器、namespace 解析器、AI 总结等核心能力汇总为可复用模块（如 `create-failure-report-fetcher`、`generate-report`、`step-log-loader`）。
- `modules/adapters/cli/failure-report/`  
  CLI 运行时适配层，包含 `fetch-failure-report`、进度输出与 AI 总结配置。
- `modules/adapters/browser/failure-report/`  
  浏览器扩展适配层，封装 AI 总结能力并与后台 Service Worker 共享。
- `modules/core/issues/context-issue-builder.js`  
  将错误上下文转化为 Issue 草稿（模板替换、AI 摘要、Grafana/日志链接）。
- `modules/adapters/cli/issues/` 与 `modules/adapters/browser/issues/`  
  分别在 Node 与扩展环境加载模板资源，复用核心 Issue 生成逻辑。

- `modules/utils/retry.js`  
  提供 `withRetry`、`isRetryable`、`delay` 等工具，针对常见网络异常（超时、连接重置等）自动进行指数退避重试。

## CLI 脚本

- `node scripts/fetch-failure-report.js --run <runId> [--with-logs] [--with-timings] [--repo org/repo]`  
  核心脚本，生成 `reports/failure-report-<runId>.json`，可选落盘失败步骤日志。

- `node scripts/fetch-namespace.js [--repo org/repo] [--workflow file.yaml]`  
  查询最近一次 workflow 运行的 namespace，并输出运行 / job / step 详情。

- `node scripts/download-step-log.js --run <runId> [--job "<keyword>" | --job-id <id>] [--step <number> | --step-name "<keyword>"]`  
  通过浏览器 session 拉取原始日志文件，适合本地调试。

- `node scripts/extract-error-context.js --file <logPath>`  
  针对已有日志文件离线提取错误上下文，验证 `modules/core/logs/context-extractor.js` 的效果。

所有脚本均读取 `config/app-config.json` 中的 GitHub Token、API Base、Session Cookies 等配置，并以 `matrixorigin/mo-nightly-regression` 为默认仓库，可通过参数覆盖。

### 配置说明

`config/app-config.json` 采用以下结构（示例为占位内容，请自行替换）：

```json
{
  "github": {
    "token": "ghp_xxx",
    "apiBase": "https://api.github.com",
    "session": {
      "cookies": {
        "user_session": "xxxx",
        "_gh_sess": "xxxx"
      },
      "proxyUrl": ""
    }
  }
}
```

- `github.token`：GitHub Personal Access Token（需要至少 `repo` 和 `actions:read` 权限）。
- `github.session.cookies`：浏览器会话 cookies，用于下载前端页面中的日志（可选，但 `download-step-log` 及扩展中的 Step Log 功能需要）。
- `github.session.proxyUrl`：若需要通过代理访问 GitHub，可设置此字段（可为空）。

## 安装使用（浏览器扩展）

1. 打开 Chrome/Edge，访问 `chrome://extensions/`，开启“开发者模式”
2. 选择“加载已解压的扩展程序”，指向本项目目录
3. 点击扩展弹窗，粘贴具备 `repo` 与 `actions:read` 权限的 GitHub Token
4. 访问任意 workflow run 页面，扩展会自动展示 namespace 与失败摘要

## 开发说明

- Node.js 建议使用 `nvm` 安装的最新 LTS 版本（项目默认使用 ES Modules）
- CLI 输出位于 `reports/` 目录，便于分享与追踪
- 如需代理或其他网络配置，自行在 `background.js` 中调整
- 常见网络错误由重试模块处理，若仍失败，可加 `--verbose`（待扩展）

## 注意事项

- GitHub API 限流：请确保 Token 具备足够配额
- 运行失败时，终端会提示错误原因并返回非零退出码
- Node CLI 会提示 `"type": "module"` 警告，后续可在 `package.json` 中设置以消除

