package service

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/cloudops/platform/internal/model"
)

// DashboardService 仪表盘服务
type DashboardService struct {
	db *gorm.DB
}

// NewDashboardService 创建仪表盘服务
func NewDashboardService(db *gorm.DB) *DashboardService {
	return &DashboardService{db: db}
}

// CreateDashboardRequest 创建仪表盘请求
type CreateDashboardRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Config      string `json:"config"`
	IsDefault   bool   `json:"is_default"`
}

// CreateDashboard 创建仪表盘
func (s *DashboardService) CreateDashboard(ctx context.Context, tenantID uint, req *CreateDashboardRequest) (*model.Dashboard, error) {
	if req.IsDefault {
		s.db.Model(&model.Dashboard{}).Where("tenant_id = ?", tenantID).Update("is_default", false)
	}

	d := &model.Dashboard{
		TenantID:    tenantID,
		Title:       req.Title,
		Description: req.Description,
		Config:      req.Config,
		IsDefault:   req.IsDefault,
	}
	if err := s.db.WithContext(ctx).Create(d).Error; err != nil {
		return nil, err
	}
	return d, nil
}

// ListDashboards 获取仪表盘列表
func (s *DashboardService) ListDashboards(ctx context.Context, tenantID uint) ([]model.Dashboard, error) {
	var list []model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ?", tenantID).Order("is_default DESC, updated_at DESC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// GetDashboard 获取仪表盘详情（含 panels）
func (s *DashboardService) GetDashboard(ctx context.Context, tenantID, id uint) (*model.Dashboard, error) {
	var d model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, id).Preload("Panels", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).First(&d).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// UpdateDashboard 更新仪表盘
func (s *DashboardService) UpdateDashboard(ctx context.Context, tenantID, id uint, req *CreateDashboardRequest) (*model.Dashboard, error) {
	var d model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, id).First(&d).Error; err != nil {
		return nil, err
	}

	if req.IsDefault {
		s.db.Model(&model.Dashboard{}).Where("tenant_id = ? AND id != ?", tenantID, id).Update("is_default", false)
	}

	d.Title = req.Title
	d.Description = req.Description
	d.Config = req.Config
	d.IsDefault = req.IsDefault

	if err := s.db.WithContext(ctx).Save(&d).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// DeleteDashboard 删除仪表盘（级联删除 panels）
func (s *DashboardService) DeleteDashboard(ctx context.Context, tenantID, id uint) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("dashboard_id = ?", id).Delete(&model.DashboardPanel{}).Error; err != nil {
			return err
		}
		return tx.Where("tenant_id = ? AND id = ?", tenantID, id).Delete(&model.Dashboard{}).Error
	})
}

// DashboardPanelRequest 面板请求
type DashboardPanelRequest struct {
	Title        string `json:"title" binding:"required"`
	Type         string `json:"type" binding:"required"`
	DataSourceID uint   `json:"data_source_id" binding:"required"`
	Query        string `json:"query" binding:"required"`
	Position     string `json:"position"`
	Options      string `json:"options"`
	SortOrder    int    `json:"sort_order"`
}

// CreatePanel 创建面板
func (s *DashboardService) CreatePanel(ctx context.Context, tenantID, dashboardID uint, req *DashboardPanelRequest) (*model.DashboardPanel, error) {
	// 验证仪表盘归属
	var d model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, dashboardID).First(&d).Error; err != nil {
		return nil, fmt.Errorf("dashboard not found")
	}

	panel := &model.DashboardPanel{
		DashboardID:  dashboardID,
		Title:        req.Title,
		Type:         req.Type,
		DataSourceID: req.DataSourceID,
		Query:        req.Query,
		Position:     req.Position,
		Options:      req.Options,
		SortOrder:    req.SortOrder,
	}
	if err := s.db.WithContext(ctx).Create(panel).Error; err != nil {
		return nil, err
	}
	return panel, nil
}

// ListPanels 获取面板列表
func (s *DashboardService) ListPanels(ctx context.Context, tenantID, dashboardID uint) ([]model.DashboardPanel, error) {
	var d model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, dashboardID).First(&d).Error; err != nil {
		return nil, err
	}

	var panels []model.DashboardPanel
	if err := s.db.WithContext(ctx).Where("dashboard_id = ?", dashboardID).Order("sort_order ASC, id ASC").Find(&panels).Error; err != nil {
		return nil, err
	}
	return panels, nil
}

// UpdatePanel 更新面板
func (s *DashboardService) UpdatePanel(ctx context.Context, tenantID, dashboardID, panelID uint, req *DashboardPanelRequest) (*model.DashboardPanel, error) {
	var p model.DashboardPanel
	if err := s.db.WithContext(ctx).Joins("JOIN dashboards ON dashboards.id = dashboard_panels.dashboard_id").
		Where("dashboards.tenant_id = ? AND dashboard_panels.dashboard_id = ? AND dashboard_panels.id = ?", tenantID, dashboardID, panelID).
		First(&p).Error; err != nil {
		return nil, err
	}

	p.Title = req.Title
	p.Type = req.Type
	p.DataSourceID = req.DataSourceID
	p.Query = req.Query
	p.Position = req.Position
	p.Options = req.Options
	p.SortOrder = req.SortOrder

	if err := s.db.WithContext(ctx).Save(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// DeletePanel 删除面板
func (s *DashboardService) DeletePanel(ctx context.Context, tenantID, dashboardID, panelID uint) error {
	// 先验证仪表盘归属
	var dashboard model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, dashboardID).First(&dashboard).Error; err != nil {
		return err
	}
	// 再删除面板
	return s.db.WithContext(ctx).Where("dashboard_id = ? AND id = ?", dashboardID, panelID).Delete(&model.DashboardPanel{}).Error
}

// GetDefaultDashboard 获取默认仪表盘
func (s *DashboardService) GetDefaultDashboard(ctx context.Context, tenantID uint) (*model.Dashboard, error) {
	var d model.Dashboard
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND is_default = ?", tenantID, true).Preload("Panels", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).First(&d).Error; err != nil {
		// 如果没有默认仪表盘，返回第一个
		if err := s.db.WithContext(ctx).Where("tenant_id = ?", tenantID).Preload("Panels", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).First(&d).Error; err != nil {
			return nil, err
		}
	}
	return &d, nil
}
