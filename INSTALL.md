# 安装指南

## 快速开始

### 1. 准备图标文件（可选）

插件需要图标文件才能正常安装。你可以：

**方法一：创建简单图标**
```bash
# 如果有 ImageMagick
convert -size 128x128 xc:#0969da -fill white -gravity center -pointsize 64 -annotate +0+0 "GA" icons/icon128.png
convert -size 48x48 xc:#0969da -fill white -gravity center -pointsize 24 -annotate +0+0 "GA" icons/icon48.png
convert -size 16x16 xc:#0969da -fill white -gravity center -pointsize 10 -annotate +0+0 "GA" icons/icon16.png
```

**方法二：使用在线工具**
- 访问 https://www.favicon-generator.org/
- 上传任意图片或使用文字生成图标
- 下载并保存为 `icon16.png`, `icon48.png`, `icon128.png` 到 `icons/` 目录

**方法三：临时使用占位图标**
- 可以暂时使用任意图片文件重命名为所需尺寸
- 插件功能不受图标影响

### 2. 安装插件到浏览器

#### Chrome / Edge (Chromium)

1. 打开浏览器，访问 `chrome://extensions/` 或 `edge://extensions/`
2. 启用右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目目录 (`/home/aptend/code/daily-check`)
5. 插件应该出现在扩展列表中

#### Firefox

1. 打开浏览器，访问 `about:debugging`
2. 点击"此 Firefox"
3. 点击"临时载入附加组件"
4. 选择项目目录中的 `manifest.json` 文件

### 3. 配置 GitHub Token

1. **获取 GitHub Personal Access Token**：
   - 访问 https://github.com/settings/tokens
   - 点击 "Generate new token (classic)"
   - 输入名称，例如 "GitHub Actions Extension"
   - 选择以下权限：
     - ✅ `repo` (Full control of private repositories)
     - ✅ `actions:read` (Read access to Actions)
   - 点击 "Generate token"
   - **重要**：复制生成的 token（只显示一次）

2. **在插件中配置 Token**：
   - 点击浏览器工具栏中的插件图标
   - 在弹出窗口中粘贴 token
   - 点击 "Save Token"
   - 看到 "Token saved successfully!" 提示即表示配置成功

### 4. 使用插件

#### 提取 Namespace

1. 访问 workflow run 页面，例如：
   ```
   https://github.com/matrixorigin/mo-nightly-regression/actions/runs/19072270367
   ```

2. 插件会自动：
   - 查找 "SETUP MO TEST ENV" job
   - 查找 "Clean TKE Env" step
   - 提取步骤输出中的 namespace
   - 将 namespace 保存到本地存储

3. 打开浏览器开发者工具（F12）查看控制台日志，确认提取过程

#### 查看 Namespace

1. 访问 workflow 列表页面：
   ```
   https://github.com/matrixorigin/mo-nightly-regression/actions/workflows/branch-nightly-regression-tke-new.yaml
   ```

2. 插件会自动在对应的 workflow run 上显示提取的 namespace
   - 显示为蓝色标签："Namespace: {namespace名称}"
   - 点击标签可以复制 namespace 到剪贴板

### 5. 故障排除

#### 插件无法加载
- 检查 `manifest.json` 语法是否正确
- 确保所有文件都在正确的位置
- 查看浏览器控制台错误信息

#### 无法提取 Namespace
- 确认已配置 GitHub Token
- 检查 Token 是否有正确的权限
- 打开开发者工具查看控制台错误
- 确认 workflow run 页面包含目标 job 和 step

#### Namespace 未显示
- 确认已访问过对应的 workflow run 页面进行提取
- 检查浏览器存储中是否有数据（开发者工具 > Application > Storage > Local Storage）
- 刷新 workflow 列表页面

#### API 请求失败
- 检查网络连接
- 如果使用代理，确认代理配置正确（`http://172.21.144.1:7890`）
- 检查 GitHub Token 是否有效
- 查看背景页面的错误日志（扩展管理页面 > 服务工作者）

### 6. 开发模式

#### 查看日志

- **Content Script 日志**：在 GitHub 页面打开开发者工具（F12）查看 Console
- **Background Script 日志**：
  - Chrome: `chrome://extensions/` > 找到插件 > 点击"检查视图: service worker"
  - Edge: `edge://extensions/` > 找到插件 > 点击"检查视图: service worker"

#### 重新加载插件

修改代码后：
1. 访问扩展管理页面
2. 点击插件的刷新按钮
3. 刷新 GitHub 页面以重新加载 content script

#### 调试技巧

- 在代码中添加 `console.log()` 查看执行流程
- 使用 `chrome.storage.local.get(null, console.log)` 查看存储的数据
- 检查网络请求是否成功（开发者工具 > Network）

## 下一步

- 扩展功能支持其他 job/step
- 添加更多 UI 功能
- 支持批量提取
- 添加设置页面

