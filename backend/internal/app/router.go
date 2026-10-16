package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type nameRequest struct {
	Name string `json:"name"`
}

type nodeRequest struct {
	Name     string   `json:"name"`
	Kind     NodeKind `json:"kind"`
	ParentID string   `json:"parentId"`
	AfterID  string   `json:"afterId"`
}

type nodeOrderRequest struct {
	NodeID   string   `json:"nodeId"`
	ParentID string   `json:"parentId"`
	NodeIDs  []string `json:"nodeIds"`
}

type assistantChatRequest struct {
	Messages []ChatMessage `json:"messages"`
	Input    string        `json:"input"`
}

type replaceNodesRequest struct {
	Nodes []Node `json:"nodes"`
}

func NewRouter(store *Store, model ChatModel) *gin.Engine {
	router := gin.Default()
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := router.Group("/api")
	api.GET("/ai/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"enabled": model != nil})
	})
	api.POST("/projects/:projectID/assistant/chat", func(c *gin.Context) {
		var request assistantChatRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		if err := json.NewDecoder(c.Request.Body).Decode(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		request.Input = strings.TrimSpace(request.Input)
		if !validAssistantInput(request.Input) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "消息不能为空，且不能超过 4000 个字符"})
			return
		}
		if validateHistory(request.Messages) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "对话记录无效，请开始新对话"})
			return
		}
		if _, err := store.Project(c.Param("projectID")); err != nil {
			respondError(c, err)
			return
		}
		if model == nil {
			respondError(c, ErrAIDisabled)
			return
		}
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		send := func(event AssistantEvent) {
			data, _ := json.Marshal(event.Data)
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Name, data)
			c.Writer.Flush()
		}
		send(AssistantEvent{"start", gin.H{}})
		assistant := &Assistant{store: store, model: model}
		messages, err := assistant.RunTurn(c.Request.Context(), c.Param("projectID"), request.Messages, request.Input, send)
		if err != nil {
			// Provider errors carry no secrets; the detail helps diagnose a failed turn.
			log.Printf("assistant turn failed: %v", err)
			_, message := errorResponse(err)
			send(AssistantEvent{"error", gin.H{"error": message, "messages": messages}})
			return
		}
		send(AssistantEvent{"done", gin.H{"messages": messages}})
	})
	api.PUT("/projects/:projectID/nodes", func(c *gin.Context) {
		var request replaceNodesRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		if err := json.NewDecoder(c.Request.Body).Decode(&request); err != nil || request.Nodes == nil {
			respondInvalidJSON(c)
			return
		}
		project, err := store.ReplaceNodes(c.Param("projectID"), request.Nodes)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, project)
	})
	api.GET("/projects", func(c *gin.Context) {
		c.JSON(http.StatusOK, store.Projects())
	})
	api.POST("/projects", func(c *gin.Context) {
		var request nameRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		project, err := store.CreateProject(request.Name)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusCreated, project)
	})
	api.GET("/projects/:projectID", func(c *gin.Context) {
		project, err := store.Project(c.Param("projectID"))
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, project)
	})
	api.PATCH("/projects/:projectID", func(c *gin.Context) {
		var request nameRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		project, err := store.RenameProject(c.Param("projectID"), request.Name)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, project)
	})
	api.DELETE("/projects/:projectID", func(c *gin.Context) {
		if err := store.DeleteProject(c.Param("projectID")); err != nil {
			respondError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
	api.POST("/projects/:projectID/nodes", func(c *gin.Context) {
		var request nodeRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		node, err := store.CreateNodeAfter(
			c.Param("projectID"), request.Kind, request.ParentID, request.AfterID, request.Name,
		)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusCreated, node)
	})
	api.PATCH("/projects/:projectID/nodes/:nodeID", func(c *gin.Context) {
		var request nameRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		node, err := store.RenameNode(c.Param("projectID"), c.Param("nodeID"), request.Name)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, node)
	})
	api.PUT("/projects/:projectID/nodes/order", func(c *gin.Context) {
		var request nodeOrderRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			respondInvalidJSON(c)
			return
		}
		if err := store.MoveNode(c.Param("projectID"), request.NodeID, request.ParentID, request.NodeIDs); err != nil {
			respondError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
	api.DELETE("/projects/:projectID/nodes/:nodeID", func(c *gin.Context) {
		if err := store.DeleteNode(c.Param("projectID"), c.Param("nodeID")); err != nil {
			respondError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})

	return router
}

func respondError(c *gin.Context, err error) {
	status, message := errorResponse(err)
	c.JSON(status, gin.H{"error": message})
}

func errorResponse(err error) (int, string) {
	status := http.StatusInternalServerError
	message := "服务器暂时无法处理请求"
	switch {
	case errors.Is(err, ErrNotFound):
		status, message = http.StatusNotFound, "未找到对应内容"
	case errors.Is(err, ErrInvalidName):
		status, message = http.StatusBadRequest, "名称不能为空"
	case errors.Is(err, ErrNameTooLong):
		status, message = http.StatusBadRequest, "名称不能超过 80 个字符"
	case errors.Is(err, ErrInvalidParent):
		status, message = http.StatusBadRequest, "节点层级关系无效"
	case errors.Is(err, ErrInvalidOrder):
		status, message = http.StatusBadRequest, "节点排序无效"
	case errors.Is(err, ErrAIDisabled):
		status, message = http.StatusServiceUnavailable, "AI 助手尚未配置"
	case errors.Is(err, ErrAITimeout), errors.Is(err, context.DeadlineExceeded):
		status, message = http.StatusGatewayTimeout, "AI 响应超时，请稍后重试"
	case errors.Is(err, context.Canceled):
		status, message = http.StatusRequestTimeout, "请求已取消"
	case errors.Is(err, ErrAIInvalidResponse):
		status, message = http.StatusBadGateway, "AI 返回的内容无法解析，请重试"
	case errors.Is(err, ErrAIUpstream):
		status, message = http.StatusBadGateway, "AI 服务暂时不可用，请稍后重试"
	}
	return status, message
}

func respondInvalidJSON(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{"error": "请求内容无效"})
}
