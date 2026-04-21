# Installation and Usage Guide

## Quick Start

### Method 1: Using Start Script (Recommended)

```bash
./start.sh
```

The start script will:
- ✅ Check Node.js installation
- ✅ Check Vegeta installation
- ✅ Install npm dependencies if needed
- ✅ Start the server

### Method 2: Manual Start

```bash
# Install dependencies (first time only)
npm install

# Start server
npm start
```

## Accessing the Web Interface

Once the server is running, open your browser and navigate to:

**http://localhost:3000**

You should see the Vegeta Load Test Control interface.

## Testing the System

### Step 1: Verify Vegeta Status

When you open the web page, you should see a green badge at the top indicating:
```
✅ Vegeta installed at /opt/homebrew/bin/vegeta
```

### Step 2: Run a Quick Test

Use the pre-filled default values:

1. **API Configuration**
   - API URL: `http://10.100.121.67:30888/v1/chat/completions`
   - API Key: `sk-…` (set per environment)
   - Model: `gen-studio-Qwen2.5-0.5B`

2. **Request Parameters**
   - Prompt: `天为何是蓝色的`
   - Max Tokens: `1000`
   - Temperature: `0.7`

3. **Load Test Parameters**
   - QPS: `2`
   - Duration: `120` seconds

4. Click **"Start Load Test"** button

### Step 3: View Results

After the test completes, you'll see:
- ✅ Success message
- 📊 Key metrics cards showing:
  - Total requests
  - Success rate
  - Throughput
  - Latency percentiles (P50, P95, P99)
- 📄 Detailed Vegeta report
- ⚙️ Test configuration used

## Troubleshooting

### Issue: "Vegeta not installed" message

**Solution:**
```bash
# macOS
brew install vegeta

# Linux
wget https://github.com/tsenart/vegeta/releases/download/v12.8.4/vegeta_12.8.4_linux_amd64.tar.gz
tar xzf vegeta_12.8.4_linux_amd64.tar.gz
sudo mv vegeta /usr/local/bin/
```

### Issue: Port 3000 already in use

**Solution:**

Option 1 - Change port in `server.js`:
```javascript
const PORT = 3001; // Change to another port
```

Option 2 - Kill the process using port 3000:
```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### Issue: npm install fails

**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

### Issue: Load test returns 401 Unauthorized

**Solution:**
- Verify your API Key is correct
- Check if the API endpoint requires authentication
- Ensure you have proper access permissions

### Issue: Load test times out

**Solution:**
- Check if the API endpoint is accessible from your machine
- Verify network connectivity
- Try reducing QPS or duration for initial tests
- Check server logs for detailed error messages

## Server Logs

The server outputs detailed logs in the terminal:

```
🚀 Starting load test with configuration: {...}
✅ Created request.json
✅ Created request.txt
🔨 Executing Vegeta command: cat request.txt | vegeta attack...
✅ Load test completed successfully
📊 Results: ...
```

Monitor these logs for debugging.

## Advanced Usage

### Custom Configuration

Edit the default values in `public/index.html` to match your most common use case:

```html
<input 
    type="text" 
    id="apiUrl" 
    value="http://your-api-endpoint.com"
>
```

### Command Line Testing

You can also test Vegeta directly from command line:

```bash
# Create request files
cat > request.txt << EOF
POST http://10.100.121.67:30888/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-xxx
@request.json
EOF

cat > request.json << EOF
{
  "model": "gen-studio-Qwen2.5-0.5B",
  "messages": [{"role": "user", "content": "test"}],
  "max_tokens": 1000,
  "temperature": 0.7
}
EOF

# Run test
cat request.txt | vegeta attack -rate=2 -duration=10s | vegeta report
```

## Performance Tips

### For High QPS Tests

1. **Start low**: Begin with low QPS (e.g., 2-5) to verify everything works
2. **Gradually increase**: Double QPS each test until you find the limit
3. **Monitor resources**: Watch CPU, memory, and network usage
4. **Use shorter durations**: For high QPS, start with 10-30 seconds

### For Long Duration Tests

1. **Use reasonable QPS**: Don't overload the target server
2. **Monitor progress**: Check server logs
3. **Be patient**: Tests can take several minutes to complete
4. **Save results**: Results will be displayed after completion

## System Requirements

- **Node.js**: v14.0.0 or higher
- **RAM**: 512MB minimum
- **Disk Space**: 100MB minimum
- **Network**: Stable internet connection
- **Vegeta**: Latest version (v12.8.4+)

## Security Considerations

1. **API Keys**: Never commit API keys to version control
2. **Rate Limits**: Respect target API rate limits
3. **Resource Usage**: High QPS tests consume significant resources
4. **Target Permissions**: Ensure you have permission to test the target API

## Next Steps

After successful installation and testing:

1. ✅ Customize default values for your use case
2. ✅ Run tests with different QPS and durations
3. ✅ Analyze results to understand API performance
4. ✅ Document findings for your team
5. ✅ Consider extending the system with new features

## Getting Help

- Check `allaboutproject.md` for detailed documentation
- Review `changelog.md` for version history
- Check server logs for error messages
- Verify Vegeta documentation: https://github.com/tsenart/vegeta

## Feedback

If you encounter issues or have suggestions, please document them in the `ai-docs/` directory.

