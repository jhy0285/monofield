package kr.example.shop.config;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/** Slice tests run without a login; production endpoints are not open. */
@TestConfiguration
public class TestSecurityConfig {

    @Bean
    @Order(0)
    public SecurityFilterChain permitAllForTests(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }
}
