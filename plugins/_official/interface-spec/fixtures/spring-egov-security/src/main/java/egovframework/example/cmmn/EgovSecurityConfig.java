package egovframework.example.cmmn;

import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;

/**
 * 게시판 보안 설정.
 */
@Configuration
@EnableWebSecurity
public class EgovSecurityConfig extends WebSecurityConfigurerAdapter {

    @Override
    public void configure(WebSecurity web) {
        web.ignoring().antMatchers("/css/**", "/js/**", "/images/**");
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/board/selectBoardList.do", "/board/selectBoard.do").permitAll()
                .antMatchers("/**/*.do").hasRole("USER")
                .anyRequest().denyAll()
            .and()
            .formLogin()
                .loginPage("/uat/uia/egovLoginUsr.do")
                .permitAll();
    }
}
