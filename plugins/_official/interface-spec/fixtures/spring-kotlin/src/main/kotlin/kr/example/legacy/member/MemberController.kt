package kr.example.legacy.member

import kr.example.legacy.member.dto.MemberJoinRequest
import kr.example.legacy.member.dto.MemberResponse
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/members")
class MemberController(private val memberService: MemberService) {

    /** 회원 가입 */
    @PostMapping("/join")
    fun join(@RequestBody request: MemberJoinRequest): ResponseEntity<MemberResponse> =
        ResponseEntity.ok(memberService.join(request))

    /** 회원 조회 */
    @GetMapping("/{memberId}")
    fun getMember(@PathVariable memberId: Long): ResponseEntity<MemberResponse> =
        ResponseEntity.ok(memberService.find(memberId))
}
