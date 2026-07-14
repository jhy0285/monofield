package main

import (
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	api := r.Group("/api")
	v1 := api.Group("/v1")

	orders := v1.Group("/orders")
	orders.GET("", listOrders)
	orders.POST("", createOrder)
	orders.GET("/:id", getOrder)
	orders.PUT("/:id", updateOrder)
	orders.DELETE("/:id", deleteOrder)

	v1.GET("/health", healthCheck)

	r.Run(":8080")
}
