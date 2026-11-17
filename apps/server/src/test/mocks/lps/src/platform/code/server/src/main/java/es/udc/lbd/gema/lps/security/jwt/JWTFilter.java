/*% if (feature.UM_ST_JWT) { %*/
package es.udc.lbd.gema.lps.security.jwt;

import jakarta.inject.Inject;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.stereotype.Component;
import es.udc.lbd.gema.lps.security.SecurityUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JWTFilter extends OncePerRequestFilter {

	private final Logger logger = LoggerFactory.getLogger(JWTFilter.class);

  @Inject private TokenProvider tokenProvider;

  private String resolveToken(HttpServletRequest request) {
    String bearerToken = request.getHeader(SecurityUtils.AUTHORIZATION_HEADER);
    if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
      return bearerToken.substring(7, bearerToken.length());
    }

    return null;
  }

  @Override
  public void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String jwt = resolveToken(request);
    try {
      if (StringUtils.hasText(jwt) && tokenProvider.validateToken(jwt)) {
        Authentication authentication = tokenProvider.getAuthentication(jwt);
        SecurityContextHolder.getContext().setAuthentication(authentication);
      }
    } catch (AuthenticationCredentialsNotFoundException e) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    } finally {
      filterChain.doFilter(request, response);
    }
  }
}
/*% } %*/
