package kr.example.legacy.order.dto;

public class OrderSearchDto {
    /** 회원 ID */
    private Long memberId;
    /** 주문 상태 */
    private String status;
    /** 조회 시작일 (yyyyMMdd) */
    private String fromDate;
    /** 조회 종료일 (yyyyMMdd) */
    private String toDate;
}
