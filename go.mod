module github.com/cloudops/platform

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/spf13/viper v1.18.2
	github.com/golang-jwt/jwt/v5 v5.2.0
	github.com/gorilla/websocket v1.5.1
	github.com/google/uuid v1.6.0
	golang.org/x/crypto v0.21.0
	gorm.io/gorm v1.25.7
	gorm.io/driver/postgres v1.5.7
	gorm.io/driver/sqlite v1.5.5
	k8s.io/client-go v0.29.3
	k8s.io/api v0.29.3
	k8s.io/apimachinery v0.29.3
	github.com/redis/go-redis/v9 v9.5.1
)