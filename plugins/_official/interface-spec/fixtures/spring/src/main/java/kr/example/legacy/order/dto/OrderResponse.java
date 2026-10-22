package kr.example.legacy.order.dto;

import java.time.LocalDateTime;

public class OrderResponse {
    /** 주문 ID */
    private Long orderId;
    /** 주문 상태 */
    private String status;
    /** 주문 금액 */
    private Long totalAmount;
    /** 주문 일시 */
    private LocalDateTime orderedAt;
}
