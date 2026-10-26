package kr.example.shop.product;

import kr.example.shop.product.dto.ProductRequest;
import kr.example.shop.product.dto.ProductResponse;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ProductService {

    public List<ProductResponse> list() {
        return List.of();
    }

    public ProductResponse find(Long productId) {
        return new ProductResponse();
    }

    public ProductResponse findWithCost(Long productId) {
        return new ProductResponse();
    }

    public ProductResponse findWithStock(Long productId) {
        return new ProductResponse();
    }

    public ProductResponse create(ProductRequest request) {
        return new ProductResponse();
    }

    public List<ProductResponse> search(String keyword) {
        return List.of();
    }
}
