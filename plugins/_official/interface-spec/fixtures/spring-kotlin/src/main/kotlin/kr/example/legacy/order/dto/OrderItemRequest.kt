package kr.example.legacy.order.dto

data class OrderItemRequest(
    /** 상품 ID */
    val productId: Long?,
    /** 주문 수량 */
    val quantity: Int?,
)
