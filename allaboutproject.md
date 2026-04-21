# Vegeta Load Testing Control System

## 项目简介

这是一个基于 Vegeta 的 HTTP 压测控制系统，提供了友好的 Web 界面来配置和执行压测任务。主要用于测试大语言模型 API（如 vLLM、OpenAI 兼容接口）的性能和稳定性。

## 版本信息

- **当前版本**: v1.0.0
- **最后更新**: 2025-11-06

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **压测工具**: Vegeta (https://github.com/tsenart/vegeta)

## 系统架构

```
vegeta-test/
├── server.js           # Express 后端服务器
├── package.json        # 项目依赖配置
├── public/             # 前端静态资源
│   ├── index.html      # 压测控制页面
│   ├── style.css       # 样式文件
│   └── app.js          # 前端交互逻辑
├── request.txt         # Vegeta 请求模板
├── request.json        # 请求体 JSON
├── ai-docs/            # AI 任务记录
├── changelog.md        # 变更日志
└── allaboutproject.md  # 本文档
```

## 主要功能

### 1. 可视化压测配置

通过 Web 界面配置以下参数：

#### API 配置
- **API 地址**: 目标服务器的 URL
- **API Key**: 认证令牌
- **模型名称**: 要测试的模型

#### 请求参数
- **用户提示词**: 发送给模型的问题
- **最大 Tokens**: max_tokens 参数
- **温度**: temperature 参数

#### 压测参数
- **QPS (请求速率)**: 每秒发送的请求数
- **持续时间**: 压测持续的时间（秒）

### 2. 实时压测执行

- 点击"开始压测"按钮启动测试
- 实时显示压测进度和状态
- 显示详细的压测结果报告

### 3. 结果展示

压测完成后显示：
- 请求总数
- 成功率
- 平均延迟
- P50/P95/P99 延迟
- 吞吐量
- 错误统计

### 4. 历史记录

- 自动保存每次压测配置
- 快速加载历史配置重新测试

## 安装与使用

### 前置要求

1. **安装 Node.js** (v14+)
   ```bash
   node --version
   ```

2. **安装 Vegeta**
   ```bash
   # macOS
   brew install vegeta
   
   # Linux
   wget https://github.com/tsenart/vegeta/releases/download/v12.8.4/vegeta_12.8.4_linux_amd64.tar.gz
   tar xzf vegeta_12.8.4_linux_amd64.tar.gz
   sudo mv vegeta /usr/local/bin/
   ```

### 快速启动

1. **安装依赖**
   ```bash
   npm install
   ```

2. **启动服务器**
   ```bash
   npm start
   ```

3. **访问界面**
   
   打开浏览器访问: http://localhost:3000

### 使用示例

1. 在表单中填写配置：
   - API 地址: `http://10.100.121.67:30888/v1/chat/completions`
   - API Key: `sk-…` (set per environment)
   - 模型名称: `gen-studio-Qwen2.5-0.5B`
   - 用户提示词: `天为何是蓝色的`
   - QPS: `2`
   - 持续时间: `120` 秒

2. 点击"开始压测"

3. 等待压测完成，查看结果报告

## API 接口说明

### POST /api/load-test

启动压测任务。

**请求体**:
```json
{
  "apiUrl": "http://example.com/v1/chat/completions",
  "apiKey": "sk-xxx",
  "model": "model-name",
  "prompt": "your question",
  "maxTokens": 1000,
  "temperature": 0.7,
  "rate": 2,
  "duration": 120
}
```

**响应**:
```json
{
  "success": true,
  "report": "压测结果文本",
  "config": { /* 配置信息 */ }
}
```

## 常见问题

### Q1: 提示 "vegeta: command not found"

**解决方案**: 需要先安装 Vegeta 压测工具，参考上方"安装 Vegeta"部分。

### Q2: 压测失败，返回 401 错误

**解决方案**: 检查 API Key 是否正确，确保有访问权限。

### Q3: 无法连接到 API 地址

**解决方案**: 
- 确认 API 地址格式正确（包含 http:// 或 https://）
- 检查网络连接
- 确认目标服务器正常运行

### Q4: 压测结果延迟很高

**解决方案**: 
- 检查网络带宽
- 降低 QPS 值
- 确认目标服务器负载

## 调试建议

1. **查看服务器日志**: 服务器会在控制台输出详细日志
2. **检查 Vegeta 命令**: 查看实际执行的 Vegeta 命令
3. **手动测试**: 可以直接使用命令行测试 Vegeta
   ```bash
   cat request.txt | vegeta attack -rate=2 -duration=10s | vegeta report
   ```

## 扩展功能建议

- [ ] 支持批量压测场景
- [ ] 添加压测结果图表可视化
- [ ] 支持导出压测报告
- [ ] 添加 WebSocket 实时推送进度
- [ ] 支持多种 HTTP 方法测试
- [ ] 集成性能监控面板

## 贡献与反馈

如有问题或建议，请记录在 `ai-docs/` 目录下的对应文件中。

