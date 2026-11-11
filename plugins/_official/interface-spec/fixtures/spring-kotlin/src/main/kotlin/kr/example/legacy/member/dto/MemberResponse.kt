package kr.example.legacy.member.dto

data class MemberResponse(
    /** 회원 ID */
    val memberId: Long?,
    /** 로그인 ID */
    val loginId: String?,
    /** 회원 이름 */
    val memberName: String?,
)
