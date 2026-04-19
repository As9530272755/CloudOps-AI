package middleware

import (
	"net/http"

	"github.com/cloudops/platform/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UserExistMiddleware 检查用户是否仍然存在且未被禁用（防止删除/禁用后token仍然有效）
func UserExistMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.Next()
			return
		}

		var user model.User
		if err := db.Select("id", "is_active").First(&user, userID).Error; err != nil {
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

		if !user.IsActive {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "USER_DISABLED",
					"message": "用户已被禁用，请联系管理员",
				},
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
