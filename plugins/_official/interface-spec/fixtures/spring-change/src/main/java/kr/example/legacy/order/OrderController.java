package kr.example.legacy.order;

import kr.example.legacy.order.dto.OrderCancelRequest;
import kr.example.legacy.order.dto.OrderCreateRequest;
import kr.example.legacy.order.dto.OrderResponse;
import kr.example.legacy.order.dto.OrderSearchDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /** 주문 등록 */
    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(@RequestBody OrderCreateRequest request) {
        return ResponseEntity.ok(orderService.create(request));
    }

    /** 주문 단건 조회 */
    @GetMapping("/{orderId}")
    public ResponseEntity<OrderResponse> getOrder(@PathVariable Long orderId) {
        return ResponseEntity.ok(orderService.find(orderId));
    }

    /** 주문 목록 조회 */
    @GetMapping
    public ResponseEntity<List<OrderResponse>> searchOrders(OrderSearchDto condition) {
        return ResponseEntity.ok(orderService.search(condition));
    }

    /** 주문 취소 */
    @PostMapping("/{orderId}/cancel")
    public ResponseEntity<OrderResponse> cancelOrder(@PathVariable Long orderId,
                                                     @RequestBody OrderCancelRequest request) {
        return ResponseEntity.ok(orderService.cancel(orderId, request));
    }
}
