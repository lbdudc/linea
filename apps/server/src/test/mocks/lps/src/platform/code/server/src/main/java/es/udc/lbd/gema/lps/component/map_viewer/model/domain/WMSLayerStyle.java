/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStyleDTO;
import jakarta.persistence.*;
import jakarta.persistence.Column;

@Entity(name = "mv_wms_layer_style")
@Table(name = "mv_wms_layer_style")
public class WMSLayerStyle extends SimpleStyle
  {
    @Column(name = "geometry_type")
    private String geometryType;

    @Column(name = "fill_color" )
    private String fillColor;

    @Column(name = "stroke_color" )
    private String strokeColor;

    @Column(name = "fill_opacity" )
    private Double fillOpacity;

    @Column(name = "stroke_opacity" )
    private Double strokeOpacity;

    public WMSLayerStyle() {
    }

    public String getGeometryType() {
      return geometryType;
    }

    public void setGeometryType(String geometryType) {
      this.geometryType = geometryType;
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

    public MapStyleDTO getStyleParams() {
      MapStyleDTO dto = new MapStyleDTO();
      dto.setId(this.getName());
      dto.setGeometryType(this.getGeometryType());
      dto.setFillColor(this.getFillColor());
      dto.setStrokeColor(this.getStrokeColor());
      dto.setFillOpacity(this.getFillOpacity());
      dto.setStrokeOpacity(this.getStrokeOpacity());
      return dto;
    }

    public WMSLayerStyle fromDtoToLayer(MapStyleDTO dto) {
      this.setName(dto.getId());
      this.setGeometryType(dto.getGeometryType());
      this.setFillColor(dto.getFillColor());
      this.setStrokeColor(dto.getStrokeColor());
      this.setFillOpacity(dto.getFillOpacity());
      this.setStrokeOpacity(dto.getStrokeOpacity());
      return this;
    }
}
/*% } %*/
