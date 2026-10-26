package kr.example.shop.partner;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/partner")
public class PartnerController {

    /** 제휴사 주문 상태 콜백 */
    @PostMapping("/orders/callback")
    public String orderCallback(@RequestParam String orderNo, @RequestParam String orderStatus) {
        return "OK";
    }
}
