package kr.example.shop.docs;

import org.springframework.security.access.annotation.Secured;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/docs")
@PreAuthorize("isAuthenticated()")
public class DocsController {

    /** 이용 가이드 조회 */
    @GetMapping("/guide")
    @PreAuthorize("permitAll()")
    public String guide() {
        return "guide";
    }

    /** 변경 이력 조회 */
    @GetMapping("/changelog")
    public String changelog() {
        return "changelog";
    }

    /** 운영 정책 조회 */
    @GetMapping("/policies")
    @Secured({"ROLE_STAFF", "ROLE_ADMIN"})
    public String policies() {
        return "policies";
    }
}
