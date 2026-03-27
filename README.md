# Vegeta Load Test Control System

A modern web-based interface for controlling and managing Vegeta HTTP load tests. Perfect for testing LLM APIs and any HTTP endpoints.

> 📖 **[快速上手指南 QUICKSTART.md](./QUICKSTART.md)** - 30秒快速启动!

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v14 or higher)
   ```bash
   node --version
   ```

2. **Vegeta** load testing tool
   ```bash
   # macOS
   brew install vegeta
   
   # Linux
   wget https://github.com/tsenart/vegeta/releases/download/v12.8.4/vegeta_12.8.4_linux_amd64.tar.gz
   tar xzf vegeta_12.8.4_linux_amd64.tar.gz
   sudo mv vegeta /usr/local/bin/
   ```

### Installation

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open your browser and navigate to: **http://localhost:3000**

## ✨ Features

- 🎯 **Easy Configuration**: Web interface for all test parameters
- ⚡ **Real-time Results**: Instant feedback on test completion
- 📊 **Detailed Metrics**: Latency percentiles, throughput, success rates
- 💾 **History Tracking**: Auto-save test configurations
- 🎨 **Modern UI**: Clean, responsive design
- 🔍 **Vegeta Check**: Automatic installation verification

## 📖 Usage

1. **Configure API Settings**
   - API URL (e.g., `http://your-api.com/v1/chat/completions`)
   - API Key
   - Model Name

2. **Set Request Parameters**
   - User Prompt
   - Max Tokens
   - Temperature

3. **Configure Load Test**
   - QPS (Requests per second)
   - Duration (seconds)

4. **Run Test**
   - Click "Start Load Test"
   - View results in real-time

## 📁 Project Structure

```
vegeta-test/
├── server.js           # Express backend
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Web interface
│   ├── style.css       # Styling
│   └── app.js          # Frontend logic
├── request.txt         # Vegeta request file
├── request.json        # Request body
└── allaboutproject.md  # Detailed docs
```

## 🔧 API Endpoints

- `GET /api/health` - Health check
- `GET /api/check-vegeta` - Verify Vegeta installation
- `POST /api/load-test` - Execute load test

## 📚 Documentation

See [allaboutproject.md](./allaboutproject.md) for comprehensive documentation including:
- Detailed architecture
- API specifications
- Troubleshooting guide
- Extension suggestions

## 🤝 Contributing

Task tracking and documentation can be found in the `ai-docs/` directory.

## 📝 License

MIT

---

**Version**: 1.0.1  
**Last Updated**: 2025-11-06
