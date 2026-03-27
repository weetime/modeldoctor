# 🚀 Quick Start Guide

## 30 秒快速启动

```bash
# 1. 启动服务器
./start.sh

# 2. 打开浏览器
# 访问 http://localhost:3000

# 3. 点击"开始压测"
# 使用预填的默认值即可
```

就这么简单! 🎉

---

## 详细步骤

### 步骤 1: 确认环境

系统会自动检查:
- ✅ Node.js (已安装 v23.10.0)
- ✅ Vegeta (已安装 /opt/homebrew/bin/vegeta)
- ✅ npm 依赖 (已安装)

### 步骤 2: 启动服务器

```bash
./start.sh
```

你会看到:
```
🚀 Vegeta Load Test Control Server
📡 Server running at http://localhost:3000
📝 Ready to accept load test requests
```

### 步骤 3: 打开 Web 界面

在浏览器中打开: **http://localhost:3000**

你会看到一个美观的压测控制界面!

### 步骤 4: 配置并运行测试

界面已经预填了示例配置:

#### 🔌 API 配置
- API URL: `http://10.100.121.67:30888/v1/chat/completions`
- API Key: `sk-YAUTMonvpRCMkj5yB5435e8e8cD64654999cA9F3Cc6bF9Ff`
- Model: `gen-studio-Qwen2.5-0.5B`

#### 📝 请求参数
- Prompt: `天为何是蓝色的`
- Max Tokens: `1000`
- Temperature: `0.7`

#### ⚡ 压测参数
- QPS: `2` (每秒 2 个请求)
- Duration: `120` 秒

点击 **"🚀 Start Load Test"** 按钮!

### 步骤 5: 查看结果

测试完成后(约 2 分钟),你会看到:

📊 **关键指标**
- Total Requests: 240
- Success Rate: 100%
- Throughput: 2.00 req/s
- Mean Latency: ~XXXms
- P95 Latency: ~XXXms
- P99 Latency: ~XXXms

📄 **详细报告**
完整的 Vegeta 压测报告

⚙️ **测试配置**
本次测试使用的配置信息

---

## 💡 使用技巧

### 修改配置

1. **测试不同的 API**: 修改 API URL 和 API Key
2. **调整压测强度**: 
   - 增加 QPS 可以提高压力
   - 延长 Duration 可以测试持久性
3. **改变请求内容**: 修改 Prompt 测试不同场景

### 建议的测试步骤

```
第一轮: QPS=2,  Duration=30s   (验证配置)
第二轮: QPS=5,  Duration=60s   (轻度压测)
第三轮: QPS=10, Duration=120s  (中度压测)
第四轮: QPS=20, Duration=300s  (重度压测)
```

### 查看日志

服务器终端会显示详细日志:
```
🚀 Starting load test with configuration: ...
✅ Created request.json
✅ Created request.txt
🔨 Executing Vegeta command: ...
✅ Load test completed successfully
📊 Results: ...
```

---

## 🛠️ 故障排除

### 问题: 服务器启动失败

```bash
# 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

### 问题: Vegeta 未安装

```bash
# macOS
brew install vegeta

# 验证安装
which vegeta
```

### 问题: 压测失败 (401 错误)

- 检查 API Key 是否正确
- 确认有访问权限
- 验证 API 地址是否正确

### 问题: 无法连接到 API

- 确认 API 地址格式正确(包含 http://)
- 检查网络连接
- 确认目标服务器正在运行

---

## 📖 更多帮助

- 📘 详细文档: 查看 `allaboutproject.md`
- 📝 安装指南: 查看 `ai-docs/installation-guide.md`
- 🔄 更新日志: 查看 `changelog.md`

---

## 🎯 下一步

现在你已经成功运行了第一个压测! 接下来可以:

1. ✅ 修改配置测试你自己的 API
2. ✅ 尝试不同的 QPS 和持续时间
3. ✅ 分析结果找出性能瓶颈
4. ✅ 根据需要调整和优化

Happy Testing! 🚀

