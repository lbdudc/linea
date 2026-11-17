/*% if (feature.UserManagement) { %*/
package es.udc.lbd.gema.lps.web.rest.specifications;

import es.udc.lbd.gema.lps.model.domain.user_management.UMUser;
import es.udc.lbd.gema.lps.web.rest.util.specification_utils.SpecificationUtil;
import java.util.ArrayList;
import java.util.List;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.springframework.data.jpa.domain.Specification;

public class UMUserSpecification {
  public static Specification<UMUser> searchAll(String search, String pathReceived) {
    if (search == null || search.equals("")) {
      return Specification.where(null);
    }
    return new Specification<UMUser>() {
      @Override
      public Predicate toPredicate(
          Root<UMUser> root, CriteriaQuery<?> query, CriteriaBuilder criteriaBuilder) {
        List<Predicate> predicates = new ArrayList<>();
        String stringToFind = ("%" + search + "%").toLowerCase();
        Path path = SpecificationUtil.getPath(root, pathReceived);
        predicates.add(
            criteriaBuilder.like(
                criteriaBuilder.lower(path.get("login").as(String.class)), stringToFind));
        predicates.add(
            criteriaBuilder.like(
                criteriaBuilder.lower(path.get("firstName").as(String.class)), stringToFind));
        predicates.add(
            criteriaBuilder.like(
                criteriaBuilder.lower(path.get("lastName").as(String.class)), stringToFind));
        predicates.add(
            criteriaBuilder.like(
                criteriaBuilder.lower(path.get("email").as(String.class)), stringToFind));
        return criteriaBuilder.or(predicates.toArray(new Predicate[0]));
      }
    };
  }
}
/*% } %*/
