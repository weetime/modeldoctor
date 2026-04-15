// DOM elements.
const form = document.getElementById('loadTestForm');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const resultsSection = document.getElementById('resultsSection');
const loadingIndicator = document.getElementById('loadingIndicator');
const statusMessage = document.getElementById('statusMessage');
const keyMetrics = document.getElementById('keyMetrics');
const rawReport = document.getElementById('rawReport');
const testConfig = document.getElementById('testConfig');
const loadingDetails = document.getElementById('loadingDetails');
const vegetaStatus = document.getElementById('vegetaStatus');
const parseCurlBtn = document.getElementById('parseCurlBtn');
const curlInput = document.getElementById('curlInput');
const curlFeedback = document.getElementById('curlFeedback');
const apiTypeSelect = document.getElementById('apiType');

// API type parameter sections.
const paramSections = {
    chat: document.getElementById('chatParams'),
    embeddings: document.getElementById('embeddingsParams'),
    rerank: document.getElementById('rerankParams'),
    images: document.getElementById('imagesParams'),
};

// URL path suffixes per API type.
const apiTypePaths = {
    chat: '/v1/chat/completions',
    embeddings: '/v1/embeddings',
    rerank: '/rerank',
    images: '/v1/images/generations',
};

// Check if Vegeta is installed on page load.
checkVegetaInstallation();

/**
 * Handles API type switching: shows/hides parameter sections and updates URL.
 */
apiTypeSelect.addEventListener('change', () => {
    const selectedType = apiTypeSelect.value;

    // Show/hide parameter sections.
    for (const [type, section] of Object.entries(paramSections)) {
        section.style.display = type === selectedType ? '' : 'none';
    }

    // Auto-update URL path suffix.
    const currentUrl = document.getElementById('apiUrl').value;
    try {
        const url = new URL(currentUrl);
        // Remove known path suffixes then append new one.
        let pathname = url.pathname;
        for (const suffix of Object.values(apiTypePaths)) {
            if (pathname.endsWith(suffix)) {
                pathname = pathname.slice(0, -suffix.length);
                break;
            }
        }
        url.pathname = pathname + apiTypePaths[selectedType];
        document.getElementById('apiUrl').value = url.toString();
    } catch (e) {
        // If URL is not valid, just leave it.
    }
});

/**
 * Parses a curl command string and extracts URL, headers, and body.
 * @param {string} curlStr - The curl command string.
 * @returns {object} Parsed curl data.
 */
