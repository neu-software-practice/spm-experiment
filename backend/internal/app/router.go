package app

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type nameRequest struct {
	Name string `json:"name"`
}

type nodeRequest struct {
	Name     string   `json:"name"`
	Kind     NodeKind `json:"kind"`
	ParentID string   `json:"parentId"`
}

type nodeOrderRequest struct {
	NodeID   string   `json:"nodeId"`
	ParentID string   `json:"parentId"`
	NodeIDs  []string `json:"nodeIds"`
}

func NewRouter(store *Store) *gin.Engine {
	router := gin.Default()
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := router.Group("/api")
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
		node, err := store.CreateNode(c.Param("projectID"), request.Kind, request.ParentID, request.Name)
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
	}
	c.JSON(status, gin.H{"error": message})
}

func respondInvalidJSON(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{"error": "请求内容无效"})
}
