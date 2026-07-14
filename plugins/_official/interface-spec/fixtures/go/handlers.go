package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func listOrders(c *gin.Context) {
	page := c.DefaultQuery("page", "1")
	size := c.Query("size")
	status := c.Query("status")
	_ = page
	_ = size
	_ = status
	resp := OrderListResponse{}
	c.JSON(http.StatusOK, resp)
}

func createOrder(c *gin.Context) {
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	resp := OrderResponse{OrderNo: req.OrderNo, Status: "OPEN"}
	c.JSON(http.StatusCreated, resp)
}

func getOrder(c *gin.Context) {
	id := c.Param("id")
	if _, err := strconv.ParseInt(id, 10, 64); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var resp OrderResponse
	c.JSON(http.StatusOK, resp)
}

func updateOrder(c *gin.Context) {
	id := c.Param("id")
	_ = id
	var req UpdateOrderRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, OrderResponse{})
}

func deleteOrder(c *gin.Context) {
	id := c.Param("id")
	_ = id
	c.Status(http.StatusNoContent)
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{Status: "ok"})
}