function parseCurlCommand(curlStr) {
    const result = { url: '', headers: {}, body: null, queryParams: '' };

    // Normalize: join continuation lines and collapse whitespace.
    let cmd = curlStr.replace(/\\\s*\n/g, ' ').trim();

    // Remove leading 'curl' keyword.
    cmd = cmd.replace(/^curl\s+/, '');

    // Extract URL (first non-flag argument or after explicit flags).
    const urlPatterns = [
        /(?:^|\s)['"]?(https?:\/\/[^\s'"]+)['"]?/,
        /(?:^|\s)([^\s-][^\s]*)/
    ];
    for (const pattern of urlPatterns) {
        const match = cmd.match(pattern);
        if (match && match[1] && (match[1].startsWith('http://') || match[1].startsWith('https://'))) {
            result.url = match[1].replace(/['"]$/, '');
            break;
        }
    }

    // Extract query params from URL.
    if (result.url) {
        try {
            const url = new URL(result.url);
            if (url.search) {
                const params = [];
                url.searchParams.forEach((value, key) => {
                    params.push(`${key}=${value}`);
                });
                result.queryParams = params.join('\n');
                // Store clean URL without query params.
                url.search = '';
                result.url = url.toString();
            }
        } catch (e) {
            // Leave URL as-is.
        }
    }

    // Extract headers (-H or --header).
    const headerRegex = /(?:-H|--header)\s+['"]([^'"]+)['"]/g;
    let headerMatch;
    while ((headerMatch = headerRegex.exec(cmd)) !== null) {
        const colonIndex = headerMatch[1].indexOf(':');
        if (colonIndex > 0) {
            const key = headerMatch[1].substring(0, colonIndex).trim();
            const value = headerMatch[1].substring(colonIndex + 1).trim();
            result.headers[key.toLowerCase()] = { originalKey: key, value };
        }
    }

    // Extract body (-d or --data or --data-raw).
    const bodyRegex = /(?:-d|--data-raw|--data)\s+'([\s\S]*?)(?:(?<!\\)')/;
    const bodyMatch = cmd.match(bodyRegex);
    if (bodyMatch) {
        try {
            result.body = JSON.parse(bodyMatch[1]);
        } catch (e) {
            try {
                result.body = JSON.parse(bodyMatch[1].replace(/\\'/g, "'"));
            } catch (e2) {
                console.warn('Failed to parse curl body as JSON:', e2);
            }
        }
    }

    // Try double-quoted body if single-quote didn't match.
    if (!result.body) {
        const bodyRegex2 = /(?:-d|--data-raw|--data)\s+"([\s\S]*?)(?:(?<!\\)")/;
        const bodyMatch2 = cmd.match(bodyRegex2);
        if (bodyMatch2) {
            try {
                result.body = JSON.parse(bodyMatch2[1].replace(/\\"/g, '"'));
            } catch (e) {
                console.warn('Failed to parse curl body as JSON:', e);
            }
        }
    }

    return result;
}

/**
 * Detects API type from URL path and request body.
 * @param {string} url - The request URL.
 * @param {object|null} body - Parsed request body.
 * @returns {string} Detected API type: 'chat', 'embeddings', or 'rerank'.
 */
function detectApiType(url, body) {
    // Detect from URL path.
    if (url.includes('/v1/images/generations') || url.includes('/images/generations')) {
        return 'images';
    }
    if (url.includes('/v1/embeddings') || url.includes('/embeddings')) {
        return 'embeddings';
    }
    if (url.includes('/rerank')) {
        return 'rerank';
    }

    // Detect from body keys.
    if (body) {
        if (body.prompt && !body.messages) return 'images';
        if (body.input && !body.messages) return 'embeddings';
        if (body.query && body.texts) return 'rerank';
    }

    return 'chat';
}

/**
 * Parse curl button handler.
 */
parseCurlBtn.addEventListener('click', () => {
    const curlStr = curlInput.value.trim();
    if (!curlStr) {
        curlFeedback.textContent = 'Please paste a curl command first';
        curlFeedback.className = 'curl-feedback error';
        return;
    }

    const parsed = parseCurlCommand(curlStr);
    let filled = [];

    // Detect and set API type.
    if (parsed.url || parsed.body) {
        const detectedType = detectApiType(parsed.url || '', parsed.body);
        apiTypeSelect.value = detectedType;
        apiTypeSelect.dispatchEvent(new Event('change'));
        filled.push(`Type (${detectedType})`);
    }

    if (parsed.url) {
        document.getElementById('apiUrl').value = parsed.url;
        filled.push('URL');
    }

    // Extract API key from Authorization header.
    const authEntry = parsed.headers['authorization'];
    if (authEntry) {
        const apiKey = authEntry.value.replace(/^Bearer\s+/i, '');
        document.getElementById('apiKey').value = apiKey;
        filled.push('API Key');
    }

    // Fill query params.
    if (parsed.queryParams) {
        document.getElementById('queryParams').value = parsed.queryParams;
        filled.push('Query Params');
    }

    // Collect custom headers (exclude content-type and authorization).
    const skipHeaders = ['content-type', 'authorization'];
    const customHeaderLines = [];
    for (const [lowerKey, entry] of Object.entries(parsed.headers)) {
        if (!skipHeaders.includes(lowerKey)) {
            customHeaderLines.push(`${entry.originalKey}: ${entry.value}`);
        }
    }
    if (customHeaderLines.length > 0) {
        document.getElementById('customHeaders').value = customHeaderLines.join('\n');
        filled.push('Custom Headers');
    }

    // Fill body fields based on detected type.
    if (parsed.body) {
        if (parsed.body.model) {
            document.getElementById('model').value = parsed.body.model;
            filled.push('Model');
        }

        const apiType = apiTypeSelect.value;

        if (apiType === 'chat') {
            if (parsed.body.messages && parsed.body.messages.length > 0) {
                const userMsg = [...parsed.body.messages].reverse().find(m => m.role === 'user');
                if (userMsg && userMsg.content) {
                    document.getElementById('prompt').value = userMsg.content;
                    filled.push('Prompt');
                }
            }
            if (parsed.body.max_tokens !== undefined) {
                document.getElementById('maxTokens').value = parsed.body.max_tokens;
                filled.push('Max Tokens');
            }
            if (parsed.body.temperature !== undefined) {
                document.getElementById('temperature').value = parsed.body.temperature;
                filled.push('Temperature');
            }
            if (parsed.body.stream !== undefined) {
                document.getElementById('stream').checked = !!parsed.body.stream;
                filled.push('Stream');
            }
        } else if (apiType === 'embeddings') {
            if (parsed.body.input) {
                const inputText = Array.isArray(parsed.body.input) ? parsed.body.input.join('\n') : parsed.body.input;
                document.getElementById('embeddingInput').value = inputText;
                filled.push('Input');
            }
        } else if (apiType === 'rerank') {
            if (parsed.body.query) {
                document.getElementById('rerankQuery').value = parsed.body.query;
                filled.push('Query');
            }
            if (parsed.body.texts) {
                document.getElementById('rerankTexts').value = parsed.body.texts.join('\n');
                filled.push('Texts');
            }
        } else if (apiType === 'images') {
            if (parsed.body.prompt) {
                document.getElementById('imagePrompt').value = parsed.body.prompt;
                filled.push('Prompt');
            }
            if (parsed.body.size) {
                document.getElementById('imageSize').value = parsed.body.size;
                filled.push('Size');
            }
            if (parsed.body.n) {
                document.getElementById('imageN').value = parsed.body.n;
                filled.push('N');
            }
        }
    }

    if (filled.length > 0) {
        curlFeedback.textContent = `Filled: ${filled.join(', ')}`;
        curlFeedback.className = 'curl-feedback success';
    } else {
        curlFeedback.textContent = 'Could not extract parameters from curl command';
        curlFeedback.className = 'curl-feedback error';
    }
});

/**
 * Checks if Vegeta is installed on the system.
 */
async function checkVegetaInstallation() {
    try {
        const response = await fetch('/api/check-vegeta');
        const data = await response.json();

        if (data.installed) {
            vegetaStatus.textContent = `✅ Vegeta installed at ${data.path}`;
            vegetaStatus.className = 'status-badge installed';
        } else {
            vegetaStatus.textContent = '❌ Vegeta not installed';
            vegetaStatus.className = 'status-badge not-installed';
        }
    } catch (error) {
        console.error('Failed to check Vegeta installation:', error);
        vegetaStatus.textContent = '⚠️ Unable to check Vegeta status';
        vegetaStatus.className = 'status-badge not-installed';
    }
}

/**
 * Builds the request config from form based on API type.
 * @returns {object} Request configuration.
 */
function buildConfig() {
    const formData = new FormData(form);
    const apiType = apiTypeSelect.value;

    const config = {
        apiType,
        apiUrl: formData.get('apiUrl'),
        apiKey: formData.get('apiKey'),
        model: formData.get('model'),
        customHeaders: formData.get('customHeaders') || '',
        queryParams: formData.get('queryParams') || '',
        rate: parseInt(formData.get('rate')),
        duration: parseInt(formData.get('duration')),
    };

    if (apiType === 'chat') {
        config.prompt = formData.get('prompt');
        config.maxTokens = parseInt(formData.get('maxTokens'));
        config.temperature = parseFloat(formData.get('temperature'));
        config.stream = document.getElementById('stream').checked;
    } else if (apiType === 'embeddings') {
        config.embeddingInput = formData.get('embeddingInput');
    } else if (apiType === 'rerank') {
        config.rerankQuery = formData.get('rerankQuery');
        config.rerankTexts = formData.get('rerankTexts');
    } else if (apiType === 'images') {
        config.imagePrompt = formData.get('imagePrompt');
        config.imageSize = formData.get('imageSize');
        config.imageN = parseInt(formData.get('imageN')) || 1;
    }

    return config;
}

/**
 * Form submit handler - starts the load test.
 */
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const config = buildConfig();

    // Validate form.
    if (!validateForm(config)) {
        return;
    }

    // Show loading indicator.
    showLoading(config);

    // Hide previous results.
    resultsSection.style.display = 'none';

    try {
        const response = await fetch('/api/load-test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        hideLoading();

        if (result.success) {
            displayResults(result);
            saveToHistory(config);
        } else {
            displayError(result.error);
        }

    } catch (error) {
        hideLoading();
        displayError(`Network error: ${error.message}`);
    }
});

/**
 * Reset button handler.
 */
resetBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all fields?')) {
        form.reset();
        resultsSection.style.display = 'none';
        // Reset to chat type view.
        apiTypeSelect.value = 'chat';
        apiTypeSelect.dispatchEvent(new Event('change'));
    }
});

