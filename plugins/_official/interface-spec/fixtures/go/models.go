package main

import "time"

// CustomerInfo mixes binding:"required", omitempty, and a pointer field.
type CustomerInfo struct {
	Name  string  `json:"name" binding:"required"`
	Email string  `json:"email,omitempty"`
	Phone *string `json:"phone,omitempty"`
}

type OrderItemInput struct {
	ProductCode string  `json:"productCode" binding:"required"`
	Quantity    int     `json:"quantity" binding:"required"`
	UnitPrice   float64 `json:"unitPrice"`
	Note        *string `json:"note"`
}

type CreateOrderRequest struct {
	OrderNo  string           `json:"orderNo" binding:"required"`
	Customer CustomerInfo     `json:"customer" binding:"required"`
	Items    []OrderItemInput `json:"items" binding:"required"`
	Memo     *string          `json:"memo,omitempty"`
	Urgent   bool             `json:"urgent,omitempty"`
}

type UpdateOrderRequest struct {
	Status string  `json:"status" binding:"required"`
	Memo   *string `json:"memo,omitempty"`
}

type OrderResponse struct {
	ID         int64            `json:"id"`
	OrderNo    string           `json:"orderNo"`
	Status     string           `json:"status"`
	Customer   CustomerInfo     `json:"customer"`
	Items      []OrderItemInput `json:"items"`
	TotalPrice float64          `json:"totalPrice"`
	OrderedAt  time.Time        `json:"orderedAt"`
	// audit column: must be excluded from the spec
	CreatedAt time.Time `json:"createdAt"`
}

type OrderListResponse struct {
	Total int             `json:"total"`
	Items []OrderResponse `json:"items"`
}

type HealthResponse struct {
	Status string `json:"status"`
	Uptime int64  `json:"uptime"`
}
