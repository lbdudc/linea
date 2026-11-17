/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.CascadeType;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapOptionsDTO;

@Entity(name = "mv_layer_in_map")
@Table(name = "mv_layer_in_map")
public class LayerInMap {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "layerInMapid")
    @SequenceGenerator(name = "layerInMapid", sequenceName = "mv_layer_in_map_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "is_base_layer" )
    private Boolean isBaseLayer;

    @Column(name = "layer_order" )
    private Integer order;

    @Column(name = "selected" )
    private Boolean selected;

    @Column(name = "opacity" )
    private Long opacity;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "map")
    private Map map;

    @ManyToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL)
    @JoinColumn(name = "layer")
    private Layer layer;

    @ManyToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL)
    @JoinColumn(name = "default_style_in_map")
    private Style defaultStyleInMap;

    public LayerInMap() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Boolean getIsBaseLayer() {
        return isBaseLayer;
    }

    public void setIsBaseLayer(Boolean isBaseLayer) {
        this.isBaseLayer = isBaseLayer;
    }

    public Integer getOrder() {
        return order;
    }

    public void setOrder(Integer order) {
        this.order = order;
    }

    public Boolean getSelected() {
        return selected;
    }

    public void setSelected(Boolean selected) {
        this.selected = selected;
    }

    public Long getOpacity() {
        return opacity;
    }

    public void setOpacity(Long opacity) {
        this.opacity = opacity;
    }

    public Map getMap() {
        return map;
    }

    public void setMap(Map map) {
        this.map = map;
    }

    public Layer getLayer() {
        return layer;
    }

    public void setLayer(Layer layer) {
        this.layer = layer;
    }

    public Style getDefaultStyleInMap() {
        return defaultStyleInMap;
    }

    public void setDefaultStyleInMap(Style defaultStyleInMap) {
        this.defaultStyleInMap = defaultStyleInMap;
    }

    public MapOptionsDTO getLayerParams(MapOptionsDTO dto) {
      dto.setBaseLayer(this.isBaseLayer);
      dto.setSelected(this.selected);
      dto.setOpacity(this.opacity);
      return dto;
    }
}
/*% } %*/