/**
 * Validates form data.
 * @param {object} config - Form configuration object.
 * @returns {boolean} True if valid, false otherwise.
 */
function validateForm(config) {
    if (!config.apiUrl || !config.apiKey || !config.model) {
        alert('Please fill in all required fields (marked with *)');
        return false;
    }

    try {
        new URL(config.apiUrl);
    } catch (e) {
        alert('Invalid API URL format');
        return false;
    }

    // Type-specific validation.
    if (config.apiType === 'chat' && !config.prompt) {
        alert('Please enter a user prompt');
        return false;
    }
    if (config.apiType === 'embeddings' && !config.embeddingInput) {
        alert('Please enter input text for embeddings');
        return false;
    }
    if (config.apiType === 'rerank' && (!config.rerankQuery || !config.rerankTexts)) {
        alert('Please enter both query and texts for rerank');
        return false;
    }
    if (config.apiType === 'images' && !config.imagePrompt) {
        alert('Please enter a prompt for image generation');
        return false;
    }

    if (config.rate < 1 || config.rate > 10000) {
        alert('QPS must be between 1 and 10000');
        return false;
    }

    if (config.duration < 1 || config.duration > 3600) {
        alert('Duration must be between 1 and 3600 seconds');
        return false;
    }

    return true;
}

/**
 * Shows loading indicator with test details.
 * @param {object} config - Test configuration.
 */
