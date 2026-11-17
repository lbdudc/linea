/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStyleDTO;
import jakarta.persistence.*;
import jakarta.persistence.Column;

@Entity(name = "mv_geojson_layer_style")
@Table(name = "mv_geojson_layer_style")
public class GeoJSONLayerStyle extends SimpleStyle
  {

    @Column(name = "fill_color" )
    private String fillColor;

    @Column(name = "stroke_color" )
    private String strokeColor;

    @Column(name = "fill_opacity" )
    private Double fillOpacity;

    @Column(name = "stroke_opacity" )
    private Double strokeOpacity;

    @Column(name = "radius" )
    private Double radius;

    @Column(name = "weight" )
    private Double weight;

    @Column(name = "icon" )
    private String icon;

    @Column(name = "draggable" )
    private Boolean draggable;

    @Column(name = "dragged" )
    private Boolean dragged;

    public GeoJSONLayerStyle() {
    }

    public String getFillColor() {
        return fillColor;
    }

    public void setFillColor(String fillColor) {
        this.fillColor = fillColor;
    }

    public String getStrokeColor() {
        return strokeColor;
    }

    public void setStrokeColor(String strokeColor) {
        this.strokeColor = strokeColor;
    }

    public Double getFillOpacity() {
        return fillOpacity;
    }

    public void setFillOpacity(Double fillOpacity) {
        this.fillOpacity = fillOpacity;
    }

    public Double getStrokeOpacity() {
        return strokeOpacity;
    }

    public void setStrokeOpacity(Double strokeOpacity) {
        this.strokeOpacity = strokeOpacity;
    }

    public Double getRadius() {
        return radius;
    }

    public void setRadius(Double radius) {
        this.radius = radius;
    }

    public Double getWeight() {
        return weight;
    }

    public void setWeight(Double weight) {
        this.weight = weight;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public Boolean getDraggable() {
        return draggable;
    }

    public void setDraggable(Boolean draggable) {
        this.draggable = draggable;
    }

    public Boolean getDragged() {
        return dragged;
    }

    public void setDragged(Boolean dragged) {
        this.dragged = dragged;
    }

    public MapStyleDTO getStyleParams() {
      MapStyleDTO dto = new MapStyleDTO();
      dto.setId(this.getName());
      dto.setFillColor(this.getFillColor());
      dto.setStrokeColor(this.getStrokeColor());
      dto.setFillOpacity(this.getFillOpacity());
      dto.setStrokeOpacity(this.getStrokeOpacity());
      dto.setRadius(this.getRadius());
      dto.setWeight(this.getWeight());
      dto.setDraggable(this.getDraggable());
      dto.setDragend(this.getDragged());
      return dto;
    }

    public GeoJSONLayerStyle fromDtoToLayer(MapStyleDTO dto) {
      this.setName(dto.getId());
      this.setFillColor(dto.getFillColor());
      this.setStrokeColor(dto.getStrokeColor());
      this.setFillOpacity(dto.getFillOpacity());
      this.setStrokeOpacity(dto.getStrokeOpacity());
      this.setRadius(dto.getRadius());
      this.setWeight(dto.getWeight());
      this.setDraggable(dto.getDraggable());
      this.setDragged(dto.getDragend());
      return this;
    }
}
/*% } %*/
