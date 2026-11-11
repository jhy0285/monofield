package kr.example.legacy.order.dto

class OrderSearchDto {
    /** 회원 ID */
    var memberId: Long? = null

    /** 주문 상태 */
    var status: String? = null

    /** 조회 시작일 (yyyyMMdd) */
    var fromDate: String? = null

    /** 조회 종료일 (yyyyMMdd) */
    var toDate: String? = null
}
