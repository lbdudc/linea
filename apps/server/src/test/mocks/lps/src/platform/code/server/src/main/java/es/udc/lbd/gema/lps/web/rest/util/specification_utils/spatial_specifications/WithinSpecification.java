/*% if (feature.MWM_TrajectoryExploitation) { %*/
package es.udc.lbd.gema.lps.web.rest.util.specification_utils.spatial_specifications;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.hibernate.spatial.predicate.JTSSpatialPredicates;
import org.locationtech.jts.geom.Geometry;
import org.springframework.data.jpa.domain.Specification;

public class WithinSpecification<T> implements Specification<T> {

  private final Geometry geometry;
  private final String propertyName;

  public WithinSpecification(Geometry geometry, String propertyName) {
    this.geometry = geometry;
    this.propertyName = propertyName;
  }

  @Override
  public Predicate toPredicate(Root<T> root, CriteriaQuery<?> query, CriteriaBuilder builder) {
    if (geometry != null) {
      return JTSSpatialPredicates.within(builder, root.get(propertyName), geometry);
    }
    return null;
  }
}
/*% } %*/
