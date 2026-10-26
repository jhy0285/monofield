package kr.example.legacy.order.dto;

import java.util.List;

public class OrderCreateRequest {
    /** 회원 ID */
    private Long memberId;
    /** 주문 상품 목록 */
    private List<OrderItemRequest> items;
    /** 배송지 주소 */
    private String deliveryAddress;
    /** 배송 요청 사항 */
    private String deliveryMemo;
}
