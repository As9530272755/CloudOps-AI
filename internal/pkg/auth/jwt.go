package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/golang-jwt/jwt/v5"
)

// Claims JWT 声明
type Claims struct {
	UserID  uint   `json:"user_id"`
	TenantID uint  `json:"tenant_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	IsSuperuser bool `json:"is_superuser"`
	jwt.RegisteredClaims
}

// JWTConfig JWT 配置
type JWTConfig struct {
	Secret        []byte
	AccessExpire  time.Duration
	RefreshExpire time.Duration
}

// JWTManager JWT 管理器
type JWTManager struct {
	config *JWTConfig
}

// NewJWTManager 创建 JWT 管理器
func NewJWTManager(cfg *config.SecurityConfig) *JWTManager {
	return &JWTManager{
		config: &JWTConfig{
			Secret:        []byte(cfg.JWT.Secret),
			AccessExpire:  cfg.JWT.AccessExpire,
			RefreshExpire: cfg.JWT.RefreshExpire,
		},
	}
}

// GenerateAccessToken 生成访问令牌
func (m *JWTManager) GenerateAccessToken(userID, tenantID uint, username, email string, isSuperuser bool) (string, error) {
	claims := &Claims{
		UserID:      userID,
		TenantID:    tenantID,
		Username:    username,
		Email:       email,
		IsSuperuser: isSuperuser,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.config.AccessExpire)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "cloudops",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.config.Secret)
}

// GenerateRefreshToken 生成刷新令牌
func (m *JWTManager) GenerateRefreshToken(userID uint) (string, error) {
	claims := &jwt.RegisteredClaims{
		Subject:   fmt.Sprintf("%d", userID),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.config.RefreshExpire)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		Issuer:    "cloudops",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.config.Secret)
}

// ValidateToken 验证令牌
func (m *JWTManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("无效的签名方法: %v", token.Header["alg"])
		}
		return m.config.Secret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("无效的令牌")
}