package handlers

import (
	"net/http"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/pkg/database"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AuthHandler 认证处理器
type AuthHandler struct {
	db         *gorm.DB
	jwtManager *auth.JWTManager
}

// NewAuthHandler 创建认证处理器
func NewAuthHandler(jwtManager *auth.JWTManager) *AuthHandler {
	return &AuthHandler{
		db:         database.DB,
		jwtManager: jwtManager,
	}
}

// LoginRequest 登录请求
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// LoginResponse 登录响应
type LoginResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int64     `json:"expires_in"`
	User         UserDTO   `json:"user"`
}

// UserDTO 用户信息
type UserDTO struct {
	ID          uint   `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	IsSuperuser bool   `json:"is_superuser"`
	TenantID    uint   `json:"tenant_id"`
}

// Login 用户登录
// @Summary 用户登录
// @Description 用户登录认证
// @Tags 认证
// @Accept json
// @Produce json
// @Param request body LoginRequest true "登录请求"
// @Success 200 {object} LoginResponse
// @Failure 401 {object} map[string]interface{}
// @Router /auth/login [post]
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "INVALID_REQUEST",
				"message": "请求参数错误",
			},
		})
		return
	}

	// 查找用户
	var user model.User
	if err := h.db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		// 记录登录失败日志
		h.createLoginLog(0, c.ClientIP(), c.GetHeader("User-Agent"), "failed")
		
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "INVALID_CREDENTIALS",
				"message": "用户名或密码错误",
			},
		})
		return
	}

	// 验证密码
	if !database.CheckPassword(req.Password, user.PasswordHash) {
		h.createLoginLog(user.ID, c.ClientIP(), c.GetHeader("User-Agent"), "failed")
		
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "INVALID_CREDENTIALS",
				"message": "用户名或密码错误",
			},
		})
		return
	}

	// 检查用户状态
	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "USER_DISABLED",
				"message": "用户已被禁用",
			},
		})
		return
	}

	// 生成 Token
	accessToken, err := h.jwtManager.GenerateAccessToken(
		user.ID,
		user.TenantID,
		user.Username,
		user.Email,
		user.IsSuperuser,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "TOKEN_GENERATION_FAILED",
				"message": "生成令牌失败",
			},
		})
		return
	}

	refreshToken, err := h.jwtManager.GenerateRefreshToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "TOKEN_GENERATION_FAILED",
				"message": "生成令牌失败",
			},
		})
		return
	}

	// 更新最后登录时间
	now := time.Now()
	h.db.Model(&user).Update("last_login_at", now)

	// 记录登录成功日志
	h.createLoginLog(user.ID, c.ClientIP(), c.GetHeader("User-Agent"), "success")

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登录成功",
		"data": LoginResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			TokenType:    "Bearer",
			ExpiresIn:    3600,
			User: UserDTO{
				ID:          user.ID,
				Username:    user.Username,
				Email:       user.Email,
				IsSuperuser: user.IsSuperuser,
				TenantID:    user.TenantID,
			},
		},
	})
}

// Logout 用户登出
func (h *AuthHandler) Logout(c *gin.Context) {
	// TODO: 将 Token 加入黑名单
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登出成功",
	})
}

// GetProfile 获取用户信息
func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := c.GetUint("user_id")
	
	var user model.User
	if err := h.db.Preload("Roles").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "USER_NOT_FOUND",
				"message": "用户不存在",
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"id":          user.ID,
			"username":    user.Username,
			"email":       user.Email,
			"is_superuser": user.IsSuperuser,
			"tenant_id":   user.TenantID,
			"roles":       user.Roles,
		},
	})
}

// createLoginLog 创建登录日志
func (h *AuthHandler) createLoginLog(userID uint, ip, userAgent, status string) {
	log := model.LoginLog{
		UserID:    userID,
		IPAddress: ip,
		UserAgent: userAgent,
		Status:    status,
	}
	h.db.Create(&log)
}