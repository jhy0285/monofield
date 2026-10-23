package kr.example.shop.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/admin/users")
public class AdminController {

    /** 관리자 사용자 목록 조회 */
    @GetMapping
    public List<String> listUsers() {
        return List.of();
    }
}
