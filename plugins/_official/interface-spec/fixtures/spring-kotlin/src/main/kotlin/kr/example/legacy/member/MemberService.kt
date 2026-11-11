package kr.example.legacy.member

import kr.example.legacy.member.dto.MemberJoinRequest
import kr.example.legacy.member.dto.MemberResponse
import org.springframework.stereotype.Service

@Service
class MemberService {
    fun join(request: MemberJoinRequest): MemberResponse = throw UnsupportedOperationException("demo fixture")

    fun find(memberId: Long): MemberResponse = throw UnsupportedOperationException("demo fixture")
}
