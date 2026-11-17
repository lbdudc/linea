/*% if (feature.GUI_StaticPages) { %*/
package es.udc.lbd.gema.lps.component.static_page.model.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Column;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.GenerationType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.NotEmpty;

import es.udc.lbd.gema.lps.model.domain.language.Language;

@Entity
@Table(name = "static_page_i18n", uniqueConstraints={
  @UniqueConstraint(columnNames = {"static_page_id", "language"})
})
public class StaticPageI18n {

  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "staticPageI18nGen")
  @SequenceGenerator(name = "staticPageI18nGen", sequenceName = "static_page_i18n_id_seq", allocationSize = 1)
  private Long id;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private Language language;

  @NotEmpty
  @Column(length = 10485760)
  private String body;

  private String description;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name= "static_page_id")
  private StaticPage staticPage;

  public StaticPageI18n(){

  }

  public StaticPageI18n(Long id, Language language, @NotEmpty String body, String description, StaticPage staticPage) {
    this.id = id;
    this.language = language;
    this.body = body;
    this.description = description;
    this.staticPage = staticPage;
  }

  public Long getId(){
    return id;
  }

  public void setId(Long id){
    this.id = id;
  }

  public String getBody(){
    return body;
  }

  public void setBody(String body){
    this.body = body;
  }

  public String getDescription(){
    return description;
  }

  public void setDescription(String description){
    this.description = description;
  }

  public StaticPage getStaticPage() {
    return staticPage;
  }

  public void setStaticPage(StaticPage staticPage){
    this.staticPage = staticPage;
  }

  public Language getLanguage() {
    return language;
  }

  public void setLanguage(Language language) {
    this.language = language;
  }

}
/*% } %*/
