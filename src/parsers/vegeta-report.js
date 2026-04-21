/**
 * Parses Vegeta report text output into structured data.
 * @param {string} report - Raw Vegeta report text.
 * @returns {object} Parsed report.
 */
function parseVegetaReport(report) {
  const parsed = {
    requests: null,
    rate: null,
    throughput: null,
    duration: null,
    latencies: {},
    bytesIn: null,
    bytesOut: null,
    success: null,
    statusCodes: {},
  };

  const lines = report.split("\n");

  lines.forEach((line) => {
    if (line.includes("Requests") && line.includes("[total")) {
      const match = line.match(/Requests\s+\[.*?\]\s+([\d.]+)/);
      if (match) parsed.requests = parseInt(match[1]);

      const valuesMatch = line.match(/\]\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
      if (valuesMatch) {
        parsed.requests = parseInt(valuesMatch[1]);
        parsed.rate = parseFloat(valuesMatch[2]);
        parsed.throughput = parseFloat(valuesMatch[3]);
      }
    }

    if (line.includes("Duration") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+[a-z]+)/);
      if (match) parsed.duration = match[1];
    }

    if (line.includes("Latencies") && line.includes("[min")) {
      const valuesMatch = line.match(
        /\]\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+)/,
      );
      if (valuesMatch) {
        parsed.latencies.min = valuesMatch[1];
        parsed.latencies.mean = valuesMatch[2];
        parsed.latencies.p50 = valuesMatch[3];
        parsed.latencies.p90 = valuesMatch[4];
        parsed.latencies.p95 = valuesMatch[5];
        parsed.latencies.p99 = valuesMatch[6];
        parsed.latencies.max = valuesMatch[7];
      }
    }

    if (line.includes("Bytes In") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match) parsed.bytesIn = parseInt(match[1]);
    }

    if (line.includes("Bytes Out") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match) parsed.bytesOut = parseInt(match[1]);
    }

    if (line.includes("Success") && line.includes("[ratio]")) {
      const match = line.match(/\]\s+([\d.]+)%/);
      if (match) parsed.success = parseFloat(match[1]);
    }

    if (line.includes("Status Codes") && line.includes("[code:count]")) {
      const match = line.match(/\[code:count\]\s+(.*)/);
      if (match) {
        const codes = match[1].trim().split(/\s+/);
        codes.forEach((code) => {
          const [status, count] = code.split(":");
          if (status && count) {
            parsed.statusCodes[status] = parseInt(count);
          }
        });
      }
    }
  });

  return parsed;
}

module.exports = { parseVegetaReport };
