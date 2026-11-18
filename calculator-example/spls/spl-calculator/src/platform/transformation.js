module.exports = modelTransformation;

function modelTransformation(input) {
  if (input.data) return input;

  var basicData = input.basicData || {};
  var name = basicData.name || "calculator";

  return {
    features: input.features || [],
    data: {
      title: basicData.title || name,
      description: basicData.description || name,
      maven: {
        group: (basicData.packageInfo && basicData.packageInfo.group) || "es.udc.lbd",
        artifact: (basicData.packageInfo && basicData.packageInfo.artifact) || artifactOf(name),
        version: basicData.version || "0.1",
      },
    },
  };
}

function artifactOf(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[^\w]+/g, "-")
    .replace(/_/g, "-")
    .toLowerCase();
}
