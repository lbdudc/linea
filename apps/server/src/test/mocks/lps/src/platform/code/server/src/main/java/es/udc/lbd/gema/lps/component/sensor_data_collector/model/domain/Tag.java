/*% if (feature.MWM_TrajectoryAnnotation) { %*/
package es.udc.lbd.gema.lps.component.sensor_data_collector.model.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "ta_tag")
public class Tag {
  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "tagGen")
  @SequenceGenerator(name = "tagGen", sequenceName = "ta_tag_id_seq", allocationSize = 1)
  private Long id;

  @Column(unique = true, nullable = false)
  private String name;

  public Tag() {}

  public Tag(String name) {
    this.name = name;
  }

  public Tag(Long id, String name) {
    this.id = id;
    this.name = name;
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  @Override
  public String toString() {
    return "Tag [id=" + id + ", name=" + name + "]";
  }
}

/*% } %*/
