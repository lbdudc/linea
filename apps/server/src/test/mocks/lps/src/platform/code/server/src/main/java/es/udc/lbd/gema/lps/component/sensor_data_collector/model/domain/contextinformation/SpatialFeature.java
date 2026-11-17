/*% if (feature.MWM_TA_TrajectoryAnnotator) { %*/
package es.udc.lbd.gema.lps.component.sensor_data_collector.model.domain.contextinformation;

import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import org.locationtech.jts.geom.Geometry;

@Entity
public class SpatialFeature {

  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "spatialFeatureGen")
  @SequenceGenerator(name = "spatialFeatureGen", sequenceName = "spatial_feature_id_seq", allocationSize = 1)
  private Long id;

  private Geometry position;

  private String type;

  private String description;

  @ManyToOne(fetch = FetchType.EAGER)
  private SpatialFeatureCollection collection;

  public SpatialFeature() {}

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Geometry getPosition() {
    return position;
  }

  public void setPosition(Geometry position) {
    this.position = position;
  }

  public String getType() {
    return type;
  }

  public void setType(String type) {
    this.type = type;
  }

  public String getDescription() {
    return description;
  }

  public void setDescription(String description) {
    this.description = description;
  }

  public SpatialFeatureCollection getCollection() {
    return collection;
  }

  public void setCollection(SpatialFeatureCollection collection) {
    this.collection = collection;
  }
}

/*% } %*/
