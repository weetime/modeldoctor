# Demo Walkthrough - 演示说明

## 界面预览

当你打开 http://localhost:3000 后,你会看到以下界面:

### 1. 页面头部

```
🚀 Vegeta Load Test Control
Configure and execute HTTP load tests with ease

✅ Vegeta installed at /opt/homebrew/bin/vegeta
```

### 2. 配置表单

#### 🔌 API Configuration Section
```
┌─────────────────────────────────────────────┐
│ API URL *                                   │
│ [http://10.100.121.67:30888/v1/chat/...]   │
│                                             │
│ API Key *                  Model Name *     │
│ [sk-YAUT...]              [gen-studio-...] │
└─────────────────────────────────────────────┘
```

#### 📝 Request Parameters Section
```
┌─────────────────────────────────────────────┐
│ User Prompt *                               │
│ [天为何是蓝色的                            │
│                                          ]  │
│                                             │
│ Max Tokens        Temperature               │
│ [1000]           [0.7]                     │
└─────────────────────────────────────────────┘
```

#### ⚡ Load Test Parameters Section
```
┌─────────────────────────────────────────────┐
│ QPS (Requests/sec) *    Duration (seconds) *│
│ [2]                     [120]               │
│ Number of requests      How long to run     │
│ per second              the test            │
└─────────────────────────────────────────────┘
```

### 3. 操作按钮

```
┌───────────────────┐  ┌──────────────┐
│ 🚀 Start Load Test│  │ 🔄 Reset     │
└───────────────────┘  └──────────────┘
```

### 4. 运行中状态

点击"Start Load Test"后,会显示加载动画:

```
┌─────────────────────────────────────────────┐
│              [旋转动画]                      │
│                                             │
│   Running load test... Please wait         │
│                                             │
│   Testing at 2 req/s for 120 seconds       │
│   Expected total: ~240 requests            │
│   Estimated time: 2m                       │
└─────────────────────────────────────────────┘
```

### 5. 结果展示

测试完成后,显示详细结果:

```
📊 Test Results
─────────────────────────────────────────────

✅ Load test completed successfully!

┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Total       │ Success     │ Throughput  │ Mean        │
│ Requests    │ Rate        │             │ Latency     │
│ 240         │ 100.00%     │ 2.00 req/s  │ 156.23ms    │
└─────────────┴─────────────┴─────────────┴─────────────┘

┌─────────────┬─────────────┬─────────────┬─────────────┐
│ P50         │ P95         │ P99         │ Max         │
│ Latency     │ Latency     │ Latency     │ Latency     │
│ 150.12ms    │ 189.45ms    │ 205.67ms    │ 234.89ms    │
└─────────────┴─────────────┴─────────────┴─────────────┘

📄 Detailed Report
─────────────────────────────────────────────
Requests      [total, rate, throughput]         240, 2.00, 2.00
Duration      [total, attack, wait]             2m0s, 2m0s, 156.23ms
Latencies     [min, mean, 50, 95, 99, max]      123.45ms, 156.23ms, 150.12ms, 189.45ms, 205.67ms, 234.89ms
Bytes In      [total, mean]                     480000, 2000.00
Bytes Out     [total, mean]                     72000, 300.00
Success       [ratio]                           100.00%
Status Codes  [code:count]                      200:240

⚙️ Test Configuration
─────────────────────────────────────────────
{
  "apiUrl": "http://10.100.121.67:30888/v1/chat/completions",
  "model": "gen-studio-Qwen2.5-0.5B",
  "rate": 2,
  "duration": 120,
  "prompt": "天为何是蓝色的"
}
```

## 交互流程

### 完整测试流程

```
1. 访问页面
   └─> 系统自动检查 Vegeta 安装状态
       └─> 显示绿色徽章 ✅

2. 查看预填配置
   └─> 所有字段都有合理的默认值
       └─> 可以直接使用或修改

3. 点击"开始压测"
   └─> 前端验证表单
       └─> 发送 POST 请求到 /api/load-test
           └─> 后端生成 request.txt 和 request.json
               └─> 执行 Vegeta 命令
                   └─> 解析结果
                       └─> 返回前端

4. 显示结果
   └─> 成功: 显示绿色消息 + 详细指标
   └─> 失败: 显示红色消息 + 错误信息

5. 查看历史
   └─> 配置自动保存到 LocalStorage
       └─> 保留最近 10 条记录
```

