package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

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

type generateChildrenRequest struct {
	Prompt string `json:"prompt"`
	Count  *int   `json:"count"`
}

func NewRouter(store *Store, generator ChildGenerator) *gin.Engine {
	router := gin.Default()
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := router.Group("/api")
	api.GET("/ai/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"enabled": generator != nil})
	})
	api.POST("/projects/:projectID/nodes/:nodeID/generate-children", func(c *gin.Context) {
		var request *generateChildrenRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil || request == nil {
			respondInvalidJSON(c)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			respondInvalidJSON(c)
			return
		}
		count := defaultGenerationCount
		if request.Count != nil {
			count = *request.Count
		}
		if count < 1 || count > maxGenerationCount {
			c.JSON(http.StatusBadRequest, gin.H{"error": "生成数量须为 1 到 10 个"})
			return
		}
		if !utf8.ValidString(request.Prompt) || utf8.RuneCountInString(request.Prompt) > maxGenerationPrompt {
			c.JSON(http.StatusBadRequest, gin.H{"error": "附加提示词不能超过 2000 个字符"})
			return
		}
		project, err := store.Project(c.Param("projectID"))
		if err != nil {
			respondError(c, err)
			return
		}
		snapshot, err := generationContext(project, c.Param("nodeID"))
		if err != nil {
			respondError(c, err)
			return
		}
		if generator == nil {
			respondError(c, ErrAIDisabled)
			return
		}
		names, err := generator.GenerateChildren(c.Request.Context(), snapshot.input(count, strings.TrimSpace(request.Prompt)))
		if err != nil {
			respondError(c, err)
			return
		}
		nodes, err := store.createGeneratedChildren(c.Request.Context(), project.ID, snapshot, names, count)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"parentId": snapshot.Parent.ID, "nodes": nodes})
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
	status := http.StatusInternalServerError
	message := "服务器暂时无法处理请求"
	switch {
	case errors.Is(err, ErrNotFound):
		status, message = http.StatusNotFound, "未找到对应内容"
	case errors.Is(err, ErrInvalidName):
		status, message = http.StatusBadRequest, "名称不能为空"
	case errors.Is(err, ErrInvalidParent):
		status, message = http.StatusBadRequest, "节点层级关系无效"
	case errors.Is(err, ErrInvalidOrder):
		status, message = http.StatusBadRequest, "节点排序无效"
	case errors.Is(err, ErrLeafNode):
		status, message = http.StatusBadRequest, "二级故事已是最末层级，无法生成子节点"
	case errors.Is(err, ErrGenerationConflict):
		status, message = http.StatusConflict, "生成期间节点内容已变化，请重新生成"
	case errors.Is(err, ErrAIDisabled):
		status, message = http.StatusServiceUnavailable, "AI 生成功能尚未配置"
	case errors.Is(err, ErrAIContextTooLarge):
		status, message = http.StatusBadRequest, "当前节点上下文过长，请精简内容后再试"
	case errors.Is(err, ErrAITimeout), errors.Is(err, context.DeadlineExceeded):
		status, message = http.StatusGatewayTimeout, "AI 生成超时，请稍后重试"
	case errors.Is(err, context.Canceled):
		status, message = http.StatusRequestTimeout, "生成请求已取消"
	case errors.Is(err, ErrAIInvalidResponse):
		status, message = http.StatusBadGateway, "AI 返回的内容不符合节点要求，请调整提示词后重试"
	case errors.Is(err, ErrAIUpstream):
		status, message = http.StatusBadGateway, "AI 服务暂时无法生成内容，请稍后重试"
	}
	c.JSON(status, gin.H{"error": message})
}

func respondInvalidJSON(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{"error": "请求内容无效"})
}
