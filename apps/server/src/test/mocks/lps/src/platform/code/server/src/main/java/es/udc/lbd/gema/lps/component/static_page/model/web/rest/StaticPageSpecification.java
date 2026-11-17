/*% if (feature.GUI_StaticPages) { %*/
package es.udc.lbd.gema.lps.component.static_page.model.web.rest;

import es.udc.lbd.gema.lps.component.static_page.model.domain.StaticPage;
import es.udc.lbd.gema.lps.component.static_page.model.domain.StaticPageI18n;
import es.udc.lbd.gema.lps.model.domain.language.Language;
import java.util.ArrayList;
import java.util.List;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.web.bind.annotation.*;

public class StaticPageSpecification {
  public static Specification<StaticPage> searchAll(String search) {
    return new Specification<StaticPage>() {
      @Override
      public Predicate toPredicate(
        Root<StaticPage> root, CriteriaQuery<?> query, CriteriaBuilder criteriaBuilder) {
        List<Predicate> predicates = new ArrayList<>();
        String stringToFind = ("%" + search + "%").toLowerCase();
        Join<StaticPage, StaticPageI18n> join = root.join("translations");
        // Prevent repeated results
        query.distinct(true);
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(root.get("id").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(root.get("definedId").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(root.get("created_date").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(root.get("modified_date").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(join.get("id").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(join.get("body").as(String.class)), stringToFind));
        predicates.add(
          criteriaBuilder.like(
            criteriaBuilder.lower(join.get("description").as(String.class)), stringToFind));
        return criteriaBuilder.or(predicates.toArray(new Predicate[0]));
      }
    };
  }

  public static Specification<StaticPage> seachByLanguage(Language language) {
    return new Specification<StaticPage>() {
      @Override
      public Predicate toPredicate(
        Root<StaticPage> root, CriteriaQuery<?> query, CriteriaBuilder criteriaBuilder) {
        Join<StaticPage, StaticPageI18n> join = root.join("translations");
        return criteriaBuilder.equal(join.get("language"), language);
      }
    };
  }
}
/*% } %*/
