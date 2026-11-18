registerMetamodelProcessor(function (ret, input) {
  var given = input.basicData || {};
  var basicData = ret.data.basicData || {};
  var name = basicData.name || given.name || "calculator";
  ret.data.title = given.title || name;
  ret.data.description = given.description || name;
  ret.data.maven = {
    group: (given.packageInfo && given.packageInfo.group) || "es.udc.lbd",
    artifact: (given.packageInfo && given.packageInfo.artifact) || calculatorArtifactOf(name),
    version: basicData.version || given.version || "0.1"
  };
});

function calculatorArtifactOf(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .trim()
    .replace(/[^\w]+/g, "-")
    .replace(/_/g, "-")
    .toLowerCase();
}
