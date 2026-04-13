package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/redis/go-redis/v9"
)

var Client *redis.Client

// InitRedis 初始化 Redis 连接
func InitRedis(cfg *config.Config) (*redis.Client, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Database.Redis.Host, cfg.Database.Redis.Port)
	Client = redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Database.Redis.Password,
		DB:       cfg.Database.Redis.DB,
		PoolSize: cfg.Database.Redis.PoolSize,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := Client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("连接 Redis 失败: %w", err)
	}
	return Client, nil
}

// GetRedisKey 生成任务缓存 key
func GetRedisKey(taskID string) string {
	return fmt.Sprintf("ai:task:%s", taskID)
}
