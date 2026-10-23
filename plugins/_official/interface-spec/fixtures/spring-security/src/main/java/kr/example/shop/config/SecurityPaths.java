package kr.example.shop.config;

/** URL groups shared by the security rules and the API documentation. */
public final class SecurityPaths {

    public static final String DOCS_ROOT = "/docs";
    public static final String[] DOCS = { DOCS_ROOT + "/**" };

    private SecurityPaths() {
    }
}
