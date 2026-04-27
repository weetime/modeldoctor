from __future__ import annotations

import json
from pathlib import Path

from runner.metrics import map_guidellm_report_to_summary

FIXTURE = Path(__file__).parent / "fixtures" / "guidellm_report.json"


class TestMapGuidellmReport:
    def test_maps_full_fixture(self) -> None:
        raw = json.loads(FIXTURE.read_text())
        summary = map_guidellm_report_to_summary(raw)
        assert summary == {
            "ttft": {"mean": 120, "p50": 110, "p95": 200, "p99": 320},
            "itl": {"mean": 25, "p50": 22, "p95": 50, "p99": 80},
            # request_latency is in seconds in 0.5.x — mapper multiplies by 1000.
            "e2eLatency": {"mean": 1800, "p50": 1700, "p95": 2500, "p99": 3200},
            "requestsPerSecond": {"mean": 12.4},
            "outputTokensPerSecond": {"mean": 1580},
            "inputTokensPerSecond": {"mean": 12700},
            "totalTokensPerSecond": {"mean": 14280},
            "concurrency": {"mean": 8.2, "max": 12},
            "requests": {"total": 1000, "success": 998, "error": 1, "incomplete": 1},
        }

    def test_empty_benchmarks_yields_zero_summary(self) -> None:
        summary = map_guidellm_report_to_summary({"benchmarks": []})
        # All numeric fields default to 0; no schema violation.
        assert summary["ttft"] == {"mean": 0, "p50": 0, "p95": 0, "p99": 0}
        assert summary["requests"] == {"total": 0, "success": 0, "error": 0, "incomplete": 0}

    def test_missing_metrics_section_defaults_to_zero(self) -> None:
        broken = {"benchmarks": [{"metrics": {"request_totals": {"total": 0}}}]}
        summary = map_guidellm_report_to_summary(broken)
        assert summary["ttft"]["mean"] == 0
        assert summary["concurrency"]["max"] == 0

    def test_null_metric_objects_default_to_zero(self) -> None:
        # guidellm has historically emitted JSON null for absent metric groups
        # or absent status slices. Both shapes must collapse to zeros.
        report = {
            "benchmarks": [
                {
                    "metrics": {
                        "time_to_first_token_ms": None,
                        "request_concurrency": {"successful": None},
                        "request_totals": None,
                    }
                }
            ]
        }
        summary = map_guidellm_report_to_summary(report)
        assert summary["ttft"] == {"mean": 0, "p50": 0, "p95": 0, "p99": 0}
        assert summary["concurrency"] == {"mean": 0, "max": 0}
        assert summary["requests"] == {"total": 0, "success": 0, "error": 0, "incomplete": 0}

    def test_p50_falls_back_to_median_when_percentiles_absent(self) -> None:
        # Older fixtures and some downstream tools surface `median` at the
        # DistributionSummary root and skip the `percentiles` block entirely.
        report = {
            "benchmarks": [
                {"metrics": {"time_to_first_token_ms": {"successful": {"mean": 100, "median": 95}}}}
            ]
        }
        summary = map_guidellm_report_to_summary(report)
        assert summary["ttft"]["mean"] == 100
        assert summary["ttft"]["p50"] == 95  # fell back to .median
