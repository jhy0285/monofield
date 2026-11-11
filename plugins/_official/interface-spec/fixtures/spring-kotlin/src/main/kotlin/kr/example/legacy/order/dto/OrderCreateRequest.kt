package kr.example.legacy.order.dto

data class OrderCreateRequest(
    /** 회원 ID */
    val memberId: Long?,
    /** 주문 상품 목록 */
    val items: List<OrderItemRequest>?,
    /** 배송지 주소 */
    val deliveryAddress: String?,
)
