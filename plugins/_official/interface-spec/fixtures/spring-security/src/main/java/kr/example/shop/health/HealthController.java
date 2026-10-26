package kr.example.shop.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    /** 서비스 상태 확인 */
    @GetMapping("/health")
    public String health() {
        return "UP";
    }
}
