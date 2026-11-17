/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import jakarta.persistence.*;
import jakarta.persistence.Column;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapOptionsDTO;
import org.json.simple.JSONObject;
import org.json.simple.parser.ParseException;

@Entity(name = "mv_wms_layer")
@Table(name = "mv_wms_layer")
@PrimaryKeyJoinColumn(name = "id")
@DiscriminatorValue("WMS")

public class WMSLayer extends Layer
  {
    @Column(name = "added" )
    private Boolean added;

    @Column(name = "url" )
    private String url;

    @Column(name = "params", length = 2550)
    private String params;

    @Column(name = "list")
    private String list;

    public WMSLayer() {
    }

    public Boolean getAdded() {
        return added;
    }

    public void setAdded(Boolean added) {
        this.added = added;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getParams() {
        return params;
    }

    public void setParams(String params) {
        this.params = params;
    }

    public String getList() {
      return list;
    }

    public void setList(String list) {
      this.list = list;
    }

    @Override
    public MapOptionsDTO getLayerParams(MapOptionsDTO dto) throws ParseException {
      dto.setId(this.getLayerId());
      dto.setLabel(this.getLabel());
      dto.setType(LayerType.WMS);
      dto.setUrl(this.url);
      dto.setAdded(this.added);
      if( this.params!=null ){
        dto.setParams(toJSONObject(this.params));
      }
      dto.setList(this.list);
      return dto;
    }

    @Override
    public WMSLayer fromDtoToLayer(MapOptionsDTO dto){
      this.setLayerId(dto.getId());
      this.setLabel(dto.getLabel());
      this.url = dto.getUrl();
      if (dto.getParams() != null) this.params = dto.getParams().toString();
      this.added = dto.getAdded();
      this.list = dto.getList();
      return this;
    }

}
/*% } %*/
