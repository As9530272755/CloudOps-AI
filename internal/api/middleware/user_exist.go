package middleware

import (
	"net/http"

	"github.com/cloudops/platform/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UserExistMiddleware 检查用户是否仍然存在（防止删除后token仍然有效）
func UserExistMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.Next()
			return
		}

		var count int64
		db.Model(&model.User{}).Where("id = ?", userID).Count(&count)
		if count == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "USER_NOT_FOUND",
					"message": "用户不存在或已被删除，请重新登录",
				},
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
