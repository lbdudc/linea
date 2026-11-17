/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;

@Entity(name = "mv_static_intervals_style")
@Table(name = "mv_static_intervals_style")
public class StaticIntervalsStyle extends Style
  {

    @Column(name = "cached" )
    private Boolean cached;

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "staticIntervalsStyle")
    private List<StaticInterval> intervals;

    public StaticIntervalsStyle() {
    }

    public Boolean getCached() {
        return cached;
    }

    public void setCached(Boolean cached) {
        this.cached = cached;
    }

    public List<StaticInterval> getIntervals() {
        return intervals;
    }

    public void setIntervals(List<StaticInterval> intervals) {
        this.intervals = intervals;
    }

}
/*% } %*/
