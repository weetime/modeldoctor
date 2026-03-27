#!/bin/bash

# Vegeta Load Test Control - Start Script

echo "🚀 Starting Vegeta Load Test Control System..."
echo ""

# Check if Node.js is installed.
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if Vegeta is installed.
if ! command -v vegeta &> /dev/null; then
    echo "⚠️  Warning: Vegeta is not installed"
    echo "Install with:"
    echo "  macOS: brew install vegeta"
    echo "  Linux: Download from https://github.com/tsenart/vegeta/releases"
    echo ""
else
    echo "✅ Vegeta installed: $(which vegeta)"
fi

# Check if node_modules exists.
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

echo ""
echo "🎉 All checks passed!"
echo "🌐 Starting server on http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop the server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the server.
node server.js

