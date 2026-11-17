/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

/*% if (feature.UserManagement) { %*/
import es.udc.lbd.gema.lps.model.domain.user_management.UMUser;
/*% } %*/
import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.CascadeType;

@Entity(name = "mv_map")
@Table(name = "mv_map")
public class Map {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "mapid")
    @SequenceGenerator(name = "mapid", sequenceName = "mv_map_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "label" )
    private String label;

    @Column(name = "view" )
    private String view;

    @Column(name = "context_menu" )
    private Boolean contextMenu;

    @Column(name = "context_menu_width" )
    private Long contextMenuWidth;

    @Column(name = "min_zoom" )
    private Float minZoom;

    @Column(name = "max_zoom" )
    private Float maxZoom;

    @Column(name = "sortable" )
    private Boolean sortable;

    @OneToMany(fetch = FetchType.LAZY, cascade = CascadeType.ALL, mappedBy = "map")
    private List<LayerInMap> layersInMap;

    /*% if (feature.UserManagement) { %*/
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner")
    private UMUser owner;
    /*% } %*/

    public Map() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getView() {
        return view;
    }

    public void setView(String view) {
        this.view = view;
    }

    public Boolean getContextMenu() {
        return contextMenu;
    }

    public void setContextMenu(Boolean contextMenu) {
        this.contextMenu = contextMenu;
    }

    public Long getContextMenuWidth() {
        return contextMenuWidth;
    }

    public void setContextMenuWidth(Long contextMenuWidth) {
        this.contextMenuWidth = contextMenuWidth;
    }

    public Float getMinZoom() {
        return minZoom;
    }

    public void setMinZoom(Float minZoom) {
        this.minZoom = minZoom;
    }

    public Float getMaxZoom() {
        return maxZoom;
    }

    public void setMaxZoom(Float maxZoom) {
        this.maxZoom = maxZoom;
    }

    public Boolean getSortable() {
        return sortable;
    }

    public void setSortable(Boolean sortable) {
        this.sortable = sortable;
    }

    public List<LayerInMap> getLayersInMap() {
        return layersInMap;
    }

    public void setLayersInMap(List<LayerInMap> layersInMap) {
        this.layersInMap = layersInMap;
    }

    /*% if (feature.UserManagement) { %*/
    public UMUser getOwner() {
        return owner;
    }

    public void setOwner(UMUser owner) {
        this.owner = owner;
    }
    /*% } %*/
}
/*% } %*/
