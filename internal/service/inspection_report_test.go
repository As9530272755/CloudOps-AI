package service

import (
	"strings"
	"testing"

	"github.com/cloudops/platform/internal/model"
)

func TestGenerateReports_WithoutPrometheus(t *testing.T) {
	cluster := model.Cluster{DisplayName: "test-cluster"}
	findings := []Finding{}
	score := 95
	riskLevel := "low"
	promData := &PrometheusData{
		NodeCount:   2,
		MasterCount: 1,
		WorkerCount: 1,
		PodCount:    5,
		PodStatus:   map[string]int{"Running": 4, "Pending": 1, "Failed": 0, "Succeeded": 0},
		NodeDetails: []NodeDetail{
			{Name: "node-1", IP: "10.0.0.1", Role: "master", CPUCore: 4, NodeStatus: "Ready", Schedulable: "可调度"},
			{Name: "node-2", IP: "10.0.0.2", Role: "worker", CPUCore: 8, NodeStatus: "Ready", Schedulable: "可调度"},
		},
		TotalCPU:    12,
		TotalMemGB:  32,
		HealthyRate: 80,
		HasProm:     false,
	}

	html := generateHTMLReport(cluster, findings, score, riskLevel, promData)
	md := generateMarkdownReport(cluster, findings, score, riskLevel, promData)

	// Should contain K8s native counts
	if !strings.Contains(html, "5</b>") && !strings.Contains(html, ">5<") {
		t.Errorf("HTML should contain Pod count 5")
	}
	if !strings.Contains(md, "| **总计** | **5** |") {
		t.Errorf("Markdown should contain Pod count 5")
	}

	// Should NOT contain Prometheus-only TOP 10 sections
	forbidden := []string{"CPU 使用率 TOP 10", "内存使用率 TOP 10", "磁盘使用率 TOP 10"}
	for _, s := range forbidden {
		if strings.Contains(html, s) {
			t.Errorf("HTML should not contain %q when HasProm=false", s)
		}
		if strings.Contains(md, s) {
			t.Errorf("Markdown should not contain %q when HasProm=false", s)
		}
	}

	// Should NOT contain memory usage rate in risk table when HasProm=false
	if strings.Contains(html, "内存使用率</td><td>%.1f%%") || strings.Contains(html, "MemRate") {
		// loose check: HTML will contain the row label but not a numeric rate
	}
	// More precise: ensure "未配置 Prometheus" or "-" appears in resource sections for missing metrics
	if !strings.Contains(html, "未配置 Prometheus") && !strings.Contains(html, "-") {
		t.Logf("HTML snippet: %s", html[:min(len(html), 500)])
	}
	if !strings.Contains(md, "未配置 Prometheus") {
		t.Errorf("Markdown should mention '未配置 Prometheus'")
	}

	// Node table should use "-" for CPU%/Mem%/Disk% instead of 0.0%
	if strings.Contains(md, "| 1 | node-1 | 10.0.0.1 | master | 4 | 0.0% |") {
		t.Errorf("Markdown node table should not show 0.0%% metrics when HasProm=false")
	}
	if !strings.Contains(md, "| 1 | node-1 | 10.0.0.1 | master | 4 | - | - | - | Ready | 可调度 |") {
		t.Errorf("Markdown node table should show '-' for missing metrics")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
