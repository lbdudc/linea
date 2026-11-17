registerMetamodelProcessor(function (ret, input) {
  ret.data.models = input.models;
  ret.data.modelsByMetamodel = input.modelsByMetamodel;
});
