/*% if (feature.UserManagement) { %*/
package es.udc.lbd.gema.lps.config;

import jakarta.inject.Inject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import es.udc.lbd.gema.lps.security.Http401UnauthorizedEntryPoint;
import es.udc.lbd.gema.lps.security.jwt.JWTFilter;
import org.springframework.security.data.repository.query.SecurityEvaluationContextExtension;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

    /*% if (feature.UM_ST_JWT) { %*/
import org.springframework.security.web.authentication.RememberMeServices;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.beans.factory.BeanInitializationException;
import es.udc.lbd.gema.lps.security.jwt.JWTConfigurer;
import org.springframework.security.config.Customizer;
import es.udc.lbd.gema.lps.security.jwt.TokenProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.security.config.http.SessionCreationPolicy;
    /*% } %*/

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfiguration {

  private final Http401UnauthorizedEntryPoint authenticationEntryPoint;

  @Inject private UserDetailsService userDetailsService;

  @Bean
  public static PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }

  @Autowired
  public SecurityConfiguration(Http401UnauthorizedEntryPoint http401UnauthorizedEntryPoint) {
    this.authenticationEntryPoint = http401UnauthorizedEntryPoint;
  }

    /*% if (feature.UM_ST_JWT) { %*/

  @Bean
  JWTFilter jwtFilter() {
    return new JWTFilter();
  }

  @Bean
  public AuthenticationManager authenticationManager(
      AuthenticationConfiguration authenticationConfiguration) throws Exception {
    return authenticationConfiguration.getAuthenticationManager();
  }

  /*% if (feature.T_Swagger) { %*/
  private static final String[] AUTH_SWAGGER = {
    "/api/v1/auth/**",
    "/v3/api-docs/**",
    "/v3/api-docs.yaml",
    "/swagger-ui/**",
    "/swagger-ui.html"
  };
  /*% } %*/
    @Bean
    protected SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
        /*% if (feature.UM_ST_JWT) { %*/
        .cors(Customizer.withDefaults())
          .csrf(csrf -> csrf.disable())
          .headers(headers -> headers.frameOptions(frameOptions -> frameOptions.disable()))
          .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
          .authorizeHttpRequests(auth ->
            auth.requestMatchers("/api/authenticate")
              .permitAll()
              .requestMatchers(HttpMethod.POST, "/api/users/**")
              .permitAll()
              /*% if (feature.UM_A_RememberPass || feature.UM_UP_ByAdmin) { %*/
              .requestMatchers(HttpMethod.POST, "/api/account/reset_password/init")
              .permitAll()
              /*% } %*/
              /*% if (feature.UM_UpdatePassword  || feature.UM_R_ByAdmin) { %*/
              .requestMatchers(HttpMethod.POST, "/api/account/reset_password/finish")
              .permitAll()
              /*% } %*/
              /*% if (feature.UM_AccountActivation) { %*/
              .requestMatchers(HttpMethod.GET, "/api/activate")
              .permitAll()
              /*% } %*/
              /*% if (feature.UM_R_Anonymous) { %*/
              .requestMatchers(HttpMethod.POST, "/api/register")
              .permitAll()
              /*% } %*/
              /*% if (feature.UM_C_AnonymousUserCanViewEntities) { %*/
              .requestMatchers(HttpMethod.GET, "/api/entities/**")
              .permitAll()
              .requestMatchers(HttpMethod.GET, "/api/download/**")
              .permitAll()
              .requestMatchers(HttpMethod.GET, "/api/images/**")
              .permitAll()
              /*% } %*/
              /*% if (feature.GUI_StaticPages) { %*/
              .requestMatchers(HttpMethod.GET, "/api/entities/statics/*/**")
              .permitAll()
              /*% } %*/
              /*% if (feature.T_Swagger) { %*/
              .requestMatchers(AUTH_SWAGGER)
              .permitAll()
              /*% } %*/
              .requestMatchers("/**")
              .authenticated()
          )
          .httpBasic(Customizer.withDefaults())
          .exceptionHandling(exceptionHandling ->
            exceptionHandling.authenticationEntryPoint(this.authenticationEntryPoint));
      http.addFilterBefore(jwtFilter(), UsernamePasswordAuthenticationFilter.class);

        /*% } %*/
        ;
        return http.build();
    }

    /*% } %*/
}
/*% } %*/
