package kr.example.legacy.order;

import kr.example.legacy.order.dto.OrderCreateRequest;
import kr.example.legacy.order.dto.OrderResponse;
import kr.example.legacy.order.dto.OrderSearchDto;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

@Service
public class OrderService {

    public OrderResponse create(OrderCreateRequest request) {
        throw new UnsupportedOperationException("demo fixture");
    }

    public OrderResponse find(Long orderId) {
        throw new UnsupportedOperationException("demo fixture");
    }

    public List<OrderResponse> search(OrderSearchDto condition) {
        return Collections.emptyList();
    }
}
