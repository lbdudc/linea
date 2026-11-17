/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStyleDTO;
import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;

@Entity(name = "mv_style")
@Table(name = "mv_style")
@Inheritance(strategy = InheritanceType.TABLE_PER_CLASS)
public class Style {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "styleid")
    @SequenceGenerator(name = "styleid", sequenceName = "mv_style_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "name" )
    private String name;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "tr_style_layers",
        joinColumns = @JoinColumn(name = "avaible_styles_id", referencedColumnName = "id"),
        inverseJoinColumns = @JoinColumn(name = "layers_id", referencedColumnName = "id"))
    private List<Layer> layers;

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "defaultStyle")
    private List<Layer> defaultStyle;

    @OneToMany(fetch = FetchType.LAZY, mappedBy = "defaultStyleInMap")
    private List<LayerInMap> defaultStyleInMap;

    public Style() {
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

    public List<Layer> getLayers() {
        return layers;
    }

    public void setLayers(List<Layer> layers) {
        this.layers = layers;
    }

    public List<Layer> getDefaultStyle() {
        return defaultStyle;
    }

    public void setDefaultStyle(List<Layer> defaultStyle) {
        this.defaultStyle = defaultStyle;
    }

    public List<LayerInMap> getDefaultStyleInMap() {
        return defaultStyleInMap;
    }

    public void setDefaultStyleInMap(List<LayerInMap> defaultStyleInMap) {
        this.defaultStyleInMap = defaultStyleInMap;
    }

    public MapStyleDTO getStyleParams() {
      MapStyleDTO dto = new MapStyleDTO();
      dto.setId(this.getName());
      return dto;
    }
}
/*% } %*/
