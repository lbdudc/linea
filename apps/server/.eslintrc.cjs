module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  extends: 'standard',
  overrides: [
    {
      env: {
        node: true
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script'
      }
    }
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // the git host API names its fields in snake_case (file_path, redirect_uri)
    camelcase: ['error', { properties: 'never' }],
    semi: 'off',
    quotes: 'off',
    indent: 'off',
    'comma-dangle': 'off',
    'spaced-comment': 'off',
    'space-before-function-paren': 'off',
    'object-property-newline': 'off',
    'object-curly-spacing': 'off',
    'key-spacing': 'off',
    'no-multi-spaces': 'off',
    'no-trailing-spaces': 'off',
    'space-infix-ops': 'off',
    'operator-linebreak': 'off',
    'padded-blocks': 'off',
    'no-multiple-empty-lines': 'off',
    'eol-last': 'off',
    'quote-props': 'off',
    'multiline-ternary': 'off',
    'comma-spacing': 'off',
    'block-spacing': 'off',
    'brace-style': 'off',
    'array-bracket-spacing': 'off',
    'space-in-parens': 'off',
    'lines-between-class-members': 'off'
  }
}
