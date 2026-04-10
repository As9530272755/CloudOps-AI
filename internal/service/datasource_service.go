package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/cloudops/platform/internal/model"
)

// DatasourceService 数据源服务
type DatasourceService struct {
	db *gorm.DB
}

// NewDatasourceService 创建数据源服务
func NewDatasourceService(db *gorm.DB) *DatasourceService {
	return &DatasourceService{db: db}
}

// CreateDataSourceRequest 创建数据源请求
type CreateDataSourceRequest struct {
	Name      string `json:"name" binding:"required"`
	Type      string `json:"type" binding:"required"`
	URL       string `json:"url" binding:"required,url"`
	Config    string `json:"config"`
	IsDefault bool   `json:"is_default"`
}

// CreateDataSource 创建数据源
func (s *DatasourceService) CreateDataSource(ctx context.Context, tenantID uint, req *CreateDataSourceRequest) (*model.DataSource, error) {
	// 如果设置为默认，先取消其他默认
	if req.IsDefault {
		s.db.Model(&model.DataSource{}).Where("tenant_id = ? AND type = ?", tenantID, req.Type).Update("is_default", false)
	}

	ds := &model.DataSource{
		TenantID:  tenantID,
		Name:      req.Name,
		Type:      req.Type,
		URL:       req.URL,
		Config:    req.Config,
		IsDefault: req.IsDefault,
		IsActive:  true,
	}
	if err := s.db.WithContext(ctx).Create(ds).Error; err != nil {
		return nil, fmt.Errorf("create datasource failed: %w", err)
	}
	return ds, nil
}

// ListDataSources 获取数据源列表
func (s *DatasourceService) ListDataSources(ctx context.Context, tenantID uint, dsType string) ([]model.DataSource, error) {
	var list []model.DataSource
	db := s.db.WithContext(ctx).Where("tenant_id = ?", tenantID)
	if dsType != "" {
		db = db.Where("type = ?", dsType)
	}
	if err := db.Order("is_default DESC, id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// GetDataSource 获取数据源详情
func (s *DatasourceService) GetDataSource(ctx context.Context, tenantID, id uint) (*model.DataSource, error) {
	var ds model.DataSource
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, id).First(&ds).Error; err != nil {
		return nil, err
	}
	return &ds, nil
}

// UpdateDataSource 更新数据源
func (s *DatasourceService) UpdateDataSource(ctx context.Context, tenantID, id uint, req *CreateDataSourceRequest) (*model.DataSource, error) {
	var ds model.DataSource
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, id).First(&ds).Error; err != nil {
		return nil, err
	}

	if req.IsDefault {
		s.db.Model(&model.DataSource{}).Where("tenant_id = ? AND type = ? AND id != ?", tenantID, req.Type, id).Update("is_default", false)
	}

	ds.Name = req.Name
	ds.Type = req.Type
	ds.URL = req.URL
	ds.Config = req.Config
	ds.IsDefault = req.IsDefault

	if err := s.db.WithContext(ctx).Save(&ds).Error; err != nil {
		return nil, err
	}
	return &ds, nil
}

// DeleteDataSource 删除数据源
func (s *DatasourceService) DeleteDataSource(ctx context.Context, tenantID, id uint) error {
	return s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, id).Delete(&model.DataSource{}, id).Error
}

// TestConnection 测试数据源连通性
func (s *DatasourceService) TestConnection(ctx context.Context, id uint) (bool, string) {
	ds, err := s.GetDataSource(ctx, 0, id)
	if err != nil {
		return false, "datasource not found"
	}

	if ds.Type == "prometheus" {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		u := ds.URL + "/-/healthy"
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
		if err != nil {
			return false, err.Error()
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false, err.Error()
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return true, "ok"
		}
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Sprintf("status: %d, body: %s", resp.StatusCode, string(body))
	}

	return false, "unsupported datasource type"
}

// ProxyQuery 代理查询 Prometheus
type ProxyQueryRequest struct {
	Query string `json:"query" binding:"required"`
	Start string `json:"start"`
	End   string `json:"end"`
	Step  string `json:"step"`
}

// ProxyQueryResponse 代理查询响应
type ProxyQueryResponse struct {
	Status string      `json:"status"`
	Data   interface{} `json:"data,omitempty"`
	Error  string      `json:"error,omitempty"`
}

// GetPrometheusMetrics 获取 Prometheus 指标名列表
func (s *DatasourceService) GetPrometheusMetrics(ctx context.Context, ds *model.DataSource, match string) ([]string, error) {
	if ds.Type != "prometheus" {
		return nil, fmt.Errorf("unsupported datasource type: %s", ds.Type)
	}

	targetURL := ds.URL + "/api/v1/label/__name__/values"
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}

	if ds.Config != "" {
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(ds.Config), &cfg) == nil {
			if headers, ok := cfg["headers"].(map[string]interface{}); ok {
				for k, v := range headers {
					httpReq.Header.Set(k, fmt.Sprintf("%v", v))
				}
			}
		}
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		Status string   `json:"status"`
		Data   []string `json:"data"`
		Error  string   `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}
	if result.Status != "success" {
		return nil, fmt.Errorf("prometheus error: %s", result.Error)
	}

	if match == "" {
		return result.Data, nil
	}

	filtered := make([]string, 0)
	lowerMatch := strings.ToLower(match)
	for _, m := range result.Data {
		if strings.Contains(strings.ToLower(m), lowerMatch) {
			filtered = append(filtered, m)
		}
	}
	return filtered, nil
}

// ProxyPrometheusQuery 代理 Prometheus 查询
func (s *DatasourceService) ProxyPrometheusQuery(ctx context.Context, ds *model.DataSource, req *ProxyQueryRequest) (*ProxyQueryResponse, error) {
	if ds.Type != "prometheus" {
		return nil, fmt.Errorf("unsupported datasource type: %s", ds.Type)
	}

	endpoint := "/api/v1/query"
	params := url.Values{}
	params.Set("query", req.Query)

	if req.Start != "" && req.End != "" {
		endpoint = "/api/v1/query_range"
		params.Set("start", req.Start)
		params.Set("end", req.End)
		if req.Step == "" {
			params.Set("step", "15s")
		} else {
			params.Set("step", req.Step)
		}
	} else {
		params.Set("time", fmt.Sprintf("%d", time.Now().Unix()))
	}

	targetURL := ds.URL + endpoint + "?" + params.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}

	// 附加自定义配置中的 headers
	if ds.Config != "" {
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(ds.Config), &cfg) == nil {
			if headers, ok := cfg["headers"].(map[string]interface{}); ok {
				for k, v := range headers {
					httpReq.Header.Set(k, fmt.Sprintf("%v", v))
				}
			}
		}
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result ProxyQueryResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return &ProxyQueryResponse{
			Status: "error",
			Error:  string(body),
		}, nil
	}
	return &result, nil
}
