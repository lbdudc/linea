/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;


import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;

@Entity(name = "mv_categorized_style")
@Table(name = "mv_categorized_style")
public class CategorizedStyle extends Style
  {
    @Column(name = "cached" )
    private Boolean cached;

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "categorizedStyle")
    private List<CategorizedStyleValue> values;

    public CategorizedStyle() {
    }

    public Boolean getCached() {
        return cached;
    }

    public void setCached(Boolean cached) {
        this.cached = cached;
    }

    public List<CategorizedStyleValue> getValues() {
        return values;
    }

    public void setValues(List<CategorizedStyleValue> values) {
        this.values = values;
    }

}
/*% } %*/
