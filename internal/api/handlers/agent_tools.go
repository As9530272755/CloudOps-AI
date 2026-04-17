package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AgentToolsHandler 内部 Agent 工具执行 Handler
type AgentToolsHandler struct {
	agentSvc *service.AgentService
}

// NewAgentToolsHandler 创建 Handler
func NewAgentToolsHandler(agentSvc *service.AgentService) *AgentToolsHandler {
	return &AgentToolsHandler{agentSvc: agentSvc}
}

// ExecuteTool 执行单个工具（仅允许 localhost 访问）
func (h *AgentToolsHandler) ExecuteTool(c *gin.Context) {
	var req struct {
		Tool      string                 `json:"tool"`
		Arguments map[string]interface{} `json:"arguments"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	argsBytes, _ := json.Marshal(req.Arguments)
	output, err := h.agentSvc.ExecuteTool(c.Request.Context(), req.Tool, string(argsBytes))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"output": output})
}
