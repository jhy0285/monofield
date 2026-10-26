package kr.example.shop.auth;

import kr.example.shop.auth.dto.LoginRequest;
import kr.example.shop.auth.dto.TokenResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController {

    /** 로그인 */
    @PostMapping("/login")
    public TokenResponse login(@RequestBody LoginRequest request) {
        return new TokenResponse();
    }

    /** 토큰 재발급 */
    @PostMapping("/token/refresh")
    public TokenResponse refresh(@RequestParam String refreshToken) {
        return new TokenResponse();
    }

    /** 로그아웃 */
    @PostMapping("/logout")
    public TokenResponse logout(@RequestParam String refreshToken) {
        return new TokenResponse();
    }
}
