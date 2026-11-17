/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;

@Entity(name = "mv_categorized_style_value")
@Table(name = "mv_categorized_style_value")
public class CategorizedStyleValue {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "categorizedStyleValueid")
    @SequenceGenerator(name = "categorizedStyleValueid", sequenceName = "mv_categorized_style_value_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "value" )
    private String value;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "categorized_style")
    private CategorizedStyle categorizedStyle;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "style")
    private SimpleStyle style;

    public CategorizedStyleValue() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public CategorizedStyle getCategorizedStyle() {
        return categorizedStyle;
    }

    public void setCategorizedStyle(CategorizedStyle categorizedStyle) {
        this.categorizedStyle = categorizedStyle;
    }

    public SimpleStyle getStyle() {
        return style;
    }

    public void setStyle(SimpleStyle style) {
        this.style = style;
    }

}
/*% } %*/