## 用户体验亮点

### 1. 即时反馈
- ✅ Vegeta 安装状态实时显示
- ✅ 表单验证即时提示
- ✅ 加载动画流畅自然
- ✅ 结果展示清晰直观

### 2. 合理默认值
- ✅ 所有字段预填示例值
- ✅ 新手可以直接点击测试
- ✅ 减少配置错误

### 3. 响应式设计
- ✅ 桌面端: 双列布局
- ✅ 移动端: 单列布局
- ✅ 按钮和卡片自适应

### 4. 视觉层次
- ✅ 清晰的区域划分
- ✅ 图标增强识别性
- ✅ 颜色传达状态信息

### 5. 错误处理
- ✅ 友好的错误提示
- ✅ 详细的错误信息
- ✅ 建议的解决方案

## 常见使用场景

### 场景 1: 快速验证 API
```
目的: 验证 API 是否正常工作
配置:
  - QPS: 1
  - Duration: 10
操作: 点击"开始压测"
预期: 10 个请求,100% 成功率
```

### 场景 2: 性能基线测试
```
目的: 建立性能基线
配置:
  - QPS: 5
  - Duration: 60
操作: 运行多次,记录平均延迟
预期: 获得稳定的性能数据
```

### 场景 3: 压力测试
```
目的: 找出系统极限
配置:
  - QPS: 从 10 开始,逐步增加
  - Duration: 120
操作: 观察成功率和延迟变化
预期: 找到最大稳定 QPS
```

### 场景 4: 持久性测试
```
目的: 测试长时间稳定性
配置:
  - QPS: 2
  - Duration: 3600 (1小时)
操作: 运行后查看是否有性能衰减
预期: 稳定的延迟和成功率
```

## 指标解读

### Total Requests
- 实际发送的请求总数
- 应该等于 QPS × Duration
- 如果少于预期,说明出现了问题

### Success Rate
- 成功请求的百分比
- 100% 表示所有请求都成功
- < 100% 需要检查错误原因

### Throughput
- 实际的吞吐量(req/s)
- 应该接近设定的 QPS
- 如果差异大,可能是服务器性能问题

### Latencies
- **Mean**: 平均延迟,整体性能指标
- **P50**: 中位数,50% 的请求延迟
- **P95**: 95分位,95% 的请求延迟
- **P99**: 99分位,99% 的请求延迟
- **Max**: 最大延迟,可能是异常情况

### 如何判断性能好坏?

```
优秀:
  Success Rate: 100%
  P95 < P50 * 1.5
  Max < P99 * 1.2

良好:
  Success Rate: > 99%
  P95 < P50 * 2
  Max < P99 * 1.5

需要优化:
  Success Rate: < 99%
  P95 > P50 * 2
  Max > P99 * 2
```

## 调试技巧

### 1. 查看服务器日志
```bash
# 服务器终端会显示:
🚀 Starting load test with configuration: ...
✅ Created request.json
✅ Created request.txt
🔨 Executing Vegeta command: ...
```

### 2. 查看浏览器控制台
```javascript
// 按 F12 打开开发者工具
// Console 标签会显示:
🚀 Vegeta Load Test Control initialized
📝 Ready to configure and run load tests
```

### 3. 检查网络请求
```
Network 标签:
- POST /api/load-test
  - Status: 200 (成功)
  - Response: { success: true, report: "...", ... }
```

### 4. 手动测试 Vegeta
```bash
# 直接运行命令验证
cd /Users/fangyong/vllm/vegeta-test
cat request.txt | vegeta attack -rate=2 -duration=10s | vegeta report
```

## 性能优化建议

### 客户端优化
1. 首次测试使用低 QPS 验证配置
2. 逐步增加 QPS 找到最优值
3. 观察延迟趋势,避免过载

### 服务端优化
1. 监控服务器 CPU/内存使用
2. 检查网络带宽是否充足
3. 考虑增加服务器资源

### 网络优化
1. 确保网络稳定
2. 考虑在同一数据中心测试
3. 避免 NAT 或代理影响

## 总结

这个 Web 界面提供了:
- ✅ 直观的可视化配置
- ✅ 实时的测试反馈
- ✅ 详细的结果分析
- ✅ 友好的用户体验

让 Vegeta 压测变得简单高效! 🚀

