package kr.example.legacy.order.dto

import java.time.LocalDateTime

data class OrderResponse(
    /** 주문 ID */
    val orderId: Long?,
    /** 주문 상태 */
    val status: String?,
    /** 주문 금액 */
    val totalAmount: Long?,
    /** 주문 일시 */
    val orderedAt: LocalDateTime?,
)
