package kr.example.legacy.member.dto

data class MemberJoinRequest(
    /** 로그인 ID */
    val loginId: String?,
    /** 회원 이름 */
    val memberName: String?,
    /** 휴대전화 번호 */
    val mobileNo: String?,
)
