/*% if (feature.UM_AccountActivation) { %*/
package es.udc.lbd.gema.lps.component.scheduled_jobs;

import es.udc.lbd.gema.lps.model.service.UMUserService;
import jakarta.inject.Inject;

  /*% if (feature.T_Quartz) { %*/
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;
  /*% } else { %*/
import org.springframework.stereotype.Component;
  /*% } %*/

/*% if (!feature.T_Quartz) { %*/@Component/*% } %*/
public class RemoveNotActivatedUsersJob /*% if (feature.T_Quartz) { %*/implements Job/*% } %*/ {

  @Inject private UMUserService umUserService;

  /*% if (feature.T_Quartz) { %*/
  @Override
  public void execute(JobExecutionContext context) throws JobExecutionException {
  /*% } else { %*/
  public void execute() {
  /*% } %*/
    umUserService.removeNotActivatedUsers();
  }
}
/*% } %*/
