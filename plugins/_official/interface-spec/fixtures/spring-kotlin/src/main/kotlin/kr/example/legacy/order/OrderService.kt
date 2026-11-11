package kr.example.legacy.order

import kr.example.legacy.order.dto.OrderCreateRequest
import kr.example.legacy.order.dto.OrderResponse
import kr.example.legacy.order.dto.OrderSearchDto
import org.springframework.stereotype.Service

@Service
class OrderService {
    fun create(request: OrderCreateRequest): OrderResponse = throw UnsupportedOperationException("demo fixture")

    fun find(orderId: Long): OrderResponse = throw UnsupportedOperationException("demo fixture")

    fun search(condition: OrderSearchDto): List<OrderResponse> = emptyList()
}
