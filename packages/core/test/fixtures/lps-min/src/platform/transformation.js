module.exports = modelTransformation;

// Minimal transformation: mirrors the shape the engine expects
// (input.data && input.data.basicData short-circuits further processing).
function modelTransformation(input) {
  if (input.data && input.data.basicData) return input;
  return {
    features: input.features,
    data: {
      basicData: {
        name: input.basicData.name,
        version: input.basicData.version,
        languages: input.basicData.languages || ['en'],
      },
    },
  };
}
