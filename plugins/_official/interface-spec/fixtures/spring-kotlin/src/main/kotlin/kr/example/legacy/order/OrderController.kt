package kr.example.legacy.order

import kr.example.legacy.order.dto.OrderCreateRequest
import kr.example.legacy.order.dto.OrderResponse
import kr.example.legacy.order.dto.OrderSearchDto
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/orders")
class OrderController(private val orderService: OrderService) {

    /** 주문 등록 */
    @PostMapping
    fun createOrder(@RequestBody request: OrderCreateRequest): ResponseEntity<OrderResponse> =
        ResponseEntity.ok(orderService.create(request))

    /** 주문 단건 조회 */
    @GetMapping("/{orderId}")
    fun getOrder(@PathVariable orderId: Long): ResponseEntity<OrderResponse> =
        ResponseEntity.ok(orderService.find(orderId))

    /** 주문 목록 조회 */
    @GetMapping
    fun searchOrders(condition: OrderSearchDto): ResponseEntity<List<OrderResponse>> =
        ResponseEntity.ok(orderService.search(condition))
}
