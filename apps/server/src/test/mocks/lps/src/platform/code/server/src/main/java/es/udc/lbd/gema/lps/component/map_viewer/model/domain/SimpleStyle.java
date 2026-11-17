/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;

@Entity(name = "mv_simple_style")
@Table(name = "mv_simple_style")
@Inheritance(strategy = InheritanceType.TABLE_PER_CLASS)
public class SimpleStyle extends Style
  {

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "style")
    private List<CategorizedStyleValue> categorizedStyleValues;

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "style")
    private List<StaticInterval> staticIntervals;

    public SimpleStyle() {
    }

    public List<CategorizedStyleValue> getCategorizedStyleValues() {
        return categorizedStyleValues;
    }

    public void setCategorizedStyleValues(List<CategorizedStyleValue> categorizedStyleValues) {
        this.categorizedStyleValues = categorizedStyleValues;
    }

    public List<StaticInterval> getStaticIntervals() {
        return staticIntervals;
    }

    public void setStaticIntervals(List<StaticInterval> staticIntervals) {
        this.staticIntervals = staticIntervals;
    }

}
/*% } %*/
