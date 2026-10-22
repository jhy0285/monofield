package kr.example.legacy.member;

import kr.example.legacy.member.dto.MemberJoinRequest;
import kr.example.legacy.member.dto.MemberResponse;
import org.springframework.stereotype.Service;

@Service
public class MemberService {

    public MemberResponse join(MemberJoinRequest request) {
        throw new UnsupportedOperationException("demo fixture");
    }

    public MemberResponse find(Long memberId) {
        throw new UnsupportedOperationException("demo fixture");
    }
}
