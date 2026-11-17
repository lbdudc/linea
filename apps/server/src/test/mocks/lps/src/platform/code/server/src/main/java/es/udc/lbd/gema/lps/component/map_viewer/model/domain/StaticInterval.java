/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;

@Entity(name = "mv_static_interval")
@Table(name = "mv_static_interval")
public class StaticInterval {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "staticIntervalid")
    @SequenceGenerator(name = "staticIntervalid", sequenceName = "mv_static_interval_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "min_value" )
    private String minValue;

    @Column(name = "max_value" )
    private String maxValue;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "static_intervals_style")
    private StaticIntervalsStyle staticIntervalsStyle;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "style")
    private SimpleStyle style;

    public StaticInterval() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getMinValue() {
        return minValue;
    }

    public void setMinValue(String minValue) {
        this.minValue = minValue;
    }

    public String getMaxValue() {
        return maxValue;
    }

    public void setMaxValue(String maxValue) {
        this.maxValue = maxValue;
    }

    public StaticIntervalsStyle getStaticIntervalsStyle() {
        return staticIntervalsStyle;
    }

    public void setStaticIntervalsStyle(StaticIntervalsStyle staticIntervalsStyle) {
        this.staticIntervalsStyle = staticIntervalsStyle;
    }

    public SimpleStyle getStyle() {
        return style;
    }

    public void setStyle(SimpleStyle style) {
        this.style = style;
    }

}
/*% } %*/