function showLoading(config) {
    loadingIndicator.style.display = 'block';
    startBtn.disabled = true;

    const totalRequests = config.rate * config.duration;
    const estimatedTime = config.duration;
    const typeLabels = { chat: 'Chat Completion', embeddings: 'Embeddings', rerank: 'Rerank', images: 'Image Generation' };

    const lines = [
        `API Type: ${typeLabels[config.apiType]}`,
        `Testing at ${config.rate} req/s for ${config.duration} seconds`,
        `Expected total: ~${totalRequests} requests`,
        `Estimated time: ${formatDuration(estimatedTime)}`
    ];

    loadingDetails.innerHTML = lines.map(line => escapeHtml(line)).join('<br>');
}

/**
 * Hides loading indicator.
 */
function hideLoading() {
    loadingIndicator.style.display = 'none';
    startBtn.disabled = false;
}

/**
 * Displays successful test results.
 * @param {object} result - Test result object from server.
 */
function displayResults(result) {
    resultsSection.style.display = 'block';

    statusMessage.className = 'status-message success';
    statusMessage.textContent = '✅ Load test completed successfully!';

    displayKeyMetrics(result.parsed);

    rawReport.textContent = result.report;

    testConfig.textContent = JSON.stringify(result.config, null, 2);

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Escapes HTML to prevent XSS attacks.
 * @param {string} text - Text to escape.
 * @returns {string} Escaped text.
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Displays key metrics in card format.
 * @param {object} parsed - Parsed Vegeta report data.
 */
function displayKeyMetrics(parsed) {
    const metrics = [
        {
            label: 'Total Requests',
            value: parsed.requests || 'N/A',
            unit: ''
        },
        {
            label: 'Success Rate',
            value: parsed.success !== null ? parsed.success.toFixed(2) : 'N/A',
            unit: '%'
        },
        {
            label: 'Throughput',
            value: parsed.throughput !== null ? parsed.throughput.toFixed(2) : 'N/A',
            unit: 'req/s'
        },
        {
            label: 'Mean Latency',
            value: parsed.latencies.mean || 'N/A',
            unit: ''
        },
        {
            label: 'P50 Latency',
            value: parsed.latencies.p50 || 'N/A',
            unit: ''
        },
        {
            label: 'P95 Latency',
            value: parsed.latencies.p95 || 'N/A',
            unit: ''
        },
        {
            label: 'P99 Latency',
            value: parsed.latencies.p99 || 'N/A',
            unit: ''
        },
        {
            label: 'Max Latency',
            value: parsed.latencies.max || 'N/A',
            unit: ''
        }
    ];

    keyMetrics.innerHTML = metrics.map(metric => `
        <div class="metric-card">
            <div class="metric-label">${escapeHtml(metric.label)}</div>
            <div class="metric-value">
                ${escapeHtml(String(metric.value))}
                <span class="metric-unit">${escapeHtml(metric.unit)}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Displays error message.
 * @param {string} error - Error message.
 */
function displayError(error) {
    resultsSection.style.display = 'block';

    statusMessage.className = 'status-message error';
    statusMessage.textContent = `❌ Error: ${error}`;

    keyMetrics.innerHTML = '';
    rawReport.textContent = 'No report available due to error.';
    testConfig.textContent = '';

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Saves test configuration to local storage history.
 * @param {object} config - Test configuration.
 */
function saveToHistory(config) {
    try {
        const history = JSON.parse(localStorage.getItem('testHistory') || '[]');

        const record = {
            ...config,
            timestamp: new Date().toISOString()
        };

        history.unshift(record);
        if (history.length > 10) {
            history.pop();
        }

        localStorage.setItem('testHistory', JSON.stringify(history));
    } catch (error) {
        console.error('Failed to save to history:', error);
    }
}

/**
 * Formats duration in seconds to human-readable string.
 * @param {number} seconds - Duration in seconds.
 * @returns {string} Formatted duration string.
 */
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
}

console.log('🚀 Vegeta Load Test Control initialized');
console.log('📝 Ready to configure and run load tests');
