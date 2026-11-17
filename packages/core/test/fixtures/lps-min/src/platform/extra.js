/* Helper functions available inside annotations of this LPS.
   NOTE: no `//` line comments allowed here. Processor.process strips every
   newline from the code it builds (processor.js:28), so a line comment would
   swallow the rest of the generated function, including its `return`. Neither
   the monolith's core/extra.js nor its mock LPS uses them either. */
function productName(data) {
  return data.basicData.name;
}

function upper(text) {
  return String(text).toUpperCase();
}
