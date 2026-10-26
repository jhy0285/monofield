package kr.example.shop.product;

import jakarta.annotation.security.RolesAllowed;
import kr.example.shop.product.dto.ProductRequest;
import kr.example.shop.product.dto.ProductResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    /** 상품 목록 조회 */
    @GetMapping
    public List<ProductResponse> listProducts() {
        return productService.list();
    }

    /** 상품 상세 조회 */
    @GetMapping("/{productId}")
    public ProductResponse getProduct(@PathVariable Long productId) {
        return productService.find(productId);
    }

    /** 상품 원가 조회 */
    @GetMapping("/{productId}/cost")
    @PreAuthorize("hasRole('MANAGER')")
    public ProductResponse getProductCost(@PathVariable Long productId) {
        return productService.findWithCost(productId);
    }

    /** 상품 재고 조회 */
    @GetMapping("/{productId}/stock")
    @RolesAllowed("STAFF")
    public ProductResponse getProductStock(@PathVariable Long productId) {
        return productService.findWithStock(productId);
    }

    /** 상품 등록 */
    @PostMapping
    public ProductResponse createProduct(@RequestBody ProductRequest request) {
        return productService.create(request);
    }

    /** 상품 검색 */
    @RequestMapping("/search")
    public List<ProductResponse> searchProducts(String keyword) {
        return productService.search(keyword);
    }
}
